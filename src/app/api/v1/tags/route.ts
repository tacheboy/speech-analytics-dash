import { route } from "@/server/http";
import { listTags } from "@/server/services/config";

/** GET /api/v1/tags[?prefix=objection] */
export const GET = route(async (req, actor) => listTags(actor, new URL(req.url).searchParams.get("prefix") ?? undefined));
