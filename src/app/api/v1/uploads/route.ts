import { originOf, jsonBody, route } from "@/server/http";
import { createUpload } from "@/server/services/uploads";

/** POST /api/v1/uploads → a presigned PUT URL + the audioUrl to submit */
export const POST = route(async (req, actor) => createUpload(actor, await jsonBody(req), originOf(req)), { status: 201 });
