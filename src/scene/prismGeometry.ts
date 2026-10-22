/**
 * Builds a closed prism BufferGeometry from a 2D profile, without ExtrudeGeometry.
 *
 * Why not ExtrudeGeometry: in three r175, `bevelEnabled: false` forces bevelSegments to 0
 * and the lid triangulation takes its contour from inside the bevel loop, so no caps are
 * generated (the mesh renders as open side walls). This builder triangulates the cap with
 * ShapeUtils and builds the side walls explicitly; every face gets a flat outward normal.
 *
 * Axis mapping (profile (u, v), extrusion w, centred on 0):
 *   plane "xz": u -> x, v -> z, w -> y      plane "zy": u -> z, v -> y, w -> x
 */

import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from "three";
import type { PrismDescriptor } from "@/building/structure";

type V3 = [number, number, number];

export function buildPrismGeometry(d: PrismDescriptor): BufferGeometry {
  const toLocal = (u: number, v: number, w: number): V3 =>
    d.plane === "xz" ? [u, w, v] : [w, v, u];
  const axisU: V3 = d.plane === "xz" ? [1, 0, 0] : [0, 0, 1];
  const axisV: V3 = d.plane === "xz" ? [0, 0, 1] : [0, 1, 0];
  const axisW: V3 = d.plane === "xz" ? [0, 1, 0] : [1, 0, 0];

  const pts = d.profile;
  const h = d.extent / 2;
  const area = ShapeUtils.area(pts.map(([u, v]) => new Vector2(u, v))); // > 0 when CCW in (u, v)

  const positions: number[] = [];
  const normals: number[] = [];

  /** Emit a triangle, flipping it if needed so it faces `want`. */
  const tri = (a: V3, b: V3, c: V3, want: V3) => {
    const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: V3 = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const flip = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0;
    const [p, q, r] = flip ? [a, c, b] : [a, b, c];
    for (const x of [p, q, r]) {
      positions.push(...x);
      normals.push(...want);
    }
  };

  // Caps: triangulate once, emit at +h and -h
  const contour = pts.map(([u, v]) => new Vector2(u, v));
  const faces = ShapeUtils.triangulateShape(contour.slice(), []);
  for (const [i, j, k] of faces as [number, number, number][]) {
    const [pi, pj, pk] = [pts[i]!, pts[j]!, pts[k]!];
    tri(toLocal(pi[0], pi[1], h), toLocal(pj[0], pj[1], h), toLocal(pk[0], pk[1], h), axisW);
    tri(
      toLocal(pi[0], pi[1], -h),
      toLocal(pj[0], pj[1], -h),
      toLocal(pk[0], pk[1], -h),
      axisW.map((x) => -x) as V3,
    );
  }

  // Sides: one quad (two triangles) per profile edge, outward in the (u, v) plane
  for (let i = 0; i < pts.length; i++) {
    const [u0, v0] = pts[i]!;
    const [u1, v1] = pts[(i + 1) % pts.length]!;
    const du = u1 - u0;
    const dv = v1 - v0;
    const len = Math.hypot(du, dv);
    if (len < 1e-12) continue;
    const [nu, nv] = area > 0 ? [dv / len, -du / len] : [-dv / len, du / len];
    const want: V3 = [
      nu * axisU[0] + nv * axisV[0],
      nu * axisU[1] + nv * axisV[1],
      nu * axisU[2] + nv * axisV[2],
    ];
    const a = toLocal(u0, v0, -h);
    const b = toLocal(u1, v1, -h);
    const c = toLocal(u1, v1, h);
    const e = toLocal(u0, v0, h);
    tri(a, b, c, want);
    tri(a, c, e, want);
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  return g;
}
