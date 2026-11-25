import { externalRoute, originOf, readJson } from "@/server/external/http";
import { createExternalCall } from "@/server/external/service";

/** POST /api/external/v1/calls — { memberId, categoryId, audio_url, udfs?, date? } → 202 */
export const POST = externalRoute(async (req, caller) => createExternalCall(caller, await readJson(req), originOf(req)), 202);
