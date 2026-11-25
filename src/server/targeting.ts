import jsonLogic from "json-logic-js";
import type { CriterionResultValue, Rubric } from "@/lib/domain";

export type RuleContext = {
  outcome: { id: string; isSuccess: boolean; isNotApplicable: boolean };
  extractions: Record<string, unknown>;
  criteria?: Record<string, CriterionResultValue>;
};

const matches = (expression: unknown, ctx: RuleContext) => Boolean(jsonLogic.apply(expression as jsonLogic.RulesLogic, ctx as never));
const ruleFor = (rubric: Rubric, type: "section" | "criterion", id: string) => rubric.targetingRules.find((r) => r.targetType === type && r.targetId === id);

/**
 * For every rubric criterion: is it applicable on this call? Section and criterion rules that don't match make
 * the criterion NA ("configured to become NA when certain conditions are met"), with the rule's description as reason.
 */
export function criterionApplicability(rubric: Rubric, ctx: RuleContext) {
  return rubric.sections.flatMap((s) => {
    const sRule = ruleFor(rubric, "section", s.id);
    const sectionNa = sRule && !matches(sRule.expression, ctx) ? sRule.description : null;
    return s.criteria.map((c) => {
      const cRule = ruleFor(rubric, "criterion", c.id);
      const naReason = sectionNa ?? (cRule && !matches(cRule.expression, ctx) ? cRule.description : null);
      return { sectionId: s.id, criterionId: c.id, naReason, ruleLevel: sectionNa ? ("section" as const) : naReason ? ("criterion" as const) : null };
    });
  });
}

/** Sections that apply to a call (any section whose own rule matches). */
export function applicableSections(rubric: Rubric, ctx: RuleContext) {
  return rubric.sections.filter((s) => {
    const rule = ruleFor(rubric, "section", s.id);
    return rule ? matches(rule.expression, ctx) : true;
  });
}

/** Tags applied automatically from extracted data, the outcome and rubric answers. */
export function evaluateTags(rubric: Rubric, ctx: RuleContext): string[] {
  return [...new Set(rubric.targetingRules.filter((r) => r.targetType === "tag" && matches(r.expression, ctx)).map((r) => r.targetId))];
}
