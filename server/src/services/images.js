import sharp from "sharp";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { HttpError } from "../http.js";

const ALLOWED = new Set(["jpeg", "png", "webp"]);

/**
 * Never trust the browser-supplied mime type or file name. The bytes are decoded with sharp,
 * the real format is checked, and the image is re-encoded to WebP (which also strips EXIF/GPS data
 * and anything hidden in the file). The stored name is random.
 */
export async function saveImage(buffer, dir) {
  let pipeline;
  try {
    pipeline = sharp(buffer, { limitInputPixels: 50e6, failOn: "error" });
    const meta = await pipeline.metadata();
    if (!ALLOWED.has(meta.format)) throw new Error("format");
  } catch {
    throw new HttpError(400, "Only JPEG, PNG or WebP images are accepted", "bad_image");
  }
  const name = crypto.randomBytes(16).toString("hex") + ".webp";
  await fs.mkdir(dir, { recursive: true });
  await pipeline
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 84 })
    .toFile(path.join(dir, name));
  return name;
}

export const memoryUpload = (maxFiles, maxMb) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { files: maxFiles, fileSize: maxMb * 1024 * 1024, fields: 20, fieldSize: 20_000 },
    fileFilter: (_req, file, cb) =>
      /^image\/(jpeg|png|webp)$/.test(file.mimetype) ? cb(null, true) : cb(new HttpError(400, "Only JPEG, PNG or WebP images are accepted", "bad_image")),
  });

/** Only our own static / upload paths may be stored as image URLs. */
export const IMAGE_URL = /^\/(uploads|a)\/[A-Za-z0-9._-]{1,120}$/;
