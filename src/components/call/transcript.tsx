"use client";

import { useEffect, useRef, useState } from "react";
import { LANG_LABEL, type TranscriptSegment } from "@/lib/domain";
import { fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Speaker-labelled transcript synced to playback: active line highlights and auto-scrolls; click to seek. */
export function Transcript({ segments, agentName, time, onSeek, highlight }: { segments: TranscriptSegment[]; agentName?: string; time: number; onSeek: (t: number) => void; highlight?: number | null }) {
  const [roman, setRoman] = useState(false);
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const active = segments.findIndex((s) => time >= s.start && time < s.end + 0.35);
  const hasNative = segments.some((s) => s.roman);

  useEffect(() => {
    if (!follow || active < 0 || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (el) box.current.scrollTo({ top: el.offsetTop - box.current.clientHeight / 3, behavior: "smooth" });
  }, [active, follow]);

  return (
    <div className="flex flex-col rounded-2xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <h2 className="font-semibold">Transcript</h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[var(--primary)]" />Follow audio</label>
          {hasNative && (
            <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Script">
              <button onClick={() => setRoman(false)} className={cn("rounded px-2 py-0.5", !roman && "bg-secondary text-foreground")}>As spoken</button>
              <button onClick={() => setRoman(true)} className={cn("rounded px-2 py-0.5", roman && "bg-secondary text-foreground")}>Romanised</button>
            </div>
          )}
        </div>
      </div>
      <div ref={box} className="relative max-h-[520px] space-y-1 overflow-y-auto p-3">
        {segments.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No transcript available.</p>}
        {segments.map((s, i) => {
          const agent = s.speaker === "agent";
          return (
            <button
              key={i}
              data-i={i}
              onClick={() => onSeek(s.start)}
              className={cn(
                "flex w-full gap-3 rounded-xl px-3 py-2.5 text-left transition",
                i === active ? "bg-primary/12 ring-1 ring-primary/40" : highlight === i ? "bg-warning/10 ring-1 ring-warning/40" : "hover:bg-accent/40",
              )}
            >
              <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", agent ? "bg-chart-1/20 text-chart-1" : "bg-chart-2/20 text-chart-2")}>{agent ? (agentName?.[0] ?? "P") : "C"}</span>
              <span className="min-w-0 flex-1">
                <span className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium">{agent ? (agentName ?? "Person") : "Customer"}</span>
                  <span className="tabular">{fmtDuration(s.start)}</span>
                  <span className="rounded border px-1 text-[10px] uppercase">{s.lang}</span>
                </span>
                <span className={cn("block leading-relaxed", i === active ? "text-foreground" : "text-foreground/85")} lang={s.lang} title={LANG_LABEL[s.lang]}>
                  {roman && s.roman ? s.roman : s.text}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
