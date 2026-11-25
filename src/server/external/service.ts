import path from "node:path";
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { db, schema } from "@/server/db/client";
import { advancePipeline } from "@/server/pipeline/advance";
import { insertCall, type IngestAudio } from "@/server/services/ingest";
import type { ExternalCaller } from "./auth";
import { parseCallDate } from "./dates";
import { ExternalError } from "./errors";
import { analysisBody, categoryDetail, categorySummary, loadCall } from "./present";
import { audioExt, MAX_UPLOAD_BYTES, presign, storedFile, writeUpload } from "./uploads";

const { users, categories, calls } = schema;
const email = z.string().trim().toLowerCase().pipe(z.email("Invalid email"));
const name = z.string().trim().min(1, "name is required").max(200);

/* ---------- agents ---------- */

const activeAgent = (orgId: string, id: string) =>
  and(eq(users.id, id), eq(users.orgId, orgId), eq(users.role, "agent"), isNull(users.deactivatedAt));

async function emailTaken(addr: string, exceptId?: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = ${addr}`, exceptId ? ne(users.id, exceptId) : undefined)).limit(1);
  return !!u;
}

export async function listAgents(c: ExternalCaller) {
  const rows = await db.select().from(users).where(and(eq(users.orgId, c.orgId), eq(users.role, "agent"), isNull(users.deactivatedAt))).orderBy(asc(users.name));
  return { data: rows.map((u) => ({ id: u.id, userId: u.id, name: u.name, email: u.email, image: null, createdAt: u.createdAt.toISOString() })) };
}

export async function createAgent(c: ExternalCaller, raw: unknown) {
  const body = z.object({ name, email }).parse(raw);
  if (await emailTaken(body.email)) throw new ExternalError(409, "Email already in use");
  const id = `u_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  try {
    await db.insert(users).values({ id, orgId: c.orgId, teamId: null, name: body.name, email: body.email, role: "agent" });
  } catch (e) {
    if ((e as { code?: string; cause?: { code?: string } }).cause?.code === "23505" || (e as { code?: string }).code === "23505") throw new ExternalError(409, "Email already in use");
    throw e;
  }
  return { data: { id, userId: id, name: body.name, email: body.email } };
}

export async function updateAgent(c: ExternalCaller, id: string, raw: unknown) {
  const body = z.object({ name: name.optional(), email: email.optional() }).parse(raw);
  const [agent] = await db.select().from(users).where(activeAgent(c.orgId, id));
  if (!agent) throw new ExternalError(404, "Agent not found");
  if (body.email && (await emailTaken(body.email, id))) throw new ExternalError(409, "Email already in use");
  const patch = { ...(body.name ? { name: body.name } : {}), ...(body.email ? { email: body.email } : {}) };
  const [u] = Object.keys(patch).length ? await db.update(users).set(patch).where(eq(users.id, id)).returning() : [agent];
  return { data: { memberId: u.id, userId: u.id, name: u.name, email: u.email, image: null } };
}

/** Soft delete: the agent disappears from the API and the roster, their calls keep their history. */
export async function deleteAgent(c: ExternalCaller, id: string) {
  const res = await db.update(users).set({ deactivatedAt: new Date() }).where(activeAgent(c.orgId, id)).returning({ id: users.id });
  if (!res.length) throw new ExternalError(404, "Agent not found");
  return { success: true };
}

/* ---------- calls ---------- */

export function presignedUpload(raw: unknown, origin: string) {
  const body = z.object({ filename: z.string().trim().min(1, "filename is required"), contentType: z.string().trim().min(1, "contentType is required") }).parse(raw);
  const ext = audioExt(body.filename, body.contentType);
  if (!ext) throw new ExternalError(400, "Unsupported audio type: upload an MP3, WAV or M4A file");
  return { data: presign(origin, body.filename, ext) };
}

const createCallBody = z.object({
  memberId: z.string().trim().min(1, "memberId is required"),
  categoryId: z.string().trim().min(1, "categoryId is required"),
  audio_url: z.string().trim().min(1, "audio_url is required"),
  udfs: z.record(z.string(), z.unknown()).nullish(),
  date: z.string().nullish(),
});

/** Our own `/uploads/<file>` URL (any host, so a localhost publicUrl still resolves behind a proxy). */
function ownUploadName(url: URL, origin: string) {
  const m = url.pathname.match(/^\/uploads\/([^/]+)$/);
  if (!m) return null;
  const sameHost = url.origin === origin || ["localhost", "127.0.0.1"].includes(url.hostname) || url.host === new URL(origin).host;
  return sameHost ? decodeURIComponent(m[1]) : null;
}

export async function createExternalCall(c: ExternalCaller, raw: unknown, origin: string) {
  const body = createCallBody.parse(raw);
  let url: URL;
  try {
    url = new URL(body.audio_url);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new ExternalError(400, "audio_url must be an absolute http(s) URL");
  }
  let callAt: Date | undefined;
  if (body.date) {
    const d = parseCallDate(body.date);
    if (!d) throw new ExternalError(400, "Invalid date: use YYYY-MM-DD, ISO-8601, YYYY/MM/DD, DD-MM-YYYY or DD/MM/YYYY (optionally with HH:mm)");
    callAt = d;
  }

  const [category] = await db.select().from(categories).where(and(eq(categories.id, body.categoryId), eq(categories.orgId, c.orgId)));
  if (!category) throw new ExternalError(404, "Category not found");
  const [agent] = await db.select().from(users).where(and(
    or(eq(users.id, body.memberId), sql`lower(${users.email}) = ${body.memberId.toLowerCase()}`),
    eq(users.orgId, c.orgId), eq(users.role, "agent"), isNull(users.deactivatedAt),
  ));
  if (!agent) throw new ExternalError(404, "Agent not found");

  const id = `call_${crypto.randomUUID().slice(0, 8)}`;
  const own = ownUploadName(url, origin);
  const stored = own ? await storedFile(own) : null;
  const audio: IngestAudio = own && stored
    ? { kind: "stored", url: `/uploads/${own}`, fileName: own, empty: stored.size === 0 }
    : { kind: "url", url: body.audio_url };
  const res = await insertCall({ id, orgId: c.orgId, category, agent, uploadedBy: c.userId, audio, callAt, udfs: body.udfs ?? null });
  if (audio.kind === "url") runAfterResponse(() => ingestRemote(id, body.audio_url));
  return { data: { callId: res.callId, status: "processing" as const } };
}

function runAfterResponse(work: () => Promise<void>) {
  try {
    after(work);
  } catch {
    void work(); // outside a request (tests/scripts): fire and forget
  }
}

/**
 * Downloads a remote recording into storage/uploads. On failure the call keeps "processing" with a
 * failure reason, and lazy completion turns it into `failed` + `call.ingestion_failed`.
 */
export async function ingestRemote(callId: string, audioUrl: string) {
  try {
    const res = await fetch(audioUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching recording`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_UPLOAD_BYTES) throw new Error("recording is larger than 50 MB");
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.byteLength) throw new Error("file is empty (0 bytes)");
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("recording is larger than 50 MB");
    const ext = audioExt(new URL(audioUrl).pathname, res.headers.get("content-type") ?? "");
    if (!ext) throw new Error(`unsupported content type ${res.headers.get("content-type") ?? "unknown"}`);
    const file = `${callId}.${ext}`;
    await writeUpload(file, bytes);
    // downloaded: analysis can start now (lazy completion picks it up a few seconds later)
    await db.update(calls).set({ audioUrl: `/uploads/${file}`, fileName: path.basename(new URL(audioUrl).pathname) || file, ingestPending: false, readyAt: new Date(Date.now() + 6000) }).where(eq(calls.id, callId));
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const reason = err.name === "TimeoutError" ? "download timed out" : err.cause?.code ?? err.message;
    await db.update(calls).set({ failureReason: `Unable to ingest recording: ${reason}`, ingestPending: false }).where(and(eq(calls.id, callId), eq(calls.status, "processing")));
  }
}

export async function getAnalysis(c: ExternalCaller, callId: string, origin: string) {
  await advancePipeline(c.orgId);
  const l = await loadCall(c.orgId, callId);
  if (!l) throw new ExternalError(404, "Call not found");
  return analysisBody(l, origin);
}

/* ---------- categories ---------- */

export async function listCategories(c: ExternalCaller) {
  const rows = await db.select().from(categories).where(eq(categories.orgId, c.orgId)).orderBy(asc(categories.name));
  return { data: rows.map(categorySummary) };
}

export async function getCategory(c: ExternalCaller, id: string) {
  const [cat] = await db.select().from(categories).where(and(eq(categories.id, id), eq(categories.orgId, c.orgId)));
  if (!cat) throw new ExternalError(404, "Category not found");
  return { data: await categoryDetail(cat) };
}
