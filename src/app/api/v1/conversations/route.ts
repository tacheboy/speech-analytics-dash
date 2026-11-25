import { jsonBody, originOf, queryObject, route } from "@/server/http";
import { createConversation, listConversations } from "@/server/services/conversations";

/** GET /api/v1/conversations: list, filter and sync (updatedSince) */
export const GET = route(async (req, actor) => listConversations(actor, queryObject(req.url), originOf(req)));

/** POST /api/v1/conversations: 202 for a new conversation, 200 + Idempotent-Replayed when externalId already exists */
export const POST = route(async (req, actor) => {
  const { conversation, replayed } = await createConversation(actor, await jsonBody(req), originOf(req));
  return Response.json(conversation, { status: replayed ? 200 : 202, headers: replayed ? { "idempotent-replayed": "true" } : {} });
});
