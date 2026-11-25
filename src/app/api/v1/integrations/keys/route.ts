import { route } from "@/server/http";
import { createKey, listKeys } from "@/server/external/manage";

/** GET /api/v1/integrations/keys — the org's API keys (prefix only) */
export const GET = route(async (_req, actor) => listKeys(actor));

/** POST /api/v1/integrations/keys — { name } → the full key, returned only once */
export const POST = route(async (req, actor) => createKey(actor, await req.json()), 201);
