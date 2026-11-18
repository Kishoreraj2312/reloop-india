/**
 * Removal planning + simulation store (B3). A tiny external store (no library), like the B2 recovery store: the
 * drawer, the inspector line and the 3D overlay all subscribe, so none of them needs App state and opening the
 * drawer never re-renders the scene tree.
 *
 * Plans are the user's planning data, kept apart from the model records, B1 quantities and B2 assessments, and
 * saved to localStorage (sparse: only what the user created; the simulation cursor is not saved).
 * The simulation overlay is active only while the drawer is open and "Show in 3D" is on: closing the drawer
 * restores the normal model.
 */

import { useSyncExternalStore } from "react";
import {
  addEntries as opAddEntries,
  addUserEdge as opAddUserEdge,
  analysePlan,
  clearPlan,
  createPlan,
  duplicatePlan,
  getModelGraph,
  goToStep,
  insertPrerequisites as opInsertPrerequisites,
  moveEntry as opMoveEntry,
  parsePlans,
  removeEntry as opRemoveEntry,
  removeUserEdge as opRemoveUserEdge,
  removedIds,
  renamePlan,
  reorder,
  resetSimulation,
  serializePlans,
  setNote as opSetNote,
  stepBack,
  stepForward,
  suggestOrder,
  updateUserEdge as opUpdateUserEdge,
  withCursor,
  type AddResult,
  type PlanAnalysis,
  type RemovalPlan,
  type UserEdge,
  type UserEdgeInput,
} from "@/engine/removal";

export const STORAGE_KEY = "rematter.removal.plans.v1";

export interface RemovalStoreState {
  readonly plans: readonly RemovalPlan[];
  readonly activeId: string | null;
  /** The drawer is open. The 3D simulation is shown only while it is. */
  readonly open: boolean;
  /** "Show in 3D": draw the plan (and hide simulated-removed components) in the model. */
  readonly overlay: boolean;
  /** Bumped on every change (cheap memo key). */
  readonly version: number;
}

function load(): { plans: readonly RemovalPlan[]; activeId: string | null } {
  try {
    const r = parsePlans(window.localStorage.getItem(STORAGE_KEY));
    return { plans: r.plans, activeId: r.activeId };
  } catch {
    return { plans: [], activeId: null }; // storage blocked or unavailable: start empty
  }
}

function save(plans: readonly RemovalPlan[], activeId: string | null): void {
  try {
    if (plans.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, serializePlans({ plans, activeId }));
  } catch {
    /* quota or blocked: the session still works, it just will not persist */
  }
}

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

const init = load();
let state: RemovalStoreState = { plans: init.plans, activeId: init.activeId, open: false, overlay: true, version: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function set(patch: Partial<RemovalStoreState>, persist: boolean) {
  state = { ...state, ...patch, version: state.version + 1 };
  if (persist) save(state.plans, state.activeId);
  emit();
}

const active = (): RemovalPlan | undefined => state.plans.find((p) => p.id === state.activeId);

/** Replace the active plan. `persist` is false for cursor-only changes. */
function replaceActive(next: RemovalPlan, persist = true) {
  const cur = active();
  if (!cur || next === cur) return;
  set({ plans: state.plans.map((p) => (p.id === cur.id ? next : p)) }, persist);
}

// ── derived data (memoised by plan identity) ─────────────────────────────────

const analysisCache = new WeakMap<RemovalPlan, PlanAnalysis>();
// Validation depends on the sequence and the user dependencies only (not on notes or the cursor), so it is cached per
// `entries` array; moving the simulation cursor only recomputes each step's state (withCursor).
const structureCache = new WeakMap<readonly string[], { userEdges: readonly UserEdge[]; base: PlanAnalysis }>();
export function analysisOf(plan: RemovalPlan): PlanAnalysis {
  let a = analysisCache.get(plan);
  if (!a) {
    let s = structureCache.get(plan.entries);
    if (!s || s.userEdges !== plan.userEdges) {
      s = { userEdges: plan.userEdges, base: analysePlan(getModelGraph(), { ...plan, cursor: 0 }) };
      structureCache.set(plan.entries, s);
    }
    analysisCache.set(plan, (a = withCursor(s.base, plan.cursor)));
  }
  return a;
}

let removedKey: { plan: RemovalPlan; cursor: number; set: ReadonlySet<string> } | null = null;
/** Record ids simulated as removed in the active plan (empty when none). */
export function removedSet(plan: RemovalPlan | undefined): ReadonlySet<string> {
  if (!plan || plan.cursor === 0) return EMPTY;
  if (removedKey && removedKey.plan === plan && removedKey.cursor === plan.cursor) return removedKey.set;
  const s = removedIds(analysisOf(plan), plan.cursor);
  removedKey = { plan, cursor: plan.cursor, set: s };
  return s;
}
const EMPTY: ReadonlySet<string> = new Set();

export const removalStore = {
  get: (): RemovalStoreState => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  activePlan: active,
  analysis(): PlanAnalysis | null {
    const p = active();
    return p ? analysisOf(p) : null;
  },
  /** Whether the 3D simulation overlay is currently applied. */
  isActive: (): boolean => state.open && state.overlay && active() !== undefined,

  setOpen: (open: boolean) => set({ open }, false),
  setOverlay: (overlay: boolean) => set({ overlay }, false),

  // plans
  createPlan(name?: string): string {
    const id = newId("plan");
    const p = createPlan(id, name ?? `Removal plan ${state.plans.length + 1}`);
    set({ plans: [...state.plans, p], activeId: id }, true);
    return id;
  },
  selectPlan(id: string) {
    if (state.plans.some((p) => p.id === id) && id !== state.activeId) set({ activeId: id }, true);
  },
  rename(name: string) {
    const p = active();
    if (p) replaceActive(renamePlan(p, name));
  },
  duplicate(): string | null {
    const p = active();
    if (!p) return null;
    const id = newId("plan");
    set({ plans: [...state.plans, duplicatePlan(p, id)], activeId: id }, true);
    return id;
  },
  /** Empty the active plan (entries, notes, user dependencies) and restart the simulation. */
  reset() {
    const p = active();
    if (p) replaceActive(clearPlan(p));
  },
  delete(id?: string) {
    const target = id ?? state.activeId;
    if (!target) return;
    const plans = state.plans.filter((p) => p.id !== target);
    set({ plans, activeId: state.activeId === target ? (plans[0]?.id ?? null) : state.activeId }, true);
  },

  // entries
  /** Add components to the active plan, creating a plan if there is none. */
  addEntries(ids: readonly string[], at?: number): AddResult {
    const graph = getModelGraph();
    let p = active();
    if (!p) {
      removalStore.createPlan();
      p = active()!;
    }
    const r = opAddEntries(p, graph, ids, at);
    replaceActive(r.plan);
    return r;
  },
  removeEntry(index: number) {
    const p = active();
    if (p) replaceActive(opRemoveEntry(p, index));
  },
  moveEntry(from: number, to: number) {
    const p = active();
    if (p) replaceActive(opMoveEntry(p, from, to));
  },
  setNote(id: string, text: string) {
    const p = active();
    if (p) replaceActive(opSetNote(p, id, text));
  },
  /** Insert the blocking prerequisites of an entry just before it (explicit user action). */
  insertPrerequisites(entryId: string) {
    const p = active();
    if (!p) return { added: [] as readonly string[], truncated: false };
    const r = opInsertPrerequisites(p, getModelGraph(), entryId);
    replaceActive(r.plan);
    return { added: r.added, truncated: r.truncated };
  },
  /** Apply the deterministic valid order (explicit user action). Returns whether anything changed. */
  applySuggestedOrder(): boolean {
    const p = active();
    if (!p) return false;
    const next = reorder(p, suggestOrder(analysisOf(p)).order);
    replaceActive(next);
    return next !== p;
  },
  suggestedOrder() {
    const p = active();
    return p ? suggestOrder(analysisOf(p)) : null;
  },

  // user dependencies
  addUserEdge(input: UserEdgeInput): string | null {
    const p = active();
    if (!p) return "No active plan.";
    const r = opAddUserEdge(p, getModelGraph(), input, newId("dep"));
    if (!r.error) replaceActive(r.plan);
    return r.error;
  },
  updateUserEdge(id: string, input: UserEdgeInput): string | null {
    const p = active();
    if (!p) return "No active plan.";
    const r = opUpdateUserEdge(p, getModelGraph(), id, input);
    if (!r.error) replaceActive(r.plan);
    return r.error;
  },
  removeUserEdge(id: string) {
    const p = active();
    if (p) replaceActive(opRemoveUserEdge(p, id));
  },

  // simulation (cursor changes are not persisted)
  next() {
    const p = active();
    if (p) replaceActive(stepForward(p, analysisOf(p)), false);
  },
  prev() {
    const p = active();
    if (p) replaceActive(stepBack(p), false);
  },
  goTo(step: number) {
    const p = active();
    if (p) replaceActive(goToStep(p, analysisOf(p), step), false);
  },
  resetSimulation() {
    const p = active();
    if (p) replaceActive(resetSimulation(p), false);
  },
};

export function useRemoval(): RemovalStoreState {
  return useSyncExternalStore(removalStore.subscribe, removalStore.get);
}

declare global {
  interface Window {
    /** Dev only: lets the browser verification script drive and inspect the removal store. */
    __removal?: typeof removalStore & { graph: () => ReturnType<typeof getModelGraph>; removed: () => ReadonlySet<string> };
  }
}
if (import.meta.env?.DEV && typeof window !== "undefined") {
  window.__removal = Object.assign(removalStore, { graph: getModelGraph, removed: () => removedSet(active()) });
}
