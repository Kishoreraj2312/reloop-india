/**
 * Material reuse matching (C2) — data model.
 *
 * A requirement is the USER's statement of what a new project needs. It is matched against the existing components of the model
 * (B1 quantities, B2 recovery assessments, C1 observed condition); an allocation is the user's confirmed decision to plan a
 * quantity of one component for one requirement. Requirements and allocations are stored apart from the records, the B1
 * quantities, the B2 assessments and the C1 passports, which are only read: nothing here changes any of them.
 *
 * A match is PRELIMINARY. It compares what the model records with what the requirement states; it makes no claim about structural
 * suitability, code compliance, certification or fitness for purpose. A value that is not in the project data is "unknown" and
 * reduces certainty; it is never read as a match.
 */

import type { Category, Unit } from "@/engine/quantities";
import type { Classification } from "@/engine/recovery";

/** Units a requirement can be stated in: the B1 primary measures. Mass (kg) is a B2 basis, not a reuse measure. */
export const REQUIREMENT_UNITS: readonly Unit[] = ["m2", "m3", "m", "nr"];

// ── dimensions ───────────────────────────────────────────────────────────────

/**
 * Component sizes are compared by magnitude so that orientation does not matter: the three recorded extents are sorted, the
 * largest is the length, the middle one the width and the smallest the thickness (a door leaf 2034 × 634 × 35 mm, a tile
 * 600 × 400 × 10 mm). A component that records fewer than three extents only has a length. `diameter` is its own recorded field.
 */
export const AXES = ["length", "width", "thickness", "diameter"] as const;
export type Axis = (typeof AXES)[number];
export const AXIS_LABELS: Readonly<Record<Axis, string>> = { length: "Length (longest side)", width: "Width (middle side)", thickness: "Thickness (shortest side)", diameter: "Diameter" };
export const AXIS_SHORT: Readonly<Record<Axis, string>> = { length: "Length", width: "Width", thickness: "Thickness", diameter: "Diameter" };

/** A required range in metres; null = unbounded on that side. Both null = the axis is not specified. */
export interface Range {
  readonly min: number | null;
  readonly max: number | null;
}
export const NO_RANGE: Range = Object.freeze({ min: null, max: null });
export type DimRanges = Readonly<Record<Axis, Range>>;
export const NO_DIMS: DimRanges = Object.freeze({ length: NO_RANGE, width: NO_RANGE, thickness: NO_RANGE, diameter: NO_RANGE });
export const isSpecified = (r: Range): boolean => r.min !== null || r.max !== null;

// ── condition ────────────────────────────────────────────────────────────────

/** The lowest OBSERVED condition (C1) the requirement accepts. "any" asks for nothing, but a component recorded as damaged is never matched. */
export const MIN_CONDITIONS = ["any", "fair", "good"] as const;
export type MinCondition = (typeof MIN_CONDITIONS)[number];
export const MIN_CONDITION_LABELS: Readonly<Record<MinCondition, string>> = { any: "Not specified", fair: "Fair or better", good: "Good" };

// ── processing ───────────────────────────────────────────────────────────────

/** What the requirement is prepared to accept before the material can be used. A step that is needed but not accepted makes the component incompatible. */
export interface Acceptance {
  readonly cleaning: boolean;
  readonly refurbishment: boolean;
  /** Cutting an oversize piece down to the required length or width. */
  readonly cutting: boolean;
  /** Testing / inspection / further assessment before use. */
  readonly testing: boolean;
}
export const DEFAULT_ACCEPTANCE: Acceptance = Object.freeze({ cleaning: true, refurbishment: true, cutting: false, testing: true });
export const ACCEPTANCE_LABELS: Readonly<Record<keyof Acceptance, string>> = { cleaning: "Cleaning / de-fixing", refurbishment: "Refurbishment", cutting: "Cutting to size", testing: "Testing / inspection" };

/** A specification the model has no data for (grade, fire rating, certification …): it can never be verified here, so it keeps a match conditional. */
export interface ExtraSpec {
  readonly label: string;
  readonly value: string;
}

export const MAX_NAME = 80;
export const MAX_TEXT = 160;
export const MAX_NOTE = 1000;
export const MAX_EXTRA_SPECS = 8;

export interface Requirement {
  readonly id: string;
  readonly name: string;
  /** The intended application in the new project (free text). */
  readonly application: string;
  /** B2 "material category": the substance of the material (timber, stone, porcelain tile …). */
  readonly substance: string;
  /** B1 component category (floor tile, glazing, sanitary …); null = any form of that material. */
  readonly form: Category | null;
  /** The component type recorded in the model (basin, wc_pan, door_leaf, floor_tile …): a finer refinement of the form; null = any. */
  readonly componentType: string | null;
  /** One specific model material (finish / variant); null = any. A different variant of the same substance is a conditional match. */
  readonly materialId: string | null;
  readonly quantity: number;
  readonly unit: Unit;
  readonly dims: DimRanges;
  /** Dimensional tolerance in millimetres, applied to both ends of every range. */
  readonly toleranceMm: number;
  readonly minCondition: MinCondition;
  readonly accept: Acceptance;
  /** Consider structural elements. They are then always conditional: structural reuse needs a qualified assessment this tool cannot make. */
  readonly includeStructural: boolean;
  /** Consider components that have no reuse assessment yet (B2). They are conditional, and their quantity is the modelled upper bound. */
  readonly includeUnassessed: boolean;
  readonly extraSpecs: readonly ExtraSpec[];
  readonly note: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── criteria ─────────────────────────────────────────────────────────────────

export const CRITERIA = ["material", "dimensions", "quantity", "condition", "recovery", "processing", "specs"] as const;
export type CriterionKey = (typeof CRITERIA)[number];
export const CRITERION_LABELS: Readonly<Record<CriterionKey, string>> = {
  material: "Material",
  dimensions: "Dimensions",
  quantity: "Quantity",
  condition: "Condition",
  recovery: "Recovery",
  processing: "Processing",
  specs: "Other specs",
};
/** One-letter column heads for the compact compatibility strip. */
export const CRITERION_SHORT: Readonly<Record<CriterionKey, string>> = { material: "M", dimensions: "D", quantity: "Q", condition: "C", recovery: "R", processing: "P", specs: "S" };
export const CRITERION_HELP: Readonly<Record<CriterionKey, string>> = {
  material: "Material category, component form and (if given) the specific material variant",
  dimensions: "Recorded sizes against the required ranges; an oversize piece can be cut down only if cutting is accepted",
  quantity: "Unit and the quantity this component can supply (B2 recoverable estimate, else the modelled upper bound); points = share of the requirement it covers",
  condition: "Observed condition recorded in the C1 passport; the model's own 'condition' is a generated default and is not used",
  recovery: "B2 recovery assessment: reuse potential and a recovery estimate",
  processing: "Cleaning, refurbishment, testing or reprocessing the component needs before use (B2)",
  specs: "Other specifications you listed: the model has no data for them, so they cannot be verified here",
};

/** met = satisfied on project data; partial = achievable with a condition; unknown = no project data; unmet = fails (blocks the match); na = not part of this requirement. */
export const STATES = ["met", "partial", "unknown", "unmet", "na"] as const;
export type State = (typeof STATES)[number];
export const STATE_LABELS: Readonly<Record<State, string>> = { met: "Met", partial: "Conditional", unknown: "Unknown", unmet: "Not met", na: "Not required" };

/** The transparent, configurable part of the ranking. Weights are relative; a criterion the requirement does not use (state "na") drops out. */
export interface MatchConfig {
  readonly weights: Readonly<Record<CriterionKey, number>>;
  /** Share (0–1) of a criterion's weight earned when it is only achievable with a condition. */
  readonly partialCredit: number;
  /** Share (0–1) earned when the project data is missing. 0 = missing data counts as no evidence. */
  readonly unknownCredit: number;
}
export const DEFAULT_WEIGHTS: Readonly<Record<CriterionKey, number>> = Object.freeze({ material: 25, dimensions: 25, quantity: 10, condition: 10, recovery: 15, processing: 5, specs: 10 });
export const DEFAULT_CONFIG: MatchConfig = Object.freeze({ weights: DEFAULT_WEIGHTS, partialCredit: 0.5, unknownCredit: 0 });

// ── candidates ───────────────────────────────────────────────────────────────

export const TIERS = ["strong", "conditional", "incompatible"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABELS: Readonly<Record<Tier, string>> = { strong: "Strong", conditional: "Conditional", incompatible: "Incompatible" };
export const TIER_HELP: Readonly<Record<Tier, string>> = {
  strong: "Every criterion the requirement states is met on project data and nothing is outstanding",
  conditional: "No criterion fails, but something is missing, unverified or needs processing first",
  incompatible: "At least one criterion fails: the component cannot meet this requirement as stated",
};

/** A coded message, so that causes can be counted and grouped without parsing text. */
export interface Note {
  readonly code: string;
  readonly text: string;
}

/** One compared fact: what the requirement asks for against what the component has. */
export interface Line {
  readonly label: string;
  readonly required: string;
  readonly actual: string;
  readonly state: State;
  readonly note?: string;
}

export interface CriterionResult {
  readonly key: CriterionKey;
  readonly state: State;
  /** 0–1 share of the weight earned. */
  readonly points: number;
  readonly weight: number;
  /** Only filled by `explain` (the list view needs no text). */
  readonly lines: readonly Line[];
}

/** How the quantity a component can supply was derived. */
export type SupplyBasis = "recoverable" | "upper_bound" | "none";
export interface Supply {
  /** In the component's own B1 primary unit; null = no quantity. */
  readonly value: number | null;
  readonly unit: Unit;
  readonly basis: SupplyBasis;
  readonly note: string;
}

export interface Candidate {
  readonly id: string;
  readonly tier: Tier;
  /** 0–100 weighted score (see MatchConfig); null for an incompatible component. */
  readonly score: number | null;
  /** Criteria whose project data is known / criteria the requirement uses. */
  readonly known: number;
  readonly total: number;
  readonly states: Readonly<Record<CriterionKey, State>>;
  readonly supply: Supply;
  /** Criteria that fail: why the component is incompatible. */
  readonly blockers: readonly Note[];
  /** Things to do or accept before reuse (refurbishment, cutting, testing …). */
  readonly conditions: readonly Note[];
  /** Information the project data does not hold. */
  readonly missing: readonly Note[];
  /** Neutral remarks (not part of the tier). */
  readonly notes: readonly Note[];
  /** Full criterion rows: `explain` only. */
  readonly criteria?: readonly CriterionResult[];
}

// ── allocations ──────────────────────────────────────────────────────────────

/** What the match looked like when the allocation was confirmed: kept for review, and for C3 Recovery Tracking to compare plan with outcome. */
export interface AllocationBasis {
  readonly tier: Exclude<Tier, "incompatible">;
  readonly score: number | null;
  /** The component's supply when confirmed. */
  readonly supply: number | null;
  readonly supplyBasis: SupplyBasis;
  readonly classification: Classification | null;
  readonly conditions: readonly string[];
  readonly missing: readonly string[];
}

export interface Allocation {
  readonly id: string;
  readonly requirementId: string;
  readonly componentId: string;
  /** In the requirement's (and the component's primary) unit. */
  readonly quantity: number;
  readonly unit: Unit;
  readonly note: string;
  readonly basis: AllocationBasis;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An allocation that no longer holds on the current data. The allocation is kept and flagged, never silently changed. */
export const REVIEW_CODES = ["missing_component", "unit_changed", "over_supply", "now_incompatible", "now_conditional"] as const;
export type ReviewCode = (typeof REVIEW_CODES)[number];
export const REVIEW_LABELS: Readonly<Record<ReviewCode, string>> = {
  missing_component: "Component is not in the model",
  unit_changed: "Unit no longer matches",
  over_supply: "More allocated than the component can supply",
  now_incompatible: "No longer compatible",
  now_conditional: "Match has weakened since it was confirmed",
};
export interface ReviewFlag {
  readonly code: ReviewCode;
  readonly text: string;
  /** over_supply: the quantity that still fits. */
  readonly fits?: number;
}
export interface Review {
  readonly allocationId: string;
  readonly flags: readonly ReviewFlag[];
}

export type DemandStatus = "unmet" | "partial" | "matched" | "over";
export const DEMAND_LABELS: Readonly<Record<DemandStatus, string>> = { unmet: "Unmet", partial: "Partially matched", matched: "Matched", over: "Over-allocated" };
