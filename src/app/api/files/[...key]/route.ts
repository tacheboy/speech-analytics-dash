import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CONTENT_TYPES } from "@/server/pipeline/audio";
import { dataDir, verifyFileUrl } from "@/server/storage";

/**
 * Signed URLs for local-disk storage (STORAGE=local). GET serves a file (with Range support for audio
 * seeking); PUT is the target of POST /uploads. The HMAC in the query string authorises exactly one
 * key and method until it expires. With STORAGE=s3, URLs point at S3 and this route is unused.
 */
const MAX_BYTES = 500 * 1024 * 1024;
const err = (status: number, code: string, message: string) => Response.json({ error: { type: status === 404 ? "not_found" : "permission", code, message } }, { status });

async function resolve(req: Request, ctx: RouteContext<"/api/files/[...key]">, method: "GET" | "PUT"): Promise<{ error: Response } | { key: string; file: string }> {
  const key = (await ctx.params).key.join("/");
  const url = new URL(req.url);
  const check = verifyFileUrl(method, key, url.searchParams.get("expires"), url.searchParams.get("sig"));
  if (check !== "ok") return { error: err(403, check === "expired" ? "url_expired" : "invalid_signature", check === "expired" ? "This URL has expired" : "Invalid signature") };
  const file = path.join(dataDir(), key);
  if (!file.startsWith(dataDir() + path.sep)) return { error: err(404, "not_found", "Not found") };
  return { key, file };
}

export async function GET(req: Request, ctx: RouteContext<"/api/files/[...key]">) {
  const r = await resolve(req, ctx, "GET");
  if ("error" in r) return r.error;
  const st = await fsp.stat(r.file).catch(() => null);
  if (!st?.isFile()) return err(404, "not_found", "Not found");
  const type = CONTENT_TYPES[path.extname(r.file).slice(1)] ?? "application/octet-stream";
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${st.size}` } });
    const stream = Readable.toWeb(fs.createReadStream(r.file, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { "content-type": type, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${st.size}`, "accept-ranges": "bytes" } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(r.file)) as ReadableStream, { headers: { "content-type": type, "content-length": String(st.size), "accept-ranges": "bytes", "cache-control": "private, max-age=3600" } });
}

export async function PUT(req: Request, ctx: RouteContext<"/api/files/[...key]">) {
  const r = await resolve(req, ctx, "PUT");
  if ("error" in r) return r.error;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return err(413, "too_large", "Uploads are limited to 500 MB");
  if (!req.body) return err(400, "empty_body", "Send the file as the request body");
  await fsp.mkdir(path.dirname(r.file), { recursive: true });
  const tmp = `${r.file}.part`;
  let size = 0;
  const limit = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) {
      size += chunk.byteLength;
      if (size > MAX_BYTES) c.error(new Error("too large"));
      else c.enqueue(chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(req.body.pipeThrough(limit) as never), fs.createWriteStream(tmp));
  } catch {
    await fsp.rm(tmp, { force: true });
    return err(413, "too_large", "Uploads are limited to 500 MB");
  }
  await fsp.rename(tmp, r.file);
  return new Response(null, { status: 200 });
}
