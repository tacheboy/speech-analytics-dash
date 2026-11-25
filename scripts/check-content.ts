/* Validates authored content: every template must be consistent with its category rubric. */
import { loadRubrics, loadTemplates } from "@/server/content";
import { criterionApplicability } from "@/server/targeting";
import { loadTagDefs } from "@/server/content";

const rubrics = new Map(loadRubrics().map((r) => [r.id, r]));
const tagSlugs = new Set(loadTagDefs().map((t) => t.slug));
for (const r of rubrics.values()) {
  for (const s of r.tagTargets) if (!tagSlugs.has(s)) { console.error(`✗ ${r.id}: tag ${s} is not in content/tags.json`); process.exitCode = 1; }
  for (const rule of r.targetingRules) {
    const ok = rule.targetType === "tag" ? r.tagTargets.includes(rule.targetId) : rule.targetType === "section" ? r.sections.some((s) => s.id === rule.targetId) : r.sections.some((s) => s.criteria.some((c) => c.id === rule.targetId));
    if (!ok) { console.error(`✗ ${r.id}: ${rule.targetType} rule targets unknown ${rule.targetId}`); process.exitCode = 1; }
  }
}
const only = process.argv[2];
let errors = 0;
const fail = (id: string, msg: string) => { errors++; console.error(`✗ ${id}: ${msg}`); };

for (const t of loadTemplates().filter((t) => !only || t.id.startsWith(only))) {
  const r = rubrics.get(t.categoryId);
  if (!r) { fail(t.id, `unknown category ${t.categoryId}`); continue; }
  const a = t.analysis;
  const outcome = r.outcomes.find((o) => o.id === a.outcomeId);
  if (!outcome) { fail(t.id, `unknown outcome ${a.outcomeId}`); continue; }
  for (const f of r.extractionFields) {
    const v = a.extractions[f.fieldName];
    if (v === undefined) fail(t.id, `missing extraction ${f.fieldName} (use null if not mentioned)`);
    else if (v !== null && f.fieldType === "enum" && !f.enumOptions!.some((o) => o.value === String(v))) fail(t.id, `${f.fieldName}=${v} not in enum`);
    else if (v !== null && f.fieldType === "number" && typeof v !== "number") fail(t.id, `${f.fieldName} must be a number`);
    else if (v !== null && f.fieldType === "boolean" && typeof v !== "boolean") fail(t.id, `${f.fieldName} must be boolean`);
  }
  for (const k of Object.keys(a.extractions)) if (!r.extractionFields.some((f) => f.fieldName === k)) fail(t.id, `unknown extraction ${k}`);
  const applicability = outcome.isNotApplicable ? [] : criterionApplicability(r, { outcome, extractions: a.extractions });
  const expected = new Set(applicability.filter((x) => !x.naReason).map((x) => x.criterionId));
  // criteria made NA by a criterion-level rule may still be authored; they are ignored at analysis time
  const ruleNa = new Set(applicability.filter((x) => x.ruleLevel === "criterion").map((x) => x.criterionId));
  for (const id of expected) if (!a.criteria[id]) fail(t.id, `missing criterion ${id}`);
  for (const [id, c] of Object.entries(a.criteria)) {
    if (!expected.has(id) && !ruleNa.has(id)) fail(t.id, `criterion ${id} not applicable for this call (check targeting / outcome)`);
    if (c.line !== null && (c.line < 0 || c.line >= t.lines.length)) fail(t.id, `${id} evidence line ${c.line} out of range`);
  }
  for (const m of a.moments) if (m.line < 0 || m.line >= t.lines.length) fail(t.id, `moment line ${m.line} out of range`);
  t.lines.forEach((l, i) => {
    const native = /[஀-௿ಀ-೿ऀ-ॿ]/.test(l.text);
    if (l.speaker === "agent" && native) fail(t.id, `line ${i}: agent lines must be romanised (TTS voice is en-IN)`);
    if (native && !l.roman) fail(t.id, `line ${i}: native-script line needs "roman"`);
  });
}
const n = loadTemplates().length;
console.log(errors ? `\n${errors} error(s)` : `✓ ${n} templates valid`);
process.exit(errors || process.exitCode ? 1 : 0);
