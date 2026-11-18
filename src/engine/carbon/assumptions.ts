/** Editing the assumptions (B5). Pure and immutable: an invalid input returns the SAME assumptions and an error. */

import { validatePct } from "@/engine/recovery";
import type { Assumptions, RecoveryKey } from "./types";

export interface AssumptionEdit {
  readonly assumptions: Assumptions;
  readonly error: string | null;
}
const ok = (assumptions: Assumptions): AssumptionEdit => ({ assumptions, error: null });
const bad = (assumptions: Assumptions, error: string): AssumptionEdit => ({ assumptions, error });
const finiteNonNeg = (v: number): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Global replacement / substitution rate (0–100 %); null = not set. */
export function setReplacement(a: Assumptions, key: RecoveryKey, pct: number | null, category?: string): AssumptionEdit {
  if (pct !== null) {
    const e = validatePct(pct);
    if (e) return bad(a, e.replace("Recovery %", "Rate"));
  }
  if (category === undefined) return ok({ ...a, replacement: { ...a.replacement, [key]: pct } });
  const cur = { ...(a.replacementByCategory[category] ?? {}) };
  if (pct === null) delete cur[key];
  else cur[key] = pct;
  const by = { ...a.replacementByCategory };
  if (Object.keys(cur).length === 0) delete by[category];
  else by[category] = cur;
  return ok({ ...a, replacementByCategory: by });
}

export function setTransport(a: Assumptions, field: "recoveredKm" | "disposalKm" | "factorKgPerTonneKm", value: number | null): AssumptionEdit {
  if (value !== null && !finiteNonNeg(value)) return bad(a, "Must be a number ≥ 0");
  return ok({ ...a, transport: { ...a.transport, [field]: value } });
}

/** Per-category numbers: refurbishment / processing impact (≥ 0, kgCO₂e per unit) and density override (> 0, kg/m³). null removes. */
export function setCategoryValue(a: Assumptions, field: "refurbishFactor" | "processingFactor" | "densityKgM3", category: string, value: number | null): AssumptionEdit {
  if (!category) return bad(a, "Missing material category");
  if (value !== null) {
    if (!finiteNonNeg(value)) return bad(a, "Must be a number ≥ 0");
    if (field === "densityKgM3" && value === 0) return bad(a, "A density must be greater than 0");
  }
  const cur = { ...a[field] };
  if (value === null) delete cur[category];
  else cur[category] = value;
  return ok({ ...a, [field]: cur });
}
