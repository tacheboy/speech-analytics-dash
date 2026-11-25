import { externalRoute, readJson } from "@/server/external/http";
import { createAgent, listAgents } from "@/server/external/service";

/** GET /api/external/v1/agents — active agents of the organization */
export const GET = externalRoute(async (_req, caller) => listAgents(caller));

/** POST /api/external/v1/agents — { name, email } → 201 (409 if the email is in use) */
export const POST = externalRoute(async (req, caller) => createAgent(caller, await readJson(req)), 201);
