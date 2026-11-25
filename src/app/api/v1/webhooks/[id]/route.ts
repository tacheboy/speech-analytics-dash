import { route } from "@/server/http";
import { deleteWebhook } from "@/server/services/integrations";

/** DELETE /api/v1/webhooks/{id} */
export const DELETE = route<RouteContext<"/api/v1/webhooks/[id]">>(async (_req, actor, ctx) => {
  await deleteWebhook(actor, (await ctx.params).id);
});
