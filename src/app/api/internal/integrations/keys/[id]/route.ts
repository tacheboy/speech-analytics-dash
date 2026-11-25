import { route } from "@/server/http";
import { revokeKey } from "@/server/services/integrations";

export const DELETE = route<RouteContext<"/api/internal/integrations/keys/[id]">>(async (_req, actor, ctx) => revokeKey(actor, (await ctx.params).id));
