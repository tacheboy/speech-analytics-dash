import { route } from "@/server/http";
import { getOps } from "@/server/services/ops";

/** UI-only: pipeline health (backlog, failures, latency, cost, models, webhooks) */
export const GET = route(async (_req, actor) => getOps(actor));
