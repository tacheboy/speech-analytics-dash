import { route } from "@/server/http";
import { getWorkspace } from "@/server/services/workspace";

/** 1. GET /api/v1/workspace — org, current user, categories (with rubric), teams, agents, tags, demo samples */
export const GET = route(async (_req, actor) => getWorkspace(actor));
