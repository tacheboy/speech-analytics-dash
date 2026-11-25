/**
 * List prices, editable data. LLM: USD per million tokens. ASR: USD per audio minute.
 * A model without an entry still records usage; its cost is stored as null ("unknown"), never guessed.
 * Sources: Claude price list (Nov 2026); Sarvam ₹0.41–0.49/min at ₹85/$; Deepgram and OpenAI list prices.
 */
type LlmPrice = { input: number; cachedInput: number; output: number };

export const LLM_PRICES: Record<string, LlmPrice> = {
  "anthropic:claude-opus-5-5": { input: 4, cachedInput: 0.2, output: 20 },
  "anthropic:claude-sonnet-5-5": { input: 2, cachedInput: 0.1, output: 10 },
  "anthropic:claude-haiku-5-5": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "mock:replay": { input: 0, cachedInput: 0, output: 0 },
};

export const ASR_PRICES_PER_MIN: Record<string, number> = {
  "sarvam:saaras:v4": 0.0053,
  "deepgram:nova-3": 0.0043,
  "openai:whisper-1": 0.006,
  "mock:replay": 0,
};

/** Micro-dollars, or null when the model isn't priced. */
export function llmCostMicros(model: string, u: { input: number; cachedInput: number; output: number }) {
  const p = LLM_PRICES[model];
  if (!p) return null;
  return Math.round(u.input * p.input + u.cachedInput * p.cachedInput + u.output * p.output); // tokens × $/M = µ$
}

export function asrCostMicros(model: string, seconds: number) {
  const p = ASR_PRICES_PER_MIN[model];
  return p == null ? null : Math.round((seconds / 60) * p * 1e6);
}
