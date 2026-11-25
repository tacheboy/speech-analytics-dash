"use client";

import { AlertTriangle, Check, ChevronDown, CircleSlash, Play, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { InfoHint, Pill, ScoreBadge } from "@/components/app/bits";
import { useAuditScorecard } from "@/lib/api-client";
import type { Conversation, Result } from "@/lib/contract";
import { scoreTone } from "@/lib/domain";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

// every criterion is answered Yes / No / NA
const RESULT = {
  yes: { icon: Check, label: "Yes", cls: "bg-success/15 text-success" },
  no: { icon: X, label: "No", cls: "bg-danger/15 text-danger" },
  na: { icon: CircleSlash, label: "NA", cls: "bg-muted text-muted-foreground" },
} as const;

/** The Scorecard tab: per-section answers with evidence that seeks the audio, and the human audit (PATCH /scorecard). */
export function Audit({ call, canAudit, onSeek, assignableTags }: { call: Conversation; canAudit: boolean; onSeek: (t: number, line?: number) => void; assignableTags: { slug: string; displayName: string }[] }) {
  const sections = call.scorecard ?? [];
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(sections.map((s) => [s.sectionId, s.passed < s.applicable])));
  const [auditing, setAuditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, Result>>({});
  const [note, setNote] = useState(call.audit?.note ?? "");
  const [manualTags, setManualTags] = useState<string[]>(call.tags.filter((t) => t.source === "manual").map((t) => t.slug));
  const audit = useAuditScorecard(call.id);

  const lineOf = (t: number | null) => (t == null ? undefined : call.transcript?.findIndex((s) => s.start === t));
  const save = () => {
    const overrides = Object.entries(draft).map(([criterionId, result]) => ({ criterionId, result }));
    audit.mutate({ overrides, note, tagSlugs: manualTags }, {
      onSuccess: (d) => { toast.success(`Audit saved: score ${d.aiScore ?? "—"}% → ${d.score ?? "—"}%`); setAuditing(false); setDraft({}); },
      onError: (e) => toast.error(e.message),
    });
  };
  const passed = sections.reduce((a, s) => a + s.passed, 0);
  const applicable = sections.reduce((a, s) => a + s.applicable, 0);
  const na = sections.reduce((a, s) => a + s.criteria.filter((c) => c.result === "na").length, 0);
  const unverified = sections.flatMap((s) => s.criteria).filter((c) => c.result !== "na" && c.evidence && !c.evidence.verified).length;

  if (!sections.length)
    return <p className="text-sm text-muted-foreground">This conversation has an NA outcome ({call.outcome?.label}), so it is excluded from scoring.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {passed} of {applicable} applicable criteria met{na ? <> · {na} NA</> : null}
          {call.aiScore !== call.score && <> · AI scored <span className="tabular">{call.aiScore}%</span>, adjusted by audit</>}
          <InfoHint>Quality score = criteria answered Yes ÷ (all criteria − NA) × 100. Every criterion carries equal weight. NA criteria (not applicable by rule, or not enough information) don’t count.</InfoHint>
        </p>
        {canAudit && !auditing && <Button size="sm" variant="outline" onClick={() => { setAuditing(true); setOpen(Object.fromEntries(sections.map((s) => [s.sectionId, true]))); }}>Audit &amp; override</Button>}
      </div>

      {unverified > 0 && !auditing && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {unverified} answer{unverified > 1 ? "s" : ""} cite a quote we couldn’t find in the transcript. Confidence is capped and the conversation is in the Audits “Needs review” queue.
        </p>
      )}

      {call.audit && !auditing && (
        <div className="rounded-xl border border-info/30 bg-info/8 px-4 py-3 text-sm">
          <p className="font-medium text-info">Audited by {call.audit.auditedByName ?? "a manager"} · {fmtDateTime(call.audit.auditedAt)}</p>
          {call.audit.note && <p className="mt-1 text-foreground/90">{call.audit.note}</p>}
        </div>
      )}

      {sections.map((s) => {
        const pct = s.applicable ? Math.round((100 * s.passed) / s.applicable) : null;
        const isOpen = open[s.sectionId];
        return (
          <div key={s.sectionId} className="rounded-xl border bg-background/40">
            <button className="flex w-full items-start gap-3 p-4 text-left" onClick={() => setOpen((o) => ({ ...o, [s.sectionId]: !o[s.sectionId] }))} aria-expanded={isOpen}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.applicable ? `${s.passed} out of ${s.applicable} criteria met` : `Not applicable: ${s.criteria[0]?.naReason ?? "rule"}`}</p>
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
                  const current = draft[c.criterionId] ?? c.result;
                  const R = RESULT[current];
                  const ev = c.evidence;
                  return (
                    <li key={c.criterionId} className="flex gap-3 px-4 py-3">
                      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", R.cls)} title={R.label}><R.icon className="size-3.5" /></span>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-sm font-medium leading-snug">{c.question}</p>
                        <p className="text-sm text-muted-foreground">{c.rationale}</p>
                        {c.result === "na" && c.source === "rule" && <Pill tone="muted" className="h-5 text-[11px]">NA by rule</Pill>}
                        {ev && (
                          <button onClick={() => ev.start != null && onSeek(ev.start, lineOf(ev.start))} disabled={ev.start == null}
                            className={cn("group flex w-full items-start gap-2 rounded-lg border-l-2 bg-muted/50 px-3 py-2 text-left text-xs hover:bg-accent/50", ev.verified ? "border-primary/60" : "border-warning")}>
                            <Play className="mt-0.5 size-3 shrink-0 text-primary" />
                            <span className="line-clamp-2 italic">“{ev.quote}”</span>
                            <span className="ml-auto shrink-0 text-primary tabular group-hover:underline">{ev.start != null ? fmtDuration(ev.start) : ""}</span>
                          </button>
                        )}
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span title="Model confidence">Confidence {Math.round(c.confidence * 100)}%</span>
                          {ev && !ev.verified && <Pill tone="warning" className="h-5 text-[11px]">Quote not found in transcript</Pill>}
                          {c.source === "audit" && <Pill tone="info" className="h-5 text-[11px]">Overridden · AI said {RESULT[c.aiResult].label}</Pill>}
                        </div>
                        {auditing && (
                          <div className="flex gap-1 pt-1" role="radiogroup" aria-label={`Override: ${c.question}`}>
                            {(["yes", "no", "na"] as const).map((v) => (
                              <button key={v} role="radio" aria-checked={current === v} onClick={() => setDraft((d) => ({ ...d, [c.criterionId]: v }))}
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

      {auditing && (
        <div className="sticky bottom-3 space-y-3 rounded-xl border bg-popover p-4 shadow-xl">
          {assignableTags.length > 0 && (
            <div className="grid gap-1.5 text-sm font-medium">Manual tags
              <div className="flex flex-wrap gap-1.5">
                {assignableTags.map((t) => {
                  const on = manualTags.includes(t.slug);
                  return <button key={t.slug} type="button" aria-pressed={on} onClick={() => setManualTags((m) => (on ? m.filter((x) => x !== t.slug) : [...m, t.slug]))} className={cn("rounded-full border px-2.5 py-1 text-xs font-normal", on ? "border-primary bg-primary/15 text-primary" : "hover:bg-accent")}>{t.displayName}</button>;
                })}
              </div>
            </div>
          )}
          <label className="grid gap-1.5 text-sm font-medium">Coaching note for the person
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should the person do differently next time?" rows={3} />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{Object.keys(draft).length} answer change(s). Overrides feed the AI–auditor agreement metric.</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setAuditing(false); setDraft({}); }}>Cancel</Button>
              <Button onClick={save} disabled={audit.isPending}>{audit.isPending ? "Saving…" : "Save audit"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
