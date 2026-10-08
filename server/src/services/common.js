import { query } from "../db.js";
import { clientIp } from "../http.js";

export const DEFAULT_RATES = { KWD: 1, AED: 11.95, SAR: 12.2, QAR: 11.85, BHD: 1.226, OMR: 1.253, USD: 3.25 };

export async function getSetting(key, fallback) {
  const { rows } = await query(`SELECT value FROM settings WHERE key = $1`, [key]);
  return rows[0] ? rows[0].value : fallback;
}
export async function setSetting(key, value) {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
export const getRates = async () => ({ ...DEFAULT_RATES, ...(await getSetting("rates", {})) });

/** Mirrors the storefront's money() rounding so the order total matches what the customer saw. */
export function displayAmount(kwd, currency, rates) {
  const v = kwd * (rates[currency] ?? 1);
  return ["KWD", "BHD", "OMR"].includes(currency) ? Math.round(v) : Math.round(v / 10) * 10;
}

export const round3 = (n) => Math.round(n * 1000) / 1000;

/** Writes an admin audit entry. Never throws. */
export async function audit(req, action, entity, entityId, details) {
  try {
    await query(
      `INSERT INTO audit_log (actor_id, actor_email, action, entity, entity_id, details, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.user?.id ?? null, req.user?.email ?? null, action, entity, entityId == null ? null : String(entityId),
        details ? JSON.stringify(details) : null, clientIp(req)],
    );
  } catch (e) {
    console.error("[audit] failed:", e.message);
  }
}
