import { createHmac, randomBytes } from "node:crypto";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { EventType } from "@/lib/contract";
import { db, schema } from "@/server/db/client";
import { originOf } from "@/server/http";
import { newId } from "@/server/ids";
import { log } from "@/server/log";
import { presentConversations } from "@/server/presenters/conversation";

/**
 * Events: a transactional outbox (`events`) relayed to webhooks by the worker.
 *
 * - `emitEvent(tx, …)` is called inside the transaction that changes the conversation, so an event
 *   exists if and only if the change committed.
 * - `relayEvents()` (worker, every ~2 s) turns undispatched events into one delivery job per subscribed webhook.
 * - `deliverWebhook()` (a pg-boss job with exponential backoff, 8 attempts) POSTs and logs each attempt.
 *
 * Platform webhooks get `conversation.*` events signed per the Standard Webhooks spec.
 * Webhooks created through the frozen Voxxi-compatible adapter subscribe to `call.*` events and keep
 * that API's payloads and `X-Insights-*` headers.
 */
const { events, webhooks, webhookDeliveries, conversations } = schema;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Webhook = typeof webhooks.$inferSelect;

export const LEGACY_EVENTS = ["call.analysis_complete", "call.analysis_failed", "call.ingestion_failed"] as const;
export type LegacyEvent = (typeof LEGACY_EVENTS)[number];

export async function emitEvent(tx: Tx | typeof db, e: { orgId: string; type: EventType; conversationId: string }) {
  await tx.insert(events).values({ id: newId("evt"), orgId: e.orgId, type: e.type, conversationId: e.conversationId });
}

/* ---------------- signing ---------------- */

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString("base64")}`;

/** Standard Webhooks: base64(HMAC-SHA256(secret bytes, "{id}.{timestamp}.{body}")), header value "v1,<sig>". */
export function standardSignature(secret: string, id: string, timestamp: number, body: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

/** Legacy (Voxxi-compatible) signature: hex HMAC of "{timestamp}.{body}" with the secret as text. */
export const legacySignature = (secret: string, timestamp: number | string, rawBody: string) =>
  `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;

/* ---------------- relay ---------------- */

function legacyEventFor(type: string, conv: { status: string; failureStage: string | null }): LegacyEvent | null {
  if (type === "conversation.completed") return "call.analysis_complete";
  if (type === "conversation.failed") return conv.status === "skipped" || conv.failureStage === "ingesting" ? "call.ingestion_failed" : "call.analysis_failed";
  return null;
}

/** Fans undispatched events out to delivery jobs. Safe to run concurrently (SKIP LOCKED). Returns the count relayed. */
export async function relayEvents(enqueueDelivery: (d: { eventId: string; webhookId: string; event: string }) => Promise<void>) {
  return db.transaction(async (tx) => {
    const batch = await tx.execute<{ id: string; org_id: string; type: string; conversation_id: string | null }>(sql`
      select id, org_id, type, conversation_id from events where dispatched_at is null
      order by created_at limit 100 for update skip locked`);
    for (const e of batch) {
      const hooks = await tx.select().from(webhooks).where(and(eq(webhooks.orgId, e.org_id), eq(webhooks.active, true), isNull(webhooks.disabledAt)));
      const [conv] = e.conversation_id
        ? await tx.select({ status: conversations.status, failureStage: conversations.failureStage }).from(conversations).where(eq(conversations.id, e.conversation_id))
        : [];
      const legacy = conv ? legacyEventFor(e.type, conv) : null;
      for (const h of hooks) {
        if (h.events.includes(e.type)) await enqueueDelivery({ eventId: e.id, webhookId: h.id, event: e.type });
        else if (legacy && h.events.includes(legacy)) await enqueueDelivery({ eventId: e.id, webhookId: h.id, event: legacy });
      }
      await tx.update(events).set({ dispatchedAt: new Date() }).where(eq(events.id, e.id));
    }
    return batch.length;
  });
}

/* ---------------- delivery ---------------- */

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE = 2048;
export const MAX_ATTEMPTS = 8;

async function payloadFor(evt: typeof events.$inferSelect, event: string, origin: string): Promise<Record<string, unknown> | null> {
  if (!evt.conversationId) return null;
  if (event.startsWith("call.")) {
    const { legacyEventData } = await import("@/server/external/present");
    return legacyEventData(evt.orgId, event as LegacyEvent, evt.conversationId, origin);
  }
  const [conversation] = await presentConversations(evt.orgId, [evt.conversationId], { transcript: false, origin });
  return conversation ? { conversation } : null;
}

type Attempt = { statusCode: number | null; responseBody: string | null; error: string | null; durationMs: number };

/** POSTs one envelope and records the attempt. */
export async function postWebhook(hook: Webhook, event: string, deliveryId: string, data: Record<string, unknown>, attempt: number, eventId: string | null): Promise<Attempt & { id: string; payload: Record<string, unknown> }> {
  const legacy = event.startsWith("call.");
  const createdAt = new Date().toISOString();
  const payload = legacy ? { id: deliveryId, type: event, createdAt, data } : { id: eventId ?? deliveryId, type: event, createdAt, data };
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = legacy
    ? { "X-Insights-Event": event, "X-Insights-Timestamp": String(ts), "X-Insights-Signature": legacySignature(hook.secret, ts, body), "X-Insights-Delivery-Id": deliveryId }
    : { "webhook-id": String(payload.id), "webhook-timestamp": String(ts), "webhook-signature": standardSignature(hook.secret, String(payload.id), ts, body) };
  const started = Date.now();
  const res: Attempt = { statusCode: null, responseBody: null, error: null, durationMs: 0 };
  try {
    const r = await fetch(hook.url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Insights-Webhooks/2.0", ...headers },
      body, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual",
    });
    res.statusCode = r.status;
    res.responseBody = (await r.text().catch(() => "")).slice(0, MAX_RESPONSE);
    if (!r.ok) res.error = `HTTP ${r.status}`;
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    res.error = err.name === "TimeoutError" ? `Timed out after ${TIMEOUT_MS / 1000}s` : err.cause?.code ?? err.cause?.message ?? err.message;
  }
  res.durationMs = Date.now() - started;
  await db.insert(webhookDeliveries).values({ id: deliveryId, webhookId: hook.id, eventId, attempt, event, payload, ...res }).catch((e) => log.error("webhook delivery log failed", { err: e }));
  return { id: deliveryId, payload, ...res };
}

/**
 * One delivery attempt (pg-boss job). Throws on failure so the queue retries with backoff;
 * after the last attempt the webhook is marked failing (auto-disabled after 3 days of that).
 */
export async function deliverWebhook(job: { eventId: string; webhookId: string; event: string }, attempt: number) {
  const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, job.webhookId));
  const [evt] = await db.select().from(events).where(eq(events.id, job.eventId));
  if (!hook || !evt || !hook.active || hook.disabledAt) return;
  const data = await payloadFor(evt, job.event, originOf());
  if (!data) return;
  const res = await postWebhook(hook, job.event, newId("dlv"), data, attempt, evt.id);
  if (!res.error) {
    if (hook.failingSince) await db.update(webhooks).set({ failingSince: null }).where(eq(webhooks.id, hook.id));
    return;
  }
  if (attempt >= MAX_ATTEMPTS && !hook.failingSince) await db.update(webhooks).set({ failingSince: new Date() }).where(eq(webhooks.id, hook.id));
  throw new Error(`webhook ${hook.id} attempt ${attempt}: ${res.error}`);
}

/** Sweeper: endpoints failing for 3 days straight are disabled (the UI shows a banner). */
export async function disableFailingWebhooks() {
  const cutoff = new Date(Date.now() - 3 * 86400_000);
  const res = await db.update(webhooks).set({ disabledAt: new Date() }).where(and(isNotNull(webhooks.failingSince), lt(webhooks.failingSince, cutoff), isNull(webhooks.disabledAt))).returning({ id: webhooks.id });
  for (const r of res) log.warn("webhook disabled after failing for 3 days", { webhookId: r.id });
}
