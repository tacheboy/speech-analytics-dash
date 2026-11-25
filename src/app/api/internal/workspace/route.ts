import { route } from "@/server/http";
import { getWorkspace } from "@/server/services/workspace";

/** UI-only: bootstrap (me, categories, cohorts, people, tags, samples, provider status) */
export const GET = route(async (_req, actor) => getWorkspace(actor));
