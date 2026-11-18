/**
 * Comparing scenarios (B4). Pure. Everything here is read from the scenarios' stored assumptions and their calculated
 * results; no sentence states a cause the data does not show.
 */

import { formatValue, UNIT_LABEL, type Unit } from "@/engine/quantities";
import type { Basis } from "@/engine/recovery";
import { categoryLabel, diverted, resultFor, type BasisResult, type CategoryRow, type ScenarioResult } from "./compute";
import { nearlyEqual } from "./allocate";
import { describeRule, rulesEqual, templateRule } from "./rules";
import { TEMPLATE_INFO } from "./templates";
import { PATHWAY_SHORT, type Scenario } from "./types";

const UNIT_ORDER: readonly Unit[] = ["m3", "m2", "m", "nr", "kg"];

/** Units present in any of the results on this basis, in display order. */
export function unitsOf(results: readonly ScenarioResult[], basis: Basis): Unit[] {
  const set = new Set<Unit>();
  for (const r of results) for (const t of resultFor(r, basis).totals) set.add(t.unit);
  return UNIT_ORDER.filter((u) => set.has(u));
}

export interface CompareRow {
  readonly key: string;
  readonly label: string;
  readonly unit: Unit;
  /** One cell per scenario (same order as the input); null when the scenario has no such category row. */
  readonly cells: readonly (CategoryRow | null)[];
}

/** Category rows of one unit, aligned across scenarios. */
export function compareRows(results: readonly ScenarioResult[], basis: Basis, unit: Unit): CompareRow[] {
  const keys = new Map<string, string>();
  const per = results.map((r) => {
    const m = new Map<string, CategoryRow>();
    for (const row of resultFor(r, basis).rows) if (row.unit === unit) (m.set(row.key, row), keys.set(row.key, row.label));
    return m;
  });
  return [...keys].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)).map(([key, label]) => ({ key, label, unit, cells: per.map((m) => m.get(key) ?? null) }));
}

export const totalOfUnit = (r: BasisResult, unit: Unit): CategoryRow | undefined => r.totals.find((t) => t.unit === unit);

/** How a scenario treats a material category before any component override, in words. */
export function treatmentOf(s: Scenario, category: string): string {
  const own = s.categoryRules[category];
  if (own) return `category rule: ${describeRule(own, s)}`;
  const t = templateRule(s, category);
  if (!t) return "no rule (unknown)";
  if (t.kind === "assessment") return s.template === "selective" ? "B2 assessments (selected category)" : "B2 assessments";
  return `${s.template === "reuse_first" ? "template" : "baseline"}: ${describeRule(t, s)}`;
}

export interface Difference {
  readonly kind: "assumption" | "quantity";
  readonly text: string;
}
export interface DifferenceGroup {
  /** The scenario compared with the reference, and the reference (the first compared scenario). */
  readonly scenarioId: string;
  readonly againstId: string;
  readonly items: readonly Difference[];
}

const fmt = (v: number, u: Unit) => `${formatValue(v, u)} ${UNIT_LABEL[u]}`;
const signed = (v: number, u: Unit) => `${v >= 0 ? "+" : "−"}${fmt(Math.abs(v), u)}`;
const pct = (v: number | null) => (v === null ? "–" : `${v.toFixed(1)}%`);

const selectionOf = (s: Scenario): "all" | ReadonlySet<string> => (s.template === "reuse_first" ? "all" : s.template === "selective" ? new Set(s.scope ?? []) : new Set<string>());

function assumptionDiffs(a: Scenario, b: Scenario): Difference[] {
  const out: Difference[] = [];
  const add = (text: string) => out.push({ kind: "assumption", text });
  const named = (s: Scenario) => (s.name === TEMPLATE_INFO[s.template].label ? s.name : `${s.name} (${TEMPLATE_INFO[s.template].label})`);
  if (a.template !== b.template) add(`Template: ${named(a)} vs ${named(b)}.`);
  if (a.residual !== b.residual) add(`Unrecovered share goes to ${a.residual} in ${a.name} and to ${b.residual} in ${b.name}.`);
  if (!rulesEqual(a.baseline, b.baseline) && (a.template !== "reuse_first" || b.template !== "reuse_first")) add(`Baseline: ${describeRule(a.baseline, a)} in ${a.name}; ${describeRule(b.baseline, b)} in ${b.name}.`);
  // Which material categories have their B2 assessments applied: all (reuse-first), the selected ones (selective), none (conventional).
  const selA = selectionOf(a);
  const selB = selectionOf(b);
  if (selA === "all" && selB !== "all") add(`B2 assessments are applied to every material category in ${a.name}, but ${selB.size ? `only to ${[...selB].map(categoryLabel).join(", ")}` : "to none"} in ${b.name}.`);
  else if (selB === "all" && selA !== "all") add(`B2 assessments are applied to every material category in ${b.name}, but ${selA.size ? `only to ${[...selA].map(categoryLabel).join(", ")}` : "to none"} in ${a.name}.`);
  else if (selA !== "all" && selB !== "all") {
    const onlyB = [...selB].filter((c) => !selA.has(c));
    const onlyA = [...selA].filter((c) => !selB.has(c));
    if (onlyB.length) add(`Selected for deconstruction in ${b.name} but not in ${a.name}: ${onlyB.map(categoryLabel).join(", ")}.`);
    if (onlyA.length) add(`Selected for deconstruction in ${a.name} but not in ${b.name}: ${onlyA.map(categoryLabel).join(", ")}.`);
  }
  const cats = new Set([...Object.keys(a.categoryRules), ...Object.keys(b.categoryRules)]);
  for (const c of [...cats].sort()) if (!rulesEqual(a.categoryRules[c], b.categoryRules[c])) add(`${categoryLabel(c)}: ${a.name} — ${treatmentOf(a, c)}; ${b.name} — ${treatmentOf(b, c)}.`);
  const na = Object.keys(a.componentRules).length;
  const nb = Object.keys(b.componentRules).length;
  const ids = new Set([...Object.keys(a.componentRules), ...Object.keys(b.componentRules)]);
  const differing = [...ids].filter((id) => !rulesEqual(a.componentRules[id], b.componentRules[id])).length;
  if (differing) add(`Component overrides: ${a.name} has ${na}, ${b.name} has ${nb} (${differing} differ).`);
  return out;
}

function quantityDiffs(a: Scenario, b: Scenario, ra: ScenarioResult, rb: ScenarioResult, basis: Basis): Difference[] {
  const out: Difference[] = [];
  const A = resultFor(ra, basis);
  const B = resultFor(rb, basis);
  for (const unit of UNIT_ORDER) {
    const ta = totalOfUnit(A, unit);
    const tb = totalOfUnit(B, unit);
    if (!ta || !tb || ta.available <= 0) continue;
    const dDiv = diverted(tb.outcome) - diverted(ta.outcome);
    const dDis = tb.outcome.disposal - ta.outcome.disposal;
    const dUnk = tb.outcome.unknown - ta.outcome.unknown;
    const moved = [dDiv, dDis, dUnk].some((d) => !nearlyEqual(d, 0));
    if (!moved) continue;
    out.push({ kind: "quantity", text: `All categories (${UNIT_LABEL[unit]}): diverted ${pct(ta.diversionPct)} → ${pct(tb.diversionPct)} (${signed(dDiv, unit)}); disposal ${signed(dDis, unit)}; unknown ${signed(dUnk, unit)} (of ${fmt(ta.available, unit)}).` });
    // The categories that moved most in this unit.
    const rows = compareRows([ra, rb], basis, unit)
      .map((r) => {
        const x = r.cells[0];
        const y = r.cells[1];
        if (!x || !y) return null;
        const d = [diverted(y.outcome) - diverted(x.outcome), y.outcome.disposal - x.outcome.disposal, y.outcome.unknown - x.outcome.unknown];
        return { r, d, mag: Math.max(...d.map(Math.abs)) };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null && !nearlyEqual(e.mag, 0))
      .sort((p, q) => q.mag - p.mag || (p.r.label < q.r.label ? -1 : 1))
      .slice(0, 4);
    for (const e of rows)
      out.push({ kind: "quantity", text: `${e.r.label} (${UNIT_LABEL[unit]}): diverted ${signed(e.d[0]!, unit)}, disposal ${signed(e.d[1]!, unit)}, unknown ${signed(e.d[2]!, unit)}. ${a.name} — ${treatmentOf(a, e.r.key)}; ${b.name} — ${treatmentOf(b, e.r.key)}.` });
  }
  return out;
}

/** What differs between the first scenario and each of the others: assumption changes and calculated quantity changes. */
export function describeDifferences(scenarios: readonly Scenario[], results: readonly ScenarioResult[], basis: Basis): DifferenceGroup[] {
  const ref = scenarios[0];
  const refResult = results[0];
  if (!ref || !refResult) return [];
  return scenarios.slice(1).map((s, i) => {
    const items = [...assumptionDiffs(ref, s), ...quantityDiffs(ref, s, refResult, results[i + 1]!, basis)];
    return { scenarioId: s.id, againstId: ref.id, items };
  });
}

export const OUTCOME_ORDER = ["direct_reuse", "refurbish_reuse", "recycling", "disposal", "unknown"] as const;
export const outcomeLabel = (p: (typeof OUTCOME_ORDER)[number]): string => PATHWAY_SHORT[p];
