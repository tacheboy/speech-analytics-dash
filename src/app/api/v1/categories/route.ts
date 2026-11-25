import { route } from "@/server/http";
import { listCategories } from "@/server/services/config";

/** GET /api/v1/categories: every category with its current rubric */
export const GET = route(async (_req, actor) => listCategories(actor));
