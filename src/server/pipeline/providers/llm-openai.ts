import OpenAI from "openai";
import { ProviderError, type Llm } from "./types";

/**
 * Any OpenAI-compatible chat endpoint: OpenAI, Gemini (Google's OpenAI-compatible endpoint), Azure OpenAI,
 * OpenRouter, Groq, Together, Fireworks, vLLM, Ollama…
 * Tries strict `json_schema`; endpoints that reject it fall back to JSON mode (validated by our zod
 * schema and repaired once by the analyze stage). The fallback is remembered per adapter instance.
 */
export function openaiLlm(id: string, model: string, opts: { apiKey: string; baseURL?: string }): Llm {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 2, timeout: 240_000 });
  let strict = process.env.OPENAI_COMPAT_JSON_MODE !== "json_object" || !id.startsWith("compat:");
  return {
    id,
    get supports() {
      return { strictJson: strict, batch: id.startsWith("openai:") };
    },
    async generate({ system, input, schema, schemaName, maxOutputTokens, signal }) {
      const call = (useStrict: boolean) =>
        client.chat.completions.create(
          {
            model,
            max_completion_tokens: maxOutputTokens,
            messages: [
              { role: "system", content: useStrict ? system : `${system}\n\nRespond with a single JSON object that matches this JSON schema exactly:\n${JSON.stringify(schema)}` },
              { role: "user", content: input },
            ],
            response_format: useStrict ? { type: "json_schema", json_schema: { name: schemaName, schema, strict: true } } : { type: "json_object" },
          },
          { signal },
        );
      try {
        let res;
        try {
          res = await call(strict);
        } catch (e) {
          // endpoints without strict structured output answer 400 on response_format: downgrade once
          if (strict && e instanceof OpenAI.BadRequestError && /response_format|json_schema|schema/i.test(e.message)) {
            strict = false;
            res = await call(false);
          } else throw e;
        }
        const choice = res.choices[0];
        if (!choice?.message?.content) throw new ProviderError(choice?.finish_reason === "content_filter" ? "The model declined to analyse this conversation" : "Empty response", choice?.finish_reason !== "content_filter");
        if (choice.finish_reason === "length") throw new ProviderError(`Output hit max tokens (${maxOutputTokens})`, true);
        const u = res.usage;
        const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
        return {
          json: JSON.parse(choice.message.content.replace(/^```(?:json)?\s*|\s*```$/g, "")),
          usage: { input: (u?.prompt_tokens ?? 0) - cached, cachedInput: cached, output: u?.completion_tokens ?? 0 },
        };
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        if (e instanceof OpenAI.APIError) {
          const status = e.status ?? 0;
          throw new ProviderError(`${id.split(":")[0]} ${status || "connection"}: ${e.message}`, !status || status === 429 || status >= 500, status);
        }
        if (e instanceof SyntaxError) throw new ProviderError("Model returned invalid JSON", true);
        throw e;
      }
    },
  };
}
