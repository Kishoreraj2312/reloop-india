/**
 * Scenario workspace store (B4). A tiny external store (no library), like the B2 recovery and B3 removal stores: the
 * drawer, the inspector line and the 3D highlight all subscribe, so none of them needs App state and opening the workspace
 * never re-renders the scene tree.
 *
 * Scenarios are the user's assumptions only (rules and overrides), kept apart from the records, the B1 quantities, the B2
 * assessments and the B3 plans, and saved to localStorage (sparse: only what the user created). Results are never stored:
 * they are recomputed from B1 + B2 + the scenario (and memoised per object by the engine). The comparison selection, the
 * quantity basis, the unit tab and the 3D highlight are view settings and are not saved.
 */

import { useSyncExternalStore } from "react";
import { getModelInventory, type Unit } from "@/engine/quantities";
import type { Basis } from "@/engine/recovery";
import {
  assessedCategories,
  computeScenario,
  duplicateScenario,
  matchLeaves,
  newScenario,
  parseScenarios,
  renameScenario,
  resetScenario,
  selectorKey,
  serializeScenarios,
  setBaseline as opSetBaseline,
  setCategoryRule as opSetCategoryRule,
  setComponentRules as opSetComponentRules,
  setResidual as opSetResidual,
  setScope as opSetScope,
  TEMPLATE_INFO,
  TEMPLATES,
  type EditResult,
  type Match,
  type Residual,
  type Rule,
  type Scenario,
  type ScenarioResult,
  type Selector,
  type TemplateId,
} from "@/engine/scenarios";
import { inventoryUi } from "../inventory/inventoryStore";
import { recoveryStore } from "../recovery/recoveryStore";
import { removalStore } from "../removal/removalStore";

export const STORAGE_KEY = "rematter.scenarios.v1";
export const MAX_COMPARE = 3;

export interface Highlight {
  /** The scenario whose outcomes are shown in the model. */
  readonly scenarioId: string;
  readonly selector: Selector;
  /** Short text for the highlight bar. */
  readonly label: string;
  /** Another workspace (B5) supplies the components itself: `scenarioId` is then "" and `selector` is unused. */
  readonly matches?: readonly Match[];
  /** One colour (0xRRGGBB) for every match, instead of the outcome colours. */
  readonly colour?: number;
  /** The workspace that set this highlight ("carbon", "reuse"): only its owner clears it when it closes. */
  readonly owner?: string;
}

export interface ScenarioStoreState {
  readonly scenarios: readonly Scenario[];
  /** The scenario being edited. */
  readonly activeId: string | null;
  /** The scenarios shown side by side (0–3). */
  readonly compareIds: readonly string[];
  /** The workspace is open. The 3D highlight is shown only while it is. */
  readonly open: boolean;
  /** The workspace is folded into a small card so the whole model is visible; the highlight stays on. */
  readonly collapsed: boolean;
  /** Another workspace that uses this highlight (B5 carbon) is open: the highlight is drawn while it is. */
  readonly externalOpen: boolean;
  readonly basis: Basis;
  /** The unit tab (quantity basis); null = the first unit present. */
  readonly unit: Unit | null;
  readonly highlight: Highlight | null;
  /** Bumped on every change (cheap memo key). */
  readonly version: number;
}

function load(): { scenarios: readonly Scenario[]; activeId: string | null; compareIds: readonly string[] } {
  try {
    const r = parseScenarios(window.localStorage.getItem(STORAGE_KEY));
    return { scenarios: r.scenarios, activeId: r.activeId, compareIds: r.compareIds };
  } catch {
    return { scenarios: [], activeId: null, compareIds: [] }; // storage blocked or unavailable: start empty
  }
}

function save(s: readonly Scenario[], activeId: string | null, compareIds: readonly string[]): void {
  try {
    if (s.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, serializeScenarios({ scenarios: s, activeId, compareIds }));
  } catch {
    /* quota or blocked: the session still works, it just will not persist */
  }
}

let counter = 0;
const newId = () => `scn-${Date.now().toString(36)}${(counter++).toString(36)}`;

const init = load();
let state: ScenarioStoreState = { scenarios: init.scenarios, activeId: init.activeId, compareIds: init.compareIds, open: false, basis: "quantity", unit: null, highlight: null, collapsed: false, externalOpen: false, version: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function set(patch: Partial<ScenarioStoreState>, persist: boolean) {
  state = { ...state, ...patch, version: state.version + 1 };
  if (persist) save(state.scenarios, state.activeId, state.compareIds);
  emit();
}

const byId = (id: string | null | undefined) => state.scenarios.find((s) => s.id === id);
const assessed = () => assessedCategories(getModelInventory(), recoveryStore.get().assessments);

function uniqueName(base: string): string {
  const names = new Set(state.scenarios.map((s) => s.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Replace one scenario (by id) with an edited object. */
function replace(next: Scenario) {
  const cur = byId(next.id);
  if (!cur || cur === next) return;
  set({ scenarios: state.scenarios.map((s) => (s.id === next.id ? next : s)) }, true);
}

function apply(id: string | undefined, op: (s: Scenario) => EditResult): string | null {
  const s = byId(id ?? state.activeId);
  if (!s) return "No scenario selected.";
  const r = op(s);
  if (!r.error) replace(r.scenario);
  return r.error;
}

export const scenarioStore = {
  get: (): ScenarioStoreState => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  scenario: byId,
  active: (): Scenario | undefined => byId(state.activeId),
  compared: (): Scenario[] => state.compareIds.map(byId).filter((s): s is Scenario => s !== undefined),

  /** Opening the workspace closes the other drawers (one drawer at a time, as everywhere else). */
  setOpen(open: boolean) {
    if (open === state.open) return;
    if (open) {
      inventoryUi.set(false);
      recoveryStore.setOpen(false);
      removalStore.setOpen(false);
    }
    // another workspace's highlight does not follow us here
    set({ open, collapsed: false, ...(open && state.highlight?.matches ? { highlight: null } : {}) }, false);
  },
  /** B5 opened / closed: its highlight is drawn only while it is open. */
  setExternalOpen: (externalOpen: boolean) => set({ externalOpen }, false),
  setCollapsed: (collapsed: boolean) => set({ collapsed }, false),
  setBasis: (basis: Basis) => set({ basis, unit: null }, false),
  setUnit: (unit: Unit | null) => set({ unit }, false),

  // scenarios
  createFromTemplate(template: TemplateId, name?: string): string {
    const id = newId();
    const s = newScenario(id, name ?? uniqueName(TEMPLATE_INFO[template].label), template, assessed());
    const compareIds = state.compareIds.length < MAX_COMPARE ? [...state.compareIds, id] : state.compareIds;
    set({ scenarios: [...state.scenarios, s], activeId: id, compareIds }, true);
    return id;
  },
  /** The three templates in one action (only those that do not exist yet by name), selected for comparison. */
  createStarterSet(): void {
    const ids: string[] = [];
    let scenarios = state.scenarios;
    for (const t of TEMPLATES) {
      const id = newId();
      const label = TEMPLATE_INFO[t].label;
      const name = scenarios.some((s) => s.name === label) ? uniqueName(label) : label;
      scenarios = [...scenarios, newScenario(id, name, t, assessed())];
      ids.push(id);
    }
    set({ scenarios, activeId: ids[0] ?? state.activeId, compareIds: ids.slice(0, MAX_COMPARE) }, true);
  },
  select(id: string) {
    if (byId(id) && id !== state.activeId) set({ activeId: id }, true);
  },
  rename(name: string, id?: string): string | null {
    return apply(id, (s) => renameScenario(s, name));
  },
  duplicate(id?: string): string | null {
    const s = byId(id ?? state.activeId);
    if (!s) return null;
    const nid = newId();
    const copy = duplicateScenario(s, nid, uniqueName(`${s.name} (copy)`));
    const compareIds = state.compareIds.length < MAX_COMPARE ? [...state.compareIds, nid] : state.compareIds;
    set({ scenarios: [...state.scenarios, copy], activeId: nid, compareIds }, true);
    return nid;
  },
  /** Back to the template's defaults (assumptions and overrides; id, name and template are kept). */
  reset(id?: string) {
    const s = byId(id ?? state.activeId);
    if (s) replace(resetScenario(s, assessed()));
  },
  delete(id?: string) {
    const target = id ?? state.activeId;
    if (!target || !byId(target)) return;
    const scenarios = state.scenarios.filter((s) => s.id !== target);
    set(
      {
        scenarios,
        activeId: state.activeId === target ? (scenarios[0]?.id ?? null) : state.activeId,
        compareIds: state.compareIds.filter((c) => c !== target),
        highlight: state.highlight?.scenarioId === target ? null : state.highlight,
      },
      true,
    );
  },

  // comparison
  /** Add to / remove from the comparison; false when three are already selected. */
  toggleCompare(id: string): boolean {
    if (!byId(id)) return false;
    if (state.compareIds.includes(id)) {
      set({ compareIds: state.compareIds.filter((c) => c !== id), highlight: state.highlight?.scenarioId === id ? null : state.highlight }, true);
      return true;
    }
    if (state.compareIds.length >= MAX_COMPARE) return false;
    set({ compareIds: [...state.compareIds, id] }, true);
    return true;
  },

  // assumptions (default: the scenario being edited)
  setResidual: (residual: Residual, id?: string) => apply(id, (s) => opSetResidual(s, residual)),
  setBaseline: (rule: Rule, id?: string) => apply(id, (s) => opSetBaseline(s, rule)),
  setScope: (categories: readonly string[], id?: string) => apply(id, (s) => opSetScope(s, categories)),
  setCategoryRule: (category: string, rule: Rule | null, id?: string) => apply(id, (s) => opSetCategoryRule(s, category, rule)),
  setComponentRules: (ids: readonly string[], rule: Rule | null, id?: string) => apply(id, (s) => opSetComponentRules(s, ids, rule)),

  // 3D highlight
  setHighlight(highlight: Highlight | null) {
    set({ highlight }, false);
  },
};

export function useScenarios(): ScenarioStoreState {
  return useSyncExternalStore(scenarioStore.subscribe, scenarioStore.get);
}

// ── derived data ─────────────────────────────────────────────────────────────

/** The memoised engine result for a scenario against the current B2 assessments. */
export function resultOf(s: Scenario): ScenarioResult {
  return computeScenario(getModelInventory(), recoveryStore.get().assessments, s);
}

const matchCache = new WeakMap<Scenario, WeakMap<object, Map<string, readonly Match[]>>>();
/** The components a highlight stands for (memoised per scenario object, assessments object, basis and selector). */
export function highlightMatches(h: Highlight, basis: Basis): readonly Match[] {
  if (h.matches) return h.matches;
  const s = byId(h.scenarioId);
  if (!s) return [];
  const a = recoveryStore.get().assessments;
  let byA = matchCache.get(s);
  if (!byA) matchCache.set(s, (byA = new WeakMap()));
  let m = byA.get(a);
  if (!m) byA.set(a, (m = new Map()));
  const key = `${basis}|${selectorKey(h.selector)}`;
  let r = m.get(key);
  if (!r) m.set(key, (r = matchLeaves(getModelInventory(), a, s, basis, h.selector)));
  return r;
}

/** The highlight is applied to the model only while the workspace is shown and nothing with priority is: B3 simulation. */
export function highlightApplies(sc: ScenarioStoreState, removalActive: boolean, recoveryOpen: boolean): boolean {
  return (sc.open || sc.externalOpen) && !removalActive && !recoveryOpen && sc.highlight !== null && (sc.highlight.matches !== undefined || byId(sc.highlight.scenarioId) !== undefined);
}

declare global {
  interface Window {
    /** Dev only: lets the browser verification script drive and inspect the scenario store. */
    __scenarios?: typeof scenarioStore & { result: typeof resultOf; matches: typeof highlightMatches };
  }
}
if (import.meta.env?.DEV && typeof window !== "undefined") {
  window.__scenarios = Object.assign(scenarioStore, { result: resultOf, matches: highlightMatches });
}
