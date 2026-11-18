/**
 * Scenario calculation (B4). Pure and deterministic.
 *
 * For every B1 LEAF component (assemblies are never rows, so nothing is counted twice) the engine resolves the scenario's
 * rule (component -> category -> template -> unknown), reads it against the component's B2 assessment, and allocates the
 * B1 quantity with `allocate`. Results are aggregated by material category (B2's "material category": the material's
 * substance) and unit; m³, m², m, nr and kg are never added together. For each category and unit
 *
 *   direct reuse + refurbished reuse + recycling + disposal + unknown = available quantity
 *
 * holds, and `reconciled` says whether it does within float tolerance (a failing row is reported, never hidden).
 * Both bases are computed in one pass: "quantity" (the B1 primary quantity in its own unit) and "mass" (B1 estimated
 * mass, kg). Nothing here reads or changes B1, B2 or B3 data.
 */

import type { Inventory, InventoryRow, Unit } from "@/engine/quantities";
import { substanceOf, type Assessments, type Basis } from "@/engine/recovery";
import { allocate, nearlyEqual, outcomeSum, zeroQuantities, type Allocation } from "./allocate";
import { effectiveOf, resolveRule, type Effective, type Resolved } from "./rules";
import { MISSING_CODES, MISSING_LABELS, PATHWAYS, type MissingCode, type Pathway, type PathwayQuantities, type Scenario } from "./types";

const UNIT_ORDER: readonly Unit[] = ["m3", "m2", "m", "nr", "kg"];

/** Whole-building indicators are shown only when B1's mass covers at least this share (%) of the modelled solid volume. */
export const MIN_MASS_VOLUME_COVERAGE_PCT = 90;

const substanceCache = new Map<string, string>();
/** B2's "material category" of a record. */
export function materialCategoryOf(materialId: string): string {
  let s = substanceCache.get(materialId);
  if (s === undefined) substanceCache.set(materialId, (s = substanceOf(materialId)));
  return s;
}
export const categoryLabel = (category: string): string => {
  const t = category.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// ── one leaf ─────────────────────────────────────────────────────────────────

export interface EvalContext {
  readonly inv: Inventory;
  readonly assessments: Assessments;
  readonly scenario: Scenario;
  readonly hasComponentRules: boolean;
}

export const makeContext = (inv: Inventory, assessments: Assessments, scenario: Scenario): EvalContext => ({ inv, assessments, scenario, hasComponentRules: Object.keys(scenario.componentRules).length > 0 });

export interface LeafDecision {
  readonly id: string;
  readonly category: string;
  readonly resolved: Resolved;
  readonly effective: Effective;
}

/** Assembly ancestors of a leaf, nearest first. Only real assemblies count: an A1 `parentId` ("member beneath") is not containment. */
export function assemblyAncestors(inv: Inventory, row: InventoryRow): string[] {
  const out: string[] = [];
  let p = row.rec.parentId;
  for (let guard = 0; p !== undefined && guard < 16; guard++) {
    const pr = inv.recordById.get(p);
    if (!pr || pr.geometry.kind !== "group") break;
    out.push(p);
    p = pr.parentId;
  }
  return out;
}

export function decide(ctx: EvalContext, row: InventoryRow): LeafDecision {
  const id = row.rec.id;
  const category = materialCategoryOf(row.rec.materialId);
  const resolved = resolveRule(ctx.scenario, id, ctx.hasComponentRules ? assemblyAncestors(ctx.inv, row) : [], category);
  return { id, category, resolved, effective: effectiveOf(resolved.rule, ctx.assessments.get(id), ctx.scenario) };
}

export interface LeafOutcome {
  readonly decision: LeafDecision;
  readonly basis: Basis;
  readonly unit: Unit;
  /** The B1 quantity on this basis; null when B1 has none. */
  readonly available: number | null;
  /** Null when there is no quantity to allocate. */
  readonly allocation: Allocation | null;
}

const measureOf = (row: InventoryRow, basis: Basis) => (basis === "mass" ? row.q.mass : row.q.primary);
const usable = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0;

export function allocateLeaf(decision: LeafDecision, row: InventoryRow, basis: Basis): LeafOutcome {
  const m = measureOf(row, basis);
  const e = decision.effective;
  return { decision, basis, unit: m.unit, available: m.value, allocation: usable(m.value) ? allocate(m.value, e.pathway, e.recoveryPct, e.residual) : null };
}

/** One component, one basis (used for the inspector line and the selected-component card). */
export const evaluateLeaf = (ctx: EvalContext, row: InventoryRow, basis: Basis): LeafOutcome => allocateLeaf(decide(ctx, row), row, basis);

// ── aggregation ──────────────────────────────────────────────────────────────

export interface CategoryRow {
  /** Material category (substance) key; "all" on a totals row. */
  readonly key: string;
  readonly label: string;
  readonly unit: Unit;
  readonly components: number;
  /** Components with a B1 value on this basis. The rest are `unquantified` and are not part of `available`. */
  readonly quantified: number;
  readonly unquantified: number;
  /** Σ B1 quantity of the quantified components. */
  readonly available: number;
  /** Quantity allocated to each pathway BEFORE recovery. */
  readonly allocated: PathwayQuantities;
  /** Where the quantity ends up: recovered per recovery pathway, plus disposal and unknown (including residuals). */
  readonly outcome: PathwayQuantities;
  /** Allocated to a recovery pathway that has no usable recovery % (carried as unknown): the sum of `unconfiguredBy`. */
  readonly unconfigured: number;
  /** The same, per recovery pathway: its recovered quantity is unavailable for exactly this much of its allocation. */
  readonly unconfiguredBy: PathwayQuantities;
  /** Unrecovered share of the recovery pathways (part of disposal / unknown). */
  readonly residual: number;
  /** (direct + refurbished reuse + recycling) ÷ available × 100; null when nothing is available. */
  readonly diversionPct: number | null;
  readonly disposalPct: number | null;
  readonly unknownPct: number | null;
  /** |Σ outcomes − available|. */
  readonly discrepancy: number;
  readonly reconciled: boolean;
}

interface Acc {
  key: string;
  label: string;
  unit: Unit;
  components: number;
  quantified: number;
  available: number;
  allocated: Record<Pathway, number>;
  outcome: Record<Pathway, number>;
  unconfigured: number;
  unconfiguredBy: Record<Pathway, number>;
  residual: number;
}
const newAcc = (key: string, label: string, unit: Unit): Acc => ({ key, label, unit, components: 0, quantified: 0, available: 0, allocated: zeroQuantities(), outcome: zeroQuantities(), unconfigured: 0, unconfiguredBy: zeroQuantities(), residual: 0 });

export const diverted = (o: PathwayQuantities): number => o.direct_reuse + o.refurbish_reuse + o.recycling;

function finish(a: Acc): CategoryRow {
  const sum = outcomeSum(a.outcome);
  const pct = (v: number) => (a.available > 0 ? (v / a.available) * 100 : null);
  return {
    key: a.key,
    label: a.label,
    unit: a.unit,
    components: a.components,
    quantified: a.quantified,
    unquantified: a.components - a.quantified,
    available: a.available,
    allocated: a.allocated,
    outcome: a.outcome,
    unconfigured: a.unconfigured,
    unconfiguredBy: a.unconfiguredBy,
    residual: a.residual,
    diversionPct: pct(diverted(a.outcome)),
    disposalPct: pct(a.outcome.disposal),
    unknownPct: pct(a.outcome.unknown),
    discrepancy: Math.abs(sum - a.available),
    reconciled: nearlyEqual(sum, a.available),
  };
}

function addLeaf(a: Acc, o: LeafOutcome): void {
  a.components++;
  const al = o.allocation;
  if (!al) return;
  a.quantified++;
  a.available += al.quantity;
  a.allocated[al.pathway] += al.quantity;
  for (const p of PATHWAYS) a.outcome[p] += al.outcome[p];
  if (al.unconfigured) {
    a.unconfigured += al.quantity;
    a.unconfiguredBy[al.pathway] += al.quantity;
  }
  a.residual += al.residual;
}

export interface BasisResult {
  readonly basis: Basis;
  /** One row per material category and unit, sorted by label then unit. */
  readonly rows: readonly CategoryRow[];
  /** One row per unit over every category (Σ of `rows`). */
  readonly totals: readonly CategoryRow[];
}

export interface MissingAssumption {
  readonly code: MissingCode | "stale_override";
  readonly message: string;
  /** Components affected (for stale overrides: overrides that match nothing). */
  readonly components: number;
  readonly categories: readonly string[];
}

export interface MassCoverageInfo {
  /** Leaf components, and how many have an estimated mass. */
  readonly components: number;
  readonly quantified: number;
  readonly componentPct: number;
  /** B1's share of the modelled solid volume whose mass is estimated (null when there is no volume). */
  readonly volumePct: number | null;
}

export interface WholeBuilding {
  /** Indicators are shown only when `reliable`. */
  readonly reliable: boolean;
  readonly reason: string | null;
  readonly coverage: MassCoverageInfo;
  /** Σ estimated mass (kg) of the components that have one. */
  readonly availableKg: number;
  readonly outcome: PathwayQuantities;
  readonly diversionPct: number | null;
  readonly disposalPct: number | null;
  readonly unknownPct: number | null;
}

export interface ScenarioResult {
  readonly scenarioId: string;
  readonly quantity: BasisResult;
  readonly mass: BasisResult;
  readonly wholeBuilding: WholeBuilding;
  readonly missing: readonly MissingAssumption[];
  readonly leafCount: number;
  /** Every category and unit row of both bases reconciles. */
  readonly reconciled: boolean;
}

export const resultFor = (r: ScenarioResult, basis: Basis): BasisResult => (basis === "mass" ? r.mass : r.quantity);

const rowOrder = (a: CategoryRow, b: CategoryRow) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) || UNIT_ORDER.indexOf(a.unit) - UNIT_ORDER.indexOf(b.unit);

function buildBasis(basis: Basis, accs: Map<string, Acc>): BasisResult {
  const rows = [...accs.values()].map(finish).sort(rowOrder);
  const totals = new Map<Unit, Acc>();
  for (const a of accs.values()) {
    let t = totals.get(a.unit);
    if (!t) totals.set(a.unit, (t = newAcc("all", "All material categories", a.unit)));
    t.components += a.components;
    t.quantified += a.quantified;
    t.available += a.available;
    t.unconfigured += a.unconfigured;
    t.residual += a.residual;
    for (const p of PATHWAYS) {
      t.allocated[p] += a.allocated[p];
      t.outcome[p] += a.outcome[p];
      t.unconfiguredBy[p] += a.unconfiguredBy[p];
    }
  }
  return { basis, rows, totals: [...totals.values()].map(finish).sort((a, b) => UNIT_ORDER.indexOf(a.unit) - UNIT_ORDER.indexOf(b.unit)) };
}

function wholeBuilding(inv: Inventory, mass: BasisResult): WholeBuilding {
  const t = mass.totals.find((r) => r.unit === "kg");
  const comps = inv.rows.length;
  const q = t?.quantified ?? 0;
  const volumePct = inv.massCoverage.pct;
  const coverage: MassCoverageInfo = { components: comps, quantified: q, componentPct: comps > 0 ? (q / comps) * 100 : 0, volumePct };
  let reason: string | null = null;
  if (!t || q === 0 || t.available <= 0) reason = "no component has an estimated mass";
  else if (volumePct === null || volumePct < MIN_MASS_VOLUME_COVERAGE_PCT) reason = `estimated mass covers ${volumePct === null ? "none" : volumePct.toFixed(1) + "%"} of the modelled solid volume (needs ≥ ${MIN_MASS_VOLUME_COVERAGE_PCT}%)`;
  const reliable = reason === null && t !== undefined;
  return {
    reliable,
    reason,
    coverage,
    availableKg: t?.available ?? 0,
    outcome: t?.outcome ?? zeroQuantities(),
    diversionPct: reliable ? t!.diversionPct : null,
    disposalPct: reliable ? t!.disposalPct : null,
    unknownPct: reliable ? t!.unknownPct : null,
  };
}

function compute(inv: Inventory, assessments: Assessments, scenario: Scenario): ScenarioResult {
  const ctx = makeContext(inv, assessments, scenario);
  const qAcc = new Map<string, Acc>();
  const mAcc = new Map<string, Acc>();
  const miss = new Map<MissingCode, { n: number; cats: Set<string> }>();
  const get = (m: Map<string, Acc>, category: string, unit: Unit): Acc => {
    const k = `${category}|${unit}`;
    let a = m.get(k);
    if (!a) m.set(k, (a = newAcc(category, categoryLabel(category), unit)));
    return a;
  };
  for (const row of inv.rows) {
    const d = decide(ctx, row);
    addLeaf(get(qAcc, d.category, row.q.primary.unit), allocateLeaf(d, row, "quantity"));
    addLeaf(get(mAcc, d.category, "kg"), allocateLeaf(d, row, "mass"));
    const code = d.effective.missing;
    if (code) {
      let m = miss.get(code);
      if (!m) miss.set(code, (m = { n: 0, cats: new Set() }));
      m.n++;
      m.cats.add(d.category);
    }
  }
  const missing: MissingAssumption[] = [];
  for (const code of MISSING_CODES) {
    const m = miss.get(code);
    if (m) missing.push({ code, message: MISSING_LABELS[code], components: m.n, categories: [...m.cats].sort() });
  }
  const stale = staleRules(inv, scenario, [...qAcc.values()].map((a) => a.key));
  if (stale.length) missing.push({ code: "stale_override", message: "Overrides that match no component or material category in the model", components: stale.length, categories: [] });

  const quantity = buildBasis("quantity", qAcc);
  const mass = buildBasis("mass", mAcc);
  return { scenarioId: scenario.id, quantity, mass, wholeBuilding: wholeBuilding(inv, mass), missing, leafCount: inv.rows.length, reconciled: quantity.rows.every((r) => r.reconciled) && mass.rows.every((r) => r.reconciled) };
}

/** Overrides that point at nothing in the current model (kept, never dropped, but reported). */
export function staleRules(inv: Inventory, scenario: Scenario, categoriesPresent?: readonly string[]): string[] {
  const cats = new Set(categoriesPresent ?? inv.rows.map((r) => materialCategoryOf(r.rec.materialId)));
  return [...Object.keys(scenario.componentRules).filter((id) => !inv.recordById.has(id)), ...Object.keys(scenario.categoryRules).filter((c) => !cats.has(c))];
}

const cache = new WeakMap<Inventory, WeakMap<Assessments, WeakMap<Scenario, ScenarioResult>>>();

/** Memoised per (inventory, assessments, scenario) object: edits create new objects, so a stale result is never returned. */
export function computeScenario(inv: Inventory, assessments: Assessments, scenario: Scenario): ScenarioResult {
  let byA = cache.get(inv);
  if (!byA) cache.set(inv, (byA = new WeakMap()));
  let byS = byA.get(assessments);
  if (!byS) byA.set(assessments, (byS = new WeakMap()));
  let r = byS.get(scenario);
  if (!r) byS.set(scenario, (r = compute(inv, assessments, scenario)));
  return r;
}
