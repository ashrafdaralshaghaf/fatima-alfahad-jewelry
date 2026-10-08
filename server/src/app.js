import express from "express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config, ROOT } from "./config.js";
import { pool } from "./db.js";
import { errorHandler, HttpError } from "./http.js";
import { apiLimiter, csrf, loadUser } from "./middleware.js";
import { auth } from "./routes/auth.js";
import { me } from "./routes/me.js";
import { pub } from "./routes/public.js";
import { admin } from "./routes/admin.js";

const INDEX = path.join(ROOT, "index.html");

/* The storefront keeps its script inline. Instead of allowing 'unsafe-inline' for scripts, the CSP lists the
   exact SHA-256 of every inline <script> block, recomputed whenever index.html changes. */
let cspCache = { mtime: 0, header: "", html: "" };
function storefront() {
  const mtime = fs.statSync(INDEX).mtimeMs;
  if (mtime !== cspCache.mtime) {
    const html = fs.readFileSync(INDEX, "utf8");
    const hashes = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((m) => `'sha256-${crypto.createHash("sha256").update(m[1]).digest("base64")}'`);
    cspCache = { mtime, html, header: buildCsp(hashes) };
  }
  return cspCache;
}
function buildCsp(scriptHashes = []) {
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(config.cookieSecure ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: false, // set explicitly below (needs per-file script hashes)
    crossOriginEmbedderPolicy: false,
    hsts: config.cookieSecure ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }));
  app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    next();
  });
  app.use(compression());

  /* ---------- API ---------- */
  const api = express.Router();
  api.use((req, res, next) => { res.set("Cache-Control", "no-store"); res.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"); next(); });
  api.use(apiLimiter);
  api.use(express.json({ limit: "100kb" }));
  api.use(cookieParser());
  api.use(csrf);
  api.use(loadUser);

  api.get("/health", async (_req, res) => { await pool.query("SELECT 1"); res.json({ ok: true }); });
  api.use("/auth", auth);
  api.use("/me", me);
  api.use("/admin", admin);
  api.use(pub);
  api.use((_req, _res, next) => next(new HttpError(404, "Not found")));
  app.use("/api", api);

  /* ---------- static: uploads, brand assets ---------- */
  app.use("/uploads", express.static(config.uploadsDir, {
    index: false, dotfiles: "ignore", maxAge: "30d", immutable: true, fallthrough: false,
    setHeaders: (res) => { res.set("Content-Security-Policy", "default-src 'none'"); res.set("X-Content-Type-Options", "nosniff"); },
  }));
  app.use("/a", express.static(path.join(ROOT, "a"), { index: false, dotfiles: "ignore", maxAge: "7d", fallthrough: false }));

  app.get("/robots.txt", (_req, res) => res.type("text/plain").send("User-agent: *\nDisallow: /admin\nDisallow: /api\n"));

  /* ---------- admin dashboard (React build) ---------- */
  const adminHtml = () => path.join(config.adminDist, "index.html");
  const adminCsp = buildCsp();
  app.use("/admin", (req, res, next) => { res.set("Content-Security-Policy", adminCsp); res.set("X-Robots-Tag", "noindex"); next(); });
  app.use("/admin", express.static(config.adminDist, { index: false, dotfiles: "ignore", maxAge: "1h" }));
  app.get(/^\/admin(\/.*)?$/, (req, res) => {
    if (!fs.existsSync(adminHtml())) return res.status(503).type("text").send("Admin dashboard is not built yet. Run: npm run build:admin");
    res.set("Cache-Control", "no-cache");
    res.sendFile(adminHtml());
  });

  /* ---------- storefront ---------- */
  app.get(["/", "/index.html"], (_req, res) => {
    const s = storefront();
    res.set("Content-Security-Policy", s.header);
    res.set("Cache-Control", "no-cache");
    res.type("html").send(s.html);
  });

  app.use((_req, res) => res.status(404).type("text").send("Not found"));
  app.use(errorHandler);
  return app;
}
