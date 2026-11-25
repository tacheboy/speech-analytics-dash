import OpenAI, { toFile } from "openai";
import { isRetryableStatus, ProviderError, type Asr, type AsrOptions, type AsrResult, type AsrUnit } from "./types";

/** Hint like "ta-en" → BCP-47 for providers that want one ("ta-IN"); code-mixed hints use the Indic side. */
function bcp47(hint: string | null | undefined) {
  if (!hint) return null;
  const primary = hint.split("-").find((p) => p !== "en") ?? "en";
  return `${primary}-IN`;
}

async function http(url: string, init: RequestInit & { timeoutMs?: number }, provider: string) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 120_000) });
  } catch (e) {
    throw new ProviderError(`${provider}: ${(e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message}`, true);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new ProviderError(`${provider} HTTP ${res.status}: ${body}`, isRetryableStatus(res.status), res.status);
  }
  return res;
}

/* ---------------- Sarvam (batch job API: init → upload → start → poll → download) ---------------- */

/**
 * Sarvam Saaras: built for 8 kHz code-mixed Indic speech. The batch API handles files up to 2 h.
 * Timestamps are per chunk or per diarized turn (not per word); attribution works on either.
 */
export function sarvamAsr(model: string, apiKey: string): Asr {
  const base = process.env.SARVAM_BASE_URL ?? "https://api.sarvam.ai";
  const headers = { "api-subscription-key": apiKey, "content-type": "application/json" };
  const json = async (path: string, body?: unknown) =>
    (await http(`${base}${path}`, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }, "Sarvam")).json();
  return {
    id: `sarvam:${model}`,
    supports: { keyterms: model.includes("v4"), diarization: true },
    async submit(audio, opts) {
      const job = await json("/speech-to-text/job/v1", {
        job_parameters: {
          model, mode: process.env.SARVAM_MODE ?? "codemix", language_code: bcp47(opts.language) ?? "unknown",
          with_timestamps: true, with_diarization: opts.diarize, ...(opts.diarize ? { num_speakers: 2 } : {}),
          ...(opts.keyterms?.length && model.includes("v4") ? { keyterms: opts.keyterms.slice(0, 50).map((k) => k.slice(0, 64)) } : {}),
        },
      });
      const jobId: string = job.job_id;
      const up = await json("/speech-to-text/job/v1/upload-files", { job_id: jobId, files: [audio.fileName] });
      const url: string = up.upload_urls[audio.fileName].file_url;
      await http(url, { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob", "content-type": audio.contentType }, body: new Uint8Array(audio.bytes), timeoutMs: 300_000 }, "Sarvam upload");
      await json(`/speech-to-text/job/v1/${jobId}/start`);
      return { ref: jobId };
    },
    async poll(job) {
      const status = await (await http(`${base}/speech-to-text/job/v1/${job.ref}/status`, { headers }, "Sarvam")).json();
      if (status.job_state === "Failed") throw new ProviderError(`Sarvam job failed: ${status.error_message || "unknown error"}`, false);
      if (status.job_state !== "Completed" && status.job_state !== "PartiallyCompleted") return { pending: true };
      const file = status.job_details?.[0]?.outputs?.[0]?.file_name;
      if (!file) throw new ProviderError(`Sarvam job produced no output: ${status.job_details?.[0]?.error_message ?? ""}`, false);
      const dl = await json("/speech-to-text/job/v1/download-files", { job_id: job.ref, files: [file] });
      const out = await (await http(dl.download_urls[file].file_url, {}, "Sarvam download")).json();
      return { done: parseSarvam(out) };
    },
  };
}

export function parseSarvam(out: {
  transcript?: string; language_code?: string;
  timestamps?: { chunks: string[]; start_time_seconds: number[]; end_time_seconds: number[] } | null;
  diarized_transcript?: { entries: { transcript: string; start_time_seconds: number; end_time_seconds: number; speaker_id: string }[] } | null;
}): AsrResult {
  let units: AsrUnit[] = [];
  if (out.diarized_transcript?.entries?.length) {
    units = out.diarized_transcript.entries.map((e) => ({ start: e.start_time_seconds, end: e.end_time_seconds, text: e.transcript, speaker: e.speaker_id }));
  } else if (out.timestamps?.chunks?.length) {
    units = out.timestamps.chunks.map((text, i) => ({ start: out.timestamps!.start_time_seconds[i], end: out.timestamps!.end_time_seconds[i], text }));
  } else if (out.transcript?.trim()) {
    units = [{ start: 0, end: 0, text: out.transcript }];
  }
  return { units: units.filter((u) => u.text.trim()), language: out.language_code };
}

/* ---------------- Deepgram (sync prerecorded API, word timestamps) ---------------- */

export function deepgramAsr(model: string, apiKey: string): Asr {
  const run = async (audio: { bytes: Buffer; contentType: string }, opts: AsrOptions): Promise<AsrResult> => {
    const q = new URLSearchParams({ model, smart_format: "true", punctuate: "true", utterances: "false" });
    const lang = opts.language?.includes("-") ? "multi" : opts.language ?? "multi";
    q.set("language", lang);
    if (opts.diarize) q.set("diarize", "true");
    for (const k of (opts.keyterms ?? []).slice(0, 100)) q.append(model.startsWith("nova-3") ? "keyterm" : "keywords", k);
    const res = await http(`https://api.deepgram.com/v1/listen?${q}`, { method: "POST", headers: { authorization: `Token ${apiKey}`, "content-type": audio.contentType }, body: new Uint8Array(audio.bytes), timeoutMs: 600_000 }, "Deepgram");
    const body = await res.json();
    const alt = body.results?.channels?.[0]?.alternatives?.[0];
    const words: { word: string; punctuated_word?: string; start: number; end: number; speaker?: number; language?: string }[] = alt?.words ?? [];
    return {
      units: words.map((w) => ({ start: w.start, end: w.end, text: w.punctuated_word ?? w.word, speaker: w.speaker == null ? undefined : String(w.speaker), lang: w.language })),
      durationSec: body.metadata?.duration,
    };
  };
  return {
    id: `deepgram:${model}`,
    supports: { keyterms: true, diarization: true },
    async submit(audio, opts) {
      return { done: await run(audio, opts) };
    },
    async poll() {
      throw new ProviderError("Deepgram is synchronous", false);
    },
  };
}

/* ---------------- OpenAI-compatible /audio/transcriptions ---------------- */

/** OpenAI (whisper-1, gpt-4o-transcribe-diarize) or any compatible endpoint (Groq, self-hosted faster-whisper). */
export function openaiAsr(id: string, model: string, opts: { apiKey: string; baseURL?: string }): Asr {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 2, timeout: 600_000 });
  const diarizing = model.includes("diarize");
  return {
    id,
    supports: { keyterms: false, diarization: diarizing },
    async submit(audio, o) {
      const file = await toFile(audio.bytes, audio.fileName, { type: audio.contentType });
      const language = o.language && !o.language.includes("-") ? o.language : undefined;
      try {
        if (diarizing) {
          const r = (await client.audio.transcriptions.create({ file, model, response_format: "diarized_json", chunking_strategy: "auto", ...(language ? { language } : {}) })) as unknown as OpenAI.Audio.TranscriptionDiarized;
          return { done: { units: r.segments.map((s) => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker })), durationSec: r.duration } };
        }
        const r = await client.audio.transcriptions.create({ file, model, response_format: "verbose_json", timestamp_granularities: ["word", "segment"], ...(language ? { language } : {}) });
        const units = r.words?.length
          ? r.words.map((w) => ({ start: w.start, end: w.end, text: w.word }))
          : (r.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text }));
        return { done: { units, language: r.language, durationSec: r.duration } };
      } catch (e) {
        if (e instanceof OpenAI.APIError) throw new ProviderError(`${id} ${e.status ?? "connection"}: ${e.message}`, !e.status || isRetryableStatus(e.status), e.status);
        throw e;
      }
    },
    async poll() {
      throw new ProviderError("OpenAI transcription is synchronous", false);
    },
  };
}
