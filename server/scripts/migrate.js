import { migrate, pool } from "../src/db.js";

await migrate();
console.log("Database is up to date.");
await pool.end();
