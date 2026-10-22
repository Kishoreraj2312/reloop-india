/**
 * Shared unit geometries for instanced batches: a 1 m box, a unit cylinder (radius 1, height
 * 1, along local Y) and, for MEP catalogue parts, one unit mesh per part and body material
 * (vertex-coloured, built lazily from building/mep/parts.ts). Instance matrices scale and
 * orient them.
 */

import { BoxGeometry, CylinderGeometry, type BufferGeometry } from "three";
import { CYLINDER_SEGMENTS } from "../geometryPool";
import { materialById } from "@/building/materialLibrary";
import { buildPartGeometry } from "../mep/partGeometry";
import type { UnitShape } from "./batches";

/** Pipes and conduits read as round at close range; MEP batches use a finer cylinder. */
const MEP_CYLINDER_SEGMENTS = 18;

export class UnitGeometries {
  private readonly box = new BoxGeometry(1, 1, 1);
  private readonly cyl = new CylinderGeometry(1, 1, 1, CYLINDER_SEGMENTS);
  private readonly cylFine = new CylinderGeometry(1, 1, 1, MEP_CYLINDER_SEGMENTS, 1);
  private readonly parts = new Map<string, BufferGeometry>();

  get(shape: UnitShape, materialId?: string, mep = false): BufferGeometry {
    if (shape === "box") return this.box;
    if (!shape.startsWith("part:")) return mep ? this.cylFine : this.cyl;
    const key = `${shape}|${materialId}`;
    let g = this.parts.get(key);
    if (!g) this.parts.set(key, (g = buildPartGeometry(shape.slice(5), materialById(materialId!).render.color)));
    return g;
  }

  dispose(): void {
    this.box.dispose();
    this.cyl.dispose();
    this.cylFine.dispose();
    for (const g of this.parts.values()) g.dispose();
    this.parts.clear();
  }
}
