/** Per-component views of the carbon assessment (B5): the inspector line and the 3D highlight ids. Pure and read-only. */

import { materialCategoryOf } from "@/engine/scenarios";
import type { Inventory, InventoryRow, Unit } from "@/engine/quantities";
import { measureIn } from "./collect";
import type { Assumptions, EmissionFactor, FactorLibrary, Reason } from "./types";

const ok = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0;

export interface ComponentCarbon {
  readonly category: string;
  readonly factor: EmissionFactor | null;
  readonly basis: Unit | null;
  readonly qty: number | null;
  /** null = not assessed (see `reason`). */
  readonly kgCO2e: number | null;
  readonly reason: Reason | null;
}

export function componentCarbon(row: InventoryRow, library: FactorLibrary, assumptions: Assumptions): ComponentCarbon {
  const category = materialCategoryOf(row.rec.materialId);
  const f = library.get(category) ?? null;
  if (!f || f.value === null) return { category, factor: f, basis: null, qty: null, kgCO2e: null, reason: "no_factor" };
  const q = measureIn(row, f.basis, assumptions.densityKgM3[category]);
  if (q === null) return { category, factor: f, basis: f.basis, qty: null, kgCO2e: null, reason: "no_quantity" };
  if (!ok(q)) return { category, factor: f, basis: f.basis, qty: null, kgCO2e: null, reason: "invalid" };
  return { category, factor: f, basis: f.basis, qty: q, kgCO2e: q * f.value, reason: null };
}

/** Leaf ids of a material category that are assessed (or not) under the current factors: what the 3D view marks. */
export function categoryLeafIds(inv: Inventory, library: FactorLibrary, assumptions: Assumptions, category: string, assessed: boolean | "all"): string[] {
  const out: string[] = [];
  for (const row of inv.rows) {
    if (materialCategoryOf(row.rec.materialId) !== category) continue;
    if (assessed === "all" || (componentCarbon(row, library, assumptions).kgCO2e !== null) === assessed) out.push(row.rec.id);
  }
  return out;
}

/** Leaf ids that are not assessed, in any category. */
export function unassessedLeafIds(inv: Inventory, library: FactorLibrary, assumptions: Assumptions): string[] {
  return inv.rows.filter((r) => componentCarbon(r, library, assumptions).kgCO2e === null).map((r) => r.rec.id);
}
