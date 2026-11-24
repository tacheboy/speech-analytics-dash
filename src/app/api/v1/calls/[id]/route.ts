import { route } from "@/server/http";
import { getCall } from "@/server/services/calls";

/** 4. GET /api/v1/calls/:id — call, transcript, scored sections, extractions, metrics, moments */
export const GET = route<RouteContext<"/api/v1/calls/[id]">>(async (_req, actor, ctx) => getCall(actor, (await ctx.params).id));
