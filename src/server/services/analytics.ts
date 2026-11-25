import { eq, sql, type SQL } from "drizzle-orm";
import { analyticsQuery, type AnalyticsResult } from "@/lib/contract";
import type { Actor } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { istRange } from "./time";

/**
 * GET /analytics: one flexible aggregate endpoint instead of bespoke reports.
 * metrics × groupBy over completed conversations, with the list endpoint's filters.
 * Conversation metrics and criterion metrics (passRate, agreement) come from two grouped queries
 * merged by key, so neither multiplies the other's rows.
 */
const DAY = 86400_000;
const r1 = (x: unknown) => (x == null ? null : Math.round(Number(x) * 10) / 10);

const GROUP: Record<string, { key: SQL; label: SQL; join?: SQL }> = {
  day: { key: sql`to_char(c.occurred_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`, label: sql`to_char(c.occurred_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD')` },
  week: { key: sql`to_char(date_trunc('week', c.occurred_at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD')`, label: sql`to_char(date_trunc('week', c.occurred_at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD')` },
  person: { key: sql`c.person_id`, label: sql`max(u.name)` },
  cohort: { key: sql`coalesce(u.cohort_id, 'none')`, label: sql`coalesce(max(coh.name), 'No cohort')`, join: sql`left join cohorts coh on coh.id = u.cohort_id` },
  category: { key: sql`c.category_id`, label: sql`max(cat.name)`, join: sql`join categories cat on cat.id = c.category_id` },
  outcome: { key: sql`coalesce(c.outcome_id, 'none')`, label: sql`coalesce(c.outcome_id, 'none')` },
  tag: { key: sql`t.slug`, label: sql`max(t.display_name)`, join: sql`join conversation_tags ct on ct.conversation_id = c.id join tags t on t.id = ct.tag_id` },
  criterion: { key: sql`gcr.criterion_id`, label: sql`gcr.criterion_id`, join: sql`join criterion_results gcr on gcr.conversation_id = c.id and gcr.final_result <> 'na'` },
};

export async function getPublicAnalytics(actor: Actor, raw: unknown): Promise<AnalyticsResult> {
  const q = analyticsQuery.parse(raw);
  const range = istRange(q.from, q.to);
  const to = range.to ?? new Date();
  const from = range.from ?? new Date(to.getTime() - 30 * DAY);

  const where: SQL[] = [sql`c.org_id = ${actor.orgId}`, sql`c.status = 'completed'`, sql`c.deleted_at is null`, sql`c.occurred_at >= ${from.toISOString()}`, sql`c.occurred_at <= ${to.toISOString()}`];
  if (actor.role === "member") where.push(sql`c.person_id = ${actor.userId}`);
  else {
    if (q.personId?.length) where.push(sql`c.person_id in (${sql.join(q.personId.map((p) => sql`${p}`), sql`, `)})`);
    if (q.cohortId?.length) where.push(sql`u.cohort_id in (${sql.join(q.cohortId.map((p) => sql`${p}`), sql`, `)})`);
  }
  if (q.categoryId) where.push(sql`c.category_id = ${q.categoryId}`);
  if (q.tag?.length) {
    const m = sql.join(q.tag.map((s) => sql`(tf.slug = ${s} or tf.slug like ${`${s}/%`})`), sql` or `);
    where.push(sql`exists (select 1 from conversation_tags ctf join tags tf on tf.id = ctf.tag_id where ctf.conversation_id = c.id and (${m}))`);
  }
  const filters = sql.join(where, sql` and `);
  const g = q.groupBy ? GROUP[q.groupBy] : { key: sql`'all'`, label: sql`'All'` };
  const want = new Set(q.metrics);

  const convRows = await db.execute<Record<string, string | number | null>>(sql`
    select ${g.key} as key, ${g.label} as label,
      count(*)::int as volume,
      avg(c.score) filter (where not coalesce(c.is_not_applicable, false) and c.score is not null) as "qualityScore",
      100.0 * count(*) filter (where c.is_success and not coalesce(c.is_not_applicable, false)) / nullif(count(*) filter (where not coalesce(c.is_not_applicable, false)), 0) as "successRate",
      100.0 * avg(case when c.risk_flag then 1 else 0 end) as "riskRate",
      sum(c.duration_sec) / 60.0 as minutes,
      sum(a.cost_micros_usd) / 1e6 as "costUsd"
    from conversations c
    join users u on u.id = c.person_id
    left join analyses a on a.id = c.current_analysis_id
    ${g.join ?? sql``}
    where ${filters}
    group by 1 ${q.groupBy === "outcome" || q.groupBy === "day" || q.groupBy === "week" || q.groupBy === "criterion" ? sql`, 2` : sql``}
    order by ${q.groupBy === "day" || q.groupBy === "week" ? sql`1 asc` : sql`volume desc`}
    limit ${q.limit}`);

  const critByKey = new Map<string, { passRate: number | null; agreement: number | null; auditedAnswers: number }>();
  if (want.has("passRate") || want.has("agreement")) {
    const critGroup = q.groupBy === "criterion" ? { ...g, key: sql`cr.criterion_id`, join: sql`` } : g;
    const crit = await db.execute<{ key: string; passRate: number | null; agreement: number | null; audited: number }>(sql`
      select ${critGroup.key} as key, count(*) filter (where c.audited_at is not null)::int as audited,
        100.0 * count(*) filter (where cr.final_result = 'pass') / nullif(count(*) filter (where cr.final_result <> 'na'), 0) as "passRate",
        100.0 * count(*) filter (where c.audited_at is not null and cr.ai_result = cr.final_result) / nullif(count(*) filter (where c.audited_at is not null), 0) as agreement
      from criterion_results cr
      join conversations c on c.id = cr.conversation_id
      join users u on u.id = c.person_id
      ${critGroup.join ?? sql``}
      where ${filters}
      group by 1`);
    for (const r of crit) critByKey.set(String(r.key), { passRate: r1(r.passRate), agreement: r1(r.agreement), auditedAnswers: Number(r.audited) });
  }

  // human-readable labels for ids the SQL can't name on its own
  const labels = new Map<string, string>();
  if (q.groupBy === "outcome" || q.groupBy === "criterion") {
    const cats = await db.select({ rubric: schema.categories.rubric }).from(schema.categories).where(eq(schema.categories.orgId, actor.orgId));
    for (const { rubric } of cats) {
      for (const o of rubric.outcomes) labels.set(o.id, o.label);
      for (const s of rubric.sections) for (const c of s.criteria) if (!labels.has(c.id)) labels.set(c.id, c.question);
    }
  }

  const rows = convRows.map((r) => {
    const key = String(r.key);
    const out: Record<string, string | number | null> = { key, label: labels.get(key) ?? (r.label == null ? key : String(r.label)) };
    if (want.has("volume")) out.volume = Number(r.volume);
    if (want.has("qualityScore")) out.qualityScore = r1(r.qualityScore);
    if (want.has("successRate")) out.successRate = r1(r.successRate);
    if (want.has("riskRate")) out.riskRate = r1(r.riskRate);
    if (want.has("minutes")) out.minutes = r1(r.minutes);
    if (want.has("costUsd")) out.costUsd = r.costUsd == null ? null : Math.round(Number(r.costUsd) * 10000) / 10000;
    if (want.has("passRate")) out.passRate = critByKey.get(key)?.passRate ?? null;
    if (want.has("agreement")) {
      out.agreement = critByKey.get(key)?.agreement ?? null;
      out.auditedAnswers = critByKey.get(key)?.auditedAnswers ?? 0; // sample size behind agreement
    }
    return out;
  });
  return { object: "analytics", from: from.toISOString(), to: to.toISOString(), groupBy: q.groupBy ?? null, rows };
}
