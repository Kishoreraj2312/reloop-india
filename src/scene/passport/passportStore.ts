/**
 * Passport metadata store (C1). A tiny external store like the other B-phase stores. It holds ONLY the user's own passport
 * entries (inspection status, observed condition, notes, provenance), keyed by the stable component id and saved to
 * localStorage (sparse). Everything else in a passport is composed on demand from the existing modules and never stored here.
 */

import { useSyncExternalStore } from "react";
import { applyMeta, clearMeta, parseMeta, serializeMeta, type MetaMap, type MetaPatch } from "@/engine/passport";

export const STORAGE_KEY = "rematter.passports.v1";

export interface PassportState {
  readonly meta: MetaMap;
  /** The passport panel is folded to its header (selection and the model are untouched). */
  readonly collapsed: boolean;
  readonly version: number;
}

function load(): MetaMap {
  try {
    return parseMeta(window.localStorage.getItem(STORAGE_KEY)).map;
  } catch {
    return new Map(); // storage blocked or unavailable: start empty
  }
}
function save(m: MetaMap): void {
  try {
    if (m.size === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, serializeMeta(m));
  } catch {
    /* quota or blocked: the session still works, it just will not persist */
  }
}

let state: PassportState = { meta: load(), collapsed: false, version: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(patch: Partial<PassportState>, persist: boolean) {
  state = { ...state, ...patch, version: state.version + 1 };
  if (persist) save(state.meta);
  emit();
}

export const passportStore = {
  get: (): PassportState => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setCollapsed: (collapsed: boolean) => set({ collapsed }, false),
  /** Edit one component's entries. Invalid input changes nothing and returns the message. */
  edit(id: string, patch: MetaPatch): string | null {
    const r = applyMeta(state.meta, id, patch, new Date().toISOString());
    if (!r.error && r.map !== state.meta) set({ meta: r.map }, true);
    return r.error;
  },
  clear(id: string) {
    const next = clearMeta(state.meta, id);
    if (next !== state.meta) set({ meta: next }, true);
  },
  removeAll(ids: readonly string[]) {
    let next = state.meta;
    for (const id of ids) next = clearMeta(next, id);
    if (next !== state.meta) set({ meta: next }, true);
  },
};

export function usePassports(): PassportState {
  return useSyncExternalStore(passportStore.subscribe, passportStore.get);
}

declare global {
  interface Window {
    /** Dev only: lets the browser verification script drive and inspect the passport store. */
    __passports?: typeof passportStore;
  }
}
if (import.meta.env?.DEV && typeof window !== "undefined") window.__passports = passportStore;
