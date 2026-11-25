import { createUploadBody } from "@/lib/contract";
import { ApiError, requireStaff, type Actor } from "@/server/auth";
import { newId } from "@/server/ids";
import { storage } from "@/server/storage";
import { CONTENT_TYPES } from "@/server/pipeline/audio";

const UPLOAD_TTL = 15 * 60;
const AUDIO_URL_TTL = 7 * 24 * 3600;

/**
 * POST /uploads: a presigned PUT for direct-to-storage upload, plus the audioUrl to pass to
 * POST /conversations. Local disk storage signs our own /api/files URLs; S3 storage presigns S3.
 */
export async function createUpload(actor: Actor, raw: unknown, origin: string) {
  requireStaff(actor, "upload recordings");
  const body = createUploadBody.parse(raw);
  const ext = body.fileName.split(".").pop()?.toLowerCase() ?? "";
  const type = body.contentType.toLowerCase().split(";")[0].trim();
  const known = ext in CONTENT_TYPES || Object.values(CONTENT_TYPES).includes(type) || type.startsWith("audio/");
  if (!known) throw new ApiError(415, "unsupported_media_type", "Upload an audio file (mp3, wav, m4a, ogg, flac, webm, aac, amr)", "contentType");
  const safe = body.fileName.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-60) || "recording";
  const key = `org/${actor.orgId}/uploads/${newId("conv").slice(5)}/${safe}`;
  const store = await storage();
  return {
    object: "upload" as const,
    uploadUrl: await store.signedPutUrl(key, type, UPLOAD_TTL, origin),
    audioUrl: await store.signedGetUrl(key, AUDIO_URL_TTL, origin),
    method: "PUT" as const,
    headers: { "content-type": type },
    expiresAt: new Date(Date.now() + UPLOAD_TTL * 1000).toISOString(),
  };
}
