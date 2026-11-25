import { and, eq, inArray } from "drizzle-orm";
import type { Rubric } from "@/lib/domain";
import { db, schema } from "@/server/db/client";
import { istDay } from "./dates";
import { absoluteUrl } from "./http";

const { calls, categories, criterionResults, callTags, tags, users } = schema;
type Call = typeof calls.$inferSelect;
type Category = typeof categories.$inferSelect;
type CriterionRow = typeof criterionResults.$inferSelect;
type ExtractionField = Rubric["extractionFields"][number];

/** Our field types → the docs' vocabulary ("text" is "string" there). */
const fieldType = (t: ExtractionField["fieldType"]) => (t === "text" ? "string" : t);
const enumValues = (f: ExtractionField) => (f.enumOptions?.length ? f.enumOptions.map((o) => o.value) : null);

export const externalStatus = (s: Call["status"]) => (s === "done" ? "completed" : s === "failed" ? "failed" : "processing");

/** Everything needed to render a call for the external API / webhooks. */
export async function loadCall(orgId: string, callId: string) {
  const [call] = await db.select().from(calls).where(and(eq(calls.id, callId), eq(calls.orgId, orgId)));
  if (!call) return null;
  const [[category], results, tagRows, people] = await Promise.all([
    db.select().from(categories).where(eq(categories.id, call.categoryId)),
    db.select().from(criterionResults).where(eq(criterionResults.callId, callId)),
    db.select({ id: tags.id, slug: tags.slug, displayName: tags.displayName, description: tags.description }).from(callTags).innerJoin(tags, eq(tags.id, callTags.tagId)).where(eq(callTags.callId, callId)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, [call.agentId, call.uploadedBy ?? call.agentId])),
  ]);
  return { call, category, results, tags: tagRows, agent: people.find((p) => p.id === call.agentId) ?? null, uploader: call.uploadedBy ? people.find((p) => p.id === call.uploadedBy) ?? null : null };
}
export type LoadedCall = NonNullable<Awaited<ReturnType<typeof loadCall>>>;

/** Sections in rubric order from the stored criterion rows (NA rows included, excluded from the score). */
export function sectionsOf(rubric: Rubric, results: CriterionRow[]) {
  const byId = new Map(results.map((r) => [r.criterionId, r]));
  return rubric.sections
    .map((s) => {
      const rows = s.criteria.flatMap((c) => {
        const r = byId.get(c.id);
        return r ? [{ c, r }] : [];
      });
      const passes = rows.filter(({ r }) => r.finalResult === "pass").length;
      const fails = rows.filter(({ r }) => r.finalResult === "fail").length;
      return { s, rows, passes, fails };
    })
    .filter((x) => x.rows.length);
}

export function extractionsOf(rubric: Rubric, values: Call["extractions"]) {
  if (!values) return null;
  return rubric.extractionFields.map((f) => ({
    id: f.fieldName,
    fieldName: f.fieldName,
    displayName: f.displayName,
    value: values[f.fieldName] ?? null,
    fieldType: fieldType(f.fieldType),
    description: f.description,
    required: f.required ?? false,
    enumValues: enumValues(f),
  }));
}

const outcomeLabel = (rubric: Rubric, id: string | null) => rubric.outcomes.find((o) => o.id === id)?.label ?? null;
const updatedAt = (c: Call) => c.completedAt ?? c.createdAt;

/** GET /calls/{id}/analysis body. */
export function analysisBody({ call, category, results }: LoadedCall, origin: string) {
  const status = externalStatus(call.status);
  const rubric = category.rubric;
  return {
    data: {
      callId: call.id,
      status,
      analysis:
        status === "completed"
          ? {
              score: call.score ?? 0,
              outcomeLabel: outcomeLabel(rubric, call.outcomeId),
              outcomeRationale: call.outcomeRationale,
              callObservations: call.observations,
              areasForImprovement: call.improvements,
              extractions: extractionsOf(rubric, call.extractions),
              sections: sectionsOf(rubric, results).map(({ s, rows, passes, fails }) => ({
                sectionId: s.id,
                sectionName: s.name,
                score: passes,
                totalScore: passes + fails,
                criterias: rows.map(({ c, r }) => ({
                  criteriaId: c.id,
                  question: c.question,
                  result: r.finalResult === "pass" ? "yes" : r.finalResult === "fail" ? "no" : "na",
                  rationale: r.rationale || r.naReason || "",
                })),
              })),
            }
          : null,
      metadata: {
        date: istDay(call.callAt),
        duration: call.durationSec,
        summary: call.summary,
        audioUrl: absoluteUrl(call.audioUrl, origin),
        udfs: call.udfs ?? {},
        createdAt: call.callAt.toISOString(),
        updatedAt: updatedAt(call).toISOString(),
      },
    },
  };
}

/** `call.analysis_complete` webhook data. */
export function analysisCompleteData(l: LoadedCall, origin: string) {
  const { call, category, results, agent, uploader } = l;
  const rubric = category.rubric;
  return {
    callId: call.id,
    organizationId: call.orgId,
    memberId: call.agentId,
    memberName: agent?.name ?? null,
    categoryId: call.categoryId,
    duration: call.durationSec,
    date: istDay(call.callAt),
    audioUrl: absoluteUrl(call.audioUrl, origin),
    udfs: call.udfs ?? null,
    score: call.score ?? 0,
    outcomeLabel: outcomeLabel(rubric, call.outcomeId),
    outcomeRationale: call.outcomeRationale,
    callObservations: call.observations,
    areasForImprovement: call.improvements,
    summary: call.summary,
    transcript: call.transcript?.map((t) => ({ start: t.start, end: t.end, speaker: t.speaker, content: t.text })) ?? null,
    extractions: extractionsOf(rubric, call.extractions),
    analytics: sectionsOf(rubric, results).map(({ s, rows, passes, fails }) => ({
      sectionId: s.id,
      sectionName: s.name,
      score: passes,
      totalScore: passes + fails,
      criterias: rows.map(({ c, r }) => ({
        criteriaId: c.id,
        question: c.question,
        result: r.finalResult === "pass" ? true : r.finalResult === "fail" ? false : null,
        rationale: r.rationale || r.naReason || "",
      })),
    })),
    uploadedBy: call.uploadedBy,
    uploadedByName: uploader?.name ?? null,
    uploadedByEmail: uploader?.email ?? null,
    tags: l.tags.map((t) => ({ id: t.id, slug: t.slug, displayName: t.displayName, description: t.description })),
    completedAt: (call.completedAt ?? new Date()).toISOString(),
    createdAt: call.callAt.toISOString(),
  };
}

/* ---------- categories ---------- */

export function categorySummary(c: Category) {
  // categories carry no timestamps in this build; null rather than invented values
  return { id: c.id, name: c.name, description: c.description, icon: c.icon, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() };
}

export async function categoryDetail(c: Category) {
  const r = c.rubric;
  const tagRows = r.tagTargets?.length
    ? await db.select({ id: tags.id, slug: tags.slug, displayName: tags.displayName }).from(tags).where(and(eq(tags.orgId, c.orgId), inArray(tags.slug, r.tagTargets)))
    : [];
  return {
    ...categorySummary(c),
    intendedPurpose: r.intendedPurpose ?? null,
    additionalLLMContext: r.additionalLLMContext ?? null,
    possibleOutcomes: r.outcomes.map((o) => ({ id: o.id, label: o.label, description: o.description, isSuccess: o.isSuccess, isNotApplicable: o.isNotApplicable ?? false })),
    analysisPointers: r.sections.map((s) => ({
      id: s.id,
      sectionId: s.id,
      sectionName: s.name,
      criterias: s.criteria.map((cr) => ({ id: cr.id, criteriaId: cr.id, question: cr.question })),
    })),
    extractionFields: r.extractionFields.map((f) => ({
      id: f.fieldName,
      fieldName: f.fieldName,
      displayName: f.displayName,
      fieldType: fieldType(f.fieldType),
      enumOptions: f.enumOptions?.map((o) => ({ value: o.value, hint: o.hint ?? null })) ?? [],
      enumValues: enumValues(f) ?? [],
      description: f.description,
      required: f.required ?? false,
    })),
    targetingRules: (r.targetingRules ?? []).map((t) => ({ targetType: t.targetType, targetId: t.targetId, expression: t.expression ?? null })),
    tagTargets: (r.tagTargets ?? []).flatMap((slug) => tagRows.filter((t) => t.slug === slug)),
  };
}
