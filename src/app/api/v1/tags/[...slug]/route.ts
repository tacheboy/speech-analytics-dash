import { jsonBody, route } from "@/server/http";
import { putTag } from "@/server/services/config";

/** PUT /api/v1/tags/{slug/path}: upsert; missing parents are created */
export const PUT = route<RouteContext<"/api/v1/tags/[...slug]">>(async (req, actor, ctx) => putTag(actor, (await ctx.params).slug.join("/"), await jsonBody(req)));
