/**
 * Instance driver (A4): applies assembly decomposition to instanced meshes.
 *
 * displayed = canonical + offset, recomputed from the canonical matrices on every apply (never accumulated).
 * Ownership of the instance matrix is split by element so independent features compose without knowing each other:
 *   elements 12..14 (translation)        owned by this driver (the explosion)
 *   elements 0..11 and 15 (rotation/scale) owned by B3's removal overlay (zero scale = simulated as removed)
 * so a B3-hidden instance stays hidden while exploded, and B3 can restore its linear part without touching the explosion.
 *
 * Floor and system offsets are NOT applied here: they are translations of the Floor_* and <floor>_<system> groups
 * (see groups.ts), which every child, tint and outline follows by construction, and which three.js already honours for
 * picking, culling, clipping and shadows. Only the per-member assembly offsets need instance writes.
 *
 * Meshes register when they mount (InstancedBatch), overlays that mirror instances (B3 tints, selection outlines)
 * register as followers, so every copy of an instance moves with its source. Nothing is allocated per apply.
 */

import type { InstancedMesh, Object3D } from "three";
import type { ExplodeModel } from "@/engine/explode";

interface Target {
  readonly mesh: InstancedMesh;
  readonly ids: readonly string[];
  readonly canonical: Float32Array;
  /** Batches own their bounding sphere; followers (tints) are never culled or raycast. */
  readonly owner: boolean;
  /** Instances with an assembly offset, with their unit vector (x, y, z per entry) and assembly index. */
  idx: Int32Array;
  unit: Float32Array;
  asm: Int32Array;
  /** Distinct assemblies in this mesh. */
  asmList: Int32Array;
  maxUnit: number;
  radius0: number;
  /** Currently displaced (not canonical). */
  applied: boolean;
}

interface ObjectFollower {
  readonly obj: Object3D;
  readonly id: string;
  readonly base: [number, number, number];
  asm: number;
  unit: [number, number, number];
}

export class InstanceExplosion {
  private readonly targets = new Map<InstancedMesh, Target>();
  private readonly objects = new Set<ObjectFollower>();
  private model: ExplodeModel | null = null;
  /** Milliseconds the last apply() took, and how many meshes it wrote (dev measurement). */
  lastApplyMs = 0;
  lastWritten = 0;
  applyCount = 0;

  get meshCount(): number {
    return this.targets.size;
  }

  /** A batch mesh mounted: `canonical` is its generated matrices (a reference, never written). */
  register(mesh: InstancedMesh, ids: readonly string[], canonical: Float32Array, owner = true): void {
    const t: Target = { mesh, ids, canonical, owner, idx: EMPTY_I, unit: EMPTY_F, asm: EMPTY_I, asmList: EMPTY_I, maxUnit: 0, radius0: mesh.boundingSphere?.radius ?? 0, applied: false };
    this.targets.set(mesh, t);
    if (this.model) this.index(t);
  }

  /** An overlay that mirrors some instances of another mesh (`canonical` = its own copy of their canonical matrices). */
  follow(mesh: InstancedMesh, ids: readonly string[], canonical: Float32Array): void {
    this.register(mesh, ids, canonical, false);
    const t = this.targets.get(mesh)!;
    if (this.model && this.lastFactors) this.applyTarget(t, this.lastFactors);
  }

  unregister(mesh: InstancedMesh): void {
    const t = this.targets.get(mesh);
    if (t?.applied && t.owner && mesh.boundingSphere) mesh.boundingSphere.radius = t.radius0; // never leave an inflated sphere behind
    this.targets.delete(mesh);
  }

  canonicalOf(mesh: InstancedMesh): Float32Array | undefined {
    return this.targets.get(mesh)?.canonical;
  }

  /** A single Object3D (e.g. a selection outline) whose `matrix` currently holds a canonical instance matrix. */
  followObject(obj: Object3D, id: string): () => void {
    const e = obj.matrix.elements;
    const f: ObjectFollower = { obj, id, base: [e[12]!, e[13]!, e[14]!], asm: -1, unit: [0, 0, 0] };
    this.indexObject(f);
    this.objects.add(f);
    if (this.lastFactors) this.applyObject(f, this.lastFactors);
    return () => {
      this.objects.delete(f);
      // leave the object at its canonical position (it is being removed anyway)
      e[12] = f.base[0];
      e[13] = f.base[1];
      e[14] = f.base[2];
    };
  }

  /** Attach (or detach, with null) the explode model that says which instances decompose and by how much. */
  attachModel(model: ExplodeModel | null): void {
    this.model = model;
    this.lastFactors = null;
    for (const t of this.targets.values()) {
      if (model) this.index(t);
      else this.clear(t);
    }
    for (const f of this.objects) {
      this.indexObject(f);
      if (!model) this.applyObject(f, ZERO); // detached: every follower goes back to its canonical position
    }
  }

  private lastFactors: ArrayLike<number> | null = null;

  /** Write displayed = canonical + unit x factor for every decomposable instance. `factors` is per assembly index. */
  apply(factors: ArrayLike<number>): number {
    const t0 = performance.now();
    this.lastFactors = factors;
    let written = 0;
    for (const t of this.targets.values()) if (this.applyTarget(t, factors)) written++;
    for (const f of this.objects) this.applyObject(f, factors);
    this.lastApplyMs = performance.now() - t0;
    this.lastWritten = written;
    this.applyCount++;
    return written;
  }

  private applyTarget(t: Target, factors: ArrayLike<number>): boolean {
    if (t.idx.length === 0) return false;
    let maxF = 0;
    for (let k = 0; k < t.asmList.length; k++) {
      const f = factors[t.asmList[k]!]!;
      if (f > maxF) maxF = f;
    }
    if (maxF === 0 && !t.applied) return false; // untouched and still canonical
    const arr = t.mesh.instanceMatrix.array as Float32Array;
    const c = t.canonical;
    const { idx, unit, asm } = t;
    for (let j = 0; j < idx.length; j++) {
      const o = idx[j]! * 16;
      const f = factors[asm[j]!]!;
      if (f === 0) {
        arr[o + 12] = c[o + 12]!;
        arr[o + 13] = c[o + 13]!;
        arr[o + 14] = c[o + 14]!;
      } else {
        const u = j * 3;
        arr[o + 12] = c[o + 12]! + unit[u]! * f;
        arr[o + 13] = c[o + 13]! + unit[u + 1]! * f;
        arr[o + 14] = c[o + 14]! + unit[u + 2]! * f;
      }
    }
    t.mesh.instanceMatrix.needsUpdate = true;
    t.applied = maxF > 0;
    // culling and raycasting use the bounding sphere computed from the canonical matrices: grow it by the largest displacement
    if (t.owner && t.mesh.boundingSphere) t.mesh.boundingSphere.radius = maxF > 0 ? t.radius0 + maxF * t.maxUnit : t.radius0;
    return true;
  }

  private applyObject(f: ObjectFollower, factors: ArrayLike<number>): void {
    const e = f.obj.matrix.elements;
    const k = f.asm >= 0 ? factors[f.asm]! : 0;
    if (k === 0) {
      e[12] = f.base[0];
      e[13] = f.base[1];
      e[14] = f.base[2];
    } else {
      e[12] = f.base[0] + f.unit[0] * k;
      e[13] = f.base[1] + f.unit[1] * k;
      e[14] = f.base[2] + f.unit[2] * k;
    }
    f.obj.matrixWorldNeedsUpdate = true;
  }

  private clear(t: Target): void {
    if (t.applied) {
      const arr = t.mesh.instanceMatrix.array as Float32Array;
      for (let j = 0; j < t.idx.length; j++) {
        const o = t.idx[j]! * 16;
        arr[o + 12] = t.canonical[o + 12]!;
        arr[o + 13] = t.canonical[o + 13]!;
        arr[o + 14] = t.canonical[o + 14]!;
      }
      t.mesh.instanceMatrix.needsUpdate = true;
      if (t.owner && t.mesh.boundingSphere) t.mesh.boundingSphere.radius = t.radius0;
    }
    t.idx = EMPTY_I;
    t.unit = EMPTY_F;
    t.asm = EMPTY_I;
    t.asmList = EMPTY_I;
    t.maxUnit = 0;
    t.applied = false;
  }

  private index(t: Target): void {
    const m = this.model!;
    const idx: number[] = [];
    const asm: number[] = [];
    const unit: number[] = [];
    const distinct = new Set<number>();
    let maxUnit = 0;
    for (let i = 0; i < t.ids.length; i++) {
      const a = m.memberAssembly.get(t.ids[i]!);
      if (a === undefined) continue;
      const u = m.memberUnit.get(t.ids[i]!)!;
      idx.push(i);
      asm.push(a);
      unit.push(u[0], u[1], u[2]);
      distinct.add(a);
      maxUnit = Math.max(maxUnit, Math.hypot(u[0], u[1], u[2]));
    }
    t.idx = Int32Array.from(idx);
    t.asm = Int32Array.from(asm);
    t.unit = Float32Array.from(unit);
    t.asmList = Int32Array.from(distinct);
    t.maxUnit = maxUnit;
  }

  private indexObject(f: ObjectFollower): void {
    const m = this.model;
    const a = m?.memberAssembly.get(f.id);
    if (m && a !== undefined) {
      const u = m.memberUnit.get(f.id)!;
      f.asm = a;
      f.unit = [u[0], u[1], u[2]];
    } else {
      f.asm = -1;
      f.unit = [0, 0, 0];
    }
  }
}

const ZERO: ArrayLike<number> = [];
const EMPTY_I = new Int32Array(0);
const EMPTY_F = new Float32Array(0);

/** The one driver the viewer uses. */
export const instanceExplosion = new InstanceExplosion();
