import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { config, SERVER_DIR } from "./config.js";

// numeric -> JS number (KWD has 3 decimals; safe in double precision), bigint -> number
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// keep DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  statement_timeout: 15_000,
});
pool.on("error", (e) => console.error("[db] idle client error:", e.message));

export const query = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Applies every migrations/*.sql file that has not run yet, in filename order. */
export async function migrate(log = console.log) {
  const dir = path.join(SERVER_DIR, "migrations");
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await tx(async (c) => {
      await c.query(sql);
      await c.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [f]);
    });
    log(`migrated ${f}`);
  }
}
