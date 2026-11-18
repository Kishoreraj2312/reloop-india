/** Creating and validating requirements (C2). Pure and immutable: an invalid input returns an error and no requirement. */

import { CATEGORIES, type Category, type InventoryRow } from "@/engine/quantities";
import { substanceOf } from "@/engine/recovery";
import { supplyOf } from "./source";
import {
  AXES,
  DEFAULT_ACCEPTANCE,
  MAX_EXTRA_SPECS,
  MAX_NAME,
  MAX_NOTE,
  MAX_TEXT,
  MIN_CONDITIONS,
  NO_DIMS,
  REQUIREMENT_UNITS,
  type Acceptance,
  type CriterionKey,
  type DimRanges,
  type ExtraSpec,
  type MatchConfig,
  CRITERIA,
  DEFAULT_CONFIG,
  type Range,
  type Requirement,
} from "./types";
import type { RecoveryAssessment } from "@/engine/recovery";

export interface RequirementDraft {
  readonly name: string;
  readonly application: string;
  readonly substance: string;
  readonly form: Category | null;
  readonly componentType: string | null;
  readonly materialId: string | null;
  readonly quantity: number;
  readonly unit: Requirement["unit"];
  readonly dims: DimRanges;
  readonly toleranceMm: number;
  readonly minCondition: Requirement["minCondition"];
  readonly accept: Acceptance;
  readonly includeStructural: boolean;
  readonly includeUnassessed: boolean;
  readonly extraSpecs: readonly ExtraSpec[];
  readonly note: string;
}

export const EMPTY_DRAFT: RequirementDraft = Object.freeze({
  name: "",
  application: "",
  substance: "",
  form: null,
  componentType: null,
  materialId: null,
  quantity: 1,
  unit: "m2",
  dims: NO_DIMS,
  toleranceMm: 5,
  minCondition: "any",
  accept: DEFAULT_ACCEPTANCE,
  includeStructural: false,
  includeUnassessed: true,
  extraSpecs: Object.freeze([]),
  note: "",
});

const finiteNonNeg = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Error text for an invalid range, or null. */
function rangeError(axis: string, r: Range): string | null {
  for (const [side, v] of [["minimum", r.min], ["maximum", r.max]] as const) if (v !== null && !finiteNonNeg(v)) return `${axis}: ${side} must be a number ≥ 0`;
  if (r.min !== null && r.max !== null && r.min > r.max) return `${axis}: minimum is larger than maximum`;
  return null;
}

/** Error text for an invalid draft, or null. */
export function validateDraft(d: RequirementDraft): string | null {
  if (typeof d.name !== "string" || d.name.trim() === "") return "Give the requirement a name";
  if (d.name.length > MAX_NAME) return `Name is too long (at most ${MAX_NAME} characters)`;
  if (typeof d.application !== "string" || d.application.length > MAX_TEXT) return `Application is too long (at most ${MAX_TEXT} characters)`;
  if (typeof d.substance !== "string" || d.substance === "") return "Choose a material category";
  if (d.form !== null && !(CATEGORIES as readonly string[]).includes(d.form)) return "Unknown component form";
  if (d.componentType !== null && (typeof d.componentType !== "string" || d.componentType === "" || d.componentType.length > 60)) return "Unknown component type";
  if (!(REQUIREMENT_UNITS as readonly string[]).includes(d.unit)) return "Choose a unit";
  if (typeof d.quantity !== "number" || !Number.isFinite(d.quantity) || d.quantity <= 0) return "Required quantity must be a number above 0";
  if (d.unit === "nr" && !Number.isInteger(d.quantity)) return "A count must be a whole number";
  for (const a of AXES) {
    const e = rangeError(a, d.dims[a]);
    if (e) return e;
  }
  if (!finiteNonNeg(d.toleranceMm) || d.toleranceMm > 100) return "Tolerance must be between 0 and 100 mm";
  if (!(MIN_CONDITIONS as readonly string[]).includes(d.minCondition)) return "Unknown minimum condition";
  if (d.extraSpecs.length > MAX_EXTRA_SPECS) return `At most ${MAX_EXTRA_SPECS} other specifications`;
  for (const s of d.extraSpecs) {
    if (s.label.trim() === "") return "Every other specification needs a name";
    if (s.label.length > 60 || s.value.length > MAX_TEXT) return "An other specification is too long";
  }
  if (d.note.length > MAX_NOTE) return `Note is too long (at most ${MAX_NOTE} characters)`;
  return null;
}

/** Trim and de-blank the free-text parts of a draft (the stored form). */
function tidy(d: RequirementDraft): RequirementDraft {
  return {
    ...d,
    name: d.name.trim(),
    application: d.application.trim(),
    note: d.note.trim(),
    extraSpecs: d.extraSpecs.map((s) => ({ label: s.label.trim(), value: s.value.trim() })),
  };
}

export interface RequirementEdit {
  readonly requirement: Requirement | null;
  readonly error: string | null;
}

export function createRequirement(id: string, draft: RequirementDraft, now: string): RequirementEdit {
  const error = validateDraft(draft);
  if (error) return { requirement: null, error };
  return { requirement: Object.freeze({ ...tidy(draft), id, createdAt: now, updatedAt: now }), error: null };
}

/** Replace the fields of a requirement from a draft (id and creation time are kept). */
export function updateRequirement(req: Requirement, draft: RequirementDraft, now: string): RequirementEdit {
  const error = validateDraft(draft);
  if (error) return { requirement: null, error };
  const next: Requirement = { ...tidy(draft), id: req.id, createdAt: req.createdAt, updatedAt: now };
  return { requirement: JSON.stringify(strip(next)) === JSON.stringify(strip(req)) ? req : Object.freeze(next), error: null };
}

const strip = (r: Requirement) => ({ ...r, updatedAt: "" });

export const draftOf = (r: Requirement): RequirementDraft => ({
  name: r.name,
  application: r.application,
  substance: r.substance,
  form: r.form,
  componentType: r.componentType,
  materialId: r.materialId,
  quantity: r.quantity,
  unit: r.unit,
  dims: r.dims,
  toleranceMm: r.toleranceMm,
  minCondition: r.minCondition,
  accept: r.accept,
  includeStructural: r.includeStructural,
  includeUnassessed: r.includeUnassessed,
  extraSpecs: r.extraSpecs,
  note: r.note,
});

/**
 * A starting point from a real component: its material category, form and unit, and a quantity equal to what it can supply
 * (or 1). Sizes are left empty: the requirement states the sizes the NEW project needs, not the ones this component happens to have.
 */
export function draftFromComponent(row: InventoryRow, a: RecoveryAssessment | undefined): RequirementDraft {
  const s = supplyOf(row, a);
  const unit = row.q.primary.unit;
  const supply = s.value !== null && s.value > 0 ? s.value : 1;
  return {
    ...EMPTY_DRAFT,
    name: `Reuse of ${row.rec.componentType.replace(/_/g, " ")}`,
    substance: substanceOf(row.rec.materialId),
    form: row.q.category,
    componentType: row.rec.componentType,
    unit: (REQUIREMENT_UNITS as readonly string[]).includes(unit) ? unit : "nr",
    quantity: unit === "nr" ? Math.max(1, Math.floor(supply)) : Number(supply.toPrecision(3)),
  };
}

// ── matching configuration ───────────────────────────────────────────────────

export function validateConfig(c: MatchConfig): string | null {
  let sum = 0;
  for (const k of CRITERIA) {
    const w = c.weights[k];
    if (typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > 100) return `Weight of "${k}" must be between 0 and 100`;
    sum += w;
  }
  if (sum <= 0) return "At least one weight must be above 0";
  for (const [n, v] of [["Conditional credit", c.partialCredit], ["Unknown credit", c.unknownCredit]] as const) if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return `${n} must be between 0 and 1`;
  return null;
}

export function withWeight(c: MatchConfig, key: CriterionKey, weight: number): { config: MatchConfig; error: string | null } {
  const next: MatchConfig = { ...c, weights: { ...c.weights, [key]: weight } };
  const error = validateConfig(next);
  return error ? { config: c, error } : { config: next, error: null };
}

export const isDefaultConfig = (c: MatchConfig): boolean => c.partialCredit === DEFAULT_CONFIG.partialCredit && c.unknownCredit === DEFAULT_CONFIG.unknownCredit && CRITERIA.every((k) => c.weights[k] === DEFAULT_CONFIG.weights[k]);
