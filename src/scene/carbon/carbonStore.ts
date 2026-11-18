/**
 * Carbon workspace store (B5). A tiny external store like the B2 / B3 / B4 stores. It holds the USER's emission-factor library
 * and assumptions (saved to localStorage, apart from the records, B1 quantities, B2 assessments, B3 plans and B4 scenarios,
 * which are only read) and the workspace's view state. Results are never stored: they are priced from B1 + B2 + a B4 scenario
 * + these inputs (the collection is memoised, so a changed factor value or assumption re-prices in microseconds).
 * The library starts EMPTY: nothing is assessed until the user supplies factors.
 */

import { useSyncExternalStore } from "react";
import { getModelInventory } from "@/engine/quantities";
import {
  categoryBases,
  categoryLeafIds,
  collectCached,
  emptyFactor,
  EMPTY_ASSUMPTIONS,
  illustrativeFactors,
  parseCarbon,
  priceBaseline,
  priceScenario,
  removeFactor,
  serializeCarbon,
  setCategoryValue as opSetCategoryValue,
  setFactor as opSetFactor,
  setReplacement as opSetReplacement,
  setTransport as opSetTransport,
  sensitivity as opSensitivity,
  unassessedLeafIds,
  type Assumptions,
  type Baseline,
  type EmissionFactor,
  type FactorLibrary,
  type RecoveryKey,
  type ScenarioCarbon,
  type Sensitivity,
} from "@/engine/carbon";
import type { Scenario } from "@/engine/scenarios";
import { inventoryUi } from "../inventory/inventoryStore";
import { recoveryStore } from "../recovery/recoveryStore";
import { removalStore } from "../removal/removalStore";
import { scenarioStore } from "../scenarios/scenarioStore";

export const STORAGE_KEY = "rematter.carbon.v1";
/** Highlight colours: assessed material (teal) and material that is not assessed (grey). */
export const CARBON_COLOURS = { assessed: 0x1b7f8c, unassessed: 0x8c96a0 } as const;

export interface CarbonState {
  readonly factors: FactorLibrary;
  readonly assumptions: Assumptions;
  readonly open: boolean;
  readonly collapsed: boolean;
  /** Bumped on every change (cheap memo key). */
  readonly version: number;
}

function load() {
  try {
    const r = parseCarbon(window.localStorage.getItem(STORAGE_KEY));
    return { factors: r.factors, assumptions: r.assumptions };
  } catch {
    return { factors: new Map<string, EmissionFactor>(), assumptions: EMPTY_ASSUMPTIONS }; // storage blocked: start empty
  }
}
function save(factors: FactorLibrary, assumptions: Assumptions): void {
  try {
    if (factors.size === 0 && assumptions === EMPTY_ASSUMPTIONS) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, serializeCarbon({ factors, assumptions }));
  } catch {
    /* quota or blocked: the session still works, it just will not persist */
  }
}

const init = load();
let state: CarbonState = { factors: init.factors, assumptions: init.assumptions, open: false, collapsed: false, version: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(patch: Partial<CarbonState>, persist: boolean) {
  state = { ...state, ...patch, version: state.version + 1 };
  if (persist) save(state.factors, state.assumptions);
  emit();
}
const assessments = () => recoveryStore.get().assessments;

export const carbonStore = {
  get: (): CarbonState => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  /** Opening the workspace closes the other drawers; its 3D highlight is drawn only while it is open. */
  setOpen(open: boolean) {
    if (open === state.open) return;
    if (open) {
      inventoryUi.set(false);
      recoveryStore.setOpen(false);
      removalStore.setOpen(false);
      scenarioStore.setOpen(false);
    } else if (scenarioStore.get().highlight?.matches) scenarioStore.setHighlight(null);
    scenarioStore.setExternalOpen(open);
    set({ open, collapsed: false }, false);
  },
  setCollapsed: (collapsed: boolean) => set({ collapsed }, false),

  // factors
  /** Edit one category's factor (creating it with the category's suggested unit). Invalid input changes nothing. */
  editFactor(category: string, patch: Partial<EmissionFactor>): string | null {
    const cur = state.factors.get(category) ?? emptyFactor(category, categoryBases(getModelInventory()).find((c) => c.category === category)?.suggested ?? "kg");
    // a value typed by the user is no longer the illustrative demonstration value
    const touchedValue = patch.value !== undefined && patch.value !== cur.value;
    const origin = patch.origin ?? (cur.origin === "illustrative" && touchedValue ? "assumed" : cur.origin);
    const r = opSetFactor(state.factors, { ...cur, ...patch, origin, ...(cur.origin === "illustrative" && touchedValue && patch.origin === undefined ? { sourceName: "", note: "" } : {}) });
    if (!r.error) set({ factors: r.library }, true);
    return r.error;
  },
  clearFactor(category: string) {
    const next = removeFactor(state.factors, category);
    if (next !== state.factors) set({ factors: next }, true);
  },
  clearAllFactors() {
    if (state.factors.size) set({ factors: new Map() }, true);
  },
  /** Adds the labelled demonstration factors for categories that have none yet. */
  loadIllustrative() {
    const next = new Map(state.factors);
    for (const [c, f] of illustrativeFactors()) if (!next.has(c)) next.set(c, f);
    set({ factors: next }, true);
  },

  // assumptions
  setReplacement(key: RecoveryKey, pct: number | null, category?: string): string | null {
    const r = opSetReplacement(state.assumptions, key, pct, category);
    if (!r.error && r.assumptions !== state.assumptions) set({ assumptions: r.assumptions }, true);
    return r.error;
  },
  setTransport(field: "recoveredKm" | "disposalKm" | "factorKgPerTonneKm", value: number | null): string | null {
    const r = opSetTransport(state.assumptions, field, value);
    if (!r.error) set({ assumptions: r.assumptions }, true);
    return r.error;
  },
  setCategoryValue(field: "refurbishFactor" | "processingFactor" | "densityKgM3", category: string, value: number | null): string | null {
    const r = opSetCategoryValue(state.assumptions, field, category, value);
    if (!r.error) set({ assumptions: r.assumptions }, true);
    return r.error;
  },
  resetAssumptions() {
    set({ assumptions: EMPTY_ASSUMPTIONS }, true);
  },

  // 3D highlight (shared with B4: tints on the existing meshes)
  highlightCategory(category: string, label: string, assessed: boolean | "all") {
    const inv = getModelInventory();
    const ids = categoryLeafIds(inv, state.factors, state.assumptions, category, assessed);
    scenarioStore.setHighlight({ scenarioId: "", selector: {}, label, colour: assessed === false ? CARBON_COLOURS.unassessed : CARBON_COLOURS.assessed, matches: ids.map((id) => ({ id, outcome: "unknown" as const })) });
    return ids.length;
  },
  highlightUnassessed(label: string) {
    const ids = unassessedLeafIds(getModelInventory(), state.factors, state.assumptions);
    scenarioStore.setHighlight({ scenarioId: "", selector: {}, label, colour: CARBON_COLOURS.unassessed, matches: ids.map((id) => ({ id, outcome: "unknown" as const })) });
    return ids.length;
  },
};

export function useCarbon(): CarbonState {
  return useSyncExternalStore(carbonStore.subscribe, carbonStore.get);
}

// ── derived data (memoised per input object) ─────────────────────────────────

let baseKey: { f: FactorLibrary; a: Assumptions; r: object; out: Baseline } | null = null;
export function baselineNow(): Baseline {
  const { factors, assumptions } = state;
  const r = assessments();
  if (baseKey && baseKey.f === factors && baseKey.a === assumptions && baseKey.r === r) return baseKey.out;
  const c = collectCached(getModelInventory(), r, null, factors, assumptions);
  const out = priceBaseline(c, factors);
  baseKey = { f: factors, a: assumptions, r, out };
  return out;
}

const scnCache = new WeakMap<Scenario, { f: FactorLibrary; a: Assumptions; r: object; out: ScenarioCarbon }>();
export function scenarioCarbon(s: Scenario): ScenarioCarbon {
  const { factors, assumptions } = state;
  const r = assessments();
  const hit = scnCache.get(s);
  if (hit && hit.f === factors && hit.a === assumptions && hit.r === r) return hit.out;
  const out = priceScenario(collectCached(getModelInventory(), r, s, factors, assumptions), factors, assumptions);
  scnCache.set(s, { f: factors, a: assumptions, r, out });
  return out;
}

export function sensitivityOf(s: Scenario, scale = 0.2): Sensitivity {
  return opSensitivity(collectCached(getModelInventory(), assessments(), s, state.factors, state.assumptions), state.factors, state.assumptions, scale);
}

declare global {
  interface Window {
    /** Dev only: lets the browser verification script drive and inspect the carbon store. */
    __carbon?: typeof carbonStore & { baseline: typeof baselineNow; scenario: typeof scenarioCarbon };
  }
}
if (import.meta.env?.DEV && typeof window !== "undefined") {
  window.__carbon = Object.assign(carbonStore, { baseline: baselineNow, scenario: scenarioCarbon });
}
