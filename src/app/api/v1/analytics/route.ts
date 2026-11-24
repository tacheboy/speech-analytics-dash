import { queryObject, route } from "@/server/http";
import { getAnalytics } from "@/server/services/analytics";

/** 6. GET /api/v1/analytics — KPIs, trends, outcomes, criteria failure rates, leaderboard for org | category | team | agent */
export const GET = route(async (req, actor) => getAnalytics(actor, queryObject(req.url)));
