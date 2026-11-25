import { jsonBody, route } from "@/server/http";
import { createWebhook, listWebhooksWithDeliveries } from "@/server/services/integrations";

export const GET = route(async (_req, actor) => listWebhooksWithDeliveries(actor));
export const POST = route(async (req, actor) => createWebhook(actor, await jsonBody(req), { allowLegacy: true }), { status: 201 });
