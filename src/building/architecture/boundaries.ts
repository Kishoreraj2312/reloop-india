/**
 * Room boundaries and the wall kind on each (A2).
 *
 * Every room-rectangle edge on a floor is cut into elementary intervals; each interval has
 * at most one room on its low side and one on its high side (rooms are disjoint). The pair
 * decides the wall:
 *   no room on one side         -> exterior  (0.23, outer face flush with column outer face)
 *   same room / open pair       -> none / open
 *   corridor, stair, services,
 *   shaft on either side        -> core      (0.23, centred)
 *   different apartments        -> party     (0.23, centred)
 *   same apartment              -> partition (0.115, centred)
 */

import type { BuildingConfig } from "../config";
import { ARCH_CONFIG, type ArchitectureConfig } from "./config";
import type { FloorPlan, PlanLine, PlanRoom } from "./plan";
import { EPS, type PlanRect } from "./rect";

export type WallKind = "exterior" | "core" | "party" | "partition";
export type BoundaryKind = WallKind | "open" | "none";

export interface Boundary {
  readonly line: PlanLine;
  readonly s0: number;
  readonly s1: number;
  /** Room on the low-coordinate side of the line (x < c for axis "z", z < c for axis "x"). */
  readonly low: string | null;
  readonly high: string | null;
  readonly kind: BoundaryKind;
  readonly thickness: number;
}

const CORE_TYPES = new Set(["corridor", "stair", "services", "shaft"]);

export function wallThickness(kind: BoundaryKind, arch: ArchitectureConfig = ARCH_CONFIG): number {
  switch (kind) {
    case "exterior":
      return arch.walls.exterior;
    case "core":
    case "party":
      return arch.walls.core;
    case "partition":
      return arch.walls.partition;
    default:
      return 0;
  }
}

function classify(a: PlanRoom | undefined, b: PlanRoom | undefined, open: ReadonlySet<string>): BoundaryKind {
  if (!a || !b) return "exterior";
  if (a.id === b.id) return "none";
  if (open.has(`${a.id}|${b.id}`) || open.has(`${b.id}|${a.id}`)) return "open";
  if (CORE_TYPES.has(a.type) || CORE_TYPES.has(b.type)) return "core";
  if (a.aptId !== b.aptId) return "party";
  return "partition";
}

const key = (axis: string, c: number) => `${axis}:${c.toFixed(6)}`;

export function floorBoundaries(plan: FloorPlan, arch: ArchitectureConfig = ARCH_CONFIG): Boundary[] {
  const open = new Set(plan.open.map(([a, b]) => `${a}|${b}`));
  const rooms = new Map(plan.rooms.map((r) => [r.id, r]));
  // Edges grouped by line: [s0, s1, room on low side?, room on high side?]
  const lines = new Map<string, { line: PlanLine; edges: { s0: number; s1: number; low?: string; high?: string }[] }>();
  const add = (line: PlanLine, s0: number, s1: number, side: "low" | "high", room: string) => {
    const k = key(line.axis, line.c);
    let e = lines.get(k);
    if (!e) lines.set(k, (e = { line, edges: [] }));
    e.edges.push({ s0, s1, [side]: room });
  };
  for (const r of plan.rooms) {
    for (const rc of r.rects) {
      add({ axis: "x", c: rc.z0 }, rc.x0, rc.x1, "high", r.id); // room is above its z0 edge
      add({ axis: "x", c: rc.z1 }, rc.x0, rc.x1, "low", r.id);
      add({ axis: "z", c: rc.x0 }, rc.z0, rc.z1, "high", r.id);
      add({ axis: "z", c: rc.x1 }, rc.z0, rc.z1, "low", r.id);
    }
  }
  const out: Boundary[] = [];
  const sortedKeys = [...lines.keys()].sort();
  for (const k of sortedKeys) {
    const { line, edges } = lines.get(k)!;
    const cuts = [...new Set(edges.flatMap((e) => [e.s0, e.s1]))].sort((p, q) => p - q);
    let run: { s0: number; s1: number; low: string | null; high: string | null; kind: BoundaryKind } | null = null;
    const flush = () => {
      if (run && run.kind !== "none") out.push({ line, ...run, thickness: wallThickness(run.kind, arch) });
      run = null;
    };
    for (let i = 0; i < cuts.length - 1; i++) {
      const [s0, s1] = [cuts[i]!, cuts[i + 1]!];
      if (s1 - s0 <= EPS) continue;
      const mid = (s0 + s1) / 2;
      const cover = edges.filter((e) => e.s0 < mid && e.s1 > mid);
      if (cover.length === 0) {
        flush();
        continue;
      }
      const low = cover.find((e) => e.low)?.low ?? null;
      const high = cover.find((e) => e.high)?.high ?? null;
      const kind = classify(low ? rooms.get(low) : undefined, high ? rooms.get(high) : undefined, open);
      const cur = run as { s0: number; s1: number; low: string | null; high: string | null; kind: BoundaryKind } | null;
      if (cur && cur.low === low && cur.high === high && cur.kind === kind && Math.abs(cur.s1 - s0) < EPS) cur.s1 = s1;
      else {
        flush();
        run = { s0, s1, low, high, kind };
      }
    }
    flush();
  }
  return out;
}

/** Half-thickness of the column (exterior walls are flush with the column outer face). */
export function exteriorOffset(cfg: BuildingConfig): { x: number; z: number } {
  return { x: cfg.column.width / 2, z: cfg.column.depth / 2 };
}

/**
 * Plan rectangle occupied by a wall on a boundary run (before trimming at junctions and
 * columns). Exterior walls sit inside the outline: outer face at the column outer face.
 */
export function wallFootprint(b: Boundary, cfg: BuildingConfig, s0 = b.s0, s1 = b.s1): PlanRect {
  const t = b.thickness;
  const off = exteriorOffset(cfg);
  if (b.kind === "exterior") {
    // Outward normal: the side with no room.
    const outward = b.low === null ? -1 : 1;
    const o = b.line.axis === "x" ? off.z : off.x;
    const outer = b.line.c + outward * o;
    const inner = outer - outward * t;
    const [c0, c1] = [Math.min(outer, inner), Math.max(outer, inner)];
    return b.line.axis === "x" ? { x0: s0, x1: s1, z0: c0, z1: c1 } : { x0: c0, x1: c1, z0: s0, z1: s1 };
  }
  return b.line.axis === "x"
    ? { x0: s0, x1: s1, z0: b.line.c - t / 2, z1: b.line.c + t / 2 }
    : { x0: b.line.c - t / 2, x1: b.line.c + t / 2, z0: s0, z1: s1 };
}

/** How far a boundary's wall reaches past the boundary line into an adjoining room (0 for open). */
export function intrusion(b: Boundary, cfg: BuildingConfig): number {
  if (b.kind === "open" || b.kind === "none") return 0;
  if (b.kind === "exterior") {
    const o = b.line.axis === "x" ? cfg.column.depth / 2 : cfg.column.width / 2;
    return Math.max(0, b.thickness - o);
  }
  return b.thickness / 2;
}

/**
 * Clear (finished-face) rectangle of a room rect: each side inset by the deepest wall on
 * that side. Columns protruding beyond the wall faces are not subtracted here.
 */
export function clearRect(r: PlanRect, roomId: string, bounds: readonly Boundary[], cfg: BuildingConfig): PlanRect {
  const sideInset = (axis: "x" | "z", c: number, s0: number, s1: number, side: "low" | "high") => {
    let d = 0;
    for (const b of bounds) {
      if (b.line.axis !== axis || Math.abs(b.line.c - c) > EPS) continue;
      if (Math.min(b.s1, s1) - Math.max(b.s0, s0) <= EPS) continue;
      if ((side === "low" ? b.low : b.high) !== roomId) continue;
      d = Math.max(d, intrusion(b, cfg));
    }
    return d;
  };
  return {
    x0: r.x0 + sideInset("z", r.x0, r.z0, r.z1, "high"),
    x1: r.x1 - sideInset("z", r.x1, r.z0, r.z1, "low"),
    z0: r.z0 + sideInset("x", r.z0, r.x0, r.x1, "high"),
    z1: r.z1 - sideInset("x", r.z1, r.x0, r.x1, "low"),
  };
}

/** Boundary run containing [s0, s1] on a line (used to find the wall hosting an opening). */
export function boundaryAt(bounds: readonly Boundary[], line: PlanLine, s0: number, s1: number): Boundary | undefined {
  return bounds.find(
    (b) => b.line.axis === line.axis && Math.abs(b.line.c - line.c) < EPS && b.s0 <= s0 + 1e-6 && b.s1 >= s1 - 1e-6,
  );
}
