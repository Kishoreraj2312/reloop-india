/**
 * Recovery tracking store (C3). A tiny external store like the B2 – C2 stores. It holds the USER's tracking records (an append-only history
 * per component) and batches, saved to localStorage (sparse: only components the user started tracking), and the workspace's view state.
 * B1 quantities, B2 assessments, B3 plans, C1 passports and C2 requirements / allocations are only READ; status, quantities, completion,
 * discrepancies and reports are never stored: they are derived from the histories by the tracking engine.
 *
 * The one thing that follows another module is C2: when a component's allocation is created, changed or cancelled the store appends a
 * logged system event to that record's history (never silently adopting the change). Exclusivity with the other drawers works as in C2:
 * opening the workspace closes them, and opening any of them closes it (the store watches them).
 */

import { useSyncExternalStore } from "react";
import { getModelInventory, leafDescendants, type Inventory } from "@/engine/quantities";
import {
  apply,
  createBatch,
  deleteBatch,
  EMPTY_PLAN,
  liveFn,
  parseTracking,
  planNow,
  renameBatch,
  serializeTracking,
  snapshotOf,
  start,
  syncAllocations,
  type Batch,
  type LiveView,
  type Op,
  type OpContext,
  type Records,
  type RemovalView,
  type Status,
  type TrackingContext,
  type TrackingRecord,
} from "@/engine/tracking";
import { carbonStore } from "../carbon/carbonStore";
import { inventoryUi } from "../inventory/inventoryStore";
import { recoveryStore } from "../recovery/recoveryStore";
import { analysisOf, removalStore } from "../removal/removalStore";
import { reuseStore } from "../reuse/reuseStore";
import { scenarioStore } from "../scenarios/scenarioStore";

export const STORAGE_KEY = "rematter.tracking.v1";
export type Tab = "register" | "report";
/** What the 3D model marks: the register's components coloured by stage, only those with a flag, or nothing. */
export type Show3d = "status" | "flags" | "off";
export type Scope = "tracked" | "planned" | "untracked" | "all";

export interface Filters {
  readonly scope: Scope;
  /** A stage, or "not_tracked". */
  readonly status: Status | "not_tracked" | "";
  readonly substance: string;
  readonly floor: number | "";
  readonly batchId: string;
  /** Only records with a warning or an error flag. */
  readonly flaggedOnly: boolean;
  readonly text: string;
  readonly sort: "id" | "attention" | "stage";
}
export const NO_FILTERS: Filters = { scope: "tracked", status: "", substance: "", floor: "", batchId: "", flaggedOnly: false, text: "", sort: "id" };

export interface TrackingState {
  readonly records: Records;
  readonly batches: readonly Batch[];
  readonly open: boolean;
  readonly collapsed: boolean;
  readonly tab: Tab;
  readonly filters: Filters;
  readonly show3d: Show3d;
  /** The progress overview is shown in full (otherwise as one line). */
  readonly overview: boolean;
  /** The unit the overview and report show (units are never added together). */
  readonly unit: "m2" | "m3" | "m" | "nr" | null;
  readonly version: number;
}

function load() {
  try {
    const r = parseTracking(window.localStorage.getItem(STORAGE_KEY));
    return { records: r.records, batches: r.batches };
  } catch {
    return { records: {} as Records, batches: [] as readonly Batch[] }; // storage blocked: start empty
  }
}
function save(s: TrackingState): void {
  try {
    if (Object.keys(s.records).length === 0 && s.batches.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, serializeTracking({ records: s.records, batches: s.batches }));
  } catch {
    /* quota or blocked: the session still works, it just will not persist */
  }
}

let counter = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}${(counter++).toString(36)}`;
const nowIso = () => new Date().toISOString();

const init = load();
let state: TrackingState = { ...init, open: false, collapsed: false, tab: "register", filters: NO_FILTERS, show3d: "status", overview: true, unit: null, version: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(patch: Partial<TrackingState>, persist: boolean) {
  state = { ...state, ...patch, version: state.version + 1 };
  if (persist) save(state);
  emit();
}

// ── what the other modules say now ───────────────────────────────────────────

const removalCache = new WeakMap<object, ReadonlyMap<string, RemovalView>>();
/** Leaf component id -> its place in the active B3 plan (an assembly entry stands for its parts). Memoised per plan object. */
function removalView(inv: Inventory): ReadonlyMap<string, RemovalView> {
  const plan = removalStore.activePlan();
  if (!plan) return new Map();
  const hit = removalCache.get(plan);
  if (hit) return hit;
  const a = analysisOf(plan);
  const m = new Map<string, RemovalView>();
  for (const e of a.entries) {
    if (!e.exists) continue;
    for (const id of e.coverage) {
      const rec = inv.recordById.get(id);
      if (rec && rec.geometry.kind !== "group" && !m.has(id)) m.set(id, { planName: plan.name, step: e.index + 1, steps: a.entries.length });
    }
  }
  removalCache.set(plan, m);
  return m;
}

/** The live inputs of the tracking engine, from the stores. */
export function trackingContext(): TrackingContext {
  const inv = getModelInventory();
  const rs = reuseStore.get();
  return {
    inv,
    assessments: recoveryStore.get().assessments,
    allocations: rs.allocations,
    requirementNames: new Map(rs.requirements.map((r) => [r.id, r.name])),
    removal: removalView(inv),
  };
}

/** The part of a live view that syncing with C2 needs: no inventory, so the store can sync before the model is built. */
function allocationsLive(id: string): LiveView {
  const rs = reuseStore.get();
  const names = new Map(rs.requirements.map((r) => [r.id, r.name]));
  return {
    present: true,
    available: null,
    unit: null,
    plan: EMPTY_PLAN,
    allocations: rs.allocations.filter((a) => a.componentId === id).map((a) => ({ id: a.id, requirementId: a.requirementId, requirementName: names.get(a.requirementId) ?? a.requirementId, quantity: a.quantity })),
    removal: null,
  };
}

const opCtx = (live: LiveView): OpContext => ({ now: nowIso(), newId: () => uid("ev"), live });

/** Append the C2 allocation changes of every tracked component to its history (idempotent). Returns how many records changed. */
function syncAll(): number {
  let changed = 0;
  let records = state.records;
  for (const id of Object.keys(records)) {
    const r = syncAllocations(records[id]!, opCtx(allocationsLive(id)));
    if (r.record && r.record !== records[id]) {
      records = { ...records, [id]: r.record };
      changed++;
    }
  }
  if (changed > 0) set({ records }, true);
  return changed;
}

export interface StartResult {
  readonly started: number;
  readonly alreadyTracked: number;
  readonly ignored: number;
  readonly error: string | null;
}

export const trackingStore = {
  get: (): TrackingState => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  record: (id: string): TrackingRecord | undefined => state.records[id],

  // ── workspace ──
  setOpen(open: boolean) {
    if (open === state.open) return;
    if (open) {
      inventoryUi.set(false);
      recoveryStore.setOpen(false);
      removalStore.setOpen(false);
      carbonStore.setOpen(false);
      scenarioStore.setOpen(false);
      reuseStore.setOpen(false);
      scenarioStore.setExternalOpen(true); // the B4 tint highlight is drawn while an external workspace is open
      set({ open: true, collapsed: false }, false);
      syncAll();
    } else {
      // closed first: the stores below notify their listeners (including ours), which must see this workspace as closed already
      set({ open: false, collapsed: false }, false);
      if (scenarioStore.get().highlight?.owner === "tracking") scenarioStore.setHighlight(null);
      scenarioStore.setExternalOpen(carbonStore.get().open || reuseStore.get().open);
    }
  },
  setCollapsed: (collapsed: boolean) => set({ collapsed }, false),
  setTab: (tab: Tab) => set({ tab }, false),
  setShow3d: (show3d: Show3d) => set({ show3d }, false),
  setUnit: (unit: TrackingState["unit"]) => set({ unit }, false),
  setOverview: (overview: boolean) => set({ overview }, false),
  setFilters(patch: Partial<Filters>) {
    set({ filters: { ...state.filters, ...patch } }, false);
  },
  resetFilters: () => set({ filters: NO_FILTERS }, false),

  // ── records ──
  /**
   * Start tracking components. An assembly stands for its parts (each part gets its own record: the assembly never does), a component
   * that already has a record is skipped (no duplicates), anything that is not a component is ignored.
   */
  start(ids: readonly string[]): StartResult {
    const tc = trackingContext();
    const live = liveFn(tc);
    const targets = new Set<string>();
    let ignored = 0;
    for (const id of ids) {
      const rec = tc.inv.recordById.get(id);
      if (!rec) ignored++;
      else if (rec.geometry.kind === "group") for (const l of leafDescendants(tc.inv, id)) targets.add(l.rec.id);
      else targets.add(id);
    }
    let records = state.records;
    let started = 0;
    let already = 0;
    let firstError: string | null = null;
    for (const id of targets) {
      if (records[id]) {
        already++;
        continue;
      }
      const v = live(id);
      const r = start({ componentId: id, plan: snapshotOf(planNow({ rec: tc.inv.recordById.get(id)!, q: tc.inv.byId.get(id)! }, tc.assessments.get(id))) }, opCtx(v));
      if (r.record) {
        records = { ...records, [id]: r.record };
        started++;
      } else {
        ignored++;
        firstError ??= r.error;
      }
    }
    if (started > 0) set({ records }, true);
    return { started, alreadyTracked: already, ignored, error: started === 0 && already === 0 ? (firstError ?? "Nothing to track") : null };
  },
  /** Apply one operation to a record. Returns the reason it was refused, or null. */
  apply(id: string, op: Op): string | null {
    const cur = state.records[id];
    if (!cur) return "That component is not being tracked";
    const tc = trackingContext();
    const r = apply(cur, op, opCtx(liveFn(tc)(id)));
    if (r.error || !r.record) return r.error ?? "Nothing changed";
    if (r.record !== cur) set({ records: { ...state.records, [id]: r.record } }, true);
    return null;
  },
  /** The same stage change on many records; refused ones are counted (and the first reason returned). */
  bulkStatus(ids: readonly string[], status: Status, note = ""): { changed: number; refused: number; firstError: string | null } {
    const tc = trackingContext();
    const live = liveFn(tc);
    let records = state.records;
    let changed = 0;
    let refused = 0;
    let firstError: string | null = null;
    for (const id of ids) {
      const cur = records[id];
      if (!cur) continue;
      const r = apply(cur, { type: "status", status, note }, opCtx(live(id)));
      if (r.record && r.record !== cur) {
        records = { ...records, [id]: r.record };
        changed++;
      } else if (r.error) {
        refused++;
        firstError ??= r.error;
      }
    }
    if (changed > 0) set({ records }, true);
    return { changed, refused, firstError };
  },
  /** Stop tracking a component: its whole history is deleted (the only way a history is ever removed). */
  discard(ids: readonly string[]): number {
    const records = { ...state.records };
    let n = 0;
    for (const id of ids)
      if (records[id]) {
        delete records[id];
        n++;
      }
    if (n > 0) set({ records }, true);
    return n;
  },
  sync: syncAll,

  // ── batches ──
  createBatch(name: string, ids: Iterable<string>): { id: string | null; error: string | null; ignored: number } {
    const id = uid("bt");
    const r = createBatch(state.batches, getModelInventory(), id, name, ids, nowIso());
    if (r.error || !r.batch) return { id: null, error: r.error, ignored: r.ignored };
    set({ batches: r.batches }, true);
    return { id, error: null, ignored: r.ignored };
  },
  renameBatch(id: string, name: string): string | null {
    const r = renameBatch(state.batches, id, name);
    if (r.error) return r.error;
    if (r.batches !== state.batches) set({ batches: r.batches }, true);
    return null;
  },
  deleteBatch(id: string) {
    const next = deleteBatch(state.batches, id);
    if (next !== state.batches) set({ batches: next, filters: state.filters.batchId === id ? { ...state.filters, batchId: "" } : state.filters }, true);
  },
  /** Delete every record and batch. */
  clearAll() {
    if (scenarioStore.get().highlight?.owner === "tracking") scenarioStore.setHighlight(null);
    set({ records: {}, batches: [], filters: NO_FILTERS }, true);
  },
};

export function useTracking(): TrackingState {
  return useSyncExternalStore(trackingStore.subscribe, trackingStore.get);
}

// ── following the other modules ──────────────────────────────────────────────

/** Another drawer opened: step aside. */
function stepAside() {
  if (!state.open) return;
  if (inventoryUi.get() || recoveryStore.get().open || removalStore.get().open || scenarioStore.get().open || carbonStore.get().open || reuseStore.get().open) trackingStore.setOpen(false);
}
for (const s of [inventoryUi, recoveryStore, removalStore, scenarioStore, carbonStore, reuseStore]) s.subscribe(stepAside);

// a C2 allocation was created, changed or cancelled: log it in the record's history
let lastAllocations = reuseStore.get().allocations;
let lastRequirements = reuseStore.get().requirements;
reuseStore.subscribe(() => {
  const rs = reuseStore.get();
  if (rs.allocations === lastAllocations && rs.requirements === lastRequirements) return;
  lastAllocations = rs.allocations;
  lastRequirements = rs.requirements;
  syncAll();
});
// records saved in an earlier session: allocations changed while the app was closed are logged now
if (typeof window !== "undefined" && Object.keys(state.records).length > 0) syncAll();

declare global {
  interface Window {
    /** Dev only: lets the browser verification script drive and inspect the tracking store. */
    __tracking?: typeof trackingStore & { context: typeof trackingContext };
  }
}
if (import.meta.env?.DEV && typeof window !== "undefined") window.__tracking = Object.assign(trackingStore, { context: trackingContext });
