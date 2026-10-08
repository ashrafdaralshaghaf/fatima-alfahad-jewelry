import crypto from "node:crypto";
import { z } from "zod";
import { tx } from "../db.js";
import { HttpError, bad } from "../http.js";
import { config } from "../config.js";
import { displayAmount, getRates, round3 } from "./common.js";
import { layout, p, sendMail } from "./mailer.js";
import { escHtml } from "../security.js";

export const COUNTRIES = {
  KWD: "Kuwait", AED: "United Arab Emirates", SAR: "Saudi Arabia", QAR: "Qatar", BHD: "Bahrain", OMR: "Oman",
};

const text = (max) => z.string().trim().min(1).max(max);
export const phoneRx = /^\+?[0-9][0-9\s\-()]{5,19}$/;

const item = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(80),
  size: z.number().int().min(1).max(100).nullish(),
  dia: z.enum(["lab", "natural"]).nullish(),
  engr: z.string().trim().max(10).regex(/^[\p{L}\p{N} ·.\-/&']*$/u).optional(),
  gift: z.boolean().optional(),
  qty: z.number().int().min(1).max(10),
});

export const orderSchema = z.object({
  items: z.array(item).min(1).max(30),
  name: text(100),
  mobile: z.string().trim().regex(phoneRx, "invalid phone number"),
  email: z.string().trim().toLowerCase().max(200).pipe(z.email()),
  country: z.enum(Object.keys(COUNTRIES)),
  area: text(100),
  block: text(30),
  street: text(120),
  house: text(60),
  avenue: z.string().trim().max(100).optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  message: z.string().trim().max(160).optional(),
  payment: z.enum(["whatsapp", "knet", "card"]).default("whatsapp"),
  currency: z.enum(["KWD", "AED", "SAR", "QAR", "BHD", "OMR", "USD"]).default("KWD"),
  lang: z.enum(["en", "ar"]).default("en"),
  agree: z.literal(true, { error: "You must accept the terms" }),
});

const orderNo = () => "FA-" + crypto.randomInt(100000, 1000000);

function checkDeliveryDate(s) {
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) throw bad("deliveryDate: invalid date");
  const today = Date.now();
  const diffDays = (d.getTime() - today) / 86400e3;
  if (diffDays < -1 || diffDays > 60) throw bad("deliveryDate: choose a date within the next 60 days");
}

async function insertOrder(input, user, ip) {
  const rates = await getRates();
  return tx(async (c) => {
    const ids = [...new Set(input.items.map((i) => i.id))];
    const { rows: prods } = await c.query(
      `SELECT p.*, c.sizes, c.size_kind, c.engravable, c.default_size, c.is_active AS cat_active,
              (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) AS image
         FROM products p JOIN categories c ON c.slug = p.category
        WHERE p.id = ANY($1) FOR UPDATE OF p`,
      [ids],
    );
    const byId = new Map(prods.map((r) => [r.id, r]));

    const lines = [];
    const wanted = new Map();
    for (const it of input.items) {
      const pr = byId.get(it.id);
      if (!pr || !pr.is_active || !pr.cat_active) throw new HttpError(409, "One of the pieces in your bag is no longer available", "unavailable");

      let size = it.size ?? null;
      if (pr.size_kind === "ring") {
        if (size == null || !pr.sizes.includes(size)) throw bad(`Please choose a valid size for ${pr.name_en}`);
      } else if (pr.size_kind === "length") {
        size = size ?? pr.default_size;
        if (size != null && pr.sizes.length && !pr.sizes.includes(size)) throw bad(`Invalid length for ${pr.name_en}`);
      } else size = null;

      let dia = null;
      if (pr.natural_price_kwd != null) dia = it.dia ?? "lab";
      else if (it.dia === "natural") throw bad(`${pr.name_en} is not available with a natural diamond`);

      const unit = dia === "natural" ? pr.natural_price_kwd : pr.price_kwd;
      const engraving = pr.engravable && it.engr ? it.engr : null;
      lines.push({ pr, size, dia, unit, engraving, gift: it.gift !== false, qty: it.qty });
      wanted.set(pr.id, (wanted.get(pr.id) ?? 0) + it.qty);
    }

    for (const [id, qty] of wanted) {
      const pr = byId.get(id);
      if (pr.stock !== null) {
        if (pr.stock < qty) throw new HttpError(409, `${pr.name_en} is currently out of stock`, "out_of_stock");
        await c.query(`UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1`, [id, qty]);
      }
    }

    const subtotal = round3(lines.reduce((a, l) => a + l.unit * l.qty, 0));
    const shipping = 0; // complimentary delivery, as promised on the storefront
    const total = round3(subtotal + shipping);
    const rate = rates[input.currency] ?? 1;
    const no = orderNo();

    const { rows } = await c.query(
      `INSERT INTO orders (order_no, user_id, payment_method, customer_name, customer_phone, customer_email,
         country, area, block, street, house, avenue, delivery_date, gift_message, currency, fx_rate,
         subtotal_kwd, shipping_kwd, total_kwd, total_display, lang, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING id, order_no, created_at`,
      [no, user?.id ?? null, input.payment, input.name, input.mobile, input.email,
        COUNTRIES[input.country], input.area, input.block, input.street, input.house, input.avenue || null,
        input.deliveryDate, input.message || null, input.currency, rate,
        subtotal, shipping, total, displayAmount(total, input.currency, rates), input.lang, ip],
    );
    const order = rows[0];

    for (const l of lines) {
      await c.query(
        `INSERT INTO order_items (order_id, product_id, name_en, name_ar, image, unit_price_kwd, qty, size, diamond, engraving, gift_wrap)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [order.id, l.pr.id, l.pr.name_en, l.pr.name_ar, l.pr.image, l.unit, l.qty, l.size, l.dia, l.engraving, l.gift],
      );
    }
    await c.query(`INSERT INTO order_events (order_id, kind, value) VALUES ($1,'created','pending')`, [order.id]);

    return { id: order.id, orderNo: order.order_no, total, currency: input.currency, totalDisplay: displayAmount(total, input.currency, rates), lines };
  });
}

export async function createOrder(input, user, ip) {
  checkDeliveryDate(input.deliveryDate);
  let out;
  for (let attempt = 0; ; attempt++) {
    try {
      out = await insertOrder(input, user, ip);
      break;
    } catch (e) {
      // extremely unlikely order-number collision: just draw a new number
      if (e?.code === "23505" && String(e.constraint).includes("order_no") && attempt < 4) continue;
      throw e;
    }
  }
  sendOrderEmails(input, out).catch(() => {});
  return out;
}

const fmt = (n, cur) => `${cur} ${Number(n).toLocaleString("en-US")}`;

async function sendOrderEmails(input, o) {
  const rows = o.lines.map((l) =>
    `<tr><td style="padding:6px 0;color:#c9a66e">${escHtml(l.pr.name_en)} × ${l.qty}${l.size ? ` · ${l.size}` : ""}${l.dia ? ` · ${escHtml(l.dia)}` : ""}${l.engraving ? ` · “${escHtml(l.engraving)}”` : ""}</td>
     <td align="right" style="padding:6px 0;color:#c9a66e">KWD ${(l.unit * l.qty).toFixed(3)}</td></tr>`).join("");
  const items = `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-top:1px solid #3a4a3f;margin:18px 0">${rows}
    <tr><td style="padding-top:12px;border-top:1px solid #3a4a3f;color:#f2d48e">Total</td><td align="right" style="padding-top:12px;border-top:1px solid #3a4a3f;color:#f2d48e">${escHtml(fmt(o.totalDisplay, o.currency))}</td></tr></table>`;
  const ar = input.lang === "ar";
  await sendMail({
    to: input.email,
    subject: ar ? `تأكيد طلبكِ ${o.orderNo}` : `Your order ${o.orderNo}`,
    text: `Thank you ${input.name}. Order ${o.orderNo} received.`,
    html: layout(ar ? "شكرًا لكِ" : "Thank you",
      p(ar ? `استلمنا طلبكِ رقم <b>${o.orderNo}</b>. سنتواصل معكِ عبر الواتساب لترتيب الدفع والتوصيل.` : `We have received your order <b>${o.orderNo}</b>. We will contact you on WhatsApp to arrange payment and delivery.`) + items),
  });
  if (config.mail.notifyTo)
    await sendMail({
      to: config.mail.notifyTo,
      subject: `New order ${o.orderNo} · ${fmt(o.totalDisplay, o.currency)}`,
      text: `New order ${o.orderNo} from ${input.name} (${input.email}, ${input.mobile})`,
      html: layout("New order", p(`${escHtml(o.orderNo)} from ${escHtml(input.name)}<br>${escHtml(input.email)} · ${escHtml(input.mobile)}`) + items +
        p(`<a style="color:#f2d48e" href="${config.publicUrl}/admin/orders">Open in dashboard</a>`)),
    });
}
