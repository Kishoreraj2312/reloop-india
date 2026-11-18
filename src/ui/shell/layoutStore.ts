/**
 * Layout state of the application shell: which tab of the scene sidebar is showing, whether the sidebar is folded to its rail, and
 * the width the user dragged the workspace dock to. Pure UI state: nothing here touches the model, the stores of the workspaces
 * or the view state. The sidebar mode and the dock width are remembered in this browser (best effort: storage can be unavailable).
 */

import { useSyncExternalStore } from "react";

export const LEFT_TABS = ["layers", "floors", "explode", "selection"] as const;
export type LeftTab = (typeof LEFT_TABS)[number];

/** auto: folds to the rail only when a wide workspace would otherwise squeeze the model; open / closed: the user's choice. */
export type LeftMode = "auto" | "open" | "closed";

export interface LayoutState {
  readonly tab: LeftTab;
  readonly leftMode: LeftMode;
  /** Dock width the user chose (px), or null for each workspace's own default. */
  readonly dockWidth: number | null;
}

const KEY = "reloop.shell.v1";

function load(): Pick<LayoutState, "leftMode" | "dockWidth"> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<LayoutState> | null;
    const leftMode = raw?.leftMode === "open" || raw?.leftMode === "closed" ? raw.leftMode : "auto";
    const dockWidth = typeof raw?.dockWidth === "number" && raw.dockWidth >= 300 && raw.dockWidth <= 4000 ? raw.dockWidth : null;
    return { leftMode, dockWidth };
  } catch {
    return { leftMode: "auto", dockWidth: null };
  }
}

function save(s: LayoutState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ leftMode: s.leftMode, dockWidth: s.dockWidth }));
  } catch {
    /* private window or blocked storage: the layout just is not remembered */
  }
}

let state: LayoutState = { tab: "layers", ...load() };
const listeners = new Set<() => void>();

function set(patch: Partial<LayoutState>, persist: boolean): void {
  const next = { ...state, ...patch };
  if (next.tab === state.tab && next.leftMode === state.leftMode && next.dockWidth === state.dockWidth) return;
  state = next;
  if (persist) save(state);
  listeners.forEach((l) => l());
}

export const layoutStore = {
  get: (): LayoutState => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setTab: (tab: LeftTab) => set({ tab }, false),
  setLeftMode: (leftMode: LeftMode) => set({ leftMode }, true),
  /** `persist` false while dragging; call `commit()` when the drag ends. */
  setDockWidth: (dockWidth: number | null, persist = true) => set({ dockWidth }, persist),
  commit: () => save(state),
};

export function useLayout(): LayoutState {
  return useSyncExternalStore(layoutStore.subscribe, layoutStore.get);
}

// ── geometry (pure) ──────────────────────────────────────────────────────────────

export const LEFT_WIDTH = 340;
export const RAIL_WIDTH = 52;
/** The 3D viewport never gets narrower than this: below it the sidebar folds, then the dock narrows. */
export const MIN_VIEWPORT = 440;
export const MIN_DOCK = 520;
export const NARROW_DOCK = 560;
export const WIDE_DOCK = 900;
/** A folded workspace leaves only its summary card (which floats over the viewport); the dock itself is gone. */
export const FOLDED_DOCK = 0;

export interface ShellGeometry {
  readonly leftFolded: boolean;
  readonly leftWidth: number;
  readonly dockWidth: number;
  readonly viewportWidth: number;
}

/**
 * Where the three columns land for a window of `windowWidth`. `dock` is the workspace's preferred width (null: no workspace open);
 * the user's own width wins over it. The model's viewport keeps at least MIN_VIEWPORT: in `auto` mode the sidebar folds to its rail
 * first (only for a default width); the dock only narrows (down to MIN_DOCK) after that, when the user has pinned the sidebar open,
 * or when the width is the user's own.
 */
export function shellGeometry(windowWidth: number, mode: LeftMode, dock: number | null, userDock: number | null, showLeft = true): ShellGeometry {
  if (!showLeft) {
    const d = dock === null ? 0 : Math.max(MIN_DOCK, Math.min(userDock ?? dock, windowWidth - MIN_VIEWPORT));
    return { leftFolded: true, leftWidth: 0, dockWidth: d, viewportWidth: windowWidth - d };
  }
  const want = dock === null ? 0 : (userDock ?? dock);
  // only a workspace's own default width folds the sidebar; a width the user chose is clamped to the room instead
  const folded = mode === "closed" || (mode === "auto" && dock !== null && userDock === null && windowWidth - LEFT_WIDTH - dock < MIN_VIEWPORT);
  const leftWidth = folded ? RAIL_WIDTH : LEFT_WIDTH;
  const room = windowWidth - leftWidth - MIN_VIEWPORT;
  const dockWidth = dock === null ? 0 : Math.max(MIN_DOCK, Math.min(want, room));
  return { leftFolded: folded, leftWidth, dockWidth, viewportWidth: windowWidth - leftWidth - dockWidth };
}
