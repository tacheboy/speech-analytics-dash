import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { ApiError, getActor, type Actor } from "@/server/auth";
import { db } from "@/server/db/client";
import { log } from "@/server/log";

/**
 * Wraps a /api/v1 (or /api/internal) Route Handler:
 * request id → auth (session or API key, scope-checked) → rate limit (keys only) → handler → JSON.
 * Errors become `{ error: { type, code, message, param?, requestId } }`.
 * A handler returns a plain value (sent as JSON with `status`) or a Response.
 */
export function route<C>(fn: (req: Request, actor: Actor, ctx: C) => Promise<unknown>, opts: { status?: number } = {}) {
  return async (req: Request, ctx: C) => {
    const requestId = req.headers.get("x-request-id")?.slice(0, 64) || `req_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const headers = new Headers({ "x-request-id": requestId });
    try {
      const actor = await getActor(req);
      if (actor.viaKey && req.method !== "GET" && actor.scope === "read") throw new ApiError(403, "insufficient_scope", "This API key is read-only");
      if (actor.viaKey) await rateLimit(actor.keyId ?? "demo", headers);
      const out = await fn(req, actor, ctx);
      if (out instanceof Response) {
        headers.forEach((v, k) => out.headers.set(k, v));
        return out;
      }
      if (out === undefined) return new Response(null, { status: 204, headers });
      return Response.json(out, { status: opts.status ?? 200, headers });
    } catch (e) {
      return errorResponse(e, requestId, headers);
    }
  };
}

export function errorResponse(e: unknown, requestId: string, headers = new Headers()) {
  headers.set("x-request-id", requestId);
  if (e instanceof ApiError) {
    if (e.status === 429) headers.set("retry-after", "60");
    return Response.json({ error: { type: e.type, code: e.code, message: e.message, ...(e.param ? { param: e.param } : {}), requestId } }, { status: e.status, headers });
  }
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const param = first?.path.join(".") || undefined;
    const message = e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
    return Response.json({ error: { type: "invalid_request", code: "invalid_parameter", message, ...(param ? { param } : {}), requestId } }, { status: 400, headers });
  }
  log.error("unhandled api error", { requestId, err: e });
  return Response.json({ error: { type: "api_error", code: "internal_error", message: "Something went wrong on our side", requestId } }, { status: 500, headers });
}

/* ---------- rate limiting: fixed 1-minute window per key, counted in Postgres ---------- */

const LIMIT = () => Number(process.env.RATE_LIMIT_PER_MIN ?? 600);

async function rateLimit(key: string, headers: Headers) {
  const window = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const rows = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${window.toISOString()}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`);
  const count = Number(rows[0]?.count ?? 1);
  const limit = LIMIT();
  headers.set("ratelimit-limit", String(limit));
  headers.set("ratelimit-remaining", String(Math.max(0, limit - count)));
  headers.set("ratelimit-reset", String(Math.ceil((window.getTime() + 60_000 - Date.now()) / 1000)));
  if (count > limit) throw new ApiError(429, "rate_limited", `Rate limit of ${limit} requests per minute exceeded`);
}

/* ---------- request helpers ---------- */

/** URLSearchParams → plain object; repeated keys become arrays. */
export function queryObject(url: string) {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URL(url).searchParams) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

export async function jsonBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON");
  }
}

/** Public origin for absolute URLs: PUBLIC_BASE_URL, else the request's own origin (proxy-aware). */
export function originOf(req?: Request) {
  const env = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (env) return env;
  if (req) {
    const url = new URL(req.url);
    const host = req.headers.get("x-forwarded-host");
    const proto = req.headers.get("x-forwarded-proto");
    return host ? `${proto ?? url.protocol.replace(":", "")}://${host}` : url.origin;
  }
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/* ---------- cursors: opaque base64url of the last row's sort key ---------- */

export const encodeCursor = (v: unknown[]) => Buffer.from(JSON.stringify(v)).toString("base64url");
export function decodeCursor(c: string | undefined): unknown[] | null {
  if (!c) return null;
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString());
    if (Array.isArray(v)) return v;
  } catch {}
  throw new ApiError(400, "invalid_cursor", "cursor is not valid; pass nextCursor from a previous page", "cursor");
}
