import { useEffect, useState } from "react";
import { api, authApi, dt } from "../api.js";
import { Field, PageHead, Pager, useLoad, useToast } from "../ui.jsx";

const CUR = ["AED", "SAR", "QAR", "BHD", "OMR", "USD"];

export default function Settings({ user }) {
  const toast = useToast();
  const s = useLoad(() => api("/settings"), []);
  const [rates, setRates] = useState({});
  const [pw, setPw] = useState({ current: "", password: "", again: "" });
  const [page, setPage] = useState(1);
  const audit = useLoad(() => api(`/audit?page=${page}&limit=15`), [page]);

  useEffect(() => { if (s.data) setRates(Object.fromEntries(CUR.map((c) => [c, String(s.data.rates[c])]))); }, [s.data]);

  async function saveRates(e) {
    e.preventDefault();
    try {
      await api("/settings", { method: "PUT", body: { rates: Object.fromEntries(CUR.map((c) => [c, Number(rates[c])])) } });
      toast("Exchange rates saved. The storefront uses them immediately.");
    } catch (err) { toast(err.message, "err"); }
  }
  async function savePw(e) {
    e.preventDefault();
    if (pw.password !== pw.again) return toast("The new passwords do not match.", "err");
    try {
      await authApi("/change-password", { method: "POST", body: { current: pw.current, password: pw.password } });
      toast("Password changed. Other devices were signed out."); setPw({ current: "", password: "", again: "" });
    } catch (err) { toast(err.message, "err"); }
  }

  return (
    <>
      <PageHead title="Settings & security" sub={`Signed in as ${user.email}`} />
      <div className="cols" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
        <form className="panel" onSubmit={saveRates}>
          <h2>Exchange rates</h2>
          <p className="muted" style={{ marginTop: -6 }}>Prices are stored in KWD. These rates convert them for visitors who choose another currency (1 KWD = …).</p>
          <div className="grid2" style={{ marginBottom: 16 }}>
            {CUR.map((c) => (
              <Field key={c} label={c}><input className="input" type="number" step="0.0001" min="0.0001" required value={rates[c] ?? ""} onChange={(e) => setRates({ ...rates, [c]: e.target.value })} /></Field>
            ))}
          </div>
          <button className="btn primary">Save rates</button>
        </form>
        <form className="panel" onSubmit={savePw}>
          <h2>Change password</h2>
          <div className="stack">
            <Field label="Current password"><input className="input" type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="New password" hint="At least 8 characters, with a letter and a number. A long passphrase is best.">
              <input className="input" type="password" autoComplete="new-password" required minLength={8} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>
            <Field label="Repeat new password"><input className="input" type="password" autoComplete="new-password" required value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></Field>
            <button className="btn primary">Update password</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <h2>Activity log</h2>
        <p className="muted" style={{ marginTop: -6 }}>Every change made in the dashboard is recorded here.</p>
        <div className="tablewrap" style={{ border: 0 }}>
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th></tr></thead>
            <tbody>
              {audit.data?.items.map((a) => (
                <tr key={a.id}><td>{dt(a.created_at)}</td><td>{a.actor_email || "—"}</td><td>{a.action}</td><td>{a.entity}{a.entity_id ? ` · ${a.entity_id}` : ""}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {audit.data && <Pager page={audit.data.page} limit={audit.data.limit} total={audit.data.total} onPage={setPage} />}
      </div>
    </>
  );
}
