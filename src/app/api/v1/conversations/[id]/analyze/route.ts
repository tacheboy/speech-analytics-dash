import { jsonBody, originOf, route } from "@/server/http";
import { analyzeConversation } from "@/server/services/conversations";

/** POST /api/v1/conversations/{id}/analyze: re-score (202), or dryRun against a draft rubric (200, nothing saved) */
export const POST = route<RouteContext<"/api/v1/conversations/[id]/analyze">>(async (req, actor, ctx) => {
  const r = await analyzeConversation(actor, decodeURIComponent((await ctx.params).id), await jsonBody(req), originOf(req));
  return Response.json(r.body, { status: r.status });
});
