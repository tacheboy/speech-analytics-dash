import { eq } from "drizzle-orm";
import path from "node:path";
import { ApiError } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { content } from "@/server/pipeline/mock-analyzer";

export const UPLOAD_DIR = path.join(process.cwd(), "storage", "uploads");

export type IngestAudio =
  | { kind: "sample"; sampleId: string } // bundled demo recording: analysis matches the audio exactly
  | { kind: "stored"; url: string; fileName: string | null; empty?: boolean } // file already in storage/uploads
  | { kind: "url"; url: string; failure?: string }; // remote recording (ingested before analysis)

type Category = typeof schema.categories.$inferSelect;
type Agent = typeof schema.users.$inferSelect;

/**
 * Shared by the dashboard upload and the external API: picks the analysis template (no ASR in this build),
 * inserts the call as "processing", and lets lazy completion finish it a few seconds later.
 */
export async function insertCall(p: {
  id?: string; orgId: string; category: Category; agent: Agent; uploadedBy: string | null; audio: IngestAudio;
  durationSec?: number; callAt?: Date; udfs?: Record<string, unknown> | null;
}) {
  const id = p.id ?? `call_${crypto.randomUUID().slice(0, 8)}`;
  const [team] = p.agent.teamId ? await db.select().from(schema.teams).where(eq(schema.teams.id, p.agent.teamId)) : [];
  const language = team?.language ?? "hi-en";
  const { templates, timings } = content();

  let templateId: string;
  let audioUrl: string;
  let fileName: string | null = null;
  let isSimulated = true;
  let failureReason: string | null = null;
  if (p.audio.kind === "sample") {
    const t = templates.get(p.audio.sampleId);
    if (!t || !timings[t.id]) throw new ApiError(404, "not_found", "Unknown sampleId");
    if (t.categoryId !== p.category.id) throw new ApiError(400, "invalid_request", `Sample ${t.id} belongs to category ${t.categoryId}`);
    templateId = t.id;
    audioUrl = `/audio/${t.id}.m4a`;
    fileName = `${t.id}.m4a`;
    isSimulated = false;
  } else {
    const pool = [...templates.values()].filter((t) => t.categoryId === p.category.id && timings[t.id]);
    if (!pool.length) throw new ApiError(400, "invalid_request", "No analysis templates for this category");
    const same = pool.filter((t) => t.language === language);
    templateId = (same.length ? same : pool)[Math.floor(Math.random() * (same.length || pool.length))].id;
    audioUrl = p.audio.url;
    fileName = p.audio.kind === "stored" ? p.audio.fileName : p.audio.url.split("/").pop()?.split("?")[0] ?? null;
    if (p.audio.kind === "stored" && p.audio.empty) failureReason = "Unable to ingest recording: file is empty (0 bytes)";
    if (p.audio.kind === "url" && p.audio.failure) failureReason = p.audio.failure;
  }
  const durationSec = p.audio.kind === "sample" ? Math.round(timings[templateId].duration) : p.durationSec ?? Math.round(timings[templateId].duration);
  const now = new Date();
  await db.insert(schema.calls).values({
    id, orgId: p.orgId, categoryId: p.category.id, agentId: p.agent.id, uploadedBy: p.uploadedBy,
    status: "processing", readyAt: new Date(now.getTime() + 6000 + Math.random() * 8000), failureReason,
    audioUrl, fileName, durationSec, callAt: p.callAt ?? now, language, templateId, isSimulated,
    rubricVersion: p.category.rubricVersion, udfs: p.udfs ?? null,
  });
  return { callId: id, status: "processing" as const };
}
