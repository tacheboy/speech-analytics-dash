import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { db, schema } from "@/server/db/client";
import { ApiError, type Actor } from "@/server/auth";
import { advancePipeline } from "@/server/pipeline/advance";
import { content } from "@/server/pipeline/mock-analyzer";
import { callScore } from "@/server/scoring";
import { createCallBody, listCallsQuery, reviewBody } from "@/lib/contracts";
import { DURATION_BUCKETS, SCORE_BUCKETS, type Rubric } from "@/lib/domain";

const { calls, users, categories, criterionResults, callTags, tags } = schema;
const uploader = alias(users, "uploader");
const reviewer = alias(users, "reviewer");
export const UPLOAD_DIR = path.join(process.cwd(), "storage", "uploads");

async function rubricMap(orgId: string) {
  const rows = await db.select({ id: categories.id, name: categories.name, rubric: categories.rubric }).from(categories).where(eq(categories.orgId, orgId));
  return new Map(rows.map((r) => [r.id, r]));
}
const outcomeOf = (rubric: Rubric | undefined, id: string | null) => (id ? rubric?.outcomes.find((o) => o.id === id) : undefined);

/* ---------------- list ---------------- */

export async function listCalls(actor: Actor, raw: unknown) {
  const q = listCallsQuery.parse(raw);
  await advancePipeline(actor.orgId);
  const cats = await rubricMap(actor.orgId);

  const where: SQL[] = [eq(calls.orgId, actor.orgId)];
  // agents only ever see their own calls; agent/team filters don't apply to them
  if (actor.role === "agent") where.push(eq(calls.agentId, actor.userId));
  else {
    if (q.agentId?.length) where.push(inArray(calls.agentId, q.agentId));
    if (q.teamId?.length) where.push(inArray(users.teamId, q.teamId));
  }
  if (q.categoryId && q.categoryId !== "all") where.push(eq(calls.categoryId, q.categoryId));
  if (q.status !== "all") where.push(eq(calls.status, q.status));
  if (q.scoreBucket) {
    const b = SCORE_BUCKETS[q.scoreBucket];
    where.push(gte(calls.score, b.min), lte(calls.score, b.max));
  }
  if (q.durationBucket) {
    const b = DURATION_BUCKETS[q.durationBucket];
    where.push(gte(calls.durationSec, b.min), sql`${calls.durationSec} < ${b.max}`);
  }
  if (q.from) where.push(gte(calls.callAt, new Date(`${q.from}T00:00:00+05:30`)));
  if (q.to) where.push(lte(calls.callAt, new Date(`${q.to}T23:59:59.999+05:30`)));
  if (q.reviewed === "true") where.push(isNotNull(calls.reviewedAt));
  if (q.reviewed === "false") where.push(isNull(calls.reviewedAt));
  if (q.compliance) where.push(eq(calls.complianceFlag, true));
  if (q.q) where.push(or(ilike(users.name, `%${q.q}%`), ilike(calls.id, `%${q.q}%`))!);
  if (q.outcome?.length) {
    // outcomes are filtered by label so the same label works across categories
    const ids = [...cats.values()].flatMap((c) => c.rubric.outcomes.filter((o) => q.outcome!.includes(o.label)).map((o) => o.id));
    where.push(inArray(calls.outcomeId, ids.length ? ids : ["__none__"]));
  }
  if (q.tag?.length) where.push(inArray(calls.id, db.select({ id: callTags.callId }).from(callTags).where(inArray(callTags.tagId, q.tag))));

  const sortCol = { agent: users.name, duration: calls.durationSec, score: calls.score, date: calls.callAt }[q.sort];
  const dir = q.order === "asc" ? asc : desc;
  const orderBy = q.sort === "score" ? [sql`${calls.score} ${sql.raw(q.order === "asc" ? "asc" : "desc")} nulls last`, desc(calls.callAt)] : [dir(sortCol), desc(calls.callAt)];

  const base = db
    .select({
      id: calls.id, categoryId: calls.categoryId, agentId: calls.agentId, agentName: users.name, teamId: users.teamId,
      status: calls.status, failureReason: calls.failureReason, durationSec: calls.durationSec, score: calls.score,
      outcomeId: calls.outcomeId, isSuccess: calls.isSuccess, isNotApplicable: calls.isNotApplicable,
      complianceFlag: calls.complianceFlag, callAt: calls.callAt, language: calls.language, isSimulated: calls.isSimulated,
      uploadedByName: uploader.name, reviewedAt: calls.reviewedAt, audioUrl: calls.audioUrl,
    })
    .from(calls)
    .innerJoin(users, eq(users.id, calls.agentId))
    .leftJoin(uploader, eq(uploader.id, calls.uploadedBy))
    .where(and(...where));

  const [rows, [{ total }]] = await Promise.all([
    base.orderBy(...orderBy).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(calls).innerJoin(users, eq(users.id, calls.agentId)).where(and(...where)),
  ]);
  const tagRows = rows.length
    ? await db.select({ callId: callTags.callId, id: tags.id, displayName: tags.displayName }).from(callTags).innerJoin(tags, eq(tags.id, callTags.tagId)).where(inArray(callTags.callId, rows.map((r) => r.id)))
    : [];

  return {
    items: rows.map((r) => ({
      ...r,
      categoryName: cats.get(r.categoryId)?.name ?? r.categoryId,
      outcomeLabel: outcomeOf(cats.get(r.categoryId)?.rubric, r.outcomeId)?.label ?? null,
      tags: tagRows.filter((t) => t.callId === r.id).map(({ id, displayName }) => ({ id, displayName })),
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}
export type CallList = Awaited<ReturnType<typeof listCalls>>;
export type CallListItem = CallList["items"][number];

/* ---------------- create (upload) ---------------- */

const AUDIO_TYPES: Record<string, string> = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/aac": "m4a" };
const MAX_BYTES = 50 * 1024 * 1024;

export async function createCall(actor: Actor, req: Request) {
  if (actor.role === "agent") throw new ApiError(403, "forbidden", "Agents cannot upload calls");
  const isMultipart = req.headers.get("content-type")?.includes("multipart/form-data");
  let file: File | null = null;
  let input: z.infer<typeof createCallBody>;
  if (isMultipart) {
    const form = await req.formData();
    file = form.get("file") instanceof File ? (form.get("file") as File) : null;
    input = createCallBody.parse(Object.fromEntries([...form.entries()].filter(([k]) => k !== "file")));
  } else {
    input = createCallBody.parse(await req.json());
  }

  const [cat] = await db.select().from(categories).where(and(eq(categories.id, input.categoryId), eq(categories.orgId, actor.orgId)));
  if (!cat) throw new ApiError(404, "not_found", "Unknown categoryId");
  const [agent] = await db.select().from(users).where(and(or(eq(users.id, input.agentId), eq(users.email, input.agentId)), eq(users.orgId, actor.orgId), eq(users.role, "agent")));
  if (!agent) throw new ApiError(404, "not_found", "Unknown agentId (pass an agent id or email)");
  const [team] = agent.teamId ? await db.select().from(schema.teams).where(eq(schema.teams.id, agent.teamId)) : [];
  const language = team?.language ?? "hi-en";

  const { templates, timings } = content();
  const id = `call_${crypto.randomUUID().slice(0, 8)}`;
  let templateId: string;
  let audioUrl: string;
  let durationSec: number;
  let isSimulated = true;
  let fileName: string | null = null;
  let failureReason: string | null = null;

  if (input.sampleId) {
    const t = templates.get(input.sampleId);
    if (!t || !timings[t.id]) throw new ApiError(404, "not_found", "Unknown sampleId");
    if (t.categoryId !== cat.id) throw new ApiError(400, "invalid_request", `Sample ${t.id} belongs to category ${t.categoryId}`);
    templateId = t.id;
    audioUrl = `/audio/${t.id}.m4a`;
    durationSec = Math.round(timings[t.id].duration);
    isSimulated = false;
    fileName = `${t.id}.m4a`;
  } else {
    // No ASR in this build: the analysis of an arbitrary recording is simulated from a template of the same category.
    const pool = [...templates.values()].filter((t) => t.categoryId === cat.id && timings[t.id]);
    if (!pool.length) throw new ApiError(400, "invalid_request", "No analysis templates for this category");
    const sameLang = pool.filter((t) => t.language === language);
    const candidates = sameLang.length ? sameLang : pool;
    templateId = candidates[Math.floor(Math.random() * candidates.length)].id;
    if (file) {
      const ext = AUDIO_TYPES[file.type] ?? path.extname(file.name).slice(1).toLowerCase();
      if (!["mp3", "wav", "m4a"].includes(ext)) throw new ApiError(415, "unsupported_media", "Only MP3, WAV or M4A recordings are supported");
      if (file.size > MAX_BYTES) throw new ApiError(413, "too_large", "Recordings must be 50 MB or smaller");
      if (file.size === 0) failureReason = "Recording is empty (0 bytes)";
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      await fs.writeFile(path.join(UPLOAD_DIR, `${id}.${ext}`), Buffer.from(await file.arrayBuffer()));
      audioUrl = `/uploads/${id}.${ext}`;
      fileName = file.name;
    } else if (input.audioUrl) {
      audioUrl = input.audioUrl;
      fileName = input.audioUrl.split("/").pop() ?? null;
    } else {
      throw new ApiError(400, "invalid_request", "Provide a file, sampleId or audioUrl");
    }
    durationSec = input.durationSec ?? Math.round(timings[templateId].duration);
  }

  const now = new Date();
  await db.insert(calls).values({
    id, orgId: actor.orgId, categoryId: cat.id, agentId: agent.id, uploadedBy: actor.userId,
    status: "processing", readyAt: new Date(now.getTime() + 6000 + Math.random() * 8000), failureReason,
    audioUrl, fileName, durationSec, callAt: input.callAt ? new Date(input.callAt) : now, language,
    templateId, isSimulated, rubricVersion: cat.rubricVersion, udfs: input.udfs ?? null,
  });
  return { callId: id, status: "processing" as const };
}

/* ---------------- detail ---------------- */

export async function getCall(actor: Actor, id: string) {
  await advancePipeline(actor.orgId);
  const [row] = await db
    .select({ call: calls, agentName: users.name, agentEmail: users.email, teamId: users.teamId, uploadedByName: uploader.name, reviewedByName: reviewer.name })
    .from(calls)
    .innerJoin(users, eq(users.id, calls.agentId))
    .leftJoin(uploader, eq(uploader.id, calls.uploadedBy))
    .leftJoin(reviewer, eq(reviewer.id, calls.reviewedBy))
    .where(and(eq(calls.id, id), eq(calls.orgId, actor.orgId)));
  if (!row || (actor.role === "agent" && row.call.agentId !== actor.userId)) throw new ApiError(404, "not_found", "Call not found");
  const [cat] = await db.select().from(categories).where(eq(categories.id, row.call.categoryId));
  const [results, callTagRows] = await Promise.all([
    db.select().from(criterionResults).where(eq(criterionResults.callId, id)),
    db.select({ id: tags.id, displayName: tags.displayName }).from(callTags).innerJoin(tags, eq(tags.id, callTags.tagId)).where(eq(callTags.callId, id)),
  ]);
  const rubric = cat.rubric;
  const sections = rubric.sections
    .map((s) => {
      const criteria = s.criteria
        .map((c) => {
          const r = results.find((x) => x.criterionId === c.id);
          return r ? { id: c.id, question: c.question, aiResult: r.aiResult, overrideResult: r.overrideResult, result: r.finalResult, rationale: r.rationale, evidenceQuote: r.evidenceQuote, evidenceStart: r.evidenceStart, confidence: r.confidence } : null;
        })
        .filter((c) => c !== null);
      const applicable = criteria.filter((c) => c.result !== "na");
      return { id: s.id, name: s.name, met: applicable.filter((c) => c.result === "pass").length, total: applicable.length, criteria };
    })
    .filter((s) => s.criteria.length);
  const { call } = row;
  return {
    ...call,
    agentName: row.agentName, agentEmail: row.agentEmail, teamId: row.teamId,
    uploadedByName: row.uploadedByName, reviewedByName: row.reviewedByName,
    category: { id: cat.id, name: cat.name },
    outcome: outcomeOf(rubric, call.outcomeId) ?? null,
    outcomes: rubric.outcomes,
    extractionFields: rubric.extractionFields,
    sections,
    tags: callTagRows,
  };
}
export type CallDetail = Awaited<ReturnType<typeof getCall>>;

/* ---------------- review (manager override) ---------------- */

export async function reviewCall(actor: Actor, id: string, raw: unknown) {
  if (actor.role === "agent") throw new ApiError(403, "forbidden", "Only managers and admins can review calls");
  const body = reviewBody.parse(raw);
  const [call] = await db.select().from(calls).where(and(eq(calls.id, id), eq(calls.orgId, actor.orgId)));
  if (!call) throw new ApiError(404, "not_found", "Call not found");
  if (call.status !== "done") throw new ApiError(409, "not_ready", "Call analysis is not complete");

  await db.transaction(async (tx) => {
    for (const o of body.overrides) {
      const [r] = await tx.select().from(criterionResults).where(and(eq(criterionResults.callId, id), eq(criterionResults.criterionId, o.criterionId)));
      if (!r) throw new ApiError(400, "invalid_request", `Criterion ${o.criterionId} is not part of this call`);
      const override = o.result === r.aiResult ? null : o.result;
      await tx.update(criterionResults).set({ overrideResult: override, finalResult: override ?? r.aiResult })
        .where(and(eq(criterionResults.callId, id), eq(criterionResults.criterionId, o.criterionId)));
    }
    const all = await tx.select().from(criterionResults).where(eq(criterionResults.callId, id));
    await tx.update(calls).set({
      score: callScore(all),
      complianceFlag: all.some((c) => c.sectionId === "compliance" && c.finalResult === "fail"),
      reviewedBy: actor.userId,
      reviewedAt: new Date(),
      ...(body.note !== undefined ? { reviewNote: body.note || null } : {}),
    }).where(eq(calls.id, id));
    if (body.tagIds) {
      await tx.delete(callTags).where(eq(callTags.callId, id));
      if (body.tagIds.length) await tx.insert(callTags).values(body.tagIds.map((tagId) => ({ callId: id, tagId })));
    }
  });
  return getCall(actor, id);
}
