import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type ShiftStatus = 'OFF_SHIFT' | 'AVAILABLE' | 'BUSY';
type ItemStatus = 'PENDING' | 'ASSIGNED' | 'ACTIVE' | 'PICKED' | 'NOT_FOUND' | 'SKIPPED';
type OrderStatus = 'NEW' | 'READY' | 'ASSIGNED' | 'PICKING' | 'REVIEW_REQUIRED' | 'COMPLETED' | 'CLOSED';

type Progress = {
  total: number;
  completed: number;
  percent: number;
  summary: Record<ItemStatus, number>;
};

type Worker = {
  id: string;
  login: string;
  name: string;
  isActive: boolean;
  shiftStatus: ShiftStatus;
  _count: { assignedItems: number };
};

type OrderListItem = {
  id: string;
  documentNumber: string;
  documentDate: string;
  warehouse: string;
  status: OrderStatus;
  _count: { items: number };
  progress: Progress;
  createdAt: string;
};

type Item = {
  id: string;
  sourceLine: number;
  barcode: string | null;
  name: string;
  groupKey: string;
  packageQuantity: string | number | null;
  pieceQuantity: string | number | null;
  pickType: 'PACKAGE' | 'PIECE' | 'REVIEW';
  pickQuantity: string | number;
  status: ItemStatus;
  assignedWorkerId: string | null;
  assignedWorker: Pick<Worker, 'id' | 'login' | 'name' | 'isActive' | 'shiftStatus'> | null;
};

type Order = OrderListItem & { items: Item[] };
type ImportResponse = { duplicate: boolean; order: Order; warnings?: string[] };

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Ошибка HTTP ${response.status}`);
  return data;
}

function quantity(value: string | number | null): string {
  return value == null || Number(value) === 0 ? '—' : String(Number(value));
}

function App() {
  const [section, setSection] = useState<'orders' | 'workers'>('orders');
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [workerForm, setWorkerForm] = useState({ name: '', login: '', password: '' });

  async function refreshLists() {
    const [nextOrders, nextWorkers] = await Promise.all([
      requestJson<OrderListItem[]>(`${API}/api/orders`),
      requestJson<Worker[]>(`${API}/api/workers`),
    ]);
    setOrders(nextOrders);
    setWorkers(nextWorkers);
    return { nextOrders, nextWorkers };
  }

  useEffect(() => {
    Promise.all([
      requestJson<OrderListItem[]>(`${API}/api/orders`),
      requestJson<Worker[]>(`${API}/api/workers`),
    ])
      .then(([nextOrders, nextWorkers]) => {
        setOrders(nextOrders);
        setWorkers(nextWorkers);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : 'API недоступен'));
  }, []);

  const stats = useMemo(
    () => ({
      newOrders: orders.filter((order) => order.status === 'NEW').length,
      picking: orders.filter((order) => ['ASSIGNED', 'PICKING'].includes(order.status)).length,
      problems: orders.filter((order) => order.status === 'REVIEW_REQUIRED').length,
      ready: orders.filter((order) => order.status === 'COMPLETED').length,
    }),
    [orders],
  );

  const groups = useMemo(() => {
    if (!selected) return [];
    const grouped = new Map<string, Item[]>();
    for (const item of selected.items) {
      const group = grouped.get(item.groupKey) ?? [];
      group.push(item);
      grouped.set(item.groupKey, group);
    }
    return [...grouped.entries()];
  }, [selected]);

  const attention = useMemo(
    () =>
      selected?.items.filter(
        (item) => item.status === 'NOT_FOUND' || item.status === 'SKIPPED' || item.pickType === 'REVIEW',
      ) ?? [],
    [selected],
  );

  const selectableWorkers = useMemo(() => {
    const current = new Set(selected?.items.map((item) => item.assignedWorkerId).filter(Boolean));
    return workers.filter(
      (worker) => worker.isActive && (worker.shiftStatus === 'AVAILABLE' || current.has(worker.id)),
    );
  }, [selected, workers]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setNotice('');
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Операция не выполнена');
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    await perform(async () => {
      const body = new FormData();
      body.append('file', file);
      const result = await requestJson<ImportResponse>(`${API}/api/orders/import-xlsx`, {
        method: 'POST',
        body,
      });
      await refreshLists();
      setSelected(result.order);
      setSelectedWorkers([]);
      setNotice(
        result.duplicate
          ? `Заказ №${result.order.documentNumber} уже существует и открыт.`
          : `Заказ №${result.order.documentNumber} импортирован: ${result.order.items.length} позиций.`,
      );
    });
  }

  async function openOrder(id: string) {
    await perform(async () => {
      const order = await requestJson<Order>(`${API}/api/orders/${id}`);
      setSelected(order);
      setSelectedWorkers([...new Set(order.items.map((item) => item.assignedWorkerId).filter(isString))]);
    });
  }

  async function assign() {
    if (!selected || selectedWorkers.length === 0) {
      setNotice('Выберите хотя бы одного доступного сборщика.');
      return;
    }
    const isReassign = selected.items.some((item) => item.assignedWorkerId);
    await perform(async () => {
      const order = await requestJson<Order>(
        `${API}/api/orders/${selected.id}/${isReassign ? 'reassign' : 'assign'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workerIds: selectedWorkers }),
        },
      );
      setSelected(order);
      await refreshLists();
      setNotice(`${isReassign ? 'Перераспределено' : 'Распределено'} ${order.items.length} позиций.`);
    });
  }

  async function changeStatus(item: Item, status: Exclude<ItemStatus, 'PENDING' | 'ASSIGNED'>) {
    await perform(async () => {
      const order = await requestJson<Order>(`${API}/api/order-items/${item.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, workerId: item.assignedWorkerId, deviceAt: new Date().toISOString() }),
      });
      setSelected(order);
      await refreshLists();
    });
  }

  async function undo(item: Item) {
    await perform(async () => {
      const order = await requestJson<Order>(`${API}/api/order-items/${item.id}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerId: item.assignedWorkerId, deviceAt: new Date().toISOString() }),
      });
      setSelected(order);
      await refreshLists();
    });
  }

  async function createNewWorker(event: React.FormEvent) {
    event.preventDefault();
    await perform(async () => {
      await requestJson<Worker>(`${API}/api/workers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...workerForm, shiftStatus: 'AVAILABLE' }),
      });
      setWorkerForm({ name: '', login: '', password: '' });
      await refreshLists();
      setNotice('Сборщик создан и доступен для назначения.');
    });
  }

  async function setShift(worker: Worker, shiftStatus: ShiftStatus) {
    await perform(async () => {
      await requestJson<Worker>(`${API}/api/workers/${worker.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftStatus }),
      });
      await refreshLists();
    });
  }

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <p className="eyebrow">Главный терминал</p>
          <h1>Сборка заказов 2026</h1>
          <p className="subtitle">Распределение смены и контроль каждой товарной позиции</p>
        </div>
        <div className="headerActions">
          <nav className="tabs" aria-label="Разделы терминала">
            <button
              className={section === 'orders' ? 'active' : ''}
              onClick={() => setSection('orders')}
              type="button"
            >
              Заказы
            </button>
            <button
              className={section === 'workers' ? 'active' : ''}
              onClick={() => setSection('workers')}
              type="button"
            >
              Сборщики
            </button>
          </nav>
          <label className={`upload ${busy ? 'disabled' : ''}`}>
            {busy ? 'Выполняется…' : 'Загрузить XLSX'}
            <input
              type="file"
              accept=".xlsx"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = '';
              }}
            />
          </label>
        </div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <section className="cards" aria-label="Состояние заказов">
        <Kpi label="Новые" value={stats.newOrders} tone="blue" />
        <Kpi label="В сборке" value={stats.picking} tone="amber" />
        <Kpi label="Требуют внимания" value={stats.problems} tone="red" />
        <Kpi label="Готово" value={stats.ready} tone="green" />
      </section>

      {section === 'workers' ? (
        <WorkersView
          workers={workers}
          form={workerForm}
          setForm={setWorkerForm}
          busy={busy}
          onCreate={createNewWorker}
          onShift={setShift}
        />
      ) : (
        <main>
          <section className="panel ordersPanel">
            <div className="panelTitle">
              <div>
                <p className="eyebrow">Очередь</p>
                <h2>Заказы</h2>
              </div>
              <span>{orders.length}</span>
            </div>
            <div className="orderList">
              {orders.map((order) => (
                <button
                  type="button"
                  key={order.id}
                  className={`orderRow ${selected?.id === order.id ? 'active' : ''}`}
                  onClick={() => void openOrder(order.id)}
                >
                  <span className="orderNumber">№{order.documentNumber}</span>
                  <span>{new Date(order.documentDate).toLocaleDateString('ru-RU')}</span>
                  <span className="warehouse">{order.warehouse}</span>
                  <span className="miniProgress">{order.progress.percent}%</span>
                  <Status value={order.status} />
                </button>
              ))}
              {!orders.length && <div className="empty compact">Загрузите первый товарный чек XLSX</div>}
            </div>
          </section>

          <section className="panel detail">
            {selected ? (
              <>
                <div className="detailHead">
                  <div>
                    <p className="eyebrow">Карточка заказа</p>
                    <h2>Заказ №{selected.documentNumber}</h2>
                    <p>
                      {selected.warehouse} · {new Date(selected.documentDate).toLocaleDateString('ru-RU')} ·{' '}
                      {selected.items.length} позиций
                    </p>
                  </div>
                  <Status value={selected.status} />
                </div>

                <ProgressBar progress={selected.progress} />

                {selected.status !== 'COMPLETED' && selected.status !== 'CLOSED' && (
                  <section className="assignmentBox">
                    <div>
                      <p className="eyebrow">Распределение</p>
                      <strong>Выберите активную смену</strong>
                    </div>
                    <div className="workerChecks">
                      {selectableWorkers.map((worker) => (
                        <label key={worker.id}>
                          <input
                            type="checkbox"
                            checked={selectedWorkers.includes(worker.id)}
                            onChange={() =>
                              setSelectedWorkers((current) =>
                                current.includes(worker.id)
                                  ? current.filter((id) => id !== worker.id)
                                  : [...current, worker.id],
                              )
                            }
                          />
                          <span>{worker.name}</span>
                        </label>
                      ))}
                      {!selectableWorkers.length && (
                        <small>Нет доступных сборщиков. Откройте раздел «Сборщики».</small>
                      )}
                    </div>
                    <button
                      className="primary"
                      type="button"
                      disabled={busy || !selectedWorkers.length}
                      onClick={() => void assign()}
                    >
                      {selected.items.some((item) => item.assignedWorkerId)
                        ? 'Перераспределить'
                        : 'Распределить'}
                    </button>
                  </section>
                )}

                {attention.length > 0 && (
                  <section className="attentionBox">
                    <p className="eyebrow">Требует внимания</p>
                    <strong>{attention.length} проблемных позиций</strong>
                    <span>
                      {attention
                        .slice(0, 3)
                        .map((item) => item.name)
                        .join(' · ')}
                    </span>
                  </section>
                )}

                <div className="items">
                  {groups.map(([groupKey, items]) => (
                    <section className="itemGroup" key={groupKey}>
                      <div className="groupHead">
                        <h3>{groupKey}</h3>
                        <span>{items.length}</span>
                      </div>
                      {items.map((item) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          busy={busy}
                          onStatus={changeStatus}
                          onUndo={undo}
                        />
                      ))}
                    </section>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty">Выберите заказ слева или загрузите новый XLSX</div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}

function WorkersView({
  workers,
  form,
  setForm,
  busy,
  onCreate,
  onShift,
}: {
  workers: Worker[];
  form: { name: string; login: string; password: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; login: string; password: string }>>;
  busy: boolean;
  onCreate: (event: React.FormEvent) => Promise<void>;
  onShift: (worker: Worker, shiftStatus: ShiftStatus) => Promise<void>;
}) {
  return (
    <section className="workersLayout">
      <div className="panel workerRoster">
        <div className="panelTitle">
          <div>
            <p className="eyebrow">Команда сегодня</p>
            <h2>Сборщики</h2>
          </div>
          <span>{workers.length}</span>
        </div>
        <div className="workerGrid">
          {workers.map((worker) => (
            <article className={`workerCard worker-${worker.shiftStatus.toLowerCase()}`} key={worker.id}>
              <div className="avatar">{worker.name.slice(0, 1).toUpperCase()}</div>
              <div className="workerInfo">
                <strong>{worker.name}</strong>
                <span>@{worker.login}</span>
                <small>{worker._count.assignedItems} назначений всего</small>
              </div>
              <WorkerStatus value={worker.shiftStatus} />
              <div className="shiftActions">
                {worker.shiftStatus === 'OFF_SHIFT' ? (
                  <button
                    type="button"
                    disabled={busy || !worker.isActive}
                    onClick={() => void onShift(worker, 'AVAILABLE')}
                  >
                    Открыть смену
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy || worker.shiftStatus === 'BUSY'}
                    onClick={() => void onShift(worker, 'OFF_SHIFT')}
                  >
                    Закрыть смену
                  </button>
                )}
              </div>
            </article>
          ))}
          {!workers.length && <div className="empty compact">Добавьте первого сборщика</div>}
        </div>
      </div>

      <form className="panel workerForm" onSubmit={(event) => void onCreate(event)}>
        <p className="eyebrow">Новый участник</p>
        <h2>Добавить сборщика</h2>
        <p>Пароль сразу преобразуется в scrypt-хэш и никогда не возвращается из API.</p>
        <label>
          Имя
          <input
            required
            minLength={2}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label>
          Логин
          <input
            required
            minLength={3}
            value={form.login}
            onChange={(event) => setForm({ ...form, login: event.target.value })}
          />
        </label>
        <label>
          Временный пароль
          <input
            required
            minLength={8}
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
          />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          Создать и открыть смену
        </button>
      </form>
    </section>
  );
}

function ItemRow({
  item,
  busy,
  onStatus,
  onUndo,
}: {
  item: Item;
  busy: boolean;
  onStatus: (item: Item, status: Exclude<ItemStatus, 'PENDING' | 'ASSIGNED'>) => Promise<void>;
  onUndo: (item: Item) => Promise<void>;
}) {
  return (
    <div className={`item item-${item.status.toLowerCase()}`}>
      <div className="sourceLine">{item.sourceLine}</div>
      <div className="name">
        <b>{item.name}</b>
        <small>Штрихкод: {item.barcode || 'не указан'}</small>
        <small className="assignee">
          {item.assignedWorker ? `Сборщик: ${item.assignedWorker.name}` : 'Не назначено'}
        </small>
      </div>
      <div className="sourceQuantities">
        <span>Упак. {quantity(item.packageQuantity)}</span>
        <span>Штук {quantity(item.pieceQuantity)}</span>
      </div>
      <div className={`pick ${item.pickType.toLowerCase()}`}>
        {item.pickType === 'PACKAGE' ? 'УПАК' : item.pickType === 'PIECE' ? 'ШТ' : 'ПРОВЕРИТЬ'}
        <strong>{quantity(item.pickQuantity)}</strong>
      </div>
      <ItemStatusBadge value={item.status} />
      <div className="itemActions">
        {item.status === 'ASSIGNED' && (
          <button disabled={busy} onClick={() => void onStatus(item, 'ACTIVE')} type="button">
            Начать
          </button>
        )}
        {item.status === 'ACTIVE' && (
          <>
            <button
              className="success"
              disabled={busy}
              onClick={() => void onStatus(item, 'PICKED')}
              type="button"
            >
              Взял
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => void onStatus(item, 'NOT_FOUND')}
              type="button"
            >
              Не найден
            </button>
            <button disabled={busy} onClick={() => void onStatus(item, 'SKIPPED')} type="button">
              Пропустить
            </button>
          </>
        )}
        {['ACTIVE', 'PICKED', 'NOT_FOUND', 'SKIPPED'].includes(item.status) && (
          <button className="ghost" disabled={busy} onClick={() => void onUndo(item)} type="button">
            Отменить
          </button>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ progress }: { progress: Progress }) {
  return (
    <section className="progressBlock">
      <div>
        <strong>
          {progress.completed} из {progress.total}
        </strong>
        <span>
          Собрано {progress.summary.PICKED} · Нет {progress.summary.NOT_FOUND} · Пропущено{' '}
          {progress.summary.SKIPPED}
        </span>
      </div>
      <b>{progress.percent}%</b>
      <div className="progressTrack">
        <span style={{ width: `${progress.percent}%` }} />
      </div>
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Status({ value }: { value: OrderStatus }) {
  const labels: Record<OrderStatus, string> = {
    NEW: 'Новый',
    READY: 'Готов к распределению',
    ASSIGNED: 'Распределён',
    PICKING: 'Сборка',
    REVIEW_REQUIRED: 'Требует проверки',
    COMPLETED: 'Готов',
    CLOSED: 'Закрыт',
  };
  return <span className={`status s-${value}`}>{labels[value]}</span>;
}

function WorkerStatus({ value }: { value: ShiftStatus }) {
  const labels: Record<ShiftStatus, string> = {
    OFF_SHIFT: 'Вне смены',
    AVAILABLE: 'Доступен',
    BUSY: 'Занят',
  };
  return <span className={`workerStatus ws-${value}`}>{labels[value]}</span>;
}

function ItemStatusBadge({ value }: { value: ItemStatus }) {
  const labels: Record<ItemStatus, string> = {
    PENDING: 'Ожидает',
    ASSIGNED: 'Назначено',
    ACTIVE: 'В работе',
    PICKED: 'Собрано',
    NOT_FOUND: 'Не найдено',
    SKIPPED: 'Пропущено',
  };
  return <span className={`itemStatus is-${value}`}>{labels[value]}</span>;
}

function isString(value: string | null): value is string {
  return typeof value === 'string';
}

const root = document.getElementById('root');
if (!root) throw new Error('Не найден корневой элемент приложения');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
