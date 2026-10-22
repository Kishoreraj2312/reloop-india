/**
 * Instancing plan for architecture and MEP records (pure; no GPU objects).
 *
 * Records are grouped by floor > system > category > material > unit shape. Each batch becomes
 * one InstancedMesh over a shared unit geometry (1 m box, unit cylinder along X/Y/Z, or an MEP
 * catalogue part fitted to the unit cube); the instance matrix =
 * translate(originalPosition) * rotate(originalRotation) * scale(size).
 * `ids[i]` is the component ID of instance i — the instanceId -> componentId map used for
 * picking and highlighting. Records are never modified.
 */

import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { ArchCategory, ComponentRecord, MepCategory } from "@/building/structure";
import type { BuildingSystem } from "@/building/types";
import { floorKeyOf } from "../sceneTree";
import type { FloorKey } from "../SceneHierarchy";

export type UnitShape = "box" | "cyl-x" | "cyl-y" | "cyl-z" | `part:${string}`;

export interface Batch {
  readonly key: string;
  readonly floor: FloorKey;
  readonly system: BuildingSystem;
  readonly category: ArchCategory | MepCategory;
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
  if (g.kind === "part") return `part:${g.part}`;
  throw new Error(`${r.id}: geometry ${g.kind} is not instanceable`);
}

/** Instance matrix for a record over its unit shape. */
export function instanceMatrix(r: ComponentRecord, out = new Matrix4()): Matrix4 {
  const g = r.geometry;
  const pos = new Vector3(...r.originalPosition);
  const q = new Quaternion().setFromEuler(new Euler(...r.originalRotation));
  let scale: Vector3;
  if (g.kind === "box" || g.kind === "part") scale = new Vector3(...g.size);
  else if (g.kind === "cylinder") {
    scale = new Vector3(g.radius, g.height, g.radius); // unit cylinder: radius 1, height 1 along local Y
    if (g.axis === "x") q.multiply(Y_TO_X);
    if (g.axis === "z") q.multiply(Y_TO_Z);
  } else throw new Error(`${r.id}: geometry ${g.kind} is not instanceable`);
  return out.compose(pos, q, scale);
}

export function buildBatches(records: readonly ComponentRecord[]): Batch[] {
  const groups = new Map<string, { floor: FloorKey; system: BuildingSystem; category: ArchCategory | MepCategory; materialId: string; shape: UnitShape; recs: ComponentRecord[] }>();
  for (const r of records) {
    if (r.system === "structure" || r.geometry.kind === "group") continue;
    const floor = floorKeyOf(r.floor);
    const shape = shapeOf(r);
    const category = r.assembly as ArchCategory | MepCategory;
    const key = r.system === "architecture" ? `${floor}|${category}|${r.materialId}|${shape}` : `${floor}|${r.system}|${category}|${r.materialId}|${shape}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { floor, system: r.system, category, materialId: r.materialId, shape, recs: [] }));
    g.recs.push(r);
  }
  const m = new Matrix4();
  return [...groups.entries()].map(([key, g]) => {
    const matrices = new Float32Array(g.recs.length * 16);
    g.recs.forEach((r, i) => instanceMatrix(r, m).toArray(matrices, i * 16));
    return { key, floor: g.floor, system: g.system, category: g.category, materialId: g.materialId, shape: g.shape, ids: g.recs.map((r) => r.id), matrices };
  });
}
