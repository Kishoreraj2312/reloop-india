/**
 * Wall-mounted service geometry (A3): which wall face an A2 endpoint or a device sits on,
 * and concealed chase routes inside that wall.
 *
 * A mount is a room side: the plaster face coordinate, the normal into the room and the
 * along-wall axis. Chases run `MEP_CONFIG.chase` behind the plaster face; a vertical chase
 * is only accepted where the wall really is solid masonry over its whole height (no
 * window, door, column or other service in the way), sliding along the wall otherwise.
 */

import type { ComponentRecord } from "../structure";
import type { Side } from "../architecture/plan";
import type { PlanRect } from "../architecture/rect";
import type { InteriorRoom } from "../architecture/interior";
import { MEP_CONFIG } from "./config";
import { FINISHES, MASONRY, type MepContext } from "./context";
import { box3 } from "./space";
import { add, cross, placeLocal, scale, sub, Y, type V3 } from "./geom";
import { FIXED_PARTS, PART_FILL, type FixedPart } from "./parts";
import type { Draft, DraftInput, Group } from "./record";

export interface Mount {
  readonly storey: number;
  readonly roomId: string;
  readonly side: Side;
  /** Plaster face coordinate (z for S/N sides, x for W/E). */
  readonly face: number;
  /** Unit normal from the wall into the room. */
  readonly n: V3;
  readonly axis: "x" | "z";
  readonly clear: PlanRect;
}

const NORMAL: Record<Side, V3> = { S: [0, 0, 1], N: [0, 0, -1], W: [1, 0, 0], E: [-1, 0, 0] };

export function mountOn(storey: number, roomId: string, clear: PlanRect, side: Side): Mount {
  const face = side === "S" ? clear.z0 : side === "N" ? clear.z1 : side === "W" ? clear.x0 : clear.x1;
  return { storey, roomId, side, face, n: NORMAL[side], axis: side === "S" || side === "N" ? "x" : "z", clear };
}

/** The room side nearest to a plan point (the wall an endpoint is fixed to). */
export function mountAt(storey: number, ir: InteriorRoom, x: number, z: number): Mount {
  let best: { m: Mount; d: number } | null = null;
  for (const c of ir.clears) {
    const inside = x >= c.x0 - 0.3 && x <= c.x1 + 0.3 && z >= c.z0 - 0.3 && z <= c.z1 + 0.3;
    if (!inside) continue;
    for (const side of ["S", "N", "W", "E"] as Side[]) {
      const m = mountOn(storey, ir.room.id, c, side);
      const d = m.axis === "x" ? Math.abs(z - m.face) : Math.abs(x - m.face);
      if (!best || d < best.d - 1e-9) best = { m, d };
    }
  }
  if (!best) throw new Error(`MEP: no wall of ${ir.room.id} near ${x.toFixed(3)}, ${z.toFixed(3)}`);
  return best.m;
}

/** World point at along-wall coordinate a, height y, `depth` in front of the plaster face (negative = inside the wall). */
export function wallPoint(m: Mount, a: number, y: number, depth: number): V3 {
  const c = m.face + depth * (m.axis === "x" ? m.n[2] : m.n[0]);
  return m.axis === "x" ? [a, y, c] : [c, y, a];
}

export const alongOf = (m: Mount, p: readonly number[]) => (m.axis === "x" ? p[0]! : p[2]!);

/** Along-wall range of the mount's clear side. */
export function sideSpan(m: Mount): [number, number] {
  return m.axis === "x" ? [m.clear.x0, m.clear.x1] : [m.clear.z0, m.clear.z1];
}

export type Allow = (r: ComponentRecord) => boolean;
export const inMasonry: Allow = (r) => MASONRY.has(r.componentType);
export const throughFloor: Allow = (r) => r.componentType === "slab" || FINISHES.has(r.componentType);

/** Box around an axis-aligned segment of radius r. */
export function segBox(a: V3, b: V3, r: number) {
  return box3(Math.min(a[0], b[0]) - r, Math.max(a[0], b[0]) + r, Math.min(a[1], b[1]) - r, Math.max(a[1], b[1]) + r, Math.min(a[2], b[2]) - r, Math.max(a[2], b[2]) + r);
}

/** True if a run of radius r from a to b is clear of A1/A2 (except `allow`) and of MEP items (except `ignore`). */
export function runFree(ctx: MepContext, a: V3, b: V3, r: number, allow: Allow, ignore?: ReadonlySet<string>, clear = 0.005): boolean {
  const bx = segBox(a, b, r + clear);
  if (!ctx.space.free(bx, (x) => !allow(x))) return false;
  return ctx.mep.free(bx, ignore ? (x) => !ignore.has(x.id) : undefined);
}

export interface Chase {
  /** Points inside the wall: start (at a0, y0), optional slide to a, then vertical to y1. */
  readonly points: V3[];
  readonly a: number;
}

/**
 * Concealed chase from (a0, y0) to height y1 inside the wall of `m`: vertical at the first
 * along-position (nearest a0, 25 mm steps, up to `reach`) where both the slide at y0 and the
 * vertical are inside solid masonry and clear of other services.
 */
export function findChase(ctx: MepContext, m: Mount, a0: number, y0: number, y1: number, r: number, opts: { reach?: number; extraAllow?: Allow; ignore?: ReadonlySet<string>; prefer?: 1 | -1; clear?: number } = {}): Chase | null {
  const depth = -MEP_CONFIG.chase;
  const [s0, s1] = sideSpan(m);
  const reach = opts.reach ?? 1.2;
  const allow: Allow = (x) => inMasonry(x) || (opts.extraAllow?.(x) ?? false);
  const start = wallPoint(m, a0, y0, depth);
  const offsets: number[] = [0];
  for (let k = 1; k * 0.025 <= reach + 1e-9; k++) {
    const d = k * 0.025;
    if (opts.prefer === -1) offsets.push(-d, d);
    else offsets.push(d, -d);
  }
  for (const off of offsets) {
    const a = a0 + off;
    if (a < s0 + 0.04 + r || a > s1 - 0.04 - r) continue;
    const foot = wallPoint(m, a, y0, depth);
    const top = wallPoint(m, a, y1, depth);
    if (off !== 0 && !runFree(ctx, start, foot, r, allow, opts.ignore, opts.clear)) continue;
    if (!runFree(ctx, foot, top, r, allow, opts.ignore, opts.clear)) continue;
    return { points: off === 0 ? [start, top] : [start, foot, top], a };
  }
  return null;
}

/** Wall frame for devices: local X along the wall, Y up, Z out of the wall (= n). */
export function wallBasis(m: Mount): { ex: V3; ey: V3 } {
  return { ex: cross(Y, m.n), ey: Y };
}

/** A fixed-size wall part (device, geyser, board) anchored on the finished face at along a, height y. */
export function wallPart(ctx: MepContext, g: Group, part: FixedPart, m: Mount, a: number, y: number, faceDepth: number, d: Omit<DraftInput, "geometry" | "position" | "rotation" | "dimensions" | "unit" | "code"> & { code: string; fixed?: boolean }): Draft {
  const S = FIXED_PARTS[part];
  const { ex, ey } = wallBasis(m);
  const anchor = wallPoint(m, a, y, faceDepth);
  const pl = placeLocal(anchor, ex, ey, sub(S.centre, scale(S.size, 0.5)), add(S.centre, scale(S.size, 0.5)));
  return ctx.drafts.add(g, { ...d, geometry: { kind: "part", part, size: pl.size, fill: PART_FILL[part]! }, position: pl.position, rotation: pl.rotation, dimensions: { length: pl.size[0], width: pl.size[2], height: pl.size[1] }, unit: "nr" });
}

/** World box of a fixed wall part before placing it (for free-space checks). */
export function wallPartBox(part: FixedPart, m: Mount, a: number, y: number, faceDepth: number, shrink = 0.002) {
  const S = FIXED_PARTS[part];
  const { ex, ey } = wallBasis(m);
  const pl = placeLocal(wallPoint(m, a, y, faceDepth), ex, ey, sub(S.centre, scale(S.size, 0.5)), add(S.centre, scale(S.size, 0.5)));
  const hx = (Math.abs(ex[0]) * pl.size[0] + Math.abs(m.n[0]) * pl.size[2]) / 2 - shrink;
  const hz = (Math.abs(ex[2]) * pl.size[0] + Math.abs(m.n[2]) * pl.size[2]) / 2 - shrink;
  const hy = pl.size[1] / 2 - shrink;
  const c = pl.position;
  return box3(c[0] - hx, c[0] + hx, c[1] - hy, c[1] + hy, c[2] - hz, c[2] + hz);
}

/** Wall end and outer end of an A2 connection-point stub (cylinder normal to its wall). */
export function stubEnds(cp: ComponentRecord, m: Mount): { wall: V3; outer: V3 } {
  const c: V3 = [cp.originalPosition[0], cp.originalPosition[1], cp.originalPosition[2]];
  const h = cp.geometry.kind === "cylinder" ? cp.geometry.height : 0.05;
  return { wall: sub(c, scale(m.n, h / 2)), outer: add(c, scale(m.n, h / 2)) };
}
