"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { PageHeader } from "@/components/app/bits";
import { ConversationsTable, type TableFilters } from "@/components/app/conversations-table";
import { cn } from "@/lib/utils";

const QUEUES: Record<string, { label: string; hint: string; fixed: TableFilters }> = {
  lowest: { label: "Lowest-scoring, not audited", hint: "Coach where it matters most: the weakest conversations nobody has looked at yet.", fixed: { audited: "false", status: "completed", sort: "score", order: "asc" } },
  review: { label: "Needs review", hint: "The AI wasn't sure: an answer has low confidence or its evidence quote couldn't be verified against the transcript.", fixed: { needsReview: "true", sort: "date", order: "desc" } },
  risk: { label: "Risk flags", hint: "Conversations where a fair-practice criterion failed (threats, abuse, third-party disclosure).", fixed: { riskFlag: "true", status: "completed" } },
  audited: { label: "Audited", hint: "Conversations a manager has already audited or overridden.", fixed: { audited: "true" } },
};
const KEYS = ["lowest", "review", "risk", "audited"] as const;

export default function AuditsPage() {
  const [q, setQ] = useQueryState("queue", parseAsStringLiteral(KEYS).withDefault("lowest"));
  return (
    <>
      <PageHeader title="Audits" description={QUEUES[q].hint} />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b" role="tablist">
        {KEYS.map((k) => (
          <button key={k} role="tab" aria-selected={q === k} onClick={() => setQ(k === "lowest" ? null : k)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", q === k ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{QUEUES[k].label}</button>
        ))}
      </div>
      <ConversationsTable key={q} categoryId="all" fixed={QUEUES[q].fixed} />
    </>
  );
}
