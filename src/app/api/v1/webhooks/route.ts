import { jsonBody, route } from "@/server/http";
import { createWebhook, listWebhooks } from "@/server/services/integrations";

/** GET /api/v1/webhooks */
export const GET = route(async (_req, actor) => listWebhooks(actor));

/** POST /api/v1/webhooks { url, events[] } → the signing secret, shown once */
export const POST = route(async (req, actor) => createWebhook(actor, await jsonBody(req)), { status: 201 });
