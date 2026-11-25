/**
 * Load test through the public API: submits N demo recordings at a fixed rate, waits for all of them,
 * and reports throughput and end-to-end latency (created → completed). Mock providers by default.
 *
 *   npm run loadtest -- --n 500 --rate 5 --base http://localhost:3000
 */
import "dotenv/config";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { n: { type: "string", default: "200" }, rate: { type: "string", default: "5" }, base: { type: "string", default: "http://localhost:3000" }, key: { type: "string" } } });
const N = Number(values.n), RATE = Number(values.rate);
const KEY = values.key ?? process.env.DEMO_API_KEY;
const H = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const SAMPLES = ["eb-hi-good", "eb-hi-average", "eb-hi-poor", "eb-ta-good", "eb-kn-good"];
const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${values.base}/api/v1${path}`, { ...init, headers: H });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

async function main() {
  const run = `LT-${Date.now()}`;
  const ids: string[] = [];
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const due = t0 + (i * 1000) / RATE;
    if (due > Date.now()) await new Promise((r) => setTimeout(r, due - Date.now()));
    const c = await api("/conversations", { method: "POST", body: JSON.stringify({ externalId: `${run}-${i}`, categoryId: "early-bucket", sampleId: SAMPLES[i % SAMPLES.length], person: { externalId: "AGT-113" }, metadata: { loadtest: run } }) });
    ids.push(c.id);
  }
  const submitted = (Date.now() - t0) / 1000;
  console.log(`submitted ${N} in ${submitted.toFixed(1)} s (${(N / submitted).toFixed(1)}/s)`);
  // poll the way an integrator should: the sync endpoint, not one GET per conversation
  const mine = new Set(ids);
  const done = new Map<string, { status: string; ms: number }>();
  const since = new Date(t0 - 1000).toISOString();
  while (done.size < N) {
    await new Promise((r) => setTimeout(r, 3000));
    let cursor: string | null = null;
    do {
      const page: { data: { id: string; status: string; createdAt: string; completedAt: string | null; updatedAt: string }[]; nextCursor: string | null } =
        await api(`/conversations?updatedSince=${encodeURIComponent(since)}&limit=200${cursor ? `&cursor=${cursor}` : ""}`);
      for (const c of page.data) {
        if (mine.has(c.id) && c.status !== "queued" && c.status !== "processing") done.set(c.id, { status: c.status, ms: new Date(c.completedAt ?? c.updatedAt).getTime() - new Date(c.createdAt).getTime() });
      }
      cursor = page.nextCursor;
    } while (cursor);
    process.stdout.write(`\r${done.size}/${N} settled`);
  }
  const total = (Date.now() - t0) / 1000;
  const lat = [...done.values()].map((d) => d.ms / 1000);
  const failed = [...done.values()].filter((d) => d.status !== "completed").length;
  console.log(`\nthroughput ${(N / total).toFixed(2)} conversations/s · latency p50 ${q(lat, 0.5).toFixed(1)} s · p95 ${q(lat, 0.95).toFixed(1)} s · max ${Math.max(...lat).toFixed(1)} s · failed ${failed}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
