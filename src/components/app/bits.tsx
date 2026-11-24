"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { scoreTone } from "@/lib/domain";
import { initials } from "@/lib/format";

const TONE = {
  success: "bg-success/12 text-success border-success/30",
  warning: "bg-warning/12 text-warning border-warning/30",
  danger: "bg-danger/12 text-danger border-danger/30",
  info: "bg-info/12 text-info border-info/30",
  primary: "bg-primary/12 text-primary border-primary/30",
  muted: "bg-muted text-muted-foreground border-border",
} as const;
export type Tone = keyof typeof TONE;

export function Pill({ tone = "muted", className, children, title }: { tone?: Tone; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-6 max-w-full items-center gap-1 truncate rounded-full border px-2.5 text-xs font-medium whitespace-nowrap", TONE[tone], className)}>
      {children}
    </span>
  );
}

export function ScoreBadge({ score, className }: { score: number | null | undefined; className?: string }) {
  return (
    <Pill tone={scoreTone(score)} className={cn("tabular justify-center min-w-12", className)}>
      {score == null ? "—" : `${score}%`}
    </Pill>
  );
}

export function OutcomeBadge({ label, isSuccess, isNotApplicable, className }: { label: string | null; isSuccess: boolean | null; isNotApplicable: boolean | null; className?: string }) {
  if (!label) return <span className="text-muted-foreground">—</span>;
  const tone: Tone = isNotApplicable ? "muted" : isSuccess === true ? "success" : isSuccess === false ? "danger" : "info";
  return <Pill tone={tone} className={cn("max-w-44", className)} title={label}>{label}</Pill>;
}

export function StatusBadge({ status, title }: { status: "processing" | "done" | "failed"; title?: string }) {
  if (status === "processing")
    return (
      <Pill tone="primary" title={title}>
        <span className="size-1.5 animate-pulse rounded-full bg-primary" /> Processing
      </Pill>
    );
  if (status === "failed") return <Pill tone="danger" title={title}>Failed</Pill>;
  return <Pill tone="success">Analyzed</Pill>;
}

export function AgentAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", size === "sm" ? "size-7 text-[11px]" : size === "lg" ? "size-12 text-base" : "size-9 text-xs")}
      style={{ background: `oklch(0.35 0.06 ${hue} / 0.55)`, color: `oklch(0.9 0.06 ${hue})` }}
    >
      {initials(name)}
    </span>
  );
}

/** Tiny SVG trend line; colour carries direction (up = success, down = danger). */
export function Sparkline({ values, width = 96, height = 28, tone }: { values: number[]; width?: number; height?: number; tone?: "success" | "danger" | "muted" | "primary" }) {
  if (values.length < 2) return <span className="text-xs italic text-muted-foreground">No trend</span>;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 3 - ((v - min) / span) * (height - 6)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const t = tone ?? (values.at(-1)! >= values[0] ? "success" : "danger");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("overflow-visible", { success: "text-success", danger: "text-danger", muted: "text-muted-foreground", primary: "text-primary" }[t])} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Delta({ value, suffix = " pts", invert = false }: { value: number | null | undefined; suffix?: string; invert?: boolean }) {
  if (value == null) return <span className="text-xs text-muted-foreground">no prior data</span>;
  const good = invert ? value < 0 : value > 0;
  const tone = value === 0 ? "text-muted-foreground" : good ? "text-success" : "text-danger";
  return <span className={cn("text-xs font-medium tabular", tone)}>{value > 0 ? "+" : ""}{value}{suffix}</span>;
}

export function PageHeader({ title, description, actions, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, icon, action }: { title: string; description?: string; icon?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 text-muted-foreground">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function DemoBadge({ label = "Demo · not persisted" }: { label?: string }) {
  return (
    <Pill tone="warning" className="h-6">
      <Sparkles className="size-3" /> {label}
    </Pill>
  );
}

export function Panel({ title, description, icon, actions, className, children, bodyClassName }: { title?: React.ReactNode; description?: React.ReactNode; icon?: React.ReactNode; actions?: React.ReactNode; className?: string; bodyClassName?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl border bg-card text-card-foreground", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-semibold">{icon}{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}
