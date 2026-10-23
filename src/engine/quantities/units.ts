/**
 * Units. The engine works in base units only (m, m2, m3, kg, nr); conversions exist only for
 * display. `Qty<U>` carries its unit in the type, so adding a Qty<"m2"> to a Qty<"m3"> does
 * not compile.
 */

import type { Unit } from "./types";

export interface Qty<U extends Unit> {
  readonly value: number;
  readonly unit: U;
}

export const qty = <U extends Unit>(value: number, unit: U): Qty<U> => ({ value, unit });
export const addQty = <U extends Unit>(a: Qty<U>, b: Qty<NoInfer<U>>): Qty<U> => ({ value: a.value + b.value, unit: a.unit });
export const sumQty = <U extends Unit>(unit: U, values: Iterable<number>): Qty<U> => {
  let s = 0;
  for (const v of values) s += v;
  return { value: s, unit };
};

/** Fixed decimals shown per unit. */
export const UNIT_DECIMALS: Readonly<Record<Unit, number>> = { m3: 3, m2: 2, m: 2, kg: 0, nr: 0 };
export const TONNE_DECIMALS = 2;

export const UNIT_LABEL: Readonly<Record<Unit, string>> = { m3: "m³", m2: "m²", m: "m", kg: "kg", nr: "nr" };

export const kgToTonnes = (kg: number): number => kg / 1000;
export const mToMm = (m: number): number => m * 1000;
export const m3ToLitres = (m3: number): number => m3 * 1000;

export const NOT_AVAILABLE = "Not available";

const nf = new Map<number, Intl.NumberFormat>();
function groupFmt(decimals: number): Intl.NumberFormat {
  let f = nf.get(decimals);
  if (!f) nf.set(decimals, (f = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })));
  return f;
}

/** A number in the fixed precision of its unit, thousands-separated. Null reads "Not available". */
export function formatValue(value: number | null, unit: Unit): string {
  if (value === null || !Number.isFinite(value)) return NOT_AVAILABLE;
  return groupFmt(UNIT_DECIMALS[unit]).format(value);
}

/** Tonnes (2 decimals) from kilograms. */
export function formatTonnes(kg: number | null): string {
  if (kg === null || !Number.isFinite(kg)) return NOT_AVAILABLE;
  return groupFmt(TONNE_DECIMALS).format(kgToTonnes(kg));
}

/** Plain decimal for CSV (no separators, up to 6 decimals so exports can be re-summed). Unknown stays empty. */
export function csvValue(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "" : String(Number(value.toFixed(6)));
}
