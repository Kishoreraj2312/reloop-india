/**
 * Small vector helpers for the MEP generators (pure, no three.js): axis-aligned directions,
 * basis -> Euler XYZ (three.js convention, matches structure/bounds.ts), and placement of
 * a part's local box in world space.
 */

import type { Vec3 } from "../structure";

export type V3 = readonly [number, number, number];
export type P2 = readonly [number, number]; // plan (x, z)

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};
export const dist = (a: V3, b: V3) => len(sub(a, b));
export const near = (a: V3, b: V3, eps = 1e-6) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;

export const X: V3 = [1, 0, 0];
export const Y: V3 = [0, 1, 0];
export const Z: V3 = [0, 0, 1];

/** Snap a direction to the nearest signed world axis (route legs are axis-aligned or nearly so). */
export function axisDir(d: V3): V3 {
  const ax = Math.abs(d[0]);
  const ay = Math.abs(d[1]);
  const az = Math.abs(d[2]);
  if (ax >= ay && ax >= az) return [Math.sign(d[0]) || 1, 0, 0];
  if (ay >= az) return [0, Math.sign(d[1]) || 1, 0];
  return [0, 0, Math.sign(d[2]) || 1];
}

/** Any unit axis perpendicular to an axis direction, preferring world up. */
export function perpUp(d: V3): V3 {
  return Math.abs(d[1]) > 0.5 ? X : Y;
}

const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);

/**
 * Euler XYZ angles of the rotation whose matrix columns are the images of local X, Y, Z
 * (three.js Euler.setFromRotationMatrix, order "XYZ").
 */
export function eulerFromBasis(ex: V3, ey: V3, ez: V3 = cross(ex, ey)): Vec3 {
  // Row-major m[row][col]; column j = image of basis vector j.
  const m11 = ex[0], m12 = ey[0], m13 = ez[0];
  const m22 = ey[1], m23 = ez[1];
  const m32 = ey[2], m33 = ez[2];
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  let x: number;
  let z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    x = Math.atan2(m32, m22);
    z = 0;
  }
  return [clean(x), clean(y), clean(z)];
}

/** Rotate a local vector by the basis (ex, ey, ez). */
export function applyBasis(v: V3, ex: V3, ey: V3, ez: V3): V3 {
  return [ex[0] * v[0] + ey[0] * v[1] + ez[0] * v[2], ex[1] * v[0] + ey[1] * v[1] + ez[1] * v[2], ex[2] * v[0] + ey[2] * v[1] + ez[2] * v[2]];
}

/** World box centre, size and rotation for a local box [lo, hi] anchored at `anchor` with basis (ex, ey). */
export function placeLocal(anchor: V3, ex: V3, ey: V3, lo: V3, hi: V3): { position: Vec3; size: Vec3; rotation: Vec3 } {
  const ez = cross(ex, ey);
  const c: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const pos = add(anchor, applyBasis(c, ex, ey, ez));
  return {
    position: [pos[0], pos[1], pos[2]],
    size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
    rotation: eulerFromBasis(ex, ey, ez),
  };
}

export const round = (v: number, k = 1e6) => Math.round(v * k) / k;
