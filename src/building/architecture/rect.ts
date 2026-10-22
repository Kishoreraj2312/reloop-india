/**
 * Axis-aligned plan rectangles (x, z) and the few set operations the architecture
 * generators need. Rectangle difference replaces CSG: a wall minus a column is the set
 * of up to four rectangles around it.
 */

export const EPS = 1e-9;

export interface PlanRect {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

export const rect = (x0: number, x1: number, z0: number, z1: number): PlanRect => ({
  x0: Math.min(x0, x1),
  x1: Math.max(x0, x1),
  z0: Math.min(z0, z1),
  z1: Math.max(z0, z1),
});

export const rectW = (r: PlanRect) => r.x1 - r.x0;
export const rectD = (r: PlanRect) => r.z1 - r.z0;
export const rectArea = (r: PlanRect) => rectW(r) * rectD(r);
export const rectCentre = (r: PlanRect): [number, number] => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
export const isEmpty = (r: PlanRect, eps = EPS) => rectW(r) <= eps || rectD(r) <= eps;

export function intersect(a: PlanRect, b: PlanRect): PlanRect | null {
  const r = { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), z0: Math.max(a.z0, b.z0), z1: Math.min(a.z1, b.z1) };
  return isEmpty(r) ? null : r;
}

/** True if the rectangles share positive area. */
export function overlaps(a: PlanRect, b: PlanRect, eps = EPS): boolean {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > eps && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > eps;
}

export function contains(outer: PlanRect, inner: PlanRect, eps = 1e-6): boolean {
  return inner.x0 >= outer.x0 - eps && inner.x1 <= outer.x1 + eps && inner.z0 >= outer.z0 - eps && inner.z1 <= outer.z1 + eps;
}

/**
 * a minus b as disjoint rectangles. Split order is fixed (x-bands first: full-depth W and E
 * strips, then S and N pieces between them) so results are deterministic.
 */
export function subtract(a: PlanRect, b: PlanRect, eps = EPS): PlanRect[] {
  const i = intersect(a, b);
  if (!i) return [a];
  const out: PlanRect[] = [];
  const push = (r: PlanRect) => {
    if (!isEmpty(r, eps)) out.push(r);
  };
  push({ x0: a.x0, x1: i.x0, z0: a.z0, z1: a.z1 });
  push({ x0: i.x1, x1: a.x1, z0: a.z0, z1: a.z1 });
  push({ x0: i.x0, x1: i.x1, z0: a.z0, z1: i.z0 });
  push({ x0: i.x0, x1: i.x1, z0: i.z1, z1: a.z1 });
  return out;
}

/** Variant of `subtract` that cuts along Z first (keeps long X-running pieces whole). */
export function subtractAlongX(a: PlanRect, b: PlanRect, eps = EPS): PlanRect[] {
  const i = intersect(a, b);
  if (!i) return [a];
  const out: PlanRect[] = [];
  const push = (r: PlanRect) => {
    if (!isEmpty(r, eps)) out.push(r);
  };
  push({ x0: a.x0, x1: a.x1, z0: a.z0, z1: i.z0 });
  push({ x0: a.x0, x1: a.x1, z0: i.z1, z1: a.z1 });
  push({ x0: a.x0, x1: i.x0, z0: i.z0, z1: i.z1 });
  push({ x0: i.x1, x1: a.x1, z0: i.z0, z1: i.z1 });
  return out;
}

/** Subtract many rectangles; the result is disjoint and deterministic. */
export function subtractAll(a: PlanRect, cutters: readonly PlanRect[], alongX = false, eps = EPS): PlanRect[] {
  let pieces = [a];
  for (const c of cutters) {
    const next: PlanRect[] = [];
    for (const p of pieces) next.push(...(alongX ? subtractAlongX(p, c, eps) : subtract(p, c, eps)));
    pieces = next;
  }
  return pieces;
}

export function inset(r: PlanRect, d: number): PlanRect {
  return { x0: r.x0 + d, x1: r.x1 - d, z0: r.z0 + d, z1: r.z1 - d };
}

/** Sum of areas of pairwise-disjoint rectangles. */
export const totalArea = (rs: readonly PlanRect[]) => rs.reduce((s, r) => s + rectArea(r), 0);
