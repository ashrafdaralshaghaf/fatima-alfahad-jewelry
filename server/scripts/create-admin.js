// Usage: ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='long password' npm run create-admin
// If ADMIN_PASSWORD is omitted a strong random one is generated and printed once.
import crypto from "node:crypto";
import { migrate, pool, query } from "../src/db.js";
import { hashPassword } from "../src/security.js";

const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const name = process.env.ADMIN_NAME || "Store Admin";
if (!/^\S+@\S+\.\S+$/.test(email)) {
  console.error("Set ADMIN_EMAIL to a valid e-mail address.");
  process.exit(1);
}
let password = process.env.ADMIN_PASSWORD;
let generated = false;
if (!password) { password = crypto.randomBytes(15).toString("base64url"); generated = true; }
if (password.length < 10) { console.error("ADMIN_PASSWORD must be at least 10 characters."); process.exit(1); }

await migrate(() => {});
const hash = await hashPassword(password);
await query(
  `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,'admin')
   ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', is_active = true,
     failed_attempts = 0, locked_until = NULL, updated_at = now()`,
  [email, hash, name],
);
await query(`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE lower(email) = $1)`, [email]);
console.log(`Admin ready: ${email}`);
if (generated) console.log(`Generated password (shown once, store it safely): ${password}`);
await pool.end();
