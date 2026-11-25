import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { providerStatus } from "@/server/pipeline/providers/registry";
import { storageDriver } from "@/server/storage";

/** Health check for load balancers and platforms: database, queue backlog, resolved providers (never keys). */
export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    const [backlog] = await db.execute<{ queued: number; processing: number }>(sql`
      select count(*) filter (where status = 'queued')::int as queued, count(*) filter (where status = 'processing')::int as processing
      from conversations where status in ('queued', 'processing') and deleted_at is null`);
    const p = providerStatus();
    return Response.json({
      status: p.error ? "degraded" : "ok", db: { ok: true, ms: Date.now() - started }, pipeline: backlog,
      providers: { llm: p.llm, asr: p.asr, llmFallback: p.llmFallback, asrFallback: p.asrFallback, error: p.error }, storage: storageDriver(), role: process.env.ROLE ?? "all",
    }, { status: p.error ? 503 : 200 });
  } catch (e) {
    return Response.json({ status: "down", db: { ok: false, error: (e as Error).message } }, { status: 503 });
  }
}
