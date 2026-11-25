import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError, type Actor } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { newId } from "@/server/ids";
import { createConversation } from "@/server/services/conversations";
import type { ExternalCaller } from "./auth";
import { parseCallDate } from "./dates";
import { ExternalError } from "./errors";
import { analysisBody, categoryDetail, categorySummary, loadCall } from "./present";
import { audioExt, presign } from "./uploads";

const { users, categories } = schema;
const email = z.string().trim().toLowerCase().pipe(z.email("Invalid email"));
const name = z.string().trim().min(1, "name is required").max(200);

/* ---------- agents ---------- */

const activeAgent = (orgId: string, id: string) =>
  and(eq(users.id, id), eq(users.orgId, orgId), eq(users.role, "member"), isNull(users.deactivatedAt));

async function emailTaken(addr: string, exceptId?: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = ${addr}`, exceptId ? ne(users.id, exceptId) : undefined)).limit(1);
  return !!u;
}

export async function listAgents(c: ExternalCaller) {
  const rows = await db.select().from(users).where(and(eq(users.orgId, c.orgId), eq(users.role, "member"), isNull(users.deactivatedAt))).orderBy(asc(users.name));
  return { data: rows.map((u) => ({ id: u.id, userId: u.id, name: u.name, email: u.email, image: null, createdAt: u.createdAt.toISOString() })) };
}

export async function createAgent(c: ExternalCaller, raw: unknown) {
  const body = z.object({ name, email }).parse(raw);
  if (await emailTaken(body.email)) throw new ExternalError(409, "Email already in use");
  const id = newId("per");
  try {
    await db.insert(users).values({ id, orgId: c.orgId, cohortId: null, name: body.name, email: body.email, role: "member" });
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
  const [u] = Object.keys(patch).length ? await db.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, id)).returning() : [agent];
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

/** The adapter acts as the org's admin and hands off to the platform's createConversation. */
async function adminActor(c: ExternalCaller): Promise<Actor> {
  const admin = c.userId ? (await db.select().from(users).where(eq(users.id, c.userId)))[0] : null;
  if (!admin) throw new ExternalError(401, "Invalid API key");
  return { userId: admin.id, orgId: c.orgId, role: "admin", name: admin.name, keyId: c.keyId, scope: "write", viaKey: true };
}

export async function createExternalCall(c: ExternalCaller, raw: unknown, origin: string) {
  const body = createCallBody.parse(raw);
  try {
    const u = new URL(body.audio_url);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error();
  } catch {
    throw new ExternalError(400, "audio_url must be an absolute http(s) URL");
  }
  let occurredAt: string | undefined;
  if (body.date) {
    const d = parseCallDate(body.date);
    if (!d) throw new ExternalError(400, "Invalid date: use YYYY-MM-DD, ISO-8601, YYYY/MM/DD, DD-MM-YYYY or DD/MM/YYYY (optionally with HH:mm)");
    occurredAt = d.toISOString();
  }
  const [agent] = await db.select({ id: users.id }).from(users).where(and(
    or(eq(users.id, body.memberId), sql`lower(${users.email}) = ${body.memberId.toLowerCase()}`),
    eq(users.orgId, c.orgId), eq(users.role, "member"), isNull(users.deactivatedAt),
  ));
  if (!agent) throw new ExternalError(404, "Agent not found");
  try {
    const { conversation } = await createConversation(await adminActor(c), { categoryId: body.categoryId, personId: agent.id, audioUrl: body.audio_url, occurredAt, metadata: body.udfs ?? undefined }, origin);
    return { data: { callId: conversation.id, status: "processing" as const } };
  } catch (e) {
    if (e instanceof ApiError) throw new ExternalError(e.status, e.code === "category_not_found" ? "Category not found" : e.message);
    throw e;
  }
}

export async function getAnalysis(c: ExternalCaller, callId: string, origin: string) {
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
