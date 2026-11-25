import { and, eq, gte, inArray, isNull, lte, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { ApiError, type Actor } from "@/server/auth";
import { successRate } from "@/server/scoring";
import { dashboardQuery } from "@/lib/contracts";
import { DURATION_BUCKETS, outcomeType, type OutcomeType } from "@/lib/domain";

const { conversations: calls, users, cohorts: teams, categories, criterionResults, conversationTags: callTags, tags } = schema;
const DAY = 86400_000;
const IST = 5.5 * 3600_000;
const istDay = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
const pct = (x: number | null) => (x == null ? null : Math.round(x * 1000) / 10);

type Row = {
  id: string; agentId: string; agentName: string; teamId: string | null; categoryId: string;
  score: number | null; isSuccess: boolean | null; isNotApplicable: boolean | null; complianceFlag: boolean | null;
  outcomeId: string | null; durationSec: number; callAt: Date; extractions: Record<string, unknown> | null;
};

async function loadRows(orgId: string, filters: SQL[], from: Date, to: Date): Promise<Row[]> {
  return db
    .select({
      id: calls.id, agentId: calls.personId, agentName: users.name, teamId: users.cohortId, categoryId: calls.categoryId,
      score: calls.score, isSuccess: calls.isSuccess, isNotApplicable: calls.isNotApplicable, complianceFlag: calls.riskFlag,
      outcomeId: calls.outcomeId, durationSec: calls.durationSec, callAt: calls.occurredAt, extractions: calls.extractions,
    })
    .from(calls)
    .innerJoin(users, eq(users.id, calls.personId))
    .where(and(eq(calls.orgId, orgId), eq(calls.status, "completed"), isNull(calls.deletedAt), gte(calls.occurredAt, from), lte(calls.occurredAt, to), ...filters));
}

function kpis(rows: Row[]) {
  const scored = rows.filter((r) => !r.isNotApplicable && r.score != null);
  return {
    quality: round1(avg(scored.map((r) => r.score!))),
    successRate: pct(successRate(rows)),
    volume: rows.length,
    riskRate: rows.length ? pct(rows.filter((r) => r.complianceFlag).length / rows.length) : null,
    avgDurationSec: Math.round(avg(rows.map((r) => r.durationSec)) ?? 0),
  };
}

/** Buckets rows into days (≤ 31-day window) or weeks, returning quality / success / volume per bucket. */
function series(rows: Row[], from: Date, to: Date, step: number) {
  const buckets: { date: string; rows: Row[] }[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += step * DAY) buckets.push({ date: istDay(new Date(t)), rows: [] });
  for (const r of rows) {
    const i = Math.min(buckets.length - 1, Math.floor((r.callAt.getTime() - from.getTime()) / (step * DAY)));
    buckets[i]?.rows.push(r);
  }
  return buckets.map((b) => ({ date: b.date, ...kpis(b.rows) }));
}

export async function getDashboard(actor: Actor, raw: unknown) {
  const q = dashboardQuery.parse(raw);

  // agents only ever see their own numbers
  const dimension = actor.role === "member" ? "agent" : q.dimension;
  const id = actor.role === "member" ? actor.userId : q.id;
  if (dimension !== "org" && !id) throw new ApiError(400, "invalid_request", "id is required for this dimension");

  const to = q.to ? new Date(`${q.to}T23:59:59.999+05:30`) : new Date();
  const from = q.from ? new Date(`${q.from}T00:00:00+05:30`) : new Date(to.getTime() - 29 * DAY - (to.getTime() + IST) % DAY);
  const span = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - span - 1);
  const prevTo = new Date(from.getTime() - 1);

  const [cats, teamRows, agentRows] = await Promise.all([
    db.select().from(categories).where(eq(categories.orgId, actor.orgId)),
    db.select().from(teams).where(eq(teams.orgId, actor.orgId)),
    db.select().from(users).where(and(eq(users.orgId, actor.orgId), eq(users.role, "member"))),
  ]);

  const filters: SQL[] = [];
  let scopeName = "All conversations";
  if (dimension === "category") {
    const c = cats.find((x) => x.id === id);
    if (!c) throw new ApiError(404, "not_found", "Unknown category");
    filters.push(eq(calls.categoryId, c.id));
    scopeName = c.name;
  } else if (dimension === "team") {
    const t = teamRows.find((x) => x.id === id);
    if (!t) throw new ApiError(404, "not_found", "Unknown team");
    filters.push(eq(users.cohortId, t.id));
    scopeName = t.name;
  } else if (dimension === "agent") {
    const a = agentRows.find((x) => x.id === id);
    if (!a) throw new ApiError(404, "not_found", "Unknown agent");
    filters.push(eq(calls.personId, a.id));
    scopeName = a.name;
  }
  if (q.categoryId && dimension !== "category") filters.push(eq(calls.categoryId, q.categoryId));

  const [rows, prevRows, crit] = await Promise.all([
    loadRows(actor.orgId, filters, from, to),
    loadRows(actor.orgId, filters, prevFrom, prevTo),
    db
      .select({ criterionId: criterionResults.criterionId, sectionId: criterionResults.sectionId, result: criterionResults.finalResult, agentId: calls.personId, callAt: calls.occurredAt, callId: calls.id })
      .from(criterionResults)
      .innerJoin(calls, eq(calls.id, criterionResults.conversationId))
      .innerJoin(users, eq(users.id, calls.personId))
      .where(and(eq(calls.orgId, actor.orgId), eq(calls.status, "completed"), isNull(calls.deletedAt), gte(calls.occurredAt, from), lte(calls.occurredAt, to), ...filters)),
  ]);

  const cur = kpis(rows);
  const prev = kpis(prevRows);
  const delta = (a: number | null, b: number | null) => (a == null || b == null ? null : round1(a - b));
  // one agent makes ~1–3 calls a day, so daily buckets are noise: use weeks beyond two weeks
  const step = span <= (dimension === "agent" ? 14 : 31) * DAY ? 1 : 7;
  const trend = series(rows, from, to, step);

  // rubric lookups (criterion/section ids are shared across categories where the wording is the same)
  const question = new Map<string, string>();
  const sectionName = new Map<string, string>();
  const outcomeById = new Map<string, { label: string; isSuccess: boolean; isNotApplicable: boolean }>();
  for (const c of cats)
    for (const s of c.rubric.sections) {
      sectionName.set(s.id, s.name);
      for (const cr of s.criteria) if (!question.has(cr.id)) question.set(cr.id, cr.question);
    }
  for (const c of cats) for (const o of c.rubric.outcomes) outcomeById.set(`${c.id}:${o.id}`, o);

  // outcomes, grouped by label
  const outcomeCounts = new Map<string, { label: string; type: OutcomeType; isSuccess: boolean; isNotApplicable: boolean; count: number }>();
  for (const r of rows) {
    const o = outcomeById.get(`${r.categoryId}:${r.outcomeId}`);
    if (!o) continue;
    const e = outcomeCounts.get(o.label) ?? { label: o.label, type: outcomeType(o), isSuccess: o.isSuccess, isNotApplicable: o.isNotApplicable, count: 0 };
    e.count++;
    outcomeCounts.set(o.label, e);
  }
  const outcomes = [...outcomeCounts.values()].sort((a, b) => b.count - a.count).map((o) => ({ ...o, pct: pct(o.count / rows.length) }));

  const durations = Object.entries(DURATION_BUCKETS).map(([key, b]) => ({ key, label: b.label, count: rows.filter((r) => r.durationSec >= b.min && r.durationSec < b.max).length }));

  // criteria + sections
  type Agg = { pass: number; fail: number; na: number };
  const byCriterion = new Map<string, Agg & { sectionId: string; failAgents: Map<string, number> }>();
  const bySection = new Map<string, Agg>();
  for (const c of crit) {
    const e = byCriterion.get(c.criterionId) ?? { pass: 0, fail: 0, na: 0, sectionId: c.sectionId, failAgents: new Map() };
    e[c.result]++;
    if (c.result === "fail") e.failAgents.set(c.agentId, (e.failAgents.get(c.agentId) ?? 0) + 1);
    byCriterion.set(c.criterionId, e);
    const s = bySection.get(c.sectionId) ?? { pass: 0, fail: 0, na: 0 };
    s[c.result]++;
    bySection.set(c.sectionId, s);
  }
  const agentName = new Map(agentRows.map((a) => [a.id, a.name]));
  const criteria = [...byCriterion.entries()]
    .map(([criterionId, e]) => {
      const evaluated = e.pass + e.fail;
      return {
        criterionId, question: question.get(criterionId) ?? criterionId, sectionId: e.sectionId, sectionName: sectionName.get(e.sectionId) ?? e.sectionId,
        evaluated, pass: e.pass, fail: e.fail, na: e.na, failRate: evaluated ? pct(e.fail / evaluated)! : 0,
        topFailingPeople: [...e.failAgents.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([personId, fails]) => ({ personId, name: agentName.get(personId) ?? personId, fails })),
      };
    })
    .sort((a, b) => b.failRate - a.failRate);
  const sections = [...bySection.entries()]
    .map(([sectionId, s]) => ({ sectionId, name: sectionName.get(sectionId) ?? sectionId, score: s.pass + s.fail ? pct(s.pass / (s.pass + s.fail))! : null, evaluated: s.pass + s.fail }))
    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101));

  // agent leaderboard: quality, then success rate, then volume
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));
  const prevByAgent = Map.groupBy(prevRows, (r) => r.agentId);
  const agents = [...Map.groupBy(rows, (r) => r.agentId).entries()]
    .map(([agentId, rs]) => {
      const k = kpis(rs);
      const p = kpis(prevByAgent.get(agentId) ?? []);
      return {
        personId: agentId, name: rs[0].agentName, cohortId: rs[0].teamId, cohortName: rs[0].teamId ? teamName.get(rs[0].teamId) : null,
        conversations: k.volume, quality: k.quality, successRate: k.successRate, riskFlags: rs.filter((r) => r.complianceFlag).length,
        delta: delta(k.quality, p.quality),
        trend: series(rs, from, to, 7).filter((b) => b.volume > 0).map((b) => ({ date: b.date, quality: b.quality })),
      };
    })
    .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0) || (b.successRate ?? 0) - (a.successRate ?? 0) || b.conversations - a.conversations)
    .map((a, i) => ({ ...a, rank: i + 1 }));

  const ranked = agents.filter((a) => a.conversations >= 3);
  const highlights = {
    mostCommonFailure: criteria.find((c) => c.evaluated >= 3) ?? null,
    topPerformer: ranked[0] ?? agents[0] ?? null,
    attentionRequired: sections.filter((s) => s.score != null && s.score < 75).slice(0, 4),
  };

  // agent coaching profile: strengths, needs work, and movement between the two halves of the window
  let profile = null;
  if (dimension === "agent") {
    const mid = from.getTime() + span / 2;
    const agentTeam = agentRows.find((a) => a.id === id)?.cohortId;
    const teamRowsCur = agentTeam ? await loadRows(actor.orgId, [eq(users.cohortId, agentTeam)], from, to) : [];
    const half = (early: boolean) => {
      const m = new Map<string, { pass: number; total: number }>();
      for (const c of crit) {
        if (c.result === "na" || (c.callAt.getTime() < mid) !== early) continue;
        const e = m.get(c.criterionId) ?? { pass: 0, total: 0 };
        e.total++;
        if (c.result === "pass") e.pass++;
        m.set(c.criterionId, e);
      }
      return m;
    };
    const [h1, h2] = [half(true), half(false)];
    const movement = criteria
      .map((c) => {
        const a = h1.get(c.criterionId), b = h2.get(c.criterionId);
        if (!a || !b || a.total < 2 || b.total < 2) return null;
        return { criterionId: c.criterionId, question: c.question, sectionName: c.sectionName, before: pct(a.pass / a.total)!, after: pct(b.pass / b.total)! };
      })
      .filter((x) => x !== null);
    profile = {
      cohortQuality: kpis(teamRowsCur).quality,
      strengths: criteria.filter((c) => c.evaluated >= 3 && c.failRate <= 10).sort((a, b) => a.failRate - b.failRate).slice(0, 6),
      needsWork: criteria.filter((c) => c.evaluated >= 3 && c.failRate >= 35).slice(0, 6),
      improvements: movement.filter((m) => m.after - m.before >= 20).sort((a, b) => b.after - b.before - (a.after - a.before)).slice(0, 5),
      regressions: movement.filter((m) => m.before - m.after >= 20).sort((a, b) => a.after - a.before - (b.after - b.before)).slice(0, 5),
    };
  }

  /* ---------- call intelligence: tags (hierarchical) and extracted data ---------- */
  const ids = rows.map((r) => r.id);
  const tagAssignments = ids.length
    ? await db.select({ callId: callTags.conversationId, slug: tags.slug }).from(callTags).innerJoin(tags, eq(tags.id, callTags.tagId)).where(inArray(callTags.conversationId, ids))
    : [];
  const tagDefs = await db.select({ slug: tags.slug, displayName: tags.displayName }).from(tags).where(eq(tags.orgId, actor.orgId));
  const tagName = new Map(tagDefs.map((x) => [x.slug, x.displayName]));
  const byCall = new Map(rows.map((r) => [r.id, r]));
  // a call counts once per node, however many of its leaves sit under that node
  const nodeCalls = new Map<string, Set<string>>();
  for (const a of tagAssignments) {
    const parts = a.slug.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const node = parts.slice(0, i).join("/");
      (nodeCalls.get(node) ?? nodeCalls.set(node, new Set()).get(node)!).add(a.callId);
    }
  }
  const rate = (callIds: Set<string>) => pct(successRate([...callIds].map((id) => byCall.get(id)!)));
  const tagTree = [...nodeCalls.entries()]
    .map(([slug, set]) => ({ slug, displayName: tagName.get(slug) ?? slug, depth: slug.split("/").length - 1, parent: slug.includes("/") ? slug.slice(0, slug.lastIndexOf("/")) : null, conversations: set.size, pct: pct(set.size / Math.max(rows.length, 1)), successRate: rate(set) }))
    .sort((a, b) => b.conversations - a.conversations);
  // PDF: "why certain calls were unsuccessful" → tags on Standard-outcome (eligible, not successful) calls
  const standardIds = new Set(rows.filter((r) => !r.isNotApplicable && !r.isSuccess).map((r) => r.id));
  const reasonCounts = new Map<string, number>();
  for (const a of tagAssignments) if (standardIds.has(a.callId) && !a.slug.startsWith("compliance") && !a.slug.startsWith("coaching")) reasonCounts.set(a.slug, (reasonCounts.get(a.slug) ?? 0) + 1);
  const unsuccessfulReasons = [...reasonCounts.entries()]
    .map(([slug, n]) => ({ slug, displayName: tagName.get(slug) ?? slug, path: slug.split("/").slice(0, -1).map((p, i, arr) => tagName.get(arr.slice(0, i + 1).join("/")) ?? p).join(" › "), conversations: n, pct: pct(n / Math.max(standardIds.size, 1)) }))
    .sort((a, b) => b.conversations - a.conversations)
    .slice(0, 8);

  const fieldDefs = new Map<string, { fieldName: string; displayName: string; fieldType: string; enumValues?: string[] }>();
  for (const c of cats) if (dimension !== "category" || c.id === id) for (const f of c.rubric.extractionFields) if (!fieldDefs.has(f.fieldName)) fieldDefs.set(f.fieldName, { fieldName: f.fieldName, displayName: f.displayName, fieldType: f.fieldType, enumValues: f.enumOptions?.map((o) => o.value) });
  const extractionReports = [...fieldDefs.values()].map((f) => {
    const withField = rows.filter((r) => r.extractions && f.fieldName in r.extractions);
    const captured = withField.filter((r) => r.extractions![f.fieldName] != null);
    const base = { ...f, conversations: withField.length, captured: captured.length, captureRate: pct(captured.length / Math.max(withField.length, 1)) };
    if (f.fieldType === "number") {
      const nums = captured.map((r) => Number(r.extractions![f.fieldName])).filter(Number.isFinite).sort((a, b) => a - b);
      return { ...base, values: [], stats: { sum: nums.reduce((a, b) => a + b, 0), avg: Math.round(avg(nums) ?? 0), median: nums.length ? nums[Math.floor(nums.length / 2)] : 0, max: nums.at(-1) ?? 0 } };
    }
    const groups = Map.groupBy(captured, (r) => String(r.extractions![f.fieldName]));
    const values = [...groups.entries()]
      .map(([value, rs]) => ({ value, conversations: rs.length, pct: pct(rs.length / Math.max(captured.length, 1)), successRate: pct(successRate(rs)) }))
      .sort((a, b) => b.conversations - a.conversations)
      .slice(0, f.fieldType === "text" ? 6 : 12);
    return { ...base, values, stats: null };
  }).filter((f) => f.conversations > 0);

  return {
    scope: { dimension, id: id ?? null, name: scopeName, categoryId: q.categoryId ?? null },
    range: { from: istDay(from), to: istDay(to), prevFrom: istDay(prevFrom), prevTo: istDay(prevTo), granularity: step === 1 ? "day" : "week" },
    kpis: {
      quality: { value: cur.quality, delta: delta(cur.quality, prev.quality) },
      successRate: { value: cur.successRate, delta: delta(cur.successRate, prev.successRate) },
      volume: { value: cur.volume, delta: cur.volume - prev.volume },
      riskRate: { value: cur.riskRate, delta: delta(cur.riskRate, prev.riskRate) },
      avgDurationSec: { value: cur.avgDurationSec, delta: cur.avgDurationSec - prev.avgDurationSec },
    },
    trend,
    outcomes,
    durations,
    sections,
    criteria,
    people: agents,
    highlights,
    profile,
    intelligence: { tags: tagTree, unsuccessfulReasons, standardConversations: standardIds.size, extractions: extractionReports },
  };
}
export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
