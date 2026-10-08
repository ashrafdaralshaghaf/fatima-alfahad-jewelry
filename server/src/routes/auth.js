import { Router } from "express";
import { z } from "zod";
import { query, tx } from "../db.js";
import { HttpError, bad, parse } from "../http.js";
import { authLimiter, createSession, destroySession, requireUser } from "../middleware.js";
import { dummyVerify, hashPassword, randomToken, sha256, verifyPassword } from "../security.js";
import { config } from "../config.js";
import { layout, p, sendMail } from "../services/mailer.js";
import { phoneRx } from "../services/orders.js";

export const auth = Router();

const email = z.string().trim().toLowerCase().max(200).pipe(z.email());
const password = z.string().min(8, "at least 8 characters").max(128)
  .refine((v) => /[A-Za-z؀-ۿ]/.test(v) && /\d/.test(v), "must contain a letter and a number");

const publicUser = (u) => ({ id: u.id, email: u.email, fullName: u.full_name ?? u.fullName, phone: u.phone ?? null, role: u.role, marketing: u.marketing_opt_in ?? u.marketing ?? false });

auth.post("/register", authLimiter, async (req, res) => {
  const d = parse(z.object({
    fullName: z.string().trim().min(2).max(100),
    email, password,
    phone: z.string().trim().regex(phoneRx, "invalid phone number").optional().or(z.literal("")),
    marketing: z.boolean().optional(),
  }), req.body);

  const hash = await hashPassword(d.password);
  let user;
  try {
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, full_name, phone, marketing_opt_in)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [d.email, hash, d.fullName, d.phone || null, !!d.marketing],
    );
    user = rows[0];
  } catch (e) {
    if (e.code === "23505") throw new HttpError(409, "An account with this email already exists", "email_taken");
    throw e;
  }
  if (d.marketing)
    await query(`INSERT INTO subscribers (email, source) VALUES ($1,'register')
                 ON CONFLICT (lower(email)) DO UPDATE SET unsubscribed_at = NULL`, [d.email]);
  await createSession(req, res, user);
  res.status(201).json({ user: publicUser(user) });
});

const MAX_FAILS = 5, LOCK_MIN = 15;

auth.post("/login", authLimiter, async (req, res) => {
  const d = parse(z.object({ email, password: z.string().min(1).max(128) }), req.body);
  const { rows } = await query(`SELECT * FROM users WHERE lower(email) = $1`, [d.email]);
  const u = rows[0];
  const generic = new HttpError(401, "Incorrect email or password", "bad_credentials");

  if (!u || !u.is_active) { await dummyVerify(d.password); throw generic; }
  if (u.locked_until && new Date(u.locked_until) > new Date())
    throw new HttpError(429, "Too many failed attempts. Try again in a few minutes or reset your password.", "locked");

  if (!(await verifyPassword(d.password, u.password_hash))) {
    const fails = u.failed_attempts + 1;
    const lock = fails >= MAX_FAILS;
    await query(
      `UPDATE users SET failed_attempts = $2::int,
         locked_until = CASE WHEN $3::boolean THEN now() + make_interval(mins => $4::int) ELSE locked_until END
       WHERE id = $1`,
      [u.id, lock ? 0 : fails, lock, LOCK_MIN],
    );
    throw generic;
  }
  await query(`UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [u.id]);
  await createSession(req, res, u);
  res.json({ user: publicUser(u) });
});

auth.post("/logout", async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

auth.get("/me", (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

auth.post("/forgot", authLimiter, async (req, res) => {
  const d = parse(z.object({ email }), req.body);
  const { rows } = await query(`SELECT id, full_name FROM users WHERE lower(email) = $1 AND is_active`, [d.email]);
  if (rows[0]) {
    const token = randomToken(32);
    await tx(async (c) => {
      await c.query(`DELETE FROM password_resets WHERE user_id = $1`, [rows[0].id]);
      await c.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 hour')`,
        [rows[0].id, sha256(token)],
      );
    });
    // The token travels in the URL fragment, so it is never sent to servers or leaked via Referer.
    const link = `${config.publicUrl}/#reset-${token}`;
    sendMail({
      to: d.email,
      subject: "Reset your password",
      text: `Reset your password: ${link}\nThis link expires in one hour.`,
      html: layout("Reset your password",
        p("Use the button below to choose a new password. The link expires in one hour. If you did not ask for this, you can ignore this e-mail.") +
        `<p><a href="${link}" style="display:inline-block;padding:14px 28px;border:1px solid #c9a66e;color:#f2d48e;text-decoration:none;letter-spacing:.15em;font-size:12px;text-transform:uppercase">Choose a new password</a></p>`),
    });
  }
  // Same answer whether or not the account exists.
  res.json({ ok: true });
});

auth.post("/reset", authLimiter, async (req, res) => {
  const d = parse(z.object({ token: z.string().min(20).max(100), password }), req.body);
  const hash = await hashPassword(d.password);
  const ok = await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE password_resets SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [sha256(d.token)],
    );
    if (!rows[0]) return false;
    await c.query(`UPDATE users SET password_hash = $2, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1`, [rows[0].user_id, hash]);
    await c.query(`DELETE FROM sessions WHERE user_id = $1`, [rows[0].user_id]); // sign out everywhere
    return true;
  });
  if (!ok) throw bad("This reset link is invalid or has expired", "bad_token");
  res.json({ ok: true });
});

auth.post("/change-password", requireUser, async (req, res) => {
  const d = parse(z.object({ current: z.string().min(1).max(128), password }), req.body);
  const { rows } = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
  if (!(await verifyPassword(d.current, rows[0].password_hash))) throw new HttpError(400, "Current password is incorrect", "bad_credentials");
  await query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [req.user.id, await hashPassword(d.password)]);
  await query(`DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, [req.user.id, req.sessionId]);
  res.json({ ok: true });
});
