/**
 * End-of-life scenarios (B4) — data model.
 *
 * A scenario is the USER's set of assumptions about what happens to the building's materials. It stores rules and
 * overrides only: never quantities, assessments or cached results. B1 quantities remain the source of truth, B2
 * assessments provide starting assumptions, and B3 removal plans are planning context only (they never prove that
 * anything has been removed). Pathways are planning categories, not certified waste-management decisions.
 */

export const PATHWAYS = ["direct_reuse", "refurbish_reuse", "recycling", "disposal", "unknown"] as const;
export type Pathway = (typeof PATHWAYS)[number];

export const PATHWAY_LABELS: Readonly<Record<Pathway, string>> = {
  direct_reuse: "Direct reuse",
  refurbish_reuse: "Reuse after refurbishment",
  recycling: "Material recycling",
  disposal: "Disposal",
  unknown: "Unknown / undecided",
};
export const PATHWAY_SHORT: Readonly<Record<Pathway, string>> = {
  direct_reuse: "Direct reuse",
  refurbish_reuse: "Refurbished reuse",
  recycling: "Recycling",
  disposal: "Disposal",
  unknown: "Unknown",
};

/** Pathways that recover material and therefore need a recovery percentage. */
export const RECOVERY_PATHWAYS: readonly Pathway[] = ["direct_reuse", "refurbish_reuse", "recycling"];
export const isRecoveryPathway = (p: Pathway): boolean => p === "direct_reuse" || p === "refurbish_reuse" || p === "recycling";

/** Where the unrecovered share of a recovery pathway goes. */
export const RESIDUALS = ["disposal", "unknown"] as const;
export type Residual = (typeof RESIDUALS)[number];
export const RESIDUAL_LABELS: Readonly<Record<Residual, string>> = { disposal: "Disposal", unknown: "Unknown" };

/** "assessment": take the classification and recovery % from the component's own B2 assessment. */
export type RuleKind = Pathway | "assessment";
export const RULE_KINDS: readonly RuleKind[] = ["assessment", ...PATHWAYS];
export const RULE_LABELS: Readonly<Record<RuleKind, string>> = { ...PATHWAY_LABELS, assessment: "Use the B2 assessment" };

export interface Rule {
  readonly kind: RuleKind;
  /** 0–100, net of expected loss. Only meaningful for recovery pathways; null = not configured (never invented). */
  readonly recoveryPct: number | null;
  /** Destination of the unrecovered share; null = the scenario's default. */
  readonly residual: Residual | null;
}

export const TEMPLATES = ["conventional", "selective", "reuse_first"] as const;
export type TemplateId = (typeof TEMPLATES)[number];

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly template: TemplateId;
  /** Default destination of the unrecovered share of every recovery pathway. */
  readonly residual: Residual;
  /** Treatment of components the template does not otherwise cover (conventional: everything; selective: outside the scope). */
  readonly baseline: Rule;
  /** Selective deconstruction: the material categories whose B2 assessments are applied. null = not used by the template. */
  readonly scope: readonly string[] | null;
  /** Material category (B2 "material category" = the material's substance) -> rule. */
  readonly categoryRules: Readonly<Record<string, Rule>>;
  /** Component or assembly id -> rule. An assembly rule applies to its parts unless a part has its own rule. */
  readonly componentRules: Readonly<Record<string, Rule>>;
}

/** Per-pathway quantities in one unit. */
export type PathwayQuantities = Readonly<Record<Pathway, number>>;

/** Why a quantity is unknown (or why a pathway is not fully configured). Also the codes of "missing assumptions". */
export const MISSING_CODES = ["pct_missing", "not_assessed", "needs_assessment", "insufficient_information", "undecided"] as const;
export type MissingCode = (typeof MISSING_CODES)[number];

export const MISSING_LABELS: Readonly<Record<MissingCode, string>> = {
  pct_missing: "Recovery pathway chosen but no recovery % set",
  not_assessed: "Follows the B2 assessment but is not assessed",
  needs_assessment: "B2: requires further assessment",
  insufficient_information: "B2: insufficient information",
  undecided: "Left undecided by the scenario's rules",
};
