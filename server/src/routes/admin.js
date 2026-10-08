import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { query, tx } from "../db.js";
import { config } from "../config.js";
import { HttpError, bad, notFound, parse } from "../http.js";
import { requireAdmin, adminLimiter } from "../middleware.js";
import { IMAGE_URL, memoryUpload, saveImage } from "../services/images.js";
import { audit, DEFAULT_RATES, getRates, getSetting, setSetting } from "../services/common.js";
import { layout, p, sendMail } from "../services/mailer.js";
import { escHtml } from "../security.js";

export const admin = Router();
admin.use(adminLimiter, requireAdmin);

/* ---------------- helpers ---------------- */
const slug = z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, numbers and dashes only").max(80);
const loc = (max, req = false) =>
  z.object({
    en: req ? z.string().trim().min(1).max(max) : z.string().trim().max(max).default(""),
    ar: req ? z.string().trim().min(1).max(max) : z.string().trim().max(max).default(""),
  });
const money = z.number().min(0).max(1_000_000).transform((n) => Math.round(n * 1000) / 1000);
const imageUrl = z.string().regex(IMAGE_URL, "invalid image path");
const uuid = z.string().uuid();

function paging(req, def = 25) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || def));
  return { page, limit, offset: (page - 1) * limit };
}
const like = (q) => `%${String(q).slice(0, 80).replace(/[\\%_]/g, "\\$&")}%`;
const toSlug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);

/* ---------------- dashboard ---------------- */
admin.get("/stats", async (_req, res) => {
  const live = `status NOT IN ('cancelled','refunded')`;
  const [rev, byStatus, daily, top, counts, recent] = await Promise.all([
    query(`SELECT
        COALESCE(SUM(total_kwd) FILTER (WHERE ${live}),0) AS all_time,
        COALESCE(SUM(total_kwd) FILTER (WHERE ${live} AND created_at >= date_trunc('day', now())),0) AS today,
        COALESCE(SUM(total_kwd) FILTER (WHERE ${live} AND created_at >= now() - interval '7 days'),0) AS week,
        COALESCE(SUM(total_kwd) FILTER (WHERE ${live} AND created_at >= now() - interval '30 days'),0) AS month,
        COALESCE(SUM(total_kwd) FILTER (WHERE payment_status='paid'),0) AS paid,
        COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days') AS orders_month,
        COUNT(*) AS orders_all
      FROM orders`),
    query(`SELECT status, COUNT(*) AS n FROM orders GROUP BY status`),
    query(`SELECT to_char(d::date,'YYYY-MM-DD') AS day,
                  COALESCE(SUM(o.total_kwd) FILTER (WHERE o.${live}),0) AS revenue,
                  COUNT(o.id) AS orders
             FROM generate_series(current_date - 29, current_date, '1 day') d
             LEFT JOIN orders o ON o.created_at::date = d::date
            GROUP BY d ORDER BY d`),
    query(`SELECT oi.name_en AS name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.unit_price_kwd) AS revenue
             FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.${live}
            GROUP BY oi.name_en ORDER BY revenue DESC LIMIT 5`),
    query(`SELECT
        (SELECT COUNT(*) FROM users WHERE role='customer') AS customers,
        (SELECT COUNT(*) FROM users WHERE role='customer' AND created_at >= now() - interval '30 days') AS customers_month,
        (SELECT COUNT(*) FROM products WHERE is_active) AS products,
        (SELECT COUNT(*) FROM products WHERE stock IS NOT NULL AND stock <= 2) AS low_stock,
        (SELECT COUNT(*) FROM appointments WHERE status='new') AS appointments_new,
        (SELECT COUNT(*) FROM bespoke_requests WHERE status='new') AS bespoke_new,
        (SELECT COUNT(*) FROM subscribers WHERE unsubscribed_at IS NULL) AS subscribers`),
    query(`SELECT id, order_no, customer_name, total_kwd, status, payment_status, created_at
             FROM orders ORDER BY created_at DESC LIMIT 8`),
  ]);
  res.json({
    revenue: rev.rows[0],
    byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])),
    daily: daily.rows, top: top.rows, counts: counts.rows[0], recent: recent.rows,
  });
});

/* ---------------- uploads ---------------- */
const upload = memoryUpload(12, 10);
admin.post("/uploads", upload.array("files", 12), async (req, res) => {
  if (!req.files?.length) throw bad("No files received");
  const urls = [];
  for (const f of req.files) urls.push("/uploads/" + (await saveImage(f.buffer, config.uploadsDir)));
  await audit(req, "upload", "image", null, { count: urls.length });
  res.status(201).json({ urls });
});

/* ---------------- products ---------------- */
const productBody = z.object({
  id: slug.optional(),
  category: slug,
  collection: slug.nullish(),
  price: money,
  natural: money.nullish(),
  name: loc(150, true),
  story: loc(600).prefault({}),
  metal: loc(150).prefault({}),
  stone: loc(250).prefault({}),
  isActive: z.boolean().default(true),
  isNew: z.boolean().default(false),
  sortOrder: z.number().int().min(-9999).max(9999).default(0),
  stock: z.number().int().min(0).max(100000).nullish(),
  images: z.array(imageUrl).max(12).default([]),
});

const productRow = (r, images) => ({
  id: r.id, category: r.category, collection: r.collection, price: r.price_kwd, natural: r.natural_price_kwd,
  name: { en: r.name_en, ar: r.name_ar }, story: { en: r.story_en, ar: r.story_ar },
  metal: { en: r.metal_en, ar: r.metal_ar }, stone: { en: r.stone_en, ar: r.stone_ar },
  isActive: r.is_active, isNew: r.is_new, sortOrder: r.sort_order, stock: r.stock,
  images: images ?? undefined, image: r.image, updatedAt: r.updated_at,
});

admin.get("/products", async (req, res) => {
  const { page, limit, offset } = paging(req, 50);
  const where = [], args = [];
  if (req.query.q) { args.push(like(req.query.q)); where.push(`(p.name_en ILIKE $${args.length} OR p.name_ar ILIKE $${args.length} OR p.id ILIKE $${args.length})`); }
  if (req.query.category) { args.push(String(req.query.category)); where.push(`p.category = $${args.length}`); }
  if (req.query.status === "active") where.push(`p.is_active`);
  if (req.query.status === "hidden") where.push(`NOT p.is_active`);
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(`SELECT p.*, (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image
             FROM products p ${w} ORDER BY p.sort_order, p.created_at DESC LIMIT ${limit} OFFSET ${offset}`, args),
    query(`SELECT COUNT(*) AS n FROM products p ${w}`, args),
  ]);
  res.json({ items: rows.map((r) => productRow(r)), total: c.n, page, limit });
});

admin.get("/products/:id", async (req, res) => {
  const { rows } = await query(`SELECT * FROM products WHERE id = $1`, [req.params.id]);
  if (!rows[0]) throw notFound();
  const imgs = await query(`SELECT url FROM product_images WHERE product_id = $1 ORDER BY sort_order, id`, [req.params.id]);
  res.json(productRow(rows[0], imgs.rows.map((i) => i.url)));
});

async function saveProduct(c, id, d, isNew) {
  const vals = [id, d.category, d.collection || null, d.price, d.natural ?? null, d.name.en, d.name.ar,
    d.story.en, d.story.ar, d.metal.en, d.metal.ar, d.stone.en, d.stone.ar, d.isActive, d.isNew, d.sortOrder, d.stock ?? null];
  if (isNew)
    await c.query(
      `INSERT INTO products (id, category, collection, price_kwd, natural_price_kwd, name_en, name_ar, story_en, story_ar,
         metal_en, metal_ar, stone_en, stone_ar, is_active, is_new, sort_order, stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, vals);
  else
    await c.query(
      `UPDATE products SET category=$2, collection=$3, price_kwd=$4, natural_price_kwd=$5, name_en=$6, name_ar=$7,
         story_en=$8, story_ar=$9, metal_en=$10, metal_ar=$11, stone_en=$12, stone_ar=$13, is_active=$14, is_new=$15,
         sort_order=$16, stock=$17, updated_at=now() WHERE id=$1`, vals);
  await c.query(`DELETE FROM product_images WHERE product_id = $1`, [id]);
  for (const [i, url] of d.images.entries())
    await c.query(`INSERT INTO product_images (product_id, url, sort_order) VALUES ($1,$2,$3)`, [id, url, i]);
}

admin.post("/products", async (req, res) => {
  const d = parse(productBody, req.body);
  const id = await tx(async (c) => {
    let base = d.id || toSlug(d.name.en) || "piece";
    let id = base, n = 1;
    while ((await c.query(`SELECT 1 FROM products WHERE id = $1`, [id])).rowCount) {
      if (d.id) throw new HttpError(409, "A product with this ID already exists", "duplicate");
      id = `${base}-${++n}`;
    }
    await saveProduct(c, id, d, true);
    return id;
  });
  await audit(req, "create", "product", id, { name: d.name.en });
  res.status(201).json({ id });
});

admin.put("/products/:id", async (req, res) => {
  const d = parse(productBody, req.body);
  await tx(async (c) => {
    const ex = await c.query(`SELECT 1 FROM products WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!ex.rowCount) throw notFound();
    await saveProduct(c, req.params.id, d, false);
  });
  await audit(req, "update", "product", req.params.id, { name: d.name.en, price: d.price, active: d.isActive });
  res.json({ ok: true });
});

admin.patch("/products/:id/active", async (req, res) => {
  const d = parse(z.object({ isActive: z.boolean() }), req.body);
  const r = await query(`UPDATE products SET is_active = $2, updated_at = now() WHERE id = $1`, [req.params.id, d.isActive]);
  if (!r.rowCount) throw notFound();
  await audit(req, d.isActive ? "show" : "hide", "product", req.params.id);
  res.json({ ok: true });
});

admin.delete("/products/:id", async (req, res) => {
  const r = await query(`DELETE FROM products WHERE id = $1`, [req.params.id]);
  if (!r.rowCount) throw notFound();
  await audit(req, "delete", "product", req.params.id);
  res.json({ ok: true });
});

/* ---------------- categories & collections ---------------- */
const catBody = z.object({
  slug: slug.optional(),
  name: loc(80, true),
  image: imageUrl.nullish(),
  sortOrder: z.number().int().min(-9999).max(9999).default(0),
  sizeKind: z.enum(["ring", "length"]).nullish(),
  sizes: z.array(z.number().int().min(1).max(100)).max(30).default([]),
  defaultSize: z.number().int().min(1).max(100).nullish(),
  engravable: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
const catRow = (r) => ({ slug: r.slug, name: { en: r.name_en, ar: r.name_ar }, image: r.image, sortOrder: r.sort_order,
  sizeKind: r.size_kind, sizes: r.sizes, defaultSize: r.default_size, engravable: r.engravable, isActive: r.is_active, products: r.products });

admin.get("/categories", async (_req, res) => {
  const { rows } = await query(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category = c.slug) AS products FROM categories c ORDER BY sort_order, slug`);
  res.json({ items: rows.map(catRow) });
});
admin.post("/categories", async (req, res) => {
  const d = parse(catBody, req.body);
  const s = d.slug || toSlug(d.name.en);
  if (!s) throw bad("slug: could not derive a slug, please provide one");
  await query(
    `INSERT INTO categories (slug, name_en, name_ar, image, sort_order, size_kind, sizes, default_size, engravable, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [s, d.name.en, d.name.ar, d.image ?? null, d.sortOrder, d.sizeKind ?? null, d.sizes, d.defaultSize ?? null, d.engravable, d.isActive]);
  await audit(req, "create", "category", s);
  res.status(201).json({ slug: s });
});
admin.put("/categories/:slug", async (req, res) => {
  const d = parse(catBody, req.body);
  const r = await query(
    `UPDATE categories SET name_en=$2, name_ar=$3, image=$4, sort_order=$5, size_kind=$6, sizes=$7, default_size=$8, engravable=$9, is_active=$10 WHERE slug=$1`,
    [req.params.slug, d.name.en, d.name.ar, d.image ?? null, d.sortOrder, d.sizeKind ?? null, d.sizes, d.defaultSize ?? null, d.engravable, d.isActive]);
  if (!r.rowCount) throw notFound();
  await audit(req, "update", "category", req.params.slug);
  res.json({ ok: true });
});
admin.delete("/categories/:slug", async (req, res) => {
  const r = await query(`DELETE FROM categories WHERE slug = $1`, [req.params.slug]).catch((e) => {
    if (e.code === "23503") throw new HttpError(409, "This category still has products. Move or delete them first.", "in_use");
    throw e;
  });
  if (!r.rowCount) throw notFound();
  await audit(req, "delete", "category", req.params.slug);
  res.json({ ok: true });
});

const colBody = z.object({
  slug: slug.optional(),
  name: loc(80, true),
  tag: loc(200).prefault({}),
  desc: loc(400).prefault({}),
  image: imageUrl.nullish(),
  sortOrder: z.number().int().min(-9999).max(9999).default(0),
  isActive: z.boolean().default(true),
});
const colRow = (r) => ({ slug: r.slug, name: { en: r.name_en, ar: r.name_ar }, tag: { en: r.tag_en, ar: r.tag_ar },
  desc: { en: r.desc_en, ar: r.desc_ar }, image: r.image, sortOrder: r.sort_order, isActive: r.is_active, products: r.products });

admin.get("/collections", async (_req, res) => {
  const { rows } = await query(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.collection = c.slug) AS products FROM collections c ORDER BY sort_order, slug`);
  res.json({ items: rows.map(colRow) });
});
admin.post("/collections", async (req, res) => {
  const d = parse(colBody, req.body);
  const s = d.slug || toSlug(d.name.en);
  if (!s) throw bad("slug: could not derive a slug, please provide one");
  await query(
    `INSERT INTO collections (slug, name_en, name_ar, tag_en, tag_ar, desc_en, desc_ar, image, sort_order, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [s, d.name.en, d.name.ar, d.tag.en, d.tag.ar, d.desc.en, d.desc.ar, d.image ?? null, d.sortOrder, d.isActive]);
  await audit(req, "create", "collection", s);
  res.status(201).json({ slug: s });
});
admin.put("/collections/:slug", async (req, res) => {
  const d = parse(colBody, req.body);
  const r = await query(
    `UPDATE collections SET name_en=$2, name_ar=$3, tag_en=$4, tag_ar=$5, desc_en=$6, desc_ar=$7, image=$8, sort_order=$9, is_active=$10 WHERE slug=$1`,
    [req.params.slug, d.name.en, d.name.ar, d.tag.en, d.tag.ar, d.desc.en, d.desc.ar, d.image ?? null, d.sortOrder, d.isActive]);
  if (!r.rowCount) throw notFound();
  await audit(req, "update", "collection", req.params.slug);
  res.json({ ok: true });
});
admin.delete("/collections/:slug", async (req, res) => {
  const r = await query(`DELETE FROM collections WHERE slug = $1`, [req.params.slug]); // products keep existing (collection -> NULL)
  if (!r.rowCount) throw notFound();
  await audit(req, "delete", "collection", req.params.slug);
  res.json({ ok: true });
});

/* ---------------- orders ---------------- */
const ORDER_STATUS = ["pending", "confirmed", "in_production", "shipped", "delivered", "cancelled", "refunded"];
const PAY_STATUS = ["unpaid", "paid", "failed", "refunded"];

admin.get("/orders", async (req, res) => {
  const { page, limit, offset } = paging(req);
  const where = [], args = [];
  if (ORDER_STATUS.includes(req.query.status)) { args.push(req.query.status); where.push(`o.status = $${args.length}`); }
  if (PAY_STATUS.includes(req.query.payment)) { args.push(req.query.payment); where.push(`o.payment_status = $${args.length}`); }
  if (req.query.q) {
    args.push(like(req.query.q));
    where.push(`(o.order_no ILIKE $${args.length} OR o.customer_name ILIKE $${args.length} OR o.customer_email ILIKE $${args.length} OR o.customer_phone ILIKE $${args.length})`);
  }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(`SELECT o.id, o.order_no, o.customer_name, o.customer_email, o.status, o.payment_status, o.payment_method,
                  o.total_kwd, o.currency, o.total_display, o.created_at,
                  (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id) AS items
             FROM orders o ${w} ORDER BY o.created_at DESC LIMIT ${limit} OFFSET ${offset}`, args),
    query(`SELECT COUNT(*) AS n FROM orders o ${w}`, args),
  ]);
  res.json({ items: rows, total: c.n, page, limit });
});

admin.get("/orders/:id", async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows } = await query(`SELECT * FROM orders WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound();
  const [items, events] = await Promise.all([
    query(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY id`, [id]),
    query(`SELECT e.*, u.email AS actor FROM order_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.order_id = $1 ORDER BY e.created_at, e.id`, [id]),
  ]);
  res.json({ order: rows[0], items: items.rows, events: events.rows });
});

const STATUS_MAIL = {
  confirmed: ["Your order is confirmed", "Your order has been confirmed and will soon enter production."],
  in_production: ["Your piece is being crafted", "Your piece has entered production. We will update you as soon as it is ready."],
  shipped: ["Your order is on its way", "Your order has been dispatched and is on its way to you."],
  delivered: ["Your order was delivered", "Your order has been delivered. We hope you love it."],
  cancelled: ["Your order was cancelled", "Your order has been cancelled. Please contact us if you have any questions."],
};

admin.patch("/orders/:id", async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(z.object({
    status: z.enum(ORDER_STATUS).optional(),
    paymentStatus: z.enum(PAY_STATUS).optional(),
    paymentRef: z.string().trim().max(120).nullish(),
    adminNotes: z.string().trim().max(2000).nullish(),
    note: z.string().trim().max(500).optional(),
  }), req.body);

  const result = await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [id]);
    const o = rows[0];
    if (!o) throw notFound();
    const sets = [], args = [id];
    const set = (col, v) => { args.push(v); sets.push(`${col} = $${args.length}`); };

    if (d.status && d.status !== o.status) {
      set("status", d.status);
      await c.query(`INSERT INTO order_events (order_id, kind, value, note, actor_id) VALUES ($1,'status',$2,$3,$4)`, [id, d.status, d.note ?? null, req.user.id]);
      const wasDead = ["cancelled", "refunded"].includes(o.status), nowDead = ["cancelled", "refunded"].includes(d.status);
      if (!wasDead && nowDead) // return reserved stock
        await c.query(`UPDATE products p SET stock = p.stock + x.q FROM (SELECT product_id, SUM(qty) AS q FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL GROUP BY product_id) x
                        WHERE p.id = x.product_id AND p.stock IS NOT NULL`, [id]);
      if (wasDead && !nowDead) { // re-reserving; refuse if it would oversell
        const r = await c.query(`UPDATE products p SET stock = p.stock - x.q FROM (SELECT product_id, SUM(qty) AS q FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL GROUP BY product_id) x
                        WHERE p.id = x.product_id AND p.stock IS NOT NULL AND p.stock >= x.q RETURNING p.id`, [id]);
        const need = await c.query(`SELECT COUNT(DISTINCT oi.product_id) AS n FROM order_items oi JOIN products p ON p.id = oi.product_id AND p.stock IS NOT NULL WHERE oi.order_id = $1`, [id]);
        if (r.rowCount !== need.rows[0].n) throw new HttpError(409, "Not enough stock to re-open this order", "out_of_stock");
      }
    }
    if (d.paymentStatus && d.paymentStatus !== o.payment_status) {
      set("payment_status", d.paymentStatus);
      if (d.paymentStatus === "paid") sets.push(`paid_at = now()`);
      await c.query(`INSERT INTO order_events (order_id, kind, value, note, actor_id) VALUES ($1,'payment',$2,$3,$4)`, [id, d.paymentStatus, d.note ?? null, req.user.id]);
    }
    if (d.paymentRef !== undefined) set("payment_ref", d.paymentRef || null);
    if (d.adminNotes !== undefined) set("admin_notes", d.adminNotes || null);
    if (d.note && !d.status && !d.paymentStatus)
      await c.query(`INSERT INTO order_events (order_id, kind, note, actor_id) VALUES ($1,'note',$2,$3)`, [id, d.note, req.user.id]);

    if (sets.length) await c.query(`UPDATE orders SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, args);
    return { before: o, newStatus: d.status && d.status !== o.status ? d.status : null };
  });

  await audit(req, "update", "order", result.before.order_no, { status: d.status, paymentStatus: d.paymentStatus });
  if (result.newStatus && STATUS_MAIL[result.newStatus]) {
    const [subject, body] = STATUS_MAIL[result.newStatus];
    sendMail({ to: result.before.customer_email, subject: `${subject} · ${result.before.order_no}`, text: `${body} (${result.before.order_no})`,
      html: layout(subject, p(`${escHtml(body)}<br><br>Order <b>${escHtml(result.before.order_no)}</b>`)) });
  }
  res.json({ ok: true });
});

/* ---------------- customers ---------------- */
admin.get("/customers", async (req, res) => {
  const { page, limit, offset } = paging(req);
  const args = [], where = [`u.role = 'customer'`];
  if (req.query.q) { args.push(like(req.query.q)); where.push(`(u.email ILIKE $1 OR u.full_name ILIKE $1 OR u.phone ILIKE $1)`); }
  const w = "WHERE " + where.join(" AND ");
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(`SELECT u.id, u.email, u.full_name, u.phone, u.is_active, u.marketing_opt_in, u.created_at, u.last_login_at,
                  (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders,
                  (SELECT COALESCE(SUM(total_kwd),0) FROM orders o WHERE o.user_id = u.id AND o.status NOT IN ('cancelled','refunded')) AS spent
             FROM users u ${w} ORDER BY u.created_at DESC LIMIT ${limit} OFFSET ${offset}`, args),
    query(`SELECT COUNT(*) AS n FROM users u ${w}`, args),
  ]);
  res.json({ items: rows, total: c.n, page, limit });
});

admin.get("/customers/:id", async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows } = await query(
    `SELECT id, email, full_name, phone, is_active, marketing_opt_in, created_at, last_login_at FROM users WHERE id = $1 AND role = 'customer'`, [id]);
  if (!rows[0]) throw notFound();
  const orders = await query(`SELECT id, order_no, status, payment_status, total_kwd, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC`, [id]);
  res.json({ customer: rows[0], orders: orders.rows });
});

admin.patch("/customers/:id", async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(z.object({ isActive: z.boolean() }), req.body);
  const r = await query(`UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1 AND role = 'customer'`, [id, d.isActive]);
  if (!r.rowCount) throw notFound();
  if (!d.isActive) await query(`DELETE FROM sessions WHERE user_id = $1`, [id]);
  await audit(req, d.isActive ? "activate" : "deactivate", "customer", id);
  res.json({ ok: true });
});

/* ---------------- appointments & bespoke ---------------- */
admin.get("/appointments", async (req, res) => {
  const { page, limit, offset } = paging(req, 50);
  const args = [], where = [];
  if (["new", "confirmed", "completed", "cancelled"].includes(req.query.status)) { args.push(req.query.status); where.push(`status = $1`); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(`SELECT * FROM appointments ${w} ORDER BY on_date DESC, at_time DESC LIMIT ${limit} OFFSET ${offset}`, args),
    query(`SELECT COUNT(*) AS n FROM appointments ${w}`, args),
  ]);
  res.json({ items: rows, total: c.n, page, limit });
});
admin.patch("/appointments/:id", async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(z.object({ status: z.enum(["new", "confirmed", "completed", "cancelled"]).optional(), adminNotes: z.string().trim().max(2000).nullish() }), req.body);
  const r = await query(`UPDATE appointments SET status = COALESCE($2, status), admin_notes = CASE WHEN $4 THEN $3 ELSE admin_notes END WHERE id = $1`,
    [id, d.status ?? null, d.adminNotes || null, d.adminNotes !== undefined]);
  if (!r.rowCount) throw notFound();
  await audit(req, "update", "appointment", id, { status: d.status });
  res.json({ ok: true });
});
admin.delete("/appointments/:id", async (req, res) => {
  const id = parse(uuid, req.params.id);
  await query(`DELETE FROM appointments WHERE id = $1`, [id]);
  await audit(req, "delete", "appointment", id);
  res.json({ ok: true });
});

const BESPOKE_STATUS = ["new", "in_review", "proposal_sent", "in_production", "completed", "cancelled"];
admin.get("/bespoke", async (req, res) => {
  const { page, limit, offset } = paging(req, 50);
  const args = [], where = [];
  if (BESPOKE_STATUS.includes(req.query.status)) { args.push(req.query.status); where.push(`status = $1`); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(`SELECT * FROM bespoke_requests ${w} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, args),
    query(`SELECT COUNT(*) AS n FROM bespoke_requests ${w}`, args),
  ]);
  res.json({ items: rows, total: c.n, page, limit });
});
admin.patch("/bespoke/:id", async (req, res) => {
  const id = parse(uuid, req.params.id);
  const d = parse(z.object({ status: z.enum(BESPOKE_STATUS).optional(), adminNotes: z.string().trim().max(2000).nullish() }), req.body);
  const r = await query(`UPDATE bespoke_requests SET status = COALESCE($2, status), admin_notes = CASE WHEN $4 THEN $3 ELSE admin_notes END WHERE id = $1`,
    [id, d.status ?? null, d.adminNotes || null, d.adminNotes !== undefined]);
  if (!r.rowCount) throw notFound();
  await audit(req, "update", "bespoke", id, { status: d.status });
  res.json({ ok: true });
});
// Customer reference photos are private: only a signed-in admin can fetch them, and only files listed on the request.
admin.get("/bespoke/:id/photos/:name", async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows } = await query(`SELECT photos FROM bespoke_requests WHERE id = $1`, [id]);
  const name = req.params.name;
  if (!rows[0] || !rows[0].photos.includes(name) || !/^[a-f0-9]{32}\.webp$/.test(name)) throw notFound();
  const file = path.join(config.privateDir, "bespoke", name);
  if (!fs.existsSync(file)) throw notFound();
  res.set("Cache-Control", "private, max-age=3600");
  res.type("image/webp").sendFile(file);
});

/* ---------------- subscribers ---------------- */
admin.get("/subscribers", async (req, res) => {
  const { page, limit, offset } = paging(req, 50);
  const args = [], where = [];
  if (req.query.q) { args.push(like(req.query.q)); where.push(`email ILIKE $1`); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(`SELECT * FROM subscribers ${w} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, args),
    query(`SELECT COUNT(*) AS n FROM subscribers ${w}`, args),
  ]);
  res.json({ items: rows, total: c.n, page, limit });
});
admin.get("/subscribers.csv", async (req, res) => {
  const { rows } = await query(`SELECT email, source, created_at FROM subscribers WHERE unsubscribed_at IS NULL ORDER BY created_at`);
  // neutralise spreadsheet formula injection (=, +, -, @) in user-supplied cells
  const cell = (v) => { const s = String(v ?? ""); return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`; };
  await audit(req, "export", "subscribers", null, { count: rows.length });
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="subscribers.csv"' });
  res.send("﻿email,source,subscribed_at\r\n" + rows.map((r) => [r.email, r.source, r.created_at.toISOString()].map(cell).join(",")).join("\r\n"));
});
admin.delete("/subscribers/:id", async (req, res) => {
  await query(`DELETE FROM subscribers WHERE id = $1`, [parseInt(req.params.id) || 0]);
  await audit(req, "delete", "subscriber", req.params.id);
  res.json({ ok: true });
});

/* ---------------- settings & audit ---------------- */
admin.get("/settings", async (_req, res) => {
  res.json({ rates: await getRates(), defaults: DEFAULT_RATES });
});
admin.put("/settings", async (req, res) => {
  const rate = z.number().positive().max(100000);
  const d = parse(z.object({ rates: z.object({ AED: rate, SAR: rate, QAR: rate, BHD: rate, OMR: rate, USD: rate }) }), req.body);
  await setSetting("rates", { KWD: 1, ...d.rates });
  await audit(req, "update", "settings", "rates", d.rates);
  res.json({ ok: true });
});

admin.get("/audit", async (req, res) => {
  const { page, limit, offset } = paging(req, 50);
  const [{ rows }, { rows: [c] }] = await Promise.all([
    query(`SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`),
    query(`SELECT COUNT(*) AS n FROM audit_log`),
  ]);
  res.json({ items: rows, total: c.n, page, limit });
});
