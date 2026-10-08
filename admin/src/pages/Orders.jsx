import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, d0, kwd } from "../api.js";
import { Badge, PageHead, Pager, useDebounced, useLoad } from "../ui.jsx";

export const ORDER_STATUS = ["pending", "confirmed", "in_production", "shipped", "delivered", "cancelled", "refunded"];
export const PAY_STATUS = ["unpaid", "paid", "failed", "refunded"];

export default function Orders() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const status = sp.get("status") || "";
  const payment = sp.get("payment") || "";
  const dq = useDebounced(q);
  const { data, loading } = useLoad(
    () => api(`/orders?page=${page}&limit=25&q=${encodeURIComponent(dq)}&status=${status}&payment=${payment}`),
    [page, dq, status, payment],
  );
  const setFilter = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n); setPage(1); };

  return (
    <>
      <PageHead title="Orders" sub="Confirm, produce and ship" />
      <div className="toolbar">
        <input className="input" placeholder="Order no., name, email or phone…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search orders" />
        <select className="select" value={status} onChange={(e) => setFilter("status", e.target.value)} aria-label="Order status">
          <option value="">Any status</option>{ORDER_STATUS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <select className="select" value={payment} onChange={(e) => setFilter("payment", e.target.value)} aria-label="Payment status">
          <option value="">Any payment</option>{PAY_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Status</th><th>Payment</th><th className="right">Total</th></tr></thead>
          <tbody>
            {data?.items.map((o) => (
              <tr key={o.id} className="click" onClick={() => nav(`/orders/${o.id}`)}>
                <td><b style={{ fontWeight: 400, color: "var(--gold-light)" }}>{o.order_no}</b></td>
                <td>{d0(o.created_at)}</td>
                <td>{o.customer_name}<div className="muted">{o.customer_email}</div></td>
                <td>{o.items}</td>
                <td><Badge value={o.status} /></td>
                <td><Badge value={o.payment_status} /> <span className="muted">{o.payment_method.toUpperCase()}</span></td>
                <td className="right mono">{kwd(o.total_kwd)}<div className="muted">{o.currency !== "KWD" && `${o.total_display.toLocaleString()} ${o.currency}`}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && data?.items.length === 0 && <div className="empty">No orders match.</div>}
      </div>
      {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
    </>
  );
}
