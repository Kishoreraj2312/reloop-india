/**
 * What the rest of the application says about a component (C3), read, never written: the PLAN (B2's recovery estimate), the component's
 * B1 quantity, its C2 allocations and its place in the B3 removal plan. The tracking engine works on a `LiveView` built here, so the
 * engine itself stays independent of every store.
 */

import type { Inventory, InventoryRow } from "@/engine/quantities";
import { isRecoverableClass, type Assessments, type RecoveryAssessment } from "@/engine/recovery";
import type { ActiveAllocation, Expected, LiveView, PlanNow, PlanSnapshot, RemovalView } from "./types";

/** An allocation as far as C3 needs it (the C2 `Allocation` and the requirement's name). */
export interface AllocationInput {
  readonly id: string;
  readonly requirementId: string;
  readonly componentId: string;
  readonly quantity: number;
}

export interface TrackingContext {
  readonly inv: Inventory;
  readonly assessments: Assessments;
  readonly allocations: readonly AllocationInput[];
  /** Requirement id -> name (C2). */
  readonly requirementNames: ReadonlyMap<string, string>;
  /** Leaf component id -> its place in the active B3 removal plan. */
  readonly removal: ReadonlyMap<string, RemovalView>;
}

export const EMPTY_PLAN: PlanNow = Object.freeze({ quantity: null, classification: null, pct: null, expected: null });

/**
 * The planned recovery B2 gives a component: the B1 quantity × the recovery % of a reuse, refurbish or recycling classification (net of
 * loss, as B2 defines it). Anything else has no planned quantity (null), never 0. Whole items are planned to the nearest whole item.
 */
export function planNow(row: InventoryRow, a: RecoveryAssessment | undefined): PlanNow {
  const cls = a?.classification ?? null;
  const expected: Expected | null = cls === "direct_reuse" || cls === "refurbish_reuse" ? "reuse" : cls === "recycling" ? "recycling" : null;
  const v = row.q.primary.value;
  if (isRecoverableClass(cls) && a!.recoveryPct !== null && v !== null) {
    const q = (v * a!.recoveryPct) / 100;
    return { quantity: row.q.primary.unit === "nr" ? Math.round(q) : q, classification: cls, pct: a!.recoveryPct, expected };
  }
  return { quantity: null, classification: cls, pct: a?.recoveryPct ?? null, expected };
}

export const snapshotOf = (p: PlanNow): PlanSnapshot => ({ quantity: p.quantity, basis: p.quantity === null ? "none" : "b2_estimate", classification: p.classification, pct: p.pct, expected: p.expected });

/** Component id -> its C2 allocations (built once per context). */
function allocationIndex(ctx: TrackingContext): Map<string, ActiveAllocation[]> {
  const m = new Map<string, ActiveAllocation[]>();
  for (const a of ctx.allocations) {
    const l = m.get(a.componentId) ?? [];
    l.push({ id: a.id, requirementId: a.requirementId, requirementName: ctx.requirementNames.get(a.requirementId) ?? a.requirementId, quantity: a.quantity });
    m.set(a.componentId, l);
  }
  return m;
}

const NONE: readonly ActiveAllocation[] = Object.freeze([]);

/** A function giving the live view of any component id. */
export function liveFn(ctx: TrackingContext): (id: string) => LiveView {
  const idx = allocationIndex(ctx);
  return (id) => {
    const rec = ctx.inv.recordById.get(id);
    const q = ctx.inv.byId.get(id);
    const leaf = !!rec && !!q && rec.geometry.kind !== "group";
    return {
      present: leaf,
      available: leaf ? q!.primary.value : null,
      unit: leaf ? q!.primary.unit : null,
      plan: leaf ? planNow({ rec: rec!, q: q! }, ctx.assessments.get(id)) : EMPTY_PLAN,
      allocations: idx.get(id) ?? NONE,
      removal: ctx.removal.get(id) ?? null,
    };
  };
}

// ── the planned scope ────────────────────────────────────────────────────────

export interface ScopeEvidence {
  /** B2 reuse / refurbish / recycling classification. */
  readonly b2: boolean;
  readonly planned: number | null;
  readonly c2: boolean;
  readonly b3: RemovalView | null;
}

/**
 * The components something already plans to recover: a B2 reuse / refurbish / recycling classification, a place in the active B3 removal
 * plan, or a C2 allocation. Nothing else is "planned"; any other component can still be tracked (it is then an unplanned recovery).
 */
export function planScope(ctx: TrackingContext): Map<string, ScopeEvidence> {
  const out = new Map<string, ScopeEvidence>();
  const touch = (id: string, patch: Partial<{ b2: boolean; planned: number | null; c2: boolean; b3: RemovalView | null }>) => {
    const cur = out.get(id) ?? { b2: false, planned: null, c2: false, b3: null };
    out.set(id, { ...cur, ...patch });
  };
  for (const [id, a] of ctx.assessments) {
    if (!isRecoverableClass(a.classification)) continue;
    const rec = ctx.inv.recordById.get(id);
    const q = ctx.inv.byId.get(id);
    if (!rec || !q || rec.geometry.kind === "group") continue;
    touch(id, { b2: true, planned: planNow({ rec, q }, a).quantity });
  }
  for (const a of ctx.allocations) if (ctx.inv.recordById.has(a.componentId)) touch(a.componentId, { c2: true });
  for (const [id, r] of ctx.removal) if (ctx.inv.recordById.has(id)) touch(id, { b3: r });
  return out;
}

