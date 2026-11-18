/**
 * The quantity calculation of one component (B4). Pure.
 *
 *   Estimated recovered quantity = Allocated quantity × Recovery percentage / 100
 *   Unrecovered residual         = Allocated quantity − Estimated recovered quantity
 *
 * The residual goes to disposal or unknown (the user's choice). Disposal and unknown allocate the whole quantity.
 * A recovery pathway without a usable percentage recovers nothing it can state: its recovered quantity is
 * unavailable (null) and the whole allocation is carried as UNKNOWN, visible and never invented. The percentage is
 * already net of loss, so no second loss factor is applied. Every outcome sums to the allocated quantity.
 */

import { validatePct } from "@/engine/recovery";
import { isRecoveryPathway, PATHWAYS, type Pathway, type PathwayQuantities, type Residual } from "./types";

export const zeroQuantities = (): Record<Pathway, number> => ({ direct_reuse: 0, refurbish_reuse: 0, recycling: 0, disposal: 0, unknown: 0 });

export interface Allocation {
  /** The pathway the quantity was allocated to. */
  readonly pathway: Pathway;
  readonly quantity: number;
  /** Quantity recovered through `pathway`; null when `pathway` does not recover material or has no usable %. */
  readonly recovered: number | null;
  /** Allocated − recovered for a configured recovery pathway; the whole quantity when the percentage is unavailable; 0 otherwise. */
  readonly residual: number;
  /** True when a recovery pathway had no usable percentage (the quantity is carried as unknown). */
  readonly unconfigured: boolean;
  /** Where the quantity ends up; sums to `quantity`. */
  readonly outcome: PathwayQuantities;
}

/** Tolerance for "equal" quantities: relative 1e-9 (float noise from summing ~10^5 values), never an absolute fudge. */
export const nearlyEqual = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

export function allocate(quantity: number, pathway: Pathway, recoveryPct: number | null, residual: Residual): Allocation {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) throw new RangeError(`Quantity must be a finite number ≥ 0 (got ${String(quantity)})`);
  const outcome = zeroQuantities();
  if (!isRecoveryPathway(pathway)) {
    outcome[pathway] = quantity;
    return { pathway, quantity, recovered: null, residual: 0, unconfigured: false, outcome };
  }
  // Not configured, or not a valid percentage: never guessed, never zero — the whole quantity stays visible as unknown.
  if (recoveryPct === null || validatePct(recoveryPct) !== null) {
    outcome.unknown = quantity;
    return { pathway, quantity, recovered: null, residual: quantity, unconfigured: true, outcome };
  }
  const recovered = recoveryPct === 0 ? 0 : recoveryPct === 100 ? quantity : Math.min(quantity, (quantity * recoveryPct) / 100);
  const left = quantity - recovered;
  outcome[pathway] = recovered;
  outcome[residual] += left;
  return { pathway, quantity, recovered, residual: left, unconfigured: false, outcome };
}

/** Σ of the five outcomes. */
export const outcomeSum = (o: PathwayQuantities): number => PATHWAYS.reduce((s, p) => s + o[p], 0);
