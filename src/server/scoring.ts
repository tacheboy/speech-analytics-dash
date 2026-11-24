import type { CriterionResultValue } from "@/lib/domain";

type R = { sectionId: string; finalResult: CriterionResultValue };

/** Section score = passes / (passes + fails). NA is excluded; a section with nothing applicable is dropped. */
export function sectionScores(results: R[]) {
  const by = new Map<string, { met: number; total: number }>();
  for (const r of results) {
    if (r.finalResult === "na") continue;
    const s = by.get(r.sectionId) ?? { met: 0, total: 0 };
    s.total++;
    if (r.finalResult === "pass") s.met++;
    by.set(r.sectionId, s);
  }
  return by;
}

/** Call score = round(100 × Σpasses / Σ(passes + fails)); 0 when nothing applies. */
export function callScore(results: R[]): number {
  let met = 0, total = 0;
  for (const r of results) {
    if (r.finalResult === "na") continue;
    total++;
    if (r.finalResult === "pass") met++;
  }
  return total ? Math.round((100 * met) / total) : 0;
}

/** Success rate = success outcomes / non-NA outcomes (0..1); null when there is nothing to rate. */
export function successRate(rows: { isSuccess: boolean | null; isNotApplicable: boolean | null }[]): number | null {
  const rated = rows.filter((r) => !r.isNotApplicable);
  return rated.length ? rated.filter((r) => r.isSuccess).length / rated.length : null;
}
