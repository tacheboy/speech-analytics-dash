import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { storage } from "@/server/storage";
import { asrAudio, channelEnergy, playbackAudio } from "../audio";
import { enqueueStage, type StageJob } from "../queue";
import { loadRun, StageError } from "./common";

/**
 * Stage 2 (ffmpeg): mono 16 kHz mixdown for ASR, per-channel energy for stereo speaker attribution,
 * and a browser playback file when the original isn't already MP3/M4A. Each artifact is skipped if present.
 */
export async function prepare(job: StageJob) {
  const run = await loadRun(job.conversationId, job.analysisId);
  if (!run) return;
  const { conv, prefix } = run;
  const store = await storage();
  const original = conv.audioKey ? await store.get(conv.audioKey) : null;
  if (!original) throw new StageError("audio_invalid", "The stored recording is missing", true);

  if ((await store.size(`${prefix}/asr.mp3`)) == null) await store.put(`${prefix}/asr.mp3`, await asrAudio(original), "audio/mpeg");
  const stereo = (conv.channels ?? 1) >= 2 && conv.channelLayout !== "mono";
  if (stereo && (await store.size(`${prefix}/energy.json`)) == null) {
    await store.put(`${prefix}/energy.json`, Buffer.from(JSON.stringify(await channelEnergy(original))), "application/json");
  }
  let playbackKey = conv.playbackKey;
  if (!playbackKey) {
    if (/\.(mp3|m4a)$/.test(conv.audioKey!)) playbackKey = conv.audioKey;
    else {
      playbackKey = `${prefix}/playback.m4a`;
      if ((await store.size(playbackKey)) == null) await store.put(playbackKey, await playbackAudio(original), "audio/mp4");
    }
    await db.update(schema.conversations).set({ playbackKey, updatedAt: new Date() }).where(eq(schema.conversations.id, conv.id));
  }
  await enqueueStage("transcribe", job);
}
