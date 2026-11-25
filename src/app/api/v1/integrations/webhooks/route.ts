import { route } from "@/server/http";
import { createWebhook, listWebhooks } from "@/server/external/manage";

/** GET /api/v1/integrations/webhooks — endpoints with their last 20 deliveries */
export const GET = route(async (_req, actor) => listWebhooks(actor));

/** POST /api/v1/integrations/webhooks — { url, events[] } → includes the signing secret, returned only once */
export const POST = route(async (req, actor) => createWebhook(actor, await req.json()), 201);
