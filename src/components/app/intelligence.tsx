"use client";

import { ChevronRight, Database, HelpCircle, Tags } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { fmtInr, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Analytics } from "@/server/services/analytics";
import { EmptyState, InfoHint, Panel } from "./bits";

type Intel = Analytics["intelligence"];

/** Hierarchical tag tree: each node counts conversations carrying it or any tag beneath it. Click a node to open those calls. */
function TagTree({ nodes, href }: { nodes: Intel["tags"]; href: (q: Record<string, string>) => string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const children = (parent: string | null) => nodes.filter((n) => n.parent === parent).sort((a, b) => b.calls - a.calls);
  const max = Math.max(1, ...nodes.map((n) => n.calls));
  const render = (parent: string | null) =>
    children(parent).map((n) => {
      const kids = children(n.slug);
      const isOpen = open[n.slug] ?? n.depth === 0;
      return (
        <li key={n.slug}>
          <div className="flex items-center gap-2 py-1.5" style={{ paddingLeft: n.depth * 18 }}>
            <button type="button" aria-label={isOpen ? "Collapse" : "Expand"} disabled={!kids.length} onClick={() => setOpen((o) => ({ ...o, [n.slug]: !isOpen }))} className={cn("flex size-5 items-center justify-center rounded text-muted-foreground", !kids.length && "invisible")}>
              <ChevronRight className={cn("size-3.5 transition", isOpen && "rotate-90")} />
            </button>
            <Link href={href({ tag: n.slug })} className={cn("min-w-0 flex-1 truncate text-sm hover:underline", n.depth === 0 && "font-medium")}>{n.displayName}</Link>
            <div className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-muted sm:block"><div className="h-full rounded-full bg-chart-1" style={{ width: `${(n.calls / max) * 100}%` }} /></div>
            <span className="w-24 text-right text-xs tabular text-muted-foreground"><span className="font-medium text-foreground">{n.calls}</span> · {n.pct}%</span>
            <span className="hidden w-24 text-right text-xs tabular text-muted-foreground md:block" title="Success rate of these conversations">{fmtPct(n.successRate)} success</span>
          </div>
          {isOpen && kids.length > 0 && <ul>{render(n.slug)}</ul>}
        </li>
      );
    });
  if (!nodes.length) return <EmptyState title="No tags in this period" />;
  return <ul>{render(null)}</ul>;
}

function ExtractionCard({ f, href }: { f: Intel["extractions"][number]; href: (q: Record<string, string>) => string }) {
  const max = Math.max(1, ...f.values.map((v) => v.calls));
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{f.displayName}</p>
          <p className="text-xs text-muted-foreground">{f.fieldType === "enum" ? "Choice" : f.fieldType === "boolean" ? "Yes / No" : f.fieldType === "number" ? "Number" : "Free text"} · captured on {f.captureRate}% of {f.calls} conversations</p>
        </div>
      </div>
      {f.stats ? (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {(f.fieldName.includes("amount") ? [["Total", fmtInr(f.stats.sum)], ["Average", fmtInr(f.stats.avg)], ["Median", fmtInr(f.stats.median)], ["Largest", fmtInr(f.stats.max)]] : [["Total", f.stats.sum], ["Average", f.stats.avg], ["Median", f.stats.median], ["Max", f.stats.max]]).map(([k, v]) => (
            <div key={k} className="rounded-xl border bg-background/40 px-3 py-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-semibold tabular">{String(v)}</dd></div>
          ))}
        </dl>
      ) : f.values.length ? (
        <ul className="space-y-2">
          {f.values.map((v) => (
            <li key={v.value}>
              <Link href={href({ ext: `${f.fieldName}:${v.value}` })} className="group block">
                <div className="mb-1 flex justify-between gap-2 text-sm">
                  <span className="truncate capitalize group-hover:underline">{f.fieldType === "boolean" ? (v.value === "true" ? "Yes" : "No") : v.value.replace(/_/g, " ")}</span>
                  <span className="shrink-0 text-xs tabular text-muted-foreground"><span className="font-medium text-foreground">{v.calls}</span> · {v.pct}% · {fmtPct(v.successRate)} success</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-chart-2" style={{ width: `${(v.calls / max) * 100}%` }} /></div>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">Not captured in this period.</p>}
    </div>
  );
}

export function CallIntelligence({ intel, href }: { intel: Intel; href: (q: Record<string, string>) => string }) {
  return (
    <div className="space-y-5">
      <div className="grid items-start gap-5 xl:grid-cols-5">
        <Panel className="xl:col-span-3" icon={<Tags className="size-4 text-muted-foreground" />} title="Tags" description="Applied automatically from extracted data and rubric answers. A parent counts every conversation tagged anywhere beneath it.">
          <TagTree nodes={intel.tags} href={href} />
        </Panel>
        <Panel className="xl:col-span-2" icon={<HelpCircle className="size-4 text-muted-foreground" />} title={<span className="flex items-center gap-2">Why conversations weren’t successful <InfoHint>Tags on Standard-outcome conversations — eligible conversations that didn’t reach the objective. NA-outcome conversations (e.g. wrong party) are excluded, as they are from success rate.</InfoHint></span>} description={`${intel.standardCalls} Standard-outcome conversations in this period`}>
          {intel.unsuccessfulReasons.length ? (
            <ol className="space-y-3">
              {intel.unsuccessfulReasons.map((r, i) => (
                <li key={r.slug}>
                  <Link href={href({ tag: r.slug, status: "done" })} className="group flex items-baseline gap-3">
                    <span className="w-4 text-xs text-muted-foreground tabular">{i + 1}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium group-hover:underline">{r.displayName}</span>{r.path && <span className="text-xs text-muted-foreground">{r.path}</span>}</span>
                    <span className="text-sm tabular"><span className="font-medium">{r.pct}%</span> <span className="text-xs text-muted-foreground">· {r.calls}</span></span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted-foreground">No tagged reasons in this period.</p>}
        </Panel>
      </div>
      <div>
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><Database className="size-4 text-muted-foreground" /> Extracted data</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {intel.extractions.map((f) => <ExtractionCard key={f.fieldName} f={f} href={href} />)}
        </div>
      </div>
    </div>
  );
}
