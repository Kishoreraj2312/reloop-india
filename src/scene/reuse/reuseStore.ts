/**
 * Reuse workspace store (C2). A tiny external store like the B2 – B5 stores. It holds the USER's requirements, confirmed
 * allocations and matching configuration (saved to localStorage, apart from the records, the B1 quantities, the B2 assessments,
 * the C1 passports, the B3 plans, the B4 scenarios and the B5 factors, which are only read) and the workspace's view state.
 * Matches, scores, free quantities, suggestions and reviews are never stored: they are derived from B1 + B2 + C1 + these inputs
 * (the ranking is memoised per input object, so editing an assessment re-ranks in about a frame).
 *
 * Exclusivity: opening the workspace closes the other drawers, and opening any other drawer closes this one. The store watches
 * the other stores for that, so none of the existing openers needed to know about it.
 */

import { useSyncExternalStore } from "react";
import { getModelInventory } from "@/engine/quantities";
import {
  allocate,
  allocateBatch,
  createRequirement,
  DEFAULT_CONFIG,
  draftOf,
  matchRequirement,
  parseReuse,
  proposeFill,
  removeAllocation,
  removeForRequirement,
  serializeReuse,
  updateRequirement,
  validateConfig,
  type Allocation,
  type CriterionKey,
  type MatchConfig,
  type MatchContext,
  type Requirement,
  type RequirementDraft,
  type Tier,
  allocatedByRequirement,
  EPS,
  fmtQtyU,
} from "@/engine/reuse";
import { passportStore } from "../passport/passportStore";
import { carbonStore } from "../carbon/carbonStore";
import { inventoryUi } from "../inventory/inventoryStore";
import { recoveryStore } from "../recovery/recoveryStore";
import { removalStore } from "../removal/removalStore";
import { scenarioStore } from "../scenarios/scenarioStore";

export const STORAGE_KEY = "rematter.reuse.v1";
export type Tab = "catalogue" | "matches" | "allocation";
/** What the 3D model marks: the active requirement's candidates (strong / conditional) and its allocations, only the allocations, or nothing. */
export type Show3d = "candidates" | "allocated" | "off";
export type TierFilter = Tier | "all";

/** The requirement form: `id` null = a new requirement; `seed` pre-fills it (for example from a component). */
export interface Editing {
  readonly id: string | null;
  readonly seed: RequirementDraft | null;
  /** A new form instance per request, so the form starts afresh even for the same requirement. */
  readonly nonce: number;
}

export interface ReuseState {
  readonly requirements: readonly Requirement[];
  readonly allocations: readonly Allocation[];
  readonly config: MatchConfig;
  readonly activeId: string | null;
  readonly open: boolean;
  /** The workspace is folded into a small card so the whole model is visible; the 3D marks stay on. */
  readonly collapsed: boolean;
  readonly tab: Tab;
  readonly editing: Editing | null;
  readonly tierFilter: TierFilter;
  readonly show3d: Show3d;
  /** The suggested allocation panel is shown for the active requirement. */
  readonly proposing: boolean;
  readonly proposeConditional: boolean;
  /** Bumped on every change (cheap memo key). */
  readonly version: number;
}

function load() {
  try {
    const r = parseReuse(window.localStorage.getItem(STORAGE_KEY));
    return { requirements: r.requirements, allocations: r.allocations, config: r.config, activeId: r.activeId };
  } catch {
    return { requirements: [], allocations: [], config: DEFAULT_CONFIG, activeId: null as string | null }; // storage blocked: start empty
  }
}
function save(s: ReuseState): void {
  try {
    if (s.requirements.length === 0 && s.allocations.length === 0 && s.config === DEFAULT_CONFIG) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, serializeReuse({ requirements: s.requirements, allocations: s.allocations, config: s.config, activeId: s.activeId }));
  } catch {
    /* quota or blocked: the session still works, it just will not persist */
  }
}

let counter = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

const init = load();
let state: ReuseState = { ...init, open: false, collapsed: false, tab: "catalogue", editing: null, tierFilter: "all", show3d: "candidates", proposing: false, proposeConditional: true, version: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(patch: Partial<ReuseState>, persist: boolean) {
  state = { ...state, ...patch, version: state.version + 1 };
  if (persist) save(state);
  emit();
}

const req = (id: string | null | undefined) => state.requirements.find((r) => r.id === id);

/** The live data the matching reads: B1 (memoised), the B2 assessments, the C1 passports and the configuration. */
export function matchContext(config: MatchConfig = state.config): MatchContext {
  return { inv: getModelInventory(), assessments: recoveryStore.get().assessments, meta: passportStore.get().meta, config };
}

const releaseHighlight = () => {
  if (scenarioStore.get().highlight?.owner === "reuse") scenarioStore.setHighlight(null);
};

export const reuseStore = {
  get: (): ReuseState => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  requirement: req,
  active: (): Requirement | undefined => req(state.activeId),

  // ── workspace ──
  setOpen(open: boolean) {
    if (open === state.open) return;
    if (open) {
      inventoryUi.set(false);
      recoveryStore.setOpen(false);
      removalStore.setOpen(false);
      carbonStore.setOpen(false);
      scenarioStore.setOpen(false);
      scenarioStore.setExternalOpen(true); // the B4 tint highlight is drawn while an external workspace is open
      set({ open: true, collapsed: false }, false);
    } else {
      // closed first: the stores below notify their listeners (including ours), which must see this workspace as closed already
      set({ open: false, collapsed: false, editing: null, proposing: false }, false);
      releaseHighlight();
      scenarioStore.setExternalOpen(carbonStore.get().open);
    }
  },
  setCollapsed: (collapsed: boolean) => set({ collapsed }, false),
  setTab: (tab: Tab) => set({ tab, editing: null }, false),
  setTierFilter: (tierFilter: TierFilter) => set({ tierFilter }, false),
  setShow3d: (show3d: Show3d) => set({ show3d }, false),
  setProposing: (proposing: boolean, conditional = state.proposeConditional) => set({ proposing, proposeConditional: conditional }, false),

  // ── requirements ──
  beginNew(seed: RequirementDraft | null = null) {
    set({ editing: { id: null, seed, nonce: counter++ }, tab: state.tab === "allocation" ? "matches" : state.tab }, false);
  },
  beginEdit(id: string) {
    if (req(id)) set({ editing: { id, seed: null, nonce: counter++ } }, false);
  },
  endEdit: () => set({ editing: null }, false),
  /** Create a requirement and make it the active one. Returns its id, or the reason it could not be created. */
  add(draft: RequirementDraft): { id: string | null; error: string | null } {
    const r = createRequirement(uid("rq"), draft, new Date().toISOString());
    if (!r.requirement) return { id: null, error: r.error };
    set({ requirements: [...state.requirements, r.requirement], activeId: r.requirement.id, editing: null, tab: "matches", proposing: false }, true);
    return { id: r.requirement.id, error: null };
  },
  /** Edit a requirement. The unit cannot change while it has allocations, and the quantity cannot drop below what is allocated. */
  edit(id: string, draft: RequirementDraft): string | null {
    const cur = req(id);
    if (!cur) return "That requirement does not exist";
    const mine = state.allocations.filter((a) => a.requirementId === id);
    if (mine.length > 0 && draft.unit !== cur.unit) return `The unit cannot change while ${mine.length} allocation${mine.length === 1 ? " exists" : "s exist"}: remove them first`;
    const allocated = allocatedByRequirement(state.allocations).get(id) ?? 0;
    if (draft.quantity < allocated - EPS) return `The quantity cannot be below the ${fmtQtyU(allocated, cur.unit)} already allocated: reduce the allocations first`;
    const r = updateRequirement(cur, draft, new Date().toISOString());
    if (!r.requirement) return r.error;
    if (r.requirement !== cur) set({ requirements: state.requirements.map((x) => (x.id === id ? r.requirement! : x)), editing: null }, true);
    else set({ editing: null }, false);
    return null;
  },
  duplicate(id: string): string | null {
    const cur = req(id);
    if (!cur) return null;
    const r = createRequirement(uid("rq"), { ...draftOf(cur), name: `${cur.name} (copy)`.slice(0, 80) }, new Date().toISOString());
    if (!r.requirement) return null;
    set({ requirements: [...state.requirements, r.requirement], activeId: r.requirement.id, proposing: false }, true);
    return r.requirement.id;
  },
  /** Delete a requirement and its allocations (their quantities are released). */
  remove(id: string) {
    if (!req(id)) return;
    const requirements = state.requirements.filter((r) => r.id !== id);
    set({ requirements, allocations: removeForRequirement(state.allocations, id), activeId: state.activeId === id ? (requirements[0]?.id ?? null) : state.activeId, editing: state.editing?.id === id ? null : state.editing, proposing: false }, true);
  },
  select(id: string) {
    if (req(id) && id !== state.activeId) set({ activeId: id, proposing: false }, true);
  },

  // ── allocations ──
  /** Confirm or revise one allocation. Returns the reason it was refused, or null. */
  allocate(requirementId: string, componentId: string, quantity: number, note?: string): string | null {
    const r = allocate(matchContext(), state.requirements, state.allocations, { requirementId, componentId, quantity, ...(note !== undefined ? { note } : {}) }, new Date().toISOString(), () => uid("al"));
    if (r.error) return r.error;
    set({ allocations: r.allocations }, true);
    return null;
  },
  /** Confirm the suggested allocation of the active requirement (each item is validated against the ledger as it is applied). */
  confirmProposal(requirementId: string, includeConditional: boolean): { applied: number; errors: readonly string[] } {
    const r = req(requirementId);
    if (!r) return { applied: 0, errors: ["That requirement does not exist"] };
    const ctx = matchContext();
    const proposal = proposeFill(r, matchRequirement(ctx, r), state.allocations, { includeConditional });
    const b = allocateBatch(ctx, state.requirements, state.allocations, proposal.items, new Date().toISOString(), () => uid("al"));
    if (b.applied > 0) set({ allocations: b.allocations, proposing: false }, true);
    return { applied: b.applied, errors: b.errors };
  },
  setNote(allocationId: string, note: string) {
    const a = state.allocations.find((x) => x.id === allocationId);
    if (!a || a.note === note) return;
    set({ allocations: state.allocations.map((x) => (x.id === allocationId ? { ...x, note: note.slice(0, 1000), updatedAt: new Date().toISOString() } : x)) }, true);
  },
  /** Revise the quantity of an existing allocation (same validation as confirming). */
  setQuantity(allocationId: string, quantity: number): string | null {
    const a = state.allocations.find((x) => x.id === allocationId);
    if (!a) return "That allocation does not exist";
    return reuseStore.allocate(a.requirementId, a.componentId, quantity);
  },
  removeAllocation(allocationId: string) {
    const next = removeAllocation(state.allocations, allocationId);
    if (next !== state.allocations) set({ allocations: next }, true);
  },
  clearAllocations(requirementId: string) {
    const next = removeForRequirement(state.allocations, requirementId);
    if (next !== state.allocations) set({ allocations: next }, true);
  },

  // ── configuration ──
  setWeight(key: CriterionKey, weight: number): string | null {
    const next: MatchConfig = { ...state.config, weights: { ...state.config.weights, [key]: weight } };
    const error = validateConfig(next);
    if (!error) set({ config: next }, true);
    return error;
  },
  setCredit(field: "partialCredit" | "unknownCredit", value: number): string | null {
    const next: MatchConfig = { ...state.config, [field]: value };
    const error = validateConfig(next);
    if (!error) set({ config: next }, true);
    return error;
  },
  resetConfig() {
    if (state.config !== DEFAULT_CONFIG) set({ config: DEFAULT_CONFIG }, true);
  },
  /** Remove everything this workspace stores (requirements, allocations, configuration). */
  clearAll() {
    releaseHighlight();
    set({ requirements: [], allocations: [], config: DEFAULT_CONFIG, activeId: null, editing: null, proposing: false }, true);
  },
};

export function useReuse(): ReuseState {
  return useSyncExternalStore(reuseStore.subscribe, reuseStore.get);
}

// ── another drawer opened: step aside ────────────────────────────────────────

function stepAside() {
  if (!state.open) return;
  if (inventoryUi.get() || recoveryStore.get().open || removalStore.get().open || scenarioStore.get().open || carbonStore.get().open) reuseStore.setOpen(false);
}
for (const s of [inventoryUi, recoveryStore, removalStore, scenarioStore, carbonStore]) s.subscribe(stepAside);

declare global {
  interface Window {
    /** Dev only: lets the browser verification script drive and inspect the reuse store. */
    __reuse?: typeof reuseStore & { context: typeof matchContext; result: (r: Requirement) => ReturnType<typeof matchRequirement> };
  }
}
if (import.meta.env?.DEV && typeof window !== "undefined") window.__reuse = Object.assign(reuseStore, { context: matchContext, result: (r: Requirement) => matchRequirement(matchContext(), r) });
