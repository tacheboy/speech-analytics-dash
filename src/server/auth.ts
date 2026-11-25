import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, schema } from "@/server/db/client";
import type { Role } from "@/lib/domain";
import { firstAdmin, readApiKey, resolveApiKey } from "@/server/external/auth";
import { readSession, SESSION_COOKIE } from "@/server/session";

/**
 * Who is calling. Session users act as themselves (members only ever see their own conversations).
 * API keys act as their org's first admin, limited by the key's scope (read | write).
 */
export type Actor = { userId: string; orgId: string; role: Role; name: string; keyId: string | null; scope: "read" | "write"; viaKey: boolean };

const TYPES: Record<number, string> = {
  400: "invalid_request", 401: "authentication", 403: "permission", 404: "not_found", 409: "conflict",
  413: "invalid_request", 415: "invalid_request", 422: "invalid_request", 429: "rate_limited",
};

/** An API error with a stable snake_case `code`. `type` follows from the HTTP status. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public param?: string) {
    super(message);
  }
  get type() {
    return TYPES[this.status] ?? "api_error";
  }
}

export const notFound = (what: string, code = `${what.toLowerCase().replace(/\s+/g, "_")}_not_found`) => new ApiError(404, code, `${what} not found`);

export async function getActor(req?: Request): Promise<Actor> {
  const key = req ? readApiKey(req) : null;
  if (key) {
    const k = await resolveApiKey(key);
    if (!k) throw new ApiError(401, "invalid_api_key", "Invalid API key");
    const admin = await firstAdmin(k.orgId);
    if (!admin) throw new ApiError(401, "invalid_api_key", "The key's organization has no admin");
    return { userId: admin.id, orgId: admin.orgId, role: "admin", name: admin.name, keyId: k.keyId, scope: k.scope, viaKey: true };
  }
  const userId = readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) throw new ApiError(401, "missing_credentials", "Sign in, or pass `Authorization: Bearer <api key>`");
  const u = await userById(userId);
  if (!u || u.deactivatedAt) throw new ApiError(401, "unknown_user", "Unknown user");
  return { userId: u.id, orgId: u.orgId, role: u.role, name: u.name, keyId: null, scope: "write", viaKey: false };
}

async function userById(id: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return u ?? null;
}

export function requireStaff(actor: Actor, what = "do this") {
  if (actor.role === "member") throw new ApiError(403, "forbidden", `Members can't ${what}`);
}
export function requireAdmin(actor: Actor, what = "do this") {
  if (actor.role !== "admin") throw new ApiError(403, "forbidden", `Only admins can ${what}`);
}
