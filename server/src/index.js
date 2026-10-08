import fs from "node:fs";
import { config } from "./config.js";
import { migrate, pool, query } from "./db.js";
import { createApp } from "./app.js";

fs.mkdirSync(config.uploadsDir, { recursive: true });
fs.mkdirSync(config.privateDir, { recursive: true });

if (process.env.AUTO_MIGRATE !== "false") await migrate();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Fatima Alfahad Jewelry running on ${config.publicUrl}  (storefront /, dashboard /admin, API /api)`);
});

// housekeeping: drop expired sessions and reset tokens
const sweep = () =>
  Promise.all([
    query(`DELETE FROM sessions WHERE expires_at < now()`),
    query(`DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'`),
  ]).catch((e) => console.error("[sweep]", e.message));
sweep();
setInterval(sweep, 60 * 60e3).unref();

async function shutdown() {
  server.close(async () => { await pool.end().catch(() => {}); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
