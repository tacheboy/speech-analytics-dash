import { queryObject, route } from "@/server/http";
import { getPublicAnalytics } from "@/server/services/analytics";

/** GET /api/v1/analytics?metrics=qualityScore,successRate&groupBy=person&from=…&to=… */
export const GET = route(async (req, actor) => getPublicAnalytics(actor, queryObject(req.url)));
