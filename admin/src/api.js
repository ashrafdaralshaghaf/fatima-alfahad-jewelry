let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

async function call(url, { method = "GET", body, form } = {}) {
  const headers = { "X-Requested-With": "fetch" };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new Error("Cannot reach the server.");
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith("/api/auth/")) onUnauthorized();
    const e = new Error(data?.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export const api = (path, opts) => call("/api/admin" + path, opts);
export const authApi = (path, opts) => call("/api/auth" + path, opts);

export async function upload(files) {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  return (await api("/uploads", { method: "POST", form })).urls;
}

/* ---------- formatting ---------- */
export const kwd = (n) => `${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} KWD`;
export const kwd0 = (n) => `${Math.round(Number(n || 0)).toLocaleString("en-US")} KWD`;
export const dt = (s) => (s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
export const d0 = (s) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const label = (s) => String(s || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** WhatsApp link for a customer number (8-digit Kuwaiti numbers get the +965 prefix). */
export const waLink = (phone, text = "") => {
  let d = String(phone || "").replace(/\D/g, "").replace(/^00/, "");
  if (d.length === 8) d = "965" + d;
  return `https://wa.me/${d}${text ? "?text=" + encodeURIComponent(text) : ""}`;
};
