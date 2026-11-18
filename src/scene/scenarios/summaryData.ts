/** Small derived lists for the scenario UI (B4): read-only views of the B1 inventory and the B2 assessments. */

import type { Inventory } from "@/engine/quantities";
import type { Assessments } from "@/engine/recovery";
import { categoryLabel, materialCategoryOf } from "@/engine/scenarios";

export interface CategoryCount {
  readonly key: string;
  /** Leaf components of the category. */
  readonly components: number;
  /** Of those, how many carry a B2 classification. */
  readonly assessed: number;
}

const cache = new WeakMap<Inventory, WeakMap<Assessments, readonly CategoryCount[]>>();

/** Material categories present in the model, with how many leaves they have and how many are assessed in B2. */
export function substanceCountsOf(inv: Inventory, assessments: Assessments): readonly CategoryCount[] {
  let byA = cache.get(inv);
  if (!byA) cache.set(inv, (byA = new WeakMap()));
  let r = byA.get(assessments);
  if (!r) {
    const m = new Map<string, { components: number; assessed: number }>();
    for (const row of inv.rows) {
      const k = materialCategoryOf(row.rec.materialId);
      const e = m.get(k) ?? { components: 0, assessed: 0 };
      e.components++;
      if (assessments.get(row.rec.id)?.classification) e.assessed++;
      m.set(k, e);
    }
    r = [...m].map(([key, v]) => ({ key, ...v })).sort((a, b) => (categoryLabel(a.key) < categoryLabel(b.key) ? -1 : 1));
    byA.set(assessments, r);
  }
  return r;
}
