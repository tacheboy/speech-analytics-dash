import { jsonBody, route } from "@/server/http";
import { createCohort, listCohorts } from "@/server/services/config";

/** GET /api/v1/cohorts */
export const GET = route(async (_req, actor) => listCohorts(actor));

/** POST /api/v1/cohorts { name, language? } */
export const POST = route(async (req, actor) => createCohort(actor, await jsonBody(req)), { status: 201 });
