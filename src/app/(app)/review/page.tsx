"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { PageHeader } from "@/components/app/bits";
import { CallsTable } from "@/components/app/calls-table";
import { cn } from "@/lib/utils";

const QUEUES = {
  lowest: { label: "Lowest-scoring, unreviewed", hint: "Coach where it matters most: the weakest calls nobody has looked at yet.", fixed: { reviewed: "false", status: "done", sort: "score", order: "asc" } },
  compliance: { label: "Compliance flags", hint: "Calls where an RBI fair-practice criterion failed (threats, abuse, third-party disclosure).", fixed: { compliance: "true", status: "done" } },
  reviewed: { label: "Reviewed", hint: "Calls a manager has already reviewed or overridden.", fixed: { reviewed: "true" } },
} as const;

export default function ReviewPage() {
  const [q, setQ] = useQueryState("queue", parseAsStringLiteral(["lowest", "compliance", "reviewed"] as const).withDefault("lowest"));
  return (
    <>
      <PageHeader title="Review queue" description={QUEUES[q].hint} />
      <div className="mb-5 flex gap-1 border-b" role="tablist">
        {(Object.keys(QUEUES) as (keyof typeof QUEUES)[]).map((k) => (
          <button key={k} role="tab" aria-selected={q === k} onClick={() => setQ(k === "lowest" ? null : k)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", q === k ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{QUEUES[k].label}</button>
        ))}
      </div>
      <CallsTable key={q} categoryId="all" fixed={{ ...QUEUES[q].fixed }} />
    </>
  );
}
