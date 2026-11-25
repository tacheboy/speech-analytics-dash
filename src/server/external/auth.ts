import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { ExternalError } from "./errors";

const { apiKeys, users } = schema;
export const DEMO_ORG_ID = "org_kaveri";

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** New API key: shown once; only its sha256 and a display prefix are stored. */
export function generateApiKey() {
  const key = `vb_live_${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashKey(key) };
}

/** Reads `Authorization: Bearer <key>` or `x-api-key`. */
export function readApiKey(req: Request): string | null {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || req.headers.get("x-api-key")?.trim() || null;
}

/** Resolves a key to its org (the env demo key maps to the seeded org). Updates `lastUsedAt`. */
export async function resolveApiKey(key: string): Promise<{ orgId: string; keyId: string | null; createdBy: string | null; scope: "read" | "write" } | null> {
  if (process.env.DEMO_API_KEY && key === process.env.DEMO_API_KEY) return { orgId: DEMO_ORG_ID, keyId: null, createdBy: null, scope: "write" };
  const [row] = await db.select().from(apiKeys).where(and(eq(apiKeys.hash, hashKey(key)), isNull(apiKeys.revokedAt)));
  if (!row) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return { orgId: row.orgId, keyId: row.id, createdBy: row.createdBy, scope: row.scope };
}

export async function firstAdmin(orgId: string) {
  const [u] = await db.select().from(users).where(and(eq(users.orgId, orgId), eq(users.role, "admin"))).orderBy(asc(users.createdAt)).limit(1);
  return u ?? null;
}

export type ExternalCaller = { orgId: string; keyId: string | null; userId: string | null };

/** External (Voxxi-compatible) API auth: 401 `{ error: "Missing API key" | "Invalid API key" }`. */
export async function authenticate(req: Request): Promise<ExternalCaller> {
  const key = readApiKey(req);
  if (!key) throw new ExternalError(401, "Missing API key");
  const k = await resolveApiKey(key);
  if (!k) throw new ExternalError(401, "Invalid API key");
  return { orgId: k.orgId, keyId: k.keyId, userId: k.createdBy ?? (await firstAdmin(k.orgId))?.id ?? null };
}
