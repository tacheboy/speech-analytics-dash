import { ZodError } from "zod";
import { ApiError } from "@/server/auth";
import { authenticate, type ExternalCaller } from "./auth";
import { ExternalError } from "./errors";

export { ExternalError };

export const errorResponse = (status: number, message: string) => Response.json({ error: message }, { status });

export function toErrorResponse(e: unknown) {
  if (e instanceof ExternalError || e instanceof ApiError) return errorResponse(e.status, e.message);
  if (e instanceof ZodError) return errorResponse(400, e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; "));
  console.error(e);
  return errorResponse(500, "Internal server error");
}

/**
 * Wraps an external Route Handler: authenticates the API key and returns the handler's body as JSON.
 * Handlers return the full body (`{ data }` or `{ success: true }`) so the shape matches the docs exactly.
 */
export function externalRoute<C>(fn: (req: Request, caller: ExternalCaller, ctx: C) => Promise<unknown>, status = 200) {
  return async (req: Request, ctx: C) => {
    try {
      const caller = await authenticate(req);
      return Response.json(await fn(req, caller, ctx), { status });
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ExternalError(400, "Invalid JSON body");
  }
}

/** Public origin for absolute URLs: PUBLIC_BASE_URL, else the request's own origin. */
export function originOf(req?: Request) {
  const env = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (env) return env;
  if (req) {
    const url = new URL(req.url);
    const host = req.headers.get("x-forwarded-host");
    const proto = req.headers.get("x-forwarded-proto");
    return host ? `${proto ?? url.protocol.replace(":", "")}://${host}` : url.origin;
  }
  return "http://localhost:3000";
}

export const absoluteUrl = (url: string | null, origin: string) => (url == null ? null : /^https?:\/\//i.test(url) ? url : `${origin}${url.startsWith("/") ? "" : "/"}${url}`);
