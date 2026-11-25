"use client";

import { format } from "date-fns";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Dashboard as Analytics } from "@/server/services/dashboard";

const AXIS = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;

function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-popover-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-muted-foreground">
          {r.color && <span className="size-2 rounded-full" style={{ background: r.color }} />}
          <span className="flex-1">{r.label}</span>
          <span className="font-medium tabular text-popover-foreground">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Quality score and success rate over time — both percentages, so one shared 0–100 axis. */
export function TrendChart({ data, granularity }: { data: Analytics["trend"]; granularity: string }) {
  const rows = data.map((d) => ({ ...d, label: format(new Date(d.date), granularity === "day" ? "d MMM" : "'Wk of' d MMM") }));
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-chart-1" />Quality score</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-chart-2" />Success rate</span>
      </div>
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" {...AXIS} minTickGap={24} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...AXIS} />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                if (!active || !p) return null;
                return <TipBox title={p.label} rows={[
                  { label: "Quality", value: p.quality == null ? "—" : `${p.quality}%`, color: "var(--chart-1)" },
                  { label: "Success", value: p.successRate == null ? "—" : `${p.successRate}%`, color: "var(--chart-2)" },
                  { label: "Conversations", value: String(p.volume) },
                ]} />;
              }}
            />
            <Line type="monotone" dataKey="quality" name="Quality score" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} connectNulls />
            <Line type="monotone" dataKey="successRate" name="Success rate" stroke="var(--chart-2)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const outcomeColor = (o: { type: string }) => (o.type === "success" ? "var(--success)" : o.type === "standard" ? "var(--info)" : "var(--muted-foreground)");
const TYPE_TEXT: Record<string, string> = { success: "success", standard: "standard", na: "NA · excluded" };

/** Outcome share as labelled horizontal bars (status colour + text label, never colour alone). */
export function OutcomeBars({ data: all, onSelect, limit = 7 }: { data: Analytics["outcomes"]; onSelect?: (label: string) => void; limit?: number }) {
  // never more than `limit` rows: the tail folds into "Other"
  const rest = all.slice(limit - 1);
  const data = all.length > limit
    ? [...all.slice(0, limit - 1), { label: `Other (${rest.length})`, type: "other", isSuccess: false, isNotApplicable: false, count: rest.reduce((s, o) => s + o.count, 0), pct: Math.round(rest.reduce((s, o) => s + (o.pct ?? 0), 0) * 10) / 10 }]
    : all;
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <ul className="space-y-3">
      {data.map((o) => (
        <li key={o.label}>
          <button type="button" disabled={o.label.startsWith("Other (")} onClick={() => onSelect?.(o.label)} className="group w-full text-left disabled:cursor-default" title={`View ${o.label} conversations`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate group-hover:underline">{o.label}
                <span className="ml-2 text-xs text-muted-foreground">{TYPE_TEXT[o.type] ?? ""}</span>
              </span>
              <span className="shrink-0 tabular text-muted-foreground"><span className="font-medium text-foreground">{o.pct}%</span> · {o.count}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full transition-all" style={{ width: `${(o.count / max) * 100}%`, background: outcomeColor(o) }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function DurationChart({ data }: { data: Analytics["durations"] }) {
  return (
    <div className="h-48">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis allowDecimals={false} {...AXIS} />
          <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={({ active, payload }) => {
            const p = payload?.[0]?.payload as Analytics["durations"][number] | undefined;
            return active && p ? <TipBox title={p.label} rows={[{ label: "Conversations", value: String(p.count) }]} /> : null;
          }} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
            {data.map((d) => <Cell key={d.key} fill="var(--chart-1)" />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
