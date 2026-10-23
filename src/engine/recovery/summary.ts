/**
 * Recovery inventory (B2): the B1 leaf rows grouped by material category, component category, floor,
 * recovery pathway or assessment status. Every row is one group × ONE unit: m3, m2, m, nr and kg are
 * never added together. Each leaf is counted once (assemblies are never rows), so
 * Σ over groups = the total, for every grouping.
 */

import { hasMaterial, materialById } from "@/building/materialLibrary";
import { CATEGORY_LABELS, FLOOR_LABEL, type Inventory, type InventoryRow, type Unit } from "@/engine/quantities";
import { evaluateRow } from "./assess";
import { CLASSIFICATION_SHORT, DESTINATION_LABELS, isRecoverableClass, type Assessments, type Basis } from "./types";

export const GROUP_BYS = ["materialCategory", "componentCategory", "floor", "pathway", "status"] as const;
export type GroupBy = (typeof GROUP_BYS)[number];
export const GROUP_BY_LABELS: Readonly<Record<GroupBy, string>> = {
  materialCategory: "Material category",
  componentCategory: "Component category",
  floor: "Floor",
  pathway: "Recovery pathway",
  status: "Assessment status",
};

export interface RecoveryRow {
  readonly key: string;
  readonly label: string;
  readonly unit: Unit;
  /** Leaf components in the group with this unit. */
  readonly components: number;
  /** Of those, how many have a value for this basis (the rest are `unquantified`). */
  readonly quantified: number;
  readonly unquantified: number;
  /** Σ available (B1) over the quantified components. Null when none is quantified. */
  readonly available: number | null;
  /** Σ available × pct over the components that have a recoverable estimate. Null when none has. */
  readonly recoverable: number | null;
  readonly recoverableComponents: number;
  /** recoverable ÷ available of the whole group (null when either is null). */
  readonly pct: number | null;
  /** Σ available of components classified further-assessment / insufficient-information / not yet assessed. */
  readonly requiresAssessment: number | null;
}

export interface RecoverySummary {
  readonly rows: readonly RecoveryRow[];
  /** One row per unit over everything given. */
  readonly totals: readonly RecoveryRow[];
  readonly leafCount: number;
  readonly assessedCount: number;
}

const UNIT_ORDER: readonly Unit[] = ["m3", "m2", "m", "nr", "kg"];

export function substanceOf(materialId: string): string {
  if (hasMaterial(materialId)) return materialById(materialId).substance;
  return materialId === "rcc_conceptual" ? "concrete" : "unknown";
}
const pretty = (s: string) => s.replace(/_/g, " ");

export function groupKey(row: InventoryRow, a: Assessments, by: GroupBy): { key: string; label: string; order: number } {
  switch (by) {
    case "materialCategory": {
      const s = substanceOf(row.rec.materialId);
      return { key: s, label: pretty(s), order: 0 };
    }
    case "componentCategory":
      return { key: row.q.category, label: CATEGORY_LABELS[row.q.category], order: 0 };
    case "floor":
      return { key: String(row.rec.floor), label: FLOOR_LABEL[row.rec.floor] ?? String(row.rec.floor), order: row.rec.floor };
    case "pathway": {
      const d = a.get(row.rec.id)?.destination ?? null;
      return d ? { key: d, label: DESTINATION_LABELS[d], order: 0 } : { key: "none", label: "No pathway chosen", order: 1 };
    }
    case "status": {
      const c = a.get(row.rec.id)?.classification ?? null;
      return { key: c ?? "unassessed", label: CLASSIFICATION_SHORT[c ?? "unassessed"], order: 0 };
    }
  }
}

interface Acc {
  key: string;
  label: string;
  order: number;
  unit: Unit;
  components: number;
  quantified: number;
  available: number;
  recoverable: number;
  recoverableComponents: number;
  requires: number;
}

function toRow(a: Acc): RecoveryRow {
  const available = a.quantified > 0 ? a.available : null;
  const recoverable = a.recoverableComponents > 0 ? a.recoverable : null;
  return {
    key: a.key,
    label: a.label,
    unit: a.unit,
    components: a.components,
    quantified: a.quantified,
    unquantified: a.components - a.quantified,
    available,
    recoverable,
    recoverableComponents: a.recoverableComponents,
    pct: available !== null && available > 0 && recoverable !== null ? (recoverable / available) * 100 : null,
    requiresAssessment: a.quantified > 0 ? a.requires : null,
  };
}

/** `rows` defaults to every leaf of the inventory; pass a filtered list to summarise a subset. */
export function summarize(inv: Inventory, assessments: Assessments, opts: { basis: Basis; groupBy: GroupBy; rows?: readonly InventoryRow[] }): RecoverySummary {
  const rows = opts.rows ?? inv.rows;
  const groups = new Map<string, Acc>();
  const totals = new Map<Unit, Acc>();
  let assessed = 0;
  const bump = (m: Map<string | Unit, Acc>, k: string | Unit, make: () => Acc, value: number | null, recoverable: number | null, requires: boolean) => {
    let a = m.get(k);
    if (!a) m.set(k, (a = make()));
    a.components++;
    if (value !== null) {
      a.quantified++;
      a.available += value;
      if (requires) a.requires += value;
    }
    if (recoverable !== null) {
      a.recoverable += recoverable;
      a.recoverableComponents++;
    }
  };
  for (const row of rows) {
    const as = assessments.get(row.rec.id);
    const ev = evaluateRow(row, as, opts.basis);
    if (as?.classification) assessed++;
    const requires = !isRecoverableClass(as?.classification ?? null);
    const g = groupKey(row, assessments, opts.groupBy);
    const unit = ev.available.unit;
    const mk = (key: string, label: string, order: number): Acc => ({ key, label, order, unit, components: 0, quantified: 0, available: 0, recoverable: 0, recoverableComponents: 0, requires: 0 });
    bump(groups as Map<string | Unit, Acc>, `${g.key}|${unit}`, () => mk(g.key, g.label, g.order), ev.available.value, ev.recoverable, requires);
    bump(totals as Map<string | Unit, Acc>, unit, () => mk("all", "All", 0), ev.available.value, ev.recoverable, requires);
  }
  const sorted = [...groups.values()].sort((a, b) => a.order - b.order || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) || UNIT_ORDER.indexOf(a.unit) - UNIT_ORDER.indexOf(b.unit));
  return {
    rows: sorted.map(toRow),
    totals: [...totals.values()].sort((a, b) => UNIT_ORDER.indexOf(a.unit) - UNIT_ORDER.indexOf(b.unit)).map(toRow),
    leafCount: rows.length,
    assessedCount: assessed,
  };
}
