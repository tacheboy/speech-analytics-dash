import { externalRoute } from "@/server/external/http";
import { listCategories } from "@/server/external/service";

/** GET /api/external/v1/categories */
export const GET = externalRoute(async (_req, caller) => listCategories(caller));
