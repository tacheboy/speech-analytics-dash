import { and, eq, lte } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { mockAnalyzer } from "./mock-analyzer";
import { toRows } from "./persist";

const { calls, categories, criterionResults } = schema;

/**
 * Lazy completion: finalises any "processing" calls whose simulated work is due.
 * Called at the start of read services — no worker/queue needed. Idempotent (claims rows by status).
 */
export async function advancePipeline(orgId: string) {
  const due = await db
    .select({ id: calls.id, templateId: calls.templateId, failureReason: calls.failureReason, categoryId: calls.categoryId, durationSec: calls.durationSec, isSimulated: calls.isSimulated })
    .from(calls)
    .where(and(eq(calls.orgId, orgId), eq(calls.status, "processing"), lte(calls.readyAt, new Date())));
  for (const c of due) {
    await db.transaction(async (tx) => {
      if (c.failureReason || !c.templateId) {
        await tx.update(calls).set({ status: "failed", failureReason: c.failureReason ?? "Recording could not be processed" })
          .where(and(eq(calls.id, c.id), eq(calls.status, "processing")));
        return;
      }
      const [cat] = await tx.select().from(categories).where(eq(categories.id, c.categoryId));
      const { callPatch, criterionRows } = toRows(c.id, cat.rubric, mockAnalyzer.analyze({ rubric: cat.rubric, templateId: c.templateId }));
      // uploaded (non-sample) recordings keep their real duration; the analysis is simulated
      const patch = c.isSimulated ? { ...callPatch, durationSec: c.durationSec } : callPatch;
      const claimed = await tx.update(calls).set(patch).where(and(eq(calls.id, c.id), eq(calls.status, "processing"))).returning({ id: calls.id });
      if (claimed.length && criterionRows.length) await tx.insert(criterionResults).values(criterionRows).onConflictDoNothing();
    });
  }
}
