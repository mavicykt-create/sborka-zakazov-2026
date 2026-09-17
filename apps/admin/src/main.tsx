import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type OrderListItem = { id:string; documentNumber:string; documentDate:string; warehouse:string; status:string; _count:{items:number}; createdAt:string };
type Item = { id:string; sourceLine:number; barcode:string|null; name:string; groupKey:string; packageQuantity:string|null; pieceQuantity:string|null; pickType:'PACKAGE'|'PIECE'|'REVIEW'; pickQuantity:string; status:string };
type Order = OrderListItem & { items: Item[] };
const API = 'http://localhost:8080';

function App() {
  const [orders,setOrders]=useState<OrderListItem[]>([]);
  const [selected,setSelected]=useState<Order|null>(null);
  const [busy,setBusy]=useState(false);
  const refresh=()=>fetch(`${API}/api/orders`).then(r=>r.json()).then(setOrders);
  useEffect(()=>{refresh()},[]);

  const stats=useMemo(()=>({
    newOrders: orders.filter(x=>x.status==='NEW').length,
    picking: orders.filter(x=>x.status==='PICKING').length,
    problems: orders.filter(x=>x.status==='REVIEW_REQUIRED').length,
    ready: orders.filter(x=>x.status==='COMPLETED').length,
  }),[orders]);

  async function upload(file: File) {
    setBusy(true);
    try {
      const body=new FormData(); body.append('file',file);
      const r=await fetch(`${API}/api/orders/import-xlsx`,{method:'POST',body});
      const data=await r.json();
      if(!r.ok) throw new Error(data.error ?? 'Ошибка импорта');
      await refresh();
      const detail=await fetch(`${API}/api/orders/${data.order.id}`).then(x=>x.json());
      setSelected(detail);
      alert(data.duplicate ? 'Этот документ уже был импортирован' : `Заказ №${data.order.documentNumber} импортирован`);
    } catch(e) { alert(e instanceof Error?e.message:'Ошибка'); }
    finally { setBusy(false); }
  }

  async function openOrder(id:string){ setSelected(await fetch(`${API}/api/orders/${id}`).then(r=>r.json())); }

  return <div className="app">
    <header><div><h1>Сборка заказов 2026</h1><p>Главный терминал</p></div><label className="upload">{busy?'Импорт…':'＋ Загрузить XLSX'}<input type="file" accept=".xlsx" disabled={busy} onChange={e=>e.target.files?.[0]&&upload(e.target.files[0])}/></label></header>
    <section className="cards">
      <Kpi label="Новые" value={stats.newOrders}/><Kpi label="В сборке" value={stats.picking}/><Kpi label="Проблемы" value={stats.problems}/><Kpi label="Готово" value={stats.ready}/>
    </section>
    <main>
      <section className="panel"><h2>Заказы</h2><div className="orderList">{orders.map(o=><button key={o.id} className="orderRow" onClick={()=>openOrder(o.id)}><b>№{o.documentNumber}</b><span>{new Date(o.documentDate).toLocaleDateString('ru-RU')}</span><span>{o.warehouse}</span><span>{o._count.items} поз.</span><Status value={o.status}/></button>)}{!orders.length&&<div className="empty">Загрузите первый XLSX</div>}</div></section>
      <section className="panel detail">{selected?<><div className="detailHead"><div><h2>Заказ №{selected.documentNumber}</h2><p>{selected.warehouse} · {selected.items.length} позиций</p></div><Status value={selected.status}/></div><div className="items">{selected.items.map(i=><div className="item" key={i.id}><div className="group">{i.groupKey}</div><div className="name"><b>{i.name}</b><small>{i.barcode||'без штрихкода'}</small></div><div className={`pick ${i.pickType.toLowerCase()}`}>{i.pickType==='PACKAGE'?'УПАК':i.pickType==='PIECE'?'ШТ':'ПРОВЕРИТЬ'}<strong>{Number(i.pickQuantity)} {i.pickType==='PIECE'?'шт.':'уп.'}</strong></div></div>)}</div></>:<div className="empty">Выберите заказ слева</div>}</section>
    </main>
  </div>
}
function Kpi({label,value}:{label:string,value:number}){return <div className="kpi"><span>{label}</span><strong>{value}</strong></div>}
function Status({value}:{value:string}){const map:Record<string,string>={NEW:'Новый',READY:'Готов к распределению',ASSIGNED:'Распределён',PICKING:'Сборка',REVIEW_REQUIRED:'Требует проверки',COMPLETED:'Готов',CLOSED:'Закрыт'};return <span className={`status s-${value}`}>{map[value]??value}</span>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
