/**
 * Stage 1 (B5): collect quantities per material category from the B1 LEAF components (assemblies are never rows, so no
 * quantity is counted twice), in the unit of the category's emission factor, and — for a scenario — where each quantity ends up
 * (B4's allocation, reused as is). Stage 2 (price.ts) turns these small aggregates into carbon, so changing a factor or an
 * assumption never repeats the 84k-component pass.
 *
 * Unit rule: a component contributes to a category only through a measure in the FACTOR'S unit: its B1 primary quantity if that
 * is the unit, a B1 secondary measure of that unit, or its mass in kg. Mass is B1's documented density × solid volume, or the
 * user's density override × a modelled m³ volume. Anything else is "no quantity" and is reported, never converted by guessing.
 */

import type { Inventory, InventoryRow, Unit } from "@/engine/quantities";
import type { Assessments } from "@/engine/recovery";
import { allocate, zeroQuantities, decide, makeContext, materialCategoryOf, type Pathway } from "@/engine/scenarios";
import type { Scenario } from "@/engine/scenarios";
import type { Assumptions, FactorLibrary, Reason } from "./types";

const usable = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v) && v >= 0;

/** Solid volume (m³) of a component: its primary quantity when that is a volume, else a B1 secondary volume. */
export function volumeM3(row: InventoryRow): number | null {
  if (row.q.primary.unit === "m3") return row.q.primary.value;
  return row.q.secondary.find((s) => s.unit === "m3")?.value ?? null;
}

/** Mass (kg): the user's density × a modelled volume when an override is set and a volume exists, else B1's estimated mass. */
export function massOf(row: InventoryRow, densityOverride?: number): number | null {
  if (densityOverride !== undefined && densityOverride > 0) {
    const v = volumeM3(row);
    if (usable(v)) return v * densityOverride;
  }
  return row.q.mass.value;
}

/** The component's quantity in `unit`, or null when B1 has none in that unit. */
export function measureIn(row: InventoryRow, unit: Unit, densityOverride?: number): number | null {
  if (unit === "kg") return massOf(row, densityOverride);
  if (row.q.primary.unit === unit) return row.q.primary.value;
  return row.q.secondary.find((s) => s.unit === unit)?.value ?? null;
}

export interface CategoryAgg {
  readonly category: string;
  /** The factor's unit; null when the category has no usable factor. */
  readonly basis: Unit | null;
  readonly components: number;
  /** Components with a usable factor and a valid quantity in its unit. */
  readonly assessed: number;
  readonly unassessed: Readonly<Record<Reason, number>>;
  /** Σ quantity (basis unit) of the assessed components. */
  readonly qty: number;
  /** Where the quantity ends up (B4 allocation); null for the baseline pass. */
  readonly outcome: Readonly<Record<Pathway, number>> | null;
  /** Mass (kg) that moves with each outcome, over assessed components that have a mass. */
  readonly movedKg: Readonly<Record<Pathway, number>>;
  /** Quantity (basis unit) of each outcome whose component has NO mass: its transport cannot be assessed. */
  readonly noMassQty: Readonly<Record<Pathway, number>>;
  /** Components the scenario recovers material from (a recovery pathway with a % above 0) that could NOT be quantified in the factor's unit. */
  readonly recoveryUnassessed: number;
}

export interface Collected {
  readonly aggs: ReadonlyMap<string, CategoryAgg>;
  readonly components: number;
  readonly assessedComponents: number;
  /** Σ mass of every component that has one, and of those that are assessed (a coverage measure by weight). */
  readonly massKg: number;
  readonly massAssessedKg: number;
}

interface Acc {
  category: string;
  basis: Unit | null;
  components: number;
  assessed: number;
  unassessed: Record<Reason, number>;
  qty: number;
  outcome: Record<Pathway, number> | null;
  movedKg: Record<Pathway, number>;
  noMassQty: Record<Pathway, number>;
  recoveryUnassessed: number;
}

/** `scenario` null = baseline only (no allocation). */
export function collect(inv: Inventory, assessments: Assessments, scenario: Scenario | null, library: FactorLibrary, assumptions: Assumptions): Collected {
  const ctx = scenario ? makeContext(inv, assessments, scenario) : null;
  const accs = new Map<string, Acc>();
  let massKg = 0;
  let massAssessedKg = 0;
  let assessedComponents = 0;
  for (const row of inv.rows) {
    const category = materialCategoryOf(row.rec.materialId);
    let a = accs.get(category);
    if (!a) {
      const f = library.get(category);
      accs.set(category, (a = { category, basis: f && f.value !== null ? f.basis : null, components: 0, assessed: 0, unassessed: { no_factor: 0, no_quantity: 0, invalid: 0 }, qty: 0, outcome: scenario ? zeroQuantities() : null, movedKg: zeroQuantities(), noMassQty: zeroQuantities(), recoveryUnassessed: 0 }));
    }
    a.components++;
    const density = assumptions.densityKgM3[category];
    const mass = massOf(row, density);
    if (usable(mass)) massKg += mass;
    const eff = ctx ? decide(ctx, row).effective : null;
    const recovers = eff !== null && (eff.pathway === "direct_reuse" || eff.pathway === "refurbish_reuse" || eff.pathway === "recycling") && eff.recoveryPct !== null && eff.recoveryPct > 0;
    if (a.basis === null) {
      a.unassessed.no_factor++;
      if (recovers) a.recoveryUnassessed++;
      continue;
    }
    const q = measureIn(row, a.basis, density);
    if (q === null) {
      a.unassessed.no_quantity++;
      if (recovers) a.recoveryUnassessed++;
      continue;
    }
    if (!usable(q)) {
      a.unassessed.invalid++;
      if (recovers) a.recoveryUnassessed++;
      continue;
    }
    a.assessed++;
    assessedComponents++;
    a.qty += q;
    if (usable(mass)) massAssessedKg += mass;
    if (ctx && a.outcome && eff) {
      const e = eff;
      const al = allocate(q, e.pathway, e.recoveryPct, e.residual);
      for (const p of Object.keys(al.outcome) as Pathway[]) {
        const part = al.outcome[p];
        if (part === 0) continue;
        a.outcome[p] += part;
        if (usable(mass) && q > 0) a.movedKg[p] += mass * (part / q);
        else a.noMassQty[p] += part;
      }
    }
  }
  return { aggs: accs as unknown as ReadonlyMap<string, CategoryAgg>, components: inv.rows.length, assessedComponents, massKg, massAssessedKg };
}

const cache = new WeakMap<Inventory, WeakMap<Assessments, WeakMap<object, Map<string, Collected>>>>();
const NO_SCENARIO = {};

/**
 * Memoised `collect`. The result depends on the inventory, the B2 assessments, the scenario (an immutable object), each
 * category's factor UNIT (not its value) and the density overrides: changing a factor value or any other assumption reuses it.
 */
export function collectCached(inv: Inventory, assessments: Assessments, scenario: Scenario | null, library: FactorLibrary, assumptions: Assumptions): Collected {
  let byA = cache.get(inv);
  if (!byA) cache.set(inv, (byA = new WeakMap()));
  let byS = byA.get(assessments);
  if (!byS) byA.set(assessments, (byS = new WeakMap()));
  const sKey = scenario ?? NO_SCENARIO;
  let byK = byS.get(sKey);
  if (!byK) byS.set(sKey, (byK = new Map()));
  const key = `${[...library.values()].filter((f) => f.value !== null).map((f) => `${f.category}:${f.basis}`).sort().join(",")}|${JSON.stringify(assumptions.densityKgM3)}`;
  let c = byK.get(key);
  if (!c) {
    c = collect(inv, assessments, scenario, library, assumptions);
    if (byK.size > 8) byK.clear();
    byK.set(key, c);
  }
  return c;
}
