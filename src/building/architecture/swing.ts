/**
 * Door swing arcs (plan): a quarter disc centred on the hinge pivot, radius = leaf width,
 * spanning from the closed leaf (along the wall) to fully open (perpendicular, into the
 * swing room). Used for clearance checks against fixtures, walls and other doors.
 */

import type { BuildingConfig } from "../config";
import { ARCH_CONFIG, type ArchitectureConfig } from "./config";
import { boundaryAt, intrusion, type Boundary } from "./boundaries";
import type { PlanDoor } from "./plan";
import { intersect, type PlanRect } from "./rect";

export interface SwingArc {
  readonly doorKey: string;
  readonly px: number; // pivot (plan x, z)
  readonly pz: number;
  readonly r: number;
  readonly sx: 1 | -1; // quadrant direction
  readonly sz: 1 | -1;
}

/** Clear leaf width: opening minus both frame jambs and gaps; split between leaves. */
export function leafWidth(d: PlanDoor, leaves: number, arch: ArchitectureConfig = ARCH_CONFIG): number {
  const f = arch.frames.door;
  return (d.width - 2 * f.jamb - 2 * arch.openings.fitTolerance - (leaves + 1) * f.leafGap) / leaves;
}

/** Arcs of a door (one per leaf; none for cased openings). */
export function swingArcs(d: PlanDoor, bounds: readonly Boundary[], cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): SwingArc[] {
  const t = arch.doorTypes[d.typeKey];
  if (t.leaves === 0) return [];
  const host = boundaryAt(bounds, d.line, d.centre - d.width / 2, d.centre + d.width / 2);
  // Into the swing room: side S/W means the room lies at +z/+x of the line. The pivot sits
  // on the wall face on that side (intrusion = how far the wall reaches past the line).
  const perp: 1 | -1 = d.side === "S" || d.side === "W" ? 1 : -1;
  const faceOffset = perp * (host ? intrusion(host, cfg) : 0);
  const w = leafWidth(d, t.leaves, arch);
  const jamb = arch.frames.door.jamb + arch.openings.fitTolerance;
  const ends: { pivot: number; dir: 1 | -1 }[] = [];
  const lo = d.centre - d.width / 2;
  const hi = d.centre + d.width / 2;
  if (t.leaves === 2) ends.push({ pivot: lo + jamb, dir: 1 }, { pivot: hi - jamb, dir: -1 });
  else if (d.hingeAt <= d.centre) ends.push({ pivot: lo + jamb, dir: 1 });
  else ends.push({ pivot: hi - jamb, dir: -1 });
  return ends.map(({ pivot, dir }) =>
    d.line.axis === "x"
      ? { doorKey: d.key, px: pivot, pz: d.line.c + faceOffset, r: w, sx: dir, sz: perp }
      : { doorKey: d.key, px: d.line.c + faceOffset, pz: pivot, r: w, sx: perp, sz: dir },
  );
}

/** Bounding square of the quarter disc. */
export function arcBox(a: SwingArc): PlanRect {
  const x1 = a.px + a.sx * a.r;
  const z1 = a.pz + a.sz * a.r;
  return { x0: Math.min(a.px, x1), x1: Math.max(a.px, x1), z0: Math.min(a.pz, z1), z1: Math.max(a.pz, z1) };
}

/** True if a rectangle intrudes into the swept quarter disc (positive area, tolerance `eps`). */
export function arcHitsRect(a: SwingArc, r: PlanRect, eps = 1e-6): boolean {
  const i = intersect(arcBox(a), r);
  if (!i || i.x1 - i.x0 < eps || i.z1 - i.z0 < eps) return false;
  const cx = Math.min(Math.max(a.px, i.x0), i.x1);
  const cz = Math.min(Math.max(a.pz, i.z0), i.z1);
  return Math.hypot(cx - a.px, cz - a.pz) < a.r - eps;
}

/** Convex polygon (pivot + arc samples) for arc-vs-arc tests. */
function arcPolygon(a: SwingArc, n = 12): [number, number][] {
  const pts: [number, number][] = [[a.px, a.pz]];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * (Math.PI / 2);
    pts.push([a.px + a.sx * a.r * Math.cos(t), a.pz + a.sz * a.r * Math.sin(t)]);
  }
  return pts;
}

/** Separating-axis test on two convex polygons; true when they overlap by more than eps. */
function convexOverlap(p: [number, number][], q: [number, number][], eps = 1e-6): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, z0] = poly[i]!;
      const [x1, z1] = poly[(i + 1) % poly.length]!;
      const nx = z1 - z0;
      const nz = x0 - x1;
      const len = Math.hypot(nx, nz);
      if (len < 1e-12) continue;
      const proj = (pts: [number, number][]) => pts.map(([x, z]) => (x * nx + z * nz) / len);
      const pa = proj(p);
      const pb = proj(q);
      if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= eps) return false;
    }
  }
  return true;
}

export function arcsOverlap(a: SwingArc, b: SwingArc): boolean {
  return convexOverlap(arcPolygon(a), arcPolygon(b));
}
