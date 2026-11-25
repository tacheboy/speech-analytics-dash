"use client";

import Link from "next/link";
import { PageHeader, Panel, Pill } from "@/components/app/bits";
import { useDashboard, useWorkspace } from "@/lib/api-client";

/** The org's tag taxonomy (tag › subtag › detail), how each tag gets applied, and how often it fired in the last 30 days. */
export default function TagsPage() {
  const { data: ws } = useWorkspace();
  const { data: a } = useDashboard({ dimension: "org" });
  if (!ws) return null;
  const counts = new Map(a?.intelligence.tags.map((t) => [t.slug, t.conversations]));
  const ruleFor = (slug: string) => ws.categories.flatMap((c) => c.rubric.targetingRules.filter((r) => r.targetType === "tag" && r.targetId === slug).map((r) => `${c.name}: ${r.description}`));
  const sorted = [...ws.tags].sort((x, y) => x.slug.localeCompare(y.slug));
  return (
    <>
      <PageHeader title="Tags" description="Tags add detail beyond the outcome. Most are applied automatically from extracted data and rubric answers; a few are added by managers. Filter conversations by any level — a parent includes everything beneath it." />
      <Panel title="Taxonomy" description="Counts are conversations in the last 30 days." bodyClassName="p-0">
        <ul className="divide-y">
          {sorted.map((t) => {
            const depth = t.slug.split("/").length - 1;
            const rules = ruleFor(t.slug);
            const isLeafish = !sorted.some((x) => x.slug.startsWith(`${t.slug}/`));
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5" style={{ paddingLeft: 20 + depth * 22 }}>
                <span className={depth === 0 ? "font-semibold" : "text-sm"}>{t.displayName}</span>
                <code className="text-xs text-muted-foreground">{t.slug}</code>
                {t.assignable ? <Pill tone="primary" className="h-5 text-[11px]">Manual</Pill> : isLeafish && rules.length > 0 ? <Pill className="h-5 text-[11px]" title={rules.join("\n")}>Rule · {rules.length} categor{rules.length === 1 ? "y" : "ies"}</Pill> : null}
                <span className="ml-auto flex items-center gap-3 text-sm">
                  <span className="tabular text-muted-foreground">{counts.get(t.slug) ?? 0} conversations</span>
                  <Link href={`/conversations/all?tag=${encodeURIComponent(t.slug)}`} className="text-primary hover:underline">View</Link>
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}
