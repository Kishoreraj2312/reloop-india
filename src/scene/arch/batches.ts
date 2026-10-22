/**
 * Instancing plan for architecture records (pure; no GPU objects).
 *
 * Records are grouped by floor > category > material > unit shape. Each batch becomes one
 * InstancedMesh over a shared unit geometry (1 m box, or unit cylinder along X/Y/Z); the
 * instance matrix = translate(originalPosition) * rotate(originalRotation) * scale(size).
 * `ids[i]` is the component ID of instance i — the instanceId -> componentId map used for
 * picking and highlighting. Records are never modified.
 */

import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { ArchCategory, ComponentRecord } from "@/building/structure";
import { floorKeyOf } from "../sceneTree";
import type { FloorKey } from "../SceneHierarchy";

export type UnitShape = "box" | "cyl-x" | "cyl-y" | "cyl-z";

export interface Batch {
  readonly key: string;
  readonly floor: FloorKey;
  readonly category: ArchCategory;
  readonly materialId: string;
  readonly shape: UnitShape;
  readonly ids: readonly string[];
  /** Column-major 4x4 matrices, 16 floats per instance. */
  readonly matrices: Float32Array;
}

const Y_TO_X = new Quaternion().setFromEuler(new Euler(0, 0, -Math.PI / 2));
const Y_TO_Z = new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0));

export function shapeOf(r: ComponentRecord): UnitShape {
  const g = r.geometry;
  if (g.kind === "box") return "box";
  if (g.kind === "cylinder") return `cyl-${g.axis}`;
  throw new Error(`${r.id}: geometry ${g.kind} is not instanceable`);
}

/** Instance matrix for a record over its unit shape. */
export function instanceMatrix(r: ComponentRecord, out = new Matrix4()): Matrix4 {
  const g = r.geometry;
  const pos = new Vector3(...r.originalPosition);
  const q = new Quaternion().setFromEuler(new Euler(...r.originalRotation));
  let scale: Vector3;
  if (g.kind === "box") scale = new Vector3(...g.size);
  else if (g.kind === "cylinder") {
    scale = new Vector3(g.radius, g.height, g.radius); // unit cylinder: radius 1, height 1 along local Y
    if (g.axis === "x") q.multiply(Y_TO_X);
    if (g.axis === "z") q.multiply(Y_TO_Z);
  } else throw new Error(`${r.id}: geometry ${g.kind} is not instanceable`);
  return out.compose(pos, q, scale);
}

export function buildBatches(records: readonly ComponentRecord[]): Batch[] {
  const groups = new Map<string, { floor: FloorKey; category: ArchCategory; materialId: string; shape: UnitShape; recs: ComponentRecord[] }>();
  for (const r of records) {
    if (r.system !== "architecture" || r.geometry.kind === "group") continue;
    const floor = floorKeyOf(r.floor);
    const shape = shapeOf(r);
    const category = r.assembly as ArchCategory;
    const key = `${floor}|${category}|${r.materialId}|${shape}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { floor, category, materialId: r.materialId, shape, recs: [] }));
    g.recs.push(r);
  }
  const m = new Matrix4();
  return [...groups.entries()].map(([key, g]) => {
    const matrices = new Float32Array(g.recs.length * 16);
    g.recs.forEach((r, i) => instanceMatrix(r, m).toArray(matrices, i * 16));
    return { key, floor: g.floor, category: g.category, materialId: g.materialId, shape: g.shape, ids: g.recs.map((r) => r.id), matrices };
  });
}
