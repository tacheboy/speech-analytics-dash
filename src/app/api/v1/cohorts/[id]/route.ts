import { jsonBody, route } from "@/server/http";
import { updateCohort } from "@/server/services/config";

/** PATCH /api/v1/cohorts/{id} */
export const PATCH = route<RouteContext<"/api/v1/cohorts/[id]">>(async (req, actor, ctx) => updateCohort(actor, (await ctx.params).id, await jsonBody(req)));
