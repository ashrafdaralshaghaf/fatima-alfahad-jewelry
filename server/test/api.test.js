// Integration tests: run against the real database (npm run dev:db must be running).
//   npm test
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { migrate, pool, query } from "../src/db.js";
import { hashPassword } from "../src/security.js";

process.env.DISABLE_RATE_LIMIT = "1"; // read lazily by the limiters; ignored when NODE_ENV=production
let server, base;
const uniq = Date.now().toString(36);
const adminEmail = `admin-${uniq}@test.local`;
const adminPass = "Correct-Horse-9";
const custEmail = `cust-${uniq}@test.local`;

class Client {
  jar = {};
  async req(method, path, body, { form, headers = {} } = {}) {
    const h = { "x-requested-with": "fetch", ...headers };
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) h.cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const r = await fetch(base + path, { method, headers: h, body: payload });
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";"); const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (/expires=Thu, 01 Jan 1970/i.test(c) || v === "") delete this.jar[k]; else this.jar[k] = v;
    }
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data, headers: r.headers };
  }
}

before(async () => {
  await migrate(() => {});
  await query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,'Test Admin','admin')`,
    [adminEmail, await hashPassword(adminPass)]);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await query(`DELETE FROM orders WHERE customer_email LIKE $1`, [`%${uniq}%`]);
  await query(`DELETE FROM users WHERE email LIKE $1`, [`%${uniq}%`]);
  await query(`DELETE FROM products WHERE id LIKE $1`, [`test-${uniq}%`]);
  await query(`DELETE FROM subscribers WHERE email LIKE $1`, [`%${uniq}%`]);
  server.close();
  await pool.end();
});

const order = (over = {}) => ({
  items: [{ id: "toi-et-moi", size: 54, dia: "natural", engr: "Noura", gift: true, qty: 2 }],
  name: "Noura Test", mobile: "+96555551234", email: `buyer-${uniq}@test.local`, country: "KWD",
  area: "Salmiya", block: "5", street: "Salem", house: "12", deliveryDate: new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10),
  payment: "knet", currency: "AED", lang: "en", agree: true, ...over,
});

test("catalog is public and well-formed", async () => {
  const c = new Client();
  const r = await c.req("GET", "/api/catalog");
  assert.equal(r.status, 200);
  assert.ok(r.data.products.length >= 1);
  assert.ok(r.data.cats.rings.sizes.includes(54));
  assert.ok(!JSON.stringify(r.data).includes("stock"), "internal stock must not leak");
});

test("security headers and CSP on the storefront", async () => {
  const r = await fetch(base + "/");
  assert.match(r.headers.get("content-security-policy"), /script-src 'self' 'sha256-/);
  assert.ok(!/unsafe-inline.*script-src|script-src[^;]*unsafe-inline/.test(r.headers.get("content-security-policy")));
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-powered-by"), null);
});

test("CSRF: state-changing request without the header or with a foreign origin is rejected", async () => {
  const noHeader = await fetch(base + "/api/newsletter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `x-${uniq}@test.local` }) });
  assert.equal(noHeader.status, 403);
  const foreign = await fetch(base + "/api/newsletter", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch", origin: "https://evil.example" }, body: JSON.stringify({ email: `x-${uniq}@test.local` }) });
  assert.equal(foreign.status, 403);
});

test("auth: register, session cookie, me, logout, login, wrong password", async () => {
  const c = new Client();
  let r = await c.req("POST", "/api/auth/register", { fullName: "Cust One", email: custEmail, password: "short" });
  assert.equal(r.status, 400);
  r = await c.req("POST", "/api/auth/register", { fullName: "Cust One", email: custEmail, password: "Passw0rd-ok", marketing: true });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, "customer");
  assert.ok(!JSON.stringify(r.data).includes("password"));
  assert.ok(Object.keys(c.jar).some((k) => k.endsWith("fa_sid")));
  r = await c.req("GET", "/api/auth/me");
  assert.equal(r.data.user.email, custEmail);
  r = await c.req("POST", "/api/auth/logout");
  assert.equal(r.status, 200);
  r = await c.req("GET", "/api/auth/me");
  assert.equal(r.data.user, null);
  r = await c.req("POST", "/api/auth/register", { fullName: "Dup", email: custEmail.toUpperCase(), password: "Passw0rd-ok" });
  assert.equal(r.status, 409);
  r = await c.req("POST", "/api/auth/login", { email: custEmail, password: "wrong-password1" });
  assert.equal(r.status, 401);
  r = await c.req("POST", "/api/auth/login", { email: custEmail, password: "Passw0rd-ok" });
  assert.equal(r.status, 200);
});

test("auth: account locks after repeated failures", async () => {
  const c = new Client();
  const email = `lock-${uniq}@test.local`;
  await c.req("POST", "/api/auth/register", { fullName: "Lock Me", email, password: "Passw0rd-ok" });
  await c.req("POST", "/api/auth/logout");
  let last;
  for (let i = 0; i < 5; i++) last = await c.req("POST", "/api/auth/login", { email, password: "nope-nope-1" });
  assert.equal(last.status, 401);
  const r = await c.req("POST", "/api/auth/login", { email, password: "Passw0rd-ok" });
  assert.equal(r.status, 429, "correct password must be refused while locked");
});

test("password reset flow invalidates old sessions", async () => {
  const c = new Client();
  const email = `reset-${uniq}@test.local`;
  await c.req("POST", "/api/auth/register", { fullName: "Reset Me", email, password: "Passw0rd-ok" });
  // unknown e-mail gives the same answer (no account enumeration)
  const unknown = await c.req("POST", "/api/auth/forgot", { email: `nobody-${uniq}@test.local` });
  assert.equal(unknown.status, 200);
  const known = await c.req("POST", "/api/auth/forgot", { email });
  assert.deepEqual(known.data, unknown.data);
  const bad = await c.req("POST", "/api/auth/reset", { token: "x".repeat(43), password: "NewPassw0rd-ok" });
  assert.equal(bad.status, 400);
});

test("orders: server prices the order, validates options and ignores client prices", async () => {
  const c = new Client();
  let r = await c.req("POST", "/api/orders", order({ items: [{ id: "toi-et-moi", dia: "lab", qty: 1 }] }));
  assert.equal(r.status, 400, "ring without size is rejected");
  r = await c.req("POST", "/api/orders", order({ items: [{ id: "toi-et-moi", size: 99, qty: 1 }] }));
  assert.equal(r.status, 400, "size outside the allowed list is rejected");
  r = await c.req("POST", "/api/orders", order({ items: [{ id: "rhombus-studs", dia: "lab", engr: "Hi", qty: 1 }] }));
  assert.equal(r.status, 201, "engraving on a non-engravable piece is silently dropped");
  r = await c.req("POST", "/api/orders", order({ agree: false }));
  assert.equal(r.status, 400);
  r = await c.req("POST", "/api/orders", order({ items: [{ id: "does-not-exist", qty: 1 }] }));
  assert.equal(r.status, 409);
  r = await c.req("POST", "/api/orders", order({ items: [{ id: "toi-et-moi", size: 54, price: 1, qty: 2 }] }));
  assert.equal(r.status, 201);
  assert.equal(r.data.total, 1280, "2 x 640 KWD, client-supplied price ignored");
  assert.match(r.data.orderNo, /^FA-\d{6}$/);
  const row = (await query(`SELECT total_kwd, total_display, currency, status, payment_status FROM orders WHERE order_no = $1`, [r.data.orderNo])).rows[0];
  assert.equal(row.total_kwd, 1280);
  assert.equal(row.currency, "AED");
  assert.equal(row.total_display, 15300); // 1280 * 11.95 rounded to the nearest 10, exactly like the storefront
  assert.equal(row.status, "pending");
  assert.equal(row.payment_status, "unpaid");
});

test("orders: XSS-looking input is stored as inert text and engraving charset is restricted", async () => {
  const c = new Client();
  let r = await c.req("POST", "/api/orders", order({ items: [{ id: "toi-et-moi", size: 54, engr: "<script>", qty: 1 }] }));
  assert.equal(r.status, 400);
  r = await c.req("POST", "/api/orders", order({ name: `<img src=x onerror=alert(1)> Buyer-${uniq}` }));
  assert.equal(r.status, 201);
});

test("customer sees only their own orders; guests cannot list", async () => {
  const a = new Client(), b = new Client(), g = new Client();
  await a.req("POST", "/api/auth/register", { fullName: "A User", email: `a-${uniq}@test.local`, password: "Passw0rd-ok" });
  await b.req("POST", "/api/auth/register", { fullName: "B User", email: `b-${uniq}@test.local`, password: "Passw0rd-ok" });
  const o = await a.req("POST", "/api/orders", order({ email: `a-${uniq}@test.local` }));
  assert.equal(o.status, 201);
  assert.equal((await a.req("GET", "/api/me/orders")).data.orders.length, 1);
  assert.equal((await b.req("GET", "/api/me/orders")).data.orders.length, 0);
  assert.equal((await g.req("GET", "/api/me/orders")).status, 401);
});

test("wishlist syncs for signed-in users", async () => {
  const c = new Client();
  await c.req("POST", "/api/auth/register", { fullName: "W User", email: `w-${uniq}@test.local`, password: "Passw0rd-ok" });
  let r = await c.req("PUT", "/api/me/wishlist", { ids: ["toi-et-moi", "nope"] });
  assert.deepEqual(r.data.ids, ["toi-et-moi"]);
  await c.req("DELETE", "/api/me/wishlist/toi-et-moi");
  r = await c.req("GET", "/api/me/wishlist");
  assert.deepEqual(r.data.ids, []);
});

test("admin area: anonymous 401, customer 403, admin 200", async () => {
  const anon = new Client(), cust = new Client(), adm = new Client();
  assert.equal((await anon.req("GET", "/api/admin/stats")).status, 401);
  await cust.req("POST", "/api/auth/register", { fullName: "Plain User", email: `p-${uniq}@test.local`, password: "Passw0rd-ok" });
  assert.equal((await cust.req("GET", "/api/admin/stats")).status, 403);
  assert.equal((await cust.req("POST", "/api/admin/products", {})).status, 403);
  const l = await adm.req("POST", "/api/auth/login", { email: adminEmail, password: adminPass });
  assert.equal(l.status, 200);
  assert.equal(l.data.user.role, "admin");
  const s = await adm.req("GET", "/api/admin/stats");
  assert.equal(s.status, 200);
  assert.ok(Array.isArray(s.data.daily) && s.data.daily.length === 30);
});

test("admin: product lifecycle, validation, order management and stock", async () => {
  const adm = new Client();
  await adm.req("POST", "/api/auth/login", { email: adminEmail, password: adminPass });
  const pid = `test-${uniq}-ring`;

  let r = await adm.req("POST", "/api/admin/products", { id: pid, category: "rings", price: -5, name: { en: "x", ar: "x" } });
  assert.equal(r.status, 400);
  r = await adm.req("POST", "/api/admin/products", { id: pid, category: "rings", price: 100.5, natural: 300, name: { en: "Test Ring", ar: "خاتم" }, images: ["https://evil.example/x.png"] });
  assert.equal(r.status, 400, "external image URLs are refused");
  r = await adm.req("POST", "/api/admin/products", { id: pid, category: "rings", price: 100.5, natural: 300, stock: 3, name: { en: "Test Ring", ar: "خاتم" }, images: ["/a/boxes.webp"] });
  assert.equal(r.status, 201);
  assert.equal((await adm.req("POST", "/api/admin/products", { id: pid, category: "rings", price: 1, name: { en: "dup", ar: "dup" } })).status, 409);

  let cat = await new Client().req("GET", "/api/catalog");
  assert.ok(cat.data.products.find((p) => p.id === pid));

  // stock is enforced and decremented
  const cust = new Client();
  r = await cust.req("POST", "/api/orders", order({ items: [{ id: pid, size: 52, qty: 4 }] }));
  assert.equal(r.status, 409);
  r = await cust.req("POST", "/api/orders", order({ items: [{ id: pid, size: 52, qty: 3 }] }));
  assert.equal(r.status, 201);
  const orderNo = r.data.orderNo;
  assert.equal((await query(`SELECT stock FROM products WHERE id = $1`, [pid])).rows[0].stock, 0);
  cat = await new Client().req("GET", "/api/catalog");
  assert.equal(cat.data.products.find((p) => p.id === pid).soldOut, true);

  // order management
  const list = await adm.req("GET", `/api/admin/orders?q=${orderNo}`);
  assert.equal(list.data.items.length, 1);
  const oid = list.data.items[0].id;
  r = await adm.req("PATCH", `/api/admin/orders/${oid}`, { status: "bogus" });
  assert.equal(r.status, 400);
  r = await adm.req("PATCH", `/api/admin/orders/${oid}`, { status: "confirmed", paymentStatus: "paid", adminNotes: "called customer" });
  assert.equal(r.status, 200);
  const det = await adm.req("GET", `/api/admin/orders/${oid}`);
  assert.equal(det.data.order.payment_status, "paid");
  assert.ok(det.data.order.paid_at);
  assert.ok(det.data.events.some((e) => e.kind === "status" && e.value === "confirmed"));

  // cancelling returns the stock
  await adm.req("PATCH", `/api/admin/orders/${oid}`, { status: "cancelled" });
  assert.equal((await query(`SELECT stock FROM products WHERE id = $1`, [pid])).rows[0].stock, 3);

  // hide + update + delete product
  assert.equal((await adm.req("PATCH", `/api/admin/products/${pid}/active`, { isActive: false })).status, 200);
  cat = await new Client().req("GET", "/api/catalog");
  assert.ok(!cat.data.products.find((p) => p.id === pid), "hidden products leave the storefront");
  assert.equal((await adm.req("DELETE", `/api/admin/products/${pid}`)).status, 200);
  assert.equal((await adm.req("GET", `/api/admin/products/${pid}`)).status, 404);

  // the order survives product deletion (snapshot)
  const det2 = await adm.req("GET", `/api/admin/orders/${oid}`);
  assert.equal(det2.data.items[0].name_en, "Test Ring");

  const audit = await adm.req("GET", "/api/admin/audit");
  assert.ok(audit.data.items.some((a) => a.entity === "product" && a.entity_id === pid));
});

test("admin: image upload accepts real images only", async () => {
  const adm = new Client();
  await adm.req("POST", "/api/auth/login", { email: adminEmail, password: adminPass });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  let fd = new FormData(); fd.append("files", new Blob([png], { type: "image/png" }), "a.png");
  let r = await adm.req("POST", "/api/admin/uploads", undefined, { form: fd });
  assert.equal(r.status, 201);
  assert.match(r.data.urls[0], /^\/uploads\/[a-f0-9]{32}\.webp$/);
  const served = await fetch(base + r.data.urls[0]);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/webp");

  fd = new FormData(); fd.append("files", new Blob(["<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"], { type: "image/png" }), "evil.png");
  r = await adm.req("POST", "/api/admin/uploads", undefined, { form: fd });
  assert.equal(r.status, 400, "a non-image disguised as PNG is refused");
  fd = new FormData(); fd.append("files", new Blob([png], { type: "image/svg+xml" }), "a.svg");
  r = await adm.req("POST", "/api/admin/uploads", undefined, { form: fd });
  assert.equal(r.status, 400, "declared svg is refused");
  const anon = new Client(); fd = new FormData(); fd.append("files", new Blob([png], { type: "image/png" }), "a.png");
  assert.equal((await anon.req("POST", "/api/admin/uploads", undefined, { form: fd })).status, 401);
});

test("newsletter, appointments and bespoke submissions are stored", async () => {
  const c = new Client();
  assert.equal((await c.req("POST", "/api/newsletter", { email: "not-an-email" })).status, 400);
  assert.equal((await c.req("POST", "/api/newsletter", { email: `news-${uniq}@test.local` })).status, 201);
  assert.equal((await c.req("POST", "/api/newsletter", { email: `NEWS-${uniq}@test.local` })).status, 201, "idempotent, case-insensitive");
  const date = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
  assert.equal((await c.req("POST", "/api/appointments", { kind: "video", date, time: "19:00", name: "Appt Test", mobile: "+96555550000" })).status, 201);
  assert.equal((await c.req("POST", "/api/appointments", { kind: "video", date, time: "03:00", name: "Bad", mobile: "+96555550000" })).status, 400);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ pieceType: "rings", diamond: "lab", budget: "300 – 600", idea: "A ring for my mother", name: "Bespoke Test", mobile: "+96555550001" })) fd.set(k, v);
  assert.equal((await c.req("POST", "/api/bespoke", undefined, { form: fd })).status, 201);
  await query(`DELETE FROM appointments WHERE name = 'Appt Test'`);
  await query(`DELETE FROM bespoke_requests WHERE name = 'Bespoke Test'`);
});

test("admin can change rates; storefront catalog reflects them", async () => {
  const adm = new Client();
  await adm.req("POST", "/api/auth/login", { email: adminEmail, password: adminPass });
  const cur = (await adm.req("GET", "/api/admin/settings")).data.rates;
  assert.equal((await adm.req("PUT", "/api/admin/settings", { rates: { ...cur, AED: -1 } })).status, 400);
  assert.equal((await adm.req("PUT", "/api/admin/settings", { rates: { ...cur, AED: 12 } })).status, 200);
  assert.equal((await new Client().req("GET", "/api/catalog")).data.rates.AED, 12);
  await adm.req("PUT", "/api/admin/settings", { rates: cur });
});

test("SQL injection attempts in search/login are treated as data", async () => {
  const adm = new Client();
  await adm.req("POST", "/api/auth/login", { email: adminEmail, password: adminPass });
  const r = await adm.req("GET", `/api/admin/orders?q=${encodeURIComponent("' OR 1=1; DROP TABLE orders; --")}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.items.length, 0);
  const l = await new Client().req("POST", "/api/auth/login", { email: "' OR '1'='1", password: "x" });
  assert.equal(l.status, 400);
});
