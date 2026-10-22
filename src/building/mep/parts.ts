/**
 * ReLoop India — MEP part catalogue (A3).
 *
 * A part is drawn from one shared unit mesh fitted to its record box (geometry kind
 * "part"). This module is the single source of every part's proportions: the generators
 * use it to size and place record boxes, the viewer (scene/mep/partGeometry.ts) builds the
 * unit meshes from the same numbers, so a drawn part always fills its record box exactly.
 *
 * Local frames
 * - Fittings are sized from the pipe radius r (all proportions in multiples of r) and
 *   anchored on the route node (the point where pipe centrelines meet):
 *     elbow / bend traps: legs along local +X and +Y
 *     tee / junction box: run along local ±X, branch along +Y
 *     inline (valves, meters, cleanouts): body along local X, handle/dial toward +Y
 *     end parts (caps, cowls): the pipe arrives along local +X (network on +X side)
 * - Wall devices: local X along the wall, +Y up, +Z out of the wall into the room; the
 *   anchor is the finished wall face at the device centre.
 * - Equipment standing on a surface: anchored at the centre of the bottom face.
 */

import type { Vec3 } from "../structure";

/** Hub radius and leg length of fittings, in pipe radii. */
export const FIT = { hub: 1.32, leg: 2.7 } as const;

export type FittingPart =
  | "elbow"
  | "tee"
  | "cap"
  | "valve-gate"
  | "valve-ball"
  | "valve-check"
  | "valve-float"
  | "meter-water"
  | "trap-bottle"
  | "trap-floor"
  | "cleanout"
  | "cowl"
  | "jb"
  | "bend-conduit";

/** Local box [lo, hi] of a fitting for pipe radius r, relative to its node. */
export function fittingBox(part: FittingPart, r: number): { lo: Vec3; hi: Vec3 } {
  const h = FIT.hub * r;
  const L = FIT.leg * r;
  const b = (lo: [number, number, number], hi: [number, number, number]) => ({ lo: lo.map((v) => v * r) as unknown as Vec3, hi: hi.map((v) => v * r) as unknown as Vec3 });
  switch (part) {
    case "elbow":
      return { lo: [-h, -h, -h], hi: [L, L, h] };
    case "bend-conduit":
      // Conduit bends are slimmer (no solvent sockets).
      return b([-1.15, -1.15, -1.15], [3.2, 3.2, 1.15]);
    case "tee":
      return { lo: [-L, -h, -h], hi: [L, L, h] };
    case "cap":
      return b([-0.7, -FIT.hub, -FIT.hub], [FIT.leg, FIT.hub, FIT.hub]);
    case "valve-gate":
      return b([-2.8, -1.45, -2.3], [2.8, 6.0, 2.3]);
    case "valve-ball":
      return b([-2.5, -1.45, -1.45], [5.4, 3.0, 1.45]);
    case "valve-check":
      return b([-3.0, -1.7, -1.7], [3.0, 2.9, 1.7]);
    case "valve-float":
      return b([-12, -5.5, -2.6], [FIT.leg, 1.6, 2.6]);
    case "meter-water":
      return b([-3.4, -1.7, -1.9], [3.4, 3.9, 1.9]);
    case "trap-bottle":
      return b([-1.7, -3.6, -1.7], [FIT.leg, FIT.leg, 1.7]);
    case "trap-floor":
      return b([-2.3, -2.6, -2.3], [Math.max(FIT.leg, 2.3), FIT.leg, 2.3]);
    case "cleanout":
      return b([-2.5, -1.3, -1.3], [2.5, 2.4, 1.3]);
    case "cowl":
      return b([-2.4, -2.1, -2.1], [1.4, 2.1, 2.1]);
    case "jb":
      // Round junction box: run along X, branch +Y; the box is a short drum about local Z.
      return b([-3.3, -3.3, -1.6], [3.3, 3.3, 1.6]);
  }
}

/** Solid fraction of the record box (volume estimate for Part B; quantities are counts). */
export const PART_FILL: Readonly<Record<string, number>> = {
  elbow: 0.18,
  "bend-conduit": 0.15,
  tee: 0.22,
  cap: 0.5,
  "valve-gate": 0.2,
  "valve-ball": 0.25,
  "valve-check": 0.35,
  "valve-float": 0.08,
  "meter-water": 0.3,
  "trap-bottle": 0.3,
  "trap-floor": 0.35,
  cleanout: 0.45,
  cowl: 0.3,
  jb: 0.45,
  "switch-plate": 0.6,
  "socket-plate": 0.6,
  db: 0.7,
  "fdb": 0.7,
  "mcb": 0.8,
  "panel": 0.75,
  "meter-board": 0.6,
  "meter-elec": 0.8,
  bulkhead: 0.5,
  geyser: 0.65,
  "tank-hdpe": 0.06, // shell volume (hollow tank)
  pump: 0.45,
  "pump-panel": 0.7,
  "feeder-pillar": 0.7,
  chamber: 0.25,
  manhole: 0.25,
  "recharge-pit": 0.2,
  "earth-pit": 0.3,
  "earth-bar": 0.5,
  "manhole-cover": 0.5,
  tray: 0.06,
  "tray-node": 0.08,
};

/** Fixed-size parts: canonical size (x, y, z) and the box centre relative to the anchor. */
export interface FixedPartSpec {
  readonly size: Vec3;
  readonly centre: Vec3;
}

const wall = (w: number, h: number, back: number, front: number): FixedPartSpec => ({ size: [w, h, back + front], centre: [0, 0, (front - back) / 2] });
const floor = (w: number, h: number, d: number): FixedPartSpec => ({ size: [w, h, d], centre: [0, h / 2, 0] });

export const FIXED_PARTS = {
  // Wall devices (flush): back box in the wall, plate proud of the face
  "switch-plate": wall(0.19, 0.115, 0.045, 0.012),
  "socket-plate": wall(0.125, 0.09, 0.045, 0.012),
  "socket-16a": wall(0.14, 0.115, 0.05, 0.014),
  db: wall(0.36, 0.43, 0.085, 0.022),
  fdb: wall(0.44, 0.52, 0.0, 0.13),
  "earth-bar": wall(0.32, 0.06, 0.0, 0.045),
  bulkhead: wall(0.28, 0.17, 0.0, 0.095),
  geyser: wall(0.38, 0.56, 0.0, 0.4),
  "pump-panel": wall(0.46, 0.62, 0.0, 0.2),
  "meter-board": wall(2.3, 1.15, 0.0, 0.22),
  // Free-standing equipment (anchor: bottom centre, local +Z = front)
  panel: floor(1.0, 1.9, 0.45),
  "tank-hdpe": floor(1.85, 2.05, 1.85),
  pump: floor(0.78, 0.44, 0.34),
  "feeder-pillar": floor(0.9, 1.25, 0.42),
  // Below-grade chambers (anchor: centre of the cover top; the body hangs below)
  chamber: { size: [0.76, 0.95, 0.76], centre: [0, -0.475 + 0.04, 0] },
  manhole: { size: [1.2, 1.5, 1.2], centre: [0, -0.75 + 0.05, 0] },
  "recharge-pit": { size: [1.5, 2.2, 1.5], centre: [0, -1.1 + 0.06, 0] },
  "earth-pit": { size: [0.46, 0.65, 0.46], centre: [0, -0.325 + 0.06, 0] },
  "manhole-cover": { size: [0.72, 0.06, 0.72], centre: [0, 0.03, 0] },
  // Small items inside enclosures
  mcb: { size: [0.0175, 0.085, 0.068], centre: [0, 0, 0] },
  "meter-elec": { size: [0.13, 0.2, 0.09], centre: [0, 0, 0] },
} as const satisfies Record<string, FixedPartSpec>;

export type FixedPart = keyof typeof FIXED_PARTS;

/** Cable tray cross-section (U channel): straight pieces run along local X. */
export const TRAY = { width: 0.3, depth: 0.075, sheet: 0.0025 } as const;
