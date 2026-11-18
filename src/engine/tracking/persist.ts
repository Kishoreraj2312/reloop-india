/**
 * (De)serialisation of tracking records and batches (C3). Pure: the storage glue lives in the scene layer. A history is only trusted if it
 * replays to a possible state: a record with a malformed event, a duplicate event id, a void of an event that does not exist, or a history
 * that breaks the accounting (outcomes above the recovered quantity, a status its quantities do not support) is DROPPED AND COUNTED, never
 * repaired. Records of components that are not in the current model are KEPT (the model may be regenerated) and flagged by the report.
 */

import { fold } from "./summary";
import { structuralError } from "./ops";
import { MAX_NOTE, MAX_SHORT, OUTCOMES, SOURCES, STATUSES, type Batch, type Outcome, type PlanSnapshot, type Records, type SeenAllocation, type Source, type TrackingEvent, type TrackingRecord } from "./types";
import type { Unit } from "@/engine/quantities";

export const PERSIST_VERSION = 1;
const UNITS: readonly Unit[] = ["m3", "m2", "m", "nr", "kg"];

export interface PersistedTracking {
  readonly records: Records;
  readonly batches: readonly Batch[];
}
export const EMPTY_TRACKING: PersistedTracking = Object.freeze({ records: Object.freeze({}), batches: Object.freeze([]) });

export const serializeTracking = (s: PersistedTracking): string =>
  JSON.stringify({ version: PERSIST_VERSION, records: Object.keys(s.records).sort().map((id) => s.records[id]), batches: s.batches });

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const iso = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null);

function cleanPlan(raw: unknown): PlanSnapshot | null {
  const p = obj(raw);
  if (!p) return null;
  const quantity = p.quantity === null ? null : num(p.quantity);
  if (p.quantity !== null && quantity === null) return null;
  const basis = oneOf(["b2_estimate", "none"] as const, p.basis);
  if (!basis || (quantity === null) !== (basis === "none")) return null;
  const pct = p.pct === null || p.pct === undefined ? null : num(p.pct);
  const cls = p.classification === null || p.classification === undefined ? null : str(p.classification, 40);
  const expected = p.expected === null || p.expected === undefined ? null : oneOf(["reuse", "recycling"] as const, p.expected);
  if (p.expected !== null && p.expected !== undefined && !expected) return null;
  return { quantity, basis, classification: cls as PlanSnapshot["classification"], pct, expected };
}

function cleanEvent(raw: unknown): TrackingEvent | null {
  const e = obj(raw);
  if (!e) return null;
  const id = str(e.id, 80);
  const at = iso(e.at);
  const recordedAt = iso(e.recordedAt);
  const by = oneOf(["user", "system"] as const, e.by);
  const note = str(e.note, MAX_NOTE);
  if (!id || !at || !recordedAt || !by || note === null) return null;
  const b = { id, at, recordedAt, by, note };
  const method = (): string | null => str(e.method, MAX_SHORT);
  const source = (): Source | null => oneOf(SOURCES, e.source);
  switch (e.kind) {
    case "track": {
      const plan = cleanPlan(e.plan);
      return plan ? { ...b, kind: "track", plan } : null;
    }
    case "plan": {
      const q = e.quantity === null ? null : num(e.quantity);
      const s = source();
      const m = method();
      return (e.quantity === null || (q !== null && q >= 0)) && s && m !== null ? { ...b, kind: "plan", quantity: q, source: s, method: m } : null;
    }
    case "status": {
      const status = oneOf(STATUSES, e.status);
      const from = e.from === null ? null : oneOf(STATUSES, e.from);
      return status && (e.from === null || from) ? { ...b, kind: "status", status, from } : null;
    }
    case "recovered": {
      const q = num(e.quantity);
      const s = source();
      const m = method();
      return q !== null && q >= 0 && s && m !== null ? { ...b, kind: "recovered", quantity: q, source: s, method: m } : null;
    }
    case "outcome": {
      const outcome = oneOf(OUTCOMES, e.outcome) as Outcome | null;
      const q = num(e.quantity);
      const s = source();
      const m = method();
      const dest = str(e.destination, MAX_SHORT);
      const allocationId = e.allocationId === null ? null : str(e.allocationId, 80);
      const requirementId = e.requirementId === null ? null : str(e.requirementId, 80);
      const requirementName = e.requirementName === null ? null : str(e.requirementName, 200);
      if (!outcome || q === null || q <= 0 || !s || m === null || dest === null || (e.allocationId !== null && allocationId === null)) return null;
      return { ...b, kind: "outcome", outcome, quantity: q, source: s, method: m, destination: dest, allocationId, requirementId, requirementName };
    }
    case "unrecovered": {
      const q = num(e.quantity);
      const s = source();
      const m = method();
      const reason = str(e.reason, MAX_SHORT);
      return q !== null && q > 0 && s && m !== null && reason ? { ...b, kind: "unrecovered", quantity: q, source: s, method: m, reason } : null;
    }
    case "variance": {
      const q = num(e.quantity);
      const s = source();
      const m = method();
      const reason = str(e.reason, MAX_SHORT);
      return q !== null && q !== 0 && s && m !== null && reason ? { ...b, kind: "variance", quantity: q, source: s, method: m, reason } : null;
    }
    case "note":
      return { ...b, kind: "note" };
    case "allocation": {
      const change = oneOf(["created", "changed", "cancelled", "fulfilled"] as const, e.change);
      const allocationId = str(e.allocationId, 80);
      const requirementId = str(e.requirementId, 80);
      const requirementName = str(e.requirementName, 200);
      const q = num(e.quantity);
      const previous = e.previous === null ? null : num(e.previous);
      return change && allocationId && requirementId && requirementName !== null && q !== null && (e.previous === null || previous !== null) ? { ...b, kind: "allocation", change, allocationId, requirementId, requirementName, quantity: q, previous } : null;
    }
    case "void": {
      const voids = str(e.voids, 80);
      const reason = str(e.reason, MAX_SHORT);
      return voids && reason ? { ...b, kind: "void", voids, reason } : null;
    }
    default:
      return null;
  }
}

function cleanRecord(raw: unknown): TrackingRecord | null {
  const r = obj(raw);
  if (!r) return null;
  const componentId = str(r.componentId, 200);
  const unit = oneOf(UNITS, r.unit);
  const createdAt = iso(r.createdAt);
  const available = r.availableAtStart === null ? null : num(r.availableAtStart);
  if (!componentId || !unit || !createdAt || (r.availableAtStart !== null && available === null) || !Array.isArray(r.events) || r.events.length === 0) return null;
  const events: TrackingEvent[] = [];
  const ids = new Set<string>();
  for (const x of r.events) {
    const e = cleanEvent(x);
    if (!e || ids.has(e.id)) return null;
    ids.add(e.id);
    events.push(e);
  }
  if (events[0]!.kind !== "track" || events.slice(1).some((e) => e.kind === "track")) return null;
  for (const e of events) if (e.kind === "void" && !ids.has(e.voids)) return null;
  const seenRaw = obj(r.seen) ?? {};
  const seen: Record<string, SeenAllocation> = {};
  for (const [k, v] of Object.entries(seenRaw)) {
    const o = obj(v);
    const q = o ? num(o.quantity) : null;
    const rid = o ? str(o.requirementId, 80) : null;
    const rn = o ? str(o.requirementName, 200) : null;
    if (!o || q === null || !rid || rn === null) return null;
    seen[k] = { requirementId: rid, requirementName: rn, quantity: q };
  }
  const record: TrackingRecord = { componentId, unit, availableAtStart: available, events, seen, createdAt };
  return structuralError(fold(record)) === null ? record : null;
}

function cleanBatch(raw: unknown): Batch | null {
  const b = obj(raw);
  if (!b) return null;
  const id = str(b.id, 80);
  const name = str(b.name, 80);
  const createdAt = iso(b.createdAt);
  if (!id || !name || name.trim() === "" || !createdAt || !Array.isArray(b.componentIds)) return null;
  const ids = [...new Set(b.componentIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200))];
  return { id, name, componentIds: ids, createdAt };
}

export interface ParsedTracking extends PersistedTracking {
  readonly dropped: { readonly records: number; readonly batches: number };
}

export function parseTracking(text: string | null): ParsedTracking {
  const empty: ParsedTracking = { ...EMPTY_TRACKING, dropped: { records: 0, batches: 0 } };
  if (!text) return empty;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return empty;
  }
  const d = obj(data);
  if (!d || d.version !== PERSIST_VERSION) return empty;
  const records: Record<string, TrackingRecord> = {};
  let droppedRecords = 0;
  for (const raw of Array.isArray(d.records) ? d.records : []) {
    const r = cleanRecord(raw);
    if (!r || records[r.componentId]) droppedRecords++;
    else records[r.componentId] = r;
  }
  const batches: Batch[] = [];
  let droppedBatches = 0;
  const seen = new Set<string>();
  for (const raw of Array.isArray(d.batches) ? d.batches : []) {
    const b = cleanBatch(raw);
    if (!b || seen.has(b.id)) droppedBatches++;
    else (batches.push(b), seen.add(b.id));
  }
  return { records, batches, dropped: { records: droppedRecords, batches: droppedBatches } };
}

