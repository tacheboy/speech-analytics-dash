import { originOf } from "@/server/http";
import { openApiDocument } from "@/server/openapi";

/** GET /api/v1/openapi.json: generated from the zod contract (public, no auth) */
export async function GET(req: Request) {
  return Response.json(openApiDocument(originOf(req)), { headers: { "cache-control": "public, max-age=300" } });
}
