"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Coins, Cpu, Timer, Webhook } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader, Panel, Pill } from "@/components/app/bits";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import type { Ops } from "@/server/services/ops";

const Stat = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
  <div className="rounded-xl border bg-background/40 px-4 py-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-xl font-semibold tabular">{value ?? "—"}</p>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

/** Pipeline health from our own tables: what's in flight, what failed and why, how fast, and what it costs. */
export default function PipelinePage() {
  const { data: o, isLoading } = useQuery({ queryKey: ["ops"], queryFn: () => api<Ops>("/api/internal/ops"), refetchInterval: 10_000 });
  if (isLoading || !o) return <><PageHeader title="Pipeline" description="Processing health for your conversations." /><Skeleton className="h-96 rounded-2xl" /></>;
  const inFlight = o.backlog.reduce((a, b) => a + b.n, 0);
  return (
    <>
      <PageHeader title="Pipeline" description="Processing health: what's in flight, what failed and why, how fast, and what it costs. Refreshes every 10 s." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Throughput & latency" icon={<Timer className="size-4" />} description="Submitted → completed, last 7 days. Target: p95 ≤ 5 min.">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Completed" value={o.latency.completed7d.toLocaleString("en-IN")} />
            <Stat label="p50" value={o.latency.p50Sec != null ? `${o.latency.p50Sec} s` : null} />
            <Stat label="p95" value={o.latency.p95Sec != null ? `${o.latency.p95Sec} s` : null} hint={o.latency.p95Sec != null && o.latency.p95Sec > 300 ? "above target" : undefined} />
          </div>
        </Panel>
        <Panel title="In flight" icon={<Activity className="size-4" />} description="Queued and processing now, by stage.">
          {inFlight === 0 ? <p className="text-sm text-muted-foreground">Nothing in flight.</p> : (
            <ul className="divide-y text-sm">{o.backlog.map((b) => <li key={`${b.status}${b.stage}`} className="flex justify-between py-2"><span className="capitalize">{b.stage ?? b.status}</span><span className="tabular">{b.n} · oldest {b.oldest_min} min</span></li>)}</ul>
          )}
        </Panel>
        <Panel title="Failures, last 7 days" icon={<AlertTriangle className="size-4" />} description="Typed failure codes. Retryable ones can be re-run from the conversation page or POST /conversations/{id}/analyze.">
          {o.failures.length === 0 ? <p className="text-sm text-muted-foreground">No failures.</p> : (
            <ul className="divide-y text-sm">
              {o.failures.map((f) => (
                <li key={`${f.code}${f.stage}`} className="flex items-center justify-between gap-2 py-2">
                  <span><code className="text-xs">{f.code}</code> <span className="text-muted-foreground">· {f.stage}</span></span>
                  <span className="flex items-center gap-2">{f.retryable && <Pill tone="info">retryable</Pill>}<Link className="tabular hover:underline" href={`/conversations/all?status=${f.code === "too_short" || f.code === "no_speech" ? "skipped" : "failed"}`}>{f.n}</Link></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="LLM cost, last 30 days" icon={<Coins className="size-4" />} description={o.cost30d.note}>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="₹ / conversation" value={o.cost30d.inrPerConversation} />
            <Stat label="₹ / analysed minute" value={o.cost30d.inrPerMinute} />
            <Stat label="Total" value={`$${o.cost30d.usd}`} hint={`${o.cost30d.conversations.toLocaleString("en-IN")} analyses · ${o.cost30d.minutes.toLocaleString("en-IN")} min`} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Tokens: {o.cost30d.tokens.input.toLocaleString("en-IN")} in · {o.cost30d.tokens.cached.toLocaleString("en-IN")} from cache · {o.cost30d.tokens.output.toLocaleString("en-IN")} out · repair rate {o.cost30d.repairRate ?? 0}%
            {o.cost30d.unpriced > 0 && ` · ${o.cost30d.unpriced} analyses used an unpriced model (add it to prices.ts)`}
          </p>
        </Panel>
        <Panel title="Models in use, last 30 days" icon={<Cpu className="size-4" />} description={`Configured: ${o.providers.asr} → ${o.providers.llm}${o.providers.llmFallback ? `, fallback ${o.providers.llmFallback}` : ""}`}>
          {o.models.length === 0 ? <p className="text-sm text-muted-foreground">No analyses yet.</p> : (
            <ul className="divide-y text-sm">{o.models.map((m) => <li key={`${m.asr}${m.llm}`} className="flex justify-between gap-2 py-2"><code className="text-xs">{m.asr ?? "—"} → {m.llm ?? "—"}</code><span className="tabular">{m.n}{m.fallback ? ` · ${m.fallback} via fallback` : ""}</span></li>)}</ul>
          )}
        </Panel>
        <Panel title="Webhook endpoints, last 24 hours" icon={<Webhook className="size-4" />}>
          {o.webhooks.length === 0 ? <EmptyState title="No endpoints" description="Add one in Integrations." /> : (
            <ul className="divide-y text-sm">
              {o.webhooks.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-2 py-2">
                  <code className="min-w-0 truncate text-xs">{w.url}</code>
                  <span className="flex shrink-0 items-center gap-2">{w.disabled_at ? <Pill tone="danger">disabled</Pill> : w.failing_since ? <Pill tone="warning">failing</Pill> : <Pill tone="success">healthy</Pill>}<span className="tabular text-muted-foreground">{w.ok} ok · {w.failed} failed</span></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
