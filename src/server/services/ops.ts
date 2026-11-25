import { sql } from "drizzle-orm";
import { requireStaff, type Actor } from "@/server/auth";
import { db } from "@/server/db/client";
import { providerStatus } from "@/server/pipeline/providers/registry";

const USD_INR = Number(process.env.USD_INR ?? 85);

/** UI-only (/api/internal/ops): pipeline health for the org from the tables we already have. No new monitoring stack. */
export async function getOps(actor: Actor) {
  requireStaff(actor, "view pipeline health");
  const org = actor.orgId;
  const [backlog, failures, latency, cost, models, hooks] = await Promise.all([
    db.execute<{ status: string; stage: string | null; n: number; oldest_min: number }>(sql`
      select status, stage, count(*)::int as n, round(extract(epoch from now() - min(updated_at)) / 60)::int as oldest_min
      from conversations where org_id = ${org} and status in ('queued', 'processing') and deleted_at is null group by 1, 2 order by 1, 2`),
    db.execute<{ code: string; stage: string | null; n: number; retryable: boolean }>(sql`
      select failure_code as code, failure_stage as stage, bool_or(failure_retryable) as retryable, count(*)::int as n
      from conversations where org_id = ${org} and status in ('failed', 'skipped') and updated_at > now() - interval '7 days' group by 1, 2 order by n desc`),
    db.execute<{ n: number; p50: number | null; p95: number | null }>(sql`
      select count(*)::int as n,
        percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at)) as p50,
        percentile_cont(0.95) within group (order by extract(epoch from completed_at - created_at)) as p95
      from conversations where org_id = ${org} and status = 'completed' and created_at > now() - interval '7 days' and completed_at > created_at`),
    db.execute<{ conversations: number; minutes: number | null; usd: number | null; unpriced: number; input: number | null; cached: number | null; output: number | null; repaired: number }>(sql`
      select count(*)::int as conversations, sum(a.audio_seconds) / 60 as minutes, sum(a.cost_micros_usd) / 1e6 as usd,
        count(*) filter (where a.cost_micros_usd is null)::int as unpriced, sum(a.input_tokens) as input, sum(a.cached_tokens) as cached, sum(a.output_tokens) as output,
        count(*) filter (where a.repaired)::int as repaired
      from analyses a join conversations c on c.id = a.conversation_id
      where c.org_id = ${org} and a.status = 'completed' and a.completed_at > now() - interval '30 days'`),
    db.execute<{ asr: string | null; llm: string | null; n: number; fallback: number }>(sql`
      select a.asr_model as asr, a.llm_model as llm, count(*)::int as n, count(*) filter (where a.used_fallback)::int as fallback
      from analyses a join conversations c on c.id = a.conversation_id
      where c.org_id = ${org} and a.status = 'completed' and a.completed_at > now() - interval '30 days' group by 1, 2 order by n desc`),
    db.execute<{ id: string; url: string; ok: number; failed: number; failing_since: string | null; disabled_at: string | null }>(sql`
      select w.id, w.url, w.failing_since, w.disabled_at,
        count(d.*) filter (where d.status_code between 200 and 299)::int as ok, count(d.*) filter (where d.error is not null)::int as failed
      from webhooks w left join webhook_deliveries d on d.webhook_id = w.id and d.created_at > now() - interval '24 hours'
      where w.org_id = ${org} group by w.id order by w.created_at`),
  ]);
  const c = cost[0];
  const usd = Number(c?.usd ?? 0);
  return {
    providers: providerStatus(),
    backlog: [...backlog],
    failures: [...failures],
    latency: { completed7d: latency[0]?.n ?? 0, p50Sec: latency[0]?.p50 == null ? null : Math.round(latency[0].p50), p95Sec: latency[0]?.p95 == null ? null : Math.round(latency[0].p95) },
    cost30d: {
      conversations: c?.conversations ?? 0, minutes: Math.round(Number(c?.minutes ?? 0)), usd: Math.round(usd * 100) / 100, unpriced: c?.unpriced ?? 0,
      inrPerConversation: c?.conversations ? Math.round(((usd * USD_INR) / c.conversations) * 100) / 100 : null,
      inrPerMinute: Number(c?.minutes) ? Math.round(((usd * USD_INR) / Number(c!.minutes)) * 100) / 100 : null,
      tokens: { input: Number(c?.input ?? 0), cached: Number(c?.cached ?? 0), output: Number(c?.output ?? 0) },
      repairRate: c?.conversations ? Math.round((1000 * c.repaired) / c.conversations) / 10 : null,
      note: "LLM cost only; ASR is billed per audio minute by the provider",
    },
    models: [...models],
    webhooks: [...hooks],
  };
}
export type Ops = Awaited<ReturnType<typeof getOps>>;
