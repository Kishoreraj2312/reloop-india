/**
 * Rules and rule resolution (B4). Pure.
 *
 * Resolution order for one leaf component:
 *   component override (its own id, else its nearest assembly) -> material-category override -> template rule -> unknown
 *
 * A "template rule" is the rule the scenario's template gives the leaf's material category (see templates.ts). A rule of
 * kind "assessment" is then read against the component's B2 assessment to give the pathway and the recovery %.
 */

import { validatePct, type RecoveryAssessment } from "@/engine/recovery";
import { isRecoveryPathway, RULE_KINDS, RULE_LABELS, type MissingCode, type Pathway, type Residual, type Rule, type RuleKind, type Scenario } from "./types";

export const makeRule = (kind: RuleKind, recoveryPct: number | null = null, residual: Residual | null = null): Rule => ({
  kind,
  recoveryPct: kind !== "assessment" && isRecoveryPathway(kind) ? recoveryPct : null,
  residual: kind === "disposal" || kind === "unknown" ? null : residual,
});

export const DISPOSAL_RULE: Rule = Object.freeze(makeRule("disposal"));
export const UNKNOWN_RULE: Rule = Object.freeze(makeRule("unknown"));
export const ASSESSMENT_RULE: Rule = Object.freeze(makeRule("assessment"));

/** Error text for an invalid rule, or null. A recovery pathway may have no percentage yet (it is then reported as missing). */
export function validateRule(r: Rule, opts: { allowAssessment?: boolean } = { allowAssessment: true }): string | null {
  if (!(RULE_KINDS as readonly string[]).includes(r.kind)) return `Unknown pathway "${String(r.kind)}"`;
  if (r.kind === "assessment" && opts.allowAssessment === false) return "The baseline must be a pathway, not the B2 assessment";
  if (r.recoveryPct !== null) {
    if (r.kind === "assessment" || !isRecoveryPathway(r.kind)) return "A recovery % applies to reuse and recycling pathways only";
    const e = validatePct(r.recoveryPct);
    if (e) return e;
  }
  if (r.residual !== null && r.residual !== "disposal" && r.residual !== "unknown") return `Unknown residual destination "${String(r.residual)}"`;
  return null;
}

export const rulesEqual = (a: Rule | undefined, b: Rule | undefined): boolean => (a === undefined || b === undefined ? a === b : a.kind === b.kind && a.recoveryPct === b.recoveryPct && a.residual === b.residual);

export type RuleSource = "component" | "assembly" | "category" | "template" | "none";

export interface Resolved {
  readonly rule: Rule;
  readonly source: RuleSource;
  /** The component or assembly the override is on (source component / assembly). */
  readonly viaId?: string;
}

/** The rule the template itself gives a material category (before overrides). Null when it gives none. */
export function templateRule(s: Scenario, category: string): Rule | null {
  switch (s.template) {
    case "conventional":
      return s.baseline;
    case "selective":
      return s.scope?.includes(category) ? ASSESSMENT_RULE : s.baseline;
    case "reuse_first":
      return ASSESSMENT_RULE;
  }
}

/** `ancestors`: the leaf's assembly ancestors, nearest first. */
export function resolveRule(s: Scenario, id: string, ancestors: readonly string[], category: string): Resolved {
  const own = s.componentRules[id];
  if (own) return { rule: own, source: "component", viaId: id };
  for (const a of ancestors) {
    const r = s.componentRules[a];
    if (r) return { rule: r, source: "assembly", viaId: a };
  }
  const cat = s.categoryRules[category];
  if (cat) return { rule: cat, source: "category" };
  const t = templateRule(s, category);
  if (t) return { rule: t, source: "template" };
  return { rule: { kind: "unknown", recoveryPct: null, residual: null }, source: "none" };
}

export interface Effective {
  readonly pathway: Pathway;
  /** The percentage the pathway will use (from the rule or the B2 assessment); null = not configured. */
  readonly recoveryPct: number | null;
  readonly pctFrom: "rule" | "assessment" | null;
  readonly residual: Residual;
  /** Set when the quantity is unknown or unconfigured for a reason the user can fix. */
  readonly missing: MissingCode | null;
}

/** Read a resolved rule against the component's B2 assessment. */
export function effectiveOf(rule: Rule, assessment: RecoveryAssessment | undefined, s: Scenario): Effective {
  const residual = rule.residual ?? s.residual;
  if (rule.kind === "assessment") {
    const c = assessment?.classification ?? null;
    if (c === null) return { pathway: "unknown", recoveryPct: null, pctFrom: null, residual, missing: "not_assessed" };
    if (c === "further_assessment") return { pathway: "unknown", recoveryPct: null, pctFrom: null, residual, missing: "needs_assessment" };
    if (c === "insufficient_information") return { pathway: "unknown", recoveryPct: null, pctFrom: null, residual, missing: "insufficient_information" };
    const pct = assessment!.recoveryPct;
    const ok = pct !== null && validatePct(pct) === null;
    return { pathway: c, recoveryPct: ok ? pct : null, pctFrom: ok ? "assessment" : null, residual, missing: ok ? null : "pct_missing" };
  }
  if (rule.kind === "unknown") return { pathway: "unknown", recoveryPct: null, pctFrom: null, residual, missing: "undecided" };
  if (rule.kind === "disposal") return { pathway: "disposal", recoveryPct: null, pctFrom: null, residual, missing: null };
  const ok = rule.recoveryPct !== null && validatePct(rule.recoveryPct) === null;
  return { pathway: rule.kind, recoveryPct: ok ? rule.recoveryPct : null, pctFrom: ok ? "rule" : null, residual, missing: ok ? null : "pct_missing" };
}

/** Human-readable rule, e.g. "Material recycling at 70%", "Use the B2 assessment", "Disposal". */
export function describeRule(r: Rule, s?: Scenario): string {
  let t = RULE_LABELS[r.kind];
  if (r.kind !== "assessment" && isRecoveryPathway(r.kind)) t += r.recoveryPct === null ? " (no recovery % set)" : ` at ${r.recoveryPct}%`;
  const res = r.residual ?? s?.residual ?? null;
  if (res && r.kind !== "disposal" && r.kind !== "unknown") t += `, residual to ${res}`;
  return t;
}
