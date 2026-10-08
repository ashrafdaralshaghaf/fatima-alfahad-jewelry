import { useState } from "react";
import { api, d0, dt } from "../api.js";
import { Confirm, Field, PageHead, useLoad, useToast } from "../ui.jsx";

export default function Admins() {
  const toast = useToast();
  const { data, loading, reload } = useLoad(() => api("/admins"), []);
  const [form, setForm] = useState(null);     // {mode:'new'|'edit', id?, email, fullName}
  const [confirm, setConfirm] = useState(null); // {kind:'remove'|'toggle'|'reset', admin}
  const [secret, setSecret] = useState(null);   // {email, password}
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (form.mode === "new") {
        const r = await api("/admins", { method: "POST", body: { email: form.email, fullName: form.fullName } });
        setSecret({ email: form.email, password: r.temporaryPassword });
      } else {
        await api(`/admins/${form.id}`, { method: "PATCH", body: { email: form.email, fullName: form.fullName } });
        toast("Saved");
      }
      setForm(null); reload();
    } catch (err) { toast(err.message, "err"); }
    setBusy(false);
  }

  async function run() {
    const { kind, admin: a } = confirm;
    try {
      if (kind === "remove") { await api(`/admins/${a.id}`, { method: "DELETE" }); toast("Administrator removed"); }
      else if (kind === "toggle") { await api(`/admins/${a.id}`, { method: "PATCH", body: { isActive: !a.isActive } }); toast(a.isActive ? "Account disabled" : "Account enabled"); }
      else { const r = await api(`/admins/${a.id}/reset-password`, { method: "POST" }); setSecret({ email: a.email, password: r.temporaryPassword }); }
      reload();
    } catch (err) { toast(err.message, "err"); }
    setConfirm(null);
  }

  const copy = () => navigator.clipboard?.writeText(secret.password).then(() => toast("Copied"));

  return (
    <>
      <PageHead title="Administrators" sub="People who can sign in to this dashboard">
        <button className="btn primary" onClick={() => setForm({ mode: "new", email: "", fullName: "" })}>+ Add administrator</button>
      </PageHead>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Added</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data?.items.map((a) => {
              const me = a.id === data.me;
              return (
                <tr key={a.id}>
                  <td>{a.fullName}{me && <span className="badge info" style={{ marginLeft: 8 }}>You</span>}</td>
                  <td>{a.email}</td><td>{d0(a.createdAt)}</td><td>{a.lastLoginAt ? dt(a.lastLoginAt) : "—"}</td>
                  <td>{a.isActive ? <span className="badge ok">Active</span> : <span className="badge bad">Disabled</span>}</td>
                  <td className="right" style={{ whiteSpace: "nowrap" }}>
                    <button className="btn sm" onClick={() => setForm({ mode: "edit", id: a.id, email: a.email, fullName: a.fullName })}>Edit</button>{" "}
                    <button className="btn sm" onClick={() => setConfirm({ kind: "reset", admin: a })}>Reset password</button>{" "}
                    {!me && <button className="btn sm" onClick={() => setConfirm({ kind: "toggle", admin: a })}>{a.isActive ? "Disable" : "Enable"}</button>}{" "}
                    {!me && <button className="btn sm danger" onClick={() => setConfirm({ kind: "remove", admin: a })}>Remove</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && data?.items.length === 0 && <div className="empty">No administrators.</div>}
      </div>
      <p className="muted" style={{ marginTop: 14 }}>New administrators receive a temporary password shown once; they should change it from Settings & security after signing in. At least one active administrator must always remain.</p>

      {form && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setForm(null)}>
          <form className="modal" onSubmit={save}>
            <h2>{form.mode === "new" ? "Add administrator" : "Edit administrator"}</h2>
            <Field label="Full name"><input className="input" required minLength={2} maxLength={100} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoFocus /></Field>
            <Field label="Email" hint={form.mode === "edit" ? "Changing the email signs this person out of all devices." : "If this email already has a customer account, it is upgraded to administrator."}>
              <input className="input" type="email" required maxLength={200} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <div className="actions"><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
          </form>
        </div>
      )}
      {confirm && (
        <Confirm danger={confirm.kind !== "reset"} onCancel={() => setConfirm(null)} onConfirm={run}
          title={confirm.kind === "remove" ? "Remove administrator?" : confirm.kind === "toggle" ? (confirm.admin.isActive ? "Disable account?" : "Enable account?") : "Reset password?"}
          confirmLabel={confirm.kind === "remove" ? "Remove" : confirm.kind === "toggle" ? (confirm.admin.isActive ? "Disable" : "Enable") : "Reset"}
          body={confirm.kind === "remove" ? <>{confirm.admin.email} will lose dashboard access and be signed out.</> : confirm.kind === "toggle" ? <>{confirm.admin.isActive ? "They are signed out and cannot sign in." : "They can sign in again."}</> : <>A new temporary password is generated and {confirm.admin.email} is signed out everywhere.</>} />
      )}
      {secret && (
        <div className="modal-bg">
          <div className="modal">
            <h2>Temporary password</h2>
            <p className="muted">For <b>{secret.email}</b>. It is shown only once — send it privately and ask them to change it after the first sign-in.</p>
            <input className="input mono" readOnly value={secret.password} onFocus={(e) => e.target.select()} aria-label="Temporary password" />
            <div className="actions"><button className="btn" onClick={copy}>Copy</button><button className="btn primary" onClick={() => setSecret(null)}>Done</button></div>
          </div>
        </div>
      )}
    </>
  );
}
