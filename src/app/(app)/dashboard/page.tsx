"use client";

import { ArrowRight, ClipboardCheck, Gauge, Phone, ShieldAlert, Target } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentAvatar, PageHeader, Panel, ScoreBadge } from "@/components/app/bits";
import { CallsTable } from "@/components/app/calls-table";
import { OutcomeBars, TrendChart } from "@/components/app/charts";
import { DateRangePicker, useDateRange } from "@/components/app/date-range";
import { KpiCard } from "@/components/app/kpi";
import { UploadDialog } from "@/components/app/upload-dialog";
import { useAnalytics, useWorkspace } from "@/lib/api-client";
import { fmtDuration, fmtPct } from "@/lib/format";
import type { Analytics } from "@/server/services/analytics";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function AgentList({ title, rows, empty }: { title: string; rows: Analytics["agents"]; empty: string }) {
  return (
    <Panel title={title} bodyClassName="p-2">
      {rows.length ? rows.map((r) => (
        <Link key={r.agentId} href={`/agents/${r.agentId}`} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-accent/40">
          <AgentAvatar name={r.name} size="sm" />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{r.name}</span><span className="text-xs text-muted-foreground">{r.teamName} · {r.calls} calls{r.complianceFlags ? ` · ${r.complianceFlags} flags` : ""}</span></span>
          <ScoreBadge score={r.quality == null ? null : Math.round(r.quality)} />
        </Link>
      )) : <p className="p-4 text-sm text-muted-foreground">{empty}</p>}
    </Panel>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { data: ws } = useWorkspace();
  const { from, to } = useDateRange();
  const { data: a } = useAnalytics({ dimension: "org", from, to }, !!ws);
  const isAgent = ws?.me.role === "agent";
  const first = ws?.me.name.split(" ")[0];
  const ranked = (a?.agents ?? []).filter((x) => x.calls >= 3);

  return (
    <>
      <PageHeader
        title={ws ? `${greeting()}, ${first}` : <Skeleton className="h-9 w-72" />}
        description={isAgent ? "Your personal performance for the selected period." : `Here’s how ${ws?.org.name ?? "the floor"} is doing.`}
        actions={<><DateRangePicker />{!isAgent && <UploadDialog />}</>}
      />
      {!a ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label={isAgent ? "My quality score" : "Quality score"} icon={<Gauge className="size-4 text-chart-1" />} value={fmtPct(a.kpis.quality.value, 1)} delta={a.kpis.quality.delta} hint="vs previous period" spark={a.trend.map((d) => d.quality)} />
            <KpiCard label="Success rate" icon={<Target className="size-4 text-chart-2" />} value={fmtPct(a.kpis.successRate.value, 1)} delta={a.kpis.successRate.delta} hint="vs previous period" spark={a.trend.map((d) => d.successRate)} />
            <KpiCard label={isAgent ? "My calls" : "Calls analyzed"} icon={<Phone className="size-4 text-muted-foreground" />} value={a.kpis.volume.value.toLocaleString("en-IN")} delta={a.kpis.volume.delta} deltaSuffix="" hint={`avg ${fmtDuration(a.kpis.avgDurationSec.value)}`} spark={a.trend.map((d) => d.volume)} />
            {isAgent && a.profile ? (
              <KpiCard label="Score vs team average" icon={<ClipboardCheck className="size-4 text-primary" />} value={a.kpis.quality.value != null && a.profile.teamQuality != null ? `${a.kpis.quality.value - a.profile.teamQuality > 0 ? "+" : ""}${(a.kpis.quality.value - a.profile.teamQuality).toFixed(1)}` : "—"} hint={`team avg ${fmtPct(a.profile.teamQuality, 1)}`} />
            ) : (
              <KpiCard label="Compliance flags" icon={<ShieldAlert className="size-4 text-danger" />} value={fmtPct(a.kpis.complianceRate.value, 1)} delta={a.kpis.complianceRate.delta} invertDelta hint="of calls" spark={a.trend.map((d) => d.complianceRate)} />
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-5">
            <Panel className="lg:col-span-3" title="Performance trends" description="Quality score and success rate">
              <TrendChart data={a.trend} granularity={a.range.granularity} />
            </Panel>
            <Panel className="lg:col-span-2" title="Outcomes" description="Click an outcome to open those calls">
              <OutcomeBars data={a.outcomes} onSelect={(label) => router.push(`/calls/all?outcome=${encodeURIComponent(label)}`)} />
            </Panel>
          </div>

          {isAgent ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Coach yourself on" description="Criteria you miss most often">
                {a.profile?.needsWork.length ? (
                  <ul className="divide-y">{a.profile.needsWork.slice(0, 4).map((c) => <li key={c.criterionId} className="flex justify-between gap-3 py-2.5 text-sm"><span>{c.question}</span><span className="shrink-0 font-medium text-danger tabular">{c.failRate}% missed</span></li>)}</ul>
                ) : <p className="text-sm text-muted-foreground">Nothing consistently missed — keep it up.</p>}
                <Button variant="link" className="mt-2 px-0" nativeButton={false} render={<Link href={`/agents/${ws?.me.id}`} />}>Open my report card <ArrowRight className="size-3.5" /></Button>
              </Panel>
              <Panel title="My recent calls" bodyClassName="p-0"><CallsTable compact hideFilters pageSize={5} fixed={{ page: 1, sort: "date", order: "desc", status: "all" }} /></Panel>
            </div>
          ) : (
            <>
              <div className="grid gap-5 lg:grid-cols-2">
                <AgentList title="Top performers" rows={ranked.slice(0, 5)} empty="Not enough calls yet." />
                <AgentList title="Needs coaching" rows={[...ranked].reverse().slice(0, 5)} empty="Not enough calls yet." />
              </div>
              <Panel title="Recent calls" description="The latest calls from the dialer feed and uploads" bodyClassName="p-0"
                actions={<Link href="/calls/all" className="flex items-center gap-1 text-sm text-primary hover:underline">All calls <ArrowRight className="size-3.5" /></Link>}>
                <CallsTable compact hideFilters pageSize={6} fixed={{ page: 1, sort: "date", order: "desc", status: "all" }} />
              </Panel>
            </>
          )}
        </div>
      )}
    </>
  );
}
