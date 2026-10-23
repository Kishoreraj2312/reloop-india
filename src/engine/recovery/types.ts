/**
 * Recovery & reuse assessment (B2) — data model.
 *
 * An assessment is the USER's planning input about one leaf component. It is stored apart from the
 * component records and from the B1 quantities, which stay the source of truth. Classifications are
 * planning categories, not certified judgements about condition, safety or compliance.
 */

export const CLASSIFICATIONS = ["direct_reuse", "refurbish_reuse", "recycling", "further_assessment", "insufficient_information"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABELS: Readonly<Record<Classification, string>> = {
  direct_reuse: "Potential for direct reuse",
  refurbish_reuse: "Potential for refurbishment before reuse",
  recycling: "Potential for material recycling",
  further_assessment: "Requires further assessment",
  insufficient_information: "Insufficient information",
};

/** Short labels for tables and chips. */
export const CLASSIFICATION_SHORT: Readonly<Record<Classification | "unassessed", string>> = {
  direct_reuse: "Direct reuse",
  refurbish_reuse: "Refurbish, reuse",
  recycling: "Recycling",
  further_assessment: "Further assessment",
  insufficient_information: "Insufficient info",
  unassessed: "Not assessed",
};

/** Only these classifications produce an estimated recoverable quantity (and need a recovery %). */
export const RECOVERABLE_CLASSES: ReadonlySet<Classification> = new Set<Classification>(["direct_reuse", "refurbish_reuse", "recycling"]);
export const isRecoverableClass = (c: Classification | null): c is Classification => c !== null && RECOVERABLE_CLASSES.has(c);

export const DESTINATIONS = ["reuse_same_building", "reuse_other_project", "refurbish_and_reuse", "material_recycling", "further_inspection"] as const;
export type Destination = (typeof DESTINATIONS)[number];
export const DESTINATION_LABELS: Readonly<Record<Destination, string>> = {
  reuse_same_building: "Reuse within the same building",
  reuse_other_project: "Reuse in another project",
  refurbish_and_reuse: "Refurbishment and reuse",
  material_recycling: "Material recycling",
  further_inspection: "Further inspection before deciding",
};

export const PREPARATIONS = ["none", "cleaning", "refurbishment", "reprocessing"] as const;
export type Preparation = (typeof PREPARATIONS)[number];
export const PREPARATION_LABELS: Readonly<Record<Preparation, string>> = {
  none: "None expected",
  cleaning: "Cleaning / de-fixing",
  refurbishment: "Refurbishment",
  reprocessing: "Reprocessing (crushing, melting, ...)",
};

export interface RecoveryAssessment {
  /** null = not assessed. */
  readonly classification: Classification | null;
  /**
   * Estimated share (0–100) of the available quantity expected to be recovered, NET of expected
   * loss or damage. Loss is deliberately not a second factor: it would double-count.
   */
  readonly recoveryPct: number | null;
  readonly preparation: Preparation | null;
  readonly destination: Destination | null;
  /** Free text about expected loss / damage. Informational: never applied to a quantity. */
  readonly lossNote: string;
  readonly note: string;
}

export const EMPTY_ASSESSMENT: RecoveryAssessment = Object.freeze({ classification: null, recoveryPct: null, preparation: null, destination: null, lossNote: "", note: "" });

export type AssessmentPatch = Partial<RecoveryAssessment>;
/** Sparse: only components the user has edited have an entry. */
export type Assessments = ReadonlyMap<string, RecoveryAssessment>;

export const isEmptyAssessment = (a: RecoveryAssessment): boolean =>
  a.classification === null && a.recoveryPct === null && a.preparation === null && a.destination === null && a.lossNote === "" && a.note === "";

/** What is quantified: the B1 primary quantity in its own unit, or the B1 estimated mass (kg). */
export type Basis = "quantity" | "mass";
