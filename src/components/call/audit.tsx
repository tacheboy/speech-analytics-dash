"use client";

import { Check, ChevronDown, CircleSlash, Play, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pill, ScoreBadge } from "@/components/app/bits";
import { useReviewCall } from "@/lib/api-client";
import type { CriterionResultValue } from "@/lib/domain";
import { scoreTone } from "@/lib/domain";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CallDetail } from "@/server/services/calls";

const RESULT = {
  pass: { icon: Check, label: "Met", cls: "bg-success/15 text-success" },
  fail: { icon: X, label: "Missed", cls: "bg-danger/15 text-danger" },
  na: { icon: CircleSlash, label: "N/A", cls: "bg-muted text-muted-foreground" },
} as const;

export function Audit({ call, canReview, onSeek }: { call: CallDetail; canReview: boolean; onSeek: (t: number, line?: number) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(call.sections.map((s) => [s.id, s.met < s.total])));
  const [reviewing, setReviewing] = useState(false);
  const [draft, setDraft] = useState<Record<string, CriterionResultValue>>({});
  const [note, setNote] = useState(call.reviewNote ?? "");
  const review = useReviewCall(call.id);

  const lineOf = (t: number | null) => (t == null ? undefined : call.transcript?.findIndex((s) => s.start === t));
  const save = () => {
    const overrides = Object.entries(draft).map(([criterionId, result]) => ({ criterionId, result }));
    review.mutate({ overrides, note }, {
      onSuccess: (d) => { toast.success(`Review saved — score ${d.aiScore}% → ${d.score}%`); setReviewing(false); setDraft({}); },
      onError: (e) => toast.error(e.message),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {call.sections.reduce((a, s) => a + s.met, 0)} of {call.sections.reduce((a, s) => a + s.total, 0)} applicable criteria met
          {call.aiScore !== call.score && <> · AI scored <span className="tabular">{call.aiScore}%</span>, adjusted by review</>}
        </p>
        {canReview && !reviewing && <Button size="sm" variant="outline" onClick={() => { setReviewing(true); setOpen(Object.fromEntries(call.sections.map((s) => [s.id, true]))); }}>Review &amp; override</Button>}
      </div>

      {call.reviewedAt && !reviewing && (
        <div className="rounded-xl border border-info/30 bg-info/8 px-4 py-3 text-sm">
          <p className="font-medium text-info">Reviewed by {call.reviewedByName} · {fmtDateTime(call.reviewedAt)}</p>
          {call.reviewNote && <p className="mt-1 text-foreground/90">{call.reviewNote}</p>}
        </div>
      )}

      {call.sections.map((s) => {
        const pct = s.total ? Math.round((100 * s.met) / s.total) : null;
        const isOpen = open[s.id];
        return (
          <div key={s.id} className="rounded-xl border bg-background/40">
            <button className="flex w-full items-start gap-3 p-4 text-left" onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))} aria-expanded={isOpen}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.total ? `${s.met} out of ${s.total} criteria met` : "Not applicable on this call"}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", { success: "bg-success", warning: "bg-warning", danger: "bg-danger", muted: "bg-muted-foreground" }[scoreTone(pct)])} style={{ width: `${pct ?? 0}%` }} />
                </div>
              </div>
              <ScoreBadge score={pct} />
              <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition", isOpen && "rotate-180")} />
            </button>
            {isOpen && (
              <ul className="divide-y border-t">
                {s.criteria.map((c) => {
                  const current = draft[c.id] ?? c.result;
                  const R = RESULT[current];
                  return (
                    <li key={c.id} className="flex gap-3 px-4 py-3">
                      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", R.cls)} title={R.label}><R.icon className="size-3.5" /></span>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-sm font-medium leading-snug">{c.question}</p>
                        <p className="text-sm text-muted-foreground">{c.rationale}</p>
                        {c.evidenceQuote && (
                          <button onClick={() => onSeek(c.evidenceStart!, lineOf(c.evidenceStart))} className="group flex w-full items-start gap-2 rounded-lg border-l-2 border-primary/60 bg-muted/50 px-3 py-2 text-left text-xs hover:bg-accent/50">
                            <Play className="mt-0.5 size-3 shrink-0 text-primary" />
                            <span className="line-clamp-2 italic">“{c.evidenceQuote}”</span>
                            <span className="ml-auto shrink-0 text-primary tabular group-hover:underline">{fmtDuration(c.evidenceStart)}</span>
                          </button>
                        )}
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span title="Model confidence">Confidence {Math.round(c.confidence * 100)}%</span>
                          {c.overrideResult && <Pill tone="info" className="h-5 text-[11px]">Overridden · AI said {RESULT[c.aiResult].label}</Pill>}
                        </div>
                        {reviewing && (
                          <div className="flex gap-1 pt-1" role="radiogroup" aria-label={`Override: ${c.question}`}>
                            {(["pass", "fail", "na"] as const).map((v) => (
                              <button key={v} role="radio" aria-checked={current === v} onClick={() => setDraft((d) => ({ ...d, [c.id]: v }))}
                                className={cn("rounded-md border px-2.5 py-1 text-xs", current === v ? RESULT[v].cls + " border-transparent font-medium" : "hover:bg-accent")}>
                                {RESULT[v].label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      {reviewing && (
        <div className="sticky bottom-3 space-y-3 rounded-xl border bg-popover p-4 shadow-xl">
          <label className="grid gap-1.5 text-sm font-medium">Coaching note for the agent
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should the agent do differently next time?" rows={3} />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{Object.keys(draft).length} change(s). Overrides become calibration data.</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setReviewing(false); setDraft({}); }}>Cancel</Button>
              <Button onClick={save} disabled={review.isPending}>{review.isPending ? "Saving…" : "Save review"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
