/**
 * The two provider interfaces. Stages ask the registry for "the LLM" or "the ASR" and never name a vendor.
 * Adding a provider = one file implementing one of these + a line in registry.ts.
 */

export type JsonSchema = Record<string, unknown>;
export type Usage = { input: number; cachedInput: number; output: number };

export interface Llm {
  id: string; // "anthropic:claude-opus-5-5"
  supports: { strictJson: boolean; batch: boolean };
  /** One structured generation. `system` is the stable, cache-friendly prefix; `input` varies per call. */
  generate(req: { system: string; input: string; schema: JsonSchema; schemaName: string; maxOutputTokens: number; signal?: AbortSignal }): Promise<{ json: unknown; usage: Usage }>;
}

/** A timed piece of transcript: a word, a chunk or a diarized turn, depending on the provider. */
export type AsrUnit = { start: number; end: number; text: string; speaker?: string; lang?: string };

export type AsrResult = {
  units: AsrUnit[];
  /** Only the mock provider returns ready-made, speaker-attributed segments. */
  segments?: import("@/lib/domain").TranscriptSegment[];
  language?: string;
  durationSec?: number;
};

export type AsrJob = { ref: string; data?: Record<string, unknown> };

export interface Asr {
  id: string; // "sarvam:saaras:v4"
  supports: { keyterms: boolean; diarization: boolean };
  /** Starts transcription. Sync providers may finish here and return the result directly. */
  submit(audio: { bytes: Buffer; contentType: string; fileName: string }, opts: AsrOptions): Promise<AsrJob | { done: AsrResult }>;
  /** Polls an async job. */
  poll(job: AsrJob, opts: AsrOptions): Promise<{ pending: true } | { done: AsrResult }>;
}

export type AsrOptions = {
  language?: string | null; // hint like "ta-en" or "hi"
  keyterms?: string[];
  diarize: boolean; // mono audio: ask the provider who spoke when
  /** Mock provider only: which bundled script to replay. */
  mock?: { sampleId?: string | null; categoryId: string; seed: string };
};

/** A provider error the stage may retry (5xx, timeouts, rate limits) vs one it must not (bad key, bad request). */
export class ProviderError extends Error {
  constructor(message: string, public retryable: boolean, public status?: number) {
    super(message);
  }
}

export const isRetryableStatus = (s: number) => s === 408 || s === 409 || s === 425 || s === 429 || s >= 500;
