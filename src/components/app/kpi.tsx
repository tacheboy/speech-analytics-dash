"use client";

import { cn } from "@/lib/utils";
import { Delta, InfoHint, Sparkline } from "./bits";

/** Metric definitions, worded as in Voxxi's product guide. */
export const METRIC_HELP = {
  quality: "Quality score per conversation = criteria answered Yes ÷ (total criteria − NA) × 100, all criteria weighted equally. Shown here as the average across conversations; conversations with an NA outcome are excluded.",
  success: "Success rate = Success outcomes ÷ (Success + Standard outcomes) × 100. NA outcomes (e.g. wrong party) are excluded entirely.",
  compliance: "Share of conversations where at least one RBI fair-practice criterion was answered No.",
};

export function KpiCard({ label, value, delta, deltaSuffix, invertDelta, spark, icon, hint, info, className }: {
  label: string; value: React.ReactNode; delta?: number | null; deltaSuffix?: string; invertDelta?: boolean;
  spark?: (number | null)[]; icon?: React.ReactNode; hint?: string; info?: string; className?: string;
}) {
  const s = (spark ?? []).filter((v): v is number => v != null);
  return (
    <div className={cn("flex flex-col justify-between gap-4 rounded-2xl border bg-card p-5", className)}>
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-2 font-medium">{icon}{label}{info && <InfoHint>{info}</InfoHint>}</span>
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
