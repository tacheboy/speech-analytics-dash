import { originOf, route } from "@/server/http";
import { deleteConversation, getConversation } from "@/server/services/conversations";

type Ctx = RouteContext<"/api/v1/conversations/[id]">;

/** GET /api/v1/conversations/{id | ext:externalId}: the full object, transcript included */
export const GET = route<Ctx>(async (req, actor, ctx) => getConversation(actor, decodeURIComponent((await ctx.params).id), originOf(req)));

/** DELETE /api/v1/conversations/{id}: erasure (audio, transcript, analysis); a tombstone stays for sync */
export const DELETE = route<Ctx>(async (_req, actor, ctx) => {
  await deleteConversation(actor, decodeURIComponent((await ctx.params).id));
});
