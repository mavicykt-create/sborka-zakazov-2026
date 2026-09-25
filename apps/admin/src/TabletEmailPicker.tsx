import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from './apiBase';
import { YandexAudioPlayer } from './voice/yandexSpeech';

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
  const base = `Собрано ${order.summary.lineCount} ${plural(order.summary.lineCount, 'строка', 'строки', 'строк')}, ${packages} ${plural(packages, 'упаковка', 'упаковки', 'упаковок')}`;
  return pieces > 0 ? `${base}, ${pieces} ${plural(pieces, 'штука', 'штуки', 'штук')}` : base;
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

function systemSpeak(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(text);
  speech.lang = 'ru-RU';
  speech.rate = 1.04;
  const voices = window.speechSynthesis.getVoices();
  speech.voice =
    voices.find((voice) => /алис|alice|yandex|ал[её]на|alena/iu.test(`${voice.name} ${voice.voiceURI}`)) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith('ru')) ??
    null;
  window.speechSynthesis.speak(speech);
}

function shortOrderNumber(order: BoardOrder) {
  return order.documentNumber.slice(-2);
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
  const [zoomedImage, setZoomedImage] = useState<{ src: string; name: string } | null>(null);
  const [yandexSpeechEnabled, setYandexSpeechEnabled] = useState(false);
  const revisions = useRef<Map<string, string> | null>(null);
  const suppressNextAnnouncements = useRef(false);
  const tapTimes = useRef(new Map<string, number>());
  const audioPlayer = useRef(new YandexAudioPlayer());

  const selected = useMemo(
    () => board?.orders.find((order) => order.id === selectedId) ?? board?.orders[0] ?? null,
    [board, selectedId],
  );

  const speak = useCallback(
    async (text: string) => {
      if (yandexSpeechEnabled) {
        try {
          const response = await fetch(`${API_BASE}/api/picker/speech`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          if (response.ok && (await audioPlayer.current.speak(await response.blob()))) return;
        } catch {
          // Системная Алиса/русский голос — резерв при недоступности SpeechKit.
        }
      }
      systemSpeak(text);
    },
    [token, yandexSpeechEnabled],
  );

  const announce = useCallback(
    (order: BoardOrder, updated = false) => {
      playChime();
      void speak(
        updated ? `Заказ ${shortOrderNumber(order)} обновлён` : `Новый заказ ${shortOrderNumber(order)}`,
      );
    },
    [speak],
  );

  const loadBoard = useCallback(
    async (silent = false) => {
      if (!token) return;
      try {
        const next = await json<Board>('/api/picker/assembly-board', token);
        const nextRevisions = new Map(next.orders.map((order) => [order.id, order.updatedAt]));
        if (revisions.current && !suppressNextAnnouncements.current) {
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
    [announce, token],
  );

  useEffect(() => {
    if (!token) return;
    void loadBoard();
    const timer = window.setInterval(() => void loadBoard(true), 3000);
    return () => window.clearInterval(timer);
  }, [loadBoard, token]);

  useEffect(() => {
    if (!token) return;
    void json<{ yandexEnabled: boolean }>('/api/picker/speech/settings', token)
      .then((settings) => setYandexSpeechEnabled(settings.yandexEnabled))
      .catch(() => setYandexSpeechEnabled(false));
    return () => audioPlayer.current.cancel();
  }, [token]);

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
    const order = selected;
    const completesOrder = order.items.every((entry) => entry.id === item.id || entry.status === 'PICKED');
    setBusyItem(item.id);
    setMessage('');
    setBoard((current) =>
      current
        ? {
            ...current,
            orders: current.orders.map((entry) =>
              entry.id === order.id
                ? {
                    ...entry,
                    items: entry.items.map((row) =>
                      row.id === item.id ? { ...row, status: 'PICKED' as const } : row,
                    ),
                  }
                : entry,
            ),
          }
        : current,
    );
    try {
      await json(`/api/picker/orders/${order.id}/items/${item.id}/pick`, token, {
        method: 'POST',
        body: JSON.stringify({ deviceAt: new Date().toISOString() }),
      });
      suppressNextAnnouncements.current = true;
      if (completesOrder) void speak(`${spokenSummary(order)}.`);
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
    tapTimes.current.delete(item.id);
    setBoard((current) =>
      current
        ? {
            ...current,
            orders: current.orders.map((order) => ({
              ...order,
              items: order.items.map((row) =>
                row.id === item.id ? { ...row, status: 'ACTIVE' as const } : row,
              ),
            })),
          }
        : current,
    );
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
    if (item.status !== 'PICKED') {
      void pick(item);
      return;
    }
    const now = Date.now();
    const last = tapTimes.current.get(item.id) || 0;
    tapTimes.current.set(item.id, now);
    if (now - last < 360) void undo(item);
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

  const closed = Boolean(selected && ['CLOSED', 'CANCELLED'].includes(selected.status));

  return (
    <main className={`tabletPicker ${embedded ? 'isEmbedded' : ''}`}>
      <header className="tabletHeader">
        <nav className="orderTabs" aria-label="Заказы">
          {board.orders.map((order) => (
            <button
              type="button"
              key={order.id}
              className={`${order.id === selected?.id ? 'isCurrent' : ''} ${order.status === 'CLOSED' ? 'isClosed' : ''}`}
              onClick={() => setSelectedId(order.id)}
            >
              №{order.documentNumber}
            </button>
          ))}
        </nav>
        <div className="tabletHeaderActions">
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
                <button
                  type="button"
                  className="productPhoto"
                  disabled={!item.imageUrl}
                  onClick={() => item.imageUrl && setZoomedImage({ src: item.imageUrl, name: item.name })}
                  aria-label={item.imageUrl ? `Увеличить фото: ${item.name}` : 'Фото товара отсутствует'}
                >
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} loading="lazy" />
                  ) : (
                    <span>{item.barcode || '—'}</span>
                  )}
                </button>
                <div className="productInfo">
                  <div className="productBadges">
                    <b>Код {item.barcode || 'не указан'}</b>
                    {pieceOnly && <em>ШТУЧНЫЙ ТОВАР</em>}
                  </div>
                  <h2>{item.name}</h2>
                </div>
                <div className={`assemblyQuantity ${pieceOnly ? 'isPiece' : ''}`}>
                  {pieceOnly ? (
                    <>
                      <strong>{pieces}</strong>
                      <span>шт</span>
                    </>
                  ) : (
                    <>
                      <strong>{packages}</strong>
                      <span>{plural(packages, 'упак', 'упак', 'упак')}</span>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className="cartButton"
                  disabled={busyItem === item.id || closed}
                  onClick={() => handleCart(item)}
                  aria-label={picked ? 'Дважды нажмите, чтобы вернуть товар' : 'Отметить товар собранным'}
                >
                  {picked ? '✓' : '🛒'}
                </button>
              </article>
            );
          })}
        </section>
      )}
      {zoomedImage && (
        <div className="productZoom" role="dialog" aria-modal="true" aria-label={zoomedImage.name}>
          <button type="button" className="productZoomBackdrop" onClick={() => setZoomedImage(null)} />
          <figure>
            <img src={zoomedImage.src} alt={zoomedImage.name} />
            <figcaption>{zoomedImage.name}</figcaption>
            <button type="button" onClick={() => setZoomedImage(null)} aria-label="Закрыть увеличенное фото">
              ×
            </button>
          </figure>
        </div>
      )}
    </main>
  );
}
