import { queryObject, route } from "@/server/http";
import { createCall, listCalls } from "@/server/services/calls";

/** 2. GET /api/v1/calls — filter, sort and paginate calls */
export const GET = route(async (req, actor) => listCalls(actor, queryObject(req.url)));

/** 3. POST /api/v1/calls — upload a recording (multipart `file`) or JSON `{ sampleId | audioUrl }`; returns 202 */
export const POST = route(async (req, actor) => createCall(actor, req), 202);
