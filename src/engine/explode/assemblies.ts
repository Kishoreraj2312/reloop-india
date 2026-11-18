/**
 * Assembly decomposition rules (A4): which assemblies can be taken apart, along which axis, and why the others cannot.
 *
 * Only ASSEMBLY RECORDS (group records) are used. Their membership is explicit containment: a member's `parentId`
 * is the group record and the member lies inside the group's envelope (census: 83,420 of 83,420 members). `dependencies`
 * (physical support, hosting, flow) and `connectedTo` (joints) are never read as membership. The wall-normal axis of an
 * opening is derived from the geometry of its host wall assembly, found through the explicit hosting dependency that A2
 * records for exactly this purpose; if there is no such host, from the opening's own envelope.
 *
 * Every assembly ends up in exactly one of two lists: a plan (supported) or an UnsupportedAssembly with a one-line reason.
 */

import { recordBounds, type ComponentRecord } from "@/building/structure";
import type { ExplodeConfig, FloorKey, Vec3 } from "./types";

export type DecompositionKind = "normal" | "envelope-normal" | "vertical" | "radial" | "none";

export interface AssemblyRule {
  readonly kind: DecompositionKind;
  /** Documents the rule (supported) or the reason there is none (kind "none"). */
  readonly why: string;
}

const VERTICAL = "members stack by height: layers along Y (build-up order)";
const NETWORK = "network container: its members run in every direction, so no single decomposition axis exists (stack and run segments already separate with their floors)";

/** Rule per assembly `componentType`. */
export const ASSEMBLY_RULES: Readonly<Record<string, AssemblyRule>> = {
  // openings: layers through the wall, along the host wall's normal
  window_assembly: { kind: "normal", why: "layers through the wall along the host wall's normal (outside to inside)" },
  door_assembly: { kind: "normal", why: "layers through the wall along the host wall's normal (outside to inside)" },
  cased_opening_assembly: { kind: "normal", why: "layers through the wall along the host wall's normal" },
  // build-ups and fixtures: layers along Y
  floor_finish_assembly: { kind: "vertical", why: "floor build-up: screed, tile, skirting (layers along Y)" },
  ceiling_assembly: { kind: "vertical", why: VERTICAL },
  ceiling_fixtures_assembly: { kind: "vertical", why: VERTICAL },
  kitchen_assembly: { kind: "vertical", why: VERTICAL },
  bathroom_assembly: { kind: "vertical", why: VERTICAL },
  utility_appliances_assembly: { kind: "vertical", why: VERTICAL },
  balcony_assembly: { kind: "vertical", why: VERTICAL },
  balcony_canopy_assembly: { kind: "vertical", why: VERTICAL },
  facade_assembly: { kind: "vertical", why: VERTICAL },
  plinth_assembly: { kind: "vertical", why: VERTICAL },
  entrance_assembly: { kind: "vertical", why: VERTICAL },
  stair_finish_assembly: { kind: "vertical", why: VERTICAL },
  parapet_assembly: { kind: "vertical", why: VERTICAL },
  shaft_upstand_assembly: { kind: "vertical", why: VERTICAL },
  roof_enclosure_assembly: { kind: "vertical", why: VERTICAL },
  roof_finish_assembly: { kind: "vertical", why: VERTICAL },
  roof_drain_assembly: { kind: "vertical", why: VERTICAL },
  // tiled room walls: panels move away from the room centre
  wall_tiling_assembly: { kind: "radial", why: "each wall's tile panels move away from the room centre in plan" },
  // distribution board: front-to-back parts
  distribution_board_assembly: { kind: "envelope-normal", why: "board parts layer along the board's depth (the thin horizontal axis of its envelope)" },
  // unsupported
  wall_assembly: { kind: "none", why: "the pieces of one wall tile a single plane: there is no layered build-up to take apart" },
  cold_water_assembly: { kind: "none", why: NETWORK },
  hot_water_assembly: { kind: "none", why: NETWORK },
  drainage_assembly: { kind: "none", why: NETWORK },
  vent_assembly: { kind: "none", why: NETWORK },
  rainwater_assembly: { kind: "none", why: NETWORK },
  sewer_assembly: { kind: "none", why: NETWORK },
  wiring_devices_assembly: { kind: "none", why: "devices are spread across the whole floor with no common axis" },
  conduits_assembly: { kind: "none", why: NETWORK },
  cables_assembly: { kind: "none", why: NETWORK },
  distribution_assembly: { kind: "none", why: NETWORK },
  earthing_assembly: { kind: "none", why: NETWORK },
  cable_tray_assembly: { kind: "none", why: NETWORK },
};
export const UNKNOWN_RULE: AssemblyRule = { kind: "none", why: "no decomposition rule is defined for this assembly type" };
export const STRUCTURE_REASON = "structural members are individual components with no assembly records: they group by floor, system and category only";

export interface AssemblyPlan {
  readonly id: string;
  readonly type: string;
  readonly floor: FloorKey;
  readonly kind: Exclude<DecompositionKind, "none">;
  /** "layers": members offset along `axis` by their layer index; "radial": members move away from the centre in plan. */
  readonly strategy: "layers" | "radial";
  readonly axis: Vec3 | null;
  readonly axisSource: string;
  readonly members: readonly string[];
  /** layers: number of distinct layers; radial: number of distinct directions. */
  readonly layerCount: number;
  /** Largest unit-vector length over the members (layers: half the layer span; radial: 1). */
  readonly maxUnit: number;
}

export interface UnsupportedAssembly {
  readonly id: string;
  readonly type: string;
  readonly floor: FloorKey;
  readonly members: number;
  readonly reason: string;
}

export interface AssemblyResult {
  readonly plan?: AssemblyPlan;
  /** Unit offset per member, aligned with plan.members. */
  readonly units?: readonly Vec3[];
  readonly unsupported?: UnsupportedAssembly;
}

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

const centreOf = (r: ComponentRecord): Vec3 => {
  const b = recordBounds(r);
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
};

/** Single-linkage layers: values whose sorted neighbours differ by at most `tol` share a layer. Deterministic. */
export function clusterLayers(values: readonly number[], tol: number): { layer: number[]; count: number } {
  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]! || a - b);
  const layer = new Array<number>(values.length).fill(0);
  if (!order.length) return { layer, count: 0 };
  let l = 0;
  let prev = values[order[0]!]!;
  for (const i of order) {
    const v = values[i]!;
    if (v - prev > tol) l++;
    layer[i] = l;
    prev = v;
  }
  return { layer, count: l + 1 };
}

/** The thin horizontal axis of an envelope, or null when its two horizontal sizes are within 10 %. */
function thinHorizontalAxis(size: Vec3): Vec3 | null {
  const [sx, , sz] = size;
  if (Math.abs(sx - sz) <= 0.1 * Math.max(sx, sz)) return null;
  return sx < sz ? X : Z;
}

function wallNormal(g: ComponentRecord, byId: ReadonlyMap<string, ComponentRecord>): { axis: Vec3; source: string } | null {
  for (const d of g.dependencies) {
    const host = byId.get(d);
    if (host && host.geometry.kind === "group" && host.componentType === "wall_assembly") {
      const axis = thinHorizontalAxis(host.geometry.size);
      if (axis) return { axis, source: `host wall ${host.id}` };
    }
  }
  if (g.geometry.kind === "group") {
    const axis = thinHorizontalAxis(g.geometry.size);
    if (axis) return { axis, source: "own envelope (no host wall assembly)" };
  }
  return null;
}

/** Decide one assembly. `kids` are its members (drawn leaves). */
export function planAssembly(g: ComponentRecord, kids: readonly ComponentRecord[], floor: FloorKey, byId: ReadonlyMap<string, ComponentRecord>, cfg: ExplodeConfig): AssemblyResult {
  const rule = ASSEMBLY_RULES[g.componentType] ?? UNKNOWN_RULE;
  const no = (reason: string): AssemblyResult => ({ unsupported: { id: g.id, type: g.componentType, floor, members: kids.length, reason } });
  if (rule.kind === "none") return no(rule.why);
  if (g.geometry.kind !== "group") return no("not an assembly record");
  if (kids.length < 2) return no("fewer than two members");
  const centres = kids.map(centreOf);
  const a = cfg.assembly;

  if (rule.kind === "radial") {
    const c = g.originalPosition;
    const [sx, , sz] = g.geometry.size;
    const fallback: Vec3 = sx >= sz ? X : Z; // the longer horizontal axis of the envelope: the group's default axis
    const units: Vec3[] = centres.map((m) => {
      const dx = m[0] - c[0];
      const dz = m[2] - c[2];
      const len = Math.hypot(dx, dz);
      return len >= a.radialMinDistance ? [dx / len, 0, dz / len] : fallback;
    });
    const distinct = new Set(units.map((u) => `${u[0].toFixed(3)}|${u[2].toFixed(3)}`)).size;
    if (distinct < 2) return no("every member lies in the same direction from the centre");
    return { plan: { id: g.id, type: g.componentType, floor, kind: "radial", strategy: "radial", axis: null, axisSource: "assembly centre (plan)", members: kids.map((k) => k.id), layerCount: distinct, maxUnit: 1 }, units };
  }

  let axis: Vec3;
  let source: string;
  if (rule.kind === "vertical") {
    axis = Y;
    source = "vertical (Y)";
  } else if (rule.kind === "normal") {
    const n = wallNormal(g, byId);
    if (!n) return no("the wall normal is ambiguous (host wall and envelope are square in plan)");
    axis = n.axis;
    source = n.source;
  } else {
    const n = thinHorizontalAxis(g.geometry.size);
    if (!n) return no("the board's depth axis is ambiguous (square in plan)");
    axis = n;
    source = "own envelope (thin horizontal axis)";
  }
  const proj = centres.map((m) => m[0] * axis[0] + m[1] * axis[1] + m[2] * axis[2]);
  const { layer, count } = clusterLayers(proj, a.layerTolerance);
  if (count < a.minLayers) return no(`all members share one layer along ${source === "vertical (Y)" ? "Y" : "the axis"} (nothing to separate)`);
  const mid = (count - 1) / 2;
  const units: Vec3[] = layer.map((l) => [axis[0] * (l - mid), axis[1] * (l - mid), axis[2] * (l - mid)] as const);
  return { plan: { id: g.id, type: g.componentType, floor, kind: rule.kind, strategy: "layers", axis, axisSource: source, members: kids.map((k) => k.id), layerCount: count, maxUnit: mid }, units };
}
