import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { label, upload } from "./api.js";

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = "ok") => {
    const id = Math.random();
    setItems((a) => [...a, { id, msg, kind }]);
    setTimeout(() => setItems((a) => a.filter((x) => x.id !== id)), kind === "err" ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- confirm dialog ---------- */
export function Confirm({ title, body, confirmLabel = "Confirm", danger, onConfirm, onCancel }) {
  const ref = useRef();
  useEffect(() => {
    ref.current?.focus();
    const k = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCancel]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="muted">{body}</div>
        <div className="actions">
          <button className="btn" onClick={onCancel} ref={ref}>Cancel</button>
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- small pieces ---------- */
const TONE = {
  pending: "warn", confirmed: "info", in_production: "info", shipped: "info", delivered: "ok", cancelled: "bad", refunded: "bad",
  unpaid: "warn", paid: "ok", failed: "bad",
  new: "warn", in_review: "info", proposal_sent: "info", completed: "ok",
};
export const Badge = ({ value }) => <span className={`badge ${TONE[value] || ""}`}>{label(value)}</span>;

export const Field = ({ label: l, hint, children }) => (
  <label className="field"><span>{l}</span>{children}{hint && <small>{hint}</small>}</label>
);

export function Pager({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="pager">
      <span>{total} {total === 1 ? "result" : "results"}</span>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
        <span>{page} / {pages}</span>
        <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </span>
    </div>
  );
}

export const PageHead = ({ title, sub, children }) => (
  <div className="top"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{children}</div></div>
);

/** Debounced value, for search boxes. */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Loads data and re-loads when deps change. */
export function useLoad(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const toast = useToast();
  const reload = useCallback(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then((data) => live && setState({ loading: false, data, error: null }))
      .catch((error) => { if (live) { setState({ loading: false, data: null, error }); toast(error.message, "err"); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => reload(), [reload]);
  return { ...state, reload };
}

/* ---------- image manager (upload, reorder, remove) ---------- */
export function ImageManager({ value, onChange, max = 12, single = false }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const input = useRef();

  async function add(files) {
    if (!files.length) return;
    setBusy(true);
    try {
      const urls = await upload([...files].slice(0, max - value.length));
      onChange(single ? urls.slice(0, 1) : [...value, ...urls]);
    } catch (e) { toast(e.message, "err"); }
    setBusy(false);
    input.current.value = "";
  }
  const move = (i, d) => { const a = [...value]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; onChange(a); };

  return (
    <div className="images">
      {value.map((u, i) => (
        <div className="imgcell" key={u + i}>
          {i === 0 && !single && <span className="cover">Cover</span>}
          <img src={u} alt="" />
          <div className="tools">
            {!single && <button type="button" aria-label="Move left" onClick={() => move(i, -1)} disabled={i === 0}>‹</button>}
            <button type="button" aria-label="Remove image" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
            {!single && <button type="button" aria-label="Move right" onClick={() => move(i, 1)} disabled={i === value.length - 1}>›</button>}
          </div>
        </div>
      ))}
      {(single ? value.length === 0 : value.length < max) && (
        <button type="button" className="dropzone" onClick={() => input.current.click()} disabled={busy}>
          {busy ? "Uploading…" : "+ Add image"}
        </button>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple={!single} hidden onChange={(e) => add(e.target.files)} />
    </div>
  );
}
