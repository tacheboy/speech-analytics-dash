"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DemoBadge, PageHeader, Panel } from "@/components/app/bits";
import { KpiCard } from "@/components/app/kpi";
import { useAnalytics } from "@/lib/api-client";

const CREDITS = [
  { date: "2026-09-01", minutes: 50000, note: "Annual plan — Q3 allocation" },
  { date: "2026-10-01", minutes: 30000, note: "Top-up · PO #KF-2291" },
];

/** Mockup billing: minute balance and usage, derived from analyzed conversation volume. */
export default function BillingPage() {
  const { data: a } = useAnalytics({ dimension: "org" });
  const minutesUsed = a ? Math.round((a.kpis.volume.value * a.kpis.avgDurationSec.value) / 60) : 0;
  const total = CREDITS.reduce((s, c) => s + c.minutes, 0);
  const balance = total - minutesUsed * 2.1; // earlier periods consumed too
  const perDay = minutesUsed / 30;
  const daily = (a?.trend ?? []).map((d) => ({ date: format(new Date(d.date), "d MMM"), minutes: Math.round((d.volume * d.avgDurationSec) / 60) }));
  return (
    <>
      <PageHeader title="Billing & usage" description="Analysis is billed per recorded minute against prepaid credits." actions={<><DemoBadge /><Button onClick={() => toast.info("Credit purchases are handled by your account manager in this demo.")}>Add credits</Button></>} />
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard label="Available balance" value={`${Math.round(balance).toLocaleString("en-IN")} min`} hint="prepaid analysis minutes" />
        <KpiCard label="Used in last 30 days" value={`${minutesUsed.toLocaleString("en-IN")} min`} hint={`${perDay.toFixed(0)} min / day`} />
        <KpiCard label="At this pace" value={`${Math.round(balance / Math.max(perDay, 1))} days`} hint="until credits run out" />
      </div>
      <Panel className="mt-5" title="Daily usage" description="Minutes billed per day">
        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="minutes" name="Minutes" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel className="mt-5" title="Credit history">
        <ul className="divide-y text-sm">{CREDITS.map((c) => <li key={c.date} className="flex justify-between py-2.5"><span>{c.note}<span className="block text-xs text-muted-foreground">{c.date}</span></span><span className="font-medium tabular">+{c.minutes.toLocaleString("en-IN")} min</span></li>)}</ul>
      </Panel>
    </>
  );
}
