/**
 * Component-level validation (A2): runs on generated records, the same records the
 * renderer consumes. Each check returns a list of problems (empty = pass).
 */

import { isValidComponentId, parseComponentId } from "../ids";
import { recordBounds, recordSolids, type Box3, type ComponentRecord } from "../structure";
import { hasArchMaterial } from "./materials";
import { quantityFor, type ArcUnit } from "./record";

const VOL_EPS = 1e-9;

export interface OverlapHit {
  readonly a: string;
  readonly b: string;
  readonly volume: number;
}

/** A documented exception: two records may share volume if `allow(a, b)` is true. */
export interface AllowRule {
  readonly reason: string;
  readonly allow: (a: ComponentRecord, b: ComponentRecord) => boolean;
}

function overlapVolume(a: Box3, b: Box3): number {
  const dx = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const dy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  const dz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
  return dx > 0 && dy > 0 && dz > 0 ? dx * dy * dz : 0;
}

interface Entry {
  readonly r: ComponentRecord;
  readonly solids: readonly Box3[];
  readonly bounds: Box3;
}

const CELL = 2.0;

function cellsOf(b: Box3): string[] {
  const out: string[] = [];
  const lo = b.min.map((v) => Math.floor(v / CELL));
  const hi = b.max.map((v) => Math.floor(v / CELL));
  for (let i = lo[0]!; i <= hi[0]!; i++)
    for (let j = lo[1]!; j <= hi[1]!; j++) for (let k = lo[2]!; k <= hi[2]!; k++) out.push(`${i},${j},${k}`);
  return out;
}

function entries(records: readonly ComponentRecord[]): Entry[] {
  return records.filter((r) => r.geometry.kind !== "group").map((r) => ({ r, solids: recordSolids(r), bounds: recordBounds(r) }));
}

/**
 * Positive-volume overlaps between records (face contact is not an overlap). With `others`,
 * only cross pairs (records x others) are checked.
 */
export function findOverlaps(records: readonly ComponentRecord[], others?: readonly ComponentRecord[], rules: readonly AllowRule[] = []): OverlapHit[] {
  const A = entries(records);
  const B = others ? entries(others) : A;
  const hash = new Map<string, number[]>();
  B.forEach((e, i) => {
    for (const c of cellsOf(e.bounds)) {
      let l = hash.get(c);
      if (!l) hash.set(c, (l = []));
      l.push(i);
    }
  });
  const hits: OverlapHit[] = [];
  const seen = new Set<string>();
  A.forEach((a, ia) => {
    const cand = new Set<number>();
    for (const c of cellsOf(a.bounds)) for (const j of hash.get(c) ?? []) cand.add(j);
    for (const j of cand) {
      if (!others && j <= ia) continue;
      const b = B[j]!;
      if (overlapVolume(a.bounds, b.bounds) <= VOL_EPS) continue;
      let v = 0;
      for (const sa of a.solids) for (const sb of b.solids) v += overlapVolume(sa, sb);
      if (v <= VOL_EPS) continue;
      if (rules.some((rule) => rule.allow(a.r, b.r) || rule.allow(b.r, a.r))) continue;
      const key = a.r.id < b.r.id ? `${a.r.id}|${b.r.id}` : `${b.r.id}|${a.r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ a: a.r.id, b: b.r.id, volume: v });
    }
  });
  return hits;
}

/**
 * Coplanar same-facing faces with overlapping area (z-fighting risk) between unrotated
 * boxes. Touching faces that face each other (stacked or abutting solids) are fine.
 */
export function findCoplanarFaces(records: readonly ComponentRecord[], others?: readonly ComponentRecord[], areaEps = 1e-6): string[] {
  const boxes = (rs: readonly ComponentRecord[]) =>
    entries(rs).filter((e) => e.r.geometry.kind === "box" && e.r.originalRotation.every((v) => v === 0));
  const A = boxes(records);
  const B = others ? boxes(others) : A;
  const hash = new Map<string, number[]>();
  B.forEach((e, i) => cellsOf(e.bounds).forEach((c) => (hash.get(c) ?? hash.set(c, []).get(c)!).push(i)));
  const out: string[] = [];
  A.forEach((a, ia) => {
    const cand = new Set<number>();
    for (const c of cellsOf(a.bounds)) for (const j of hash.get(c) ?? []) cand.add(j);
    for (const j of cand) {
      if (!others && j <= ia) continue;
      const b = B[j]!;
      for (let ax = 0; ax < 3; ax++) {
        const [u, v] = [0, 1, 2].filter((k) => k !== ax) as [number, number];
        const du = Math.min(a.bounds.max[u]!, b.bounds.max[u]!) - Math.max(a.bounds.min[u]!, b.bounds.min[u]!);
        const dv = Math.min(a.bounds.max[v]!, b.bounds.max[v]!) - Math.max(a.bounds.min[v]!, b.bounds.min[v]!);
        if (du <= 0 || dv <= 0 || du * dv <= areaEps) continue;
        for (const face of ["min", "max"] as const) {
          if (Math.abs(a.bounds[face][ax]! - b.bounds[face][ax]!) < 1e-7) {
            out.push(`${a.r.id} / ${b.r.id}: coplanar ${face}-${"xyz"[ax]} faces (${(du * dv).toFixed(4)} m2)`);
          }
        }
      }
    }
  });
  return out;
}

/** IDs: valid pattern, architecture prefix, unique, floor segment matches the record. */
export function checkIds(records: readonly ComponentRecord[], prefixes: readonly string[]): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.id)) errs.push(`duplicate id ${r.id}`);
    seen.add(r.id);
    if (!isValidComponentId(r.id)) errs.push(`invalid id ${r.id}`);
    const p = parseComponentId(r.id);
    if (!p) continue;
    if (p.system !== "architecture") errs.push(`${r.id}: not ARC`);
    if (!prefixes.includes(p.type)) errs.push(`${r.id}: unexpected prefix ${p.type}`);
    const floor = r.floor < 0 ? 0 : r.floor;
    if (p.floor !== floor) errs.push(`${r.id}: floor tag ${p.floor} != record floor ${r.floor}`);
  }
  return errs;
}

/** Parents exist, are assemblies (groups), children sit inside the parent envelope; no cycles. */
export function checkHierarchy(records: readonly ComponentRecord[], tol = 1e-6): string[] {
  const errs: string[] = [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const childCount = new Map<string, number>();
  for (const r of records) {
    if (!r.parentId) continue;
    const p = byId.get(r.parentId);
    if (!p) {
      errs.push(`${r.id}: parent ${r.parentId} missing`);
      continue;
    }
    childCount.set(p.id, (childCount.get(p.id) ?? 0) + 1);
    if (p.geometry.kind !== "group") errs.push(`${r.id}: parent ${p.id} is not an assembly`);
    // Child IDs reference the parent: same floor, location extends the parent's location
    // (e.g. ARC-WIN-F02-A3-LIV-N-01-FRM-H under ARC-WIN-F02-A3-LIV-N-01; tiles ARC-TILE-..-A3-LIV-R01C01 under ARC-FLR-..-A3-LIV).
    const pc = parseComponentId(r.id);
    const pp = parseComponentId(p.id);
    if (!pc || !pp || pc.floor !== pp.floor || !pc.location.startsWith(`${pp.location}-`))
      errs.push(`${r.id}: id does not reference its parent ${p.id}`);
    const cb = recordBounds(r);
    const pb = recordBounds(p);
    for (let k = 0; k < 3; k++) {
      if (cb.min[k]! < pb.min[k]! - tol || cb.max[k]! > pb.max[k]! + tol) {
        errs.push(`${r.id}: outside parent ${p.id} on ${"xyz"[k]} (${cb.min[k]!.toFixed(4)}..${cb.max[k]!.toFixed(4)} vs ${pb.min[k]!.toFixed(4)}..${pb.max[k]!.toFixed(4)})`);
        break;
      }
    }
    // cycle check
    const chain = new Set([r.id]);
    let cur: ComponentRecord | undefined = p;
    while (cur) {
      if (chain.has(cur.id)) {
        errs.push(`${r.id}: parent cycle`);
        break;
      }
      chain.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  for (const r of records) if (r.geometry.kind === "group" && !childCount.get(r.id)) errs.push(`${r.id}: assembly without children`);
  return errs;
}

/** Quantity matches the unit + dimensions (+ geometry volume); materials exist; dims positive. */
export function checkQuantities(records: readonly ComponentRecord[]): string[] {
  const errs: string[] = [];
  for (const r of records) {
    if (!hasArchMaterial(r.materialId)) errs.push(`${r.id}: unknown material ${r.materialId}`);
    const unit = r.unit as ArcUnit;
    if (!["m3", "m2", "m", "nr"].includes(unit)) {
      errs.push(`${r.id}: unit ${r.unit}`);
      continue;
    }
    const q = quantityFor(unit, r.dimensions, r.geometry);
    if (Math.abs(q - r.quantity) > 1e-9 * Math.max(1, q)) errs.push(`${r.id}: quantity ${r.quantity} != ${q}`);
    if (!(r.quantity > 0)) errs.push(`${r.id}: non-positive quantity`);
    for (const [k, v] of Object.entries(r.dimensions)) if (!(v > 0)) errs.push(`${r.id}: dimension ${k} = ${v}`);
    if (r.geometry.kind === "box") {
      const sz = [...r.geometry.size].sort((a, b) => a - b);
      const dims = [r.dimensions.length, r.dimensions.width, r.dimensions.height, r.dimensions.thickness].filter((x): x is number => x !== undefined).sort((a, b) => a - b);
      if (dims.length === 3 && dims.some((d, i) => Math.abs(d - sz[i]!) > 1e-9)) errs.push(`${r.id}: dimensions ${dims.join("x")} != geometry ${sz.join("x")}`);
    }
  }
  return errs;
}
