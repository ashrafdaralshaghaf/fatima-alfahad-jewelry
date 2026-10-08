import { useState } from "react";
import { api, dt } from "../api.js";
import { PageHead, Pager, useDebounced, useLoad, useToast } from "../ui.jsx";

export default function Subscribers() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, loading, reload } = useLoad(() => api(`/subscribers?page=${page}&limit=50&q=${encodeURIComponent(dq)}`), [page, dq]);

  async function remove(s) {
    try { await api(`/subscribers/${s.id}`, { method: "DELETE" }); toast("Removed"); reload(); } catch (e) { toast(e.message, "err"); }
  }

  return (
    <>
      <PageHead title="Newsletter" sub="People who asked to hear from the House">
        <a className="btn" href="/api/admin/subscribers.csv">Export CSV</a>
      </PageHead>
      <div className="toolbar"><input className="input" placeholder="Search e-mail…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search subscribers" /></div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Email</th><th>Source</th><th>Subscribed</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data?.items.map((s) => (
              <tr key={s.id}>
                <td>{s.email}</td><td className="muted">{s.source}</td><td>{dt(s.created_at)}</td>
                <td>{s.unsubscribed_at ? <span className="badge">Unsubscribed</span> : <span className="badge ok">Active</span>}</td>
                <td className="right"><button className="btn sm danger" onClick={() => remove(s)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && data?.items.length === 0 && <div className="empty">No subscribers.</div>}
      </div>
      {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
    </>
  );
}
