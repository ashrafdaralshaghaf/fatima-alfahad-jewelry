import { useState } from "react";
import { Link } from "react-router-dom";
import { api, d0, dt, kwd } from "../api.js";
import { Badge, Confirm, PageHead, Pager, useDebounced, useLoad, useToast } from "../ui.jsx";

export default function Customers() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const dq = useDebounced(q);
  const { data, loading, reload } = useLoad(() => api(`/customers?page=${page}&limit=25&q=${encodeURIComponent(dq)}`), [page, dq]);
  const detail = useLoad(() => (open ? api(`/customers/${open}`) : Promise.resolve(null)), [open]);

  async function setActive(c, isActive) {
    try { await api(`/customers/${c.id}`, { method: "PATCH", body: { isActive } }); toast(isActive ? "Account re-enabled" : "Account disabled and signed out"); setConfirm(null); reload(); detail.reload(); }
    catch (e) { toast(e.message, "err"); }
  }

  return (
    <>
      <PageHead title="Customers" sub="Registered accounts" />
      <div className="toolbar"><input className="input" placeholder="Search name, email or phone…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search customers" /></div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Customer</th><th>Phone</th><th>Joined</th><th>Last sign-in</th><th className="right">Orders</th><th className="right">Spent</th><th>Status</th></tr></thead>
          <tbody>
            {data?.items.map((c) => (
              <tr key={c.id} className="click" onClick={() => setOpen(c.id)}>
                <td>{c.full_name}<div className="muted">{c.email}</div></td><td>{c.phone || "—"}</td>
                <td>{d0(c.created_at)}</td><td>{c.last_login_at ? d0(c.last_login_at) : "—"}</td>
                <td className="right">{c.orders}</td><td className="right mono">{kwd(c.spent)}</td>
                <td>{c.is_active ? <span className="badge ok">Active</span> : <span className="badge bad">Disabled</span>}{c.marketing_opt_in && <span className="badge info" style={{ marginLeft: 6 }}>Marketing</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && data?.items.length === 0 && <div className="empty">No customers yet.</div>}
      </div>
      {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}

      {open && detail.data && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <div className="modal" style={{ width: "min(640px,100%)", maxHeight: "90vh", overflow: "auto" }}>
            <h2>{detail.data.customer.full_name}</h2>
            <dl className="dl">
              <dt>Email</dt><dd>{detail.data.customer.email}</dd>
              <dt>Phone</dt><dd>{detail.data.customer.phone || "—"}</dd>
              <dt>Joined</dt><dd>{dt(detail.data.customer.created_at)}</dd>
              <dt>Marketing</dt><dd>{detail.data.customer.marketing_opt_in ? "Subscribed" : "No"}</dd>
            </dl>
            <div className="list">
              {detail.data.orders.length === 0 && <span className="muted">No orders.</span>}
              {detail.data.orders.map((o) => (
                <div key={o.id}><Link to={`/orders/${o.id}`}>{o.order_no}</Link><span><Badge value={o.status} /> <span className="mono">{kwd(o.total_kwd)}</span></span></div>
              ))}
            </div>
            <div className="actions">
              <button className="btn" onClick={() => setOpen(null)}>Close</button>
              {detail.data.customer.is_active
                ? <button className="btn danger" onClick={() => setConfirm(detail.data.customer)}>Disable account</button>
                : <button className="btn primary" onClick={() => setActive(detail.data.customer, true)}>Re-enable</button>}
            </div>
          </div>
        </div>
      )}
      {confirm && <Confirm danger title="Disable this account?" confirmLabel="Disable" onCancel={() => setConfirm(null)} onConfirm={() => setActive(confirm, false)}
        body="The customer is signed out everywhere and cannot sign in. Their orders are kept." />}
    </>
  );
}
