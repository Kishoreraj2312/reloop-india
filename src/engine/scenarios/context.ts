/**
 * B3 removal-plan context for a scenario (B4). Pure and read-only.
 *
 * A removal plan lists the user's intended order; it does not show that anything has been removed, that the removal is
 * safe, or that a pathway is feasible. This only counts how many of the components a scenario expects to recover
 * material from are covered by the plan's entries (an assembly entry stands for its parts).
 */

import { leafDescendants, type Inventory } from "@/engine/quantities";
import type { Assessments, Basis } from "@/engine/recovery";
import { allocateLeaf, decide, diverted, makeContext } from "./compute";
import type { Scenario } from "./types";

export interface RemovalContext {
  /** Components of the scenario with a recovered quantity above zero on this basis. */
  readonly recoveryComponents: number;
  readonly inPlan: number;
  readonly notInPlan: number;
  /** Plan entries that are not records of this model. */
  readonly unknownEntries: number;
}

export function removalContext(inv: Inventory, assessments: Assessments, scenario: Scenario, basis: Basis, planEntries: readonly string[]): RemovalContext {
  const covered = new Set<string>();
  let unknownEntries = 0;
  for (const id of planEntries) {
    if (!inv.recordById.has(id)) unknownEntries++;
    else for (const l of leafDescendants(inv, id)) covered.add(l.rec.id);
  }
  const ctx = makeContext(inv, assessments, scenario);
  let recoveryComponents = 0;
  let inPlan = 0;
  for (const row of inv.rows) {
    const o = allocateLeaf(decide(ctx, row), row, basis);
    if (!o.allocation || !(diverted(o.allocation.outcome) > 0)) continue;
    recoveryComponents++;
    if (covered.has(row.rec.id)) inPlan++;
  }
  return { recoveryComponents, inPlan, notInPlan: recoveryComponents - inPlan, unknownEntries };
}
