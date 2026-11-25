import { errorResponse } from "@/server/external/http";
import { KEY_RE, MAX_UPLOAD_BYTES, verifySignature, writeUpload } from "@/server/external/uploads";

/**
 * PUT target of POST /calls/presigned-url. No API key: the HMAC signature in the query string
 * authorises exactly one key until it expires (15 minutes).
 */
export async function PUT(req: Request, ctx: RouteContext<"/api/external/v1/uploads/[key]">) {
  const { key } = await ctx.params;
  if (!KEY_RE.test(key)) return errorResponse(404, "Not found");
  const url = new URL(req.url);
  const check = verifySignature(key, url.searchParams.get("expires"), url.searchParams.get("sig"));
  if (check === "invalid") return errorResponse(403, "Invalid upload signature");
  if (check === "expired") return errorResponse(403, "Upload URL has expired");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) return errorResponse(413, "Recordings must be 50 MB or smaller");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return errorResponse(413, "Recordings must be 50 MB or smaller");
  await writeUpload(key, bytes);
  return new Response(null, { status: 200 });
}
