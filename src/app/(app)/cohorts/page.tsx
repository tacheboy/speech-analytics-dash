"use client";

import { BarChart3, Phone, Plus } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentAvatar, PageHeader, Pill, ScoreBadge } from "@/components/app/bits";
import { useDashboard, useWorkspace } from "@/lib/api-client";
import { fmtPct } from "@/lib/format";

const LANG = { "ta-en": "Tamil–English", "kn-en": "Kannada–English", "hi-en": "Hindi–English" } as Record<string, string>;

function TeamCard({ id, name, language }: { id: string; name: string; language: string | null }) {
  const { data: ws } = useWorkspace();
  const { data: a } = useDashboard({ dimension: "team", id });
  const members = ws?.people.filter((x) => x.cohortId === id) ?? [];
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="font-semibold">{name}</h2><p className="text-sm text-muted-foreground">{members.length} people</p></div>
        {language && <Pill tone="primary">{LANG[language] ?? language}</Pill>}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-xs text-muted-foreground">Conversations · 30d</dt><dd className="mt-1 text-lg font-semibold tabular">{a ? a.kpis.volume.value : <Skeleton className="h-6 w-10" />}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Quality</dt><dd className="mt-1">{a ? <ScoreBadge score={a.kpis.quality.value == null ? null : Math.round(a.kpis.quality.value)} /> : <Skeleton className="h-6 w-12" />}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Success</dt><dd className="mt-1 text-lg font-semibold tabular">{a ? fmtPct(a.kpis.successRate.value) : <Skeleton className="h-6 w-10" />}</dd></div>
      </dl>
      <div className="mt-4 flex -space-x-2">{members.map((m) => <Link key={m.id} href={`/people/${m.id}`} title={m.name} className="rounded-full ring-2 ring-card"><AgentAvatar name={m.name} size="sm" /></Link>)}</div>
      <div className="mt-5 flex gap-2 border-t pt-4">
        <Button variant="outline" size="sm" className="gap-1.5" nativeButton={false} render={<Link href={`/analytics/team/${id}`} />}><BarChart3 className="size-3.5" /> Analytics</Button>
        <Button variant="ghost" size="sm" className="gap-1.5" nativeButton={false} render={<Link href={`/conversations/all?cohortId=${id}`} />}><Phone className="size-3.5" /> Conversations</Button>
      </div>
    </div>
  );
}

export default function TeamsPage() {
  const { data: ws } = useWorkspace();
  return (
    <>
      <PageHeader title="Cohorts" description="Floors are grouped by the language mix their customers speak." actions={<Button className="gap-2" onClick={() => toast.info("Cohort management is a mockup in this demo build.")}><Plus className="size-4" /> New cohort</Button>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ws ? ws.cohorts.map((t) => <TeamCard key={t.id} {...t} />) : Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}
      </div>
    </>
  );
}
