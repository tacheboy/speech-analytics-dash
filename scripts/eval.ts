/**
 * Evaluation harness: scores golden conversations with one or more models and compares against
 * human labels. This is how the default LLM_MODEL is chosen and how prompt/model changes are gated.
 *
 *   npm run eval                                   # G1 (28 scripted conversations), the configured LLM
 *   npm run eval -- --llm anthropic:claude-sonnet-5-5 --llm openai:<model>   # side by side
 *   npm run eval -- --set g2 --asr sarvam:saaras:v4   # real recordings in eval/g2 (see eval/README.md)
 *   npm run eval -- --gate                         # exit 1 if any §1 accuracy gate fails (CI)
 *
 * Writes eval/runs/<timestamp>.json and prints a markdown table.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Rubric, TranscriptSegment } from "@/lib/domain";
import { loadRubrics } from "@/server/content";
import { attributeByDiarization, attributeByEnergy, toSegments } from "@/server/pipeline/attribute";
import { asrAudio, channelEnergy, probe } from "@/server/pipeline/audio";
import { llmCostMicros } from "@/server/pipeline/providers/prices";
import { content, templateAnalysis, templateSegments } from "@/server/pipeline/providers/mock";
import { llmById, providers } from "@/server/pipeline/providers/registry";
import type { Asr } from "@/server/pipeline/providers/types";
import { runLlm } from "@/server/pipeline/stages/analyze";
import { finalizeAnalysis } from "@/server/pipeline/stages/finalize";

type Labels = { criteria: Record<string, "yes" | "no" | "na">; outcomeId: string; extractions: Record<string, unknown> };
type Case = { id: string; rubric: Rubric; transcript?: TranscriptSegment[]; audio?: string; channels?: "left" | "right" | "mono"; language?: string; labels: Labels; durationSec: number };

const GATES = { criterionAgreement: 85, minCriterion: 70, outcome: 90, extraction: 90, evidence: 95 };
const USD_INR = Number(process.env.USD_INR ?? 85);
const toYesNo = (r: string) => (r === "pass" ? "yes" : r === "fail" ? "no" : "na");

function g1(rubrics: Map<string, Rubric>): Case[] {
  const { templates, timings } = content();
  return [...templates.values()].filter((t) => timings[t.id]).map((t) => {
    const rubric = rubrics.get(t.categoryId)!;
    const transcript = templateSegments(t);
    // labels = the authored analysis after the same rule pass the pipeline applies
    const f = finalizeAnalysis(rubric, templateAnalysis(t, rubric.sections.flatMap((s) => s.criteria.map((c) => c.id)), rubric.outcomes.map((o) => o.id), rubric.extractionFields.map((x) => x.fieldName)), transcript, timings[t.id].duration);
    return { id: t.id, rubric, transcript, language: t.language, durationSec: timings[t.id].duration, labels: { criteria: Object.fromEntries(f.criteria.map((c) => [c.criterionId, toYesNo(c.result)])), outcomeId: f.outcome.id, extractions: f.extractions } };
  });
}

function g2(rubrics: Map<string, Rubric>): Case[] {
  const dir = path.join("eval", "g2");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
    const c = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    return { ...c, id: c.id ?? f.replace(/\.json$/, ""), rubric: rubrics.get(c.categoryId)!, audio: c.audio ? path.join(dir, c.audio) : undefined, durationSec: c.durationSec ?? 0 };
  });
}

async function transcribe(asr: Asr, c: Case): Promise<TranscriptSegment[]> {
  const original = fs.readFileSync(c.audio!);
  const info = await probe(original);
  c.durationSec = info?.durationSec ?? 0;
  const opts = { language: c.language, diarize: true };
  let r = await asr.submit({ bytes: await asrAudio(original), contentType: "audio/mpeg", fileName: `${c.id}.mp3` }, opts);
  while (!("done" in r)) {
    await new Promise((res) => setTimeout(res, 5000));
    const p = await asr.poll(r, opts);
    if ("done" in p) r = p;
  }
  const units = r.done.units;
  const stereo = (info?.channels ?? 1) >= 2 && c.channels !== "mono";
  const speakers = stereo ? attributeByEnergy(units, await channelEnergy(original), c.channels === "right" ? "right" : "left") : attributeByDiarization(units);
  return r.done.segments ?? toSegments(units, speakers, c.language);
}

const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);
const p95 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] : 0);

async function evaluate(modelId: string, cases: Case[], asr: Asr | null, concurrency: number) {
  const llm = modelId === "configured" ? providers().llm : llmById(modelId);
  const perCriterion = new Map<string, { n: number; ok: number }>();
  let crit = 0, critOk = 0, outOk = 0, outN = 0, extN = 0, extOk = 0, evN = 0, evOk = 0, repaired = 0, errors = 0, cost = 0, costKnown = true;
  const latency: number[] = [];
  const failures: string[] = [];
  const queue = [...cases];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        const transcript = c.transcript ?? (asr ? await transcribe(asr, c) : null);
        if (!transcript) throw new Error("no transcript and no --asr given");
        const t0 = Date.now();
        const r = await runLlm(c.rubric, transcript, { language: c.language, allowFallback: false, llm });
        latency.push(Date.now() - t0);
        if (r.repaired) repaired++;
        const usd = llmCostMicros(r.model, r.usage);
        if (usd == null) costKnown = false; else cost += usd / 1e6;
        const f = finalizeAnalysis(c.rubric, r.analysis, transcript, c.durationSec);
        outN++;
        if (f.outcome.id === c.labels.outcomeId) outOk++;
        else failures.push(`${c.id}: outcome ${f.outcome.id} ≠ ${c.labels.outcomeId}`);
        for (const x of f.criteria) {
          const want = c.labels.criteria[x.criterionId];
          if (!want) continue;
          const got = toYesNo(x.result);
          const e = perCriterion.get(x.criterionId) ?? { n: 0, ok: 0 };
          e.n++; crit++;
          if (got === want) { e.ok++; critOk++; } else failures.push(`${c.id}: ${x.criterionId} ${got} ≠ ${want}`);
          perCriterion.set(x.criterionId, e);
          if (x.result !== "na" && x.source === "ai") { evN++; if (x.evidenceVerified) evOk++; }
        }
        for (const field of c.rubric.extractionFields.filter((x) => x.fieldType !== "text")) {
          extN++;
          if (String(f.extractions[field.fieldName] ?? null) === String(c.labels.extractions[field.fieldName] ?? null)) extOk++;
        }
      } catch (e) {
        errors++;
        failures.push(`${c.id}: error ${(e as Error).message}`);
      }
    }
  }));
  const minCriterion = Math.min(...[...perCriterion.values()].filter((v) => v.n >= 3).map((v) => (100 * v.ok) / v.n), 100);
  const m = {
    model: llm.id, cases: cases.length, errors,
    criterionAgreement: pct(critOk, crit), minCriterion: Math.round(minCriterion * 10) / 10,
    outcome: pct(outOk, outN), extraction: pct(extOk, extN), evidence: pct(evOk, evN),
    repairRate: pct(repaired, outN), p95LatencyMs: p95(latency),
    costPerConversationInr: costKnown && outN ? Math.round((cost / outN) * USD_INR * 100) / 100 : null,
  };
  const gates = {
    criterionAgreement: (m.criterionAgreement ?? 0) >= GATES.criterionAgreement, minCriterion: m.minCriterion >= GATES.minCriterion,
    outcome: (m.outcome ?? 0) >= GATES.outcome, extraction: (m.extraction ?? 0) >= GATES.extraction, evidence: (m.evidence ?? 0) >= GATES.evidence,
  };
  return { ...m, pass: Object.values(gates).every(Boolean) && !errors, gates, worstCriteria: [...perCriterion.entries()].map(([id, v]) => ({ id, agreement: pct(v.ok, v.n), n: v.n })).sort((a, b) => (a.agreement ?? 0) - (b.agreement ?? 0)).slice(0, 5), failures: failures.slice(0, 50) };
}

async function main() {
  const { values } = parseArgs({ options: { llm: { type: "string", multiple: true }, set: { type: "string", default: "g1" }, asr: { type: "string" }, limit: { type: "string" }, concurrency: { type: "string", default: "4" }, gate: { type: "boolean", default: false } } });
  const rubrics = new Map(loadRubrics().map((r) => [r.id, r]));
  let cases = values.set === "g2" ? g2(rubrics) : g1(rubrics);
  if (values.limit) cases = cases.slice(0, Number(values.limit));
  if (!cases.length) throw new Error(values.set === "g2" ? "eval/g2 has no cases yet: see eval/README.md" : "no cases");
  const asr = values.asr ? (await import("@/server/pipeline/providers/registry")).providers().asr : null;
  if (values.asr && asr?.id !== values.asr) console.warn(`note: transcribing with the configured ASR (${asr?.id}); set ASR_MODEL=${values.asr} to change it`);

  const results = [];
  for (const id of values.llm?.length ? values.llm : ["configured"]) {
    process.stdout.write(`evaluating ${id} on ${values.set} (${cases.length} conversations)… `);
    const r = await evaluate(id, cases, asr, Number(values.concurrency));
    console.log(r.pass ? "PASS" : "FAIL");
    results.push(r);
  }
  const g = (ok: boolean, v: unknown) => `${v ?? "—"}${ok ? "" : " ✗"}`;
  console.log(`\n| model | criteria % (≥${GATES.criterionAgreement}) | worst criterion % (≥${GATES.minCriterion}) | outcome % (≥${GATES.outcome}) | extraction % (≥${GATES.extraction}) | evidence % (≥${GATES.evidence}) | repair % | p95 ms | ₹/conv |`);
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of results) console.log(`| ${r.model} | ${g(r.gates.criterionAgreement, r.criterionAgreement)} | ${g(r.gates.minCriterion, r.minCriterion)} | ${g(r.gates.outcome, r.outcome)} | ${g(r.gates.extraction, r.extraction)} | ${g(r.gates.evidence, r.evidence)} | ${r.repairRate} | ${r.p95LatencyMs} | ${r.costPerConversationInr ?? "unpriced"} |`);
  fs.mkdirSync("eval/runs", { recursive: true });
  const file = path.join("eval/runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${values.set}.json`);
  fs.writeFileSync(file, JSON.stringify({ set: values.set, at: new Date().toISOString(), gates: GATES, results }, null, 2));
  console.log(`\nfull report (with per-case failures): ${file}`);
  process.exit(values.gate && results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
