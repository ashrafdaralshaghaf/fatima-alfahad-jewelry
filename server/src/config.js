import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = path.resolve(here, "..");
export const ROOT = path.resolve(here, "..", "..");            // project root (index.html, a/)

const env = process.env;
const isProd = env.NODE_ENV === "production";

function need(name) {
  const v = env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const config = {
  isProd,
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ""),
  databaseUrl: isProd
    ? need("DATABASE_URL")
    : env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:54329/fatima",
  dbSsl: env.DATABASE_SSL === "true",
  // Signs unsubscribe links. Must be long and random in production.
  appSecret: (() => {
    const s = env.APP_SECRET || "";
    if (isProd && s.length < 32) throw new Error("APP_SECRET must be set (32+ random characters) in production");
    return s || "dev-only-secret-change-me-dev-only-secret";
  })(),
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : 0,
  cookieSecure: isProd || (env.PUBLIC_URL || "").startsWith("https://"),
  uploadsDir: path.resolve(SERVER_DIR, env.UPLOADS_DIR || "uploads"),
  privateDir: path.resolve(SERVER_DIR, env.PRIVATE_DIR || "private"),
  adminDist: path.resolve(ROOT, "admin", "dist"),
  mail: {
    host: env.SMTP_HOST || "",
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === "true",
    user: env.SMTP_USER || "",
    pass: env.SMTP_PASS || "",
    from: env.MAIL_FROM || "Fatima Alfahad Jewelry <no-reply@localhost>",
    notifyTo: env.ORDER_NOTIFY_EMAIL || "",
  },
  session: { customerDays: 30, adminHours: 12 },
};
