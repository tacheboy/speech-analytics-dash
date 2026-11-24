"use client";

import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { useTheme } from "next-themes";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Moment } from "@/lib/domain";
import { fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PlayerHandle = { seek: (t: number, play?: boolean) => void };

const MOMENT_STYLE: Record<Moment["type"], { label: string; cls: string }> = {
  ptp: { label: "Promise to pay", cls: "bg-success" },
  payment: { label: "Payment", cls: "bg-success" },
  objection: { label: "Objection", cls: "bg-warning" },
  hardship: { label: "Hardship", cls: "bg-info" },
  dispute: { label: "Dispute", cls: "bg-info" },
  compliance_risk: { label: "Compliance risk", cls: "bg-danger" },
};
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Dual-channel waveform (agent above, customer below) with moment markers. */
export const AudioPlayer = forwardRef<PlayerHandle, { url: string; moments: Moment[]; onTime: (t: number) => void; stereo: boolean }>(function AudioPlayer({ url, moments, onTime, stereo }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState(false);
  const { resolvedTheme } = useTheme();

  useImperativeHandle(ref, () => ({
    seek: (t, play = true) => {
      ws.current?.setTime(Math.max(0, t));
      if (play) ws.current?.play();
    },
  }));

  useEffect(() => {
    if (!container.current) return;
    const agent = cssVar("--chart-1"), customer = cssVar("--chart-2"), muted = cssVar("--border"), cursor = cssVar("--foreground");
    const base = { barWidth: 2, barGap: 1.5, barRadius: 2, normalize: true, cursorColor: cursor, cursorWidth: 1 };
    const w = WaveSurfer.create({
      container: container.current,
      url,
      height: stereo ? 44 : 72,
      ...base,
      waveColor: muted,
      progressColor: agent,
      ...(stereo ? { splitChannels: [{ waveColor: muted, progressColor: agent, ...base }, { waveColor: muted, progressColor: customer, ...base }] } : {}),
    });
    ws.current = w;
    w.on("ready", (d) => { setReady(true); setDuration(d); });
    w.on("timeupdate", (t) => { setTime(t); onTime(t); });
    w.on("play", () => setPlaying(true));
    w.on("pause", () => setPlaying(false));
    w.on("finish", () => setPlaying(false));
    w.on("error", () => setError(true));
    return () => { w.destroy(); ws.current = null; setReady(false); };
    // re-create on theme change so canvas colours follow the theme
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, stereo, resolvedTheme]);

  const skip = (d: number) => ws.current?.setTime(Math.min(duration, Math.max(0, time + d)));
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    ws.current?.setPlaybackRate(next, true);
  };

  return (
    <div className="rounded-2xl border bg-card p-4">
      {stereo && (
        <div className="mb-2 flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-chart-1" />Agent channel</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-chart-2" />Customer channel</span>
        </div>
      )}
      <div className="relative">
        <div ref={container} className={cn("w-full", !ready && "animate-pulse rounded-lg bg-muted/40")} style={{ minHeight: stereo ? 88 : 72 }} />
        {ready && duration > 0 && moments.map((m, i) => (
          <Tooltip key={i}>
            <TooltipTrigger
              render={<button aria-label={`${MOMENT_STYLE[m.type].label}: ${m.label} at ${fmtDuration(m.start)}`} onClick={() => { ws.current?.setTime(m.start); ws.current?.play(); }} />}
              className="absolute -top-1 -translate-x-1/2"
              style={{ left: `${(m.start / duration) * 100}%` }}
            >
              <span className={cn("block size-2.5 rounded-full ring-2 ring-card", MOMENT_STYLE[m.type].cls)} />
            </TooltipTrigger>
            <TooltipContent>{MOMENT_STYLE[m.type].label} · {m.label} · {fmtDuration(m.start)}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-danger">This recording could not be loaded.</p>}
      <div className="mt-3 flex items-center gap-2">
        <Button size="icon" className="size-10 rounded-full" disabled={!ready} onClick={() => ws.current?.playPause()} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </Button>
        <Button variant="ghost" size="icon" disabled={!ready} onClick={() => skip(-10)} aria-label="Back 10 seconds"><RotateCcw className="size-4" /></Button>
        <Button variant="ghost" size="icon" disabled={!ready} onClick={() => skip(10)} aria-label="Forward 10 seconds"><RotateCw className="size-4" /></Button>
        <span className="ml-1 text-sm tabular text-muted-foreground">{fmtDuration(time)} / {fmtDuration(duration)}</span>
        <Button variant="outline" size="sm" className="ml-auto w-16 tabular" onClick={cycleSpeed} aria-label="Change playback speed">{speed}×</Button>
      </div>
      {moments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {moments.map((m, i) => (
            <button key={i} onClick={() => { ws.current?.setTime(m.start); ws.current?.play(); }} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs hover:bg-accent">
              <span className={cn("size-2 rounded-full", MOMENT_STYLE[m.type].cls)} />
              {m.label}
              <span className="text-muted-foreground tabular">{fmtDuration(m.start)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
