/**
 * Recovery UI + assessment store (B2). A tiny external store (no library): the drawer, the inspector
 * block and the 3D colour overlay all subscribe, so none of them needs App state and toggling a panel
 * never re-renders the scene tree.
 *
 * Assessments are the user's planning inputs, kept apart from records and B1 quantities. The app had no
 * persistence before B2, so they are saved to localStorage (sparse: only edited components).
 *
 * Starter sample: a browser that has never saved assessments starts with the illustrative sample of
 * engine/recovery/starter.ts (every entry noted as such), so the 3D colouring and the downstream modules have something to show.
 * It is held in memory, and assessments that start from it are saved as the changes only (a pristine sample writes nothing). Emptying
 * the assessments on purpose (reset, or clearing every entry) records that choice, so the sample never comes back by itself.
 */

import { useSyncExternalStore } from "react";
import { getModelInventory } from "@/engine/quantities";
import {
  applyPatch,
  fillWithStarter,
  isEmptyAssessment,
  isOverStarter,
  parseAssessments,
  parseOverStarter,
  serializeAssessments,
  serializeOverStarter,
  starterAssessments,
  STARTER_NOTE,
  targetLeafIds,
  type AssessmentPatch,
  type Assessments,
  type Basis,
  type PatchResult,
  type RecoveryAssessment,
} from "@/engine/recovery";

export const STORAGE_KEY = "rematter.recovery.assessments.v1";
/** "declined" once the user has emptied the assessments on purpose: the starter sample is not brought back on the next visit. */
export const STARTER_FLAG_KEY = "rematter.recovery.starter.v1";

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
  /** The assessments are the unmodified starter sample (illustrative, held in memory, nothing saved). */
  readonly starter: boolean;
}

/**
 * What an earlier visit left, and what still has to be built from the model once it is idle: `pending` is set when this visit starts
 * from the starter sample, either fresh (`raw` null) or with the changes an earlier visit saved over it (`raw`).
 */
function load(): { assessments: Assessments; pending: { raw: string | null } | null } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { assessments: new Map(), pending: window.localStorage.getItem(STARTER_FLAG_KEY) === "declined" ? null : { raw: null } };
    if (isOverStarter(raw)) return { assessments: new Map(), pending: { raw } };
    return { assessments: parseAssessments(raw).map, pending: null }; // the user's own entries, whatever they are
  } catch {
    return { assessments: new Map(), pending: typeof window !== "undefined" ? { raw: null } : null }; // storage blocked: the sample still shows for this session
  }
}

let starterBased = false; // the current assessments are the sample plus the user's changes, so they are saved as changes only
let sample: Assessments | null = null;
const starterSample = (): Assessments => (sample ??= starterAssessments(getModelInventory()));

function save(a: Assessments): void {
  try {
    if (a.size === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.setItem(STARTER_FLAG_KEY, "declined"); // emptied on purpose: do not bring the sample back
    } else window.localStorage.setItem(STORAGE_KEY, starterBased ? serializeOverStarter(a, starterSample()) : serializeAssessments(a));
  } catch {
    /* quota or blocked: the session still works, it just will not persist */
  }
}

const boot = load();
let pending = boot.pending;
let state: RecoveryState = { assessments: boot.assessments, open: false, colour: false, basis: "quantity", focus: null, version: 0, starter: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const update = (patch: Partial<RecoveryState>) => {
  state = { ...state, ...patch };
  emit();
};

/** Put the starter sample (with any saved changes) in, once. It needs the B1 inventory, so it waits for idle time or the first action that needs it. */
function resolveStarter(): void {
  if (!pending) return;
  const { raw } = pending;
  pending = null;
  const base = starterSample();
  if (raw === null) {
    starterBased = true;
    update({ assessments: base, starter: true, version: state.version + 1 });
    return;
  }
  const merged = parseOverStarter(raw, base);
  starterBased = merged !== null;
  update({ assessments: merged ?? new Map(), starter: false, version: state.version + 1 });
}
if (pending && typeof window !== "undefined") {
  const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(resolveStarter, { timeout: 5000 });
  else window.setTimeout(resolveStarter, 2500);
}

/** A component the user has just changed is no longer the starter sample, so its note goes: the sample's note always means "untouched". */
function unmarkEdited(next: Assessments, before: Assessments, ids: readonly string[]): Assessments {
  let out: Map<string, RecoveryAssessment> | null = null;
  for (const id of ids) {
    const a = next.get(id);
    if (!a || a === before.get(id) || a.note !== STARTER_NOTE) continue;
    out ??= new Map(next);
    const edited = { ...a, note: "" };
    if (isEmptyAssessment(edited)) out.delete(id);
    else out.set(id, edited);
  }
  return out ?? next;
}

/** Make `map` the assessments and save it. Emptied assessments are no longer "the sample plus changes": whatever is entered next starts clean. */
function commit(map: Assessments): void {
  if (map.size === 0) starterBased = false;
  save(map);
  update({ assessments: map, version: state.version + 1, starter: false });
}

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
  /** Show the starter sample now if this visit starts from it and it has not been put in yet (it otherwise waits for idle time). */
  ensureStarter: resolveStarter,

  /** Apply a patch to components (an assembly id expands to its leaf parts). */
  assess(ids: readonly string[], patch: AssessmentPatch): PatchResult {
    resolveStarter(); // an edit is made on top of the sample, so the sample has to be there first
    const inv = getModelInventory();
    const leaves = ids.flatMap((id) => targetLeafIds(inv, id));
    const r = applyPatch(inv, state.assessments, leaves, patch);
    if (!r.error && r.applied > 0) commit(patch.note === undefined ? unmarkEdited(r.map, state.assessments, leaves) : r.map);
    return r;
  },
  /** Remove the assessments of these components. */
  clear(ids: readonly string[]): number {
    return recoveryStore.assess(ids, { classification: null, recoveryPct: null, preparation: null, destination: null, lossNote: "", note: "" }).applied;
  },
  clearAll(): void {
    pending = null; // nothing left to put in
    commit(new Map());
  },
  /** Add the starter sample to components that have no entry yet; entries already made are never touched. Returns how many were added. */
  fillStarter(): number {
    resolveStarter();
    const { map, filled } = fillWithStarter(getModelInventory(), state.assessments);
    if (filled === 0) return 0;
    starterBased = true; // the sample plus what was already entered (which wins) is exactly the sample with changes
    commit(map);
    return filled;
  },
};

export function useRecovery(): RecoveryState {
  return useSyncExternalStore(recoveryStore.subscribe, recoveryStore.get);
}
