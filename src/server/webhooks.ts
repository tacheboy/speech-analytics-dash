import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { after } from "next/server";
import { db, schema } from "@/server/db/client";
import { analysisCompleteData, loadCall } from "@/server/external/present";
import { originOf } from "@/server/external/http";

/**
 * Outgoing webhook events (call.analysis_complete | call.analysis_failed | call.ingestion_failed).
 * Called whenever a call reaches a terminal state. Deliveries are HMAC-signed and logged in webhook_deliveries.
 */
export type CallEvent = "call.analysis_complete" | "call.analysis_failed" | "call.ingestion_failed";
export const CALL_EVENTS: CallEvent[] = ["call.analysis_complete", "call.analysis_failed", "call.ingestion_failed"];

const { webhooks, webhookDeliveries, calls } = schema;
type Webhook = typeof webhooks.$inferSelect;
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE = 2048;

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString("hex")}`;
export const signPayload = (secret: string, timestamp: number | string, rawBody: string) =>
  `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;

/** Run post-response when inside a request (`after`), otherwise (scripts, tests) inline. */
async function schedule(work: () => Promise<unknown>) {
  try {
    after(work);
  } catch {
    await work();
  }
}

/** POSTs one envelope and records the attempt. Never throws. */
export async function deliver(hook: Webhook, event: CallEvent, data: Record<string, unknown>) {
  const id = randomUUID();
  const payload = { id, type: event, createdAt: new Date().toISOString(), data };
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const started = Date.now();
  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Insights-Webhooks/1.0",
        "X-Insights-Event": event,
        "X-Insights-Timestamp": String(ts),
        "X-Insights-Signature": signPayload(hook.secret, ts, body),
        "X-Insights-Delivery-Id": id,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
    });
    statusCode = res.status;
    responseBody = (await res.text().catch(() => "")).slice(0, MAX_RESPONSE);
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    error = err.name === "TimeoutError" ? `Timed out after ${TIMEOUT_MS / 1000}s` : err.cause?.code ?? err.cause?.message ?? err.message;
  }
  const row = { id, webhookId: hook.id, event, payload, statusCode, responseBody, error, durationMs: Date.now() - started };
  try {
    await db.insert(webhookDeliveries).values(row);
  } catch (e) {
    console.error("webhook delivery log failed", e);
  }
  return { ...row, createdAt: new Date(started) };
}

/** Origin of the current request (so audio URLs point back at this server), else PUBLIC_BASE_URL / localhost. */
async function currentOrigin() {
  if (process.env.PUBLIC_BASE_URL) return originOf();
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https")}://${host}`;
  } catch {
    // outside a request scope
  }
  return originOf();
}

async function eventData(orgId: string, event: CallEvent, callId: string, origin: string): Promise<Record<string, unknown> | null> {
  if (event === "call.analysis_complete") {
    const l = await loadCall(orgId, callId);
    return l ? analysisCompleteData(l, origin) : null;
  }
  const [c] = await db.select().from(calls).where(and(eq(calls.id, callId), eq(calls.orgId, orgId)));
  if (!c) return null;
  const failedAt = (c.completedAt ?? new Date()).toISOString();
  if (event === "call.analysis_failed") return { callId, organizationId: orgId, message: c.failureReason ?? "Call analysis failed", failedAt };
  const recordingUrl = c.audioUrl && !/^https?:/i.test(c.audioUrl) ? `${origin}${c.audioUrl}` : c.audioUrl ?? "";
  return { callId, organizationId: orgId, recordingUrl, errorMessage: c.failureReason ?? "Unable to ingest recording", failedAt };
}

/** Fans an event out to every active webhook of the org subscribed to it. Failures never reach the caller. */
export async function emitCallEvent(orgId: string, event: CallEvent, callId: string): Promise<void> {
  try {
    const hooks = (await db.select().from(webhooks).where(and(eq(webhooks.orgId, orgId), eq(webhooks.active, true)))).filter((h) => h.events.includes(event));
    if (!hooks.length) return;
    const origin = await currentOrigin();
    await schedule(async () => {
      try {
        const data = await eventData(orgId, event, callId, origin);
        if (!data) return;
        await Promise.all(hooks.map((h) => deliver(h, event, data)));
      } catch (e) {
        console.error("webhook delivery failed", e);
      }
    });
  } catch (e) {
    console.error("webhook emit failed", e);
  }
}

/** Sends a sample `call.analysis_complete` (the org's latest analysed call, if any) and returns the logged attempt. */
export async function sendTestEvent(webhookId: string) {
  const origin = await currentOrigin();
  const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, webhookId));
  if (!hook) return null;
  const [latest] = await db.select({ id: calls.id }).from(calls).where(and(eq(calls.orgId, hook.orgId), eq(calls.status, "done"))).orderBy(desc(calls.completedAt)).limit(1);
  const l = latest ? await loadCall(hook.orgId, latest.id) : null;
  const data = l
    ? { ...analysisCompleteData(l, origin), test: true }
    : { callId: "call_test", organizationId: hook.orgId, test: true };
  return deliver(hook, "call.analysis_complete", data);
}
