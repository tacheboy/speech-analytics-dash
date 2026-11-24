"use client";

import { LANG_LABEL, type Lang } from "@/lib/domain";
import { fmtDuration } from "@/lib/format";
import { OutcomeBadge } from "@/components/app/bits";
import type { CallDetail } from "@/server/services/calls";

const LANG_COLOR: Record<Lang, string> = { en: "var(--chart-1)", ta: "var(--chart-2)", kn: "var(--chart-3)", hi: "var(--chart-4)" };

export function LanguageMix({ mix }: { mix: Partial<Record<Lang, number>> }) {
  const entries = (Object.entries(mix) as [Lang, number][]).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {entries.map(([l, v]) => <div key={l} style={{ width: `${v * 100}%`, background: LANG_COLOR[l] }} />)}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {entries.map(([l, v]) => <span key={l} className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: LANG_COLOR[l] }} />{LANG_LABEL[l]} {Math.round(v * 100)}%</span>)}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

export function Summary({ call }: { call: CallDetail }) {
  const m = call.metrics;
  const stats = m ? [
    { label: "Agent talk share", value: `${Math.round(m.talkRatio * 100)}%`, hint: "of speaking time" },
    { label: "Longest monologue", value: fmtDuration(m.longestMonologueSec), hint: "single speaker" },
    { label: "Silence", value: `${Math.round(m.silencePct * 100)}%`, hint: "of the call" },
    { label: "Questions asked", value: String(m.questionsAsked), hint: "by the agent" },
  ] : [];
  return (
    <div className="space-y-5">
      <Block title="Summary">{call.summary}</Block>
      <Block title="Outcome">
        <div className="mb-1.5"><OutcomeBadge label={call.outcome?.label ?? null} isSuccess={call.isSuccess} isNotApplicable={call.isNotApplicable} /></div>
        <p className="text-muted-foreground">{call.outcomeRationale}</p>
      </Block>
      <Block title="Call observations">{call.observations}</Block>
      <Block title="Areas for improvement">{call.improvements}</Block>
      {m && (
        <Block title="Conversation metrics">
          <div className="grid grid-cols-2 gap-2">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl border bg-background/40 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-semibold tabular">{s.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3"><p className="mb-1.5 text-xs text-muted-foreground">Language mix</p><LanguageMix mix={m.languageMix} /></div>
        </Block>
      )}
    </div>
  );
}

export function Extractions({ call }: { call: CallDetail }) {
  const fmt = (v: unknown, type: string) => (v == null ? <span className="text-muted-foreground">Not mentioned</span> : type === "number" ? `₹${Number(v).toLocaleString("en-IN")}` : type === "boolean" ? (v ? "Yes" : "No") : String(v).replace(/_/g, " "));
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Structured fields pulled from the conversation. They also drive which rubric sections apply.</p>
      <dl className="divide-y rounded-xl border">
        {call.extractionFields.map((f) => (
          <div key={f.fieldName} className="grid grid-cols-[1fr_1.2fr] gap-3 px-4 py-3 text-sm">
            <dt><span className="font-medium">{f.displayName}</span><span className="block text-xs text-muted-foreground">{f.description}</span></dt>
            <dd className="capitalize">{fmt(call.extractions?.[f.fieldName], f.fieldType)}</dd>
          </div>
        ))}
      </dl>
      {call.udfs && Object.keys(call.udfs).length > 0 && (
        <>
          <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dialer fields</p>
          <dl className="divide-y rounded-xl border text-sm">
            {Object.entries(call.udfs).map(([k, v]) => <div key={k} className="flex justify-between px-4 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="tabular">{String(v)}</dd></div>)}
          </dl>
        </>
      )}
    </div>
  );
}
