/**
 * Plan routing for service runs (A3): simple, deterministic, obstacle-aware.
 *
 * routeOrtho: a rectilinear path between two plan points that keeps a run of half-width
 * `half` clear of obstacle rectangles and inside an allowed region. Tries, in order, the
 * straight run, the two L shapes, Z/U shapes through candidate coordinates (obstacle edges),
 * and only then a small orthogonal visibility search over those coordinates. No fine grid.
 *
 * buildTree: grows a rectilinear tree from a root to terminals (Prim-like: the terminal
 * nearest to the tree joins next, at a tree vertex or perpendicular onto a run). Every joint
 * must form a real fitting: an elbow, a straight joint or a tee (two collinear legs + one
 * perpendicular), counting fixed vertical legs (drops, risers) at that point.
 */

import type { PlanRect } from "../architecture/rect";
import type { P2, V3 } from "./geom";

export interface RouteOptions {
  /** Half width of the run plus clearance (segments are inflated by this). */
  readonly half: number;
  /** Allowed area: the run centreline must stay inside the union of these rectangles. */
  readonly region?: readonly PlanRect[];
  readonly bendCost?: number;
}

const EPS = 1e-7;

export function segRect(a: P2, b: P2, half: number): PlanRect {
  return { x0: Math.min(a[0], b[0]) - half, x1: Math.max(a[0], b[0]) + half, z0: Math.min(a[1], b[1]) - half, z1: Math.max(a[1], b[1]) + half };
}

const hit = (r: PlanRect, o: PlanRect) => Math.min(r.x1, o.x1) - Math.max(r.x0, o.x0) > EPS && Math.min(r.z1, o.z1) - Math.max(r.z0, o.z0) > EPS;

export function segBlocked(a: P2, b: P2, half: number, obstacles: readonly PlanRect[]): boolean {
  const r = segRect(a, b, half);
  for (const o of obstacles) if (hit(r, o)) return true;
  return false;
}

/** Centreline of an axis-aligned segment covered by the union of region rectangles. */
export function inRegion(a: P2, b: P2, region: readonly PlanRect[] | undefined): boolean {
  if (!region) return true;
  const alongX = Math.abs(a[1] - b[1]) < EPS;
  const c = alongX ? a[1] : a[0];
  let lo = alongX ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
  const hi = alongX ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
  const spans = region
    .filter((r) => (alongX ? r.z0 - EPS <= c && c <= r.z1 + EPS : r.x0 - EPS <= c && c <= r.x1 + EPS))
    .map((r) => (alongX ? [r.x0, r.x1] : [r.z0, r.z1]) as [number, number])
    .sort((p, q) => p[0] - q[0]);
  for (const [s0, s1] of spans) {
    if (s0 > lo + EPS) break;
    lo = Math.max(lo, s1);
    if (lo >= hi - EPS) return true;
  }
  return lo >= hi - EPS;
}

function pathOk(path: readonly P2[], half: number, obstacles: readonly PlanRect[], region?: readonly PlanRect[]): boolean {
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    if (Math.abs(a[0] - b[0]) > EPS && Math.abs(a[1] - b[1]) > EPS) return false;
    if (Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS) return false;
    if (segBlocked(a, b, half, obstacles) || !inRegion(a, b, region)) return false;
  }
  return true;
}

/** Remove zero-length legs and merge collinear ones. */
export function simplify(path: readonly P2[]): P2[] {
  const out: P2[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < EPS && Math.abs(last[1] - p[1]) < EPS) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = [out[out.length - 3]!, out[out.length - 2]!, out[out.length - 1]!];
      const colX = Math.abs(a[1] - b[1]) < EPS && Math.abs(b[1] - c[1]) < EPS;
      const colZ = Math.abs(a[0] - b[0]) < EPS && Math.abs(b[0] - c[0]) < EPS;
      if (!colX && !colZ) break;
      // Only merge when b lies between a and c (no doubling back).
      const between = colX ? (b[0] - a[0]) * (c[0] - b[0]) > 0 : (b[1] - a[1]) * (c[1] - b[1]) > 0;
      if (!between) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

export function pathLength(path: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i + 1 < path.length; i++) s += Math.abs(path[i]![0] - path[i + 1]![0]) + Math.abs(path[i]![1] - path[i + 1]![1]);
  return s;
}

const cost = (path: readonly P2[], bend: number) => pathLength(path) + bend * Math.max(0, path.length - 2);

/** Candidate coordinates: obstacle and region edges just outside the inflated run. */
function candidates(a: P2, b: P2, half: number, obstacles: readonly PlanRect[], region: readonly PlanRect[] | undefined, axis: 0 | 1, reach: number): number[] {
  const lo = Math.min(a[axis], b[axis]) - reach;
  const hi = Math.max(a[axis], b[axis]) + reach;
  const s = new Set<number>([a[axis], b[axis]]);
  const d = half + 1e-4;
  for (const o of obstacles) {
    const [o0, o1] = axis === 0 ? [o.x0, o.x1] : [o.z0, o.z1];
    if (o1 < lo || o0 > hi) continue;
    s.add(o0 - d);
    s.add(o1 + d);
  }
  for (const r of region ?? []) {
    const [r0, r1] = axis === 0 ? [r.x0, r.x1] : [r.z0, r.z1];
    s.add(r0 + d);
    s.add(r1 - d);
  }
  return [...s].filter((v) => v >= lo && v <= hi).sort((p, q) => p - q);
}

export function routeOrtho(a: P2, b: P2, obstacles: readonly PlanRect[], opt: RouteOptions): P2[] | null {
  const bend = opt.bendCost ?? 0.25;
  const { half, region } = opt;
  // Only obstacles near the pair matter for the cheap shapes.
  const box = { x0: Math.min(a[0], b[0]) - 4, x1: Math.max(a[0], b[0]) + 4, z0: Math.min(a[1], b[1]) - 4, z1: Math.max(a[1], b[1]) + 4 };
  const near = obstacles.filter((o) => hit(box, o));
  const shapes: P2[][] = [];
  if (Math.abs(a[0] - b[0]) < EPS || Math.abs(a[1] - b[1]) < EPS) shapes.push([a, b]);
  shapes.push([a, [b[0], a[1]], b], [a, [a[0], b[1]], b]);
  let best: P2[] | null = null;
  const consider = (p: P2[]) => {
    const s = simplify(p);
    if (s.length < 2 || !pathOk(s, half, near, region)) return;
    if (!best || cost(s, bend) < cost(best, bend) - 1e-9) best = s;
  };
  shapes.forEach(consider);
  if (best) return best;
  for (const m of candidates(a, b, half, near, region, 0, 3)) consider([a, [m, a[1]], [m, b[1]], b]);
  for (const m of candidates(a, b, half, near, region, 1, 3)) consider([a, [a[0], m], [b[0], m], b]);
  if (best) return best;
  return gridSearch(a, b, near, opt);
}

/** Orthogonal visibility search over candidate coordinates (fallback). */
function gridSearch(a: P2, b: P2, obstacles: readonly PlanRect[], opt: RouteOptions): P2[] | null {
  const bend = opt.bendCost ?? 0.25;
  const xs = candidates(a, b, opt.half, obstacles, opt.region, 0, 4);
  const zs = candidates(a, b, opt.half, obstacles, opt.region, 1, 4);
  const nx = xs.length;
  const nz = zs.length;
  const id = (i: number, j: number) => j * nx + i;
  const ia = xs.indexOf(a[0]);
  const ja = zs.indexOf(a[1]);
  const ib = xs.indexOf(b[0]);
  const jb = zs.indexOf(b[1]);
  // dist[node * 2 + dir]: dir 0 = arrived moving along x, 1 = along z
  const N = nx * nz;
  const distA = new Float64Array(N * 2).fill(Infinity);
  const prev = new Int32Array(N * 2).fill(-1);
  const open: number[] = [];
  const start = id(ia, ja);
  distA[start * 2] = 0;
  distA[start * 2 + 1] = 0;
  open.push(start * 2, start * 2 + 1);
  const done = new Uint8Array(N * 2);
  while (open.length) {
    let k = 0;
    for (let t = 1; t < open.length; t++) if (distA[open[t]!]! < distA[open[k]!]!) k = t;
    const s = open.splice(k, 1)[0]!;
    if (done[s]) continue;
    done[s] = 1;
    const node = s >> 1;
    const dir = s & 1;
    const i = node % nx;
    const j = (node - i) / nx;
    if (node === id(ib, jb)) {
      const pts: P2[] = [];
      for (let c = s; c >= 0; c = prev[c]!) {
        const nn = c >> 1;
        pts.push([xs[nn % nx]!, zs[(nn - (nn % nx)) / nx]!]);
        if (c === start * 2 || c === start * 2 + 1) break;
      }
      return simplify(pts.reverse());
    }
    const steps: [number, number, 0 | 1][] = [
      [i + 1, j, 0],
      [i - 1, j, 0],
      [i, j + 1, 1],
      [i, j - 1, 1],
    ];
    for (const [ni, nj, nd] of steps) {
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const p: P2 = [xs[i]!, zs[j]!];
      const q: P2 = [xs[ni]!, zs[nj]!];
      if (segBlocked(p, q, opt.half, obstacles) || !inRegion(p, q, opt.region)) continue;
      const c = distA[s]! + Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + (nd !== dir && node !== start ? bend : 0);
      const t = id(ni, nj) * 2 + nd;
      if (c < distA[t]! - 1e-12) {
        distA[t] = c;
        prev[t] = s;
        open.push(t);
      }
    }
  }
  return null;
}

// ── Trees ──────────────────────────────────────────────────────────────────────

export interface TreePoint {
  readonly p: P2;
  /** Axis-aligned leg directions at this point (3D: horizontal legs plus fixed vertical ones). */
  readonly legs: V3[];
  readonly term?: string;
}

export interface TreeTerm {
  readonly key: string;
  readonly p: P2;
  /** Legs already present at the terminal (e.g. the vertical drop, or the stub into a wall). */
  readonly legs: readonly V3[];
}

export interface Tree {
  readonly pts: TreePoint[];
  /** Segments oriented from the root outward (a = parent side). */
  readonly segs: [number, number][];
  readonly unresolved: string[];
}

export interface TreeOptions extends RouteOptions {
  /** Keep joins this far from existing joints (room for the fittings). */
  readonly jointGap: number;
}

const legEq = (a: V3, b: V3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const legOpp = (a: V3, b: V3) => a[0] === -b[0] && a[1] === -b[1] && a[2] === -b[2];

/** Legs form a real fitting: <= 2 distinct legs, or a tee (one straight pair + one perpendicular). */
export function legsOk(legs: readonly V3[]): boolean {
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) if (legEq(legs[i]!, legs[j]!)) return false;
  if (legs.length <= 2) return true;
  if (legs.length > 3) return false;
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 3; j++) if (legOpp(legs[i]!, legs[j]!)) return true;
  return false;
}

/** Plan leg direction from p toward q (axis-aligned). */
export function legTo(p: P2, q: P2): V3 {
  const dx = q[0] - p[0];
  const dz = q[1] - p[1];
  return Math.abs(dx) >= Math.abs(dz) ? [Math.sign(dx) || 1, 0, 0] : [0, 0, Math.sign(dz) || 1];
}

function projectOnSeg(p: P2, a: P2, b: P2): P2 | null {
  if (Math.abs(a[1] - b[1]) < EPS) {
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    return p[0] > x0 && p[0] < x1 ? [p[0], a[1]] : null;
  }
  const z0 = Math.min(a[1], b[1]);
  const z1 = Math.max(a[1], b[1]);
  return p[1] > z0 && p[1] < z1 ? [a[0], p[1]] : null;
}

const manhattan = (p: P2, q: P2) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);

export function buildTree(root: { p: P2; legs: readonly V3[] }, terms: readonly TreeTerm[], obstacles: readonly PlanRect[], opt: TreeOptions): Tree {
  const pts: TreePoint[] = [{ p: root.p, legs: [...root.legs] }];
  const segs: [number, number][] = [];
  const unresolved: string[] = [];
  const remaining = [...terms].sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
  const gap = opt.jointGap;

  /** Segment obstacles, opening a window of `gap` around a join point on segments in `open`. */
  const treeObstacles = (open: { seg: number; at: P2 }[]): PlanRect[] => {
    const out: PlanRect[] = [];
    segs.forEach(([u, v], k) => {
      const a = pts[u]!.p;
      const b = pts[v]!.p;
      const w = open.filter((o) => o.seg === k);
      if (!w.length) {
        out.push(segRect(a, b, opt.half));
        return;
      }
      const alongX = Math.abs(a[1] - b[1]) < EPS;
      const i0 = alongX ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
      const i1 = alongX ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
      let pieces: [number, number][] = [[i0, i1]];
      for (const o of w) {
        const c = alongX ? o.at[0] : o.at[1];
        pieces = pieces
          .flatMap(([s0, s1]): [number, number][] => [
            [s0, Math.min(s1, c - gap)],
            [Math.max(s0, c + gap), s1],
          ])
          .filter(([s0, s1]) => s1 - s0 > EPS);
      }
      for (const [s0, s1] of pieces) out.push(alongX ? segRect([s0, a[1]], [s1, a[1]], opt.half) : segRect([a[0], s0], [a[0], s1], opt.half));
    });
    return out;
  };

  const pointObstacles = (except: string) => remaining.filter((t) => t.key !== except).map((t) => segRect(t.p, t.p, opt.half));

  while (remaining.length) {
    // Next terminal: nearest (manhattan) to the current tree.
    let bi = 0;
    let bd = Infinity;
    remaining.forEach((t, i) => {
      let d = Infinity;
      for (const q of pts) d = Math.min(d, manhattan(t.p, q.p));
      for (const [u, v] of segs) {
        const pr = projectOnSeg(t.p, pts[u]!.p, pts[v]!.p);
        if (pr) d = Math.min(d, manhattan(t.p, pr));
      }
      if (d < bd - 1e-9) {
        bd = d;
        bi = i;
      }
    });
    const t = remaining.splice(bi, 1)[0]!;
    // Candidate joins: vertices and perpendicular projections onto runs, nearest first.
    type Cand = { kind: "vertex"; v: number; at: P2 } | { kind: "split"; seg: number; at: P2 };
    const cands: Cand[] = [];
    pts.forEach((q, v) => cands.push({ kind: "vertex", v, at: q.p }));
    segs.forEach(([u, v], seg) => {
      const pr = projectOnSeg(t.p, pts[u]!.p, pts[v]!.p);
      if (pr && manhattan(pr, pts[u]!.p) > 2 * gap && manhattan(pr, pts[v]!.p) > 2 * gap) cands.push({ kind: "split", seg, at: pr });
    });
    cands.sort((p, q) => manhattan(t.p, p.at) - manhattan(t.p, q.at));
    const statics = [...obstacles, ...pointObstacles(t.key)];
    let best: { cand: Cand; path: P2[]; cost: number } | null = null;
    const tryCands = (list: Cand[]) => {
      for (const c of list) {
        if (best && manhattan(t.p, c.at) >= best.cost) break;
        const open =
          c.kind === "split"
            ? [{ seg: c.seg, at: c.at }]
            : segs.map((s, k) => ({ s, k })).filter(({ s }) => s[0] === c.v || s[1] === c.v).map(({ k }) => ({ seg: k, at: c.at }));
        const path = routeOrtho(t.p, c.at, [...statics, ...treeObstacles(open)], opt);
        if (!path) continue;
        // Fittings at both ends must stay valid.
        const first = legTo(path[0]!, path[1]!);
        if (!legsOk([...t.legs, first])) continue;
        const last = legTo(path[path.length - 1]!, path[path.length - 2]!);
        if (c.kind === "vertex") {
          if (!legsOk([...pts[c.v]!.legs, last])) continue;
        } else {
          const [u, v] = segs[c.seg]!;
          const along = [legTo(c.at, pts[u]!.p), legTo(c.at, pts[v]!.p)];
          if (!legsOk([...along, last])) continue;
        }
        // Bends along the new path need room for an elbow.
        let shortLeg = false;
        for (let i = 0; i + 1 < path.length; i++) if (manhattan(path[i]!, path[i + 1]!) < gap - 1e-9) shortLeg = true;
        if (shortLeg) continue;
        const cst = cost(path, opt.bendCost ?? 0.25);
        if (!best || cst < best.cost - 1e-9) best = { cand: c, path, cost: cst };
      }
    };
    tryCands(cands.slice(0, 10));
    if (!best) tryCands(cands.slice(10));
    if (!best) {
      unresolved.push(t.key);
      continue;
    }
    const { cand, path } = best as { cand: Cand; path: P2[] };
    // Join point index
    let joinIdx: number;
    if (cand.kind === "vertex") joinIdx = cand.v;
    else {
      const [u, v] = segs[cand.seg]!;
      joinIdx = pts.length;
      pts.push({ p: cand.at, legs: [legTo(cand.at, pts[u]!.p), legTo(cand.at, pts[v]!.p)] });
      segs[cand.seg] = [u, joinIdx];
      segs.push([joinIdx, v]);
    }
    // New points from the terminal (path[0]) to the join (path[last]); oriented root-outward.
    const ids: number[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const legs: V3[] = [];
      if (i === 0) legs.push(...t.legs);
      if (i > 0) legs.push(legTo(path[i]!, path[i - 1]!));
      legs.push(legTo(path[i]!, path[i + 1]!));
      pts.push({ p: path[i]!, legs, ...(i === 0 ? { term: t.key } : {}) });
      ids.push(pts.length - 1);
    }
    pts[joinIdx]!.legs.push(legTo(path[path.length - 1]!, path[path.length - 2]!));
    ids.push(joinIdx);
    for (let i = ids.length - 1; i > 0; i--) segs.push([ids[i]!, ids[i - 1]!]);
  }
  return { pts, segs, unresolved };
}
