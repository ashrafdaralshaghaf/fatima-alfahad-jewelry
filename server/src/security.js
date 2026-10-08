import crypto from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.js";

const scrypt = promisify(crypto.scrypt);
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 64;

/** scrypt password hash: scrypt$N$r$p$salt$hash (all parameters stored so they can be raised later). */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [alg, n, r, p, salt, hash] = stored.split("$");
    if (alg !== "scrypt") return false;
    const expected = Buffer.from(hash, "base64");
    const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, {
      N: +n, r: +r, p: +p, maxmem: 128 * +n * +r * 2,
    });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// Used to burn the same CPU time when a login names an unknown account (prevents user enumeration by timing).
let dummy;
export async function dummyVerify(password) {
  dummy ??= await hashPassword("dummy-password-for-timing");
  await verifyPassword(password, dummy);
}

export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

export function sign(value) {
  return crypto.createHmac("sha256", config.appSecret).update(value).digest("base64url");
}
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Escape text for HTML e-mails. */
export const escHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
