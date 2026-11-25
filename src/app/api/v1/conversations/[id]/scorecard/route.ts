import { jsonBody, originOf, route } from "@/server/http";
import { patchScorecard } from "@/server/services/conversations";

/** PATCH /api/v1/conversations/{id}/scorecard: human audit (overrides, outcome, manual tags, note) */
export const PATCH = route<RouteContext<"/api/v1/conversations/[id]/scorecard">>(async (req, actor, ctx) =>
  patchScorecard(actor, decodeURIComponent((await ctx.params).id), await jsonBody(req), originOf(req)),
);
