/**
 * Bounds helpers over ComponentRecords, used by the viewer framing and by tests.
 */

import type { ComponentRecord, Point2 } from "./geometry";

export interface Box3 {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** Local (unrotated) half extents of a centred box-like descriptor. */
function halfExtents(g: ComponentRecord["geometry"]): [number, number, number] | null {
  switch (g.kind) {
    case "box":
    case "group":
    case "part":
      return [g.size[0] / 2, g.size[1] / 2, g.size[2] / 2];
    case "cylinder": {
      const r = g.radius;
      const h = g.height / 2;
      return g.axis === "x" ? [h, r, r] : g.axis === "y" ? [r, h, r] : [r, r, h];
    }
    default:
      return null;
  }
}

/** Rotation matrix for Euler XYZ (three.js default order), row-major. */
function eulerXYZ([a, b, c]: readonly [number, number, number]): number[][] {
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
}

/** World-space axis-aligned bounds of a record's geometry (rotation included). */
export function recordBounds(r: ComponentRecord): Box3 {
  const [px, py, pz] = r.originalPosition;
  const g = r.geometry;
  const he = halfExtents(g);
  if (he) {
    const rot = r.originalRotation;
    if (rot[0] === 0 && rot[1] === 0 && rot[2] === 0) {
      return { min: [px - he[0], py - he[1], pz - he[2]], max: [px + he[0], py + he[1], pz + he[2]] };
    }
    const m = eulerXYZ(rot);
    // Half extent of the rotated box along each world axis: sum |m_ij| * he_j
    const w = m.map((row) => Math.abs(row[0]!) * he[0] + Math.abs(row[1]!) * he[1] + Math.abs(row[2]!) * he[2]);
    return { min: [px - w[0]!, py - w[1]!, pz - w[2]!], max: [px + w[0]!, py + w[1]!, pz + w[2]!] };
  }
  if (g.kind !== "prism") throw new Error(`unhandled geometry ${g.kind}`);
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
 * Solid volume as a set of boxes. Exact for unrotated boxes and plan (xz) prisms, which
 * are rectilinear. "zy" prisms (stair flights), cylinders and rotated boxes return their
 * bounding box: a conservative (never under-reporting) stand-in used for overlap checks.
 * Groups (assemblies) have no solid of their own.
 */
export function recordSolids(r: ComponentRecord): Box3[] {
  const g = r.geometry;
  if (g.kind === "group") return [];
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
