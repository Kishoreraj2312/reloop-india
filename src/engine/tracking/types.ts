/**
 * Recovery tracking (C3) — data model.
 *
 * A tracking record follows ONE leaf component (keyed by its stable id, the same id B1, B2, B3, C1 and C2 use) from planned recovery
 * to its actual final outcome. It is an append-only HISTORY of events the user (or, for C2 changes, the system) recorded; everything
 * else — status, quantities, completion, discrepancies — is derived from it, so a stale figure cannot be shown and nothing is
 * overwritten: a mistake is corrected by VOIDING an event, which stays visible in the history.
 *
 * Planned and actual are kept apart. The PLAN is read from B2 (a snapshot taken when tracking starts, plus any plan the user states);
 * ACTUAL quantities exist only as events with a source (measured / estimated / assumed). Being recovered or allocated in C2 never makes
 * material "reused": reused is an outcome event with a quantity. B1 quantities, B2 assessments, B3 plans, C1 passports and C2 allocations
 * are only read.
 *
 * Every quantity of a record is in ONE unit, the component's own B1 primary unit (no conversion). A quantity that was never recorded is
 * `null` ("not recorded"), which is not the same as an explicit 0.
 */

import type { Unit } from "@/engine/quantities";
import type { Classification } from "@/engine/recovery";

// ── status ───────────────────────────────────────────────────────────────────

export const STATUSES = ["planned", "in_progress", "recovered", "inspected", "allocated", "reused", "recycled", "disposed", "hold"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Readonly<Record<Status, string>> = {
  planned: "Planned for recovery",
  in_progress: "Deconstruction in progress",
  recovered: "Recovered",
  inspected: "Inspected",
  allocated: "Allocated for reuse",
  reused: "Reused",
  recycled: "Recycled",
  disposed: "Disposed",
  hold: "On hold / outcome unknown",
};
export const STATUS_SHORT: Readonly<Record<Status, string>> = { planned: "Planned", in_progress: "In progress", recovered: "Recovered", inspected: "Inspected", allocated: "Allocated", reused: "Reused", recycled: "Recycled", disposed: "Disposed", hold: "On hold" };

/** The stages in the order material normally passes through them (the three outcomes share the last). On hold has no place in the order. */
export const STAGE_ORDER: Readonly<Record<Status, number>> = { planned: 0, in_progress: 1, recovered: 2, inspected: 3, allocated: 4, reused: 5, recycled: 5, disposed: 5, hold: -1 };

export const OUTCOMES = ["reused", "recycled", "disposed"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = { reused: "Reused", recycled: "Recycled", disposed: "Disposed" };

/** Where an actual quantity comes from. A record's quality is its weakest source. */
export const SOURCES = ["measured", "estimated", "assumed"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABELS: Readonly<Record<Source, string>> = { measured: "measured", estimated: "estimated", assumed: "assumed" };
export const SOURCE_RANK: Readonly<Record<Source, number>> = { measured: 0, estimated: 1, assumed: 2 };
export const weaker = (a: Source | null, b: Source | null): Source | null => (a === null ? b : b === null ? a : SOURCE_RANK[a] >= SOURCE_RANK[b] ? a : b);

/** The pathway the plan (B2) expects for the recovered material. */
export type Expected = "reuse" | "recycling";
export const EXPECTED_LABELS: Readonly<Record<Expected, string>> = { reuse: "Reuse", recycling: "Recycling" };

// ── events ───────────────────────────────────────────────────────────────────

export const MAX_NOTE = 1000;
export const MAX_SHORT = 160;

/** The plan as it stood when tracking started (B2 is read again later to show drift; this is never rewritten). */
export interface PlanSnapshot {
  /** Planned recovery in the record's unit: B1 quantity × B2 recovery % for a reuse / refurbish / recycling classification; null = no planned quantity. */
  readonly quantity: number | null;
  readonly basis: "b2_estimate" | "none";
  readonly classification: Classification | null;
  readonly pct: number | null;
  readonly expected: Expected | null;
}

interface Base {
  readonly id: string;
  /** When it happened (ISO, user-stated; defaults to the time of recording). */
  readonly at: string;
  /** When it was recorded (ISO, the system clock): the history is ordered by this. */
  readonly recordedAt: string;
  readonly by: "user" | "system";
  readonly note: string;
}
export interface TrackEvent extends Base { readonly kind: "track"; readonly plan: PlanSnapshot }
/** The user's own planned quantity (replaces the snapshot's; null = withdraw the planned quantity). */
export interface PlanEvent extends Base { readonly kind: "plan"; readonly quantity: number | null; readonly source: Source; readonly method: string }
export interface StatusEvent extends Base { readonly kind: "status"; readonly status: Status; readonly from: Status | null }
/** Actual recovery: a quantity physically recovered (0 is a recorded zero). Cumulative across events. */
export interface RecoveredEvent extends Base { readonly kind: "recovered"; readonly quantity: number; readonly source: Source; readonly method: string }
/** Where recovered material went. Never created by recovering or allocating: only by an explicit outcome. */
export interface OutcomeEvent extends Base {
  readonly kind: "outcome";
  readonly outcome: Outcome;
  readonly quantity: number;
  readonly source: Source;
  readonly method: string;
  /** Free text: the project, the recycler, the landfill … */
  readonly destination: string;
  /** A reused outcome fulfilling a C2 allocation (the C2 allocation id), else null. */
  readonly allocationId: string | null;
  readonly requirementId: string | null;
  readonly requirementName: string | null;
}
/** Material confirmed NOT recovered (lost, destroyed, sent to waste): the rest stays unaccounted until this or an outcome is recorded. */
export interface UnrecoveredEvent extends Base { readonly kind: "unrecovered"; readonly quantity: number; readonly source: Source; readonly method: string; readonly reason: string }
/** A documented reconciliation: the real quantity differs from B1's modelled one (delta, either sign). B1 itself is never changed. */
export interface VarianceEvent extends Base { readonly kind: "variance"; readonly quantity: number; readonly source: Source; readonly method: string; readonly reason: string }
export interface NoteEvent extends Base { readonly kind: "note" }
/** The system saw the record's C2 allocation change (created, changed, cancelled) or a reused outcome fulfil it. */
export interface AllocationEvent extends Base {
  readonly kind: "allocation";
  readonly change: "created" | "changed" | "cancelled" | "fulfilled";
  readonly allocationId: string;
  readonly requirementId: string;
  readonly requirementName: string;
  readonly quantity: number;
  readonly previous: number | null;
}
export interface VoidEvent extends Base { readonly kind: "void"; readonly voids: string; readonly reason: string }

export type TrackingEvent = TrackEvent | PlanEvent | StatusEvent | RecoveredEvent | OutcomeEvent | UnrecoveredEvent | VarianceEvent | NoteEvent | AllocationEvent | VoidEvent;
export type EventKind = TrackingEvent["kind"];

/** The last C2 allocation the record saw, so a change can be logged instead of silently adopted. */
export interface SeenAllocation {
  readonly requirementId: string;
  readonly requirementName: string;
  readonly quantity: number;
}

export interface TrackingRecord {
  readonly componentId: string;
  /** The component's B1 primary unit when tracking started. Every quantity of the record is in it. */
  readonly unit: Unit;
  /** The B1 quantity when tracking started (null: none): kept only to show drift if the model is regenerated. */
  readonly availableAtStart: number | null;
  readonly events: readonly TrackingEvent[];
  readonly seen: Readonly<Record<string, SeenAllocation>>;
  readonly createdAt: string;
}

/** A named group of components for working on them together. A batch holds NO quantities: reports count every component once. */
export interface Batch {
  readonly id: string;
  readonly name: string;
  readonly componentIds: readonly string[];
  readonly createdAt: string;
}

export type Records = Readonly<Record<string, TrackingRecord>>;

// ── live inputs (read from the other modules, never written) ──────────────────────

export interface ActiveAllocation {
  readonly id: string;
  readonly requirementId: string;
  readonly requirementName: string;
  readonly quantity: number;
}

export interface RemovalView {
  readonly planName: string;
  /** 1-based step of the entry that stands for the component. */
  readonly step: number;
  readonly steps: number;
}

export interface PlanNow {
  readonly quantity: number | null;
  readonly classification: Classification | null;
  readonly pct: number | null;
  readonly expected: Expected | null;
}

/** What the rest of the application currently says about one component. */
export interface LiveView {
  /** The component is a leaf of the current model. */
  readonly present: boolean;
  /** B1 primary quantity and unit now (null quantity: none; null unit: component missing). */
  readonly available: number | null;
  readonly unit: Unit | null;
  /** The plan B2 gives now (to show drift against the snapshot). */
  readonly plan: PlanNow;
  readonly allocations: readonly ActiveAllocation[];
  readonly removal: RemovalView | null;
}

// ── flags ────────────────────────────────────────────────────────────────────

export type FlagLevel = "error" | "warning" | "info";
export const FLAG_CODES = [
  "missing_component",
  "unit_changed",
  "over_available",
  "no_plan",
  "plan_drift",
  "recovery_not_recorded",
  "below_plan",
  "above_plan",
  "incomplete",
  "in_hand_closed",
  "outcome_differs",
  "allocation_unfulfilled",
  "allocation_cancelled_used",
  "reused_outside_plan",
  "assumed_values",
  "on_hold",
] as const;
export type FlagCode = (typeof FLAG_CODES)[number];
export const FLAG_LEVELS: Readonly<Record<FlagCode, FlagLevel>> = {
  missing_component: "error",
  unit_changed: "error",
  over_available: "error",
  no_plan: "warning",
  plan_drift: "info",
  recovery_not_recorded: "warning",
  below_plan: "warning",
  above_plan: "warning",
  incomplete: "warning",
  in_hand_closed: "warning",
  outcome_differs: "warning",
  allocation_unfulfilled: "warning",
  allocation_cancelled_used: "info",
  reused_outside_plan: "info",
  assumed_values: "info",
  on_hold: "warning",
};
export const FLAG_LABELS: Readonly<Record<FlagCode, string>> = {
  missing_component: "Component is not in the current model",
  unit_changed: "The component's unit changed since tracking started",
  over_available: "More booked than the component's available quantity",
  no_plan: "No planned quantity",
  plan_drift: "B2's estimate has changed since tracking started",
  recovery_not_recorded: "No recovered quantity recorded yet",
  below_plan: "Recovered less than planned",
  above_plan: "Recovered more than planned",
  incomplete: "Closed with material still unaccounted",
  in_hand_closed: "Recovered material has no outcome yet",
  outcome_differs: "Outcome differs from the plan",
  allocation_unfulfilled: "C2 allocation not fully fulfilled",
  allocation_cancelled_used: "Reused against a C2 allocation that was later cancelled",
  reused_outside_plan: "Reused outside a C2 allocation",
  assumed_values: "Some quantities are estimated or assumed, not measured",
  on_hold: "On hold: outcome unknown",
};
export interface Flag {
  readonly code: FlagCode;
  readonly level: FlagLevel;
  readonly text: string;
}

/** Recovered vs planned beyond this share is flagged (the difference is always shown as a number; the flag marks a material one). */
export const VARIANCE_TOLERANCE = 0.1;
export const EPS = 1e-9;
