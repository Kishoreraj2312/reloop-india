/**
 * Recovery UI + assessment store (B2). A tiny external store (no library): the drawer, the inspector
 * block and the 3D colour overlay all subscribe, so none of them needs App state and toggling a panel
 * never re-renders the scene tree.
 *
 * Assessments are the user's planning inputs, kept apart from records and B1 quantities. The app had no
 * persistence before B2, so they are saved to localStorage (sparse: only edited components).
 */

import { useSyncExternalStore } from "react";
import { getModelInventory } from "@/engine/quantities";
import {
  applyPatch,
  parseAssessments,
  serializeAssessments,
  targetLeafIds,
  type AssessmentPatch,
  type Assessments,
  type Basis,
  type PatchResult,
} from "@/engine/recovery";

export const STORAGE_KEY = "rematter.recovery.assessments.v1";

export interface RecoveryState {
  readonly assessments: Assessments;
  readonly open: boolean;
  /** Colour the 3D model by recovery status. */
  readonly colour: boolean;
  readonly basis: Basis;
  /** With colour on: only these components are coloured by status, the rest are pale. null = all. */
  readonly focus: ReadonlySet<string> | null;
  /** Bumped on every assessment change (cheap memo key). */
  readonly version: number;
}

function load(): Assessments {
  try {
    return parseAssessments(window.localStorage.getItem(STORAGE_KEY)).map;
  } catch {
    return new Map(); // storage blocked or unavailable: start empty
  }
}

function save(a: Assessments): void {
  try {
    if (a.size === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, serializeAssessments(a));
  } catch {
    /* quota or blocked: the session still works, it just will not persist */
  }
}

let state: RecoveryState = { assessments: load(), open: false, colour: false, basis: "quantity", focus: null, version: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const update = (patch: Partial<RecoveryState>) => {
  state = { ...state, ...patch };
  emit();
};

export const recoveryStore = {
  get: (): RecoveryState => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setOpen: (open: boolean) => update({ open }),
  setColour: (colour: boolean) => update({ colour }),
  setBasis: (basis: Basis) => update({ basis }),
  setFocus: (focus: ReadonlySet<string> | null) => update({ focus }),

  /** Apply a patch to components (an assembly id expands to its leaf parts). */
  assess(ids: readonly string[], patch: AssessmentPatch): PatchResult {
    const inv = getModelInventory();
    const leaves = ids.flatMap((id) => targetLeafIds(inv, id));
    const r = applyPatch(inv, state.assessments, leaves, patch);
    if (!r.error && r.applied > 0) {
      save(r.map);
      update({ assessments: r.map, version: state.version + 1 });
    }
    return r;
  },
  /** Remove the assessments of these components. */
  clear(ids: readonly string[]): number {
    return recoveryStore.assess(ids, { classification: null, recoveryPct: null, preparation: null, destination: null, lossNote: "", note: "" }).applied;
  },
  clearAll(): void {
    save(new Map());
    update({ assessments: new Map(), version: state.version + 1 });
  },
};

export function useRecovery(): RecoveryState {
  return useSyncExternalStore(recoveryStore.subscribe, recoveryStore.get);
}
