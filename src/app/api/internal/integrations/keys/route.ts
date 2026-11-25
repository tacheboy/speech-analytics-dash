import { jsonBody, route } from "@/server/http";
import { createKey, listKeys } from "@/server/services/integrations";

export const GET = route(async (_req, actor) => listKeys(actor));
export const POST = route(async (req, actor) => createKey(actor, await jsonBody(req)), { status: 201 });
