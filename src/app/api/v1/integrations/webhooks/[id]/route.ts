import { route } from "@/server/http";
import { deleteWebhook, updateWebhook } from "@/server/external/manage";

type Ctx = RouteContext<"/api/v1/integrations/webhooks/[id]">;

/** PATCH /api/v1/integrations/webhooks/:id — { url?, events?, active? } */
export const PATCH = route<Ctx>(async (req, actor, ctx) => updateWebhook(actor, (await ctx.params).id, await req.json()));

/** DELETE /api/v1/integrations/webhooks/:id */
export const DELETE = route<Ctx>(async (_req, actor, ctx) => deleteWebhook(actor, (await ctx.params).id));
