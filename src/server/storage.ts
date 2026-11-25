import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Object storage with two drivers, chosen by STORAGE:
 * - `local` (default): files under DATA_DIR (./storage), signed URLs served by /api/files/<key>
 * - `s3`: any S3-compatible store (AWS S3, Cloudflare R2, MinIO, …) via S3_BUCKET / S3_REGION / S3_ENDPOINT
 * Keys look like `org/<orgId>/conv/<id>/original.mp3`.
 */
export interface Storage {
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  size(key: string): Promise<number | null>;
  deletePrefix(prefix: string): Promise<void>;
  /** A URL anyone can GET for `ttlSec`. */
  signedGetUrl(key: string, ttlSec: number, origin: string): Promise<string>;
  /** A URL a client can PUT the object to for `ttlSec`. */
  signedPutUrl(key: string, contentType: string, ttlSec: number, origin: string): Promise<string>;
}

const safeKey = (key: string) => {
  const k = key.replace(/^\/+/, "");
  if (!k || k.split("/").some((p) => p === ".." || p === "." || p === "")) throw new Error(`invalid storage key: ${key}`);
  return k;
};

/* ---------- local disk ---------- */

export const dataDir = () => path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "storage"));
const signingSecret = () => process.env.APP_SECRET ?? process.env.UPLOAD_SIGNING_SECRET ?? process.env.DEMO_API_KEY ?? "dev-secret";

export function signFileUrl(method: "GET" | "PUT", key: string, expires: number) {
  return createHmac("sha256", signingSecret()).update(`${method}\n${key}\n${expires}`).digest("hex");
}

export function verifyFileUrl(method: "GET" | "PUT", key: string, expires: string | null, sig: string | null): "ok" | "expired" | "invalid" {
  if (!expires || !sig || !/^\d+$/.test(expires) || !/^[0-9a-f]{64}$/.test(sig)) return "invalid";
  const ok = timingSafeEqual(Buffer.from(signFileUrl(method, key, Number(expires)), "hex"), Buffer.from(sig, "hex"));
  if (!ok) return "invalid";
  return Number(expires) < Date.now() / 1000 ? "expired" : "ok";
}

const localUrl = (method: "GET" | "PUT", key: string, ttlSec: number, origin: string) => {
  const expires = Math.floor(Date.now() / 1000) + ttlSec;
  return `${origin}/api/files/${key.split("/").map(encodeURIComponent).join("/")}?expires=${expires}&sig=${signFileUrl(method, key, expires)}`;
};

const localStorage: Storage = {
  async put(key, body) {
    const file = path.join(dataDir(), safeKey(key));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  },
  async get(key) {
    try {
      return await fs.readFile(path.join(dataDir(), safeKey(key)));
    } catch {
      return null;
    }
  },
  async size(key) {
    try {
      const st = await fs.stat(path.join(dataDir(), safeKey(key)));
      return st.isFile() ? st.size : null;
    } catch {
      return null;
    }
  },
  async deletePrefix(prefix) {
    await fs.rm(path.join(dataDir(), safeKey(prefix)), { recursive: true, force: true });
  },
  signedGetUrl: async (key, ttl, origin) => localUrl("GET", safeKey(key), ttl, origin),
  signedPutUrl: async (key, _type, ttl, origin) => localUrl("PUT", safeKey(key), ttl, origin),
};

/* ---------- S3-compatible ---------- */

async function s3Storage(): Promise<Storage> {
  const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const Bucket = process.env.S3_BUCKET;
  if (!Bucket) throw new Error("STORAGE=s3 needs S3_BUCKET");
  const client = new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT || undefined, // R2 / MinIO
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
  });
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: safeKey(key), Body: body, ContentType: contentType }));
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket, Key: safeKey(key) }));
        return Buffer.from(await res.Body!.transformToByteArray());
      } catch {
        return null;
      }
    },
    async size(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket, Key: safeKey(key) }));
        return res.ContentLength ?? 0;
      } catch {
        return null;
      }
    },
    async deletePrefix(prefix) {
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: safeKey(prefix) + "/", ContinuationToken: token }));
        const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
        if (keys.length) await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys } }));
        token = page.NextContinuationToken;
      } while (token);
    },
    signedGetUrl: (key, ttl) => getSignedUrl(client, new GetObjectCommand({ Bucket, Key: safeKey(key) }), { expiresIn: ttl }),
    signedPutUrl: (key, contentType, ttl) => getSignedUrl(client, new PutObjectCommand({ Bucket, Key: safeKey(key), ContentType: contentType }), { expiresIn: ttl }),
  };
}

let instance: Promise<Storage> | null = null;
export function storage(): Promise<Storage> {
  instance ??= (process.env.STORAGE ?? "local") === "s3" ? s3Storage() : Promise.resolve(localStorage);
  return instance;
}

export const storageDriver = () => ((process.env.STORAGE ?? "local") === "s3" ? "s3" : "local");
export const conversationPrefix = (orgId: string, id: string) => `org/${orgId}/conv/${id}`;
