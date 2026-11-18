/**
 * The workspaces (the former "drawers") as one registry: which one is active, how to open / close / fold it, and the rule that
 * only one is ever open. Every workspace keeps its own store; this module only reads and drives them, so nothing about their
 * behaviour changes. It replaces the open / closed precedence rules the controls panel used to carry (a recovery or removal opened
 * from the inspector took over, carbon over scenarios, ...) with one rule: the workspace opened last is the one showing.
 */

import { useSyncExternalStore } from "react";
import { inventoryUi } from "@/scene/inventory/inventoryStore";
import { recoveryStore } from "@/scene/recovery/recoveryStore";
import { removalStore } from "@/scene/removal/removalStore";
import { scenarioStore } from "@/scene/scenarios/scenarioStore";
import { carbonStore } from "@/scene/carbon/carbonStore";
import { reuseStore } from "@/scene/reuse/reuseStore";
import { trackingStore } from "@/scene/tracking/trackingStore";
import { recycleUi } from "@/scene/recycle/recycleStore";
import { NARROW_DOCK, WIDE_DOCK } from "./layoutStore";

export type WorkspaceId = "inventory" | "recovery" | "removal" | "scenarios" | "carbon" | "reuse" | "recycle" | "tracking";

export interface WorkspaceDef {
  readonly id: WorkspaceId;
  readonly label: string;
  /** The existing test id of this workspace's toggle (the top-bar tab). */
  readonly testid: string;
  readonly title: string;
  /** narrow: tables and forms (560 px); wide: side-by-side comparison and rail + main workspaces (up to 900 px). */
  readonly kind: "narrow" | "wide";
  /** Tabs of one group sit together in the top bar: assess what is there, plan its end of life, then reuse and track. */
  readonly group: "assess" | "plan" | "circular";
}

export const WORKSPACES: readonly WorkspaceDef[] = [
  { id: "inventory", label: "Inventory", testid: "inventory-toggle", title: "Quantity takeoff of every component", kind: "narrow", group: "assess" },
  { id: "recovery", label: "Recovery", testid: "recovery-toggle", title: "Classify components for recovery and reuse", kind: "narrow", group: "assess" },
  { id: "removal", label: "Removal", testid: "removal-toggle", title: "Simulate a removal sequence", kind: "narrow", group: "assess" },
  { id: "scenarios", label: "Scenarios", testid: "scenario-toggle", title: "Compare demolition and deconstruction scenarios", kind: "wide", group: "plan" },
  { id: "carbon", label: "Carbon", testid: "carbon-toggle", title: "Embodied-carbon assessment of the material and of the compared scenarios", kind: "wide", group: "plan" },
  { id: "reuse", label: "Reuse", testid: "reuse-toggle", title: "Match recovered components to reuse requirements and allocate quantities", kind: "wide", group: "circular" },
  { id: "recycle", label: "Recycle", testid: "recycle-toggle", title: "How the main materials can be recycled", kind: "narrow", group: "circular" },
  { id: "tracking", label: "Tracking", testid: "tracking-toggle", title: "Track planned and actual recovery, reuse, recycling and disposal", kind: "wide", group: "circular" },
];

interface Adapter {
  open(): boolean;
  set(open: boolean): void;
  folded(): boolean;
  fold(folded: boolean): void;
}

const ADAPTERS: Readonly<Record<WorkspaceId, Adapter>> = {
  inventory: { open: () => inventoryUi.get(), set: (o) => inventoryUi.set(o), folded: () => false, fold: () => {} },
  recovery: { open: () => recoveryStore.get().open, set: (o) => recoveryStore.setOpen(o), folded: () => false, fold: () => {} },
  removal: { open: () => removalStore.get().open, set: (o) => removalStore.setOpen(o), folded: () => false, fold: () => {} },
  scenarios: { open: () => scenarioStore.get().open, set: (o) => scenarioStore.setOpen(o), folded: () => scenarioStore.get().collapsed, fold: (f) => scenarioStore.setCollapsed(f) },
  carbon: { open: () => carbonStore.get().open, set: (o) => carbonStore.setOpen(o), folded: () => carbonStore.get().collapsed, fold: (f) => carbonStore.setCollapsed(f) },
  reuse: { open: () => reuseStore.get().open, set: (o) => reuseStore.setOpen(o), folded: () => reuseStore.get().collapsed, fold: (f) => reuseStore.setCollapsed(f) },
  recycle: { open: () => recycleUi.get(), set: (o) => recycleUi.set(o), folded: () => false, fold: () => {} },
  tracking: { open: () => trackingStore.get().open, set: (o) => trackingStore.setOpen(o), folded: () => trackingStore.get().collapsed, fold: (f) => trackingStore.setCollapsed(f) },
};

const IDS = WORKSPACES.map((w) => w.id);
/** Used only to break a tie when several are open at once at start-up (never happens through the interface). */
const PRIORITY: readonly WorkspaceId[] = ["removal", "recovery", "carbon", "scenarios", "inventory", "reuse", "recycle", "tracking"];

const openIds = (): WorkspaceId[] => IDS.filter((id) => ADAPTERS[id].open());

export interface ActiveWorkspace {
  readonly id: WorkspaceId | null;
  /** Folded into its summary card ("View model"): the dock is gone, the workspace and its 3D highlight stay. */
  readonly folded: boolean;
}

export function activeWorkspace(): ActiveWorkspace {
  const open = openIds();
  const id = PRIORITY.find((p) => open.includes(p)) ?? null;
  return { id, folded: id !== null && ADAPTERS[id].folded() };
}

const keyOf = (a: ActiveWorkspace): string => (a.id === null ? "" : `${a.id}${a.folded ? "|folded" : ""}`);
const parse = (k: string): ActiveWorkspace => (k === "" ? NONE : { id: k.split("|")[0] as WorkspaceId, folded: k.endsWith("|folded") });
const NONE: ActiveWorkspace = { id: null, folded: false };
const cache = new Map<string, ActiveWorkspace>();
const stable = (a: ActiveWorkspace): ActiveWorkspace => {
  const k = keyOf(a);
  return cache.get(k) ?? (cache.set(k, parse(k)), cache.get(k)!);
};

const stores = [inventoryUi, recoveryStore, removalStore, scenarioStore, carbonStore, reuseStore, recycleUi, trackingStore] as const;

export function subscribeAll(l: () => void): () => void {
  const offs = stores.map((s) => s.subscribe(l));
  return () => offs.forEach((o) => o());
}

export function useActiveWorkspace(): ActiveWorkspace {
  return useSyncExternalStore(subscribeAll, () => stable(activeWorkspace()));
}

/** Open `id` and close every other workspace; `null` closes them all. */
export function openWorkspace(id: WorkspaceId | null): void {
  for (const other of IDS) if (other !== id && ADAPTERS[other].open()) ADAPTERS[other].set(false);
  if (id !== null) ADAPTERS[id].set(true);
}

/** The top-bar tab: opens the workspace, or closes it when it is the one showing. */
export function toggleWorkspace(id: WorkspaceId): void {
  const a = activeWorkspace();
  if (a.id === id) ADAPTERS[id].set(false);
  else openWorkspace(id);
}

export function foldWorkspace(id: WorkspaceId, folded: boolean): void {
  ADAPTERS[id].fold(folded);
}

/** Default dock width of a workspace (before the window and the user's own width are applied). */
export const dockDefault = (id: WorkspaceId): number => (WORKSPACES.find((w) => w.id === id)?.kind === "wide" ? WIDE_DOCK : NARROW_DOCK);

// ── one at a time ────────────────────────────────────────────────────────────────
// Whatever opens a workspace (a top-bar tab, an inspector link, the passport, presentation mode), the others step aside: the one
// that was opened last stays. Closing the one showing never re-opens another, so nothing is ever stacked behind it.
let known = new Set<WorkspaceId>(openIds());
let busy = false;
subscribeAll(() => {
  if (busy) return;
  const now = openIds();
  if (now.length > 1) {
    const fresh = now.filter((id) => !known.has(id));
    const keep = fresh.length > 0 ? fresh[fresh.length - 1]! : PRIORITY.find((p) => now.includes(p))!;
    busy = true;
    try {
      for (const id of now) if (id !== keep) ADAPTERS[id].set(false);
    } finally {
      busy = false;
    }
  }
  known = new Set(openIds());
});
