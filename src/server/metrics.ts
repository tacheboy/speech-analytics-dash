import type { CallMetrics, Lang, TranscriptSegment } from "@/lib/domain";
import lexicon from "../../content/generated/english-lexicon.json";

const ENGLISH = new Set<string>(lexicon);
const SCRIPT: [RegExp, Lang][] = [[/[\u0B80-\u0BFF]/, "ta"], [/[\u0C80-\u0CFF]/, "kn"], [/[\u0900-\u097F]/, "hi"]];

/** Word-level language attribution: native script → that language; Latin words → English if in the lexicon, else the segment's language (romanised speech). */
export function wordLanguages(text: string, segLang: Lang): Lang[] {
  return (text.match(/[\p{L}\p{M}]+/gu) ?? []).map((w) => {
    for (const [re, l] of SCRIPT) if (re.test(w)) return l;
    return ENGLISH.has(w.toLowerCase()) || segLang === "en" ? "en" : segLang;
  });
}

/** Deterministic conversation metrics computed from the diarised transcript (no LLM). */
export function computeMetrics(segments: TranscriptSegment[], durationSec: number): CallMetrics {
  let agent = 0, speech = 0, longest = 0, run = 0, questions = 0;
  const langs: Partial<Record<Lang, number>> = {};
  segments.forEach((s, i) => {
    const d = Math.max(0, s.end - s.start);
    speech += d;
    if (s.speaker === "agent") {
      agent += d;
      questions += (s.text.match(/\?/g) ?? []).length;
    }
    const words = wordLanguages(s.text, s.lang);
    for (const l of words) langs[l] = (langs[l] ?? 0) + d / words.length;
    run = i > 0 && segments[i - 1].speaker === s.speaker ? run + d : d;
    longest = Math.max(longest, run);
  });
  const languageMix: Partial<Record<Lang, number>> = {};
  for (const [k, v] of Object.entries(langs)) languageMix[k as Lang] = speech ? +(v / speech).toFixed(3) : 0;
  return {
    talkRatio: speech ? +(agent / speech).toFixed(3) : 0,
    longestMonologueSec: Math.round(longest),
    silencePct: durationSec ? +Math.max(0, 1 - speech / durationSec).toFixed(3) : 0,
    questionsAsked: questions,
    languageMix,
  };
}
