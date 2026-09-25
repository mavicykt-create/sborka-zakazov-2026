import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from './apiBase';

type Status =
  | 'NEW'
  | 'READY'
  | 'ASSIGNED'
  | 'PICKING'
  | 'REVIEW_REQUIRED'
  | 'COMPLETED'
  | 'CLOSED'
  | 'CANCELLED';
type ItemStatus = 'PENDING' | 'ASSIGNED' | 'ACTIVE' | 'PICKED' | 'NOT_FOUND' | 'SKIPPED';

type BoardItem = {
  id: string;
  sourceLine: number;
  barcode: string | null;
  name: string;
  packageQuantity: number | null;
  pieceQuantity: number | null;
  pickType: 'PACKAGE' | 'PIECE' | 'REVIEW';
  status: ItemStatus;
  assignedWorkerId: string | null;
  imageUrl: string | null;
  productUrl: string | null;
};

type BoardOrder = {
  id: string;
  documentNumber: string;
  status: Status;
  orderTotal: number | null;
  sourceRevision: string | null;
  updatedAt: string;
  closedAt: string | null;
  summary: {
    lineCount: number;
    packageCount: number;
    pieceCount: number;
    pickedLines: number;
    pickedPackages: number;
    pickedPieces: number;
  };
  items: BoardItem[];
};

type Board = {
  worker: { id: string; name: string; shiftStatus: string };
  generatedAt: string;
  orders: BoardOrder[];
};

type LoginResult = { token: string; worker: Board['worker'] };

async function json<T>(path: string, token?: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Ошибка HTTP ${response.status}`);
  return data;
}

function plural(value: number, one: string, few: string, many: string) {
  const tail = value % 100;
  const digit = value % 10;
  if (tail >= 11 && tail <= 19) return many;
  if (digit === 1) return one;
  if (digit >= 2 && digit <= 4) return few;
  return many;
}

function spokenSummary(order: BoardOrder) {
  const packages = Math.round(order.summary.packageCount);
  const pieces = Math.round(order.summary.pieceCount);
  return `${order.summary.lineCount} ${plural(order.summary.lineCount, 'строка', 'строки', 'строк')}, ${packages} ${plural(packages, 'упаковка', 'упаковки', 'упаковок')}, ${pieces} ${plural(pieces, 'штука', 'штуки', 'штук')}`;
}

function playChime() {
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const start = context.currentTime + 0.02;
  [659.25, 783.99, 987.77].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start + index * 0.13);
    gain.gain.linearRampToValueAtTime(0.13, start + index * 0.13 + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.001, start + index * 0.13 + 0.38);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start + index * 0.13);
    oscillator.stop(start + index * 0.13 + 0.4);
  });
  window.setTimeout(() => void context.close(), 1000);
}

function announce(order: BoardOrder, updated = false) {
  playChime();
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(
    updated
      ? `Заказ номер ${order.documentNumber} обновлён. ${spokenSummary(order)}.`
      : `Заказ номер ${order.documentNumber} поступил. Заказ оформлен. ${spokenSummary(order)}.`,
  );
  speech.lang = 'ru-RU';
  speech.rate = 0.94;
  window.speechSynthesis.speak(speech);
}

function qty(value: number | null) {
  return value == null ? 0 : Number(value);
}

export function TabletEmailPicker({ embedded = false }: { embedded?: boolean }) {
  const [token, setToken] = useState(() => localStorage.getItem('emailPickerToken') || '');
  const [credentials, setCredentials] = useState({ login: '', password: '' });
  const [board, setBoard] = useState<Board | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState('');
  const [busyItem, setBusyItem] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('emailPickerSound') === 'on');
  const revisions = useRef<Map<string, string> | null>(null);
  const suppressNextAnnouncements = useRef(false);
  const tapTimes = useRef(new Map<string, number>());
  const tapTimers = useRef(new Map<string, number>());

  const selected = useMemo(
    () => board?.orders.find((order) => order.id === selectedId) ?? board?.orders[0] ?? null,
    [board, selectedId],
  );

  const loadBoard = useCallback(
    async (silent = false) => {
      if (!token) return;
      try {
        const next = await json<Board>('/api/picker/assembly-board', token);
        const nextRevisions = new Map(next.orders.map((order) => [order.id, order.updatedAt]));
        if (revisions.current && soundEnabled && !suppressNextAnnouncements.current) {
          for (const order of next.orders) {
            if (order.status === 'CLOSED' || order.status === 'CANCELLED') continue;
            const before = revisions.current.get(order.id);
            if (!before) announce(order, false);
            else if (before !== order.updatedAt) announce(order, true);
          }
        }
        suppressNextAnnouncements.current = false;
        revisions.current = nextRevisions;
        setBoard(next);
        setSelectedId((current) =>
          next.orders.some((order) => order.id === current)
            ? current
            : next.orders.find((order) => !['CLOSED', 'CANCELLED'].includes(order.status))?.id ||
              next.orders[0]?.id ||
              '',
        );
        if (!silent) setMessage('');
      } catch (error) {
        const text = error instanceof Error ? error.message : 'Не удалось получить заказы';
        setMessage(text);
        if (/сессия|вход/iu.test(text)) {
          localStorage.removeItem('emailPickerToken');
          setToken('');
        }
      }
    },
    [token, soundEnabled],
  );

  useEffect(() => {
    if (!token) return;
    void loadBoard();
    const timer = window.setInterval(() => void loadBoard(true), 3000);
    return () => window.clearInterval(timer);
  }, [loadBoard, token]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      const result = await json<LoginResult>('/api/picker/login', undefined, {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      localStorage.setItem('emailPickerToken', result.token);
      setToken(result.token);
      setCredentials({ login: '', password: '' });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось войти');
    }
  }

  async function logout() {
    try {
      await json('/api/picker/logout', token, { method: 'POST' });
    } catch {
      // Локальный выход доступен и без связи с сервером.
    }
    localStorage.removeItem('emailPickerToken');
    setToken('');
    setBoard(null);
  }

  async function pick(item: BoardItem) {
    if (!selected || busyItem || ['CLOSED', 'CANCELLED'].includes(selected.status)) return;
    setBusyItem(item.id);
    setMessage('');
    try {
      await json(`/api/picker/orders/${selected.id}/claim`, token, { method: 'POST' });
      if (item.status === 'PENDING' || item.status === 'ASSIGNED') {
        await json(`/api/picker/items/${item.id}/status`, token, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'ACTIVE', deviceAt: new Date().toISOString() }),
        });
      }
      await json(`/api/picker/items/${item.id}/status`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'PICKED', deviceAt: new Date().toISOString() }),
      });
      suppressNextAnnouncements.current = true;
      await loadBoard(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось отметить товар');
      await loadBoard(true);
    } finally {
      setBusyItem('');
    }
  }

  async function undo(item: BoardItem) {
    if (busyItem) return;
    setBusyItem(item.id);
    try {
      await json(`/api/picker/items/${item.id}/undo`, token, {
        method: 'POST',
        body: JSON.stringify({ deviceAt: new Date().toISOString() }),
      });
      suppressNextAnnouncements.current = true;
      await loadBoard(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось вернуть позицию');
    } finally {
      setBusyItem('');
    }
  }

  function handleCart(item: BoardItem) {
    const now = Date.now();
    const last = tapTimes.current.get(item.id) || 0;
    const timer = tapTimers.current.get(item.id);
    if (now - last < 380) {
      if (timer) window.clearTimeout(timer);
      tapTimers.current.delete(item.id);
      tapTimes.current.delete(item.id);
      if (item.status === 'PICKED') void undo(item);
      return;
    }
    tapTimes.current.set(item.id, now);
    if (item.status !== 'PICKED') {
      const nextTimer = window.setTimeout(() => {
        tapTimers.current.delete(item.id);
        tapTimes.current.delete(item.id);
        void pick(item);
      }, 300);
      tapTimers.current.set(item.id, nextTimer);
    }
  }

  async function finish() {
    if (!selected) return;
    try {
      await json(`/api/picker/orders/${selected.id}/finish`, token, { method: 'POST' });
      setMessage(`Заказ №${selected.documentNumber} собран и закрыт`);
      suppressNextAnnouncements.current = true;
      await loadBoard(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось завершить заказ');
    }
  }

  function enableSound() {
    const enabled = !soundEnabled;
    setSoundEnabled(enabled);
    localStorage.setItem('emailPickerSound', enabled ? 'on' : 'off');
    if (enabled && selected && !['CLOSED', 'CANCELLED'].includes(selected.status)) announce(selected, false);
  }

  if (!token) {
    return (
      <main className={`tabletPicker tabletLogin ${embedded ? 'isEmbedded' : ''}`}>
        <section>
          <p className="tabletEyebrow">Сладкая планета</p>
          <h1>Сборка по email</h1>
          <p>Заказы появляются автоматически. Войдите под учётной записью сборщика.</p>
        </section>
        <form onSubmit={(event) => void login(event)}>
          <label>
            Логин
            <input
              autoComplete="username"
              value={credentials.login}
              onChange={(event) => setCredentials({ ...credentials, login: event.target.value })}
              required
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              value={credentials.password}
              onChange={(event) => setCredentials({ ...credentials, password: event.target.value })}
              required
            />
          </label>
          <button type="submit">Открыть сборку</button>
          {message && <p className="tabletAlert">{message}</p>}
        </form>
      </main>
    );
  }

  if (!board) return <main className="tabletPicker tabletLoading">Загружаем заказы…</main>;

  const complete = Boolean(
    selected && selected.items.length > 0 && selected.items.every((item) => item.status === 'PICKED'),
  );
  const closed = Boolean(selected && ['CLOSED', 'CANCELLED'].includes(selected.status));

  return (
    <main className={`tabletPicker ${embedded ? 'isEmbedded' : ''}`}>
      <header className="tabletHeader">
        <div>
          <p className="tabletEyebrow">Сборка по email</p>
          <strong>{board.worker.name}</strong>
        </div>
        <nav className="orderTabs" aria-label="Заказы">
          {board.orders.map((order) => (
            <button
              type="button"
              key={order.id}
              className={`${order.id === selected?.id ? 'isCurrent' : ''} ${order.status === 'CLOSED' ? 'isClosed' : ''}`}
              onClick={() => setSelectedId(order.id)}
            >
              №{order.documentNumber}
              <small>
                {order.status === 'CLOSED'
                  ? 'закрыт'
                  : `${order.summary.pickedLines}/${order.summary.lineCount}`}
              </small>
            </button>
          ))}
        </nav>
        <div className="tabletHeaderActions">
          <button type="button" className={soundEnabled ? 'soundOn' : ''} onClick={enableSound}>
            {soundEnabled ? '🔊 Звук' : '🔇 Включить звук'}
          </button>
          <button type="button" onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      </header>

      {message && <div className="tabletAlert">{message}</div>}
      {!selected && (
        <section className="tabletEmpty">
          <b>Ждём новый заказ</b>
          <span>Почта проверяется автоматически</span>
        </section>
      )}
      {selected && (
        <>
          <section className="orderSummary">
            <div>
              <span>Заказ</span>
              <strong>№{selected.documentNumber}</strong>
            </div>
            <div>
              <span>Строк</span>
              <strong>{selected.summary.lineCount}</strong>
            </div>
            <div>
              <span>Упаковок</span>
              <strong>
                {selected.summary.pickedPackages}/{selected.summary.packageCount}
              </strong>
            </div>
            <div>
              <span>Штук</span>
              <strong>
                {selected.summary.pickedPieces}/{selected.summary.pieceCount}
              </strong>
            </div>
            {selected.orderTotal != null && (
              <div>
                <span>Сумма</span>
                <strong>{selected.orderTotal.toLocaleString('ru-RU')} ₽</strong>
              </div>
            )}
          </section>

          <section className={`assemblyList ${closed ? 'isClosed' : ''}`}>
            {selected.items.map((item) => {
              const packages = qty(item.packageQuantity);
              const pieces = qty(item.pieceQuantity);
              const pieceOnly = item.pickType === 'PIECE' || (!packages && pieces > 0);
              const picked = item.status === 'PICKED';
              return (
                <article
                  className={`assemblyRow ${pieceOnly ? 'isPiece' : ''} ${picked ? 'isPicked' : ''}`}
                  key={item.id}
                >
                  <div className="productPhoto">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" loading="lazy" />
                    ) : (
                      <span>{item.barcode || '—'}</span>
                    )}
                  </div>
                  <div className="productInfo">
                    <div className="productBadges">
                      <b>Код {item.barcode || 'не указан'}</b>
                      {pieceOnly && <em>ШТУЧНЫЙ ТОВАР</em>}
                    </div>
                    <h2>{item.name}</h2>
                  </div>
                  <div className={`assemblyQuantity ${pieceOnly ? 'isPiece' : ''}`}>
                    {packages > 0 && pieces > 0 ? (
                      <>
                        <strong>
                          {packages}/{pieces}
                        </strong>
                        <span>уп / шт</span>
                      </>
                    ) : pieceOnly ? (
                      <>
                        <strong>{pieces}</strong>
                        <span>шт</span>
                      </>
                    ) : (
                      <>
                        <strong>{packages}</strong>
                        <span>упаковок</span>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    className="cartButton"
                    disabled={Boolean(busyItem) || closed}
                    onClick={() => handleCart(item)}
                    aria-label={picked ? 'Дважды нажмите, чтобы вернуть товар' : 'Отметить товар собранным'}
                  >
                    {picked ? '✓' : '🛒'}
                    <small>{picked ? 'Собрано' : 'В корзину'}</small>
                  </button>
                </article>
              );
            })}
          </section>

          <footer className="assemblyFooter">
            <p>
              {closed
                ? 'Этот заказ закрыт'
                : 'Одно касание — собрано. Два касания по собранной позиции — вернуть.'}
            </p>
            <button
              type="button"
              className={complete ? 'canFinish' : ''}
              disabled={!complete || closed}
              onClick={() => void finish()}
            >
              <span>✓</span>
              {closed
                ? 'Заказ закрыт'
                : complete
                  ? 'Заказ собран'
                  : `Собрано ${selected.summary.pickedLines} из ${selected.summary.lineCount}`}
            </button>
          </footer>
        </>
      )}
    </main>
  );
}
