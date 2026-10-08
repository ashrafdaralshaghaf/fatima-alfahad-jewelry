import { useEffect, useState } from "react";
import { api, d0, dt, label } from "../api.js";
import { Badge, Confirm, PageHead, Pager, useLoad, useToast } from "../ui.jsx";

/** Shared status + notes editor for appointments and bespoke requests. */
function Editor({ base, item, statuses, onClose, onSaved, children }) {
  const toast = useToast();
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.admin_notes || "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api(`/${base}/${item.id}`, { method: "PATCH", body: { status, adminNotes: notes } }); toast("Saved"); onSaved(); onClose(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  }
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(640px,100%)", maxHeight: "92vh", overflow: "auto" }}>
        {children}
        <label className="field"><span>Status</span>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>{statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
        <label className="field"><span>Internal notes</span><textarea className="textarea" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="actions"><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={save} disabled={busy}>Save</button></div>
      </div>
    </div>
  );
}

function useList(path) {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const q = useLoad(() => api(`/${path}?page=${page}&limit=25&status=${status}`), [path, page, status]);
  return { ...q, status, setStatus: (s) => { setStatus(s); setPage(1); }, page, setPage };
}

export function Appointments() {
  const toast = useToast();
  const L = useList("appointments");
  const [open, setOpen] = useState(null);
  const [del, setDel] = useState(null);
  const S = ["new", "confirmed", "completed", "cancelled"];
  async function remove() {
    try { await api(`/appointments/${del.id}`, { method: "DELETE" }); toast("Deleted"); setDel(null); L.reload(); } catch (e) { toast(e.message, "err"); }
  }
  return (
    <>
      <PageHead title="Appointments" sub="Private appointment requests" />
      <div className="toolbar">
        <select className="select" value={L.status} onChange={(e) => L.setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option>{S.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>When</th><th>Client</th><th>Type</th><th>Piece of interest</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {L.data?.items.map((a) => (
              <tr key={a.id} className="click" onClick={() => setOpen(a)}>
                <td>{d0(a.on_date)} · {a.at_time}</td>
                <td>{a.name}<div className="muted"><a href={`tel:${a.mobile}`} onClick={(e) => e.stopPropagation()}>{a.mobile}</a></div></td>
                <td>{a.kind === "video" ? "Video call" : "At home (Kuwait)"}</td><td>{a.piece || "—"}</td><td><Badge value={a.status} /></td>
                <td className="right" onClick={(e) => e.stopPropagation()}><button className="btn sm danger" onClick={() => setDel(a)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!L.loading && L.data?.items.length === 0 && <div className="empty">No appointment requests.</div>}
      </div>
      {L.data && <Pager page={L.data.page} limit={L.data.limit} total={L.data.total} onPage={L.setPage} />}
      {open && (
        <Editor base="appointments" item={open} statuses={S} onClose={() => setOpen(null)} onSaved={L.reload}>
          <h2>{open.name}</h2>
          <dl className="dl"><dt>When</dt><dd>{d0(open.on_date)} at {open.at_time}</dd><dt>Mobile</dt><dd>{open.mobile}</dd>
            <dt>Type</dt><dd>{open.kind === "video" ? "Video call" : "At home (Kuwait)"}</dd><dt>Piece</dt><dd>{open.piece || "—"}</dd><dt>Requested</dt><dd>{dt(open.created_at)}</dd></dl>
        </Editor>
      )}
      {del && <Confirm danger title="Delete request?" confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={remove} body="This cannot be undone." />}
    </>
  );
}

export function Bespoke() {
  const L = useList("bespoke");
  const [open, setOpen] = useState(null);
  const S = ["new", "in_review", "proposal_sent", "in_production", "completed", "cancelled"];
  useEffect(() => { if (open && L.data) setOpen(L.data.items.find((i) => i.id === open.id) || null); /* eslint-disable-next-line */ }, [L.data]);
  return (
    <>
      <PageHead title="Bespoke requests" sub="Custom pieces designed for a client" />
      <div className="toolbar">
        <select className="select" value={L.status} onChange={(e) => L.setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option>{S.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Received</th><th>Client</th><th>Piece</th><th>Diamond</th><th>Budget</th><th>Photos</th><th>Status</th></tr></thead>
          <tbody>
            {L.data?.items.map((b) => (
              <tr key={b.id} className="click" onClick={() => setOpen(b)}>
                <td>{d0(b.created_at)}</td><td>{b.name}<div className="muted">{b.mobile}</div></td><td>{label(b.piece_type)}</td>
                <td>{label(b.diamond)}</td><td>{b.budget || "—"}</td><td>{b.photos.length || "—"}</td><td><Badge value={b.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!L.loading && L.data?.items.length === 0 && <div className="empty">No bespoke requests yet.</div>}
      </div>
      {L.data && <Pager page={L.data.page} limit={L.data.limit} total={L.data.total} onPage={L.setPage} />}
      {open && (
        <Editor base="bespoke" item={open} statuses={S} onClose={() => setOpen(null)} onSaved={L.reload}>
          <h2>{open.name}</h2>
          <dl className="dl"><dt>Mobile</dt><dd><a href={`tel:${open.mobile}`}>{open.mobile}</a></dd><dt>Piece</dt><dd>{label(open.piece_type)}</dd>
            <dt>Diamond</dt><dd>{label(open.diamond)}</dd><dt>Budget</dt><dd>{open.budget || "—"}</dd><dt>Received</dt><dd>{dt(open.created_at)}</dd>
            <dt>Idea</dt><dd style={{ whiteSpace: "pre-wrap" }}>{open.idea}</dd></dl>
          {open.photos.length > 0 && (
            <div className="images">
              {open.photos.map((p) => {
                const url = `/api/admin/bespoke/${open.id}/photos/${p}`;
                return <a key={p} href={url} target="_blank" rel="noreferrer"><img className="thumb" style={{ width: 96 }} src={url} alt="Reference" /></a>;
              })}
            </div>
          )}
        </Editor>
      )}
    </>
  );
}
