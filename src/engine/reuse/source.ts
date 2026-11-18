/**
 * What a component can offer (C2): the quantity it can supply and the sizes it records. Pure and read-only: it reads B1 quantities
 * and the B2 assessment and decides nothing about suitability.
 */

import type { ComponentRecord } from "@/building/structure";
import { hasMaterial, materialById } from "@/building/materialLibrary";
import { STRUCTURAL_MATERIAL } from "@/building/structure";
import { UNIT_LABEL, type InventoryRow, type Unit } from "@/engine/quantities";
import { isRecoverableClass, type RecoveryAssessment } from "@/engine/recovery";
import type { Axis, Supply } from "./types";

export const EPS = 1e-9;

/** Half-away rounding of float noise before an item count is floored (2.9999999999 is three items). */
const wholeItems = (v: number): number => Math.floor(v + 1e-6);

/** A number for display: the unit's usual precision, but small quantities keep three decimals (a 0.198 m² tile is not "0.20"). */
export function fmtQty(value: number | null, unit: Unit): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  const decimals = unit === "nr" ? 0 : unit === "m3" ? 3 : abs >= 100 ? 1 : abs >= 1 ? 2 : 3;
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export const fmtQtyU = (value: number | null, unit: Unit): string => (value === null ? "—" : `${fmtQty(value, unit)} ${UNIT_LABEL[unit]}`);

/** Metres as whole millimetres ("634 mm"), or metres above 10 m. */
export function fmtMm(m: number): string {
  return m >= 10 ? `${Number(m.toFixed(2))} m` : `${Math.round(m * 1000).toLocaleString("en-US")} mm`;
}

/**
 * The quantity a component can supply, in its own B1 primary unit.
 *   recoverable  a reuse-classified component with a recovery %: B1 quantity × % (the B2 estimate, net of loss)
 *   upper_bound  anything else: the modelled B1 quantity, which is the MOST that could exist; no recovery estimate backs it
 *   none         no B1 quantity
 * Whole items (nr) can only be allocated whole, so a fraction below one item supplies nothing.
 */
export function supplyOf(row: InventoryRow, a: RecoveryAssessment | undefined): Supply {
  const m = row.q.primary;
  const unit = m.unit;
  if (m.value === null || !Number.isFinite(m.value) || m.value < 0) return { value: null, unit, basis: "none", note: m.issues[0]?.message ?? "no B1 quantity for this component" };
  const reuse = isRecoverableClass(a?.classification ?? null) && a!.classification !== "recycling";
  let value: number;
  let basis: Supply["basis"];
  let note: string;
  if (reuse && a!.recoveryPct !== null) {
    value = (m.value * a!.recoveryPct) / 100;
    basis = "recoverable";
    note = `B2 estimate: ${m.value} ${UNIT_LABEL[unit]} × ${a!.recoveryPct} %`;
  } else {
    value = m.value;
    basis = "upper_bound";
    note = reuse ? "recovery % not set in B2: the modelled quantity is an upper bound" : "no reuse estimate in B2: the modelled quantity is an upper bound";
  }
  if (unit === "nr") {
    const whole = wholeItems(value);
    if (whole < value - 1e-6) note += whole === 0 ? `; a single item recovered at ${a?.recoveryPct ?? "<100"} % is not one whole item` : "; only whole items can be allocated";
    value = whole;
  }
  return { value, unit, basis, note };
}

/** Largest-first sizes recorded on a component, for the length / width / thickness comparison; null when not recorded. */
export function axisValue(rec: ComponentRecord, axis: Axis): number | null {
  const d = rec.dimensions;
  if (axis === "diameter") return typeof d.diameter === "number" && d.diameter > 0 ? d.diameter : null;
  const e = [d.length, d.width, d.height, d.thickness].filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0).sort((x, y) => y - x);
  if (axis === "length") return e[0] ?? null;
  // with fewer than three extents the second and third cannot be told apart (which one is the thickness?): not recorded
  if (e.length < 3) return null;
  return axis === "width" ? e[1]! : e[2]!;
}

export const materialName = (id: string): string => (hasMaterial(id) ? materialById(id).name : id === STRUCTURAL_MATERIAL.id ? STRUCTURAL_MATERIAL.name : id);

/** The recorded sizes of a component as "597 × 379 × 10 mm" (longest first; Ø for a diameter), or "size not recorded". */
export function sizeLabel(rec: ComponentRecord): string {
  const mm = (m: number | null): string | null => (m === null ? null : Math.round(m * 1000).toLocaleString("en-US"));
  const parts = (["length", "width", "thickness"] as const).map((a) => mm(axisValue(rec, a))).filter((x): x is string => x !== null);
  const dia = mm(axisValue(rec, "diameter"));
  const text = [...(dia ? [`Ø${dia}`] : []), ...parts].join(" × ");
  return text ? `${text} mm` : "size not recorded";
}

/** A recorded component type as words: "kitchen_countertop" -> "Kitchen countertop". */
export const typeLabel = (type: string): string => {
  const t = type.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
