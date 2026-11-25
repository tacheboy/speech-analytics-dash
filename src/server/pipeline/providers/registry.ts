import { deepgramAsr, openaiAsr, sarvamAsr } from "./asr";
import { anthropicLlm } from "./llm-anthropic";
import { openaiLlm } from "./llm-openai";
import { mockAsr, mockLlm } from "./mock";
import type { Asr, Llm } from "./types";

/**
 * The only place that reads provider env vars. Setting a key makes a provider available;
 * LLM_MODEL / ASR_MODEL ("provider:model") pick one, with optional *_FALLBACK.
 *   1. explicit *_MODEL → used; a missing key fails loudly at startup
 *   2. unset → the first configured provider's recommended model
 *   3. nothing configured → mock (the app always runs)
 */
const env = (k: string) => process.env[k]?.trim() || undefined;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/";

type Spec = { provider: string; model: string };
const parse = (s: string): Spec => {
  const i = s.indexOf(":");
  if (i < 1) throw new ConfigError(`"${s}" should look like provider:model (e.g. anthropic:claude-opus-5-5)`);
  return { provider: s.slice(0, i), model: s.slice(i + 1) };
};

export class ConfigError extends Error {}

const LLM_PROVIDERS: Record<string, { key: string; recommended?: string; make: (model: string) => Llm }> = {
  anthropic: { key: "ANTHROPIC_API_KEY", recommended: "claude-opus-5-5", make: (m) => anthropicLlm(m, env("ANTHROPIC_API_KEY")!) },
  openai: { key: "OPENAI_API_KEY", make: (m) => openaiLlm(`openai:${m}`, m, { apiKey: env("OPENAI_API_KEY")! }) },
  gemini: { key: "GEMINI_API_KEY", make: (m) => openaiLlm(`gemini:${m}`, m, { apiKey: env("GEMINI_API_KEY")!, baseURL: GEMINI_BASE }) },
  compat: { key: "OPENAI_COMPAT_BASE_URL", make: (m) => openaiLlm(`compat:${m}`, m, { apiKey: env("OPENAI_COMPAT_API_KEY") ?? "none", baseURL: env("OPENAI_COMPAT_BASE_URL") }) },
  mock: { key: "", recommended: "replay", make: () => mockLlm },
};

const ASR_PROVIDERS: Record<string, { key: string; recommended?: string; make: (model: string) => Asr }> = {
  sarvam: { key: "SARVAM_API_KEY", recommended: "saaras:v4", make: (m) => sarvamAsr(m, env("SARVAM_API_KEY")!) },
  deepgram: { key: "DEEPGRAM_API_KEY", recommended: "nova-3", make: (m) => deepgramAsr(m, env("DEEPGRAM_API_KEY")!) },
  openai: { key: "OPENAI_API_KEY", recommended: "whisper-1", make: (m) => openaiAsr(`openai:${m}`, m, { apiKey: env("OPENAI_API_KEY")! }) },
  compat: { key: "OPENAI_COMPAT_BASE_URL", make: (m) => openaiAsr(`compat:${m}`, m, { apiKey: env("OPENAI_COMPAT_API_KEY") ?? "none", baseURL: env("OPENAI_COMPAT_BASE_URL") }) },
  mock: { key: "", recommended: "replay", make: () => mockAsr },
};

function resolve<T>(kind: "LLM" | "ASR", table: Record<string, { key: string; recommended?: string; make: (m: string) => T }>, value: string | undefined): { id: string; make: () => T } {
  if (value) {
    const { provider, model } = parse(value);
    const p = table[provider];
    if (!p) throw new ConfigError(`${kind}_MODEL: unknown provider "${provider}" (one of ${Object.keys(table).join(", ")})`);
    if (p.key && !env(p.key)) throw new ConfigError(`${kind}_MODEL=${value} needs ${p.key} in .env`);
    return { id: `${provider}:${model}`, make: () => p.make(model) };
  }
  for (const [provider, p] of Object.entries(table)) {
    if (provider === "mock" || !p.key || !env(p.key)) continue;
    if (!p.recommended) throw new ConfigError(`${p.key} is set: also set ${kind}_MODEL=${provider}:<model>`);
    return { id: `${provider}:${p.recommended}`, make: () => p.make(p.recommended!) };
  }
  return { id: "mock:replay", make: () => table.mock.make("replay") };
}

type Resolved = { llm: Llm; llmFallback: Llm | null; asr: Asr; asrFallback: Asr | null };
let resolved: Resolved | null = null;

export function providers(): Resolved {
  if (resolved) return resolved;
  const llm = resolve("LLM", LLM_PROVIDERS, env("LLM_MODEL"));
  const asr = resolve("ASR", ASR_PROVIDERS, env("ASR_MODEL"));
  const llmFb = env("LLM_FALLBACK") ? resolve("LLM", LLM_PROVIDERS, env("LLM_FALLBACK")) : null;
  const asrFb = env("ASR_FALLBACK") ? resolve("ASR", ASR_PROVIDERS, env("ASR_FALLBACK")) : null;
  resolved = { llm: llm.make(), llmFallback: llmFb?.make() ?? null, asr: asr.make(), asrFallback: asrFb?.make() ?? null };
  return resolved;
}

/** Build a specific LLM by id, e.g. for the eval harness comparing models. */
export const llmById = (id: string) => resolve("LLM", LLM_PROVIDERS, id).make();

/** What the Settings page and /api/health show: resolved models and which keys are present (never the keys). */
export function providerStatus() {
  let error: string | null = null;
  let p: Resolved | null = null;
  try {
    p = providers();
  } catch (e) {
    error = (e as Error).message;
  }
  const keys = [...new Set([...Object.values(LLM_PROVIDERS), ...Object.values(ASR_PROVIDERS)].map((x) => x.key).filter(Boolean))];
  return {
    llm: p?.llm.id ?? null,
    llmFallback: p?.llmFallback?.id ?? null,
    asr: p?.asr.id ?? null,
    asrFallback: p?.asrFallback?.id ?? null,
    mock: Boolean(p && (p.llm.id.startsWith("mock:") || p.asr.id.startsWith("mock:"))),
    keys: Object.fromEntries(keys.map((k) => [k, Boolean(env(k))])),
    error,
  };
}

/** Tests only. */
export const resetProviders = () => {
  resolved = null;
};
