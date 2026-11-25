import { externalRoute, originOf } from "@/server/external/http";
import { getAnalysis } from "@/server/external/service";

/** GET /api/external/v1/calls/{callId}/analysis — status + analysis (when completed) + metadata */
export const GET = externalRoute<RouteContext<"/api/external/v1/calls/[callId]/analysis">>(async (req, caller, ctx) =>
  getAnalysis(caller, (await ctx.params).callId, originOf(req)),
);
