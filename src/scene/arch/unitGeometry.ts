/**
 * Shared unit geometries for instanced architecture batches: a 1 m box and a unit cylinder
 * (radius 1, height 1, along local Y). Instance matrices scale and orient them.
 */

import { BoxGeometry, CylinderGeometry, type BufferGeometry } from "three";
import { CYLINDER_SEGMENTS } from "../geometryPool";
import type { UnitShape } from "./batches";

export class UnitGeometries {
  private readonly box = new BoxGeometry(1, 1, 1);
  private readonly cyl = new CylinderGeometry(1, 1, 1, CYLINDER_SEGMENTS);

  get(shape: UnitShape): BufferGeometry {
    return shape === "box" ? this.box : this.cyl;
  }

  dispose(): void {
    this.box.dispose();
    this.cyl.dispose();
  }
}
