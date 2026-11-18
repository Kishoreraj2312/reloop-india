/**
 * Stage 2 (B5): carbon from the collected quantities. Pure and cheap (a few dozen categories).
 *
 *   Baseline (product-stage embodied carbon of the existing material, boundary as stated by each factor):
 *     kgCO₂e = Σ quantity (in the factor's unit) × emission factor
 *
 *   Scenario terms, per material category, from the B4 allocation of the same quantities:
 *     avoided replacement = recovered quantity × replacement rate / 100 × emission factor      (new material not bought)
 *     processing          = refurbished quantity × refurbish factor  +  recycled quantity × processing factor
 *     transport           = recovered mass [t] × recovered haul distance [km] × transport factor [kgCO₂e/t·km]
 *     potential net benefit = avoided replacement − processing − transport
 *   Recycling is credited only through its own substitution rate; disposal gets no credit. The haul of disposed material
 *   is reported separately and NOT netted (the conventional alternative hauls the same material). A like-for-like
 *   replacement with the category's own factor is assumed.
 *
 * Every needed input that is missing makes the term "not assessed" (null) and, for the net, makes the whole category
 * not assessed: a missing input is never read as 0, and partial terms are never netted against complete ones.
 */

import { categoryLabel } from "@/engine/scenarios";
import type { Unit } from "@/engine/quantities";
import type { Collected, CategoryAgg } from "./collect";
import { RECOVERY_KEYS, usesIllustrativeValue, type Assumptions, type EmissionFactor, type FactorLibrary, type Reason, type RecoveryKey } from "./types";

// ── baseline ─────────────────────────────────────────────────────────────────

export type RowStatus = "assessed" | "partial" | "unassessed";

export interface BaselineRow {
  readonly category: string;
  readonly label: string;
  readonly factor: EmissionFactor | null;
  readonly basis: Unit | null;
  readonly components: number;
  readonly assessed: number;
  readonly unassessed: Readonly<Record<Reason, number>>;
  /** Σ assessed quantity in the factor's unit. */
  readonly qty: number;
  /** null = not assessed (no component could be assessed). */
  readonly kgCO2e: number | null;
  /** Share of the assessed total (0–100). */
  readonly share: number | null;
  readonly status: RowStatus;
}

export interface Baseline {
  readonly rows: readonly BaselineRow[];
  /** Assessed total (kgCO₂e), summed per assessment boundary: boundaries are never added together silently. */
  readonly totalKg: number;
  readonly byBoundary: ReadonlyMap<string, number>;
  readonly mixedBoundaries: boolean;
  readonly usesIllustrative: boolean;
  readonly coverage: {
    readonly components: number;
    readonly assessed: number;
    readonly componentPct: number;
    /** Share of the estimated mass (components that have one) that is assessed; null without mass. */
    readonly massPct: number | null;
    readonly unassessedCategories: readonly string[];
  };
}

const boundaryOf = (f: EmissionFactor): string => f.boundary.trim() || "boundary not stated";

export function priceBaseline(c: Collected, library: FactorLibrary): Baseline {
  const rows: BaselineRow[] = [];
  const byBoundary = new Map<string, number>();
  let total = 0;
  let illustrative = false;
  for (const a of c.aggs.values()) {
    const f = library.get(a.category) ?? null;
    const usable = a.basis !== null && f !== null && f.value !== null;
    const kg = usable && a.assessed > 0 ? a.qty * f!.value! : null;
    if (kg !== null) {
      total += kg;
      byBoundary.set(boundaryOf(f!), (byBoundary.get(boundaryOf(f!)) ?? 0) + kg);
      if (usesIllustrativeValue(f)) illustrative = true;
    }
    rows.push({
      category: a.category,
      label: categoryLabel(a.category),
      factor: f,
      basis: a.basis,
      components: a.components,
      assessed: a.assessed,
      unassessed: a.unassessed,
      qty: a.qty,
      kgCO2e: kg,
      share: null,
      status: a.assessed === 0 ? "unassessed" : a.assessed === a.components ? "assessed" : "partial",
    });
  }
  const sorted = rows
    .map((r) => ({ ...r, share: r.kgCO2e !== null && total > 0 ? (r.kgCO2e / total) * 100 : null }))
    .sort((x, y) => (y.kgCO2e ?? -1) - (x.kgCO2e ?? -1) || (x.label < y.label ? -1 : 1));
  return {
    rows: sorted,
    totalKg: total,
    byBoundary,
    mixedBoundaries: byBoundary.size > 1,
    usesIllustrative: illustrative,
    coverage: {
      components: c.components,
      assessed: c.assessedComponents,
      componentPct: c.components > 0 ? (c.assessedComponents / c.components) * 100 : 0,
      massPct: c.massKg > 0 ? (c.massAssessedKg / c.massKg) * 100 : null,
      unassessedCategories: sorted.filter((r) => r.status !== "assessed").map((r) => r.category),
    },
  };
}

// ── scenario ─────────────────────────────────────────────────────────────────

export type NetStatus = "assessed" | "not_assessed" | "none_recovered";

/** A named input a category needs but the user has not provided. */
export type MissingInput = string;

export interface ScenarioCategory {
  readonly category: string;
  readonly label: string;
  readonly basis: Unit | null;
  /** Recovered quantity per recovery pathway, in the factor's unit. */
  readonly recovered: Readonly<Record<RecoveryKey, number>>;
  readonly disposal: number;
  readonly unknown: number;
  /** Terms in kgCO₂e; null = not assessed because an input is missing (never 0). 0 only when nothing needs the term. */
  readonly avoided: number | null;
  readonly processing: number | null;
  readonly transport: number | null;
  readonly net: number | null;
  readonly status: NetStatus;
  readonly missing: readonly MissingInput[];
  /** Haul of disposed material, reported apart (not netted); null when it cannot be assessed. */
  readonly disposalTransport: number | null;
  readonly usesIllustrative: boolean;
}

export interface ScenarioCarbon {
  readonly categories: readonly ScenarioCategory[];
  /** Σ over categories whose net is assessed. */
  readonly netKg: number;
  readonly avoidedKg: number;
  readonly costsKg: number;
  readonly assessedCategories: number;
  readonly notAssessedCategories: number;
  readonly noneRecovered: number;
  readonly disposalTransportKg: number | null;
  readonly usesIllustrative: boolean;
  /** Distinct missing inputs across the not-assessed categories, with how many categories each blocks. */
  readonly missing: ReadonlyMap<MissingInput, number>;
}

const RATE_LABEL: Record<RecoveryKey, string> = { direct: "replacement rate: direct reuse", refurbish: "replacement rate: refurbished reuse", recycling: "substitution rate: recycling" };

function rateFor(a: Assumptions, cat: string, k: RecoveryKey): number | null {
  const o = a.replacementByCategory[cat]?.[k];
  return o !== undefined && o !== null ? o : a.replacement[k];
}

function priceCategory(a: CategoryAgg, f: EmissionFactor | null, asm: Assumptions): ScenarioCategory {
  const o = a.outcome!;
  const recovered: Record<RecoveryKey, number> = { direct: o.direct_reuse, refurbish: o.refurbish_reuse, recycling: o.recycling };
  const qRecovered = recovered.direct + recovered.refurbish + recovered.recycling;
  const base = { category: a.category, label: categoryLabel(a.category), basis: a.basis, recovered, disposal: o.disposal, unknown: o.unknown, usesIllustrative: usesIllustrativeValue(f) };
  const t = asm.transport;
  const tf = t.factorKgPerTonneKm;
  const haul = (kg: number, km: number | null): number | null => (km === null || tf === null ? null : (kg / 1000) * km * tf);
  const movedRecovered = a.movedKg.direct_reuse + a.movedKg.refurbish_reuse + a.movedKg.recycling;
  const noMassRecovered = a.noMassQty.direct_reuse + a.noMassQty.refurbish_reuse + a.noMassQty.recycling;
  const disposalTransport = o.disposal <= 0 ? 0 : a.noMassQty.disposal > 0 ? null : haul(a.movedKg.disposal, t.disposalKm);

  const factor = f !== null && f.value !== null && a.basis !== null;
  if (qRecovered <= 0 && a.recoveryUnassessed === 0) return { ...base, avoided: null, processing: null, transport: null, net: null, status: "none_recovered", missing: [], disposalTransport };

  const missing: MissingInput[] = [];
  const need = (cond: boolean, label: string) => cond && missing.push(label);
  need(!factor, "emission factor");
  // Components the scenario recovers from that have no quantity in the factor's unit: their carbon cannot be assessed.
  need(factor && a.recoveryUnassessed > 0, "quantity in the factor's unit for every recovered component (for example no mass)");
  let avoided: number | null = 0;
  for (const k of RECOVERY_KEYS) {
    if (recovered[k] <= 0) continue;
    const r = rateFor(asm, a.category, k);
    need(r === null, RATE_LABEL[k]);
    avoided = factor && r !== null && avoided !== null ? avoided + (recovered[k] * r * f!.value!) / 100 : null;
  }
  let processing: number | null = 0;
  if (recovered.refurbish > 0) {
    const p = asm.refurbishFactor[a.category];
    need(p === undefined, "refurbishment impact");
    processing = p === undefined || processing === null ? null : processing + recovered.refurbish * p;
  }
  if (recovered.recycling > 0) {
    const p = asm.processingFactor[a.category];
    need(p === undefined, "recycling processing impact");
    processing = p === undefined || processing === null ? null : processing + recovered.recycling * p;
  }
  need(t.recoveredKm === null, "recovered haul distance");
  need(tf === null, "transport factor");
  need(noMassRecovered > 0, "mass of every recovered component (no density)");
  const transport = noMassRecovered > 0 ? null : haul(movedRecovered, t.recoveredKm);
  const complete = a.recoveryUnassessed === 0 && factor;
  const net = complete && avoided !== null && processing !== null && transport !== null ? avoided - processing - transport : null;
  return { ...base, avoided, processing, transport, net, status: net === null ? "not_assessed" : "assessed", missing, disposalTransport };
}

export function priceScenario(c: Collected, library: FactorLibrary, asm: Assumptions): ScenarioCarbon {
  const categories: ScenarioCategory[] = [];
  for (const a of c.aggs.values()) {
    if (!a.outcome) continue;
    categories.push(priceCategory(a, library.get(a.category) ?? null, asm));
  }
  categories.sort((x, y) => (x.label < y.label ? -1 : 1));
  let net = 0;
  let avoided = 0;
  let costs = 0;
  let assessedN = 0;
  let notN = 0;
  let none = 0;
  let dispT: number | null = 0;
  let illus = false;
  const missing = new Map<MissingInput, number>();
  for (const k of categories) {
    if (k.status === "assessed") {
      assessedN++;
      net += k.net!;
      avoided += k.avoided!;
      costs += k.processing! + k.transport!;
      if (k.usesIllustrative) illus = true;
    } else if (k.status === "not_assessed") {
      notN++;
      for (const m of k.missing) missing.set(m, (missing.get(m) ?? 0) + 1);
    } else none++;
    dispT = dispT === null || k.disposalTransport === null ? null : dispT + k.disposalTransport;
  }
  return { categories, netKg: net, avoidedKg: avoided, costsKg: costs, assessedCategories: assessedN, notAssessedCategories: notN, noneRecovered: none, disposalTransportKg: dispT, usesIllustrative: illus, missing };
}
