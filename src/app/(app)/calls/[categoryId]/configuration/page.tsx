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
import type { Rubric } from "@/lib/domain";
import type { Workspace } from "@/server/services/workspace";
import { cn } from "@/lib/utils";

const TABS = ["Sections & criteria", "Outcomes", "Extraction fields", "Targeting rules", "Versions"] as const;

/** Mockup: the rubric editor. Reads the live rubric; edits stay in local state (nothing is persisted). */
export default function ConfigurationPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const { data: ws } = useWorkspace();
  const cat = ws?.categories.find((c) => c.id === categoryId);
  return cat ? <Editor key={cat.id} cat={cat} /> : null;
}

function Editor({ cat }: { cat: Workspace["categories"][number] }) {
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
          {draft.sections.map((s, si) => {
            const rule = draft.targetingRules.find((r) => r.targetId === s.id);
            return (
              <Panel key={s.id} title={<Input value={s.name} onChange={(e) => edit((r) => { r.sections[si].name = e.target.value; })} className="h-8 max-w-md font-semibold" aria-label="Section name" />}
                actions={<div className="flex items-center gap-2">{rule && <Pill tone="info">Targeted · {rule.description}</Pill>}<span className="text-xs text-muted-foreground">{s.criteria.length} criteria</span></div>}>
                <ul className="space-y-3">
                  {s.criteria.map((c, ci) => (
                    <li key={c.id} className="grid gap-2 rounded-xl border bg-background/40 p-3 md:grid-cols-[1fr_auto]">
                      <div className="grid gap-2">
                        <Input value={c.question} onChange={(e) => edit((r) => { r.sections[si].criteria[ci].question = e.target.value; })} aria-label="Criterion question" />
                        <Textarea rows={1} value={c.context ?? ""} placeholder="What counts as evidence? (optional guidance for the model)" onChange={(e) => edit((r) => { r.sections[si].criteria[ci].context = e.target.value; })} className="text-sm" />
                        <code className="text-xs text-muted-foreground">{c.id}</code>
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
        <Panel title="Possible outcomes" description="The model picks exactly one per call. Success outcomes drive the success rate; N/A outcomes are excluded from it.">
          <ul className="divide-y">
            {draft.outcomes.map((o, oi) => (
              <li key={o.id} className="grid gap-2 py-3 md:grid-cols-[14rem_1fr_auto] md:items-center">
                <Input value={o.label} onChange={(e) => edit((r) => { r.outcomes[oi].label = e.target.value; })} aria-label="Outcome label" />
                <p className="text-sm text-muted-foreground">{o.description}</p>
                <Pill tone={o.isNotApplicable ? "muted" : o.isSuccess ? "success" : o.isSuccess === false ? "danger" : "info"}>{o.isNotApplicable ? "Not applicable" : o.isSuccess ? "Success" : o.isSuccess === false ? "Unsuccessful" : "Standard"}</Pill>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tab === "Extraction fields" && (
        <Panel title="Extraction fields" description="Structured data the model pulls from every call. Fields can drive targeting rules.">
          <ul className="divide-y">
            {draft.extractionFields.map((f) => (
              <li key={f.fieldName} className="grid gap-1 py-3 md:grid-cols-[14rem_6rem_1fr]">
                <span><span className="block font-medium">{f.displayName}</span><code className="text-xs text-muted-foreground">{f.fieldName}</code></span>
                <Pill className="w-fit">{f.fieldType}</Pill>
                <span className="text-sm text-muted-foreground">{f.description}{f.enumValues && <span className="mt-1 flex flex-wrap gap-1">{f.enumValues.map((v) => <Pill key={v} className="h-5 text-[11px]">{v}</Pill>)}</span>}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tab === "Targeting rules" && (
        <Panel title="Targeting rules" description="JSONLogic over extractions and outcome. A targeted section is only scored when its rule matches.">
          {draft.targetingRules.length === 0 && <p className="text-sm text-muted-foreground">No targeting rules — every section applies to every call.</p>}
          <div className="space-y-4">
            {draft.targetingRules.map((r) => (
              <div key={r.targetId} className="rounded-xl border p-4">
                <p className="font-medium">{draft.sections.find((s) => s.id === r.targetId)?.name} <span className="font-normal text-muted-foreground">— {r.description}</span></p>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs">{JSON.stringify(r.expression, null, 2)}</pre>
              </div>
            ))}
          </div>
        </Panel>
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
