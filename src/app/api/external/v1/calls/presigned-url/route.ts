import { externalRoute, originOf, readJson } from "@/server/external/http";
import { presignedUpload } from "@/server/external/service";

/** POST /api/external/v1/calls/presigned-url — { filename, contentType } → { key, presignedUrl, publicUrl } */
export const POST = externalRoute(async (req) => presignedUpload(await readJson(req), originOf(req)));
