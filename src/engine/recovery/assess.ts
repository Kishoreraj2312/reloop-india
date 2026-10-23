/**
 * Recovery calculations (B2). Pure functions over the B1 inventory and the user's assessments.
 *
 *   Estimated recoverable quantity = Available quantity × Recovery percentage
 *
 * Available quantity is the B1 primary quantity in its own unit (or, with basis "mass", the B1
 * estimated mass in kg). The percentage is net of expected loss. A component gives a recoverable
 * number only when it is classified direct reuse / refurbish / recycling AND has a valid percentage.
 * Anything else is "not available", never 0.
 */

import { formatValue, UNIT_LABEL, type Inventory, type InventoryRow, type QuantityResult, type Status, type Unit } from "@/engine/quantities";
import { leafDescendants } from "@/engine/quantities";
import { isEmptyAssessment, isRecoverableClass, EMPTY_ASSESSMENT, type AssessmentPatch, type Assessments, type Basis, type Classification, type RecoveryAssessment } from "./types";

/** Error text for an invalid percentage, or null when valid (finite, 0 ≤ p ≤ 100). */
export function validatePct(p: unknown): string | null {
  if (typeof p !== "number" || !Number.isFinite(p)) return "Recovery % must be a number";
  if (p < 0) return "Recovery % cannot be negative";
  if (p > 100) return "Recovery % cannot exceed 100";
  return null;
}

/** Parse user text for the percentage field: "" → null (unset); invalid → error. */
export function parsePct(text: string): { value: number | null; error: string | null } {
  const t = text.trim().replace(/%$/, "").trim();
  if (t === "") return { value: null, error: null };
  const n = Number(t);
  const error = validatePct(n);
  return error ? { value: null, error } : { value: n, error: null };
}

export interface PatchResult {
  readonly map: Assessments;
  /** Components whose assessment changed. */
  readonly applied: number;
  /** Ids that are not leaf components of the inventory (assemblies, unknown ids): ignored. */
  readonly ignored: readonly string[];
  readonly error: string | null;
}

/**
 * Apply a patch to the given components (leaves only; each id once). Setting a classification that
 * does not recover material clears the percentage. Empty assessments are removed so the map stays sparse.
 */
export function applyPatch(inv: Inventory, current: Assessments, ids: Iterable<string>, patch: AssessmentPatch): PatchResult {
  if (patch.recoveryPct !== undefined && patch.recoveryPct !== null) {
    const error = validatePct(patch.recoveryPct);
    if (error) return { map: current, applied: 0, ignored: [], error };
  }
  const next = new Map(current);
  const ignored: string[] = [];
  const seen = new Set<string>();
  let applied = 0;
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const q = inv.byId.get(id);
    const rec = inv.recordById.get(id);
    if (!q || !rec || rec.geometry.kind === "group") {
      ignored.push(id);
      continue;
    }
    const before = next.get(id) ?? EMPTY_ASSESSMENT;
    let after: RecoveryAssessment = { ...before, ...patch };
    if (patch.classification !== undefined && !isRecoverableClass(patch.classification)) after = { ...after, recoveryPct: null };
    if (JSON.stringify(after) === JSON.stringify(before)) continue;
    applied++;
    if (isEmptyAssessment(after)) next.delete(id);
    else next.set(id, after);
  }
  return { map: next, applied, ignored, error: null };
}

/** Leaf component ids an assessment edit on `id` applies to: the component itself, or an assembly's parts. */
export function targetLeafIds(inv: Inventory, id: string): string[] {
  const rec = inv.recordById.get(id);
  if (!rec) return [];
  return rec.geometry.kind === "group" ? leafDescendants(inv, id).map((r) => r.rec.id) : [id];
}

export interface ComponentRecovery {
  readonly id: string;
  readonly status: Classification | "unassessed";
  /** The B1 quantity this is based on (value null = unavailable). */
  readonly available: { readonly value: number | null; readonly unit: Unit; readonly status: Status; readonly method: string };
  readonly recoveryPct: number | null;
  /** available × pct / 100, or null when it cannot be computed (see `notes`). */
  readonly recoverable: number | null;
  /** The calculation in words, e.g. "0.729 m³ × 60% = 0.437 m³"; empty when not computed. */
  readonly formula: string;
  /** Why a figure is missing, and consistency warnings. */
  readonly notes: readonly string[];
}

const measureOf = (row: InventoryRow, basis: Basis): QuantityResult => (basis === "mass" ? row.q.mass : row.q.primary);

export function evaluateRow(row: InventoryRow, a: RecoveryAssessment | undefined, basis: Basis = "quantity"): ComponentRecovery {
  const m = measureOf(row, basis);
  const status = a?.classification ?? "unassessed";
  const notes: string[] = [];
  const available = { value: m.value, unit: m.unit, status: m.status, method: m.method };
  if (m.value === null) notes.push(basis === "mass" ? `no estimated mass for this component (${row.q.mass.issues[0]?.message ?? "no density"})` : "no B1 quantity for this component");
  let recoverable: number | null = null;
  let formula = "";
  if (isRecoverableClass(a?.classification ?? null)) {
    const pct = a!.recoveryPct;
    if (pct === null) notes.push("recovery % not set");
    else if (validatePct(pct) !== null) notes.push("recovery % is invalid");
    else if (m.value !== null) {
      recoverable = (m.value * pct) / 100;
      formula = `${formatValue(m.value, m.unit)} ${UNIT_LABEL[m.unit]} × ${pct}% = ${formatValue(recoverable, m.unit)} ${UNIT_LABEL[m.unit]}`;
    }
  } else if (a?.classification) notes.push("this classification does not produce a recoverable quantity");
  if (a?.classification && a.destination) {
    const clash = (a.classification === "recycling" && (a.destination === "reuse_same_building" || a.destination === "reuse_other_project")) || (a.classification === "direct_reuse" && a.destination === "material_recycling");
    if (clash) notes.push("destination and classification disagree (check both)");
  }
  return { id: row.rec.id, status, available, recoveryPct: a?.recoveryPct ?? null, recoverable, formula, notes };
}
