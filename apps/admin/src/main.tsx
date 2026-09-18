import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { API_BASE } from './apiBase';
import { type SoundName, soundLabels } from './audio/soundPlayer';
import { useVoicePickerController, type VoiceQueueSnapshot } from './picker/voicePickerController';
import { SPEECH_RATES, type SpeechRate } from './voice/speechSynthesis';
import './styles.css';

type ShiftStatus = 'OFF_SHIFT' | 'AVAILABLE' | 'BUSY';
type ItemStatus = 'PENDING' | 'ASSIGNED' | 'ACTIVE' | 'PICKED' | 'NOT_FOUND' | 'SKIPPED';
type OrderStatus = 'NEW' | 'READY' | 'ASSIGNED' | 'PICKING' | 'REVIEW_REQUIRED' | 'COMPLETED' | 'CLOSED';
type ProblemResolution = 'CONFIRMED' | 'RESOLVED' | null;

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
  startedAt?: string | null;
  completedAt?: string | null;
  closedAt?: string | null;
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
  problemResolution: ProblemResolution;
  reviewComment: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  pickedAt?: string | null;
};

type Order = OrderListItem & { items: Item[] };
type Problem = Item & {
  order: Pick<OrderListItem, 'id' | 'documentNumber' | 'documentDate' | 'warehouse' | 'status'>;
};
type OrderEvent = {
  id: string;
  type: string;
  serverAt: string;
  metadata: Record<string, unknown> | null;
  worker: Pick<Worker, 'id' | 'name'> | null;
  item: Pick<Item, 'id' | 'name' | 'sourceLine'> | null;
};
type ImportResponse = { duplicate: boolean; order: Order; warnings?: string[] };
type ImportStatus = 'SUCCESS' | 'DUPLICATE' | 'FAILED';
type ImportAttempt = {
  id: string;
  filename: string;
  status: ImportStatus;
  orderId: string | null;
  documentNumber: string | null;
  documentDate?: string | null;
  warehouse?: string | null;
  itemCount: number | null;
  warnings?: unknown;
  errorMessage: string | null;
  createdAt: string;
};
type Dashboard = {
  generatedAt: string;
  orders: { new: number; inProgress: number; ready: number };
  items: { problems: number };
  workers: Record<ShiftStatus, number>;
  imports: { failed24h: number; recent: ImportAttempt[] };
  recentOrders: Array<{
    id: string;
    documentNumber: string;
    documentDate: string;
    warehouse: string;
    status: OrderStatus;
    createdAt: string;
    itemCount: number;
    completedCount: number;
  }>;
  attention: {
    problems: Array<{
      id: string;
      name: string;
      status: ItemStatus;
      pickType: Item['pickType'];
      updatedAt: string;
      order: { id: string; documentNumber: string };
    }>;
  };
};
type AnalyticsDays = 7 | 30 | 90;
type Analytics = {
  generatedAt: string;
  period: { days: AnalyticsDays; from: string; to: string };
  summary: {
    ordersCreated: number;
    ordersCompleted: number;
    ordersClosed: number;
    handled: number;
    picked: number;
    notFound: number;
    skipped: number;
    successRate: number;
    averageCycleMinutes: number | null;
  };
  daily: Array<{
    date: string;
    ordersCreated: number;
    ordersCompleted: number;
    picked: number;
    problems: number;
  }>;
  workers: Array<{
    id: string;
    name: string;
    handled: number;
    picked: number;
    notFound: number;
    skipped: number;
    successRate: number;
  }>;
};
type PublicSettings = {
  service: string;
  version: string;
  database: string;
  acceptedFormats: string[];
  maxUploadMb: number;
  duplicateProtection: string[];
  terminalUrl: string;
  serverTime: string;
};
type PickerWorker = Pick<Worker, 'id' | 'login' | 'name' | 'isActive' | 'shiftStatus'>;
type PickerItem = Omit<
  Item,
  'assignedWorkerId' | 'assignedWorker' | 'problemResolution' | 'reviewComment' | 'reviewedBy' | 'reviewedAt'
> & {
  orderId: string;
  sortIndex: number;
  assignedAt: string | null;
  order: Pick<OrderListItem, 'id' | 'documentNumber' | 'documentDate' | 'status'>;
};
type PickerQueue = {
  worker: PickerWorker;
  summary: { total: number; active: number; waiting: number };
  items: PickerItem[];
  lastCompleted: (PickerItem & { eventType: string; completedAt: string }) | null;
};
type PickerLogin = { token: string; expiresAt: string; worker: PickerWorker };
type PickerSpeechSettings = { yandexEnabled: boolean; voice: string };
type AdminSessionResponse = { admin: { username: string }; expiresAt: string };
type Section =
  | 'dashboard'
  | 'orders'
  | 'workers'
  | 'picker'
  | 'problems'
  | 'history'
  | 'analytics'
  | 'settings';

const API = API_BASE;
const soundNames = Object.keys(soundLabels) as SoundName[];
const ADMIN_UNAUTHORIZED_EVENT = 'assembly-admin-unauthorized';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: 'include' });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    const pathname = new URL(url, window.location.origin).pathname;
    const isExpectedLoginCheck = pathname === '/api/admin/login' || pathname === '/api/admin/me';
    if (response.status === 401 && !pathname.startsWith('/api/picker/') && !isExpectedLoginCheck) {
      window.dispatchEvent(new Event(ADMIN_UNAUTHORIZED_EVENT));
    }
    throw new Error(data.error ?? `Ошибка HTTP ${response.status}`);
  }
  return data;
}

function quantity(value: string | number | null): string {
  return value == null || Number(value) === 0 ? '—' : String(Number(value));
}

function App() {
  const [admin, setAdmin] = useState<{ username: string } | null>(null);
  const [adminChecked, setAdminChecked] = useState(false);
  const [adminCredentials, setAdminCredentials] = useState({ username: 'admin', password: '' });
  const [adminLoginError, setAdminLoginError] = useState('');
  const [adminLoginBusy, setAdminLoginBusy] = useState(false);
  const [section, setSection] = useState<Section>('dashboard');
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [history, setHistory] = useState<OrderListItem[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsDays, setAnalyticsDays] = useState<AnalyticsDays>(30);
  const [imports, setImports] = useState<ImportAttempt[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [workerForm, setWorkerForm] = useState({ name: '', login: '', password: '' });

  useEffect(() => {
    const handleUnauthorized = () => {
      setAdmin(null);
      setNotice('');
      setAdminLoginError('Сессия завершена. Войдите снова.');
    };
    window.addEventListener(ADMIN_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(ADMIN_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  useEffect(() => {
    void requestJson<AdminSessionResponse>(`${API}/api/admin/me`)
      .then((session) => setAdmin(session.admin))
      .catch(() => setAdmin(null))
      .finally(() => setAdminChecked(true));
  }, []);

  async function refreshLists() {
    const [
      nextOrders,
      nextWorkers,
      nextProblems,
      nextHistory,
      nextDashboard,
      nextAnalytics,
      nextImports,
      nextSettings,
    ] = await Promise.all([
      requestJson<OrderListItem[]>(`${API}/api/orders`),
      requestJson<Worker[]>(`${API}/api/workers`),
      requestJson<Problem[]>(`${API}/api/problems`),
      requestJson<OrderListItem[]>(`${API}/api/orders/history`),
      requestJson<Dashboard>(`${API}/api/dashboard`),
      requestJson<Analytics>(`${API}/api/analytics?days=${analyticsDays}`),
      requestJson<ImportAttempt[]>(`${API}/api/imports?limit=30`),
      requestJson<PublicSettings>(`${API}/api/settings`),
    ]);
    setOrders(nextOrders);
    setWorkers(nextWorkers);
    setProblems(nextProblems);
    setHistory(nextHistory);
    setDashboard(nextDashboard);
    setAnalytics(nextAnalytics);
    setImports(nextImports);
    setSettings(nextSettings);
    return { nextOrders, nextWorkers, nextProblems, nextHistory, nextDashboard };
  }

  useEffect(() => {
    if (!admin) return;
    Promise.all([
      requestJson<OrderListItem[]>(`${API}/api/orders`),
      requestJson<Worker[]>(`${API}/api/workers`),
      requestJson<Problem[]>(`${API}/api/problems`),
      requestJson<OrderListItem[]>(`${API}/api/orders/history`),
      requestJson<Dashboard>(`${API}/api/dashboard`),
      requestJson<Analytics>(`${API}/api/analytics?days=30`),
      requestJson<ImportAttempt[]>(`${API}/api/imports?limit=30`),
      requestJson<PublicSettings>(`${API}/api/settings`),
    ])
      .then(
        ([
          nextOrders,
          nextWorkers,
          nextProblems,
          nextHistory,
          nextDashboard,
          nextAnalytics,
          nextImports,
          nextSettings,
        ]) => {
          setOrders(nextOrders);
          setWorkers(nextWorkers);
          setProblems(nextProblems);
          setHistory(nextHistory);
          setDashboard(nextDashboard);
          setAnalytics(nextAnalytics);
          setImports(nextImports);
          setSettings(nextSettings);
          const orderId = new URLSearchParams(window.location.search).get('order');
          if (!orderId) return undefined;
          return Promise.all([
            requestJson<Order>(`${API}/api/orders/${orderId}`),
            requestJson<OrderEvent[]>(`${API}/api/orders/${orderId}/events`),
          ]).then(([order, orderEvents]) => {
            setSelected(order);
            setEvents(orderEvents);
            setSelectedWorkers([
              ...new Set(order.items.map((item) => item.assignedWorkerId).filter(isString)),
            ]);
            setSection('orders');
          });
        },
      )
      .catch((error) => setNotice(error instanceof Error ? error.message : 'API недоступен'));
  }, [admin]);

  const stats = useMemo(
    () => ({
      newOrders: dashboard?.orders.new ?? orders.filter((order) => order.status === 'NEW').length,
      picking:
        dashboard?.orders.inProgress ??
        orders.filter((order) => ['ASSIGNED', 'PICKING'].includes(order.status)).length,
      problems: dashboard?.items.problems ?? problems.length,
      ready: dashboard?.orders.ready ?? orders.filter((order) => order.status === 'COMPLETED').length,
    }),
    [dashboard, orders, problems],
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
        (item) =>
          ((item.status === 'NOT_FOUND' || item.status === 'SKIPPED') &&
            item.problemResolution !== 'CONFIRMED') ||
          item.pickType === 'REVIEW',
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
      try {
        await refreshLists();
      } catch {
        // Сохраняем исходную ошибку операции, если API полностью недоступен.
      }
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

  async function changeAnalyticsPeriod(days: AnalyticsDays) {
    await perform(async () => {
      const nextAnalytics = await requestJson<Analytics>(`${API}/api/analytics?days=${days}`);
      setAnalyticsDays(days);
      setAnalytics(nextAnalytics);
    });
  }

  async function openOrder(id: string) {
    await perform(async () => {
      const [order, orderEvents] = await Promise.all([
        requestJson<Order>(`${API}/api/orders/${id}`),
        requestJson<OrderEvent[]>(`${API}/api/orders/${id}/events`),
      ]);
      setSelected(order);
      setEvents(orderEvents);
      setSelectedWorkers([...new Set(order.items.map((item) => item.assignedWorkerId).filter(isString))]);
      setSection('orders');
    });
  }

  async function reviewPickType(item: Item, pickType: 'PACKAGE' | 'PIECE') {
    const rawQuantity = window.prompt('Количество для отбора', String(Number(item.pickQuantity) || 1));
    if (rawQuantity == null) return;
    const comment = window.prompt('Комментарий проверяющего');
    if (!comment) return;
    await perform(async () => {
      const order = await requestJson<Order>(`${API}/api/order-items/${item.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickType,
          pickQuantity: Number(rawQuantity),
          comment,
          reviewedBy: 'Главный терминал',
        }),
      });
      setSelected(order);
      await refreshLists();
    });
  }

  async function resolveItemProblem(item: Item, action: 'CONFIRM' | 'RETURN_TO_WORK') {
    const comment = window.prompt(
      action === 'CONFIRM' ? 'Комментарий к подтверждению' : 'Причина возврата в работу',
    );
    if (!comment) return;
    const currentWorker = workers.find(
      (worker) =>
        worker.id === item.assignedWorkerId && worker.isActive && worker.shiftStatus !== 'OFF_SHIFT',
    );
    const workerId =
      action === 'RETURN_TO_WORK'
        ? (currentWorker?.id ?? workers.find((worker) => worker.shiftStatus === 'AVAILABLE')?.id)
        : undefined;
    if (action === 'RETURN_TO_WORK' && !workerId) {
      setNotice('Нет доступного сборщика для возврата позиции.');
      return;
    }
    await perform(async () => {
      const order = await requestJson<Order>(`${API}/api/order-items/${item.id}/resolve-problem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment, reviewedBy: 'Главный терминал', workerId }),
      });
      setSelected(order);
      await refreshLists();
    });
  }

  async function closeSelectedOrder() {
    if (!selected) return;
    await perform(async () => {
      const order = await requestJson<Order>(`${API}/api/orders/${selected.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewedBy: 'Главный терминал', comment: 'Проверка завершена' }),
      });
      setSelected(order);
      const orderEvents = await requestJson<OrderEvent[]>(`${API}/api/orders/${selected.id}/events`);
      setEvents(orderEvents);
      await refreshLists();
      setNotice(`Заказ №${order.documentNumber} закрыт.`);
    });
  }

  async function downloadReport(kind: 'short' | 'full') {
    if (!selected) return;
    await perform(async () => {
      const response = await fetch(`${API}/api/orders/${selected.id}/reports/${kind}.pdf`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        if (response.status === 401) window.dispatchEvent(new Event(ADMIN_UNAUTHORIZED_EVENT));
        throw new Error(data?.error ?? `Ошибка HTTP ${response.status}`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `assembly-${selected.documentNumber}-${kind}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
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

  async function loginAdmin(event: React.FormEvent) {
    event.preventDefault();
    setAdminLoginBusy(true);
    setAdminLoginError('');
    try {
      const session = await requestJson<AdminSessionResponse>(`${API}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adminCredentials),
      });
      setAdmin(session.admin);
      setAdminCredentials((current) => ({ ...current, password: '' }));
    } catch (error) {
      setAdminLoginError(error instanceof Error ? error.message : 'Не удалось войти');
    } finally {
      setAdminChecked(true);
      setAdminLoginBusy(false);
    }
  }

  async function logoutAdmin() {
    setBusy(true);
    try {
      await requestJson<{ ok: true }>(`${API}/api/admin/logout`, { method: 'POST' });
    } catch {
      // Локально закрываем терминал даже при недоступном сервере.
    } finally {
      setAdmin(null);
      setSelected(null);
      setOrders([]);
      setNotice('');
      setBusy(false);
    }
  }

  if (!adminChecked) return <AdminSessionLoading />;

  if (!admin) {
    return (
      <AdminLoginScreen
        credentials={adminCredentials}
        setCredentials={setAdminCredentials}
        busy={adminLoginBusy}
        error={adminLoginError}
        onSubmit={loginAdmin}
      />
    );
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
              className={section === 'dashboard' ? 'active' : ''}
              onClick={() => setSection('dashboard')}
              type="button"
            >
              Главная
            </button>
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
            <button
              className={section === 'picker' ? 'active' : ''}
              onClick={() => setSection('picker')}
              type="button"
            >
              Сборка
            </button>
            <button
              className={section === 'problems' ? 'active' : ''}
              onClick={() => setSection('problems')}
              type="button"
            >
              Проблемы
            </button>
            <button
              className={section === 'history' ? 'active' : ''}
              onClick={() => setSection('history')}
              type="button"
            >
              История
            </button>
            <button
              className={section === 'analytics' ? 'active' : ''}
              onClick={() => setSection('analytics')}
              type="button"
            >
              Аналитика
            </button>
            <button
              className={section === 'settings' ? 'active' : ''}
              onClick={() => setSection('settings')}
              type="button"
            >
              Настройки
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
          <div className="adminSession">
            <span>{admin.username}</span>
            <button className="logoutButton" type="button" disabled={busy} onClick={() => void logoutAdmin()}>
              Выйти
            </button>
          </div>
        </div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <section className="cards" aria-label="Состояние заказов">
        <Kpi label="Новые" value={stats.newOrders} tone="blue" />
        <Kpi label="В сборке" value={stats.picking} tone="amber" />
        <Kpi label="Требуют внимания" value={stats.problems} tone="red" />
        <Kpi label="Готово" value={stats.ready} tone="green" />
      </section>

      {section === 'dashboard' && dashboard && (
        <DashboardView dashboard={dashboard} onOpen={openOrder} onSection={setSection} />
      )}

      {section === 'dashboard' && !dashboard && <div className="empty">Загрузка сводки терминала…</div>}

      {section === 'workers' && (
        <WorkersView
          workers={workers}
          form={workerForm}
          setForm={setWorkerForm}
          busy={busy}
          onCreate={createNewWorker}
          onShift={setShift}
        />
      )}

      {section === 'picker' && <PickerView />}

      {section === 'problems' && (
        <ProblemsView
          problems={problems}
          busy={busy}
          onOpen={openOrder}
          onReview={reviewPickType}
          onResolve={resolveItemProblem}
        />
      )}

      {section === 'history' && <HistoryView orders={history} onOpen={openOrder} />}

      {section === 'analytics' && (
        <AnalyticsView
          analytics={analytics}
          days={analyticsDays}
          busy={busy}
          onDays={changeAnalyticsPeriod}
        />
      )}

      {section === 'settings' && (
        <SettingsView settings={settings} imports={imports} apiUrl={API} onOpen={openOrder} />
      )}

      {section === 'orders' && (
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

                {['COMPLETED', 'REVIEW_REQUIRED', 'CLOSED'].includes(selected.status) && (
                  <section className="completionBar">
                    <div>
                      <p className="eyebrow">Итоговые документы</p>
                      <strong>{selected.status === 'CLOSED' ? 'Заказ закрыт' : 'Сборка завершена'}</strong>
                    </div>
                    <button
                      className="reportButton"
                      type="button"
                      onClick={() => void downloadReport('short')}
                    >
                      Короткий PDF
                    </button>
                    <button
                      className="reportButton"
                      type="button"
                      onClick={() => void downloadReport('full')}
                    >
                      Полный PDF
                    </button>
                    {selected.status !== 'CLOSED' && (
                      <button
                        className="primary"
                        disabled={busy || attention.length > 0}
                        onClick={() => void closeSelectedOrder()}
                        type="button"
                      >
                        Закрыть заказ
                      </button>
                    )}
                    {selected.status !== 'CLOSED' && attention.length > 0 && (
                      <small>Для закрытия решите {attention.length} проблемных позиций.</small>
                    )}
                  </section>
                )}

                {selected.status !== 'COMPLETED' &&
                  selected.status !== 'CLOSED' &&
                  selected.progress.completed < selected.progress.total && (
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
                          busy={busy || selected.status === 'CLOSED'}
                          onStatus={changeStatus}
                          onUndo={undo}
                          onReview={reviewPickType}
                          onResolve={resolveItemProblem}
                        />
                      ))}
                    </section>
                  ))}
                </div>

                <EventTimeline events={events} />
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

function AdminSessionLoading() {
  return (
    <main className="adminLoginShell" aria-live="polite">
      <div className="adminLoginCard loading">
        <p className="eyebrow">Защищённый терминал</p>
        <h1>Проверяем сессию</h1>
        <p>Подключаем главный терминал к серверу…</p>
      </div>
    </main>
  );
}

function AdminLoginScreen({
  credentials,
  setCredentials,
  busy,
  error,
  onSubmit,
}: {
  credentials: { username: string; password: string };
  setCredentials: React.Dispatch<React.SetStateAction<{ username: string; password: string }>>;
  busy: boolean;
  error: string;
  onSubmit: (event: React.FormEvent) => Promise<void>;
}) {
  return (
    <main className="adminLoginShell">
      <section className="adminLoginIntro">
        <p className="eyebrow">Сборка заказов 2026</p>
        <h1>Главный терминал под защитой</h1>
        <p>Заказы, отчёты и управление сменой доступны только администратору.</p>
        <div className="adminLoginMark" aria-hidden="true">
          2026
        </div>
      </section>
      <form className="adminLoginCard" onSubmit={(event) => void onSubmit(event)}>
        <div>
          <p className="eyebrow">Авторизация</p>
          <h2>Вход администратора</h2>
          <p>Используйте учётные данные из защищённых переменных сервера.</p>
        </div>
        <label>
          Логин
          <input
            autoComplete="username"
            value={credentials.username}
            onChange={(event) => setCredentials((current) => ({ ...current, username: event.target.value }))}
            required
          />
        </label>
        <label>
          Пароль
          <input
            autoComplete="current-password"
            type="password"
            value={credentials.password}
            onChange={(event) => setCredentials((current) => ({ ...current, password: event.target.value }))}
            required
          />
        </label>
        {error && <div className="adminLoginError">{error}</div>}
        <button className="primary" disabled={busy} type="submit">
          {busy ? 'Проверяем…' : 'Открыть терминал'}
        </button>
        <small className="adminLoginNote">Сессия хранится только в защищённой HttpOnly cookie.</small>
      </form>
    </main>
  );
}

function PickerView() {
  const [token, setToken] = useState(() => sessionStorage.getItem('pickerToken') ?? '');
  const [queue, setQueue] = useState<PickerQueue | null>(null);
  const [credentials, setCredentials] = useState({ login: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sessionTotal, setSessionTotal] = useState(0);
  const [speechSettings, setSpeechSettings] = useState<PickerSpeechSettings | null>(null);

  async function pickerRequest<T>(path: string, init?: RequestInit) {
    return requestJson<T>(`${API}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  }

  async function refreshQueue() {
    if (!token) return null;
    const nextQueue = await pickerRequest<PickerQueue>('/api/picker/queue');
    setQueue(nextQueue);
    setSessionTotal((currentTotal) => Math.max(currentTotal, nextQueue.summary.total));
    return nextQueue;
  }

  async function requestYandexSpeech(text: string) {
    const response = await fetch(`${API}/api/picker/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? `Ошибка HTTP ${response.status}`);
    }
    return response.blob();
  }

  function queueAfterConfirmedStatus(
    item: PickerItem,
    status: 'ACTIVE' | 'PICKED' | 'NOT_FOUND' | 'SKIPPED',
  ): PickerQueue | null {
    if (!queue) return null;
    const completed = status === 'PICKED' || status === 'NOT_FOUND' || status === 'SKIPPED';
    const items = completed
      ? queue.items.filter((entry) => entry.id !== item.id)
      : queue.items.map((entry) => (entry.id === item.id ? { ...entry, status } : entry));
    const active = items.filter((entry) => entry.status === 'ACTIVE').length;
    return {
      ...queue,
      items,
      summary: { total: items.length, active, waiting: items.length - active },
      lastCompleted: completed
        ? {
            ...item,
            status,
            eventType: {
              PICKED: 'ITEM_PICKED',
              NOT_FOUND: 'ITEM_NOT_FOUND',
              SKIPPED: 'ITEM_SKIPPED',
            }[status],
            completedAt: new Date().toISOString(),
          }
        : queue.lastCompleted,
    };
  }

  function queueAfterConfirmedUndo(): PickerQueue | null {
    if (!queue?.lastCompleted) return null;
    const restored: PickerItem = { ...queue.lastCompleted, status: 'ACTIVE', pickedAt: null };
    const items = [...queue.items, restored].sort((left, right) => left.sortIndex - right.sortIndex);
    const active = items.filter((entry) => entry.status === 'ACTIVE').length;
    return {
      ...queue,
      items,
      summary: { total: items.length, active, waiting: items.length - active },
      lastCompleted: null,
    };
  }

  useEffect(() => {
    if (!token) {
      setQueue(null);
      setSpeechSettings(null);
      return;
    }
    void requestJson<PickerQueue>(`${API}/api/picker/queue`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((nextQueue) => {
        setQueue(nextQueue);
        setSessionTotal(nextQueue.summary.total);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Не удалось открыть очередь');
        if (error instanceof Error && error.message.toLowerCase().includes('сесси')) {
          sessionStorage.removeItem('pickerToken');
          setToken('');
        }
      });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void requestJson<PickerSpeechSettings>(`${API}/api/picker/speech/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(setSpeechSettings)
      .catch(() => setSpeechSettings({ yandexEnabled: false, voice: 'alena' }));
  }, [token]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = await requestJson<PickerLogin>(`${API}/api/picker/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      sessionStorage.setItem('pickerToken', result.token);
      setToken(result.token);
      setCredentials({ login: '', password: '' });
      setMessage(`Смена открыта: ${result.worker.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await pickerRequest('/api/picker/logout', { method: 'POST' });
    } catch {
      // Локальный выход должен сработать даже при недоступном сервере.
    } finally {
      sessionStorage.removeItem('pickerToken');
      setToken('');
      setQueue(null);
      setSpeechSettings(null);
      setSessionTotal(0);
      setMessage('');
      setBusy(false);
    }
  }

  async function setItemStatus(
    item: PickerItem,
    status: 'ACTIVE' | 'PICKED' | 'NOT_FOUND' | 'SKIPPED',
  ): Promise<PickerQueue | null> {
    setBusy(true);
    setMessage('');
    try {
      if (item.status === 'ASSIGNED' && status !== 'ACTIVE') {
        await pickerRequest(`/api/picker/items/${item.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'ACTIVE', deviceAt: new Date().toISOString() }),
        });
      }
      await pickerRequest(`/api/picker/items/${item.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, deviceAt: new Date().toISOString() }),
      });
      const nextQueue = await refreshQueue().catch(() => {
        const confirmedQueue = queueAfterConfirmedStatus(item, status);
        if (confirmedQueue) setQueue(confirmedQueue);
        return confirmedQueue;
      });
      setMessage(status === 'ACTIVE' ? 'Позиция взята в работу' : 'Результат сохранён');
      return nextQueue;
    } catch {
      setMessage('Не удалось сохранить. Повторите команду.');
      await refreshQueue().catch(() => undefined);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function undoLast(): Promise<PickerQueue | null> {
    if (!queue?.lastCompleted) return null;
    setBusy(true);
    setMessage('');
    try {
      await pickerRequest(`/api/picker/items/${queue.lastCompleted.id}/undo`, {
        method: 'POST',
        body: JSON.stringify({ deviceAt: new Date().toISOString() }),
      });
      const nextQueue = await refreshQueue().catch(() => {
        const confirmedQueue = queueAfterConfirmedUndo();
        if (confirmedQueue) setQueue(confirmedQueue);
        return confirmedQueue;
      });
      setMessage('Последнее действие отменено');
      return nextQueue;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось отменить действие');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const current = queue?.items.find((item) => item.status === 'ACTIVE') ?? queue?.items[0] ?? null;
  const toVoiceSnapshot = (nextQueue: PickerQueue): VoiceQueueSnapshot => ({
    current: nextQueue.items.find((item) => item.status === 'ACTIVE') ?? nextQueue.items[0] ?? null,
    remaining: nextQueue.summary.total,
  });
  const voice = useVoicePickerController({
    current,
    remaining: queue?.summary.total ?? 0,
    canUndo: Boolean(queue?.lastCompleted),
    onStatus: async (voiceItem, status) => {
      const item = queue?.items.find((entry) => entry.id === voiceItem.id);
      if (!item) return null;
      const nextQueue = await setItemStatus(item, status);
      return nextQueue ? toVoiceSnapshot(nextQueue) : null;
    },
    onUndo: async () => {
      const nextQueue = await undoLast();
      return nextQueue ? toVoiceSnapshot(nextQueue) : null;
    },
    yandexSpeech: {
      enabled: speechSettings?.yandexEnabled ?? false,
      settingsLoaded: speechSettings !== null,
      requestAudio: requestYandexSpeech,
    },
  });

  useEffect(() => {
    if (!token && voice.voiceEnabled) void voice.toggleVoice(false);
  }, [token, voice.toggleVoice, voice.voiceEnabled]);

  if (!token) {
    return (
      <section className="pickerShell pickerLoginShell">
        <div className="pickerIntro">
          <p className="eyebrow">Рабочее место</p>
          <h2>Личная очередь сборщика</h2>
          <p>Войдите под своей учётной записью. Здесь будут только назначенные вам позиции.</p>
          <div className="pickerSteps">
            <span className="pickerStep">01 Войти</span>
            <span className="pickerStep">02 Собрать</span>
            <span className="pickerStep">03 Подтвердить</span>
          </div>
        </div>
        <form className="pickerLogin" onSubmit={(event) => void login(event)}>
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
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Входим…' : 'Открыть смену'}
          </button>
          {message && (
            <p className="pickerMessage" role="alert">
              {message}
            </p>
          )}
        </form>
      </section>
    );
  }

  if (!queue) return <div className="empty">Загрузка личной очереди…</div>;
  const upcoming = queue.items.filter((item) => item.id !== current?.id).slice(0, 6);
  const currentPosition = current ? Math.max(1, sessionTotal - queue.summary.total + 1) : sessionTotal;
  const reviewBlocked = current?.pickType === 'REVIEW';

  return (
    <section className="pickerShell">
      <div className="pickerTopbar">
        <div>
          <p className="eyebrow">Сборщик</p>
          <h2>{queue.worker.name}</h2>
          <span className={`shiftPill ${queue.worker.shiftStatus.toLowerCase()}`}>
            {shiftLabel(queue.worker.shiftStatus)}
          </span>
        </div>
        <div className="pickerCounter">
          <strong className="pickerCounterValue">{queue.summary.total}</strong>
          <span className="pickerCounterLabel">осталось</span>
        </div>
        <button type="button" className="ghost" disabled={busy} onClick={() => void logout()}>
          Выйти
        </button>
      </div>

      {message && (
        <div className="pickerMessage" role="status">
          {message}
        </div>
      )}

      <div className="voiceConsole">
        <div className="voiceSwitches">
          <button
            type="button"
            className={`voiceStart ${voice.voiceEnabled ? 'isOn' : ''}`}
            role="switch"
            aria-checked={voice.voiceEnabled}
            onClick={() => void voice.toggleVoice(!voice.voiceEnabled)}
          >
            <span className="switchTrack" aria-hidden="true">
              <i />
            </span>
            {voice.voiceEnabled ? 'Голос включён' : 'Начать голосовую сборку'}
          </button>
          <button
            type="button"
            className={`soundSwitch ${voice.soundsEnabled ? 'isOn' : ''}`}
            role="switch"
            aria-checked={voice.soundsEnabled}
            onClick={() => void voice.toggleSounds(!voice.soundsEnabled)}
          >
            <span className="switchTrack" aria-hidden="true">
              <i />
            </span>
            Звуки
          </button>
        </div>

        <div className={`micStatus is-${voice.micState}`} aria-live="polite">
          <span className="micPulse" aria-hidden="true" />
          <div>
            <small className="voiceMetaLabel">Микрофон</small>
            <strong className="voiceMetaValue">{voice.micLabel}</strong>
          </div>
          {voice.voiceEnabled && (
            <button
              type="button"
              onClick={() => void (voice.micState === 'paused' ? voice.resume() : voice.pause())}
            >
              {voice.micState === 'paused' ? 'Продолжить' : 'Пауза'}
            </button>
          )}
        </div>

        <div className="voiceFeedback">
          <span className="voiceMetaLabel">Последняя команда</span>
          <strong className="voiceMetaValue">{voice.lastTranscript || 'ожидается'}</strong>
        </div>

        <details className="soundTester">
          <summary>Проверить сигналы</summary>
          <div className="soundTestGrid">
            {soundNames.map((name) => (
              <button key={name} type="button" onClick={() => void voice.testSound(name)}>
                {soundLabels[name]}
              </button>
            ))}
          </div>
        </details>

        <div className="voiceSettings">
          <label>
            <span>Источник голоса</span>
            <select
              value={voice.speechSource}
              onChange={(event) => voice.setSpeechSource(event.target.value as 'system' | 'yandex')}
            >
              <option value="system">Голос телефона</option>
              <option value="yandex" disabled={!speechSettings?.yandexEnabled}>
                Alena — Yandex SpeechKit{speechSettings?.yandexEnabled ? '' : ' (недоступна)'}
              </option>
            </select>
          </label>
          <label>
            <span>Скорость речи</span>
            <select
              value={voice.speechRate}
              onChange={(event) => voice.setSpeechRate(Number(event.target.value) as SpeechRate)}
            >
              {SPEECH_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate.toFixed(rate === 1 ? 1 : 2)}×
                </option>
              ))}
            </select>
          </label>
          {voice.speechVoices.length > 1 && (
            <label>
              <span>Русский голос</span>
              <select
                value={voice.speechVoice}
                onChange={(event) => voice.setSpeechVoice(event.target.value)}
              >
                <option value="">Автоматически</option>
                {voice.speechVoices.map((speechVoice) => (
                  <option key={speechVoice.voiceURI} value={speechVoice.voiceURI}>
                    {speechVoice.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className={`shortNamesSwitch ${voice.shortNames ? 'isOn' : ''}`}
            role="switch"
            aria-checked={voice.shortNames}
            onClick={() => voice.setShortNames(!voice.shortNames)}
          >
            <span className="switchTrack" aria-hidden="true">
              <i />
            </span>
            Короткие названия
          </button>
        </div>
      </div>

      {!voice.recognitionSupported && (
        <div className="voiceNotice" role="status">
          В этом браузере нет Web Speech API. Голосовые команды недоступны, но большие кнопки работают.
        </div>
      )}
      {voice.voiceError && (
        <div className="voiceNotice isError" role="alert">
          {voice.voiceError}
        </div>
      )}
      {voice.speechNotice && (
        <div className="voiceNotice" role="status">
          {voice.speechNotice}
        </div>
      )}

      {current ? (
        <div className="pickerWorkspace">
          <article className="pickerCurrent">
            <div className="pickerOrderLine">
              <span>Заказ №{current.order.documentNumber}</span>
              <span>{current.groupKey}</span>
            </div>
            <div className="pickerProgressLine">
              <strong className="pickerProgressValue">
                {currentPosition} из {sessionTotal || queue.summary.total}
              </strong>
              <span className="pickerProgressRemaining">осталось {queue.summary.total}</span>
            </div>
            {current.pickType === 'PIECE' && <div className="pieceBanner">Штучный товар</div>}
            {reviewBlocked && <div className="reviewBanner">Требуется решение администратора</div>}
            <h3>{current.name}</h3>
            <div className={`pickerHeroQuantity is-${current.pickType.toLowerCase()}`}>
              <strong className="pickerQuantityValue">{quantity(current.pickQuantity)}</strong>
              <span className="pickerQuantityUnit">
                {current.pickType === 'PACKAGE' ? 'упаковок' : 'штук'}
              </span>
            </div>
            <div className="pickerFacts">
              <div>
                <span className="pickerFactLabel">Штрихкод</span>
                <strong className="pickerFactValue">{current.barcode || 'нет'}</strong>
              </div>
              <div>
                <span className="pickerFactLabel">
                  {current.pickType === 'PACKAGE' ? 'Упаковок' : 'Штук'}
                </span>
                <strong className="pickerFactValue">{quantity(current.pickQuantity)}</strong>
              </div>
              <div>
                <span className="pickerFactLabel">Тип</span>
                <strong className="pickerFactValue">
                  {current.pickType === 'PACKAGE'
                    ? 'УПАК'
                    : current.pickType === 'PIECE'
                      ? 'ШТ'
                      : 'ПРОВЕРИТЬ'}
                </strong>
              </div>
            </div>
            <div className="pickerActions voiceActions">
              <button
                className="picked"
                type="button"
                disabled={busy || reviewBlocked}
                onClick={() => void voice.performStatus('PICKED')}
              >
                Взял
              </button>
              <button className="repeat" type="button" disabled={busy} onClick={() => void voice.repeat()}>
                Повторить
              </button>
              <button
                className="missing"
                type="button"
                disabled={busy || reviewBlocked}
                onClick={() => void voice.performStatus('NOT_FOUND')}
              >
                Не нашёл
              </button>
              <button
                className="skipped"
                type="button"
                disabled={busy || reviewBlocked}
                onClick={() => void voice.performStatus('SKIPPED')}
              >
                Пропустить
              </button>
              <button
                className="undoAction"
                type="button"
                disabled={busy || !queue.lastCompleted}
                onClick={() => void voice.undo()}
              >
                Отменить
              </button>
            </div>
          </article>

          <aside className="pickerQueuePanel">
            <p className="eyebrow">Дальше</p>
            <h3>Ближайшие позиции</h3>
            <div className="pickerQueueList">
              {upcoming.map((item) => (
                <div key={item.id}>
                  <span className="pickerQueueNumber">{item.sortIndex + 1}</span>
                  <p>
                    {item.name}
                    <small className="pickerQueueMeta">
                      №{item.order.documentNumber} · {item.groupKey}
                    </small>
                  </p>
                  <strong className="pickerQueueQuantity">
                    {quantity(item.pickQuantity)} {item.pickType === 'PACKAGE' ? 'уп.' : 'шт.'}
                  </strong>
                </div>
              ))}
              {!upcoming.length && <p className="empty compact">Это последняя позиция в очереди</p>}
            </div>
          </aside>
        </div>
      ) : (
        <div className="pickerComplete">
          <span className="pickerCompleteMark">✓</span>
          <h2>Очередь собрана</h2>
          <p>Новых назначенных позиций сейчас нет.</p>
        </div>
      )}

      {queue.lastCompleted && (
        <button type="button" className="pickerUndo" disabled={busy} onClick={() => void voice.undo()}>
          Отменить последнее: {queue.lastCompleted.name}
        </button>
      )}
    </section>
  );
}

function DashboardView({
  dashboard,
  onOpen,
  onSection,
}: {
  dashboard: Dashboard;
  onOpen: (id: string) => Promise<void>;
  onSection: (section: Section) => void;
}) {
  const failedImports = dashboard.imports.recent.filter((item) => item.status === 'FAILED');
  return (
    <section className="dashboardGrid">
      <div className="panel dashboardOrders">
        <div className="panelTitle">
          <div>
            <p className="eyebrow">Сегодня в работе</p>
            <h2>Текущие заказы</h2>
          </div>
          <button className="textButton" onClick={() => onSection('orders')} type="button">
            Все заказы
          </button>
        </div>
        <div className="dashboardOrderList">
          {dashboard.recentOrders.map((order) => {
            const percent = order.itemCount ? Math.round((order.completedCount / order.itemCount) * 100) : 0;
            return (
              <button key={order.id} type="button" onClick={() => void onOpen(order.id)}>
                <span>
                  <strong>№{order.documentNumber}</strong>
                  <small>{order.warehouse}</small>
                </span>
                <span className="dashboardProgress">
                  <i style={{ width: `${percent}%` }} />
                </span>
                <b>{percent}%</b>
                <Status value={order.status} />
              </button>
            );
          })}
          {!dashboard.recentOrders.length && <div className="empty compact">Нет открытых заказов</div>}
        </div>
      </div>

      <div className="dashboardSide">
        <section className="panel shiftPanel">
          <div className="panelTitle">
            <div>
              <p className="eyebrow">Смена</p>
              <h2>Сборщики</h2>
            </div>
            <button className="textButton" onClick={() => onSection('workers')} type="button">
              Управление
            </button>
          </div>
          <div className="shiftNumbers">
            <div>
              <strong>{dashboard.workers.AVAILABLE}</strong>
              <span>доступны</span>
            </div>
            <div>
              <strong>{dashboard.workers.BUSY}</strong>
              <span>заняты</span>
            </div>
            <div>
              <strong>{dashboard.workers.OFF_SHIFT}</strong>
              <span>вне смены</span>
            </div>
          </div>
        </section>

        <section className="panel focusPanel">
          <div className="panelTitle">
            <div>
              <p className="eyebrow">Контроль</p>
              <h2>Требует внимания</h2>
            </div>
            <span>{dashboard.items.problems + dashboard.imports.failed24h}</span>
          </div>
          <div className="focusList">
            {dashboard.attention.problems.map((problem) => (
              <button key={problem.id} type="button" onClick={() => void onOpen(problem.order.id)}>
                <span className="focusMark">Позиция</span>
                <strong>{problem.name}</strong>
                <small>Заказ №{problem.order.documentNumber}</small>
              </button>
            ))}
            {failedImports.map((attempt) => (
              <button key={attempt.id} type="button" onClick={() => onSection('settings')}>
                <span className="focusMark error">Импорт</span>
                <strong>{attempt.filename}</strong>
                <small>{attempt.errorMessage}</small>
              </button>
            ))}
            {!dashboard.attention.problems.length && !failedImports.length && (
              <div className="allClear">
                <strong>Очередь чистая</strong>
                <span>Проблемных позиций и ошибок импорта нет.</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function AnalyticsView({
  analytics,
  days,
  busy,
  onDays,
}: {
  analytics: Analytics | null;
  days: AnalyticsDays;
  busy: boolean;
  onDays: (days: AnalyticsDays) => Promise<void>;
}) {
  if (!analytics) return <div className="empty">Загрузка аналитики…</div>;

  const maxActivity = Math.max(1, ...analytics.daily.map((entry) => entry.picked + entry.problems));
  const hasActivity = analytics.summary.handled > 0 || analytics.summary.ordersCreated > 0;
  const labelStep = days === 7 ? 1 : days === 30 ? 5 : 15;

  return (
    <section className="analyticsPage">
      <div className="analyticsHeading">
        <div>
          <p className="eyebrow">Результат смены</p>
          <h2>Аналитика склада</h2>
          <p>
            {new Date(analytics.period.from).toLocaleDateString('ru-RU')} —{' '}
            {new Date(analytics.period.to).toLocaleDateString('ru-RU')}
          </p>
        </div>
        <fieldset className="periodSwitch">
          <legend className="srOnly">Период аналитики</legend>
          {([7, 30, 90] as const).map((value) => (
            <button
              className={days === value ? 'active' : ''}
              disabled={busy}
              key={value}
              onClick={() => void onDays(value)}
              type="button"
            >
              {value} дней
            </button>
          ))}
        </fieldset>
      </div>

      <div className="analyticsKpis">
        <article>
          <span>Создано заказов</span>
          <strong>{analytics.summary.ordersCreated}</strong>
          <small>{analytics.summary.ordersClosed} закрыто</small>
        </article>
        <article>
          <span>Обработано позиций</span>
          <strong>{analytics.summary.handled}</strong>
          <small>{analytics.summary.picked} собрано</small>
        </article>
        <article>
          <span>Успешная сборка</span>
          <strong>{formatPercent(analytics.summary.successRate)}</strong>
          <small>{analytics.summary.notFound + analytics.summary.skipped} проблем</small>
        </article>
        <article>
          <span>Среднее время</span>
          <strong>{formatDuration(analytics.summary.averageCycleMinutes)}</strong>
          <small>{analytics.summary.ordersCompleted} завершено</small>
        </article>
      </div>

      <div className="analyticsGrid">
        <section className="panel trendPanel">
          <div className="panelTitle">
            <div>
              <p className="eyebrow">По дням</p>
              <h2>Темп обработки</h2>
            </div>
            <div className="chartLegend">
              <span className="pickedLegend">Собрано</span>
              <span className="problemLegend">Проблемы</span>
            </div>
          </div>
          {hasActivity ? (
            <div className="trendScroll">
              <div className={`trendChart range-${days}`}>
                {analytics.daily.map((entry, index) => {
                  const pickedHeight = (entry.picked / maxActivity) * 100;
                  const problemHeight = (entry.problems / maxActivity) * 100;
                  const showLabel = index % labelStep === 0 || index === analytics.daily.length - 1;
                  return (
                    <div
                      className="trendDay"
                      key={entry.date}
                      title={`${entry.date}: ${entry.picked} собрано`}
                    >
                      <div className="trendBars">
                        <i className="problemBar" style={{ height: `${problemHeight}%` }} />
                        <i className="pickedBar" style={{ height: `${pickedHeight}%` }} />
                      </div>
                      <span>
                        {showLabel
                          ? new Date(`${entry.date}T00:00:00Z`).toLocaleDateString('ru-RU', {
                              day: '2-digit',
                              month: '2-digit',
                            })
                          : ''}
                      </span>
                      {(entry.ordersCreated > 0 || entry.ordersCompleted > 0) && (
                        <small>
                          созд. {entry.ordersCreated} / зав. {entry.ordersCompleted}
                        </small>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="empty compact">За выбранный период операций ещё не было</div>
          )}
        </section>

        <section className="panel outcomePanel">
          <p className="eyebrow">Качество</p>
          <h2>Итоги позиций</h2>
          <div
            className="outcomeRing"
            style={{ '--rate': `${analytics.summary.successRate * 3.6}deg` } as React.CSSProperties}
          >
            <strong>{formatPercent(analytics.summary.successRate)}</strong>
            <span>собрано</span>
          </div>
          <dl className="outcomeList">
            <div>
              <dt>Собрано</dt>
              <dd>{analytics.summary.picked}</dd>
            </div>
            <div>
              <dt>Не найдено</dt>
              <dd>{analytics.summary.notFound}</dd>
            </div>
            <div>
              <dt>Пропущено</dt>
              <dd>{analytics.summary.skipped}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="panel workerAnalytics">
        <div className="panelTitle">
          <div>
            <p className="eyebrow">Команда</p>
            <h2>Результаты сборщиков</h2>
          </div>
          <span>{analytics.workers.length}</span>
        </div>
        <div className="workerAnalyticsTable">
          <div className="workerAnalyticsHead">
            <span>Сборщик</span>
            <span>Обработано</span>
            <span>Собрано</span>
            <span>Проблемы</span>
            <span>Успех</span>
          </div>
          {analytics.workers.map((worker) => (
            <div className="workerAnalyticsRow" key={worker.id}>
              <strong>{worker.name}</strong>
              <span>{worker.handled}</span>
              <span>{worker.picked}</span>
              <span>{worker.notFound + worker.skipped}</span>
              <span className="workerRate">
                <i style={{ width: `${worker.successRate}%` }} />
                <b>{formatPercent(worker.successRate)}</b>
              </span>
            </div>
          ))}
          {!analytics.workers.length && <div className="empty compact">Нет действий сборщиков за период</div>}
        </div>
      </section>
    </section>
  );
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatDuration(minutes: number | null) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function SettingsView({
  settings,
  imports,
  apiUrl,
  onOpen,
}: {
  settings: PublicSettings | null;
  imports: ImportAttempt[];
  apiUrl: string;
  onOpen: (id: string) => Promise<void>;
}) {
  return (
    <section className="settingsGrid">
      <div className="panel systemPanel">
        <div className="panelTitle">
          <div>
            <p className="eyebrow">Диагностика</p>
            <h2>Настройки терминала</h2>
          </div>
          <span className="healthDot" title="Сервис доступен" />
        </div>
        {settings ? (
          <dl className="settingsList">
            <div>
              <dt>Backend</dt>
              <dd>{apiUrl}</dd>
            </div>
            <div>
              <dt>PostgreSQL</dt>
              <dd>{settings.database === 'connected' ? 'Подключена' : settings.database}</dd>
            </div>
            <div>
              <dt>Версия</dt>
              <dd>{settings.version}</dd>
            </div>
            <div>
              <dt>Формат загрузки</dt>
              <dd>
                {settings.acceptedFormats.join(', ')}, до {settings.maxUploadMb} МБ
              </dd>
            </div>
            <div>
              <dt>Защита от дублей</dt>
              <dd>{settings.duplicateProtection.join(' + ')}</dd>
            </div>
            <div>
              <dt>Публичный терминал</dt>
              <dd>{settings.terminalUrl}</dd>
            </div>
            <div>
              <dt>Время сервера</dt>
              <dd>{new Date(settings.serverTime).toLocaleString('ru-RU')}</dd>
            </div>
          </dl>
        ) : (
          <div className="empty compact">Настройки сервиса недоступны</div>
        )}
        <p className="settingsHint">
          Секреты и параметры подключения к базе не передаются в браузер. Изменяемые параметры задаются через
          переменные окружения сервера.
        </p>
      </div>

      <div className="panel importsPanel">
        <div className="panelTitle">
          <div>
            <p className="eyebrow">Аудит загрузок</p>
            <h2>Последние импорты</h2>
          </div>
          <span>{imports.length}</span>
        </div>
        <div className="importList">
          {imports.map((attempt) => (
            <button
              key={attempt.id}
              type="button"
              disabled={!attempt.orderId}
              onClick={() => attempt.orderId && void onOpen(attempt.orderId)}
            >
              <ImportStatusBadge value={attempt.status} />
              <span>
                <strong>{attempt.filename}</strong>
                <small>
                  {attempt.errorMessage ??
                    `Заказ №${attempt.documentNumber ?? '—'} · ${attempt.itemCount ?? 0} позиций`}
                </small>
              </span>
              <time>{new Date(attempt.createdAt).toLocaleString('ru-RU')}</time>
            </button>
          ))}
          {!imports.length && <div className="empty compact">Импортов пока не было</div>}
        </div>
      </div>
    </section>
  );
}

function ImportStatusBadge({ value }: { value: ImportStatus }) {
  const labels: Record<ImportStatus, string> = {
    SUCCESS: 'Загружен',
    DUPLICATE: 'Дубль',
    FAILED: 'Ошибка',
  };
  return <span className={`importStatus import-${value}`}>{labels[value]}</span>;
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

function ProblemsView({
  problems,
  busy,
  onOpen,
  onReview,
  onResolve,
}: {
  problems: Problem[];
  busy: boolean;
  onOpen: (id: string) => Promise<void>;
  onReview: (item: Item, pickType: 'PACKAGE' | 'PIECE') => Promise<void>;
  onResolve: (item: Item, action: 'CONFIRM' | 'RETURN_TO_WORK') => Promise<void>;
}) {
  return (
    <section className="panel problemsPanel">
      <div className="panelTitle">
        <div>
          <p className="eyebrow">Контроль качества</p>
          <h2>Проблемы</h2>
        </div>
        <span>{problems.length}</span>
      </div>
      <div className="problemGrid">
        {problems.map((problem) => (
          <article className="problemCard" key={problem.id}>
            <div className="problemOrder">
              <button type="button" onClick={() => void onOpen(problem.order.id)}>
                Заказ №{problem.order.documentNumber}
              </button>
              <Status value={problem.order.status} />
            </div>
            <h3>{problem.name}</h3>
            <p>Штрихкод: {problem.barcode || 'не указан'}</p>
            <div className="problemMeta">
              <span>
                {problem.pickType === 'REVIEW' ? 'Тип требует проверки' : `Статус: ${problem.status}`}
              </span>
              <span>{problem.assignedWorker?.name ?? 'Без сборщика'}</span>
            </div>
            <div className="problemActions">
              {problem.pickType === 'REVIEW' && (
                <>
                  <button disabled={busy} onClick={() => void onReview(problem, 'PACKAGE')} type="button">
                    УПАК
                  </button>
                  <button disabled={busy} onClick={() => void onReview(problem, 'PIECE')} type="button">
                    ШТ
                  </button>
                </>
              )}
              {['NOT_FOUND', 'SKIPPED'].includes(problem.status) && (
                <>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => void onResolve(problem, 'CONFIRM')}
                    type="button"
                  >
                    Подтвердить
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void onResolve(problem, 'RETURN_TO_WORK')}
                    type="button"
                  >
                    Вернуть в работу
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
        {!problems.length && <div className="empty">Актуальных проблем нет</div>}
      </div>
    </section>
  );
}

function HistoryView({ orders, onOpen }: { orders: OrderListItem[]; onOpen: (id: string) => Promise<void> }) {
  return (
    <section className="panel historyPanel">
      <div className="panelTitle">
        <div>
          <p className="eyebrow">Архив операций</p>
          <h2>История заказов</h2>
        </div>
        <span>{orders.length}</span>
      </div>
      <div className="historyTable">
        {orders.map((order) => (
          <button type="button" className="historyRow" key={order.id} onClick={() => void onOpen(order.id)}>
            <strong>№{order.documentNumber}</strong>
            <span>{new Date(order.documentDate).toLocaleDateString('ru-RU')}</span>
            <span>{order.warehouse}</span>
            <span>
              {order.progress.completed}/{order.progress.total}
            </span>
            <Status value={order.status} />
          </button>
        ))}
        {!orders.length && <div className="empty">Завершённых заказов пока нет</div>}
      </div>
    </section>
  );
}

function EventTimeline({ events }: { events: OrderEvent[] }) {
  const labels: Record<string, string> = {
    ORDER_ASSIGNED: 'Заказ распределён',
    ORDER_STARTED: 'Сборка начата',
    ORDER_COMPLETED: 'Сборка завершена',
    ITEM_ASSIGNED: 'Позиция назначена',
    ITEM_REASSIGNED: 'Позиция передана',
    ITEM_ACTIVE: 'Позиция начата',
    ITEM_PICKED: 'Товар собран',
    ITEM_NOT_FOUND: 'Товар не найден',
    ITEM_SKIPPED: 'Позиция пропущена',
    ITEM_UNDONE: 'Действие отменено',
    ITEM_REVIEWED: 'Тип отбора проверен',
    PROBLEM_CONFIRMED: 'Проблема подтверждена',
    PROBLEM_RETURNED: 'Позиция возвращена в работу',
    ORDER_CLOSED: 'Заказ закрыт',
  };
  return (
    <section className="timeline">
      <div className="panelTitle">
        <div>
          <p className="eyebrow">Неизменяемый журнал</p>
          <h2>История действий</h2>
        </div>
        <span>{events.length}</span>
      </div>
      <div className="timelineList">
        {events.slice(0, 40).map((event) => (
          <div className="timelineEvent" key={event.id}>
            <time>{new Date(event.serverAt).toLocaleString('ru-RU')}</time>
            <strong>{labels[event.type] ?? event.type}</strong>
            <span>{event.item?.name ?? event.worker?.name ?? 'Заказ'}</span>
          </div>
        ))}
        {!events.length && <div className="empty compact">Событий пока нет</div>}
      </div>
    </section>
  );
}

function ItemRow({
  item,
  busy,
  onStatus,
  onUndo,
  onReview,
  onResolve,
}: {
  item: Item;
  busy: boolean;
  onStatus: (item: Item, status: Exclude<ItemStatus, 'PENDING' | 'ASSIGNED'>) => Promise<void>;
  onUndo: (item: Item) => Promise<void>;
  onReview: (item: Item, pickType: 'PACKAGE' | 'PIECE') => Promise<void>;
  onResolve: (item: Item, action: 'CONFIRM' | 'RETURN_TO_WORK') => Promise<void>;
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
        {item.pickType === 'REVIEW' && (
          <>
            <button disabled={busy} onClick={() => void onReview(item, 'PACKAGE')} type="button">
              Это упаковки
            </button>
            <button disabled={busy} onClick={() => void onReview(item, 'PIECE')} type="button">
              Это штуки
            </button>
          </>
        )}
        {['NOT_FOUND', 'SKIPPED'].includes(item.status) && item.problemResolution !== 'CONFIRMED' && (
          <>
            <button
              className="danger"
              disabled={busy}
              onClick={() => void onResolve(item, 'CONFIRM')}
              type="button"
            >
              Подтвердить проблему
            </button>
            <button disabled={busy} onClick={() => void onResolve(item, 'RETURN_TO_WORK')} type="button">
              Вернуть в работу
            </button>
          </>
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

function shiftLabel(value: ShiftStatus) {
  return { OFF_SHIFT: 'Вне смены', AVAILABLE: 'Доступен', BUSY: 'В работе' }[value];
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
