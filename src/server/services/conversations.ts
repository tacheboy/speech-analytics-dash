import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import {
  analyzeBody, createConversationBody, listConversationsQuery, scorecardPatchBody,
  type Conversation, type CreateConversationBody, type List,
} from "@/lib/contract";
import { ApiError, notFound, requireStaff, type Actor } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { emitEvent } from "@/server/events";
import { decodeCursor, encodeCursor } from "@/server/http";
import { newId, parseRef } from "@/server/ids";
import { enqueueStage } from "@/server/pipeline/queue";
import { dryRunAnalysis } from "@/server/pipeline/stages/analyze";
import { fromResult, presentConversations } from "@/server/presenters/conversation";
import { rubricAt } from "@/server/rubrics";
import { callScore } from "@/server/scoring";
import { conversationPrefix, storage } from "@/server/storage";
import { resolvePersonForConversation } from "./people";
import { istRange } from "./time";

const { conversations: conv, users, categories, criterionResults, conversationTags, tags, analyses } = schema;

/* ---------------- addressing ---------------- */

/** Finds a conversation by id or `ext:<externalId>` within the actor's org (members: their own only). */
export async function findConversation(actor: Actor, ref: string, opts: { includeDeleted?: boolean } = {}) {
  const r = parseRef(ref);
  const [row] = await db.select().from(conv).where(and(
    eq(conv.orgId, actor.orgId),
    "id" in r ? eq(conv.id, r.id!) : eq(conv.externalId, r.externalId),
    opts.includeDeleted ? undefined : isNull(conv.deletedAt),
  ));
  if (!row || (actor.role === "member" && row.personId !== actor.userId)) throw notFound("Conversation");
  return row;
}

/* ---------------- create ---------------- */

export async function createConversation(actor: Actor, raw: unknown, origin: string): Promise<{ conversation: Conversation; replayed: boolean }> {
  requireStaff(actor, "submit conversations");
  const body: CreateConversationBody = createConversationBody.parse(raw);

  if (body.externalId) {
    const [existing] = await db.select({ id: conv.id }).from(conv).where(and(eq(conv.orgId, actor.orgId), eq(conv.externalId, body.externalId)));
    if (existing) return { conversation: (await presentConversations(actor.orgId, [existing.id], { transcript: false, origin }))[0], replayed: true };
  }
  const [category] = await db.select().from(categories).where(and(eq(categories.id, body.categoryId), eq(categories.orgId, actor.orgId)));
  if (!category) throw new ApiError(404, "category_not_found", `Category ${body.categoryId} not found`, "categoryId");
  if (body.sampleId && !/^[a-z0-9-]+$/.test(body.sampleId)) throw new ApiError(400, "sample_not_found", "Unknown sampleId", "sampleId");
  if (body.sampleId) {
    const { sampleExists } = await import("@/server/pipeline/providers/mock");
    const sample = sampleExists(body.sampleId);
    if (!sample) throw new ApiError(404, "sample_not_found", "Unknown sampleId", "sampleId");
    if (sample.categoryId !== category.id) throw new ApiError(400, "sample_category_mismatch", `Sample ${body.sampleId} belongs to category ${sample.categoryId}`, "sampleId");
  }
  const person = await resolvePersonForConversation(actor, body);
  const [cohort] = person.cohortId ? await db.select().from(schema.cohorts).where(eq(schema.cohorts.id, person.cohortId)) : [];
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, actor.orgId));

  const id = newId("conv");
  const analysisId = newId("anl");
  try {
    await db.transaction(async (tx) => {
      await tx.insert(conv).values({
        id, orgId: actor.orgId, externalId: body.externalId ?? null, categoryId: category.id, personId: person.id,
        uploadedBy: actor.viaKey ? null : actor.userId, status: "queued",
        sourceUrl: body.audioUrl ?? null, sampleId: body.sampleId ?? null,
        fileName: body.audioUrl ? decodeURIComponent(new URL(body.audioUrl).pathname.split("/").pop() ?? "") || null : `${body.sampleId}.m4a`,
        channelLayout: body.channels?.person ?? "left",
        language: body.language ?? cohort?.language ?? org.defaultLanguage ?? null,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
        metadata: body.metadata ?? null, rubricVersion: category.rubricVersion,
      });
      await tx.insert(analyses).values({ id: analysisId, conversationId: id, kind: "initial", status: "running", rubricVersion: category.rubricVersion });
    });
  } catch (e) {
    // two concurrent POSTs with the same externalId: the loser returns the winner
    if (body.externalId && pgCode(e) === "23505") {
      const [existing] = await db.select({ id: conv.id }).from(conv).where(and(eq(conv.orgId, actor.orgId), eq(conv.externalId, body.externalId)));
      if (existing) return { conversation: (await presentConversations(actor.orgId, [existing.id], { transcript: false, origin }))[0], replayed: true };
    }
    throw e;
  }
  await enqueueStage("ingest", { conversationId: id, analysisId });
  return { conversation: (await presentConversations(actor.orgId, [id], { transcript: false, origin }))[0], replayed: false };
}

export const pgCode = (e: unknown) => (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;

/* ---------------- list / sync ---------------- */

export async function listConversations(actor: Actor, raw: unknown, origin: string): Promise<List<Conversation>> {
  const q = listConversationsQuery.parse(raw);
  const where: (SQL | undefined)[] = [eq(conv.orgId, actor.orgId)];
  // sync includes tombstones so warehouses see deletions; everything else hides them
  if (!q.updatedSince) where.push(isNull(conv.deletedAt));
  if (actor.role === "member") where.push(eq(conv.personId, actor.userId));
  else {
    if (q.personId?.length) where.push(inArray(conv.personId, q.personId));
    if (q.cohortId?.length) where.push(inArray(users.cohortId, q.cohortId));
  }
  if (q.categoryId) where.push(eq(conv.categoryId, q.categoryId));
  if (q.status) where.push(eq(conv.status, q.status));
  if (q.scoreMin != null) where.push(gte(conv.score, q.scoreMin));
  if (q.scoreMax != null) where.push(lte(conv.score, q.scoreMax));
  if (q.scoreMin != null || q.scoreMax != null) where.push(eq(conv.isNotApplicable, false));
  if (q.durationMin != null) where.push(gte(conv.durationSec, q.durationMin));
  if (q.durationMax != null) where.push(sql`${conv.durationSec} < ${q.durationMax}`);
  const { from, to } = istRange(q.from, q.to);
  if (from) where.push(gte(conv.occurredAt, from));
  if (to) where.push(lte(conv.occurredAt, to));
  if (q.audited !== undefined) where.push(q.audited ? isNotNull(conv.auditedAt) : isNull(conv.auditedAt));
  if (q.needsReview) {
    where.push(eq(conv.status, "completed"), isNull(conv.auditedAt), sql`exists (select 1 from criterion_results r where r.conversation_id = ${conv.id} and r.final_result <> 'na' and (r.evidence_verified = false or r.confidence < 0.6))`);
  }
  if (q.riskFlag !== undefined) where.push(q.riskFlag ? eq(conv.riskFlag, true) : or(eq(conv.riskFlag, false), isNull(conv.riskFlag)));
  if (q.outcomeType) {
    where.push(eq(conv.status, "completed"));
    if (q.outcomeType === "na") where.push(eq(conv.isNotApplicable, true));
    else where.push(eq(conv.isNotApplicable, false), eq(conv.isSuccess, q.outcomeType === "success"));
  }
  if (q.q) where.push(or(ilike(users.name, `%${q.q}%`), ilike(conv.id, `%${q.q}%`), ilike(conv.externalId, `%${q.q}%`)));
  if (q.outcome?.length) {
    // ids or labels; labels match across categories ("Promise to Pay" everywhere)
    const cats = await db.select({ id: categories.id, rubric: categories.rubric }).from(categories).where(eq(categories.orgId, actor.orgId));
    const ids = cats.flatMap((c) => c.rubric.outcomes.filter((o) => q.outcome!.includes(o.label) || q.outcome!.includes(o.id)).map((o) => o.id));
    where.push(inArray(conv.outcomeId, ids.length ? ids : ["__none__"]));
  }
  if (q.tag?.length) {
    const match = or(...q.tag.flatMap((s) => [eq(tags.slug, s), like(tags.slug, `${s}/%`)]));
    where.push(inArray(conv.id, db.select({ id: conversationTags.conversationId }).from(conversationTags).innerJoin(tags, eq(tags.id, conversationTags.tagId)).where(and(eq(tags.orgId, actor.orgId), match))));
  }
  for (const pair of q.ext ?? []) {
    const i = pair.indexOf(":");
    if (i > 0) where.push(sql`${conv.extractions} ->> ${pair.slice(0, i)} = ${pair.slice(i + 1)}`);
  }
  if (q.updatedSince) where.push(gt(conv.updatedAt, new Date(q.updatedSince)));

  // keyset pagination on (sortColumn, id); nulls sort last via coalesce
  const sort = q.updatedSince ? "updatedAt" : q.sort;
  const desc_ = sort.startsWith("-");
  const field = sort.replace("-", "") as "occurredAt" | "score" | "durationSec" | "updatedAt";
  const col = { occurredAt: conv.occurredAt, updatedAt: conv.updatedAt, score: sql`coalesce(${conv.score}, ${desc_ ? -1 : 101})`, durationSec: conv.durationSec }[field];
  const isTime = field === "occurredAt" || field === "updatedAt";
  const cursor = decodeCursor(q.cursor);
  if (cursor) {
    const [v, id] = cursor as [string | number, string];
    const val = isTime ? new Date(String(v)).toISOString() : Number(v);
    where.push(desc_ ? sql`(${col}, ${conv.id}) < (${val}, ${id})` : sql`(${col}, ${conv.id}) > (${val}, ${id})`);
  }
  const filters = and(...where);
  const rows = await db
    .select({ id: conv.id, v: isTime ? sql<string>`${col}` : sql<number>`${col}` })
    .from(conv).innerJoin(users, eq(users.id, conv.personId))
    .where(filters)
    .orderBy(desc_ ? desc(col) : asc(col), desc_ ? desc(conv.id) : asc(conv.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  const nextCursor = rows.length > q.limit && last ? encodeCursor([(last.v as unknown) instanceof Date ? (last.v as unknown as Date).toISOString() : last.v, last.id]) : null;

  let total: number | undefined;
  if (q.includeTotal) {
    const totalWhere = cursor ? and(...where.slice(0, -1)) : filters;
    [{ total }] = await db.select({ total: count() }).from(conv).innerJoin(users, eq(users.id, conv.personId)).where(totalWhere);
  }
  const data = await presentConversations(actor.orgId, page.map((r) => r.id), { transcript: false, origin });
  return { object: "list", data, nextCursor, ...(total !== undefined ? { total } : {}) };
}

/* ---------------- get / delete ---------------- */

export async function getConversation(actor: Actor, ref: string, origin: string, opts: { transcript?: boolean } = {}) {
  const row = await findConversation(actor, ref);
  return (await presentConversations(actor.orgId, [row.id], { transcript: opts.transcript ?? true, origin }))[0];
}

/** Erasure: audio, transcript and analysis are deleted; a tombstone (id, externalId, deletedAt) stays for sync. */
export async function deleteConversation(actor: Actor, ref: string) {
  requireStaff(actor, "delete conversations");
  await eraseConversation(await findConversation(actor, ref));
}

export async function eraseConversation(row: { id: string; orgId: string }) {
  await (await storage()).deletePrefix(conversationPrefix(row.orgId, row.id));
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(criterionResults).where(eq(criterionResults.conversationId, row.id));
    await tx.delete(conversationTags).where(eq(conversationTags.conversationId, row.id));
    await tx.update(analyses).set({ rawOutput: null, status: sql`case when ${analyses.status} = 'running' then 'failed' else ${analyses.status} end` }).where(eq(analyses.conversationId, row.id));
    await tx.update(conv).set({
      deletedAt: now, updatedAt: now, status: sql`case when ${conv.status} in ('queued','processing') then 'failed' else ${conv.status} end`, stage: null,
      transcript: null, summary: null, observations: null, improvements: null, outcomeRationale: null,
      extractions: null, moments: null, metrics: null, metadata: null, auditNote: null, audioKey: null, playbackKey: null, sourceUrl: null, fileName: null,
    }).where(eq(conv.id, row.id));
    await emitEvent(tx, { orgId: row.orgId, type: "conversation.updated", conversationId: row.id });
  });
}

/* ---------------- re-analysis ---------------- */

export async function analyzeConversation(actor: Actor, ref: string, raw: unknown, origin: string) {
  requireStaff(actor, "re-analyse conversations");
  const body = analyzeBody.parse(raw);
  const row = await findConversation(actor, ref);
  const transcribed = Boolean(row.transcript?.length);
  // a conversation that failed before transcription can only be retried from the start (non-dry-run)
  if (!transcribed && (body.dryRun || row.status !== "failed")) throw new ApiError(409, "not_transcribed", "This conversation has no transcript yet, so it can't be analysed");
  const [category] = await db.select().from(categories).where(eq(categories.id, row.categoryId));

  if (body.dryRun) {
    const rubric = body.rubric
      ? { ...body.rubric, id: category.id }
      : body.rubricVersion ? await rubricAt(category.id, body.rubricVersion) : category.rubric;
    if (!rubric) throw new ApiError(404, "rubric_version_not_found", `Version ${body.rubricVersion} not found`, "rubricVersion");
    return { status: 200, body: await dryRunAnalysis(row, rubric, origin) };
  }
  if (body.rubric) throw new ApiError(400, "invalid_parameter", "rubric can only be sent with dryRun: true; publish it with PUT /categories/{id} first", "rubric");
  const version = body.rubricVersion ?? category.rubricVersion;
  if (!(await rubricAt(category.id, version))) throw new ApiError(404, "rubric_version_not_found", `Version ${version} not found`, "rubricVersion");
  const busy = row.status === "queued" || row.status === "processing";
  if (busy) throw new ApiError(409, "analysis_in_progress", "This conversation is already being analysed");

  const analysisId = newId("anl");
  await db.transaction(async (tx) => {
    await tx.insert(analyses).values({ id: analysisId, conversationId: row.id, kind: transcribed ? "reanalysis" : "initial", status: "running", rubricVersion: version });
    await tx.update(conv).set({ status: transcribed ? "processing" : "queued", stage: transcribed ? "analyzing" : null, rubricVersion: version, failureCode: null, failureMessage: null, failureStage: null, failureRetryable: null, updatedAt: new Date() }).where(eq(conv.id, row.id));
  });
  // with a transcript only the LLM runs again (no ASR cost); without one, the pipeline restarts from ingest
  await enqueueStage(transcribed ? "analyze" : "ingest", { conversationId: row.id, analysisId });
  return { status: 202, body: (await presentConversations(actor.orgId, [row.id], { transcript: false, origin }))[0] };
}

/* ---------------- human audit ---------------- */

export async function patchScorecard(actor: Actor, ref: string, raw: unknown, origin: string) {
  requireStaff(actor, "audit conversations");
  const body = scorecardPatchBody.parse(raw);
  const row = await findConversation(actor, ref);
  if (row.status !== "completed") throw new ApiError(409, "not_completed", "The conversation's analysis is not complete");
  const [category] = await db.select().from(categories).where(eq(categories.id, row.categoryId));
  const rubric = (await rubricAt(category.id, row.rubricVersion)) ?? category.rubric;

  await db.transaction(async (tx) => {
    for (const o of body.overrides) {
      const [r] = await tx.select().from(criterionResults).where(and(eq(criterionResults.conversationId, row.id), eq(criterionResults.criterionId, o.criterionId)));
      if (!r) throw new ApiError(400, "criterion_not_found", `Criterion ${o.criterionId} is not part of this conversation`, "overrides");
      const value = o.result === null ? null : fromResult(o.result);
      const override = value === r.aiResult ? null : value;
      await tx.update(criterionResults).set({ overrideResult: override, finalResult: override ?? r.aiResult })
        .where(and(eq(criterionResults.conversationId, row.id), eq(criterionResults.criterionId, o.criterionId)));
    }
    const patch: Partial<typeof conv.$inferInsert> = { auditedBy: actor.userId, auditedAt: new Date(), updatedAt: new Date() };
    if (body.outcomeId) {
      const o = rubric.outcomes.find((x) => x.id === body.outcomeId);
      if (!o) throw new ApiError(400, "outcome_not_found", `Outcome ${body.outcomeId} is not in this category`, "outcomeId");
      Object.assign(patch, { outcomeId: o.id, isSuccess: o.isSuccess, isNotApplicable: o.isNotApplicable });
    }
    const all = await tx.select().from(criterionResults).where(eq(criterionResults.conversationId, row.id));
    patch.score = callScore(all);
    patch.riskFlag = all.some((c) => c.sectionId === "compliance" && c.finalResult === "fail");
    if (body.note !== undefined) patch.auditNote = body.note || null;
    await tx.update(conv).set(patch).where(eq(conv.id, row.id));
    if (body.tagSlugs) {
      // only manual tags are edited here; rule-applied tags stay
      const assignable = body.tagSlugs.length
        ? await tx.select({ id: tags.id, slug: tags.slug }).from(tags).where(and(eq(tags.orgId, actor.orgId), eq(tags.assignable, true), inArray(tags.slug, body.tagSlugs)))
        : [];
      const bad = body.tagSlugs.find((s) => !assignable.some((t) => t.slug === s));
      if (bad) throw new ApiError(400, "tag_not_assignable", `Tag ${bad} doesn't exist or can't be applied manually`, "tagSlugs");
      await tx.delete(conversationTags).where(and(eq(conversationTags.conversationId, row.id), eq(conversationTags.source, "manual")));
      if (assignable.length) await tx.insert(conversationTags).values(assignable.map((t) => ({ conversationId: row.id, tagId: t.id, source: "manual" as const }))).onConflictDoNothing();
    }
    await emitEvent(tx, { orgId: row.orgId, type: "conversation.updated", conversationId: row.id });
  });
  return (await presentConversations(actor.orgId, [row.id], { transcript: true, origin }))[0];
}
