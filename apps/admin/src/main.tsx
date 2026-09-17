import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type OrderListItem = {
  id: string;
  documentNumber: string;
  documentDate: string;
  warehouse: string;
  status: string;
  _count: { items: number };
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
  status: string;
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
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function refresh() {
    const nextOrders = await requestJson<OrderListItem[]>(`${API}/api/orders`);
    setOrders(nextOrders);
    return nextOrders;
  }

  useEffect(() => {
    requestJson<OrderListItem[]>(`${API}/api/orders`)
      .then(setOrders)
      .catch((error) => setNotice(error instanceof Error ? error.message : 'API недоступен'));
  }, []);

  const stats = useMemo(
    () => ({
      newOrders: orders.filter((order) => order.status === 'NEW').length,
      picking: orders.filter((order) => order.status === 'PICKING').length,
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

  async function upload(file: File) {
    setBusy(true);
    setNotice('');
    try {
      const body = new FormData();
      body.append('file', file);
      const result = await requestJson<ImportResponse>(`${API}/api/orders/import-xlsx`, {
        method: 'POST',
        body,
      });
      await refresh();
      const detail = await requestJson<Order>(`${API}/api/orders/${result.order.id}`);
      setSelected(detail);
      setNotice(
        result.duplicate
          ? `Заказ №${result.order.documentNumber} уже был импортирован, открыт существующий заказ.`
          : `Заказ №${result.order.documentNumber} импортирован: ${detail.items.length} позиций.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Ошибка импорта');
    } finally {
      setBusy(false);
    }
  }

  async function openOrder(id: string) {
    setNotice('');
    try {
      setSelected(await requestJson<Order>(`${API}/api/orders/${id}`));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось открыть заказ');
    }
  }

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <p className="eyebrow">Главный терминал</p>
          <h1>Сборка заказов 2026</h1>
          <p className="subtitle">Импорт товарных чеков и подготовка маршрута сборки</p>
        </div>
        <label className={`upload ${busy ? 'disabled' : ''}`}>
          {busy ? 'Импортируем…' : 'Загрузить XLSX'}
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
      </header>

      {notice && <div className="notice">{notice}</div>}

      <section className="cards" aria-label="Состояние заказов">
        <Kpi label="Новые" value={stats.newOrders} tone="blue" />
        <Kpi label="В сборке" value={stats.picking} tone="amber" />
        <Kpi label="Требуют внимания" value={stats.problems} tone="red" />
        <Kpi label="Готово" value={stats.ready} tone="green" />
      </section>

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
                <span>{order._count.items} поз.</span>
                <Status value={order.status} />
              </button>
            ))}
            {!orders.length && <div className="empty">Загрузите первый товарный чек XLSX</div>}
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

              <div className="items">
                {groups.map(([groupKey, items]) => (
                  <section className="itemGroup" key={groupKey}>
                    <div className="groupHead">
                      <h3>{groupKey}</h3>
                      <span>{items.length}</span>
                    </div>
                    {items.map((item) => (
                      <div className="item" key={item.id}>
                        <div className="sourceLine">{item.sourceLine}</div>
                        <div className="name">
                          <b>{item.name}</b>
                          <small>Штрихкод: {item.barcode || 'не указан'}</small>
                        </div>
                        <div className="sourceQuantities">
                          <span>Упак. {quantity(item.packageQuantity)}</span>
                          <span>Штук {quantity(item.pieceQuantity)}</span>
                        </div>
                        <div className={`pick ${item.pickType.toLowerCase()}`}>
                          {item.pickType === 'PACKAGE'
                            ? 'УПАК'
                            : item.pickType === 'PIECE'
                              ? 'ШТ'
                              : 'ПРОВЕРИТЬ'}
                          <strong>{quantity(item.pickQuantity)}</strong>
                        </div>
                      </div>
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
    </div>
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

function Status({ value }: { value: string }) {
  const labels: Record<string, string> = {
    NEW: 'Новый',
    READY: 'Готов к распределению',
    ASSIGNED: 'Распределён',
    PICKING: 'Сборка',
    REVIEW_REQUIRED: 'Требует проверки',
    COMPLETED: 'Готов',
    CLOSED: 'Закрыт',
  };
  return <span className={`status s-${value}`}>{labels[value] ?? value}</span>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Не найден корневой элемент приложения');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
