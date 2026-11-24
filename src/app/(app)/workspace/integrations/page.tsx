"use client";

import { Copy, KeyRound, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DemoBadge, PageHeader, Panel, Pill } from "@/components/app/bits";

const ENDPOINTS = [
  ["GET", "/api/v1/workspace", "Org, categories with rubrics, teams, agents, tags"],
  ["GET", "/api/v1/calls", "List calls with filters, sorting and pagination"],
  ["POST", "/api/v1/calls", "Upload a recording (multipart) or { sampleId | audioUrl } → 202"],
  ["GET", "/api/v1/calls/:id", "Transcript, scored sections, extractions, metrics"],
  ["PATCH", "/api/v1/calls/:id/review", "Manager overrides + note; recomputes the score"],
  ["GET", "/api/v1/analytics", "KPIs, trends, outcomes, criteria, leaderboard"],
];
const DELIVERIES = [
  { event: "call.analysis_complete", code: 200, at: "2 min ago" },
  { event: "call.analysis_complete", code: 200, at: "9 min ago" },
  { event: "call.ingestion_failed", code: 200, at: "1 h ago" },
  { event: "call.analysis_complete", code: 502, at: "3 h ago" },
];

export default function IntegrationsPage() {
  const copy = (s: string) => navigator.clipboard.writeText(s).then(() => toast.success("Copied"));
  const curl = `curl -H "x-api-key: <DEMO_API_KEY from .env>" "${typeof window === "undefined" ? "" : window.location.origin}/api/v1/calls?pageSize=5"`;
  return (
    <>
      <PageHeader title="Integrations" description="Connect your dialer, CRM or BI tools to the call analytics API." actions={<DemoBadge label="Webhooks are a mockup" />} />
      <div className="space-y-5">
        <Panel title="REST API" icon={<KeyRound className="size-4" />} description="These endpoints are live in this build. Authenticate with the x-api-key header.">
          <ul className="divide-y text-sm">
            {ENDPOINTS.map(([m, p, d]) => <li key={m + p} className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-0.5 py-2.5 md:grid-cols-[4.5rem_18rem_1fr]"><Pill tone={m === "GET" ? "info" : m === "POST" ? "success" : "warning"} className="w-fit">{m}</Pill><code>{p}</code><span className="col-span-2 text-muted-foreground md:col-span-1">{d}</span></li>)}
          </ul>
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/60 p-3">
            <code className="flex-1 overflow-x-auto text-xs whitespace-pre">{curl}</code>
            <Button variant="ghost" size="icon" className="size-7" aria-label="Copy curl" onClick={() => copy(curl)}><Copy className="size-3.5" /></Button>
          </div>
        </Panel>
        <Panel title="Webhooks" icon={<Webhook className="size-4" />} description="POST to your endpoint when analysis completes or fails. Signed with HMAC-SHA256 (X-Signature: v1=…).">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
            <code>https://crm.kaverifinance.in/hooks/call-analytics</code>
            <span className="flex gap-1.5"><Pill tone="success">Active</Pill><Pill>call.analysis_complete</Pill><Pill>call.ingestion_failed</Pill></span>
          </div>
          <p className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent deliveries</p>
          <ul className="divide-y text-sm">{DELIVERIES.map((d, i) => <li key={i} className="flex justify-between py-2"><code className="text-xs">{d.event}</code><span className="flex items-center gap-3 text-muted-foreground"><Pill tone={d.code < 300 ? "success" : "danger"}>{d.code}</Pill>{d.at}</span></li>)}</ul>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => toast.success("Test event delivered (demo)")}>Send test event</Button>
        </Panel>
      </div>
    </>
  );
}
