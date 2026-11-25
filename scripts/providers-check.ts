/**
 * `npm run providers:check`: sends one tiny request to every configured provider and reports
 * latency or the error. Run it right after adding a key to .env.
 */
import "dotenv/config";
import { providers } from "@/server/pipeline/providers/registry";
import type { Asr, Llm } from "@/server/pipeline/providers/types";
import { asrAudio } from "@/server/pipeline/audio";
import fs from "node:fs";

const schema = { type: "object", additionalProperties: false, required: ["ok", "language"], properties: { ok: { type: "boolean" }, language: { type: "string" } } };

async function checkLlm(llm: Llm) {
  const t = Date.now();
  const r = await llm.generate({ system: "You check connectivity. Answer with the JSON requested.", input: "Reply with ok=true and the language of: 'Namaste, aap kaise hain?'", schema, schemaName: "check", maxOutputTokens: 2000 });
  return `${Date.now() - t} ms · ${JSON.stringify(r.json)} · ${r.usage.input}+${r.usage.cachedInput} in / ${r.usage.output} out tokens`;
}

async function checkAsr(asr: Asr) {
  const t = Date.now();
  const sample = await asrAudio(fs.readFileSync("public/audio/eb-hi-good.m4a"));
  const opts = { language: "hi-en", diarize: true, mock: { sampleId: "eb-hi-good", categoryId: "early-bucket", seed: "check" } };
  let r = await asr.submit({ bytes: sample, contentType: "audio/mpeg", fileName: "check.mp3" }, opts);
  for (let i = 0; !("done" in r) && i < 60; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    const p = await asr.poll(r, opts);
    if ("done" in p) r = p;
  }
  if (!("done" in r)) throw new Error("still running after 5 minutes");
  const text = r.done.units.map((u) => u.text).join(" ");
  return `${Date.now() - t} ms · ${r.done.units.length} units · "${text.slice(0, 80)}…"`;
}

async function main() {
  const p = providers();
  const rows: [string, string, () => Promise<string>][] = [
    ["LLM", p.llm.id, () => checkLlm(p.llm)],
    ...(p.llmFallback ? [["LLM fallback", p.llmFallback.id, () => checkLlm(p.llmFallback!)] as [string, string, () => Promise<string>]] : []),
    ["ASR", p.asr.id, () => checkAsr(p.asr)],
    ...(p.asrFallback ? [["ASR fallback", p.asrFallback.id, () => checkAsr(p.asrFallback!)] as [string, string, () => Promise<string>]] : []),
  ];
  let failed = 0;
  for (const [kind, id, run] of rows) {
    try {
      console.log(`✓ ${kind.padEnd(12)} ${id.padEnd(32)} ${await run()}`);
    } catch (e) {
      failed++;
      console.log(`✗ ${kind.padEnd(12)} ${id.padEnd(32)} ${(e as Error).message}`);
    }
  }
  if (p.llm.id.startsWith("mock:") || p.asr.id.startsWith("mock:")) console.log("\nMock providers are in use. Set keys in .env (see .env.example) for real transcription and scoring.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
