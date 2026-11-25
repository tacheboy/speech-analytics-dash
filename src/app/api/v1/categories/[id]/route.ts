import { z } from "zod";
import { jsonBody, route } from "@/server/http";
import { getCategory, putCategory } from "@/server/services/config";

type Ctx = RouteContext<"/api/v1/categories/[id]">;

/** GET /api/v1/categories/{id}[?version=n] */
export const GET = route<Ctx>(async (req, actor, ctx) => {
  const v = new URL(req.url).searchParams.get("version");
  return getCategory(actor, (await ctx.params).id, v ? z.coerce.number().int().min(1).parse(v) : undefined);
});

/** PUT /api/v1/categories/{id}: create, or publish a new immutable rubric version (201 when created) */
export const PUT = route<Ctx>(async (req, actor, ctx) => {
  const { category, created } = await putCategory(actor, (await ctx.params).id, await jsonBody(req));
  return Response.json(category, { status: created ? 201 : 200 });
});
