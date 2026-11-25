import type { Lang, Speaker, TranscriptSegment } from "@/lib/domain";
import { wordLanguages } from "@/server/metrics";
import { FRAME_SEC } from "./audio";
import type { AsrUnit } from "./providers/types";

/**
 * Who said what. ASR units (words, chunks or diarized turns) become speaker-attributed segments.
 * - Stereo: each unit goes to the channel with more energy over its time span (one ASR pass on the
 *   mono mixdown, near-perfect speaker split from the stereo recording). Units where neither side
 *   clearly dominates (crosstalk) take their neighbour's speaker.
 * - Mono: the provider's diarization labels; the person is whoever speaks first (agents open calls).
 * Consecutive units of one speaker merge into a segment until a pause of PAUSE_SEC.
 */
const PAUSE_SEC = 0.7;
const DOMINANCE_DB = 3;

export function attributeByEnergy(units: AsrUnit[], energy: [number[], number[]], personChannel: "left" | "right"): (Speaker | null)[] {
  const [left, right] = energy;
  const raw = units.map((u) => {
    const a = Math.max(0, Math.floor(u.start / FRAME_SEC)), b = Math.max(a + 1, Math.ceil(u.end / FRAME_SEC));
    let l = 0, r = 0;
    for (let i = a; i < Math.min(b, left.length); i++) {
      l += left[i];
      r += right[i];
    }
    const n = Math.max(1, Math.min(b, left.length) - a);
    const diff = (l - r) / n;
    if (Math.abs(diff) < DOMINANCE_DB) return null;
    const side = diff > 0 ? "left" : "right";
    return side === personChannel ? ("agent" as const) : ("customer" as const);
  });
  // fill ambiguous units from the nearest decided neighbour
  return raw.map((s, i) => {
    if (s) return s;
    for (let d = 1; d < raw.length; d++) {
      if (raw[i - d]) return raw[i - d];
      if (raw[i + d]) return raw[i + d];
    }
    return null;
  });
}

export function attributeByDiarization(units: AsrUnit[]): Speaker[] {
  const first = units.find((u) => u.speaker != null)?.speaker;
  return units.map((u) => (u.speaker == null || u.speaker === first ? "agent" : "customer"));
}

/** Dominant language of a piece of text: native script wins; Latin words count as English if in the lexicon. */
function langOf(text: string, hint: string | null | undefined): Lang {
  const primary = (hint?.split("-").find((p) => p !== "en") ?? hint ?? "en") as Lang;
  const words = wordLanguages(text, primary);
  if (!words.length) return primary;
  const counts = new Map<Lang, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function toSegments(units: AsrUnit[], speakers: (Speaker | null)[], languageHint?: string | null): TranscriptSegment[] {
  const segs: TranscriptSegment[] = [];
  units.forEach((u, i) => {
    const speaker = speakers[i] ?? "agent";
    const prev = segs.at(-1);
    if (prev && prev.speaker === speaker && u.start - prev.end < PAUSE_SEC) {
      prev.end = Math.max(prev.end, u.end);
      prev.text = `${prev.text} ${u.text.trim()}`.trim();
    } else {
      segs.push({ start: round(u.start), end: round(u.end), speaker, lang: "en", text: u.text.trim() });
    }
  });
  for (const s of segs) {
    s.end = round(s.end);
    s.text = s.text.replace(/\s+([,.!?।])/g, "$1");
    s.lang = langOf(s.text, languageHint);
  }
  return segs.filter((s) => s.text);
}

const round = (x: number) => Math.round(x * 100) / 100;
