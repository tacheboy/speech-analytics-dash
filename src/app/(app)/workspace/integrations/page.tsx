"use client";

import { Check, ChevronRight, Copy, KeyRound, Plus, Send, Trash2, Webhook, Code2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader, Panel, Pill } from "@/components/app/bits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtAgo } from "@/lib/format";
import {
  useApiKeys, useCreateApiKey, useCreateWebhook, useDeleteWebhook, useRevokeApiKey, useTestWebhook, useUpdateWebhook, useWebhooks,
  type CreatedKey, type CreatedWebhook, type Delivery, type WebhookEndpoint,
} from "@/lib/integrations-client";
import { cn } from "@/lib/utils";

const EVENTS = [
  ["conversation.completed", "Analysis finished: the full conversation object"],
  ["conversation.failed", "Failed or skipped, with a typed failure code"],
  ["conversation.updated", "Audited, re-analysed or erased"],
] as const;
const LEGACY_EVENTS = [
  ["call.analysis_complete", "Voxxi-compatible: analysis finished"],
  ["call.analysis_failed", "Voxxi-compatible: analysis failed"],
  ["call.ingestion_failed", "Voxxi-compatible: recording could not be ingested"],
] as const;

const ENDPOINTS = [
  ["POST", "/conversations", "Submit a recording { audioUrl, categoryId, person, externalId } → 202"],
  ["GET", "/conversations/{id}", "The full object: scorecard, outcome, extractions, transcript (ext:<id> works too)"],
  ["GET", "/conversations", "List, filter, and sync with updatedSince"],
  ["POST", "/uploads", "Presigned PUT for your own files"],
  ["PATCH", "/conversations/{id}/scorecard", "Human audit: overrides, outcome, manual tags"],
  ["POST", "/conversations/{id}/analyze", "Re-score, or dry-run a draft rubric"],
  ["DELETE", "/conversations/{id}", "Erasure (a tombstone stays for sync)"],
  ["GET", "/analytics", "metrics × groupBy aggregates"],
  ["GET · PUT", "/categories/{id}", "Rubrics as config; each PUT publishes a version"],
  ["GET · POST", "/people · /cohorts · /webhooks", "Supporting resources; PUT /tags/{slug}"],
] as const;

const METHOD_TONE: Record<string, "info" | "success" | "warning" | "danger" | "primary"> = { GET: "info", POST: "success", PATCH: "warning", DELETE: "danger" };

const noop = () => () => {};
/** window.location.origin on the client, "" during SSR. */
const useOrigin = () => useSyncExternalStore(noop, () => window.location.origin, () => "");

const copy = (s: string, what = "Copied") => navigator.clipboard.writeText(s).then(() => toast.success(what));

function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/60 p-2">
      <code className="min-w-0 flex-1 overflow-x-auto text-xs whitespace-nowrap">{value}</code>
      <Button variant="ghost" size="icon-sm" aria-label={`Copy ${label}`} onClick={() => copy(value, `${label} copied`)}><Copy /></Button>
    </div>
  );
}

/** Two-step destructive button: first click arms it, second confirms. */
function ConfirmButton({ label, confirm, onConfirm, disabled }: { label: React.ReactNode; confirm: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button variant={armed ? "destructive" : "ghost"} size="sm" disabled={disabled} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? confirm : label}
    </Button>
  );
}

/* ---------------- API keys ---------------- */

function CreateKeyDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("write");
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const create = useCreateApiKey();
  const reset = (o: boolean) => {
    setOpen(o);
    if (!o) { setName(""); setScope("write"); setCreated(null); }
  };
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}><Plus className="size-4" /> Create key</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{created ? "Copy your API key" : "Create an API key"}</DialogTitle>
          <DialogDescription>{created ? "This is the only time the full key is shown. Store it somewhere safe." : "Keys authenticate the platform API (and the Voxxi-compatible API) for this organization."}</DialogDescription>
        </DialogHeader>
        {created ? (
          <CopyField value={created.key} label="API key" />
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" placeholder="e.g. Dialer integration" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Access</legend>
              {([["write", "Read and write", "Dialers and CRMs that submit conversations"], ["read", "Read only", "BI and warehouse syncs"]] as const).map(([v, l, d]) => (
                <label key={v} className="flex items-start gap-2.5 text-sm">
                  <input type="radio" name="scope" className="mt-1 accent-primary" checked={scope === v} onChange={() => setScope(v)} />
                  <span>{l}<span className="block text-xs text-muted-foreground">{d}</span></span>
                </label>
              ))}
            </fieldset>
          </div>
        )}
        <DialogFooter>
          {created ? (
            <Button onClick={() => reset(false)}>Done</Button>
          ) : (
            <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate({ name: name.trim(), scope }, { onSuccess: setCreated, onError: (e) => toast.error(e.message) })}>
              Create key
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApiKeysPanel() {
  const { data: keys, isLoading } = useApiKeys();
  const revoke = useRevokeApiKey();
  return (
    <Panel title="API keys" icon={<KeyRound className="size-4" />} description="Send as Authorization: Bearer <key> or x-api-key." actions={<CreateKeyDialog />} bodyClassName="p-0">
      {isLoading ? (
        <p className="p-5 text-sm text-muted-foreground">Loading…</p>
      ) : !keys?.length ? (
        <EmptyState icon={<KeyRound className="size-6" />} title="No API keys yet" description="Create a key to call the external API from your dialer or CRM." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="pr-5 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id} className={cn(k.revokedAt && "opacity-60")}>
                  <TableCell className="pl-5 font-medium">{k.name}{k.createdByName && <span className="block text-xs font-normal text-muted-foreground">by {k.createdByName}</span>}</TableCell>
                  <TableCell><code className="text-xs">{k.prefix}…</code></TableCell>
                  <TableCell><Pill tone={k.scope === "read" ? "info" : "primary"}>{k.scope === "read" ? "Read only" : "Read & write"}</Pill></TableCell>
                  <TableCell className="text-muted-foreground">{fmtAgo(k.createdAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{k.lastUsedAt ? fmtAgo(k.lastUsedAt) : "Never"}</TableCell>
                  <TableCell className="pr-5 text-right">
                    {k.revokedAt ? <Pill>Revoked</Pill> : (
                      <ConfirmButton label="Revoke" confirm="Confirm revoke" disabled={revoke.isPending}
                        onConfirm={() => revoke.mutate(k.id, { onSuccess: () => toast.success(`Revoked “${k.name}”`), onError: (e) => toast.error(e.message) })} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

/* ---------------- webhooks ---------------- */

function CreateWebhookDialog() {
  const origin = useOrigin();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(EVENTS.map(([e]) => e));
  const [legacy, setLegacy] = useState(false);
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const create = useCreateWebhook();
  const reset = (o: boolean) => {
    setOpen(o);
    if (o) setUrl(`${window.location.origin}/api/dev/webhook-sink`);
    else { setCreated(null); setEvents(EVENTS.map(([e]) => e)); setLegacy(false); }
  };
  const validUrl = /^https?:\/\/\S+$/.test(url.trim());
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}><Plus className="size-4" /> Add endpoint</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{created ? "Copy your signing secret" : "Add a webhook endpoint"}</DialogTitle>
          <DialogDescription>
            {created ? "Verify the webhook-signature header with this secret (any Standard Webhooks library works). It is only shown once." : "We POST a signed JSON event to this URL when a conversation finishes, fails or changes. Failed deliveries are retried with backoff."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <CopyField value={created.secret} label="Signing secret" />
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="wh-url">Endpoint URL</Label>
              <Input id="wh-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/insights" />
              {origin && url === `${origin}/api/dev/webhook-sink` && <p className="text-xs text-muted-foreground">Suggested: a demo receiver in this app that always answers 200.</p>}
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Events</legend>
              {[...EVENTS, ...(legacy ? LEGACY_EVENTS : [])].map(([e, d]) => (
                <label key={e} className="flex items-start gap-2.5 text-sm">
                  <Checkbox className="mt-0.5" checked={events.includes(e)} onCheckedChange={(on) => setEvents((xs) => (on ? [...xs, e] : xs.filter((x) => x !== e)))} />
                  <span><code className="text-xs">{e}</code><span className="block text-xs text-muted-foreground">{d}</span></span>
                </label>
              ))}
              {!legacy && <button type="button" className="w-fit text-xs text-muted-foreground underline" onClick={() => setLegacy(true)}>Show Voxxi-compatible events</button>}
            </fieldset>
          </div>
        )}
        <DialogFooter>
          {created ? (
            <Button onClick={() => reset(false)}>Done</Button>
          ) : (
            <Button disabled={!validUrl || !events.length || create.isPending}
              onClick={() => create.mutate({ url: url.trim(), events }, { onSuccess: setCreated, onError: (e) => toast.error(e.message) })}>
              Add endpoint
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeliveryItem({ d }: { d: Delivery }) {
  const [open, setOpen] = useState(false);
  const ok = d.statusCode != null && d.statusCode < 300;
  return (
    <li>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2 py-2 text-left text-sm hover:bg-muted/40">
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <code className="min-w-0 flex-1 truncate text-xs">{d.event}{(d.payload as { data?: { test?: boolean } }).data?.test ? " (test)" : ""}</code>
        <Pill tone={ok ? "success" : "danger"} title={d.error ?? undefined}>{d.statusCode ?? "Error"}</Pill>
        <span className="hidden w-12 text-right text-xs text-muted-foreground tabular sm:inline">{d.durationMs != null ? `${d.durationMs} ms` : ""}</span>
        <span className="w-28 text-right text-xs text-muted-foreground">{fmtAgo(d.createdAt)}</span>
      </button>
      {open && (
        <div className="mb-3 grid gap-3 pl-5.5 text-xs lg:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1 font-medium text-muted-foreground">Payload</p>
            <pre className="max-h-72 overflow-auto rounded-lg bg-muted/60 p-3">{JSON.stringify(d.payload, null, 2)}</pre>
          </div>
          <div className="min-w-0">
            <p className="mb-1 font-medium text-muted-foreground">Response{d.error ? ` · ${d.error}` : ""}</p>
            <pre className="max-h-72 overflow-auto rounded-lg bg-muted/60 p-3 whitespace-pre-wrap">{d.responseBody || "(empty)"}</pre>
          </div>
        </div>
      )}
    </li>
  );
}

function WebhookCard({ h }: { h: WebhookEndpoint }) {
  const update = useUpdateWebhook();
  const del = useDeleteWebhook();
  const test = useTestWebhook();
  return (
    <div className="rounded-xl border">
      {(h.disabledAt || h.failingSince) && (
        <p className={cn("border-b px-3 py-2 text-xs", h.disabledAt ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning")}>
          {h.disabledAt ? `Disabled ${fmtAgo(h.disabledAt)} after failing for 3 days. Fix the endpoint, then switch it back on.` : `Deliveries failing since ${fmtAgo(h.failingSince!)}. It will be disabled after 3 days.`}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <code className="block truncate text-sm">{h.url}</code>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{h.events.map((e: string) => <Pill key={e}>{e}</Pill>)}</div>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={h.active && !h.disabledAt} disabled={update.isPending}
            onCheckedChange={(active) => update.mutate({ id: h.id, active }, { onError: (e) => toast.error(e.message) })} />
          {h.disabledAt ? "Disabled" : h.active ? "Active" : "Paused"}
        </label>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="gap-1.5" disabled={test.isPending}
            onClick={() => test.mutate(h.id, {
              onSuccess: (d) => (d.statusCode && d.statusCode < 300 ? toast.success(`Test event delivered (${d.statusCode})`) : toast.error(`Test event failed: ${d.error ?? d.statusCode}`)),
              onError: (e) => toast.error(e.message),
            })}>
            <Send className="size-3.5" /> Send test
          </Button>
          <ConfirmButton label={<Trash2 className="size-4" aria-label="Delete endpoint" />} confirm="Delete?" disabled={del.isPending}
            onConfirm={() => del.mutate(h.id, { onSuccess: () => toast.success("Endpoint deleted"), onError: (e) => toast.error(e.message) })} />
        </div>
      </div>
      <div className="px-3 pb-1">
        <p className="pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Recent deliveries · secret {h.secretHint}</p>
        {h.deliveries.length ? (
          <ul className="divide-y">{h.deliveries.map((d) => <DeliveryItem key={d.id} d={d} />)}</ul>
        ) : (
          <p className="pb-3 text-sm text-muted-foreground">No deliveries yet. Send a test event or upload a conversation.</p>
        )}
      </div>
    </div>
  );
}

function WebhooksPanel() {
  const { data: hooks, isLoading } = useWebhooks();
  return (
    <Panel title="Webhooks" icon={<Webhook className="size-4" />} actions={<CreateWebhookDialog />}
      description={<>Signed per the <a className="underline" href="https://www.standardwebhooks.com" target="_blank" rel="noreferrer">Standard Webhooks</a> spec: <code>webhook-id</code>, <code>webhook-timestamp</code>, <code>webhook-signature</code>. At-least-once; dedupe on the event id.</>}>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !hooks?.length ? (
        <EmptyState icon={<Webhook className="size-6" />} title="No webhook endpoints" description="Add an endpoint to be notified when a conversation's analysis completes or fails." />
      ) : (
        <div className="space-y-4">{hooks.map((h) => <WebhookCard key={h.id} h={h} />)}</div>
      )}
    </Panel>
  );
}

/* ---------------- reference ---------------- */

function ReferencePanel() {
  const origin = useOrigin();
  const base = `${origin || "http://localhost:3000"}/api/v1`;
  const [copied, setCopied] = useState(false);
  const curl = `export BASE_URL="${base}"
export API_KEY="<your API key>"

# 1. submit a recording (re-posting the same externalId is safe: you get the same conversation back)
curl -X POST "$BASE_URL/conversations" -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '{"externalId":"CALL-1001","audioUrl":"https://…/recording.mp3","categoryId":"early-bucket",
       "person":{"externalId":"AGT-204","name":"Rahul Sharma"},"metadata":{"loanId":"LN-2231"}}'
# 2. get the result (or receive conversation.completed on your webhook)
curl "$BASE_URL/conversations/ext:CALL-1001" -H "Authorization: Bearer $API_KEY"
# 3. nightly sync into your warehouse
curl "$BASE_URL/conversations?updatedSince=2026-11-24T00:00:00Z&limit=200" -H "Authorization: Bearer $API_KEY"`;
  return (
    <Panel title="Platform API" icon={<Code2 className="size-4" />}
      description={<>Base URL <code>{base}</code> · errors are <code>{'{ "error": { type, code, message, requestId } }'}</code> · <a className="underline" href="/docs/api">full reference</a> · <a className="underline" href="/api/v1/openapi.json">OpenAPI</a></>}>
      <ul className="divide-y text-sm">
        {ENDPOINTS.map(([m, p, d]) => (
          <li key={m + p} className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-0.5 py-2 md:grid-cols-[5.5rem_19rem_1fr]">
            <Pill tone={METHOD_TONE[m] ?? "primary"} className="w-fit">{m}</Pill>
            <code className="text-xs leading-6">{p}</code>
            <span className="col-span-2 text-muted-foreground md:col-span-1">{d}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Quickstart</p>
      <div className="relative">
        <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 pr-10 text-xs">{curl}</pre>
        <Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" aria-label="Copy quickstart"
          onClick={() => copy(curl, "Quickstart copied").then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Migrating from Voxxi? A compatible API (same paths and payloads as docs.voxxi.ai) is served at <code>{origin || "http://localhost:3000"}/api/external/v1</code> with the same keys. It is frozen: new features land in the platform API only.
      </p>
    </Panel>
  );
}

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader title="Integrations" description="API keys, webhooks and the platform API for your dialer, CRM or BI tools." />
      <div className="space-y-5">
        <ApiKeysPanel />
        <WebhooksPanel />
        <ReferencePanel />
      </div>
    </>
  );
}
