import { route } from "@/server/http";
import { testWebhook } from "@/server/external/manage";

/** POST /api/v1/integrations/webhooks/:id/test — sends a sample call.analysis_complete and returns the logged delivery */
export const POST = route<RouteContext<"/api/v1/integrations/webhooks/[id]/test">>(async (_req, actor, ctx) => testWebhook(actor, (await ctx.params).id));
