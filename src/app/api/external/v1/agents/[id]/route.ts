import { externalRoute, readJson } from "@/server/external/http";
import { deleteAgent, updateAgent } from "@/server/external/service";

type Ctx = RouteContext<"/api/external/v1/agents/[id]">;

/** PATCH /api/external/v1/agents/{id} — { name?, email? } */
export const PATCH = externalRoute<Ctx>(async (req, caller, ctx) => updateAgent(caller, (await ctx.params).id, await readJson(req)));

/** DELETE /api/external/v1/agents/{id} — soft delete; calls keep their history */
export const DELETE = externalRoute<Ctx>(async (_req, caller, ctx) => deleteAgent(caller, (await ctx.params).id));
