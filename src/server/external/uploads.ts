import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR } from "@/server/services/ingest";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const UPLOAD_TTL_SEC = 15 * 60;

const MIME_EXT: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/aac": "m4a",
};
const EXTS = ["mp3", "wav", "m4a"];
export const KEY_RE = /^[a-z0-9-]+\.(mp3|wav|m4a)$/;

/** File extension from the MIME type, falling back to the filename; null when unsupported. */
export function audioExt(filename: string, contentType: string): string | null {
  const byType = MIME_EXT[contentType.toLowerCase().split(";")[0].trim()];
  if (byType) return byType;
  const byName = path.extname(filename).slice(1).toLowerCase();
  return EXTS.includes(byName) ? byName : null;
}

const secret = () => process.env.UPLOAD_SIGNING_SECRET ?? process.env.DEMO_API_KEY ?? "dev-upload-secret";
const sign = (key: string, expires: number) => createHmac("sha256", secret()).update(`${key}.${expires}`).digest("hex");

export function presign(origin: string, filename: string, ext: string) {
  const base = path.basename(filename, path.extname(filename)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const key = `${randomUUID()}${base ? `-${base}` : ""}.${ext}`;
  const expires = Math.floor(Date.now() / 1000) + UPLOAD_TTL_SEC;
  return {
    key,
    presignedUrl: `${origin}/api/external/v1/uploads/${key}?expires=${expires}&sig=${sign(key, expires)}`,
    publicUrl: `${origin}/uploads/${key}`,
  };
}

export function verifySignature(key: string, expires: string | null, sig: string | null): "ok" | "expired" | "invalid" {
  if (!expires || !sig || !/^\d+$/.test(expires) || !/^[0-9a-f]{64}$/.test(sig)) return "invalid";
  const ok = timingSafeEqual(Buffer.from(sign(key, Number(expires)), "hex"), Buffer.from(sig, "hex"));
  if (!ok) return "invalid";
  return Number(expires) < Date.now() / 1000 ? "expired" : "ok";
}

export async function storedFile(name: string): Promise<{ size: number } | null> {
  if (!KEY_RE.test(name) && !/^[\w.-]+\.(mp3|wav|m4a)$/.test(name)) return null;
  try {
    const st = await fs.stat(path.join(UPLOAD_DIR, path.basename(name)));
    return st.isFile() ? { size: st.size } : null;
  } catch {
    return null;
  }
}

export async function writeUpload(name: string, bytes: Uint8Array) {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, path.basename(name)), bytes);
}
