/**
 * The matching engine (C2). Deterministic and explainable: the same requirement, configuration and data always give the same
 * result, every verdict names the criterion behind it, and nothing is produced by a model or an unexplained formula.
 *
 * TIER (rule based, never a threshold on the score)
 *   incompatible  any criterion fails                          -> `blockers` say which and why
 *   strong        every criterion the requirement uses is met   -> nothing outstanding
 *   conditional   nothing fails, but a criterion is only achievable with a condition (partial) or has no project data (unknown)
 *
 * SCORE (ranking only)    100 × Σ weight × points ÷ Σ weight, over the criteria the requirement uses.
 *   points: met 1 (quantity: the share of the requirement the component alone covers), partial = `partialCredit`,
 *   unknown = `unknownCredit` (default 0: missing data earns nothing), unmet 0. Weights are the configuration, shown in the UI.
 *
 * Only components of the requested material category are evaluated; everything else is "excluded" and only counted.
 */

import { CATEGORY_LABELS, type Category, type Inventory, type InventoryRow, type Unit, UNIT_LABEL } from "@/engine/quantities";
import { CLASSIFICATION_LABELS, PREPARATION_LABELS, substanceOf, type Assessments } from "@/engine/recovery";
import { OBSERVED_LABELS, type MetaMap, type ObservedCondition } from "@/engine/passport";
import { axisValue, EPS, fmtMm, fmtQtyU, materialName, supplyOf, typeLabel } from "./source";
import {
  ACCEPTANCE_LABELS,
  AXES,
  AXIS_SHORT,
  CRITERIA,
  isSpecified,
  MIN_CONDITION_LABELS,
  type Candidate,
  type CriterionKey,
  type CriterionResult,
  type Line,
  type MatchConfig,
  type Note,
  type Range,
  type Requirement,
  type State,
  type Supply,
  type Tier,
} from "./types";

export interface MatchContext {
  readonly inv: Inventory;
  readonly assessments: Assessments;
  readonly meta: MetaMap;
  readonly config: MatchConfig;
}

export const substanceLabel = (s: string): string => {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const STATE_RANK: Readonly<Record<State, number>> = { na: 0, met: 1, partial: 2, unknown: 3, unmet: 4 };
const worst = (a: State, b: State): State => (STATE_RANK[a] >= STATE_RANK[b] ? a : b);

interface Acc {
  blockers: Note[];
  conditions: Note[];
  missing: Note[];
  notes: Note[];
}
interface Part {
  state: State;
  /** Share of the weight earned when the state is met (1, or the covered share for quantity). */
  met?: number;
  lines: Line[];
}

const rangeText = (r: Range, tolMm: number): string => {
  const t = tolMm > 0 ? ` (±${tolMm} mm)` : "";
  if (r.min !== null && r.max !== null) return r.min === r.max ? `${fmtMm(r.min)}${t}` : `${fmtMm(r.min)} – ${fmtMm(r.max)}${t}`;
  if (r.min !== null) return `≥ ${fmtMm(r.min)}${t}`;
  if (r.max !== null) return `≤ ${fmtMm(r.max)}${t}`;
  return "—";
};

const OBSERVED_RANK: Readonly<Record<ObservedCondition, number>> = { damaged: 0, poor: 1, fair: 2, good: 3 };
const MIN_RANK = { any: 0, fair: 2, good: 3 } as const;

// ── criteria ─────────────────────────────────────────────────────────────────

function material(req: Requirement, row: InventoryRow, acc: Acc, detail: boolean): Part {
  const { rec, q } = row;
  const sub = substanceOf(rec.materialId);
  let state: State = "met";
  const lines: Line[] = [];
  const subOk = sub === req.substance;
  if (!subOk) {
    state = "unmet";
    acc.blockers.push({ code: "material", text: `Material is ${substanceLabel(sub).toLowerCase()}, the requirement is ${substanceLabel(req.substance).toLowerCase()}` });
  }
  if (detail) lines.push({ label: "Material category", required: substanceLabel(req.substance), actual: substanceLabel(sub), state: subOk ? "met" : "unmet" });
  if (req.form !== null) {
    const ok = q.category === req.form;
    if (!ok) {
      state = "unmet";
      acc.blockers.push({ code: "form", text: `Component is a ${CATEGORY_LABELS[q.category].toLowerCase()}, the requirement is a ${CATEGORY_LABELS[req.form].toLowerCase()}` });
    }
    if (detail) lines.push({ label: "Component form", required: CATEGORY_LABELS[req.form], actual: CATEGORY_LABELS[q.category], state: ok ? "met" : "unmet" });
  }
  if (req.componentType !== null) {
    const ok = rec.componentType === req.componentType;
    if (!ok) {
      state = "unmet";
      acc.blockers.push({ code: "type", text: `Component is a ${typeLabel(rec.componentType).toLowerCase()}, the requirement is a ${typeLabel(req.componentType).toLowerCase()}` });
    }
    if (detail) lines.push({ label: "Component type", required: typeLabel(req.componentType), actual: typeLabel(rec.componentType), state: ok ? "met" : "unmet" });
  }
  if (req.materialId !== null) {
    const ok = rec.materialId === req.materialId;
    if (!ok) {
      state = worst(state, "partial");
      acc.conditions.push({ code: "variant", text: `Different material variant: the requirement names "${materialName(req.materialId)}", this is "${materialName(rec.materialId)}". Check finish and performance` });
    }
    if (detail) lines.push({ label: "Material variant", required: materialName(req.materialId), actual: materialName(rec.materialId), state: ok ? "met" : "partial" });
  } else if (detail) lines.push({ label: "Material variant", required: "Any", actual: materialName(rec.materialId), state: "met" });
  return { state, lines };
}

function dimensions(req: Requirement, row: InventoryRow, acc: Acc, detail: boolean): Part {
  const specified = AXES.filter((a) => isSpecified(req.dims[a]));
  if (specified.length === 0) return { state: "na", lines: [] };
  const tol = req.toleranceMm / 1000;
  let state: State = "met";
  const lines: Line[] = [];
  for (const axis of specified) {
    const r = req.dims[axis];
    const v = axisValue(row.rec, axis);
    let s: State = "met";
    let note: string | undefined;
    if (v === null) {
      s = "unknown";
      acc.missing.push({ code: "dim_missing", text: `${AXIS_SHORT[axis]} is not recorded for this component` });
    } else if (r.min !== null && v < r.min - tol - EPS) {
      s = "unmet";
      acc.blockers.push({ code: "dim_small", text: `${AXIS_SHORT[axis]} ${fmtMm(v)} is below the required minimum ${fmtMm(r.min)}` });
    } else if (r.max !== null && v > r.max + tol + EPS) {
      const cuttable = axis === "length" || axis === "width";
      if (cuttable && req.accept.cutting) {
        s = "partial";
        note = "cut to size";
        acc.conditions.push({ code: "cutting", text: `Cut ${AXIS_SHORT[axis].toLowerCase()} from ${fmtMm(v)} down to ≤ ${fmtMm(r.max)}` });
      } else {
        s = "unmet";
        acc.blockers.push({ code: "dim_large", text: `${AXIS_SHORT[axis]} ${fmtMm(v)} exceeds the required maximum ${fmtMm(r.max)}${cuttable ? " (cutting to size is not accepted)" : " (it cannot be cut down)"}` });
      }
    }
    state = worst(state, s);
    if (detail) lines.push({ label: AXIS_SHORT[axis], required: rangeText(r, req.toleranceMm), actual: v === null ? "not recorded" : fmtMm(v), state: s, ...(note ? { note } : {}) });
  }
  return { state, lines };
}

function quantity(req: Requirement, supply: Supply, acc: Acc, detail: boolean): Part {
  const lines: Line[] = [];
  const unitOk = supply.unit === req.unit;
  if (detail) lines.push({ label: "Unit", required: UNIT_LABEL[req.unit], actual: UNIT_LABEL[supply.unit], state: unitOk ? "met" : "unmet", ...(unitOk ? {} : { note: "units are never converted" }) });
  if (!unitOk) {
    acc.blockers.push({ code: "unit", text: `Measured in ${UNIT_LABEL[supply.unit]}; the requirement is in ${UNIT_LABEL[req.unit]} (units are never converted)` });
    return { state: "unmet", lines };
  }
  if (supply.value === null || supply.value <= EPS) {
    acc.blockers.push({ code: "no_quantity", text: `Nothing to allocate: ${supply.note}` });
    if (detail) lines.push({ label: "Can supply", required: fmtQtyU(req.quantity, req.unit), actual: supply.value === null ? "no quantity" : fmtQtyU(supply.value, supply.unit), state: "unmet", note: supply.note });
    return { state: "unmet", lines };
  }
  if (supply.basis === "upper_bound") acc.notes.push({ code: "upper_bound", text: `Quantity is an upper bound: ${supply.note}` });
  const cover = Math.min(1, supply.value / req.quantity);
  if (detail) lines.push({ label: "Can supply", required: fmtQtyU(req.quantity, req.unit), actual: fmtQtyU(supply.value, supply.unit), state: "met", note: `${supply.basis === "recoverable" ? "B2 recoverable estimate" : "modelled upper bound"} · covers ${(cover * 100).toFixed(cover < 0.1 ? 1 : 0)} % of the requirement` });
  return { state: "met", met: cover, lines };
}

function condition(req: Requirement, row: InventoryRow, ctx: MatchContext, acc: Acc, detail: boolean): Part {
  const m = ctx.meta.get(row.rec.id);
  const observed = m?.observedCondition ?? null;
  const lines: Line[] = [];
  const when = m?.inspectedOn ? ` · inspected ${m.inspectedOn}` : "";
  const actual = observed === null ? "not recorded" : `${OBSERVED_LABELS[observed]}${when}`;
  if (observed === "damaged") {
    acc.blockers.push({ code: "damaged", text: "Recorded as damaged in the C1 passport" });
    if (detail) lines.push({ label: "Observed condition", required: MIN_CONDITION_LABELS[req.minCondition], actual, state: "unmet", note: "a component recorded as damaged is never matched" });
    return { state: "unmet", lines };
  }
  if (req.minCondition === "any") {
    if (detail) lines.push({ label: "Observed condition", required: MIN_CONDITION_LABELS.any, actual, state: "na", ...(observed === null ? { note: "none recorded (the model's own 'good' is a generated default, not an inspection)" } : {}) });
    return { state: "na", lines };
  }
  if (observed === null) {
    acc.missing.push({ code: "condition_unknown", text: "No observed condition is recorded in the C1 passport (the model's own 'good' is a generated default, not an inspection)" });
    if (detail) lines.push({ label: "Observed condition", required: MIN_CONDITION_LABELS[req.minCondition], actual, state: "unknown", note: "record an inspection in the passport" });
    return { state: "unknown", lines };
  }
  const ok = OBSERVED_RANK[observed] >= MIN_RANK[req.minCondition];
  if (!ok) acc.blockers.push({ code: "condition_low", text: `Observed condition is ${OBSERVED_LABELS[observed].toLowerCase()}; the requirement asks for ${MIN_CONDITION_LABELS[req.minCondition].toLowerCase()}` });
  if (detail) lines.push({ label: "Observed condition", required: MIN_CONDITION_LABELS[req.minCondition], actual, state: ok ? "met" : "unmet" });
  return { state: ok ? "met" : "unmet", lines };
}

function recovery(req: Requirement, row: InventoryRow, ctx: MatchContext, acc: Acc, detail: boolean): Part {
  const a = ctx.assessments.get(row.rec.id);
  const cls = a?.classification ?? null;
  const pct = a?.recoveryPct ?? null;
  const structural = row.rec.system === "structure";
  const lines: Line[] = [];
  let state: State;
  const clsText = cls ? CLASSIFICATION_LABELS[cls] : "Not assessed";
  const estimate = pct === null ? "no recovery % set" : `${pct} % recovery`;

  if (cls === "recycling") {
    state = "unmet";
    acc.blockers.push({ code: "recycling", text: "B2 assesses this component for recycling, not for reuse" });
  } else if (structural && !req.includeStructural) {
    state = "unmet";
    acc.blockers.push({ code: "structural", text: "Structural element: this requirement does not consider structural reuse" });
  } else if (!req.includeUnassessed && cls !== "direct_reuse" && cls !== "refurbish_reuse") {
    state = "unmet";
    acc.blockers.push({ code: "unassessed", text: "This requirement considers only components assessed for reuse in B2" });
  } else if (cls === "direct_reuse" || cls === "refurbish_reuse") {
    if (pct !== null) state = "met";
    else {
      state = "unknown";
      acc.missing.push({ code: "no_pct", text: "No recovery % in B2: how much can be recovered is unknown, so the quantity is only an upper bound" });
    }
  } else if (cls === "further_assessment") {
    if (req.accept.testing) {
      state = "partial";
      acc.conditions.push({ code: "testing", text: "B2: requires further assessment or testing before reuse can be decided" });
    } else {
      state = "unmet";
      acc.blockers.push({ code: "refused_testing", text: `B2 requires further assessment, and this requirement does not accept ${ACCEPTANCE_LABELS.testing.toLowerCase()}` });
    }
  } else {
    state = "unknown";
    acc.missing.push({ code: cls === null ? "unassessed" : "insufficient", text: cls === null ? "Not assessed for recovery in B2" : "B2: insufficient information about recovery" });
  }
  if (structural && req.includeStructural && state !== "unmet") {
    state = worst(state, "partial");
    acc.conditions.push({ code: "structural", text: "Structural element: reuse needs drawings, testing and a qualified structural engineer. This tool cannot judge it" });
  }
  if (detail) lines.push({ label: "B2 assessment", required: req.includeUnassessed ? "Reuse assessed, or unassessed (conditional)" : "Assessed for reuse", actual: `${clsText} · ${estimate}`, state, ...(structural ? { note: "structural element" } : {}) });
  return { state, lines };
}

function processing(req: Requirement, row: InventoryRow, ctx: MatchContext, acc: Acc, detail: boolean): Part {
  const a = ctx.assessments.get(row.rec.id);
  const cls = a?.classification ?? null;
  const prep = a?.preparation ?? null;
  const lines: Line[] = [];
  const needs: (keyof typeof ACCEPTANCE_LABELS)[] = [];
  if (cls === "refurbish_reuse" || prep === "refurbishment") needs.push("refurbishment");
  if (prep === "cleaning") needs.push("cleaning");
  let state: State = "met";
  if (prep === "reprocessing") {
    state = "unmet";
    acc.blockers.push({ code: "reprocessing", text: "B2 preparation is reprocessing (crushing, melting …): the material would not be reused as it is" });
  }
  if (cls === null || cls === "insufficient_information") {
    if (needs.length === 0 && state === "met" && prep === null) return { state: "na", lines: detail ? [{ label: "Preparation (B2)", required: "—", actual: "unknown until the component is assessed", state: "na" }] : [] };
  }
  for (const n of needs) {
    const accepted = req.accept[n];
    if (accepted) {
      state = worst(state, "partial");
      acc.conditions.push({ code: n, text: n === "refurbishment" ? "Refurbishment is needed before reuse (B2)" : "Cleaning / de-fixing is needed before reuse (B2)" });
    } else {
      state = "unmet";
      acc.blockers.push({ code: `refused_${n}`, text: `Needs ${ACCEPTANCE_LABELS[n].toLowerCase()}, which this requirement does not accept` });
    }
  }
  if (prep === null && cls !== null) acc.notes.push({ code: "prep_unstated", text: "B2 does not state the preparation needed" });
  if (detail) lines.push({ label: "Preparation (B2)", required: "None, or accepted steps", actual: prep ? PREPARATION_LABELS[prep] : "not stated", state, ...(needs.length ? { note: needs.map((n) => ACCEPTANCE_LABELS[n].toLowerCase()).join(", ") } : {}) });
  return { state, lines };
}

function specs(req: Requirement, acc: Acc, detail: boolean): Part {
  if (req.extraSpecs.length === 0) return { state: "na", lines: [] };
  const lines: Line[] = [];
  for (const s of req.extraSpecs) {
    acc.missing.push({ code: "spec", text: `${s.label}${s.value ? ` (${s.value})` : ""}: the model holds no data for this, so it cannot be verified here` });
    if (detail) lines.push({ label: s.label, required: s.value || "stated", actual: "not in project data", state: "unknown", note: "verify against documents or tests" });
  }
  return { state: "unknown", lines };
}

// ── evaluation ───────────────────────────────────────────────────────────────

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Evaluate one component against a requirement. `detail` adds the criterion rows (text) for the comparison view. */
export function evaluate(ctx: MatchContext, req: Requirement, row: InventoryRow, detail = false): Candidate {
  const acc: Acc = { blockers: [], conditions: [], missing: [], notes: [] };
  const supply = supplyOf(row, ctx.assessments.get(row.rec.id));
  const parts: Record<CriterionKey, Part> = {
    material: material(req, row, acc, detail),
    dimensions: dimensions(req, row, acc, detail),
    quantity: quantity(req, supply, acc, detail),
    condition: condition(req, row, ctx, acc, detail),
    recovery: recovery(req, row, ctx, acc, detail),
    processing: processing(req, row, ctx, acc, detail),
    specs: specs(req, acc, detail),
  };
  const { weights, partialCredit, unknownCredit } = ctx.config;
  const states = {} as Record<CriterionKey, State>;
  const results: CriterionResult[] = [];
  let weightSum = 0;
  let earned = 0;
  let known = 0;
  let total = 0;
  let allMet = true;
  for (const k of CRITERIA) {
    const p = parts[k];
    states[k] = p.state;
    const points = p.state === "met" ? (p.met ?? 1) : p.state === "partial" ? partialCredit : p.state === "unknown" ? unknownCredit : 0;
    if (p.state !== "na") {
      weightSum += weights[k];
      earned += weights[k] * points;
      total++;
      if (p.state !== "unknown") known++;
      if (p.state !== "met") allMet = false;
    }
    if (detail) results.push({ key: k, state: p.state, points: p.state === "na" ? 0 : points, weight: weights[k], lines: p.lines });
  }
  const tier: Tier = acc.blockers.length > 0 ? "incompatible" : allMet ? "strong" : "conditional";
  return {
    id: row.rec.id,
    tier,
    score: tier === "incompatible" ? null : weightSum > 0 ? round1((100 * earned) / weightSum) : 0,
    known,
    total,
    states,
    supply,
    blockers: acc.blockers,
    conditions: acc.conditions,
    missing: acc.missing,
    notes: acc.notes,
    ...(detail ? { criteria: results } : {}),
  };
}

/** The full explanation (criterion rows with required / actual text) of one component, which need not be in the requirement's material category. */
export const explain = (ctx: MatchContext, req: Requirement, row: InventoryRow): Candidate => evaluate(ctx, req, row, true);

// ── ranking ──────────────────────────────────────────────────────────────────

export interface MatchResult {
  readonly requirementId: string;
  readonly strong: readonly Candidate[];
  readonly conditional: readonly Candidate[];
  readonly incompatible: readonly Candidate[];
  readonly byId: ReadonlyMap<string, Candidate>;
  /** Components of the requested material category that were evaluated. */
  readonly evaluated: number;
  /** Every other leaf component: not evaluated, only counted. */
  readonly excluded: number;
  /** How often each blocker code occurs among the incompatible components (the "why not" histogram). */
  readonly blockerCounts: ReadonlyMap<string, { count: number; sample: string }>;
}

const byRank = (a: Candidate, b: Candidate): number => {
  const sa = a.score ?? -1;
  const sb = b.score ?? -1;
  if (sa !== sb) return sb - sa;
  const qa = a.supply.value ?? -1;
  const qb = b.supply.value ?? -1;
  if (qa !== qb) return qb - qa;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

const bySubstance = new WeakMap<Inventory, Map<string, InventoryRow[]>>();
/** The leaf components grouped by material category (built once per inventory). */
function substanceMap(inv: Inventory): Map<string, InventoryRow[]> {
  let m = bySubstance.get(inv);
  if (!m) {
    m = new Map();
    for (const r of inv.rows) {
      const s = substanceOf(r.rec.materialId);
      let l = m.get(s);
      if (!l) m.set(s, (l = []));
      l.push(r);
    }
    bySubstance.set(inv, m);
  }
  return m;
}
/** The leaf components of one material category. */
export const rowsOfSubstance = (inv: Inventory, substance: string): readonly InventoryRow[] => substanceMap(inv).get(substance) ?? [];

type Level<T> = WeakMap<object, T>;
const memo: Level<Level<Level<Level<Level<MatchResult>>>>> = new WeakMap();

/** Rank every component of the requirement's material category. Memoised per (inventory, requirement, assessments, passports, configuration). */
export function matchRequirement(ctx: MatchContext, req: Requirement): MatchResult {
  const l1 = memo.get(ctx.inv) ?? (memo.set(ctx.inv, new WeakMap()), memo.get(ctx.inv)!);
  const l2 = l1.get(req) ?? (l1.set(req, new WeakMap()), l1.get(req)!);
  const l3 = l2.get(ctx.assessments) ?? (l2.set(ctx.assessments, new WeakMap()), l2.get(ctx.assessments)!);
  const l4 = l3.get(ctx.meta) ?? (l3.set(ctx.meta, new WeakMap()), l3.get(ctx.meta)!);
  const hit = l4.get(ctx.config);
  if (hit) return hit;

  const rows = rowsOfSubstance(ctx.inv, req.substance);
  const strong: Candidate[] = [];
  const conditional: Candidate[] = [];
  const incompatible: Candidate[] = [];
  const blockerCounts = new Map<string, { count: number; sample: string }>();
  for (const row of rows) {
    const c = evaluate(ctx, req, row);
    if (c.tier === "strong") strong.push(c);
    else if (c.tier === "conditional") conditional.push(c);
    else {
      incompatible.push(c);
      const b = c.blockers[0]!;
      const e = blockerCounts.get(b.code);
      if (e) e.count++;
      else blockerCounts.set(b.code, { count: 1, sample: b.text });
    }
  }
  strong.sort(byRank);
  conditional.sort(byRank);
  incompatible.sort(byRank);
  const byId = new Map<string, Candidate>();
  for (const list of [strong, conditional, incompatible]) for (const c of list) byId.set(c.id, c);
  const result: MatchResult = { requirementId: req.id, strong, conditional, incompatible, byId, evaluated: rows.length, excluded: ctx.inv.rows.length - rows.length, blockerCounts };
  l4.set(ctx.config, result);
  return result;
}

/** The candidates of a result in the order a list shows them: strong, conditional, incompatible. */
export const ranked = (r: MatchResult, tiers: readonly Tier[] = ["strong", "conditional", "incompatible"]): Candidate[] => tiers.flatMap((t) => [...r[t]]);

/** Evaluate one component against every requirement (the "reuse opportunities" of a selected component). */
export function opportunities(ctx: MatchContext, reqs: readonly Requirement[], row: InventoryRow): { requirement: Requirement; candidate: Candidate }[] {
  return reqs.map((requirement) => ({ requirement, candidate: evaluate(ctx, requirement, row) }));
}

// ── what the model offers (for building a requirement) ───────────────────────

export interface SubstanceInfo {
  readonly substance: string;
  readonly label: string;
  readonly count: number;
}

const substanceList = new WeakMap<Inventory, readonly SubstanceInfo[]>();
/** The material categories present in the model, by name. */
export function substanceIndex(inv: Inventory): readonly SubstanceInfo[] {
  let l = substanceList.get(inv);
  if (!l) {
    l = [...substanceMap(inv)].map(([substance, rows]) => ({ substance, label: substanceLabel(substance), count: rows.length })).sort((a, b) => (a.label < b.label ? -1 : 1));
    substanceList.set(inv, l);
  }
  return l;
}

export interface ScopeInfo {
  readonly count: number;
  readonly forms: readonly { category: Category; count: number }[];
  /** The component types in scope (material category and form). */
  readonly types: readonly { type: string; count: number }[];
  readonly materials: readonly { id: string; count: number }[];
  /** The units the components in scope are measured in, most common first. */
  readonly units: readonly { unit: Unit; count: number }[];
  readonly hasDiameter: boolean;
}

/** What the components of one material category (and, optionally, one form) look like: used to offer only real choices. */
export function scopeInfo(inv: Inventory, substance: string, form: Category | null = null): ScopeInfo {
  const forms = new Map<Category, number>();
  const types = new Map<string, number>();
  const materials = new Map<string, number>();
  const units = new Map<Unit, number>();
  let count = 0;
  let hasDiameter = false;
  for (const r of rowsOfSubstance(inv, substance)) {
    forms.set(r.q.category, (forms.get(r.q.category) ?? 0) + 1);
    if (form !== null && r.q.category !== form) continue;
    count++;
    types.set(r.rec.componentType, (types.get(r.rec.componentType) ?? 0) + 1);
    materials.set(r.rec.materialId, (materials.get(r.rec.materialId) ?? 0) + 1);
    units.set(r.q.primary.unit, (units.get(r.q.primary.unit) ?? 0) + 1);
    if (typeof r.rec.dimensions.diameter === "number") hasDiameter = true;
  }
  const desc = <K,>(m: Map<K, number>) => [...m].sort((a, b) => b[1] - a[1]);
  return {
    count,
    forms: desc(forms).map(([category, n]) => ({ category, count: n })),
    types: desc(types).map(([type, n]) => ({ type, count: n })),
    materials: desc(materials).map(([id, n]) => ({ id, count: n })),
    units: desc(units).map(([unit, n]) => ({ unit, count: n })),
    hasDiameter,
  };
}
