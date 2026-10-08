import { Link } from "react-router-dom";
import { api, d0, kwd, kwd0 } from "../api.js";
import { Badge, PageHead, useLoad } from "../ui.jsx";

function Chart({ data }) {
  const W = 700, H = 220, pad = 26, max = Math.max(1, ...data.map((d) => d.revenue));
  const bw = (W - pad * 2) / data.length;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue for the last 30 days">
      {data.map((d, i) => {
        const h = (d.revenue / max) * (H - pad * 2 - 6);
        return (
          <g key={d.day}>
            <rect x={pad + i * bw + 2} y={H - pad - h} width={Math.max(2, bw - 4)} height={Math.max(h, d.revenue ? 2 : 0)}>
              <title>{`${d.day}: ${kwd(d.revenue)} · ${d.orders} order(s)`}</title>
            </rect>
            {i % 5 === 0 && <text x={pad + i * bw} y={H - 8}>{d.day.slice(5)}</text>}
          </g>
        );
      })}
      <text x={pad} y={12}>{kwd0(max)}</text>
    </svg>
  );
}

export default function Dashboard() {
  const { data: s, loading } = useLoad(() => api("/stats"), []);
  if (loading || !s) return <div className="spin">Loading…</div>;
  const c = s.counts, pend = s.byStatus.pending || 0;
  const alerts = [
    pend > 0 && ["/orders?status=pending", `${pend} order${pend > 1 ? "s" : ""} waiting for confirmation`],
    c.appointments_new > 0 && ["/appointments", `${c.appointments_new} new appointment request${c.appointments_new > 1 ? "s" : ""}`],
    c.bespoke_new > 0 && ["/bespoke", `${c.bespoke_new} new bespoke request${c.bespoke_new > 1 ? "s" : ""}`],
    c.low_stock > 0 && ["/products", `${c.low_stock} product${c.low_stock > 1 ? "s" : ""} low on stock`],
  ].filter(Boolean);

  return (
    <>
      <PageHead title="Overview" sub="How the House is doing" />
      {alerts.length > 0 && (
        <div className="alerts">
          {alerts.map(([to, msg]) => <Link key={to} to={to} className="alert"><span>{msg}</span><span>View →</span></Link>)}
        </div>
      )}
      <div className="kpis">
        <div className="kpi"><span>Revenue · 30 days</span><b>{kwd0(s.revenue.month)}</b><small>{s.revenue.orders_month} orders</small></div>
        <div className="kpi"><span>Revenue · 7 days</span><b>{kwd0(s.revenue.week)}</b><small>Today {kwd0(s.revenue.today)}</small></div>
        <div className="kpi"><span>Paid to date</span><b>{kwd0(s.revenue.paid)}</b><small>{s.revenue.orders_all} orders in total</small></div>
        <div className="kpi"><span>Customers</span><b>{c.customers}</b><small>+{c.customers_month} this month</small></div>
        <div className="kpi"><span>Live products</span><b>{c.products}</b><small>{c.subscribers} newsletter subscribers</small></div>
      </div>
      <div className="cols">
        <div className="panel"><h2>Revenue · last 30 days</h2><Chart data={s.daily} /></div>
        <div className="panel">
          <h2>Top pieces</h2>
          {s.top.length === 0 ? <p className="muted">No sales yet.</p> : (
            <div className="list">{s.top.map((t) => <div key={t.name}><span>{t.name} <span className="muted">× {t.qty}</span></span><span className="mono">{kwd0(t.revenue)}</span></div>)}</div>
          )}
        </div>
      </div>
      <div className="panel" style={{ marginTop: 18 }}>
        <h2>Recent orders</h2>
        {s.recent.length === 0 ? <p className="muted">No orders yet.</p> : (
          <div className="tablewrap" style={{ border: 0 }}>
            <table>
              <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Status</th><th>Payment</th><th className="right">Total</th></tr></thead>
              <tbody>
                {s.recent.map((o) => (
                  <tr key={o.id}>
                    <td><Link to={`/orders/${o.id}`}>{o.order_no}</Link></td><td>{o.customer_name}</td><td>{d0(o.created_at)}</td>
                    <td><Badge value={o.status} /></td><td><Badge value={o.payment_status} /></td><td className="right mono">{kwd(o.total_kwd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
