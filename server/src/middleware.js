import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { query } from "./db.js";
import { HttpError, clientIp } from "./http.js";
import { randomToken, sha256 } from "./security.js";

export const COOKIE = config.cookieSecure ? "__Host-fa_sid" : "fa_sid";

/* ---------------- sessions ---------------- */

export async function createSession(req, res, user) {
  const token = randomToken(32);
  const ms = user.role === "admin" ? config.session.adminHours * 3600e3 : config.session.customerDays * 86400e3;
  const expires = new Date(Date.now() + ms);
  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)`,
    [user.id, sha256(token), expires, clientIp(req), String(req.get("user-agent") || "").slice(0, 300)],
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function destroySession(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) await query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  res.clearCookie(COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: "/" });
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export async function loadUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE];
  if (!token || typeof token !== "string" || token.length > 100) return next();
  const { rows } = await query(
    `SELECT s.id AS sid, s.last_seen_at, u.id, u.email, u.full_name, u.phone, u.role, u.marketing_opt_in
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`,
    [sha256(token)],
  );
  const r = rows[0];
  if (r) {
    req.user = { id: r.id, email: r.email, fullName: r.full_name, phone: r.phone, role: r.role, marketing: r.marketing_opt_in };
    req.sessionId = r.sid;
    if (Date.now() - new Date(r.last_seen_at).getTime() > 10 * 60e3)
      query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [r.sid]).catch(() => {});
  }
  next();
}

export const requireUser = (req, _res, next) =>
  req.user ? next() : next(new HttpError(401, "Please sign in", "auth_required"));

export const requireAdmin = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, "Please sign in", "auth_required"));
  if (req.user.role !== "admin") return next(new HttpError(403, "Forbidden", "forbidden"));
  next();
};

/* ---------------- CSRF ---------------- */
// Cookies are SameSite=Lax; on top of that every state-changing request must (1) carry a custom header,
// which browsers will not send cross-origin without a CORS preflight (we serve no CORS), and
// (2) come from our own origin when the browser tells us the origin.
export function csrf(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = ""; }
    if (host !== req.get("host")) return next(new HttpError(403, "Cross-origin request blocked", "csrf"));
  }
  if (req.get("sec-fetch-site") === "cross-site") return next(new HttpError(403, "Cross-origin request blocked", "csrf"));
  if (req.get("x-requested-with") !== "fetch") return next(new HttpError(403, "Missing request header", "csrf"));
  next();
}

/* ---------------- rate limits ---------------- */

const limiter = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => !config.isProd && process.env.DISABLE_RATE_LIMIT === "1", // tests only; ignored in production
    message: { error: message, code: "rate_limited" },
  });

export const apiLimiter = limiter(60e3, 300, "Too many requests, please slow down.");
export const authLimiter = limiter(15 * 60e3, 20, "Too many attempts. Please try again in a few minutes.");
export const submitLimiter = limiter(60 * 60e3, 15, "Too many submissions. Please try again later.");
export const orderLimiter = limiter(60 * 60e3, 20, "Too many orders from this connection. Please contact us.");
export const adminLimiter = limiter(60e3, 600, "Too many requests.");
