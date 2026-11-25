"use client";

import { Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AgentAvatar, Delta, PageHeader, ScoreBadge, Sparkline } from "@/components/app/bits";
import { DateRangePicker, useDateRange } from "@/components/app/date-range";
import { useAnalytics, useWorkspace } from "@/lib/api-client";
import { fmtDate, fmtPct } from "@/lib/format";

export default function AgentsPage() {
  const router = useRouter();
  const { from, to } = useDateRange();
  const { data: ws } = useWorkspace();
  const { data: a, isLoading } = useAnalytics({ dimension: "org", from, to });
  const [q, setQ] = useState("");
  const stats = new Map(a?.agents.map((r) => [r.agentId, r]));
  const agents = (ws?.agents ?? []).filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()) || x.email.includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="People" description="Performance of every person on the floor for the selected period." actions={<><DateRangePicker /><Button className="gap-2" onClick={() => toast.info("People are created automatically from the dialer feed in this demo.")}><Plus className="size-4" /> Add person</Button></>} />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" className="h-9 pl-9" aria-label="Search people" />
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Person</TableHead><TableHead>Cohort</TableHead><TableHead className="text-right">Conversations</TableHead><TableHead>Avg quality</TableHead>
              <TableHead className="text-right">Success</TableHead><TableHead>Performance trend</TableHead><TableHead>Δ vs prev.</TableHead><TableHead className="pr-5">Date added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(isLoading || !ws) && Array.from({ length: 8 }).map((_, i) => <TableRow key={i}><TableCell colSpan={8} className="px-5"><Skeleton className="h-9" /></TableCell></TableRow>)}
            {ws && agents.map((ag) => {
              const s = stats.get(ag.id);
              return (
                <TableRow key={ag.id} className="cursor-pointer" onClick={() => router.push(`/people/${ag.id}`)}>
                  <TableCell className="py-3 pl-5"><div className="flex items-center gap-3"><AgentAvatar name={ag.name} /><div><p className="font-medium">{ag.name}</p><p className="text-xs text-muted-foreground">{ag.email}</p></div></div></TableCell>
                  <TableCell className="text-muted-foreground">{ws.teams.find((t) => t.id === ag.teamId)?.name}</TableCell>
                  <TableCell className="text-right tabular">{s?.calls ?? 0}</TableCell>
                  <TableCell><ScoreBadge score={s?.quality == null ? null : Math.round(s.quality)} /></TableCell>
                  <TableCell className="text-right tabular">{fmtPct(s?.successRate)}</TableCell>
                  <TableCell><Sparkline values={(s?.trend ?? []).map((t) => t.quality ?? 0)} /></TableCell>
                  <TableCell><Delta value={s?.delta} /></TableCell>
                  <TableCell className="pr-5 text-muted-foreground tabular">{fmtDate(ag.createdAt)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
