import { describe, expect, it } from "vitest";
import { callScore, sectionScores, successRate } from "@/server/scoring";
import { computeMetrics, wordLanguages } from "@/server/metrics";
import { applicableSections } from "@/server/targeting";
import { loadRubrics } from "@/server/content";

const r = (sectionId: string, finalResult: "pass" | "fail" | "na") => ({ sectionId, finalResult });

describe("scoring", () => {
  it("section score = met / applicable (4 of 5 → 80%)", () => {
    const s = sectionScores([r("a", "pass"), r("a", "pass"), r("a", "pass"), r("a", "pass"), r("a", "fail"), r("a", "na")]);
    expect(s.get("a")).toEqual({ met: 4, total: 5 });
  });
  it("call score excludes NA and is 0 when nothing applies", () => {
    expect(callScore([r("a", "pass"), r("b", "fail"), r("b", "na")])).toBe(50);
    expect(callScore([r("a", "na")])).toBe(0);
  });
  it("success rate excludes NA outcomes (48 / (65 − 8) → 84%)", () => {
    const rows = [
      ...Array(48).fill({ isSuccess: true, isNotApplicable: false }),
      ...Array(8).fill({ isSuccess: null, isNotApplicable: true }),
      ...Array(9).fill({ isSuccess: false, isNotApplicable: false }),
    ];
    expect(Math.round(successRate(rows)! * 100)).toBe(84);
    expect(successRate([])).toBeNull();
  });
});

describe("targeting", () => {
  const mid = loadRubrics().find((x) => x.id === "mid-bucket")!;
  const outcome = (id: string) => mid.outcomes.find((o) => o.id === id)!;
  it("dispute section only applies to disputes", () => {
    const ids = (o: string, reason: string) => applicableSections(mid, { outcome: outcome(o), extractions: { delay_reason: reason } }).map((s) => s.id);
    expect(ids("ptp", "medical")).not.toContain("dispute_handling");
    expect(ids("dispute", "medical")).toContain("dispute_handling");
    expect(ids("refused", "dispute")).toContain("dispute_handling");
  });
});

describe("metrics", () => {
  it("attributes words by script and lexicon", () => {
    expect(wordLanguages("हाँ, salary late आई है", "hi")).toEqual(["hi", "en", "en", "hi", "hi"]);
    expect(wordLanguages("Vanakkam sir, payment link anuppuren", "ta")).toEqual(["ta", "en", "en", "en", "ta"]);
  });
  it("computes talk ratio, monologue, silence and language mix", () => {
    const m = computeMetrics(
      [
        { start: 0, end: 6, speaker: "agent", lang: "en", text: "Hello? Is this Ravi?" },
        { start: 6, end: 8, speaker: "customer", lang: "ta", text: "ஆமா" },
        { start: 8, end: 10, speaker: "agent", lang: "ta", text: "Sari sir" },
      ],
      20,
    );
    expect(m.talkRatio).toBe(0.8);
    expect(m.silencePct).toBe(0.5);
    expect(m.questionsAsked).toBe(2);
    expect(m.longestMonologueSec).toBe(6);
    // "Sari sir": "sir" is English, "Sari" is romanised Tamil → the 2s segment splits 1s/1s
    expect(m.languageMix).toEqual({ en: 0.7, ta: 0.3 });
  });
});
