import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { parse } from "../http.js";
import { requireUser } from "../middleware.js";
import { phoneRx } from "../services/orders.js";

export const me = Router();
me.use(requireUser);

me.patch("/", async (req, res) => {
  const d = parse(z.object({
    fullName: z.string().trim().min(2).max(100),
    phone: z.string().trim().regex(phoneRx, "invalid phone number").optional().or(z.literal("")),
    marketing: z.boolean().optional(),
  }), req.body);
  const { rows } = await query(
    `UPDATE users SET full_name = $2, phone = $3, marketing_opt_in = COALESCE($4, marketing_opt_in), updated_at = now()
      WHERE id = $1 RETURNING id, email, full_name, phone, role, marketing_opt_in`,
    [req.user.id, d.fullName, d.phone || null, d.marketing ?? null],
  );
  const u = rows[0];
  if (d.marketing === true)
    await query(`INSERT INTO subscribers (email, source) VALUES ($1,'account')
                 ON CONFLICT (lower(email)) DO UPDATE SET unsubscribed_at = NULL`, [u.email]);
  if (d.marketing === false)
    await query(`UPDATE subscribers SET unsubscribed_at = now() WHERE lower(email) = lower($1) AND unsubscribed_at IS NULL`, [u.email]);
  res.json({ user: { id: u.id, email: u.email, fullName: u.full_name, phone: u.phone, role: u.role, marketing: u.marketing_opt_in } });
});

me.get("/orders", async (req, res) => {
  const { rows: orders } = await query(
    `SELECT id, order_no, status, payment_status, payment_method, currency, total_kwd, total_display, delivery_date, created_at
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [req.user.id]);
  const { rows: items } = await query(
    `SELECT order_id, product_id, name_en, name_ar, image, unit_price_kwd, qty, size, diamond, engraving
       FROM order_items WHERE order_id = ANY($1) ORDER BY id`, [orders.map((o) => o.id)]);
  res.json({
    orders: orders.map((o) => ({
      id: o.id, no: o.order_no, status: o.status, paymentStatus: o.payment_status, paymentMethod: o.payment_method,
      currency: o.currency, total: o.total_kwd, totalDisplay: o.total_display, deliveryDate: o.delivery_date, createdAt: o.created_at,
      items: items.filter((i) => i.order_id === o.id).map((i) => ({
        id: i.product_id, name: { en: i.name_en, ar: i.name_ar }, image: i.image, price: i.unit_price_kwd,
        qty: i.qty, size: i.size, dia: i.diamond, engr: i.engraving,
      })),
    })),
  });
});

/* wishlist (synced for signed-in customers; guests keep it in localStorage) */
me.get("/wishlist", async (req, res) => {
  const { rows } = await query(`SELECT product_id FROM wishlists WHERE user_id = $1 ORDER BY created_at`, [req.user.id]);
  res.json({ ids: rows.map((r) => r.product_id) });
});

const ids = z.object({ ids: z.array(z.string().regex(/^[a-z0-9-]+$/).max(80)).max(200) });

me.put("/wishlist", async (req, res) => {
  // merge: add whatever the guest saved before signing in, ignoring products that no longer exist
  const d = parse(ids, req.body);
  if (d.ids.length)
    await query(
      `INSERT INTO wishlists (user_id, product_id)
       SELECT $1, id FROM products WHERE id = ANY($2) ON CONFLICT DO NOTHING`, [req.user.id, d.ids]);
  const { rows } = await query(`SELECT product_id FROM wishlists WHERE user_id = $1 ORDER BY created_at`, [req.user.id]);
  res.json({ ids: rows.map((r) => r.product_id) });
});

me.post("/wishlist/:id", async (req, res) => {
  await query(`INSERT INTO wishlists (user_id, product_id) SELECT $1, id FROM products WHERE id = $2 ON CONFLICT DO NOTHING`, [req.user.id, req.params.id]);
  res.json({ ok: true });
});
me.delete("/wishlist/:id", async (req, res) => {
  await query(`DELETE FROM wishlists WHERE user_id = $1 AND product_id = $2`, [req.user.id, req.params.id]);
  res.json({ ok: true });
});
