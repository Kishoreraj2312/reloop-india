import { CARBON_UNIT } from "@/engine/carbon";

/** kgCO₂e below 1 t, tCO₂e from 1 t; null reads "Not assessed". Precision follows the size, never more than 3 significant figures. */
export function fmtCarbon(kg: number | null): string {
  if (kg === null || !Number.isFinite(kg)) return "Not assessed";
  const a = Math.abs(kg);
  if (a >= 1000) return `${(kg / 1000).toLocaleString("en-US", { maximumFractionDigits: a >= 100000 ? 0 : a >= 10000 ? 1 : 2 })} t${CARBON_UNIT.slice(2)}`;
  return `${kg.toLocaleString("en-US", { maximumFractionDigits: a >= 100 ? 0 : a >= 10 ? 1 : 2 })} ${CARBON_UNIT}`;
}
export const fmtPct = (v: number | null): string => (v === null ? "–" : `${v.toFixed(1)}%`);
