"use client";

import { GitBranch, Plus, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DemoBadge, PageHeader, Panel, Pill } from "@/components/app/bits";
import { useWorkspace } from "@/lib/api-client";
import { OUTCOME_TYPE_LABEL, outcomeType, type Rubric } from "@/lib/domain";
import type { Workspace } from "@/server/services/workspace";
import { cn } from "@/lib/utils";

const TABS = ["Sections & criteria", "Outcomes", "Extraction fields", "Targeting rules", "Versions"] as const;

/** Mockup: the rubric editor. Reads the live rubric; edits stay in local state (nothing is persisted). */
export default function ConfigurationPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const { data: ws } = useWorkspace();
  const cat = ws?.categories.find((c) => c.id === categoryId);
  return cat && ws ? <Editor key={cat.id} cat={cat} tags={ws.tags} /> : null;
}

function Editor({ cat, tags }: { cat: Workspace["categories"][number]; tags: Workspace["tags"] }) {
  const tagName = (slug: string) => slug.split("/").map((_, i, a) => tags.find((x) => x.slug === a.slice(0, i + 1).join("/"))?.displayName ?? a[i]).join(" › ");
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);
  const [draft, setDraft] = useState<Rubric>(() => structuredClone(cat.rubric));
  const [dirty, setDirty] = useState(false);

  const edit = (fn: (r: Rubric) => void) => { setDraft((d) => { const n = structuredClone(d); fn(n); return n; }); setDirty(true); };

  return (
    <>
      <PageHeader title={`${cat.name} · configuration`} description="The rubric every call in this category is scored against." actions={<><DemoBadge /><Button variant="outline" disabled={!dirty} onClick={() => { setDraft(structuredClone(cat.rubric)); setDirty(false); }}>Discard</Button><Button disabled={!dirty} onClick={() => { toast.success(`Published version ${cat.rubricVersion + 1} (demo — not persisted). New calls would use it.`); setDirty(false); }}>Publish version {cat.rubricVersion + 1}</Button></>}>
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><GitBranch className="size-4" /> Active: version {cat.rubricVersion} {dirty ? <Pill tone="warning">Unpublished changes</Pill> : <Pill tone="success">Draft matches published</Pill>}</div>
      </PageHeader>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", tab === t ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{t}</button>)}
      </div>

      {tab === "Sections & criteria" && (
        <div className="space-y-4">
          <Panel title="About this category" description="Context the model receives with every call in this category.">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">Intended purpose<Textarea rows={3} value={draft.intendedPurpose} onChange={(e) => edit((r) => { r.intendedPurpose = e.target.value; })} /></label>
              <label className="grid gap-1.5 text-sm font-medium">Additional LLM context<Textarea rows={3} value={draft.additionalLLMContext} onChange={(e) => edit((r) => { r.additionalLLMContext = e.target.value; })} /></label>
            </div>
          </Panel>
          {draft.sections.map((s, si) => {
            const rule = draft.targetingRules.find((r) => r.targetType === "section" && r.targetId === s.id);
            return (
              <Panel key={s.id} title={<Input value={s.name} onChange={(e) => edit((r) => { r.sections[si].name = e.target.value; })} className="h-8 max-w-md font-semibold" aria-label="Section name" />}
                actions={<div className="flex items-center gap-2">{rule && <Pill tone="info">Targeted · {rule.description}</Pill>}<span className="text-xs text-muted-foreground">{s.criteria.length} criteria</span></div>}>
                <ul className="space-y-3">
                  {s.criteria.map((c, ci) => (
                    <li key={c.id} className="grid gap-2 rounded-xl border bg-background/40 p-3 md:grid-cols-[1fr_auto]">
                      <div className="grid gap-2">
                        <Input value={c.question} onChange={(e) => edit((r) => { r.sections[si].criteria[ci].question = e.target.value; })} aria-label="Criterion question" />
                        <Textarea rows={1} value={c.context ?? ""} placeholder="What counts as evidence? (optional guidance for the model)" onChange={(e) => edit((r) => { r.sections[si].criteria[ci].context = e.target.value; })} className="text-sm" />
                        <span className="flex flex-wrap items-center gap-2"><code className="text-xs text-muted-foreground">{c.id}</code>{draft.targetingRules.some((r) => r.targetType === "criterion" && r.targetId === c.id) && <Pill tone="info" className="h-5 text-[11px]">NA by rule: {draft.targetingRules.find((r) => r.targetType === "criterion" && r.targetId === c.id)!.description}</Pill>}</span>
                      </div>
                      <Button variant="ghost" size="icon" aria-label="Delete criterion" onClick={() => edit((r) => { r.sections[si].criteria.splice(ci, 1); })}><Trash2 className="size-4" /></Button>
                    </li>
                  ))}
                </ul>
                <Button variant="outline" size="sm" className="mt-3 gap-1.5" disabled={s.criteria.length >= 30} onClick={() => edit((r) => { r.sections[si].criteria.push({ id: `custom_${Date.now()}`, question: "Did the agent…?" }); })}><Plus className="size-3.5" /> Add criterion</Button>
              </Panel>
            );
          })}
        </div>
      )}

      {tab === "Outcomes" && (
        <Panel title="Possible outcomes" description="Exactly one per call. Success = objective achieved; Standard = valid but not successful; NA = tracked but excluded from quality score and success rate.">
          <ul className="divide-y">
            {draft.outcomes.map((o, oi) => (
              <li key={o.id} className="grid gap-2 py-3 md:grid-cols-[14rem_1fr_auto] md:items-center">
                <Input value={o.label} onChange={(e) => edit((r) => { r.outcomes[oi].label = e.target.value; })} aria-label="Outcome label" />
                <p className="text-sm text-muted-foreground">{o.description}</p>
                <div className="inline-flex rounded-lg border p-0.5 text-xs" role="radiogroup" aria-label={`${o.label} type`}>
                  {(["success", "standard", "na"] as const).map((ty) => (
                    <button key={ty} role="radio" aria-checked={outcomeType(o) === ty} onClick={() => edit((r) => { r.outcomes[oi].isSuccess = ty === "success"; r.outcomes[oi].isNotApplicable = ty === "na"; })}
                      className={cn("rounded-md px-2.5 py-1", outcomeType(o) === ty ? (ty === "success" ? "bg-success/15 text-success" : ty === "na" ? "bg-muted" : "bg-info/15 text-info") : "text-muted-foreground")}>{OUTCOME_TYPE_LABEL[ty]}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tab === "Extraction fields" && (
        <Panel title="Extraction fields" description="Structured data the model pulls from every call. Fields can drive targeting rules.">
          <ul className="divide-y">
            {draft.extractionFields.map((f) => (
              <li key={f.fieldName} className="grid gap-1 py-3 md:grid-cols-[14rem_7rem_1fr]">
                <span><span className="block font-medium">{f.displayName}{f.required && <span className="ml-1.5 text-xs text-danger">required</span>}</span><code className="text-xs text-muted-foreground">{f.fieldName}</code></span>
                <Pill className="w-fit">{{ text: "Free text", enum: "Choice", number: "Number", boolean: "Yes / No" }[f.fieldType]}</Pill>
                <span className="text-sm text-muted-foreground">{f.description}{f.enumOptions && <span className="mt-1 flex flex-wrap gap-1">{f.enumOptions.map((o) => <Pill key={o.value} className="h-5 text-[11px]" title={o.hint}>{o.value}{o.hint ? " ⓘ" : ""}</Pill>)}</span>}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tab === "Targeting rules" && (
        <div className="space-y-4">
          {([
            ["section", "Section rules", "The whole section becomes NA unless the rule matches."],
            ["criterion", "Criterion rules", "A single question becomes NA unless the rule matches (“configured to become NA when certain conditions are met”)."],
            ["tag", "Tag rules", "The tag is applied when the rule matches. Rules can read extracted data, the outcome and rubric answers (criteria.<id> = pass | fail | na)."],
          ] as const).map(([type, title, desc]) => {
            const rules = draft.targetingRules.filter((r) => r.targetType === type);
            const name = (id: string) => type === "section" ? draft.sections.find((s) => s.id === id)?.name : type === "criterion" ? draft.sections.flatMap((s) => s.criteria).find((c) => c.id === id)?.question : tagName(id);
            return (
              <Panel key={type} title={`${title} (${rules.length})`} description={desc}>
                {rules.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
                  <ul className="divide-y">
                    {rules.map((r) => (
                      <li key={r.targetId} className="grid gap-2 py-3 lg:grid-cols-[1fr_1.1fr]">
                        <div><p className="text-sm font-medium">{name(r.targetId) ?? r.targetId}</p><p className="text-xs text-muted-foreground">{r.description}</p></div>
                        <pre className="overflow-x-auto rounded-lg bg-muted/60 p-2.5 text-[11px] leading-snug">{JSON.stringify(r.expression)}</pre>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {tab === "Versions" && (
        <Panel title="Config versions" description="Published snapshots. Each call stores the version it was scored with, so trends stay comparable.">
          <ul className="divide-y text-sm">
            <li className="flex items-center justify-between py-3"><span>Version {cat.rubricVersion} <Pill tone="success" className="ml-2">Active</Pill></span><span className="text-muted-foreground">Published at seed time</span></li>
            {dirty && <li className="flex items-center justify-between py-3"><span>Draft <Pill tone="warning" className="ml-2">Unpublished</Pill></span><span className="text-muted-foreground">Local changes</span></li>}
          </ul>
        </Panel>
      )}
    </>
  );
}
