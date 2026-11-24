import jsonLogic from "json-logic-js";
import type { Rubric } from "@/lib/domain";

type Ctx = { outcome: { id: string; isSuccess: boolean | null; isNotApplicable: boolean }; extractions: Record<string, unknown> };

/** Returns the rubric sections that apply to a call, after evaluating JSONLogic targeting rules. */
export function applicableSections(rubric: Rubric, ctx: Ctx) {
  return rubric.sections.filter((s) => {
    const rule = rubric.targetingRules.find((r) => r.targetType === "section" && r.targetId === s.id);
    return rule ? Boolean(jsonLogic.apply(rule.expression as jsonLogic.RulesLogic, ctx)) : true;
  });
}
