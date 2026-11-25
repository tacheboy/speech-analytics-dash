import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type Llm } from "./types";

/**
 * Claude via the official SDK. Strict structured output (`output_config.format`), and the stable
 * system prefix (instructions + rubric) is marked for prompt caching so every conversation of a
 * category reuses it.
 */
export function anthropicLlm(model: string, apiKey: string): Llm {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 240_000 });
  const effort = process.env.LLM_EFFORT as "low" | "medium" | "high" | undefined;
  return {
    id: `anthropic:${model}`,
    supports: { strictJson: true, batch: true },
    async generate({ system, input, schema, maxOutputTokens, signal }) {
      try {
        const res = await client.messages.create(
          {
            model,
            max_tokens: maxOutputTokens,
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: input }],
            output_config: { format: { type: "json_schema", schema }, ...(effort ? { effort } : {}) },
          },
          { signal },
        );
        if (res.stop_reason === "refusal") throw new ProviderError("The model declined to analyse this conversation", false);
        if (res.stop_reason === "max_tokens") throw new ProviderError(`Output hit max_tokens (${maxOutputTokens})`, true);
        const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        const u = res.usage;
        return {
          json: JSON.parse(text),
          usage: { input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cachedInput: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 },
        };
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        if (e instanceof Anthropic.APIError) {
          const status = e.status ?? 0;
          const retryable = e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError || status === 529 || status >= 500;
          throw new ProviderError(`Anthropic ${status || "connection"}: ${e.message}`, retryable, status);
        }
        if (e instanceof SyntaxError) throw new ProviderError("Model returned invalid JSON", true);
        throw e;
      }
    },
  };
}
