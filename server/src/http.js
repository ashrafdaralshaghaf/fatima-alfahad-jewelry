import { ZodError } from "zod";
import { config } from "./config.js";

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const bad = (msg, code) => new HttpError(400, msg, code);
export const notFound = (msg = "Not found") => new HttpError(404, msg);

/** Validates req.body / req.query with a zod schema and returns the parsed value. */
export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    const field = first.path.join(".") || "request";
    throw new HttpError(400, `${field}: ${first.message}`, "validation");
  }
  return r.data;
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof ZodError) return res.status(400).json({ error: "Invalid request", code: "validation" });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request too large" });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON" });
  if (err?.name === "MulterError") return res.status(400).json({ error: `Upload error: ${err.message}` });
  if (err?.status >= 400 && err?.status < 500) return res.status(err.status).json({ error: err.status === 404 ? "Not found" : "Bad request" }); // e.g. static-file 404s
  if (err?.code === "23505") return res.status(409).json({ error: "Already exists", code: "duplicate" });
  if (err?.code === "23503") return res.status(409).json({ error: "Referenced by other records", code: "in_use" });
  console.error(`[error] ${req.method} ${req.path}:`, config.isProd ? err?.message : err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
}

export const clientIp = (req) => req.ip || req.socket?.remoteAddress || "";
