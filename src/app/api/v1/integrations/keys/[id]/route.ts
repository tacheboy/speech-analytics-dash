import { route } from "@/server/http";
import { revokeKey } from "@/server/external/manage";

/** DELETE /api/v1/integrations/keys/:id — revoke */
export const DELETE = route<RouteContext<"/api/v1/integrations/keys/[id]">>(async (_req, actor, ctx) => revokeKey(actor, (await ctx.params).id));
