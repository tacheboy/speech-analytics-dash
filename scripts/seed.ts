/**
 * Deterministic demo seed: Kaveri Finance (fictional NBFC) collections floors.
 * ~60 days of calls relative to "now", built from the authored call templates.
 * Usage: npm run db:seed
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { loadRubrics, loadTagDefs, loadTemplates, loadTimings } from "@/server/content";
import { mockAnalyzer } from "@/server/pipeline/mock-analyzer";
import { toRows } from "@/server/pipeline/persist";
import type { CallTemplate } from "@/lib/domain";

/* ---------- deterministic PRNG ---------- */
let s = 20261124;
const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const weighted = <T extends string>(w: Record<T, number>): T => {
  const total = Object.values<number>(w).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (const [k, v] of Object.entries(w) as [T, number][]) if ((r -= v) <= 0) return k;
  return Object.keys(w)[0] as T;
};

const ORG = "org_kaveri";
const TEAMS = [
  { id: "team_chennai", name: "Chennai Floor", language: "ta-en", agents: ["Karthik Subramanian", "Divya Ramesh", "Arun Prakash", "Meena Sundaram", "Vignesh Kumar", "Priya Natarajan"] },
  { id: "team_bengaluru", name: "Bengaluru Floor", language: "kn-en", agents: ["Raghavendra Rao", "Kavya Hegde", "Manjunath Gowda", "Shruti Kulkarni", "Naveen Shetty", "Ananya Bhat"] },
  { id: "team_delhi", name: "Delhi Floor", language: "hi-en", agents: ["Rahul Sharma", "Pooja Verma", "Amit Chauhan", "Sneha Malhotra", "Vikas Yadav", "Neha Gupta"] },
] as const;

/** Persona → probability of a good/average/poor call at time t (0 = 60 days ago, 1 = today). */
type Q = "good" | "average" | "poor";
const PERSONAS: Record<string, (t: number) => Record<Q, number>> = {
  top: () => ({ good: 0.78, average: 0.18, poor: 0.04 }),
  steady: () => ({ good: 0.45, average: 0.42, poor: 0.13 }),
  improving: (t) => ({ good: 0.12 + 0.55 * t, average: 0.43 - 0.05 * t, poor: 0.45 - 0.5 * t }),
  regressing: (t) => ({ good: 0.62 - 0.45 * t, average: 0.33, poor: 0.05 + 0.4 * t }),
  compliance: () => ({ good: 0.22, average: 0.33, poor: 0.45 }),
  newhire: (t) => ({ good: 0.2 + 0.15 * t, average: 0.5, poor: 0.3 - 0.15 * t }),
};
const PERSONA_ORDER = ["top", "steady", "improving", "regressing", "compliance", "newhire"];
const tagId = (slug: string) => `tag_${slug.replace(/[/-]/g, "_")}`;
const slug = (n: string) => n.toLowerCase().replace(/[^a-z]+/g, ".");
const pad = (n: number) => n.toString().padStart(5, "0");

async function main() {
  const rubrics = loadRubrics();
  const templates = loadTemplates();
  const timings = loadTimings();
  const playable = templates.filter((t) => timings[t.id]);
  if (!playable.length) throw new Error("No templates with audio — run `npm run audio:generate` first.");

  await db.execute(sql`TRUNCATE webhook_deliveries, webhooks, api_keys, call_tags, criterion_results, calls, tags, categories, users, teams, organizations CASCADE`);
  await db.insert(schema.organizations).values({ id: ORG, name: "Kaveri Finance" });
  await db.insert(schema.teams).values(TEAMS.map((t) => ({ id: t.id, orgId: ORG, name: t.name, language: t.language })));

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);
  const staff = [
    { id: "u_admin", name: "Ananya Iyer", role: "admin" as const, teamId: null },
    { id: "u_mgr_south", name: "Suresh Menon", role: "manager" as const, teamId: null },
    { id: "u_mgr_north", name: "Ritika Saxena", role: "manager" as const, teamId: null },
  ];
  const agents = TEAMS.flatMap((t) =>
    t.agents.map((name, i) => ({ id: `u_${slug(name).replace(/\./g, "_")}`, name, role: "agent" as const, teamId: t.id, language: t.language, persona: PERSONA_ORDER[i] })),
  );
  await db.insert(schema.users).values(
    [...staff, ...agents].map((u, i) => ({
      id: u.id, orgId: ORG, teamId: u.teamId, name: u.name, role: u.role,
      email: `${slug(u.name)}@kaverifinance.in`.replace(/\.@/, "@"),
      createdAt: daysAgo(u.role === "agent" && "persona" in u && u.persona === "newhire" ? 58 : 120 - i),
    })),
  );
  await db.insert(schema.categories).values(rubrics.map((r) => ({ id: r.id, orgId: ORG, name: r.name, description: r.description, icon: r.icon, rubric: r })));
  await db.insert(schema.tags).values(loadTagDefs().map((t) => ({ id: tagId(t.slug), orgId: ORG, slug: t.slug, displayName: t.displayName, description: t.description ?? null, assignable: t.assignable ?? false })));

  const rubricById = new Map(rubrics.map((r) => [r.id, r]));
  const byKey = new Map<string, CallTemplate[]>();
  for (const t of playable) {
    const k = `${t.categoryId}|${t.language}|${t.quality}`;
    byKey.set(k, [...(byKey.get(k) ?? []), t]);
  }
  const findTemplate = (cat: string, lang: string, q: Q) =>
    byKey.get(`${cat}|${lang}|${q}`) ??
    (["good", "average", "poor"] as Q[]).map((qq) => byKey.get(`${cat}|${lang}|${qq}`)).find(Boolean) ??
    playable.filter((t) => t.categoryId === cat);

  const callRows: (typeof schema.calls.$inferInsert)[] = [];
  const crRows: (typeof schema.criterionResults.$inferInsert)[] = [];
  const tagRows: { callId: string; tagId: string; source: "rule" | "manual" }[] = [];
  let n = 0;

  for (let d = 59; d >= 0; d--) {
    const day = daysAgo(d);
    if (day.getDay() === 0) continue; // collections floors work Mon–Sat
    const t = (59 - d) / 59;
    for (const a of agents) {
      if (a.persona === "newhire" && d > 55) continue;
      const count = Math.floor(rand() * 3) + (rand() < 0.4 ? 1 : 0); // 0–3 analysed calls per agent-day
      for (let k = 0; k < count; k++) {
        const cat = weighted({ "early-bucket": 0.5, "mid-bucket": 0.35, settlement: 0.15 });
        let candidates = findTemplate(cat, a.language, weighted(PERSONAS[a.persona](t)));
        if (cat === "early-bucket" && a.language === "kn-en" && rand() < 0.06) candidates = playable.filter((x) => x.id === "eb-kn-wrongparty");
        if (!candidates?.length) continue;
        const tpl = pick(candidates);
        const rubric = rubricById.get(tpl.categoryId)!;
        const callAt = new Date(day);
        callAt.setHours(9, 30, 0, 0);
        callAt.setMinutes(callAt.getMinutes() + Math.floor(rand() * 560)); // 09:30–18:50
        if (callAt > now) callAt.setTime(now.getTime() - Math.floor(rand() * 3600_000));
        const id = `call_${pad(++n)}`;
        const analysis = mockAnalyzer.analyze({ rubric, templateId: tpl.id });
        const { callPatch, criterionRows, tagSlugs } = toRows(id, rubric, analysis);
        const fromApi = rand() < 0.7;
        callRows.push({
          id, orgId: ORG, categoryId: tpl.categoryId, agentId: a.id,
          uploadedBy: fromApi ? null : a.language === "hi-en" ? "u_mgr_north" : "u_mgr_south",
          audioUrl: `/audio/${tpl.id}.m4a`, callAt, createdAt: callAt, readyAt: callAt, completedAt: new Date(callAt.getTime() + 90_000), language: tpl.language, templateId: tpl.id,
          udfs: { loanId: `KF-${(100000 + Math.floor(rand() * 899999)).toString()}`, dpd: tpl.categoryId === "early-bucket" ? 1 + Math.floor(rand() * 30) : 31 + Math.floor(rand() * 60) },
          ...callPatch,
        });
        crRows.push(...criterionRows);
        // tags are applied by the category's rules; managers add a few by hand
        for (const slug of tagSlugs) tagRows.push({ callId: id, tagId: tagId(slug), source: "rule" });
        if ((callPatch.score ?? 0) >= 95 && rand() < 0.08) tagRows.push({ callId: id, tagId: tagId("coaching/example"), source: "manual" });
        if (callPatch.complianceFlag && rand() < 0.25) tagRows.push({ callId: id, tagId: tagId("coaching/escalate"), source: "manual" });
      }
    }
  }
  // a few recent ingestion failures, as a real dialer feed would have
  for (const a of agents.slice(0, 3)) {
    callRows.push({
      id: `call_${pad(++n)}`, orgId: ORG, categoryId: "early-bucket", agentId: a.id, status: "failed",
      failureReason: "Recording is empty or corrupted (0 bytes received from dialer)", durationSec: 0,
      callAt: daysAgo(Math.floor(rand() * 5)), language: a.language, readyAt: now, completedAt: now,
    });
  }
  // a sample of manager-reviewed calls with notes
  for (const c of callRows.filter((c) => c.status === "done" && (c.score ?? 100) < 50).slice(0, 25)) {
    c.reviewedBy = c.language === "hi-en" ? "u_mgr_north" : "u_mgr_south";
    c.reviewedAt = new Date(c.callAt.getTime() + 86400_000);
    c.reviewNote = "Reviewed in weekly QA. Discussed RBI fair-practice script and PTP recap in 1:1.";
  }

  const dedupTags = [...new Map(tagRows.map((r) => [`${r.callId}|${r.tagId}`, r])).values()];
  for (let i = 0; i < callRows.length; i += 500) await db.insert(schema.calls).values(callRows.slice(i, i + 500));
  for (let i = 0; i < crRows.length; i += 2000) await db.insert(schema.criterionResults).values(crRows.slice(i, i + 2000));
  if (dedupTags.length) await db.insert(schema.callTags).values(dedupTags);

  console.log(`✓ seeded ${callRows.length} calls, ${crRows.length} criterion results, ${agents.length} agents, ${playable.length} templates`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
