/**
 * Recording what happens to a component (C3). Pure and immutable: every operation takes a record and returns a NEW record (the same
 * object when nothing changed) or an error and no record. Every operation validates the result against the accounting of summary.ts and
 * the status rules below, so an invalid state cannot be created, and nothing is ever edited in place: the history only grows.
 *
 * STATUS RULES (a status is the user's statement of the stage, checked against the recorded quantities)
 *   recovered / inspected  need a recovered quantity above 0
 *   allocated              needs a recovered quantity and an active C2 allocation for the component
 *   reused / recycled / disposed   need a recorded outcome of that kind (never implied by recovery or by a C2 allocation)
 *   planned                only while no recovered quantity is recorded
 *   in progress            from planned / on hold, or while material remains to be recovered
 *   on hold                needs a reason; any stage can be resumed from it
 *   leaving an outcome for an earlier stage only while recovered material is still in hand
 */

import { fold, isTerminal, type Fold } from "./summary";
import {
  EPS,
  MAX_NOTE,
  MAX_SHORT,
  OUTCOMES,
  SOURCES,
  STATUSES,
  STATUS_LABELS,
  type ActiveAllocation,
  type AllocationEvent,
  type LiveView,
  type Outcome,
  type PlanEvent,
  type PlanSnapshot,
  type Source,
  type Status,
  type StatusEvent,
  type TrackingEvent,
  type TrackingRecord,
} from "./types";
import { UNIT_LABEL, type Unit } from "@/engine/quantities";

export interface OpContext {
  /** ISO time of recording (injected so results are deterministic). */
  readonly now: string;
  readonly newId: () => string;
  readonly live: LiveView;
}

export interface OpResult {
  readonly record: TrackingRecord | null;
  readonly error: string | null;
  /** The events appended (empty on error or when nothing changed). */
  readonly added: readonly TrackingEvent[];
}
const fail = (error: string): OpResult => ({ record: null, error, added: [] });

// ── small validators ─────────────────────────────────────────────────────────

/** An ISO date (YYYY-MM-DD) or date-time, not more than a day ahead of `now`; empty = now. */
export function parseAt(text: string | undefined, now: string): { at: string; error: string | null } {
  const t = (text ?? "").trim();
  if (t === "") return { at: now, error: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(t);
  if (!m) return { at: now, error: "The date must be written YYYY-MM-DD (or a full ISO date-time)" };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1990 || y > 2100 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return { at: now, error: "That is not a real date" };
  const ms = m[4] === undefined ? dt.getTime() : Date.parse(t);
  if (!Number.isFinite(ms)) return { at: now, error: "That is not a real date-time" };
  if (ms > Date.parse(now) + 24 * 3600 * 1000) return { at: now, error: "A recovery cannot be dated in the future" };
  return { at: new Date(ms).toISOString(), error: null };
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const tooLong = (v: unknown, max: number): boolean => typeof v === "string" && v.trim().length > max;

/** Error text for a quantity in this unit, or null. */
export function quantityError(unit: Unit, q: unknown, opts: { allowZero?: boolean; signed?: boolean } = {}): string | null {
  if (typeof q !== "number" || !Number.isFinite(q)) return "Quantity must be a number";
  if (opts.signed) {
    if (q === 0) return "A variance of 0 changes nothing";
  } else if (q < 0 || (!opts.allowZero && q === 0)) return opts.allowZero ? "Quantity cannot be negative" : "Quantity must be above 0";
  if (unit === "nr" && !Number.isInteger(q)) return "A count is recorded in whole items";
  return null;
}

const checkSource = (s: unknown): string | null => (SOURCES as readonly string[]).includes(s as string) ? null : "Say whether the quantity is measured, estimated or assumed";

// ── invariants of a record ───────────────────────────────────────────────────

const sum = (...n: (number | null)[]): number => n.reduce<number>((s, v) => s + (v ?? 0), 0);

/** Why a record's history is not a possible state, or null. Needs no live data. */
export function structuralError(f: Fold): string | null {
  const R = f.recovered;
  const outcomes = sum(f.reused, f.recycled, f.disposed);
  if (R === null && (outcomes > 0 || f.unrecovered !== null || f.reused !== null || f.recycled !== null || f.disposed !== null)) return "Record the recovered quantity first (it may be 0): outcomes and write-offs are of recovered material";
  if (R !== null && outcomes > R + EPS) return "The outcomes add up to more than was recovered";
  const s = f.status;
  if ((s === "recovered" || s === "inspected" || s === "allocated") && !(R !== null && R > EPS)) return `${STATUS_LABELS[s]} needs a recovered quantity above 0`;
  if (s === "reused" && !((f.reused ?? 0) > EPS)) return "Reused needs a recorded reused quantity";
  if (s === "recycled" && !((f.recycled ?? 0) > EPS)) return "Recycled needs a recorded recycled quantity";
  if (s === "disposed" && !((f.disposed ?? 0) > EPS)) return "Disposed needs a recorded disposed quantity";
  if (s === "planned" && R !== null) return "A component with recovery recorded is no longer only planned";
  return null;
}

/** Why a record books more than the component can supply, or null. */
export function availableError(f: Fold, live: LiveView, unit: Unit): string | null {
  if (f.recovered === null) return null;
  if (!live.present) return null; // reported by the flags: the component is not in the model
  const q = (live.available ?? 0) + f.variance;
  if (q < -EPS) return "Documented variances take the available quantity below 0";
  if (f.recovered + (f.unrecovered ?? 0) > q + EPS) return `More booked (${fmt(f.recovered + (f.unrecovered ?? 0), unit)}) than the available ${fmt(q, unit)}. If the real quantity differs from B1's modelled one, record a documented variance (with its reason) first`;
  return null;
}

const fmt = (v: number, unit: Unit): string => `${Number(v.toPrecision(6)).toLocaleString("en-US")} ${UNIT_LABEL[unit]}`;

/** Why a move to `to` is not allowed from the current state, or null. (A reason for On hold is asked for by the operation.) */
export function moveError(f: Fold, live: LiveView, to: Status): string | null {
  const from = f.status;
  if (to === from) return "It is already in that stage";
  const R = f.recovered;
  const hasR = R !== null && R > EPS;
  const U = f.reused ?? 0;
  const C = f.recycled ?? 0;
  const X = f.disposed ?? 0;
  const inHand = R === null ? 0 : R - U - C - X;
  switch (to) {
    case "planned":
      return R === null ? null : "Recovered quantities are recorded: void them first to return to planned";
    case "in_progress": {
      if (from === "planned" || from === "hold") return null;
      const left = live.present ? (live.available ?? 0) + f.variance - (R ?? 0) - (f.unrecovered ?? 0) : 0;
      return left > EPS ? null : "Nothing is left to recover";
    }
    case "recovered":
    case "inspected":
      if (!hasR) return "Record the recovered quantity first";
      return isTerminal(from) && inHand <= EPS ? "Everything recovered already has an outcome" : null;
    case "allocated":
      if (!hasR) return "Record the recovered quantity first";
      if (live.allocations.length === 0) return "There is no active C2 allocation for this component";
      return isTerminal(from) && inHand <= EPS ? "Everything recovered already has an outcome" : null;
    case "reused":
      return U > EPS ? null : "Record a reused outcome first: being recovered or allocated does not make material reused";
    case "recycled":
      return C > EPS ? null : "Record a recycled outcome first";
    case "disposed":
      return X > EPS ? null : "Record a disposed outcome first";
    case "hold":
      return null;
  }
}

/** Every stage with whether the record can move to it now, and why not. */
export function moves(record: TrackingRecord, live: LiveView): { status: Status; error: string | null }[] {
  const f = fold(record);
  return STATUSES.filter((s) => s !== f.status).map((status) => ({ status, error: moveError(f, live, status) }));
}

// ── appending events ─────────────────────────────────────────────────────────

interface Draft {
  at?: string | undefined;
  note?: string | undefined;
}

function append(record: TrackingRecord, events: readonly TrackingEvent[], ctx: OpContext): OpResult {
  const next: TrackingRecord = { ...record, events: [...record.events, ...events] };
  const f = fold(next);
  const e = structuralError(f) ?? availableError(f, ctx.live, next.unit);
  return e ? fail(e) : { record: next, error: null, added: events };
}

const base = (ctx: OpContext, at: string, note: string, by: "user" | "system" = "user") => ({ id: ctx.newId(), at, recordedAt: ctx.now, by, note });

const statusEvent = (ctx: OpContext, to: Status, from: Status, note: string, by: "user" | "system", at: string = ctx.now): StatusEvent => ({ ...base(ctx, at, note, by), kind: "status", status: to, from });

function common(d: Draft, ctx: OpContext): { at: string; note: string; error: string | null } {
  if (tooLong(d.note, MAX_NOTE)) return { at: ctx.now, note: "", error: `Note is too long (at most ${MAX_NOTE} characters)` };
  const t = parseAt(d.at, ctx.now);
  return { at: t.at, note: text(d.note, MAX_NOTE), error: t.error };
}

// ── start ────────────────────────────────────────────────────────────────────

export interface StartInput {
  readonly componentId: string;
  readonly plan: PlanSnapshot;
  readonly note?: string;
  readonly at?: string;
}

/** Start tracking a component: one record per component, planned for recovery, with the plan as it stands now. */
export function start(input: StartInput, ctx: OpContext): OpResult {
  const live = ctx.live;
  if (!live.present || live.unit === null) return fail("That is not a component of the model (assemblies are tracked through their parts)");
  const c = common(input, ctx);
  if (c.error) return fail(c.error);
  const track: TrackingEvent = { ...base(ctx, c.at, c.note), kind: "track", plan: input.plan };
  const created: AllocationEvent[] = live.allocations.map((a) => allocationEvent(ctx, "created", a, null, "existing when tracking started"));
  const record: TrackingRecord = {
    componentId: input.componentId,
    unit: live.unit,
    availableAtStart: live.available,
    events: [track, ...created],
    seen: Object.fromEntries(live.allocations.map((a) => [a.id, { requirementId: a.requirementId, requirementName: a.requirementName, quantity: a.quantity }])),
    createdAt: ctx.now,
  };
  return { record, error: null, added: record.events };
}

function allocationEvent(ctx: OpContext, change: AllocationEvent["change"], a: Pick<ActiveAllocation, "id" | "requirementId" | "requirementName" | "quantity">, previous: number | null, note: string): AllocationEvent {
  return { ...base(ctx, ctx.now, note, "system"), kind: "allocation", change, allocationId: a.id, requirementId: a.requirementId, requirementName: a.requirementName, quantity: a.quantity, previous };
}

// ── the operations ───────────────────────────────────────────────────────────

export type Op =
  | ({ type: "plan"; quantity: number | null; source: Source; method?: string } & Draft)
  | ({ type: "status"; status: Status } & Draft)
  | ({ type: "recover"; quantity: number; source: Source; method?: string; complete?: boolean } & Draft)
  | ({ type: "outcome"; outcome: Outcome; quantity: number; source: Source; method?: string; destination?: string; allocationId?: string | null } & Draft)
  | ({ type: "unrecovered"; quantity: number; source: Source; method?: string; reason: string } & Draft)
  | ({ type: "variance"; quantity: number; source: Source; method?: string; reason: string } & Draft)
  | ({ type: "note" } & Draft)
  | ({ type: "void"; eventId: string; reason: string } & Draft);

export function apply(record: TrackingRecord, op: Op, ctx: OpContext): OpResult {
  const c = common(op, ctx);
  if (c.error) return fail(c.error);
  const f = fold(record);
  const unit = record.unit;
  const method = "method" in op ? text(op.method, MAX_SHORT) : "";
  if ("method" in op && tooLong(op.method, MAX_SHORT)) return fail(`Method is too long (at most ${MAX_SHORT} characters)`);

  switch (op.type) {
    case "plan": {
      if (op.quantity !== null) {
        const qe = quantityError(unit, op.quantity, { allowZero: true });
        if (qe) return fail(qe);
      }
      const se = checkSource(op.source);
      if (se) return fail(se);
      const before = f.plan.quantity;
      if (before === op.quantity && f.plan.basis === "user") return { record, error: null, added: [] };
      const ev: PlanEvent = { ...base(ctx, c.at, c.note), kind: "plan", quantity: op.quantity, source: op.source, method };
      return append(record, [ev], ctx);
    }
    case "status": {
      if (!(STATUSES as readonly string[]).includes(op.status)) return fail("Unknown stage");
      const e = moveError(f, ctx.live, op.status);
      if (e) return fail(e);
      if (op.status === "hold" && c.note === "") return fail("Say why it is on hold (what the outcome is waiting for)");
      return append(record, [statusEvent(ctx, op.status, f.status, c.note, "user", c.at)], ctx);
    }
    case "recover": {
      const qe = quantityError(unit, op.quantity, { allowZero: true });
      if (qe) return fail(qe);
      const se = checkSource(op.source);
      if (se) return fail(se);
      const events: TrackingEvent[] = [{ ...base(ctx, c.at, c.note), kind: "recovered", quantity: op.quantity, source: op.source, method }];
      const R = (f.recovered ?? 0) + op.quantity;
      // the status follows the recovery: complete -> Recovered; any recovery record (even a recorded zero) starts or resumes the work
      // (a later stage is never moved backwards)
      const open = f.status === "planned" || f.status === "in_progress" || f.status === "hold";
      const target: Status | null = R > EPS && op.complete && open ? "recovered" : f.status === "planned" || f.status === "hold" ? "in_progress" : null;
      if (target) events.push(statusEvent(ctx, target, f.status, "", "system", c.at));
      return append(record, events, ctx);
    }
    case "outcome": {
      if (!(OUTCOMES as readonly string[]).includes(op.outcome)) return fail("Choose reused, recycled or disposed");
      const qe = quantityError(unit, op.quantity);
      if (qe) return fail(qe);
      const se = checkSource(op.source);
      if (se) return fail(se);
      if (f.recovered === null) return fail("Record the recovered quantity first (it may be 0): an outcome is of recovered material");
      const inHand = f.recovered - (f.reused ?? 0) - (f.recycled ?? 0) - (f.disposed ?? 0);
      if (op.quantity > inHand + EPS) return fail(`Only ${fmt(Math.max(0, inHand), unit)} of the recovered material is still in hand`);
      if (tooLong(op.destination, MAX_SHORT)) return fail(`Destination is too long (at most ${MAX_SHORT} characters)`);
      let allocationId: string | null = null;
      let requirementId: string | null = null;
      let requirementName: string | null = null;
      let allocation: ActiveAllocation | undefined;
      if (op.allocationId) {
        if (op.outcome !== "reused") return fail("Only a reused outcome can fulfil a C2 allocation");
        allocation = ctx.live.allocations.find((a) => a.id === op.allocationId);
        if (!allocation) return fail("That C2 allocation does not exist (it may have been cancelled)");
        const done = f.fulfilled.get(allocation.id) ?? 0;
        if (done + op.quantity > allocation.quantity + EPS) return fail(`That allocation to "${allocation.requirementName}" needs only ${fmt(Math.max(0, allocation.quantity - done), unit)} more`);
        allocationId = allocation.id;
        requirementId = allocation.requirementId;
        requirementName = allocation.requirementName;
      }
      const ev: TrackingEvent = { ...base(ctx, c.at, c.note), kind: "outcome", outcome: op.outcome, quantity: op.quantity, source: op.source, method, destination: text(op.destination, MAX_SHORT), allocationId, requirementId, requirementName };
      const events: TrackingEvent[] = [ev];
      // when everything recovered now has an outcome, the record closes with the outcome that holds most of it (ties: this one)
      const U = (f.reused ?? 0) + (op.outcome === "reused" ? op.quantity : 0);
      const Cy = (f.recycled ?? 0) + (op.outcome === "recycled" ? op.quantity : 0);
      const X = (f.disposed ?? 0) + (op.outcome === "disposed" ? op.quantity : 0);
      if (inHand - op.quantity <= EPS) {
        const top = Math.max(U, Cy, X);
        const mine = op.outcome === "reused" ? U : op.outcome === "recycled" ? Cy : X;
        const closing: Status = mine >= top - EPS ? (op.outcome as Status) : U >= Cy && U >= X ? "reused" : Cy >= X ? "recycled" : "disposed";
        if (closing !== f.status) events.push(statusEvent(ctx, closing, f.status, "", "system", c.at));
      }
      if (allocation && (f.fulfilled.get(allocation.id) ?? 0) + op.quantity >= allocation.quantity - EPS) events.push(allocationEvent(ctx, "fulfilled", allocation, null, ""));
      return append(record, events, ctx);
    }
    case "unrecovered": {
      const qe = quantityError(unit, op.quantity);
      if (qe) return fail(qe);
      const se = checkSource(op.source);
      if (se) return fail(se);
      const reason = text(op.reason, MAX_SHORT);
      if (reason === "") return fail("Say why it was not recovered (lost, destroyed, sent to waste …)");
      if (tooLong(op.reason, MAX_SHORT)) return fail(`Reason is too long (at most ${MAX_SHORT} characters)`);
      if (f.recovered === null) return fail("Record the recovered quantity first (it may be 0): a write-off is of material that was not recovered");
      return append(record, [{ ...base(ctx, c.at, c.note), kind: "unrecovered", quantity: op.quantity, source: op.source, method, reason }], ctx);
    }
    case "variance": {
      const qe = quantityError(unit, op.quantity, { signed: true });
      if (qe) return fail(qe);
      const se = checkSource(op.source);
      if (se) return fail(se);
      const reason = text(op.reason, MAX_SHORT);
      if (reason === "") return fail("A documented variance needs its reason (why the real quantity differs from B1's modelled one)");
      if (tooLong(op.reason, MAX_SHORT)) return fail(`Reason is too long (at most ${MAX_SHORT} characters)`);
      return append(record, [{ ...base(ctx, c.at, c.note), kind: "variance", quantity: op.quantity, source: op.source, method, reason }], ctx);
    }
    case "note": {
      if (c.note === "") return fail("Write the note");
      return append(record, [{ ...base(ctx, c.at, c.note), kind: "note" }], ctx);
    }
    case "void": {
      const target = record.events.find((e) => e.id === op.eventId);
      if (!target) return fail("That event does not exist");
      if (target.kind === "void") return fail("A void cannot be voided");
      if (target.kind === "track") return fail("The start of tracking cannot be voided");
      if (target.by === "system") return fail("Events recorded by the system (status changes it made, C2 allocation changes) are history and cannot be voided");
      if (f.voided.has(target.id)) return fail("That event is already voided");
      const reason = text(op.reason, MAX_SHORT);
      if (reason === "") return fail("Say why it is voided");
      if (tooLong(op.reason, MAX_SHORT)) return fail(`Reason is too long (at most ${MAX_SHORT} characters)`);
      const v: TrackingEvent = { ...base(ctx, ctx.now, c.note), kind: "void", voids: target.id, reason };
      let events: TrackingEvent[] = [v];
      let next: TrackingRecord = { ...record, events: [...record.events, v] };
      const f2 = fold(next);
      // a status that the remaining history no longer supports is reverted by a logged system event, never silently
      if (structuralError(f2) !== null && structuralError({ ...f2, status: statusFallback(f2) }) === null) {
        const back = statusFallback(f2);
        const s = statusEvent(ctx, back, f2.status, "reverted: an event it rested on was voided", "system");
        events = [v, s];
        next = { ...record, events: [...record.events, v, s] };
      }
      const f3 = fold(next);
      const e = structuralError(f3) ?? availableError(f3, ctx.live, next.unit);
      if (e) return fail(`This cannot be voided: ${e.charAt(0).toLowerCase()}${e.slice(1)}. Void the events that depend on it first`);
      return { record: next, error: null, added: events };
    }
  }
}

/** The stage a record falls back to when the history under its status is voided. */
function statusFallback(f: Fold): Status {
  const R = f.recovered;
  if (R !== null && R > EPS) {
    const inHand = R - (f.reused ?? 0) - (f.recycled ?? 0) - (f.disposed ?? 0);
    if (inHand <= EPS) return (f.reused ?? 0) >= (f.recycled ?? 0) && (f.reused ?? 0) >= (f.disposed ?? 0) && (f.reused ?? 0) > EPS ? "reused" : (f.recycled ?? 0) >= (f.disposed ?? 0) && (f.recycled ?? 0) > EPS ? "recycled" : (f.disposed ?? 0) > EPS ? "disposed" : "recovered";
    return "recovered";
  }
  return f.recovered !== null ? "in_progress" : "planned";
}

// ── keeping up with C2 ───────────────────────────────────────────────────────

/**
 * Compare the record's C2 allocations with those it last saw and LOG what changed (created, changed, cancelled), never silently
 * adopting it. A record stays "Allocated for reuse" only while an allocation exists: when the last one is cancelled the stage is
 * reverted by a logged system event (the outcomes already recorded stay). Returns the same object when nothing changed.
 */
export function syncAllocations(record: TrackingRecord, ctx: OpContext): OpResult {
  const now = ctx.live.allocations;
  const seen = record.seen;
  const events: TrackingEvent[] = [];
  const nextSeen: Record<string, TrackingRecord["seen"][string]> = {};
  for (const a of now) {
    nextSeen[a.id] = { requirementId: a.requirementId, requirementName: a.requirementName, quantity: a.quantity };
    const was = seen[a.id];
    if (!was) events.push(allocationEvent(ctx, "created", a, null, ""));
    else if (Math.abs(was.quantity - a.quantity) > EPS) events.push(allocationEvent(ctx, "changed", a, was.quantity, ""));
  }
  const ids = new Set(now.map((a) => a.id));
  for (const [id, was] of Object.entries(seen)) if (!ids.has(id)) events.push(allocationEvent(ctx, "cancelled", { id, requirementId: was.requirementId, requirementName: was.requirementName, quantity: was.quantity }, null, "no longer in C2"));
  if (events.length === 0) return { record, error: null, added: [] };
  let next: TrackingRecord = { ...record, events: [...record.events, ...events], seen: nextSeen };
  const f = fold(next);
  if (f.status === "allocated" && now.length === 0) {
    const back = f.active.some((e) => e.kind === "status" && e.status === "inspected") ? "inspected" : "recovered";
    const s = statusEvent(ctx, back, "allocated", "the C2 allocation was cancelled", "system");
    events.push(s);
    next = { ...next, events: [...next.events, s] };
  }
  return { record: next, error: null, added: events };
}
