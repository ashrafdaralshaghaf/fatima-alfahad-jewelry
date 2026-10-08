// Local development only: runs a real PostgreSQL server (no Docker / install needed).
// In production use a managed PostgreSQL and set DATABASE_URL instead.
import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, "..", ".pgdata");
const port = Number(process.env.DEV_DB_PORT || 54329);
const fresh = !fs.existsSync(path.join(dataDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  onLog: () => {},
  onError: (e) => console.error(String(e)),
});

if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("fatima");
console.log(`PostgreSQL ready: postgres://postgres:postgres@127.0.0.1:${port}/fatima`);

const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
