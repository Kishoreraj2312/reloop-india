/**
 * Group driver (A4): applies the floor and system offsets as translations of the EXISTING scene groups
 *   Floor_<floor>             floor offset (vertical)
 *   <floor>_<system>          system offset (horizontal; the same for every floor)
 * Everything below them (plain meshes, instanced batches, B3 tints, selection outlines) follows because world matrices
 * compose, and picking, frustum culling, clipping planes and shadows all use those world matrices. Canonical local
 * transforms are never edited: a group's position is zero when assembled and is recomputed from the solver otherwise.
 */

import type { Object3D } from "three";
import type { BuildingSystem } from "@/building/types";
import type { ExplodeModel, ExplodeSolver } from "@/engine/explode";

export class GroupDriver {
  private floorGroups: (Object3D | null)[] = [];
  /** [floor slot][system slot] */
  private systemGroups: (Object3D | null)[][] = [];
  private lastFloor: Float64Array = new Float64Array(0);
  private lastSystem: Float64Array = new Float64Array(0);
  private model: ExplodeModel | null = null;

  /** Find the groups by name under `root` (call again when the scene tree is re-created). */
  bind(root: Object3D, model: ExplodeModel): void {
    this.model = model;
    this.floorGroups = model.floors.map((f) => root.getObjectByName(`Floor_${f}`) ?? null);
    this.systemGroups = model.floors.map((f) => model.systems.map((s: BuildingSystem) => root.getObjectByName(`${f}_${s}`) ?? null));
    this.lastFloor = new Float64Array(model.floors.length * 3).fill(NaN); // NaN: nothing applied yet, so everything is written
    this.lastSystem = new Float64Array(model.systems.length * 3).fill(NaN);
  }

  get bound(): boolean {
    return this.model !== null;
  }

  /** Write the solver's offsets; only groups whose offset changed are touched. Returns how many groups were written. */
  apply(solver: ExplodeSolver): number {
    const m = this.model;
    if (!m) return 0;
    let n = 0;
    for (let i = 0; i < m.floors.length; i++) {
      const o = i * 3;
      const x = solver.floorOffset[o]!;
      const y = solver.floorOffset[o + 1]!;
      const z = solver.floorOffset[o + 2]!;
      if (x === this.lastFloor[o] && y === this.lastFloor[o + 1] && z === this.lastFloor[o + 2]) continue;
      this.lastFloor[o] = x;
      this.lastFloor[o + 1] = y;
      this.lastFloor[o + 2] = z;
      this.floorGroups[i]?.position.set(x, y, z);
      n++;
    }
    for (let s = 0; s < m.systems.length; s++) {
      const o = s * 3;
      const x = solver.systemOffset[o]!;
      const y = solver.systemOffset[o + 1]!;
      const z = solver.systemOffset[o + 2]!;
      if (x === this.lastSystem[o] && y === this.lastSystem[o + 1] && z === this.lastSystem[o + 2]) continue;
      this.lastSystem[o] = x;
      this.lastSystem[o + 1] = y;
      this.lastSystem[o + 2] = z;
      for (let f = 0; f < m.floors.length; f++) this.systemGroups[f]![s]?.position.set(x, y, z);
      n++;
    }
    return n;
  }

  /** Back to canonical: every bound group at exactly (0, 0, 0). */
  restore(): void {
    for (const g of this.floorGroups) g?.position.set(0, 0, 0);
    for (const row of this.systemGroups) for (const g of row) g?.position.set(0, 0, 0);
    this.lastFloor.fill(0);
    this.lastSystem.fill(0);
  }

  unbind(): void {
    this.restore();
    this.model = null;
    this.floorGroups = [];
    this.systemGroups = [];
  }
}
