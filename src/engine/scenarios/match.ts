/**
 * Which real components a selection in the comparison stands for (B4). Pure: the 3D overlay only paints these.
 *
 * A selection is a material category and/or an outcome (direct reuse, refurbished reuse, recycling, disposal, unknown)
 * and/or a missing-assumption code. Ids are LEAF record ids, the same ids B1, B2 and the 3D registry use. An outcome
 * selects the components with a non-zero quantity in that outcome; a component split 60 % recycling / 40 % disposal is
 * therefore in both. Each match carries the outcome its colour comes from.
 */

import type { Inventory, Unit } from "@/engine/quantities";
import type { Assessments, Basis } from "@/engine/recovery";
import { allocateLeaf, decide, makeContext } from "./compute";
import { PATHWAYS, type MissingCode, type Pathway, type Scenario } from "./types";

export interface Selector {
  /** Material category (substance). */
  readonly category?: string;
  readonly outcome?: Pathway;
  readonly missing?: MissingCode;
  /** With the "quantity" basis: only components measured in this unit. */
  readonly unit?: Unit;
}

export interface Match {
  readonly id: string;
  /** The outcome the component is shown as: the selected one, else the one holding most of its quantity. */
  readonly outcome: Pathway;
  /** Another workspace (C2) paints this component in its own colour (0xRRGGBB) instead of the outcome colour. */
  readonly colour?: number;
}

export const selectorKey = (s: Selector | null): string => (s ? `${s.category ?? ""}|${s.outcome ?? ""}|${s.missing ?? ""}|${s.unit ?? ""}` : "");

export function matchLeaves(inv: Inventory, assessments: Assessments, scenario: Scenario, basis: Basis, sel: Selector): Match[] {
  const ctx = makeContext(inv, assessments, scenario);
  const out: Match[] = [];
  for (const row of inv.rows) {
    const d = decide(ctx, row);
    if (sel.category !== undefined && d.category !== sel.category) continue;
    if (sel.missing !== undefined && d.effective.missing !== sel.missing) continue;
    const o = allocateLeaf(d, row, basis);
    if (sel.unit !== undefined && o.unit !== sel.unit) continue;
    if (sel.outcome !== undefined) {
      if (o.allocation && o.allocation.outcome[sel.outcome] > 0) out.push({ id: d.id, outcome: sel.outcome });
      continue;
    }
    let best: Pathway = d.effective.pathway;
    if (o.allocation) {
      let v = 0;
      for (const p of PATHWAYS) if (o.allocation.outcome[p] > v) (v = o.allocation.outcome[p]), (best = p);
    }
    out.push({ id: d.id, outcome: best });
  }
  return out;
}
