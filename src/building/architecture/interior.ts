/**
 * Shared interior geometry for a storey (A2 stage 3): wall boundaries, room clear rectangles,
 * column footprints and the openings on each room side. Finishes, ceilings, tiling and
 * fixtures all derive from this, so they agree with the walls exactly.
 */

import type { BuildingConfig } from "../config";
import { ARCH_CONFIG, archDatums, type ArchitectureConfig, type ArchDatums } from "./config";
import { clearRect, floorBoundaries, type Boundary } from "./boundaries";
import type { FloorPlan, PlanRoom, Side } from "./plan";
import { EPS, intersect, overlaps, subtractAll, type PlanRect } from "./rect";
import { columnRects } from "./validatePlan";
import { wellFootprint } from "./stairwell";

export interface RoomSideOpening {
  readonly s0: number;
  readonly s1: number;
  readonly kind: "door" | "window" | "open";
  readonly top: number; // y of the opening head (open boundaries: wall top)
  readonly bottom: number; // y of the opening bottom
}

export interface InteriorRoom {
  readonly room: PlanRoom;
  /** Clear rectangle per boundary rect (finished wall faces). */
  readonly clears: readonly PlanRect[];
  /** Clear area minus columns and other excluded zones: the finishable floor. */
  readonly floor: readonly PlanRect[];
  /** Columns protruding into the clear area (clipped to it). */
  readonly columns: readonly PlanRect[];
}

export interface InteriorContext {
  readonly plan: FloorPlan;
  readonly cfg: BuildingConfig;
  readonly arch: ArchitectureConfig;
  readonly d: ArchDatums;
  readonly bounds: readonly Boundary[];
  readonly cols: readonly PlanRect[];
  readonly rooms: ReadonlyMap<string, InteriorRoom>;
  /** Openings along a room's clear-rect side (doors, windows, open boundaries). */
  sideOpenings(roomId: string, clear: PlanRect, side: Side): RoomSideOpening[];
}

/** Rooms that get no interior finishes (the shaft is a void lined only by its walls). */
export const UNFINISHED = new Set(["shaft"]);

export function interiorContext(plan: FloorPlan, cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): InteriorContext {
  const d = archDatums(cfg, arch);
  const bounds = floorBoundaries(plan, arch);
  const cols = columnRects(cfg, plan.storey);
  const stairRect = wellFootprint(cfg, arch); // stair well + its lining walls
  const rooms = new Map<string, InteriorRoom>();
  for (const room of plan.rooms) {
    const clears = room.rects.map((r) => clearRect(r, room.id, bounds, cfg));
    const exclude = room.type === "stair" ? [...cols, stairRect] : cols;
    const floor = clears.flatMap((c) => subtractAll(c, exclude));
    const columns = clears.flatMap((c) => cols.map((k) => intersect(k, c)).filter((x): x is PlanRect => x !== null));
    rooms.set(room.id, { room, clears, floor, columns });
  }
  const ffl = d.ffl(plan.storey);
  const sideOpenings = (roomId: string, clear: PlanRect, side: Side): RoomSideOpening[] => {
    const room = rooms.get(roomId)!.room;
    const out: RoomSideOpening[] = [];
    const axis = side === "N" || side === "S" ? "x" : "z";
    // The room rect whose clear rect this is: the boundary line lies just outside the clear face.
    const idx = rooms.get(roomId)!.clears.indexOf(clear);
    const rr = room.rects[idx >= 0 ? idx : 0]!;
    const c = side === "S" ? rr.z0 : side === "N" ? rr.z1 : side === "W" ? rr.x0 : rr.x1;
    const [lo, hi] = axis === "x" ? [clear.x0, clear.x1] : [clear.z0, clear.z1];
    for (const dr of plan.doors) {
      if (dr.line.axis !== axis || Math.abs(dr.line.c - c) > EPS) continue;
      if (!dr.rooms.includes(roomId)) continue;
      const s0 = dr.centre - dr.width / 2;
      const s1 = dr.centre + dr.width / 2;
      if (s1 > lo + EPS && s0 < hi - EPS) out.push({ s0, s1, kind: "door", bottom: d.slabTop(plan.storey), top: ffl + dr.height });
    }
    for (const w of plan.windows) {
      if (w.roomId !== roomId || w.line.axis !== axis || Math.abs(w.line.c - c) > EPS) continue;
      const t = arch.windowTypes[w.typeKey];
      const s0 = w.centre - t.width / 2 - arch.openings.revealWidth;
      const s1 = w.centre + t.width / 2 + arch.openings.revealWidth;
      out.push({ s0, s1, kind: "window", bottom: ffl + t.sill - arch.openings.stoneSill.thickness, top: ffl + t.sill + t.height });
    }
    for (const b of bounds) {
      if (b.kind !== "open" || b.line.axis !== axis || Math.abs(b.line.c - c) > EPS) continue;
      if (b.low !== roomId && b.high !== roomId) continue;
      if (b.s1 > lo + EPS && b.s0 < hi - EPS) out.push({ s0: b.s0, s1: b.s1, kind: "open", bottom: d.slabTop(plan.storey), top: d.wallTop(plan.storey) });
    }
    // Sides that coincide with another rect of the same room (L-shaped rooms) are open too.
    for (const other of room.rects) {
      if (other === rr) continue;
      const touch = axis === "x" ? (Math.abs(other.z0 - c) < EPS || Math.abs(other.z1 - c) < EPS) : Math.abs(other.x0 - c) < EPS || Math.abs(other.x1 - c) < EPS;
      if (!touch) continue;
      const [o0, o1] = axis === "x" ? [other.x0, other.x1] : [other.z0, other.z1];
      if (o1 > lo + EPS && o0 < hi - EPS) out.push({ s0: o0, s1: o1, kind: "open", bottom: d.slabTop(plan.storey), top: d.wallTop(plan.storey) });
    }
    return out.sort((p, q) => p.s0 - q.s0);
  };
  return { plan, cfg, arch, d, bounds, cols, rooms, sideOpenings };
}

/** Intervals [lo, hi] minus the given intervals, as disjoint pieces (min length eps). */
export function intervalMinus(lo: number, hi: number, cuts: readonly (readonly [number, number])[], eps = 1e-6): [number, number][] {
  let pieces: [number, number][] = [[lo, hi]];
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = [];
    for (const [a, b] of pieces) {
      if (c1 <= a || c0 >= b) {
        next.push([a, b]);
        continue;
      }
      if (c0 - a > eps) next.push([a, c0]);
      if (b - c1 > eps) next.push([c1, b]);
    }
    pieces = next;
  }
  return pieces.filter(([a, b]) => b - a > eps);
}

/** Column rects (plan) overlapping a strip, projected onto the strip's axis. */
export function columnCuts(strip: PlanRect, cols: readonly PlanRect[], axis: "x" | "z"): [number, number][] {
  return cols.filter((c) => overlaps(c, strip)).map((c) => (axis === "x" ? [c.x0, c.x1] : [c.z0, c.z1]) as [number, number]);
}
