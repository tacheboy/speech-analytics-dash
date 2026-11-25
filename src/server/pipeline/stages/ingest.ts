import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { storage, verifyFileUrl } from "@/server/storage";
import { CONTENT_TYPES, probe } from "../audio";
import { enqueueStage, type StageJob } from "../queue";
import { failRun, loadRun, setStage, StageError, type StageCtx } from "./common";

const MAX_BYTES = 500 * 1024 * 1024;
const MAX_SECONDS = 2 * 3600;

/**
 * Stage 1: get the original recording into storage, probe it, skip what's too short.
 * Sources: a bundled demo sample, our own upload URL (read straight from storage), or a remote URL
 * (60 s to connect, 10 min total; 5xx/timeouts retry, 4xx don't). Idempotent: an original already
 * in storage is reused.
 */
export async function ingest(job: StageJob, ctx: StageCtx) {
  const run = await loadRun(job.conversationId, job.analysisId);
  if (!run) return;
  const { conv, prefix } = run;
  await setStage(conv, "ingesting");
  const store = await storage();

  let key = conv.audioKey;
  let bytes = key ? await store.get(key) : null;
  if (!bytes) {
    const got = await fetchAudio(conv);
    key = `${prefix}/original.${got.ext}`;
    await store.put(key, got.bytes, CONTENT_TYPES[got.ext]);
    bytes = got.bytes;
    await db.update(schema.conversations).set({ audioKey: key, updatedAt: new Date() }).where(eq(schema.conversations.id, conv.id));
  }
  if (!bytes.length) throw new StageError("audio_invalid", "The recording is empty (0 bytes)", false);
  const info = await probe(bytes);
  if (!info) throw new StageError("audio_invalid", "The recording could not be decoded as audio", false);
  if (info.durationSec > MAX_SECONDS) throw new StageError("audio_invalid", `Recordings are limited to 2 hours (this one is ${Math.round(info.durationSec / 60)} min)`, false);

  await db.update(schema.conversations).set({ durationSec: Math.round(info.durationSec), channels: info.channels, sampleRate: info.sampleRate, updatedAt: new Date() }).where(eq(schema.conversations.id, conv.id));
  const [org] = await db.select({ min: schema.organizations.minDurationSec }).from(schema.organizations).where(eq(schema.organizations.id, conv.orgId));
  if (info.durationSec < (org?.min ?? 15)) {
    await failRun(conv.id, job.analysisId, "too_short", `Shorter than the ${org?.min ?? 15} s minimum (${info.durationSec.toFixed(1)} s); not analysed or billed`, false);
    return;
  }
  void ctx;
  await enqueueStage("prepare", job);
}

async function fetchAudio(conv: typeof schema.conversations.$inferSelect): Promise<{ bytes: Buffer; ext: string }> {
  if (conv.sampleId) {
    const file = path.join(process.cwd(), "public", "audio", `${path.basename(conv.sampleId)}.m4a`);
    try {
      return { bytes: await fs.readFile(file), ext: "m4a" };
    } catch {
      throw new StageError("audio_invalid", `Demo sample ${conv.sampleId} is missing`, false);
    }
  }
  if (!conv.sourceUrl) throw new StageError("audio_invalid", "No recording was provided", false);
  const url = new URL(conv.sourceUrl);

  // our own signed upload URL: read from storage directly
  const own = url.pathname.match(/^\/api\/files\/(.+)$/);
  if (own) {
    const key = own[1].split("/").map(decodeURIComponent).join("/");
    const v = verifyFileUrl("GET", key, url.searchParams.get("expires"), url.searchParams.get("sig"));
    if (v === "ok" || v === "expired") {
      const bytes = await (await storage()).get(key);
      if (!bytes) throw new StageError("audio_forbidden", "The uploaded file was not found (was the PUT to uploadUrl completed?)", false);
      return { bytes, ext: extOf(key, null) };
    }
  }
  // Voxxi-adapter uploads (/uploads/<file>) live in storage under uploads/
  const legacy = url.pathname.match(/^\/uploads\/([\w.-]+)$/);
  if (legacy) {
    const bytes = await (await storage()).get(`uploads/${legacy[1]}`);
    if (bytes) return { bytes, ext: extOf(legacy[1], null) };
  }

  await guardUrl(url);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000), redirect: "follow" });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    throw new StageError("audio_unreachable", `Couldn't download the recording: ${err.name === "TimeoutError" ? "timed out" : err.cause?.code ?? err.message}`, true);
  }
  if (res.status >= 500 || res.status === 429 || res.status === 408) throw new StageError("audio_unreachable", `The recording URL answered HTTP ${res.status}`, true);
  if (!res.ok) throw new StageError("audio_forbidden", `The recording URL answered HTTP ${res.status} (expired or private link?)`, false);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new StageError("audio_invalid", "Recordings are limited to 500 MB", false);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new StageError("audio_invalid", "Recordings are limited to 500 MB", false);
  return { bytes, ext: extOf(url.pathname, res.headers.get("content-type")) };
}

function extOf(name: string, contentType: string | null) {
  const byType = Object.entries(CONTENT_TYPES).find(([, t]) => contentType?.toLowerCase().startsWith(t))?.[0];
  const byName = path.extname(name).slice(1).toLowerCase();
  return byName in CONTENT_TYPES ? byName : byType ?? "audio";
}

/** SSRF guard: refuse URLs that resolve to private, loopback or link-local addresses (allowed outside production). */
async function guardUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) throw new StageError("audio_forbidden", "audioUrl must be http(s)", false);
  const allowPrivate = process.env.ALLOW_PRIVATE_AUDIO_URLS ? process.env.ALLOW_PRIVATE_AUDIO_URLS === "true" : process.env.NODE_ENV !== "production";
  if (allowPrivate) return;
  const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new StageError("audio_unreachable", `Couldn't resolve ${url.hostname}`, true);
  if (addrs.some((a) => isPrivate(a.address))) throw new StageError("audio_forbidden", "audioUrl points at a private network address", false);
}

export function isPrivate(ip: string): boolean {
  if (net.isIPv6(ip)) return ip === "::1" || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || ip.startsWith("::ffff:") && isPrivate(ip.slice(7));
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
