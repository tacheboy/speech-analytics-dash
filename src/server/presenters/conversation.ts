import { inArray, eq, and } from "drizzle-orm";
import type { Conversation, ConversationSection, Result } from "@/lib/contract";
import { outcomeType, type CriterionResultValue, type Rubric } from "@/lib/domain";
import { db, schema } from "@/server/db/client";
import { rubricFor } from "@/server/rubrics";
import { storage } from "@/server/storage";

const { conversations, users, categories, criterionResults, conversationTags, tags, analyses } = schema;
type Row = typeof conversations.$inferSelect;
type CriterionRow = typeof criterionResults.$inferSelect;

export const toResult = (r: CriterionResultValue): Result => (r === "pass" ? "yes" : r === "fail" ? "no" : "na");
export const fromResult = (r: Result): CriterionResultValue => (r === "yes" ? "pass" : r === "no" ? "fail" : "na");
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function scorecardOf(rubric: Rubric, rows: CriterionRow[]): ConversationSection[] {
  const byId = new Map(rows.map((r) => [r.criterionId, r]));
  return rubric.sections
    .map((s) => {
      const criteria = s.criteria.flatMap((c) => {
        const r = byId.get(c.id);
        if (!r) return [];
        return [{
          criterionId: c.id,
          question: c.question,
          result: toResult(r.finalResult),
          aiResult: toResult(r.aiResult),
          source: r.overrideResult ? ("audit" as const) : r.source,
          naReason: r.finalResult === "na" ? r.naReason ?? "insufficient_information" : null,
          rationale: r.rationale,
          confidence: r.confidence,
          evidence: r.evidenceQuote ? { quote: r.evidenceQuote, start: r.evidenceStart, end: r.evidenceEnd, verified: r.evidenceVerified ?? false } : null,
        }];
      });
      const applicable = criteria.filter((c) => c.result !== "na");
      return { sectionId: s.id, name: s.name, passed: applicable.filter((c) => c.result === "yes").length, applicable: applicable.length, criteria };
    })
    .filter((s) => s.criteria.length);
}

export async function playbackUrl(c: Pick<Row, "playbackKey" | "audioKey" | "sampleId" | "deletedAt">, origin: string) {
  if (c.deletedAt) return null;
  const key = c.playbackKey ?? c.audioKey;
  if (key) return (await storage()).signedGetUrl(key, 3600, origin);
  if (c.sampleId) return `${origin}/audio/${c.sampleId}.m4a`;
  return null;
}

/**
 * Loads and presents conversations by id, in the given order. One query per related table,
 * so a page of 200 costs the same handful of round trips as a single conversation.
 */
export async function presentConversations(orgId: string, ids: string[], opts: { transcript: boolean; origin: string }): Promise<Conversation[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(conversations).where(and(eq(conversations.orgId, orgId), inArray(conversations.id, ids)));
  const personIds = [...new Set(rows.flatMap((r) => [r.personId, r.auditedBy].filter(Boolean) as string[]))];
  const analysisIds = rows.map((r) => r.currentAnalysisId).filter(Boolean) as string[];
  const [people, cats, crit, tagRows, anl] = await Promise.all([
    db.select().from(users).where(inArray(users.id, personIds)),
    db.select().from(categories).where(eq(categories.orgId, orgId)),
    db.select().from(criterionResults).where(inArray(criterionResults.conversationId, ids)),
    db.select({ conversationId: conversationTags.conversationId, slug: tags.slug, displayName: tags.displayName, source: conversationTags.source })
      .from(conversationTags).innerJoin(tags, eq(tags.id, conversationTags.tagId)).where(inArray(conversationTags.conversationId, ids)),
    analysisIds.length ? db.select({ id: analyses.id, asrModel: analyses.asrModel, llmModel: analyses.llmModel, promptVersion: analyses.promptVersion }).from(analyses).where(inArray(analyses.id, analysisIds)) : [],
  ]);
  const personById = new Map(people.map((p) => [p.id, p]));
  const catById = new Map(cats.map((c) => [c.id, c]));
  const anlById = new Map(anl.map((a) => [a.id, a]));

  const out = await Promise.all(
    rows.map(async (c): Promise<Conversation> => {
      const p = personById.get(c.personId);
      const cat = catById.get(c.categoryId)!;
      const rubric = await rubricFor(cat, c.rubricVersion);
      const outcome = c.outcomeId ? rubric.outcomes.find((o) => o.id === c.outcomeId) : undefined;
      const a = c.currentAnalysisId ? anlById.get(c.currentAnalysisId) : undefined;
      const done = c.status === "completed" && !c.deletedAt;
      const auditor = c.auditedBy ? personById.get(c.auditedBy) : undefined;
      return {
        object: "conversation",
        id: c.id,
        externalId: c.externalId,
        status: c.status,
        stage: c.status === "processing" ? c.stage : null,
        failure: c.failureCode
          ? { code: c.failureCode as never, message: c.failureMessage ?? "", stage: (c.failureStage as never) ?? null, retryable: c.failureRetryable ?? false }
          : null,
        ...(c.deletedAt ? { deleted: true } : {}),
        categoryId: c.categoryId,
        rubricVersion: c.rubricVersion,
        person: { id: c.personId, externalId: p?.externalId ?? null, name: p?.name ?? "Unknown", email: p?.email ?? null, cohortId: p?.cohortId ?? null },
        occurredAt: c.occurredAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        completedAt: iso(c.completedAt),
        audio: { durationSec: c.durationSec, channels: c.channels, fileName: c.fileName, playbackUrl: await playbackUrl(c, opts.origin) },
        language: { hint: c.language, detected: c.languageDetected },
        score: done && !c.isNotApplicable ? c.score : null,
        aiScore: done && !c.isNotApplicable ? c.aiScore : null,
        outcome: outcome ? { id: outcome.id, label: outcome.label, type: outcomeType(outcome), rationale: c.outcomeRationale } : null,
        riskFlag: done ? c.riskFlag : null,
        summary: c.summary,
        observations: c.observations,
        improvements: c.improvements,
        scorecard: done ? scorecardOf(rubric, crit.filter((r) => r.conversationId === c.id)) : null,
        extractions: c.extractions,
        tags: tagRows.filter((t) => t.conversationId === c.id).map(({ slug, displayName, source }) => ({ slug, displayName, source })),
        moments: c.moments,
        metrics: c.metrics ? { ...c.metrics, languageMix: c.metrics.languageMix as Record<string, number> } : null,
        ...(opts.transcript ? { transcript: c.transcript?.map((s) => ({ ...s, speaker: s.speaker === "agent" ? ("person" as const) : ("customer" as const) })) ?? null } : {}),
        metadata: c.metadata ?? {},
        audit: c.auditedAt ? { auditedBy: c.auditedBy, auditedByName: auditor?.name ?? null, auditedAt: c.auditedAt.toISOString(), note: c.auditNote } : null,
        analysis: a
          ? { id: a.id, models: { asr: a.asrModel, llm: a.llmModel }, promptVersion: a.promptVersion, simulated: Boolean(a.llmModel?.startsWith("mock:") && !c.sampleId) }
          : null,
      };
    }),
  );
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((x, y) => order.get(x.id)! - order.get(y.id)!);
}
