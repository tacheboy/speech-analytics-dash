import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError, type Actor } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { CALL_EVENTS, newWebhookSecret, sendTestEvent } from "@/server/webhooks";
import { generateApiKey } from "./auth";

/** Dashboard-side management of API keys and webhooks (Integrations screen). Admins and managers only. */
const { apiKeys, webhooks, webhookDeliveries, users } = schema;

function requireManager(actor: Actor) {
  if (actor.role === "agent") throw new ApiError(403, "forbidden", "Only admins and managers can manage integrations");
}

/* ---------- API keys ---------- */

export async function listKeys(actor: Actor) {
  requireManager(actor);
  return db
    .select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdByName: users.name })
    .from(apiKeys)
    .leftJoin(users, eq(users.id, apiKeys.createdBy))
    .where(eq(apiKeys.orgId, actor.orgId))
    .orderBy(sql`${apiKeys.revokedAt} is not null`, desc(apiKeys.createdAt));
}
export type ApiKeyRow = Awaited<ReturnType<typeof listKeys>>[number];

export async function createKey(actor: Actor, raw: unknown) {
  requireManager(actor);
  const { name } = z.object({ name: z.string().trim().min(1, "Name is required").max(80) }).parse(raw);
  const { key, prefix, hash } = generateApiKey();
  const [row] = await db.insert(apiKeys).values({ id: `key_${randomUUID().replaceAll("-", "").slice(0, 12)}`, orgId: actor.orgId, name, prefix, hash, createdBy: actor.userId }).returning();
  return { id: row.id, name: row.name, prefix: row.prefix, createdAt: row.createdAt, key }; // the only time the full key is returned
}

export async function revokeKey(actor: Actor, id: string) {
  requireManager(actor);
  const [row] = await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, actor.orgId))).returning({ id: apiKeys.id });
  if (!row) throw new ApiError(404, "not_found", "API key not found");
  return { id: row.id, revoked: true };
}

/* ---------- webhooks ---------- */

const events = z.array(z.enum(CALL_EVENTS as [string, ...string[]])).min(1, "Pick at least one event");
const url = z.string().trim().pipe(z.url({ protocol: /^https?$/, error: "Enter an http(s) URL" }));
const createBody = z.object({ url, events });
const patchBody = z.object({ url: url.optional(), events: events.optional(), active: z.boolean().optional() });

const maskSecret = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;

export async function listWebhooks(actor: Actor) {
  requireManager(actor);
  const hooks = await db.select().from(webhooks).where(eq(webhooks.orgId, actor.orgId)).orderBy(desc(webhooks.createdAt));
  const deliveries = await Promise.all(
    hooks.map((h) => db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, h.id)).orderBy(desc(webhookDeliveries.createdAt)).limit(20)),
  );
  return hooks.map((h, i) => ({
    id: h.id, url: h.url, events: h.events, active: h.active, createdAt: h.createdAt, secretHint: maskSecret(h.secret),
    deliveries: deliveries[i],
  }));
}
export type WebhookRow = Awaited<ReturnType<typeof listWebhooks>>[number];
export type DeliveryRow = WebhookRow["deliveries"][number];

export async function createWebhook(actor: Actor, raw: unknown) {
  requireManager(actor);
  const body = createBody.parse(raw);
  const secret = newWebhookSecret();
  const [row] = await db.insert(webhooks).values({ id: `wh_${randomUUID().replaceAll("-", "").slice(0, 12)}`, orgId: actor.orgId, url: body.url, events: body.events, secret }).returning();
  return { id: row.id, url: row.url, events: row.events, active: row.active, createdAt: row.createdAt, secret }; // shown once
}

async function ownWebhook(actor: Actor, id: string) {
  requireManager(actor);
  const [row] = await db.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.orgId, actor.orgId)));
  if (!row) throw new ApiError(404, "not_found", "Webhook not found");
  return row;
}

export async function updateWebhook(actor: Actor, id: string, raw: unknown) {
  const current = await ownWebhook(actor, id);
  const body = patchBody.parse(raw);
  const [row] = Object.keys(body).length ? await db.update(webhooks).set(body).where(eq(webhooks.id, id)).returning() : [current];
  return { id: row.id, url: row.url, events: row.events, active: row.active };
}

export async function deleteWebhook(actor: Actor, id: string) {
  await ownWebhook(actor, id);
  await db.delete(webhooks).where(eq(webhooks.id, id));
  return { id, deleted: true };
}

export async function testWebhook(actor: Actor, id: string) {
  await ownWebhook(actor, id);
  return sendTestEvent(id);
}
