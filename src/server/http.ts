import { ZodError } from "zod";
import { ApiError, getActor, type Actor } from "@/server/auth";

/** Wraps a Route Handler: resolves the actor, returns `{ data }` or `{ error: { code, message } }`. */
export function route<C>(fn: (req: Request, actor: Actor, ctx: C) => Promise<unknown>, status = 200) {
  return async (req: Request, ctx: C) => {
    try {
      const actor = await getActor(req);
      return Response.json({ data: await fn(req, actor, ctx) }, { status });
    } catch (e) {
      if (e instanceof ApiError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
      if (e instanceof ZodError)
        return Response.json({ error: { code: "invalid_request", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } }, { status: 400 });
      console.error(e);
      return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
    }
  };
}

/** URLSearchParams → plain object, repeated keys become arrays. */
export function queryObject(url: string) {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URL(url).searchParams) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}
