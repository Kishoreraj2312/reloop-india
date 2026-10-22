/**
 * Bounds helpers over ComponentRecords, used by the viewer framing and by tests.
 */

import type { ComponentRecord, Point2 } from "./geometry";

export interface Box3 {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** World-space axis-aligned bounds of a record's geometry. */
export function recordBounds(r: ComponentRecord): Box3 {
  const [px, py, pz] = r.originalPosition;
  const g = r.geometry;
  if (g.kind === "box") {
    const [sx, sy, sz] = g.size;
    return {
      min: [px - sx / 2, py - sy / 2, pz - sz / 2],
      max: [px + sx / 2, py + sy / 2, pz + sz / 2],
    };
  }
  const us = g.profile.map((p) => p[0]);
  const vs = g.profile.map((p) => p[1]);
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const h = g.extent / 2;
  return g.plane === "xz"
    ? { min: [px + u0, py - h, pz + v0], max: [px + u1, py + h, pz + v1] }
    : { min: [px - h, py + v0, pz + u0], max: [px + h, py + v1, pz + u1] };
}

/** Decompose a rectilinear (x, z) polygon into non-overlapping axis-aligned cells. */
function rectilinearCells(profile: readonly Point2[]): Array<[number, number, number, number]> {
  const xs = [...new Set(profile.map((p) => p[0]))].sort((a, b) => a - b);
  const zs = [...new Set(profile.map((p) => p[1]))].sort((a, b) => a - b);
  const inside = (x: number, z: number): boolean => {
    let c = false;
    for (let i = 0, j = profile.length - 1; i < profile.length; j = i++) {
      const [xi, zi] = profile[i]!;
      const [xj, zj] = profile[j]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const cells: Array<[number, number, number, number]> = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const [xa, xb, za, zb] = [xs[i]!, xs[i + 1]!, zs[j]!, zs[j + 1]!];
      if (inside((xa + xb) / 2, (za + zb) / 2)) cells.push([xa, za, xb, zb]);
    }
  }
  return cells;
}

/**
 * Solid volume as a set of boxes. Exact for boxes and plan (xz) prisms, which are
 * rectilinear. "zy" prisms (stair flights) return their bounding box: a conservative
 * (never under-reporting) stand-in used for overlap checks.
 */
export function recordSolids(r: ComponentRecord): Box3[] {
  const g = r.geometry;
  if (g.kind === "prism" && g.plane === "xz") {
    const [px, py, pz] = r.originalPosition;
    const h = g.extent / 2;
    return rectilinearCells(g.profile).map(([xa, za, xb, zb]) => ({
      min: [px + xa, py - h, pz + za] as const,
      max: [px + xb, py + h, pz + zb] as const,
    }));
  }
  return [recordBounds(r)];
}
