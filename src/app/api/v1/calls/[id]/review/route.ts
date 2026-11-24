import { route } from "@/server/http";
import { reviewCall } from "@/server/services/calls";

/** 5. PATCH /api/v1/calls/:id/review — manager overrides per criterion, note, tags; recomputes the score */
export const PATCH = route<RouteContext<"/api/v1/calls/[id]/review">>(async (req, actor, ctx) => reviewCall(actor, (await ctx.params).id, await req.json()));
