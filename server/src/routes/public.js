import { Router } from "express";
import path from "node:path";
import { z } from "zod";
import { query } from "../db.js";
import { config } from "../config.js";
import { HttpError, bad, clientIp, parse } from "../http.js";
import { orderLimiter, submitLimiter } from "../middleware.js";
import { publicCatalog } from "../services/catalog.js";
import { createOrder, orderSchema, phoneRx } from "../services/orders.js";
import { memoryUpload, saveImage } from "../services/images.js";
import { layout, p, sendMail } from "../services/mailer.js";
import { escHtml, safeEqual, sign } from "../security.js";

export const pub = Router();

pub.get("/catalog", async (_req, res) => {
  res.set("Cache-Control", "no-cache");
  res.json(await publicCatalog());
});

pub.post("/orders", orderLimiter, async (req, res) => {
  const input = parse(orderSchema, req.body);
  const o = await createOrder(input, req.user, clientIp(req));
  res.status(201).json({ orderNo: o.orderNo, total: o.total, currency: o.currency, totalDisplay: o.totalDisplay });
});

/* ---------- appointments ---------- */
const TIMES = ["11:00", "13:00", "17:00", "19:00", "21:00"];
pub.post("/appointments", submitLimiter, async (req, res) => {
  const d = parse(z.object({
    kind: z.enum(["video", "home"]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.enum(TIMES),
    name: z.string().trim().min(2).max(100),
    mobile: z.string().trim().regex(phoneRx, "invalid phone number"),
    piece: z.string().trim().max(150).optional(),
  }), req.body);
  const when = new Date(d.date + "T00:00:00Z").getTime();
  if (Number.isNaN(when) || when < Date.now() - 2 * 86400e3 || when > Date.now() + 90 * 86400e3) throw bad("date: choose a date within the next 90 days");
  await query(
    `INSERT INTO appointments (user_id, kind, on_date, at_time, name, mobile, piece) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req.user?.id ?? null, d.kind, d.date, d.time, d.name, d.mobile, d.piece || null]);
  if (config.mail.notifyTo)
    sendMail({
      to: config.mail.notifyTo, subject: `Appointment request · ${d.name}`,
      text: `${d.name} ${d.mobile} ${d.date} ${d.time} (${d.kind})`,
      html: layout("Appointment request", p(`${escHtml(d.name)} · ${escHtml(d.mobile)}<br>${escHtml(d.date)} at ${escHtml(d.time)} (${escHtml(d.kind)})${d.piece ? `<br>${escHtml(d.piece)}` : ""}`)),
    });
  res.status(201).json({ ok: true });
});

/* ---------- bespoke requests (reference photos are stored privately) ---------- */
const bespokeUpload = memoryUpload(6, 6);
pub.post("/bespoke", submitLimiter, bespokeUpload.array("photos", 6), async (req, res) => {
  const d = parse(z.object({
    pieceType: z.string().regex(/^[a-z0-9-]+$/).max(40),
    diamond: z.enum(["lab", "natural", "unsure"]),
    budget: z.string().trim().max(80).optional(),
    idea: z.string().trim().min(3).max(2000),
    name: z.string().trim().min(2).max(100),
    mobile: z.string().trim().regex(phoneRx, "invalid phone number"),
  }), req.body);
  const dir = path.join(config.privateDir, "bespoke");
  const photos = [];
  for (const f of req.files ?? []) photos.push(await saveImage(f.buffer, dir));
  await query(
    `INSERT INTO bespoke_requests (user_id, piece_type, diamond, budget, idea, name, mobile, photos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [req.user?.id ?? null, d.pieceType, d.diamond, d.budget || null, d.idea, d.name, d.mobile, photos]);
  if (config.mail.notifyTo)
    sendMail({
      to: config.mail.notifyTo, subject: `Bespoke request · ${d.name}`,
      text: `${d.name} ${d.mobile}: ${d.idea}`,
      html: layout("Bespoke request", p(`${escHtml(d.name)} · ${escHtml(d.mobile)}<br>${escHtml(d.pieceType)} · ${escHtml(d.diamond)} · ${escHtml(d.budget || "")}`) + p(escHtml(d.idea))),
    });
  res.status(201).json({ ok: true });
});

/* ---------- newsletter ---------- */
pub.post("/newsletter", submitLimiter, async (req, res) => {
  const d = parse(z.object({ email: z.string().trim().toLowerCase().max(200).pipe(z.email()) }), req.body);
  await query(
    `INSERT INTO subscribers (email) VALUES ($1)
     ON CONFLICT (lower(email)) DO UPDATE SET unsubscribed_at = NULL`, [d.email]);
  res.status(201).json({ ok: true });
});

export const unsubscribeLink = (email) =>
  `${config.publicUrl}/api/newsletter/unsubscribe?e=${encodeURIComponent(email)}&t=${sign("unsub:" + email.toLowerCase())}`;

pub.get("/newsletter/unsubscribe", async (req, res) => {
  const e = String(req.query.e || "").toLowerCase().slice(0, 200), t = String(req.query.t || "");
  if (!e || !safeEqual(t, sign("unsub:" + e))) throw new HttpError(400, "Invalid link");
  await query(`UPDATE subscribers SET unsubscribed_at = now() WHERE lower(email) = $1 AND unsubscribed_at IS NULL`, [e]);
  res.type("html").send(`<!doctype html><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0e1d17;color:#c9a66e;font-family:Helvetica,Arial,sans-serif;text-align:center"><div><h1 style="font-weight:300">You have been unsubscribed</h1><p>${escHtml(e)}</p><a href="/" style="color:#f2d48e">Back to the House</a></div>`);
});
