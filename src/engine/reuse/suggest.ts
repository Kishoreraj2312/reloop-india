/**
 * Suggested allocation (C2). A suggestion is DERIVED, never stored: it is the ranking filled greedily until the requirement is
 * covered, so the same data always gives the same proposal and nothing is confirmed until the user confirms it.
 *
 * Fill order: the ranking order (strong before conditional, then score, then the larger supply first so that fewer pieces are
 * needed, then id). A component that already holds an allocation for this requirement is skipped (it is already confirmed);
 * what other requirements have taken is respected. Conditional components are used only when asked for.
 */

import { allocatedByComponent, allocatedByRequirement, freeOf, type AllocateInput } from "./ledger";
import type { MatchResult } from "./match";
import { EPS } from "./source";
import type { Allocation, Requirement } from "./types";

export interface ProposalItem extends AllocateInput {
  readonly tier: "strong" | "conditional";
  readonly score: number | null;
  /** The whole free supply of the component is not used: a piece would have to be cut or split. */
  readonly partialPiece: boolean;
}

export interface Proposal {
  readonly requirementId: string;
  readonly items: readonly ProposalItem[];
  readonly quantity: number;
  /** Demand still open after the proposal AND the confirmed allocations. */
  readonly remainingAfter: number;
  readonly conditionalCount: number;
}

export const MAX_PROPOSAL = 2000;

export function proposeFill(req: Requirement, result: MatchResult, allocs: readonly Allocation[], opts: { includeConditional: boolean; max?: number } = { includeConditional: true }): Proposal {
  const byComp = allocatedByComponent(allocs);
  const confirmed = allocatedByRequirement(allocs).get(req.id) ?? 0;
  const mine = new Set(allocs.filter((a) => a.requirementId === req.id).map((a) => a.componentId));
  let remaining = Math.max(0, req.quantity - confirmed);
  const items: ProposalItem[] = [];
  const max = opts.max ?? MAX_PROPOSAL;
  const pools = opts.includeConditional ? [result.strong, result.conditional] : [result.strong];
  outer: for (const pool of pools) {
    for (const c of pool) {
      if (remaining <= EPS || items.length >= max) break outer;
      if (mine.has(c.id)) continue;
      const free = freeOf(c.supply.value, c.id, byComp);
      if (free <= EPS) continue;
      const take = Math.min(free, remaining);
      const quantity = req.unit === "nr" ? Math.floor(take + 1e-9) : Math.round(take * 1e9) / 1e9;
      if (quantity <= EPS) continue;
      items.push({ requirementId: req.id, componentId: c.id, quantity, tier: c.tier === "strong" ? "strong" : "conditional", score: c.score, partialPiece: req.unit !== "nr" && quantity < free - EPS });
      remaining -= quantity;
    }
  }
  const quantity = items.reduce((s, i) => s + i.quantity, 0);
  return { requirementId: req.id, items, quantity: Math.round(quantity * 1e9) / 1e9, remainingAfter: Math.max(0, Math.round(remaining * 1e9) / 1e9), conditionalCount: items.filter((i) => i.tier === "conditional").length };
}

/** What the strong and conditional candidates could supply in total once other requirements' allocations are taken (potential, not an allocation). */
export function potentialSupply(result: MatchResult, allocs: readonly Allocation[], reqId: string): { strong: number; conditional: number } {
  const byComp = allocatedByComponent(allocs);
  const own = new Map(allocs.filter((a) => a.requirementId === reqId).map((a) => [a.componentId, a.quantity]));
  const sum = (list: MatchResult["strong"]) => {
    let s = 0;
    for (const c of list) s += freeOf(c.supply.value, c.id, byComp, own.get(c.id) ?? 0);
    return s;
  };
  return { strong: sum(result.strong), conditional: sum(result.conditional) };
}
