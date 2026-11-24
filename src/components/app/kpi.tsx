"use client";

import { cn } from "@/lib/utils";
import { Delta, Sparkline } from "./bits";

export function KpiCard({ label, value, delta, deltaSuffix, invertDelta, spark, icon, hint, className }: {
  label: string; value: React.ReactNode; delta?: number | null; deltaSuffix?: string; invertDelta?: boolean;
  spark?: (number | null)[]; icon?: React.ReactNode; hint?: string; className?: string;
}) {
  const s = (spark ?? []).filter((v): v is number => v != null);
  return (
    <div className={cn("flex flex-col justify-between gap-4 rounded-2xl border bg-card p-5", className)}>
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-2 font-medium">{icon}{label}</span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-3xl font-semibold tracking-tight tabular">{value}</p>
          <p className="mt-1 flex items-center gap-1.5">
            {delta !== undefined && <Delta value={delta} suffix={deltaSuffix} invert={invertDelta} />}
            {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
          </p>
        </div>
        {s.length > 1 && <Sparkline values={s} width={110} height={36} tone={invertDelta ? (s.at(-1)! <= s[0] ? "success" : "danger") : undefined} />}
      </div>
    </div>
  );
}
