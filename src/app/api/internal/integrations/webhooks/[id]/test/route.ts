import { originOf, route } from "@/server/http";
import { testWebhook } from "@/server/services/integrations";

export const POST = route<RouteContext<"/api/internal/integrations/webhooks/[id]/test">>(async (req, actor, ctx) => testWebhook(actor, (await ctx.params).id, originOf(req)));
