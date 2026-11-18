/**
 * One-at-a-time sensitivity (B5): each input that is SET is scaled by ±`scale` and the potential net benefit is priced again
 * (stage 2 only, so it is instant). Inputs that are not set are not varied: a missing input is not a number to perturb.
 * The result describes how the figure moves with the user's own assumptions; it is not an uncertainty range.
 */

import type { Collected } from "./collect";
import { priceScenario } from "./price";
import { RECOVERY_KEY_LABELS, RECOVERY_KEYS, type Assumptions, type EmissionFactor, type FactorLibrary } from "./types";
import { categoryLabel } from "@/engine/scenarios";

export interface SensitivityRow {
  readonly key: string;
  readonly label: string;
  readonly kind: "assumption" | "factor";
  readonly value: number;
  readonly lowKg: number;
  readonly highKg: number;
}

export interface Sensitivity {
  readonly baseNetKg: number;
  readonly scale: number;
  readonly rows: readonly SensitivityRow[];
}

const clampPct = (v: number) => Math.min(100, Math.max(0, v));

export function sensitivity(c: Collected, library: FactorLibrary, asm: Assumptions, scale = 0.2): Sensitivity {
  const basePriced = priceScenario(c, library, asm);
  const base = basePriced.netKg;
  // With no category whose net is assessed there is no figure to vary (0 would be a fabricated base): nothing is returned.
  if (basePriced.assessedCategories === 0) return { baseNetKg: base, scale, rows: [] };
  const rows: SensitivityRow[] = [];
  const push = (key: string, label: string, kind: SensitivityRow["kind"], value: number, apply: (f: number) => { lib: FactorLibrary; asm: Assumptions }) => {
    const at = (f: number) => {
      const x = apply(f);
      return priceScenario(c, x.lib, x.asm).netKg;
    };
    rows.push({ key, label, kind, value, lowKg: at(1 - scale), highKg: at(1 + scale) });
  };
  for (const k of RECOVERY_KEYS) {
    const v = asm.replacement[k];
    if (v !== null) push(`replacement.${k}`, RECOVERY_KEY_LABELS[k], "assumption", v, (f) => ({ lib: library, asm: { ...asm, replacement: { ...asm.replacement, [k]: clampPct(v * f) } } }));
  }
  const t = asm.transport;
  if (t.recoveredKm !== null) push("transport.km", "Recovered haul distance (km)", "assumption", t.recoveredKm, (f) => ({ lib: library, asm: { ...asm, transport: { ...t, recoveredKm: t.recoveredKm! * f } } }));
  if (t.factorKgPerTonneKm !== null) push("transport.factor", "Transport factor (kgCO₂e/t·km)", "assumption", t.factorKgPerTonneKm, (f) => ({ lib: library, asm: { ...asm, transport: { ...t, factorKgPerTonneKm: t.factorKgPerTonneKm! * f } } }));
  for (const field of ["refurbishFactor", "processingFactor"] as const) {
    for (const [cat, v] of Object.entries(asm[field])) push(`${field}.${cat}`, `${field === "refurbishFactor" ? "Refurbishment impact" : "Processing impact"}: ${categoryLabel(cat)}`, "assumption", v, (f) => ({ lib: library, asm: { ...asm, [field]: { ...asm[field], [cat]: v * f } } }));
  }
  for (const [cat, fac] of library) {
    if (fac.value === null || !c.aggs.get(cat)?.outcome) continue;
    const used = c.aggs.get(cat)!;
    if (used.outcome!.direct_reuse + used.outcome!.refurbish_reuse + used.outcome!.recycling <= 0) continue;
    push(`factor.${cat}`, `Emission factor: ${categoryLabel(cat)}`, "factor", fac.value, (f) => ({ lib: new Map(library).set(cat, { ...fac, value: fac.value! * f } as EmissionFactor), asm }));
  }
  rows.sort((a, b) => Math.max(Math.abs(b.highKg - base), Math.abs(b.lowKg - base)) - Math.max(Math.abs(a.highKg - base), Math.abs(a.lowKg - base)));
  return { baseNetKg: base, scale, rows };
}
