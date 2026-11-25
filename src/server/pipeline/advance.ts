import { and, eq, inArray, lte, or } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { emitCallEvent, type CallEvent } from "@/server/webhooks";
import { mockAnalyzer } from "./mock-analyzer";
import { toRows } from "./persist";

const { calls, categories, criterionResults, callTags, tags } = schema;

/**
 * Lazy completion: finalises any "processing" calls whose simulated work is due.
 * Called at the start of read services — no worker/queue needed. Idempotent (claims rows by status).
 * Every terminal transition emits a webhook event.
 */
export async function advancePipeline(orgId: string) {
  const due = await db
    .select({ id: calls.id, templateId: calls.templateId, failureReason: calls.failureReason, ingestPending: calls.ingestPending, categoryId: calls.categoryId, durationSec: calls.durationSec, isSimulated: calls.isSimulated })
    .from(calls)
    // a remote recording still downloading isn't due yet — unless the download has been stuck for 2 minutes
    .where(and(eq(calls.orgId, orgId), eq(calls.status, "processing"), lte(calls.readyAt, new Date()),
      or(eq(calls.ingestPending, false), lte(calls.createdAt, new Date(Date.now() - 120_000)))));

  for (const c of due) {
    let event: CallEvent | null = null;
    await db.transaction(async (tx) => {
      if (c.failureReason || !c.templateId || c.ingestPending) {
        const reason = c.failureReason ?? (c.ingestPending ? "Unable to ingest recording: download did not complete" : "Unable to ingest recording");
        const claimed = await tx.update(calls).set({ status: "failed", failureReason: reason, ingestPending: false, completedAt: new Date() })
          .where(and(eq(calls.id, c.id), eq(calls.status, "processing"))).returning({ id: calls.id });
        if (claimed.length) event = "call.ingestion_failed";
        return;
      }
      const [cat] = await tx.select().from(categories).where(eq(categories.id, c.categoryId));
      let rows;
      try {
        rows = toRows(c.id, cat.rubric, mockAnalyzer.analyze({ rubric: cat.rubric, templateId: c.templateId }));
      } catch (e) {
        const claimed = await tx.update(calls).set({ status: "failed", failureReason: `Call analysis failed: ${(e as Error).message}`, completedAt: new Date() })
          .where(and(eq(calls.id, c.id), eq(calls.status, "processing"))).returning({ id: calls.id });
        if (claimed.length) event = "call.analysis_failed";
        return;
      }
      const { callPatch, criterionRows, tagSlugs } = rows;
      // uploaded (non-sample) recordings keep their real duration; the analysis is simulated
      const patch = { ...callPatch, ...(c.isSimulated ? { durationSec: c.durationSec } : {}), completedAt: new Date() };
      const claimed = await tx.update(calls).set(patch).where(and(eq(calls.id, c.id), eq(calls.status, "processing"))).returning({ id: calls.id });
      if (!claimed.length) return;
      if (criterionRows.length) await tx.insert(criterionResults).values(criterionRows).onConflictDoNothing();
      if (tagSlugs.length) {
        const tagRows = await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.orgId, orgId), inArray(tags.slug, tagSlugs)));
        if (tagRows.length) await tx.insert(callTags).values(tagRows.map((t) => ({ callId: c.id, tagId: t.id, source: "rule" as const }))).onConflictDoNothing();
      }
      event = "call.analysis_complete";
    });
    if (event) await emitCallEvent(orgId, event, c.id);
  }
}
