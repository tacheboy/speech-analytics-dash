"use client";

import { Activity, AlertTriangle, ArrowRight, BarChart3, Clock, Gauge, Medal, Phone, Search, ShieldAlert, Sparkles, Target, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAnalytics, useWorkspace } from "@/lib/api-client";
import { scoreTone } from "@/lib/domain";
import { fmtDuration, fmtPct, shortName } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Analytics } from "@/server/services/analytics";
import { AgentAvatar, Delta, EmptyState, PageHeader, Panel, Pill, ScoreBadge, Sparkline } from "./bits";
import { DurationChart, OutcomeBars, TrendChart } from "./charts";
import { CallsTable } from "./calls-table";
import { DateRangePicker, useDateRange } from "./date-range";
import { KpiCard } from "./kpi";

type Dimension = "org" | "category" | "team" | "agent";
const TABS = ["overview", "quality", "agents"] as const;

/** Builds a call-list URL for the current scope plus extra filters. */
function callsHref(dimension: Dimension, id: string | null, extra: Record<string, string> = {}) {
  const sp = new URLSearchParams(extra);
  if (dimension === "team" && id) sp.set("teamId", id);
  if (dimension === "agent" && id) sp.set("agentId", id);
  return `/calls/${dimension === "category" && id ? id : "all"}?${sp}`;
}

function ScopeSwitcher({ dimension, id }: { dimension: Dimension; id: string | null }) {
  const router = useRouter();
  const { data: ws } = useWorkspace();
  if (!ws || dimension === "agent") return null;
  const items = [
    { value: "org/all", label: "All calls" },
    ...ws.categories.map((c) => ({ value: `category/${c.id}`, label: c.name })),
    ...ws.teams.map((t) => ({ value: `team/${t.id}`, label: t.name })),
  ];
  return (
    <Select items={items} value={`${dimension}/${id ?? "all"}`} onValueChange={(v) => router.push(`/analytics/${v}`)}>
      <SelectTrigger className="h-9 min-w-52"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="org/all">All calls</SelectItem>
        <SelectGroup><SelectLabel>Categories</SelectLabel>{ws.categories.map((c) => <SelectItem key={c.id} value={`category/${c.id}`}>{c.name}</SelectItem>)}</SelectGroup>
        <SelectGroup><SelectLabel>Teams</SelectLabel>{ws.teams.map((t) => <SelectItem key={t.id} value={`team/${t.id}`}>{t.name}</SelectItem>)}</SelectGroup>
      </SelectContent>
    </Select>
  );
}

function Kpis({ a }: { a: Analytics }) {
  const t = a.trend;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Quality score" icon={<Gauge className="size-4 text-chart-1" />} value={fmtPct(a.kpis.quality.value, 1)} delta={a.kpis.quality.delta} hint="vs previous period" spark={t.map((d) => d.quality)} />
      <KpiCard label="Success rate" icon={<Target className="size-4 text-chart-2" />} value={fmtPct(a.kpis.successRate.value, 1)} delta={a.kpis.successRate.delta} hint="vs previous period" spark={t.map((d) => d.successRate)} />
      <KpiCard label="Calls analyzed" icon={<Phone className="size-4 text-muted-foreground" />} value={a.kpis.volume.value.toLocaleString("en-IN")} delta={a.kpis.volume.delta} deltaSuffix="" hint={`avg ${fmtDuration(a.kpis.avgDurationSec.value)} per call`} spark={t.map((d) => d.volume)} />
      <KpiCard label="Compliance flags" icon={<ShieldAlert className="size-4 text-danger" />} value={fmtPct(a.kpis.complianceRate.value, 1)} delta={a.kpis.complianceRate.delta} invertDelta hint="of calls" spark={t.map((d) => d.complianceRate)} />
    </div>
  );
}

function Overview({ a, dimension, id }: { a: Analytics; dimension: Dimension; id: string | null }) {
  const router = useRouter();
  const h = a.highlights;
  return (
    <div className="space-y-5">
      <Kpis a={a} />
      {dimension !== "agent" && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border bg-card p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-danger"><AlertTriangle className="size-4" /> Most common failure</p>
            {h.mostCommonFailure ? (
              <>
                <p className="mt-2 line-clamp-2 font-medium">{h.mostCommonFailure.question}</p>
                <p className="mt-1 text-sm text-muted-foreground">{h.mostCommonFailure.failRate}% failure rate across {h.mostCommonFailure.evaluated} calls</p>
              </>
            ) : <p className="mt-2 text-sm text-muted-foreground">No significant failures detected.</p>}
          </div>
          <div className="rounded-2xl border bg-card p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-warning"><Trophy className="size-4" /> Top performer</p>
            {h.topPerformer ? (
              <Link href={`/agents/${h.topPerformer.agentId}`} className="mt-2 flex items-center gap-3 hover:underline">
                <AgentAvatar name={h.topPerformer.name} size="sm" />
                <span><span className="block font-medium">{h.topPerformer.name}</span><span className="text-sm text-muted-foreground">{fmtPct(h.topPerformer.quality)} quality · {h.topPerformer.calls} calls</span></span>
              </Link>
            ) : <p className="mt-2 text-sm text-muted-foreground">No agent data.</p>}
          </div>
          <div className={cn("rounded-2xl border bg-card p-5", h.attentionRequired.length > 0 && "border-primary/40")}>
            <p className="flex items-center gap-2 text-sm font-medium text-primary"><Activity className="size-4" /> Attention required</p>
            {h.attentionRequired.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">{h.attentionRequired.map((s) => <Pill key={s.sectionId} tone={scoreTone(s.score) === "danger" ? "danger" : "warning"}>{s.name} · {s.score}%</Pill>)}</div>
            ) : <p className="mt-2 text-sm text-muted-foreground">All sections performing well.</p>}
          </div>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-5">
        <Panel className="lg:col-span-2" title="Outcome distribution" description="Share of outcomes across analyzed calls — click to open them">
          {a.outcomes.length ? <OutcomeBars data={a.outcomes} onSelect={(label) => router.push(callsHref(dimension, id, { outcome: label }))} /> : <EmptyState title="No outcomes in this period" />}
        </Panel>
        <Panel className="lg:col-span-3" title="Performance trends" description={`Quality score and success rate per ${a.range.granularity}`}>
          <TrendChart data={a.trend} granularity={a.range.granularity} />
        </Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-5">
        <Panel className="lg:col-span-2" title="Call duration" description="How long conversations run" icon={<Clock className="size-4 text-muted-foreground" />}>
          <DurationChart data={a.durations} />
        </Panel>
        {dimension !== "agent" ? (
          <Panel className="lg:col-span-3" title="Agent leaderboard" description="Ranked by quality, then success rate, then volume" bodyClassName="p-0">
            <Leaderboard agents={a.agents.slice(0, 6)} compact />
          </Panel>
        ) : (
          <Panel className="lg:col-span-3" title="Section scores" description="Where this agent wins and loses points">
            <SectionBars sections={a.sections} />
          </Panel>
        )}
      </div>
    </div>
  );
}

function SectionBars({ sections }: { sections: Analytics["sections"] }) {
  return (
    <ul className="space-y-3">
      {[...sections].sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).map((s) => (
        <li key={s.sectionId}>
          <div className="mb-1 flex justify-between text-sm"><span>{s.name}</span><span className="tabular text-muted-foreground">{fmtPct(s.score)} <span className="text-xs">· {s.evaluated} checks</span></span></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", { success: "bg-success", warning: "bg-warning", danger: "bg-danger", muted: "bg-muted-foreground" }[scoreTone(s.score)])} style={{ width: `${s.score ?? 0}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Leaderboard({ agents, compact }: { agents: Analytics["agents"]; compact?: boolean }) {
  const router = useRouter();
  if (!agents.length) return <EmptyState title="No agent data in this period" />;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-12 pl-5">#</TableHead><TableHead>Agent</TableHead><TableHead className="text-right">Calls</TableHead><TableHead>Quality</TableHead>
            <TableHead className="text-right">Success</TableHead>{!compact && <TableHead className="text-right">Flags</TableHead>}<TableHead>Trend</TableHead><TableHead className="pr-5 text-right">Δ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((r) => (
            <TableRow key={r.agentId} className="cursor-pointer" onClick={() => router.push(`/agents/${r.agentId}`)}>
              <TableCell className="pl-5 tabular text-muted-foreground">{r.rank <= 3 ? <Medal className={cn("size-4", r.rank === 1 ? "text-warning" : "text-muted-foreground")} /> : r.rank}</TableCell>
              <TableCell><div className="flex items-center gap-2.5"><AgentAvatar name={r.name} size="sm" /><span className="min-w-0"><span className="block truncate font-medium">{r.name}</span>{!compact && <span className="text-xs text-muted-foreground">{r.teamName}</span>}</span></div></TableCell>
              <TableCell className="text-right tabular">{r.calls}</TableCell>
              <TableCell><ScoreBadge score={r.quality == null ? null : Math.round(r.quality)} /></TableCell>
              <TableCell className="text-right tabular">{fmtPct(r.successRate)}</TableCell>
              {!compact && <TableCell className="text-right tabular">{r.complianceFlags ? <span className="text-danger">{r.complianceFlags}</span> : <span className="text-muted-foreground">0</span>}</TableCell>}
              <TableCell><Sparkline values={r.trend.map((t) => t.quality ?? 0)} width={80} height={24} /></TableCell>
              <TableCell className="pr-5 text-right"><Delta value={r.delta} suffix="" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Quality({ a, dimension, id }: { a: Analytics; dimension: Dimension; id: string | null }) {
  const [q, setQ] = useState("");
  const rows = a.criteria.filter((c) => !q || c.question.toLowerCase().includes(q.toLowerCase()) || c.sectionName.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="grid items-start gap-5 xl:grid-cols-3">
      <Panel title="Section scores" description="Pass rate of applicable criteria">
        <SectionBars sections={a.sections} />
      </Panel>
      <Panel className="xl:col-span-2" title="Quality improvement hub" description="Every rubric criterion, worst first. Agents listed fail it most often." bodyClassName="p-0"
        actions={<div className="relative w-52"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter criteria…" className="h-8 pl-8 text-sm" aria-label="Filter criteria" /></div>}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-5">Criterion</TableHead><TableHead className="w-40">Failure rate</TableHead><TableHead className="text-right">Checked</TableHead><TableHead className="pr-5">{dimension === "agent" ? "" : "Most misses"}</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.criterionId}>
                  <TableCell className="max-w-md py-3 pl-5 whitespace-normal"><p className="text-sm font-medium leading-snug">{c.question}</p><p className="text-xs text-muted-foreground">{c.sectionName}{c.na ? ` · ${c.na} N/A` : ""}</p></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", c.failRate >= 40 ? "bg-danger" : c.failRate >= 20 ? "bg-warning" : "bg-success")} style={{ width: `${c.failRate}%` }} /></div><span className="text-sm tabular">{c.failRate}%</span></div>
                  </TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">{c.evaluated}</TableCell>
                  <TableCell className="pr-5">
                    {dimension !== "agent" && <div className="flex flex-wrap gap-1">{c.topFailingAgents.map((g) => <Link key={g.agentId} href={callsHref(dimension, id, { agentId: g.agentId, scoreBucket: "poor" })} className="rounded-full border px-2 py-0.5 text-xs hover:bg-accent">{shortName(g.name)} · {g.fails}</Link>)}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!rows.length && <EmptyState title="No criteria match" />}
        </div>
      </Panel>
    </div>
  );
}

function AgentsTab({ a }: { a: Analytics }) {
  const best = (k: "quality" | "successRate" | "calls") => [...a.agents].filter((x) => x.calls >= 3).sort((x, y) => (y[k] ?? 0) - (x[k] ?? 0))[0];
  const cards = [
    { label: "Highest quality", icon: Gauge, r: best("quality"), v: (r: Analytics["agents"][number]) => fmtPct(r.quality) },
    { label: "Highest success", icon: Target, r: best("successRate"), v: (r: Analytics["agents"][number]) => fmtPct(r.successRate) },
    { label: "Highest volume", icon: BarChart3, r: best("calls"), v: (r: Analytics["agents"][number]) => `${r.calls} calls` },
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border bg-card p-5">
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><c.icon className="size-4" />{c.label}</p>
            {c.r ? <Link href={`/agents/${c.r.agentId}`} className="mt-2 flex items-center gap-3 hover:underline"><AgentAvatar name={c.r.name} size="sm" /><span className="font-medium">{c.r.name}</span><span className="ml-auto font-semibold tabular">{c.v(c.r)}</span></Link> : <p className="mt-2 text-sm text-muted-foreground">—</p>}
          </div>
        ))}
      </div>
      <Panel title="Agents audited" description="Click an agent for their coaching profile" bodyClassName="p-0"><Leaderboard agents={a.agents} /></Panel>
    </div>
  );
}

function CriteriaList({ items, empty, tone }: { items: { criterionId: string; question: string; sectionName: string; failRate?: number; before?: number; after?: number }[]; empty: string; tone: "success" | "danger" }) {
  return items.length ? (
      <ul className="divide-y">
        {items.map((c) => (
          <li key={c.criterionId} className="flex items-start justify-between gap-3 py-2.5">
            <span className="min-w-0"><span className="block text-sm leading-snug">{c.question}</span><span className="text-xs text-muted-foreground">{c.sectionName}</span></span>
            <span className={cn("shrink-0 text-sm font-medium tabular", tone === "success" ? "text-success" : "text-danger")}>
              {c.before != null ? `${c.before}% → ${c.after}%` : tone === "success" ? `${100 - (c.failRate ?? 0)}% met` : `${c.failRate}% missed`}
            </span>
          </li>
        ))}
      </ul>
    ) : <p className="py-4 text-sm text-muted-foreground">{empty}</p>;
}

function Profile({ a, id }: { a: Analytics; id: string }) {
  const p = a.profile!;
  const vsTeam = a.kpis.quality.value != null && p.teamQuality != null ? Math.round((a.kpis.quality.value - p.teamQuality) * 10) / 10 : null;
  return (
    <div className="space-y-5">
      <Kpis a={a} />
      <div className="rounded-2xl border bg-card p-5 text-sm">
        <span className="text-muted-foreground">Quality vs team average ({fmtPct(p.teamQuality, 1)}): </span>
        <span className={cn("font-semibold tabular", (vsTeam ?? 0) >= 0 ? "text-success" : "text-danger")}>{vsTeam == null ? "—" : `${vsTeam > 0 ? "+" : ""}${vsTeam} pts`}</span>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Consistent strengths" icon={<Sparkles className="size-4 text-success" />} description="Criteria met on 90%+ of calls"><CriteriaList items={p.strengths} empty="No consistent strengths yet." tone="success" /></Panel>
        <Panel title="Needs work" icon={<AlertTriangle className="size-4 text-danger" />} description="Criteria missed on 35%+ of calls — coach these first"><CriteriaList items={p.needsWork} empty="Nothing consistently missed. 🎉" tone="danger" /></Panel>
        <Panel title="Recent improvements" icon={<TrendingUp className="size-4 text-success" />} description="First half vs second half of the period"><CriteriaList items={p.improvements} empty="No significant improvements in this period." tone="success" /></Panel>
        <Panel title="Recent regressions" icon={<TrendingDown className="size-4 text-danger" />} description="First half vs second half of the period"><CriteriaList items={p.regressions} empty="No regressions in this period." tone="danger" /></Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="Performance trends" description={`Per ${a.range.granularity}`}><TrendChart data={a.trend} granularity={a.range.granularity} /></Panel>
        <Panel className="lg:col-span-2" title="Outcomes"><OutcomeBars data={a.outcomes} /></Panel>
      </div>
      <Panel title="Lowest-scoring recent calls" actions={<Link href={callsHref("agent", id)} className="flex items-center gap-1 text-sm text-primary hover:underline">All calls <ArrowRight className="size-3.5" /></Link>} bodyClassName="p-0">
        <CallsTable compact hideFilters pageSize={5} fixed={{ agentId: [id], sort: "score", order: "asc", status: "done", page: 1, from: a.range.from, to: a.range.to }} />
      </Panel>
    </div>
  );
}

export function AnalyticsView({ dimension, id, title, description }: { dimension: Dimension; id: string | null; title?: string; description?: string }) {
  const { from, to } = useDateRange();
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("overview"));
  const { data: a, isLoading, isError, isFetching } = useAnalytics({ dimension, id: id ?? undefined, from, to });
  const isAgent = dimension === "agent";
  const heading = useMemo(() => title ?? (a ? `${a.scope.name}${isAgent ? "" : " analytics"}` : "Analytics"), [title, a, isAgent]);

  return (
    <>
      <PageHeader title={heading} description={description ?? (a ? `${a.range.from} → ${a.range.to} · compared with the previous period` : "Insights and performance trends")}
        actions={<><ScopeSwitcher dimension={dimension} id={id} /><DateRangePicker /></>} />
      {!isAgent && (
        <div className="mb-5 flex gap-1 border-b" role="tablist">
          {([["overview", "Overview"], ["quality", "Quality analysis"], ["agents", "Agent performance"]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k === "overview" ? null : k)}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium transition", tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{label}</button>
          ))}
        </div>
      )}
      {isLoading && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>}
      {isError && <EmptyState title="Analytics could not be loaded" description="Try again in a moment." />}
      {a && (
        <div className={cn("transition-opacity", isFetching && "opacity-70")}>
          {a.kpis.volume.value === 0 ? (
            <EmptyState title="No analyzed calls in this period" description="Pick a wider date range." />
          ) : isAgent ? (
            <Profile a={a} id={id!} />
          ) : tab === "quality" ? (
            <Quality a={a} dimension={dimension} id={id} />
          ) : tab === "agents" ? (
            <AgentsTab a={a} />
          ) : (
            <Overview a={a} dimension={dimension} id={id} />
          )}
        </div>
      )}
    </>
  );
}
