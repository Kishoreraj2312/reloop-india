/**
 * Aggregation (B1). Rules that keep totals honest:
 *  - only LEAF records are summed; assemblies never contribute a physical quantity
 *  - a leaf contributes at most one value per unit (its primary, its secondary measures and its
 *    mass all have different units), so Σ by floor = Σ by category = Σ by material = building
 *  - a total's status is the worst status among the members that contributed a value
 *  - members that should have contributed but have no value are counted in `incompleteCount`;
 *    a unit with only missing members is value null / "unavailable", never 0
 */

import { UNIT_KIND, worseStatus, type ComponentQuantities, type QuantityResult, type Status, type Unit } from "./types";

export interface AggTotal {
  /** Null when no member produced a value (never 0 for unknown). */
  readonly value: number | null;
  readonly status: Status;
  /** Members that contributed a value. */
  readonly count: number;
  /** Members of this unit whose value is unavailable (a partial total when > 0). */
  readonly incompleteCount: number;
}

export interface Bucket {
  readonly key: string;
  /** Leaf components in the bucket. */
  readonly leafCount: number;
  /** Leaves carrying at least one warning-level issue. */
  readonly warningCount: number;
  readonly totals: Readonly<Partial<Record<Unit, AggTotal>>>;
}

export type Measures = (q: ComponentQuantities) => Iterable<QuantityResult>;

/** Every measure a leaf contributes: primary, secondary, mass. */
export function* allMeasures(q: ComponentQuantities): Iterable<QuantityResult> {
  yield q.primary;
  yield* q.secondary;
  yield q.mass;
}

interface Acc {
  value: number;
  status: Status;
  count: number;
  incomplete: number;
}

export class Accumulator {
  private readonly acc = new Map<Unit, Acc>();
  leafCount = 0;
  warningCount = 0;

  add(q: ComponentQuantities, measures: Measures = allMeasures): void {
    this.leafCount++;
    let warned = false;
    for (const m of measures(q)) {
      let a = this.acc.get(m.unit);
      if (!a) this.acc.set(m.unit, (a = { value: 0, status: "calculated", count: 0, incomplete: 0 }));
      if (m.value === null) a.incomplete++;
      else {
        a.value += m.value;
        a.count++;
        a.status = worseStatus(a.status, m.status);
      }
      if (!warned && m.issues.some((i) => i.severity === "warning")) warned = true;
    }
    if (warned) this.warningCount++;
  }

  bucket(key: string): Bucket {
    const totals: Partial<Record<Unit, AggTotal>> = {};
    for (const [unit, a] of this.acc) {
      totals[unit] = a.count === 0 ? { value: null, status: "unavailable", count: 0, incompleteCount: a.incomplete } : { value: a.value, status: a.status, count: a.count, incompleteCount: a.incomplete };
    }
    return { key, leafCount: this.leafCount, warningCount: this.warningCount, totals };
  }
}

export type KeyOf<T> = (row: T) => string;

/** Group leaves by `keyOf` and total each group (insertion order = first appearance). */
export function aggregateBy<T extends { readonly q: ComponentQuantities }>(rows: Iterable<T>, keyOf: KeyOf<T>): Map<string, Bucket> {
  const accs = new Map<string, Accumulator>();
  for (const row of rows) {
    const k = keyOf(row);
    let a = accs.get(k);
    if (!a) accs.set(k, (a = new Accumulator()));
    a.add(row.q);
  }
  const out = new Map<string, Bucket>();
  for (const [k, a] of accs) out.set(k, a.bucket(k));
  return out;
}

/** One bucket for a whole set of leaves. */
export function totalOf<T extends { readonly q: ComponentQuantities }>(rows: Iterable<T>, key = "total"): Bucket {
  const a = new Accumulator();
  for (const r of rows) a.add(r.q);
  return a.bucket(key);
}

/** The value of one measure kind in a bucket, or null. */
export const bucketValue = (b: Bucket | undefined, unit: Unit): number | null => b?.totals[unit]?.value ?? null;

export const kindOfUnit = (u: Unit) => UNIT_KIND[u];
