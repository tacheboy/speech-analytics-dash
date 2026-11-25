import { externalRoute } from "@/server/external/http";
import { getCategory } from "@/server/external/service";

/** GET /api/external/v1/categories/{categoryId} — metadata + full analysis configuration */
export const GET = externalRoute<RouteContext<"/api/external/v1/categories/[categoryId]">>(async (_req, caller, ctx) =>
  getCategory(caller, (await ctx.params).categoryId),
);
