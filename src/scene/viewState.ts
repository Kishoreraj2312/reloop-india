/**
 * View state for layers, floor isolation and the ceilings toggle (pure).
 *
 * The 3D tree is never re-rendered for a toggle: `groupVisibility` maps every hierarchy
 * group name to a boolean and the viewer applies it imperatively (group.visible).
 */

import { ELECTRICAL_CATEGORIES, PLUMBING_CATEGORIES, type ArchCategory, type MepCategory } from "@/building/structure";
import type { FloorKey } from "./SceneHierarchy";
import { FLOOR_ORDER } from "./sceneTree";

export const LAYERS = [
  "structure",
  "exteriorWalls",
  "interiorWalls",
  "openings",
  "flooring",
  "ceilings",
  "fixtures",
  "balconiesFacade",
  "roof",
  "plumbing",
  "electrical",
] as const;
export type LayerKey = (typeof LAYERS)[number];

export const LAYER_LABELS: Readonly<Record<LayerKey, string>> = {
  structure: "Structure",
  exteriorWalls: "Exterior walls",
  interiorWalls: "Interior walls",
  openings: "Doors & windows",
  flooring: "Flooring & stair finishes",
  ceilings: "Ceilings",
  fixtures: "Fixtures",
  balconiesFacade: "Balconies & facade",
  roof: "Roof",
  plumbing: "Plumbing (A3)",
  electrical: "Electrical (A3)",
};

export const CATEGORY_LAYER: Readonly<Record<ArchCategory, LayerKey>> = {
  exteriorWalls: "exteriorWalls",
  partitions: "interiorWalls",
  openings: "openings",
  floors: "flooring",
  stairFinishes: "flooring",
  ceilings: "ceilings",
  fixtures: "fixtures",
  balconies: "balconiesFacade",
  facade: "balconiesFacade",
  roof: "roof",
};

export interface ViewState {
  readonly layers: Readonly<Record<LayerKey, boolean>>;
  /** Isolated floor (others hidden), or null for the whole building. */
  readonly isolate: FloorKey | null;
  /** Ceilings shown while a floor is isolated (hidden by default in cutaway). */
  readonly ceilingsInIsolation: boolean;
  /** Per-floor visibility when not isolating. */
  readonly floors: Readonly<Record<FloorKey, boolean>>;
  /** Ghost the building (A1/A2) so MEP services read through it. */
  readonly xray?: boolean;
  /** MEP categories switched off (absent = on). */
  readonly mepOff?: Readonly<Partial<Record<MepCategory, boolean>>>;
}

export const MEP_CATEGORY_LABELS: Readonly<Record<MepCategory, string>> = {
  water: "cold water",
  hotWater: "hot water",
  drainage: "soil & waste",
  vent: "vents",
  rainwater: "rainwater",
  distribution: "distribution",
  lighting: "lighting",
  power: "power",
  containment: "cable trays",
  earthing: "earthing",
};

/** Light fittings stay visible with the ceilings hidden while electrical lighting is shown. */
export const lightsShown = (v: ViewState) => v.layers.electrical !== false && !v.mepOff?.lighting;

export const DEFAULT_VIEW: ViewState = {
  layers: Object.fromEntries(LAYERS.map((l) => [l, true])) as Record<LayerKey, boolean>,
  isolate: null,
  ceilingsInIsolation: false,
  floors: Object.fromEntries(FLOOR_ORDER.map((f) => [f, true])) as Record<FloorKey, boolean>,
};

export function floorVisible(v: ViewState, floor: FloorKey): boolean {
  if (v.isolate) return floor === v.isolate;
  return v.floors[floor];
}

export function categoryVisible(v: ViewState, category: ArchCategory): boolean {
  const layer = CATEGORY_LAYER[category];
  if (!v.layers[layer]) return false;
  if (layer === "ceilings" && v.isolate && !v.ceilingsInIsolation) return false;
  return true;
}

/** Visibility of every named hierarchy group: Floor_X, X_structure, X_architecture, X_architecture_<category>. */
export function groupVisibility(v: ViewState, categories: readonly ArchCategory[]): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const f of FLOOR_ORDER) {
    m.set(`Floor_${f}`, floorVisible(v, f));
    m.set(`${f}_structure`, v.layers.structure);
    m.set(`${f}_architecture`, true);
    m.set(`${f}_plumbing`, v.layers.plumbing !== false);
    m.set(`${f}_electrical`, v.layers.electrical !== false);
    for (const c of PLUMBING_CATEGORIES) m.set(`${f}_plumbing_${c}`, !v.mepOff?.[c]);
    for (const c of ELECTRICAL_CATEGORIES) m.set(`${f}_electrical_${c}`, !v.mepOff?.[c]);
    for (const c of categories) m.set(`${f}_architecture_${c}`, categoryVisible(v, c));
  }
  return m;
}
