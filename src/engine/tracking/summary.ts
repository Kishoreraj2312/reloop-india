/**
 * Folding a tracking record's history into what it means now (C3). Pure and deterministic: the same events and live data always give the
 * same status, quantities, flags and balance, so nothing shown can be stale or silently overwritten.
 *
 * ACCOUNTING of a record, in its unit:
 *   available   B1 quantity now (+ documented variances)                      Q
 *   recovered   Σ recovered events (null = never recorded; 0 = recorded zero) R      R + L <= Q
 *   not recovered Σ unrecovered events                                         L
 *   reused / recycled / disposed  Σ outcome events (all of the recovered)      U, C, X   U + C + X <= R
 *   in hand     R - U - C - X          recovered, no outcome yet
 *   not yet recovered  Q - R - L       neither recovered nor written off
 *   unaccounted Q - U - C - X - L      what no outcome or write-off explains (= in hand + not yet recovered)
 * Material is counted in exactly one of those places, so moving it between stages never counts it twice.
 */

import type { Unit } from "@/engine/quantities";
import {
  EPS,
  FLAG_LABELS,
  FLAG_LEVELS,
  VARIANCE_TOLERANCE,
  weaker,
  type ActiveAllocation,
  type Expected,
  type Flag,
  type FlagCode,
  type LiveView,
  type PlanEvent,
  type PlanSnapshot,
  type Source,
  type Status,
  type TrackingEvent,
  type TrackingRecord,
} from "./types";

export const isTerminal = (s: Status): boolean => s === "reused" || s === "recycled" || s === "disposed";

export interface PlanView {
  readonly quantity: number | null;
  readonly basis: "b2_estimate" | "user" | "none";
  /** The user's own source for a stated plan. */
  readonly source: Source | null;
  readonly classification: PlanSnapshot["classification"];
  readonly pct: number | null;
  readonly expected: Expected | null;
}

export interface Fold {
  /** Events in force: not void events and not voided. */
  readonly active: readonly TrackingEvent[];
  readonly voided: ReadonlySet<string>;
  readonly status: Status;
  readonly statusAt: string;
  readonly plan: PlanView;
  readonly snapshot: PlanSnapshot | null;
  readonly recovered: number | null;
  readonly reused: number | null;
  readonly recycled: number | null;
  readonly disposed: number | null;
  readonly unrecovered: number | null;
  readonly variance: number;
  /** The weakest source among the quantity events in force (null: none). */
  readonly quality: Source | null;
  /** Reused quantity per C2 allocation id. */
  readonly fulfilled: ReadonlyMap<string, number>;
  /** Reused quantity not tied to a C2 allocation. */
  readonly reusedOutside: number;
  readonly lastRecordedAt: string;
}

const add = (a: number | null, q: number): number => (a ?? 0) + q;

export function fold(record: TrackingRecord): Fold {
  const voided = new Set<string>();
  for (const e of record.events) if (e.kind === "void") voided.add(e.voids);
  const active = record.events.filter((e) => e.kind !== "void" && !voided.has(e.id));
  let status: Status = "planned";
  let statusAt = record.createdAt;
  let snapshot: PlanSnapshot | null = null;
  let userPlan: PlanEvent | null = null;
  let recovered: number | null = null;
  let reused: number | null = null;
  let recycled: number | null = null;
  let disposed: number | null = null;
  let unrecovered: number | null = null;
  let variance = 0;
  let quality: Source | null = null;
  const fulfilled = new Map<string, number>();
  let reusedOutside = 0;
  for (const e of active) {
    switch (e.kind) {
      case "track":
        snapshot = e.plan;
        break;
      case "plan":
        userPlan = e;
        break;
      case "status":
        status = e.status;
        statusAt = e.at;
        break;
      case "recovered":
        recovered = add(recovered, e.quantity);
        quality = weaker(quality, e.source);
        break;
      case "outcome":
        if (e.outcome === "reused") {
          reused = add(reused, e.quantity);
          if (e.allocationId) fulfilled.set(e.allocationId, (fulfilled.get(e.allocationId) ?? 0) + e.quantity);
          else reusedOutside += e.quantity;
        } else if (e.outcome === "recycled") recycled = add(recycled, e.quantity);
        else disposed = add(disposed, e.quantity);
        quality = weaker(quality, e.source);
        break;
      case "unrecovered":
        unrecovered = add(unrecovered, e.quantity);
        quality = weaker(quality, e.source);
        break;
      case "variance":
        variance += e.quantity;
        quality = weaker(quality, e.source);
        break;
      default:
        break;
    }
  }
  const plan: PlanView = userPlan
    ? { quantity: userPlan.quantity, basis: userPlan.quantity === null ? "none" : "user", source: userPlan.quantity === null ? null : userPlan.source, classification: snapshot?.classification ?? null, pct: snapshot?.pct ?? null, expected: snapshot?.expected ?? null }
    : snapshot
      ? { quantity: snapshot.quantity, basis: snapshot.basis, source: null, classification: snapshot.classification, pct: snapshot.pct, expected: snapshot.expected }
      : { quantity: null, basis: "none", source: null, classification: null, pct: null, expected: null };
  return { active, voided, status, statusAt, plan, snapshot, recovered, reused, recycled, disposed, unrecovered, variance, quality, fulfilled, reusedOutside, lastRecordedAt: record.events[record.events.length - 1]?.recordedAt ?? record.createdAt };
}

export interface Summary {
  readonly componentId: string;
  readonly unit: Unit;
  readonly status: Status;
  readonly statusAt: string;
  readonly present: boolean;
  /** B1 quantity now. */
  readonly available: number | null;
  /** Documented variances added to it (0 when none). */
  readonly variance: number;
  /** available + variance: what recorded quantities may add up to (null when the component is missing). */
  readonly effective: number | null;
  readonly planned: number | null;
  readonly plannedBasis: PlanView["basis"];
  readonly plannedSource: Source | null;
  readonly expected: Expected | null;
  readonly classification: PlanSnapshot["classification"];
  readonly pct: number | null;
  readonly recovered: number | null;
  readonly reused: number | null;
  readonly recycled: number | null;
  readonly disposed: number | null;
  readonly unrecovered: number | null;
  /** Recovered, no outcome yet (null while recovery is not recorded). */
  readonly inHand: number | null;
  /** Neither recovered nor written off (null while recovery is not recorded). */
  readonly notYetRecovered: number | null;
  /** What no outcome or write-off explains (the whole effective quantity while recovery is not recorded). */
  readonly unaccounted: number | null;
  /** Recovered ÷ planned, where both are known and the plan is above 0. */
  readonly completion: number | null;
  /** Recovered − planned, where both are known. */
  readonly difference: number | null;
  readonly quality: Source | null;
  readonly fulfilled: ReadonlyMap<string, number>;
  readonly allocations: readonly ActiveAllocation[];
  /** Quantity allocated in C2 now. */
  readonly allocatedC2: number;
  readonly flags: readonly Flag[];
  readonly lastRecordedAt: string;
  readonly events: number;
}

const flag = (code: FlagCode, extra = ""): Flag => ({ code, level: FLAG_LEVELS[code], text: extra ? `${FLAG_LABELS[code]}: ${extra}` : FLAG_LABELS[code] });
const near0 = (n: number): number => (Math.abs(n) < EPS ? 0 : n);

export function summarize(record: TrackingRecord, live: LiveView): Summary {
  const f = fold(record);
  const U = f.reused ?? 0;
  const C = f.recycled ?? 0;
  const X = f.disposed ?? 0;
  const L = f.unrecovered ?? 0;
  const R = f.recovered;
  const available = live.present ? live.available : null;
  const effective = live.present ? (available ?? 0) + f.variance : null;
  const inHand = R === null ? null : near0(R - U - C - X);
  const notYet = R === null || effective === null ? null : near0(effective - R - L);
  const unaccounted = effective === null ? null : R === null ? effective : near0(effective - U - C - X - L);
  const P = f.plan.quantity;
  const completion = P !== null && P > EPS && R !== null ? R / P : null;
  const difference = P !== null && R !== null ? near0(R - P) : null;
  const allocatedC2 = live.allocations.reduce((s, a) => s + a.quantity, 0);

  const flags: Flag[] = [];
  const closed = f.status === "recovered" || f.status === "inspected" || f.status === "allocated" || isTerminal(f.status);
  if (!live.present) flags.push(flag("missing_component"));
  else if (live.unit !== record.unit) flags.push(flag("unit_changed", `${record.unit} → ${live.unit}`));
  if (R !== null && effective !== null && R + L > effective + EPS) flags.push(flag("over_available"));
  if (P === null) flags.push(flag("no_plan"));
  if (f.snapshot) {
    const was = f.snapshot.quantity;
    const now = live.plan.quantity;
    if (was === null ? now !== null : now === null || Math.abs(now - was) > EPS) flags.push(flag("plan_drift"));
  }
  if (R === null && f.status !== "planned") flags.push(flag("recovery_not_recorded"));
  if (closed && P !== null && P > EPS && R !== null) {
    if (R < P * (1 - VARIANCE_TOLERANCE) - EPS) flags.push(flag("below_plan"));
    else if (R > P * (1 + VARIANCE_TOLERANCE) + EPS) flags.push(flag("above_plan"));
  }
  if (isTerminal(f.status)) {
    if (notYet !== null && notYet > EPS) flags.push(flag("incomplete"));
    if (inHand !== null && inHand > EPS) flags.push(flag("in_hand_closed"));
  }
  if (f.plan.expected === "reuse" ? C + X > EPS : f.plan.expected === "recycling" ? X > EPS : false) flags.push(flag("outcome_differs"));
  if (isTerminal(f.status)) for (const a of live.allocations) if ((f.fulfilled.get(a.id) ?? 0) < a.quantity - EPS) flags.push(flag("allocation_unfulfilled", a.requirementName));
  const liveIds = new Set(live.allocations.map((a) => a.id));
  if ([...f.fulfilled.keys()].some((id) => !liveIds.has(id))) flags.push(flag("allocation_cancelled_used"));
  if (f.reusedOutside > EPS && f.plan.expected !== "reuse" && live.allocations.length === 0) flags.push(flag("reused_outside_plan"));
  if (f.quality === "estimated" || f.quality === "assumed") flags.push(flag("assumed_values", f.quality));
  if (f.status === "hold") flags.push(flag("on_hold"));

  return {
    componentId: record.componentId,
    unit: record.unit,
    status: f.status,
    statusAt: f.statusAt,
    present: live.present,
    available,
    variance: f.variance,
    effective,
    planned: P,
    plannedBasis: f.plan.basis,
    plannedSource: f.plan.source,
    expected: f.plan.expected,
    classification: f.plan.classification,
    pct: f.plan.pct,
    recovered: R,
    reused: f.reused,
    recycled: f.recycled,
    disposed: f.disposed,
    unrecovered: f.unrecovered,
    inHand,
    notYetRecovered: notYet,
    unaccounted,
    completion,
    difference,
    quality: f.quality,
    fulfilled: f.fulfilled,
    allocations: live.allocations,
    allocatedC2,
    flags,
    lastRecordedAt: f.lastRecordedAt,
    events: record.events.length,
  };
}
