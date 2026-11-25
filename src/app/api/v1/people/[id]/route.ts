import { jsonBody, route } from "@/server/http";
import { getPerson, updatePerson } from "@/server/services/people";

type Ctx = RouteContext<"/api/v1/people/[id]">;

/** GET /api/v1/people/{id | ext:externalId} */
export const GET = route<Ctx>(async (_req, actor, ctx) => getPerson(actor, decodeURIComponent((await ctx.params).id)));

/** PATCH /api/v1/people/{id}: name, email, externalId, cohortId, active (deactivate; history stays) */
export const PATCH = route<Ctx>(async (req, actor, ctx) => updatePerson(actor, decodeURIComponent((await ctx.params).id), await jsonBody(req)));
