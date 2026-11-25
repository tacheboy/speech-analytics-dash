import { jsonBody, route } from "@/server/http";
import { deleteWebhook, updateWebhook } from "@/server/services/integrations";

type Ctx = RouteContext<"/api/internal/integrations/webhooks/[id]">;
export const PATCH = route<Ctx>(async (req, actor, ctx) => updateWebhook(actor, (await ctx.params).id, await jsonBody(req)));
export const DELETE = route<Ctx>(async (_req, actor, ctx) => {
  await deleteWebhook(actor, (await ctx.params).id);
});
