import { queryObject, route } from "@/server/http";
import { getDashboard } from "@/server/services/dashboard";

/** UI-only: the dashboard composite (KPIs with deltas, trends, leaderboards, coaching, intelligence) */
export const GET = route(async (req, actor) => getDashboard(actor, queryObject(req.url)));
