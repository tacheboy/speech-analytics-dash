import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { EVENT_TYPES, webhookBody } from "@/lib/contract";
import { ApiError, notFound, requireAdmin, requireStaff, type Actor } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { LEGACY_EVENTS, newWebhookSecret, postWebhook } from "@/server/events";
import { generateApiKey } from "@/server/external/auth";
import { newId } from "@/server/ids";
import { presentConversations } from "@/server/presenters/conversation";

/** API keys and webhook endpoints: the public /webhooks resource and the Integrations screen. */
const { apiKeys, webhooks, webhookDeliveries, users, conversations } = schema;
type Webhook = typeof webhooks.$inferSelect;

/* ---------------- API keys (UI only: never via the API, to avoid privilege escalation) ---------------- */

export async function listKeys(actor: Actor) {
  requireAdmin(actor, "manage API keys");
  return db
    .select({ id: apiKeys.id, name: apiKeys.name, scope: apiKeys.scope, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdByName: users.name })
    .from(apiKeys).leftJoin(users, eq(users.id, apiKeys.createdBy))
    .where(eq(apiKeys.orgId, actor.orgId))
    .orderBy(sql`${apiKeys.revokedAt} is not null`, desc(apiKeys.createdAt));
}
export type ApiKeyRow = Awaited<ReturnType<typeof listKeys>>[number];

export async function createKey(actor: Actor, raw: unknown) {
  requireAdmin(actor, "manage API keys");
  if (actor.viaKey) throw new ApiError(403, "forbidden", "API keys can't create API keys");
  const { name, scope } = z.object({ name: z.string().trim().min(1, "Name is required").max(80), scope: z.enum(["read", "write"]).default("write") }).parse(raw);
  const { key, prefix, hash } = generateApiKey();
  const [row] = await db.insert(apiKeys).values({ id: newId("key"), orgId: actor.orgId, name, scope, prefix, hash, createdBy: actor.userId }).returning();
  return { id: row.id, name: row.name, scope: row.scope, prefix: row.prefix, createdAt: row.createdAt, key }; // the only time the full key is returned
}

export async function revokeKey(actor: Actor, id: string) {
  requireAdmin(actor, "manage API keys");
  const [row] = await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, actor.orgId))).returning({ id: apiKeys.id });
  if (!row) throw notFound("API key");
  return { id: row.id, revoked: true };
}

/* ---------------- webhooks ---------------- */

const presentWebhook = (h: Webhook, secret?: string) => ({
  object: "webhook" as const, id: h.id, url: h.url, events: h.events, active: h.active && !h.disabledAt, createdAt: h.createdAt.toISOString(),
  ...(secret ? { secret } : {}),
});

async function ownWebhook(actor: Actor, id: string) {
  requireStaff(actor, "manage webhooks");
  const [row] = await db.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.orgId, actor.orgId)));
  if (!row) throw notFound("Webhook");
  return row;
}

function checkUrl(url: string) {
  if (process.env.NODE_ENV === "production" && !url.startsWith("https://") && !process.env.ALLOW_HTTP_WEBHOOKS) throw new ApiError(400, "https_required", "Webhook URLs must use https", "url");
}

/** GET /webhooks (public) */
export async function listWebhooks(actor: Actor) {
  requireStaff(actor, "manage webhooks");
  const rows = await db.select().from(webhooks).where(eq(webhooks.orgId, actor.orgId)).orderBy(desc(webhooks.createdAt));
  return { object: "list" as const, data: rows.map((h) => presentWebhook(h)), nextCursor: null };
}

/** POST /webhooks: the signing secret is returned once. The UI may also subscribe the legacy call.* events. */
export async function createWebhook(actor: Actor, raw: unknown, opts: { allowLegacy?: boolean } = {}) {
  requireStaff(actor, "manage webhooks");
  const body = opts.allowLegacy ? webhookBody.extend({ events: z.array(z.enum([...EVENT_TYPES, ...LEGACY_EVENTS])).min(1) }).parse(raw) : webhookBody.parse(raw);
  checkUrl(body.url);
  const secret = newWebhookSecret();
  const [row] = await db.insert(webhooks).values({ id: newId("wh"), orgId: actor.orgId, url: body.url, events: body.events, secret }).returning();
  return presentWebhook(row, secret);
}

export async function deleteWebhook(actor: Actor, id: string) {
  await ownWebhook(actor, id);
  await db.delete(webhooks).where(eq(webhooks.id, id));
}

/* UI: endpoints with their delivery log, toggles, and test sends */

const maskSecret = (s: string) => `${s.slice(0, 9)}…${s.slice(-4)}`;

export async function listWebhooksWithDeliveries(actor: Actor) {
  requireStaff(actor, "manage webhooks");
  const hooks = await db.select().from(webhooks).where(eq(webhooks.orgId, actor.orgId)).orderBy(desc(webhooks.createdAt));
  const deliveries = await Promise.all(hooks.map((h) => db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, h.id)).orderBy(desc(webhookDeliveries.createdAt)).limit(20)));
  return hooks.map((h, i) => ({
    id: h.id, url: h.url, events: h.events, active: h.active, createdAt: h.createdAt, secretHint: maskSecret(h.secret),
    failingSince: h.failingSince, disabledAt: h.disabledAt, deliveries: deliveries[i],
  }));
}
export type WebhookRow = Awaited<ReturnType<typeof listWebhooksWithDeliveries>>[number];
export type DeliveryRow = WebhookRow["deliveries"][number];

export async function updateWebhook(actor: Actor, id: string, raw: unknown) {
  const current = await ownWebhook(actor, id);
  const body = z.object({ url: z.url({ protocol: /^https?$/ }).optional(), events: z.array(z.enum([...EVENT_TYPES, ...LEGACY_EVENTS])).min(1).optional(), active: z.boolean().optional() }).parse(raw);
  if (body.url) checkUrl(body.url);
  // turning an endpoint back on clears its auto-disable state
  const patch = { ...body, ...(body.active ? { disabledAt: null, failingSince: null } : {}) };
  const [row] = Object.keys(body).length ? await db.update(webhooks).set(patch).where(eq(webhooks.id, id)).returning() : [current];
  return presentWebhook(row);
}

/** Sends a sample event (the org's latest completed conversation) and returns the logged attempt. */
export async function testWebhook(actor: Actor, id: string, origin: string) {
  const hook = await ownWebhook(actor, id);
  const legacy = !hook.events.some((e) => e.startsWith("conversation."));
  const event = legacy ? "call.analysis_complete" : "conversation.completed";
  const [latest] = await db.select({ id: conversations.id }).from(conversations)
    .where(and(eq(conversations.orgId, actor.orgId), eq(conversations.status, "completed"))).orderBy(desc(conversations.completedAt)).limit(1);
  let data: Record<string, unknown> = { test: true };
  if (latest) {
    if (legacy) {
      const { legacyEventData } = await import("@/server/external/present");
      data = { ...(await legacyEventData(actor.orgId, "call.analysis_complete", latest.id, origin)), test: true };
    } else data = { conversation: (await presentConversations(actor.orgId, [latest.id], { transcript: false, origin }))[0], test: true };
  }
  return postWebhook(hook, event, newId("dlv"), data, 1, null);
}
