/**
 * Camera presets and scene plans for presentation mode (pure: no Three.js objects, no React, no stores; unit-tested on the real
 * model). A plan is a complete, declarative description of what to show: the view state (layers, isolation, X-ray), an optional
 * section plane, the camera pose (derived from the ACTUAL scene bounds), and which existing features to drive (exploded view,
 * drawers, recovery colouring). The presentation controller applies a plan to the existing application; nothing here computes data.
 */

import type { ExplodeMode } from "@/engine/explode";
import type { Box3, ComponentRecord } from "@/building/structure";
import { aboveGrade, frameBoxInto, HERO_DIR, unionBounds, type ClipSpec, type Insets, type V3, type ViewContext } from "../framing";
import { DEFAULT_VIEW, LAYERS, type LayerKey, type ViewState } from "../viewState";
import { floorKeyOf } from "../sceneTree";
import type { FloorKey } from "../SceneHierarchy";
import type { Pose } from "./cameraPath";

export type PresetId = "hero" | "front" | "plan" | "floor" | "exploded" | "mep" | "section";
export type Drawer = "inventory" | "recovery" | "removal" | "scenarios" | "carbon" | "reuse" | "tracking" | null;
/** The B4 / B5 / C2 / C3 workspaces are wider than the 560 px drawers (see scenarios/layout.ts). */
export const WIDE_DRAWERS: ReadonlySet<Drawer> = new Set<Drawer>(["scenarios", "carbon", "reuse", "tracking"]);
export type ExplodePreset = "assembled" | "partial" | "full";

/** Everything a plan needs to know about the scene and the screen. */
export interface PlanContext {
  /** Structure + architecture bounds: the building itself (site MEP items lie outside it). */
  readonly bounds: Box3;
  /** Bounds of one floor group's structure + architecture records. */
  readonly floorBounds: (floor: FloorKey) => Box3;
  readonly view: ViewContext;
  readonly fov: number;
  readonly width: number;
  readonly height: number;
  /** UI covering the canvas (the toolbar at the bottom, a drawer on the right, ...). */
  readonly insets: Insets;
}

export interface ScenePlan {
  readonly view: ViewState;
  /** Explicit section plane, or null for none. */
  readonly clip: ClipSpec | null;
  /** Camera pose; absent when the exploded framing is computed by the 3D side. */
  readonly pose?: Pose;
  /** For exploded scenes: the direction to frame along. */
  readonly explodeDirection?: V3;
  /** The exploded-view state to show (null: assembled, panel closed). */
  readonly explode: { readonly mode: ExplodeMode; readonly preset: ExplodePreset; readonly play?: boolean } | null;
  /** Which drawer to show; absent = leave the drawers as they are (camera presets never close a drawer the presenter opened). */
  readonly drawer?: Drawer;
  /** B2 colouring on, when assessments exist (the controller checks; it never invents assessments); absent = leave as is. */
  readonly recoveryColour?: boolean;
  /** A component to select (its card, and with `details` the inspector and passport); absent = none. */
  readonly select?: string;
  readonly details?: boolean;
  /** B3: simulate the active plan up to this step, overlay on (only when a plan exists; nothing is created). */
  readonly removalStep?: number;
  /** Which tab the C2 / C3 workspaces show. */
  readonly reuseTab?: "catalogue" | "matches" | "allocation";
  readonly trackingTab?: "register" | "report";
}

export interface PresetDef {
  readonly id: PresetId;
  readonly label: string;
  readonly hint: string;
  plan(ctx: PlanContext): ScenePlan;
}

/** Floor groups of the building (structure + architecture), for per-floor framing. */
export function floorBoundsOf(records: readonly ComponentRecord[]): (floor: FloorKey) => Box3 {
  const by = new Map<FloorKey, ComponentRecord[]>();
  for (const r of records) {
    if (r.system !== "structure" && r.system !== "architecture") continue;
    const k = floorKeyOf(r.floor);
    let l = by.get(k);
    if (!l) by.set(k, (l = []));
    l.push(r);
  }
  const cache = new Map<FloorKey, Box3>();
  return (floor) => {
    let b = cache.get(floor);
    if (!b) cache.set(floor, (b = unionBounds(by.get(floor) ?? [])));
    return b;
  };
}

export function planContextFor(records: readonly ComponentRecord[], view: ViewContext, fov: number, width: number, height: number, insets: Insets): PlanContext {
  return { bounds: unionBounds(records.filter((r) => r.system === "structure" || r.system === "architecture")), floorBounds: floorBoundsOf(records), view, fov, width, height, insets };
}

const view = (patch: Partial<ViewState> = {}, layers?: readonly LayerKey[]): ViewState => ({
  ...DEFAULT_VIEW,
  ...patch,
  ...(layers ? { layers: Object.fromEntries(LAYERS.map((l) => [l, layers.includes(l)])) as ViewState["layers"] } : {}),
});

const pose = (ctx: PlanContext, box: Box3, dir: V3, margin: number): Pose => {
  const p = frameBoxInto(box, dir, ctx.fov, ctx.width, ctx.height, ctx.insets, margin);
  return { position: p.position, target: p.target };
};

const ARCHITECTURE: readonly LayerKey[] = ["exteriorWalls", "interiorWalls", "openings", "flooring", "ceilings", "fixtures", "balconiesFacade", "roof"];

/** Typical floor: F02 sits in the middle of the five storeys. */
export const TYPICAL_FLOOR: FloorKey = "L2";
/** Top storey (the plan view looks into it with the roof removed). */
export const TOP_FLOOR: FloorKey = "L4";

export const PRESETS: readonly PresetDef[] = [
  {
    id: "hero",
    label: "Hero",
    hint: "Exterior axonometric from the south-east: entrance facade, balconies and east facade",
    plan: (ctx) => ({ view: view(), clip: null, pose: pose(ctx, aboveGrade(ctx.bounds), HERO_DIR, 1.08), explode: null }),
  },
  {
    id: "front",
    label: "Front",
    hint: "South elevation, straight on",
    plan: (ctx) => ({ view: view(), clip: null, pose: pose(ctx, aboveGrade(ctx.bounds), [0.05, 0.06, -1], 1.1), explode: null }),
  },
  {
    id: "plan",
    label: "Plan",
    hint: "Top storey plan: straight down with the roof and ceilings removed",
    plan: (ctx) => ({
      view: view({ floors: { ...DEFAULT_VIEW.floors, ROOF: false } }, ["structure", ...ARCHITECTURE.filter((l) => l !== "ceilings")]),
      clip: null,
      pose: pose(ctx, ctx.floorBounds(TOP_FLOOR), [0, 1, 0.0005], 1.1),
      explode: null,
    }),
  },
  {
    id: "floor",
    label: "Floor",
    hint: "One typical floor isolated, ceilings off",
    plan: (ctx) => ({
      view: view({ isolate: TYPICAL_FLOOR }),
      clip: null,
      pose: pose(ctx, ctx.floorBounds(TYPICAL_FLOOR), [0.62, 0.8, -0.85], 1.1),
      explode: null,
    }),
  },
  {
    id: "exploded",
    label: "Exploded",
    hint: "Floors separated vertically (A4)",
    plan: () => ({ view: view(), clip: null, explodeDirection: HERO_DIR, explode: { mode: "floors", preset: "full" } }),
  },
  {
    id: "mep",
    label: "MEP",
    hint: "Plumbing and electrical on one floor, building ghosted",
    plan: (ctx) => ({
      view: view({ isolate: "L1", xray: true }),
      clip: null,
      pose: pose(ctx, ctx.floorBounds("L1"), [0.55, 0.8, -0.85], 1.1),
      explode: null,
    }),
  },
  {
    id: "section",
    label: "Section",
    hint: "Building cut along a column gridline",
    plan: (ctx) => {
      const b = ctx.bounds;
      const cut: Box3 = { min: b.min, max: [b.max[0], b.max[1], ctx.view.sectionZ] };
      return { view: view(), clip: { axis: "z", value: ctx.view.sectionZ }, pose: pose(ctx, cut, [0.22, 0.2, 1], 1.1), explode: null };
    },
  },
];

export const presetById = (id: PresetId): PresetDef => PRESETS.find((p) => p.id === id)!;

// ───────────────────────────── guided demonstration ─────────────────────────────

/** Counts read from the real records (never typed in), used in the captions. */
export interface ModelFacts {
  readonly total: number;
  readonly bySystem: Readonly<Record<"structure" | "architecture" | "plumbing" | "electrical", number>>;
  readonly byType: ReadonlyMap<string, number>;
  /** Footprint (m) and height (m) of structure + architecture. */
  readonly size: readonly [number, number, number];
  readonly storeys: number;
}

export function modelFacts(records: readonly ComponentRecord[], bounds: Box3): ModelFacts {
  const bySystem = { structure: 0, architecture: 0, plumbing: 0, electrical: 0 };
  const byType = new Map<string, number>();
  const floors = new Set<number>();
  for (const r of records) {
    bySystem[r.system]++;
    byType.set(r.componentType, (byType.get(r.componentType) ?? 0) + 1);
    if (r.system === "structure" && r.floor >= 0 && r.floor < 5) floors.add(r.floor);
  }
  return { total: records.length, bySystem, byType, size: [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]], storeys: floors.size };
}

const n = (x: number) => x.toLocaleString("en-US");
const count = (f: ModelFacts, t: string) => f.byType.get(t) ?? 0;

export interface GuidedScene {
  readonly id: string;
  readonly label: string;
  plan(ctx: PlanContext): ScenePlan;
  /** One or two sentences, built from the real model. */
  caption(f: ModelFacts): string;
}

export interface GuidedStep {
  readonly id: string;
  readonly title: string;
  readonly scenes: readonly GuidedScene[];
}

const fromPreset = (id: PresetId, label: string, caption: GuidedScene["caption"], patch?: (p: ScenePlan, ctx: PlanContext) => ScenePlan): GuidedScene => ({
  id: `${id}:${label}`,
  label,
  plan: (ctx) => {
    // a guided scene states every drawer / colour choice explicitly (closed unless the scene opens one)
    const base: ScenePlan = { drawer: null, recoveryColour: false, ...presetById(id).plan(ctx) };
    return patch ? patch(base, ctx) : base;
  },
  caption,
});

export const GUIDED_STEPS: readonly GuidedStep[] = [
  {
    id: "overview",
    title: "Complete building",
    scenes: [
      fromPreset("hero", "Axonometric", (f) => `${f.storeys} storeys, ${f.size[0].toFixed(0)} × ${f.size[2].toFixed(0)} m on plan, ${f.size[1].toFixed(1)} m including foundations. ${n(f.total)} components, each with a stable ID.`),
      fromPreset("front", "South elevation", (f) => `The entrance facade: ${n(count(f, "window_assembly"))} windows, ${n(count(f, "door_assembly"))} doors and ${n(count(f, "balcony_assembly"))} balconies are modelled as assemblies of real parts.`),
    ],
  },
  {
    id: "structure",
    title: "Structure & architecture",
    scenes: [
      fromPreset("hero", "Structural frame", (f) => `RCC frame: ${n(count(f, "footing"))} footings, ${n(count(f, "column"))} columns, ${n(count(f, "beam"))} beams, ${n(count(f, "slab"))} slabs. Dimensions are model assumptions, not surveyed values.`, (p) => ({ ...p, view: view({}, ["structure"]) })),
      fromPreset("floor", "Typical floor", (f) => `One storey with its walls, openings, finishes and fixtures (${n(f.bySystem.architecture)} architectural components in the whole building).`),
      fromPreset("section", "Section", () => `The same model cut along a column gridline: slabs, beams, walls and finishes in their real positions.`),
    ],
  },
  {
    id: "exploded",
    title: "Exploded assembly",
    scenes: [
      fromPreset("exploded", "Floors", () => `Floors separated vertically (a display transform: records and quantities are unchanged).`),
      fromPreset("exploded", "Systems", () => `Structure, architecture, plumbing and electrical separated in plan so each system can be read on its own.`, (p) => ({ ...p, explode: { mode: "systems", preset: "full" } })),
      fromPreset("exploded", "Cinematic", () => `Floors, then systems, then assemblies, from one progress value. Play or scrub in the Exploded view panel.`, (p) => ({ ...p, explode: { mode: "cinematic", preset: "full", play: true } })),
    ],
  },
  {
    id: "mep",
    title: "Plumbing & electrical",
    scenes: [
      fromPreset("mep", "Both services", (f) => `${n(f.bySystem.plumbing)} plumbing and ${n(f.bySystem.electrical)} electrical components. Conceptual routing from the A3 model; not a design for construction.`),
      fromPreset("mep", "Plumbing", (f) => `Water supply, drainage, vents and rainwater: ${n(f.bySystem.plumbing)} components in total.`, (p) => ({ ...p, view: view({ isolate: "L1", xray: true }, ["structure", ...ARCHITECTURE, "plumbing"]) })),
      fromPreset("mep", "Electrical", (f) => `Distribution, lighting, power, trays and earthing: ${n(f.bySystem.electrical)} components in total.`, (p) => ({ ...p, view: view({ isolate: "L1", xray: true }, ["structure", ...ARCHITECTURE, "electrical"]) })),
    ],
  },
  {
    id: "recovery",
    title: "Inventory & recovery",
    scenes: [
      fromPreset("hero", "Material inventory", () => `Quantities taken off the geometry (B1): by material, floor and system. Each figure says whether it was calculated or estimated.`, (p) => ({ ...p, drawer: "inventory" })),
      fromPreset("hero", "Recovery assessment", () => `Reuse and recycling classifications (B2). Colours in the model show only assessments that have been entered; nothing is assumed.`, (p) => ({ ...p, drawer: "recovery", recoveryColour: true })),
    ],
  },
];
