import { useState } from "react";
import { authApi } from "../api.js";
import { Field } from "../ui.jsx";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { user } = await authApi("/login", { method: "POST", body: { email, password } });
      if (user.role !== "admin") {
        await authApi("/logout", { method: "POST" }).catch(() => {});
        throw new Error("This account does not have dashboard access.");
      }
      onLogin(user);
    } catch (err) { setError(err.message); }
    setBusy(false);
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <div className="brand"><i /></div>
        <h1>Dashboard sign in</h1>
        <Field label="Email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {error && <p className="err" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
