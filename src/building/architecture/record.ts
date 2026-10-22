/**
 * Record factory for architecture components and assemblies (A2).
 *
 * Every architecture record is a ComponentRecord with system "architecture", a materialId
 * from the material library, dimensions that match its geometry, and a quantity derived
 * from those dimensions by unit:
 *   m3 — geometry volume (masonry, concrete, stone blocks)
 *   m2 — length x width (horizontal panels) or length x height (vertical panels/walls)
 *   m  — length (rails, skirting, pipes)
 *   nr — 1 (fittings, assemblies counted as items)
 * Assemblies are real parents: geometry `group` with an explicit envelope that their
 * children must lie inside.
 */

import { buildComponentId } from "../ids";
import type { ComponentDimensions } from "../types";
import {
  descriptorVolume,
  type ArchCategory,
  type ComponentRecord,
  type GeometryDescriptor,
  type SolidDescriptor,
  type Vec3,
} from "../structure";
import { archMaterial } from "./materials";

/** ID TYPE segments (ARC-{TYPE}-...). */
export type ArcType =
  | "WALL"
  | "PART"
  | "WIN"
  | "DOOR"
  | "BAL"
  | "FLR"
  | "SKT"
  | "TILE"
  | "CEIL"
  | "FIX"
  | "KIT"
  | "BATH"
  | "STAIRFIN"
  | "FAC"
  | "ROOF"
  | "ENT";

export type ArcUnit = "m3" | "m2" | "m" | "nr";

export interface ArcInput {
  readonly type: ArcType;
  readonly floor: number; // storey 0..4, 5 = roof
  readonly location: string;
  readonly name: string;
  readonly componentType: string;
  readonly assemblyType: string;
  readonly category: ArchCategory;
  readonly materialId: string;
  readonly geometry: SolidDescriptor;
  readonly position: Vec3;
  readonly rotation?: Vec3;
  readonly dimensions: ComponentDimensions;
  readonly unit: ArcUnit;
  readonly parentId?: string;
  readonly apartmentId?: string;
  readonly roomId?: string;
  readonly dependencies?: readonly string[];
}

export function arcId(type: ArcType, floor: number, location: string): string {
  return buildComponentId({ system: "architecture", type, floor, location });
}

/** Quantity implied by unit + dimensions (+ geometry for volumes). */
export function quantityFor(unit: ArcUnit, dims: ComponentDimensions, geometry: GeometryDescriptor): number {
  switch (unit) {
    case "m3":
      return descriptorVolume(geometry);
    case "m2":
      return (dims.length ?? 0) * (dims.width ?? dims.height ?? 0);
    case "m":
      return dims.length ?? 0;
    case "nr":
      return 1;
  }
}

function freezeRecord(r: ComponentRecord): ComponentRecord {
  return Object.freeze(r);
}

export function arcRecord(i: ArcInput): ComponentRecord {
  archMaterial(i.materialId); // throws on unknown material ids
  return freezeRecord({
    id: arcId(i.type, i.floor, i.location),
    name: i.name,
    system: "architecture",
    componentType: i.componentType,
    assemblyType: i.assemblyType,
    floor: i.floor,
    materialId: i.materialId,
    dimensions: Object.freeze({ ...i.dimensions }),
    quantity: quantityFor(i.unit, i.dimensions, i.geometry),
    unit: i.unit,
    condition: "good",
    recoveryRoute: "inspect",
    confidence: "assumed",
    ...(i.parentId !== undefined ? { parentId: i.parentId } : {}),
    ...(i.apartmentId !== undefined ? { apartmentId: i.apartmentId } : {}),
    ...(i.roomId !== undefined ? { roomId: i.roomId } : {}),
    dependencies: Object.freeze([...(i.dependencies ?? [])]),
    originalPosition: Object.freeze([...i.position]) as Vec3,
    originalRotation: Object.freeze([...(i.rotation ?? [0, 0, 0])]) as Vec3,
    assembly: i.category,
    geometry: Object.freeze(i.geometry),
  });
}

export interface AssemblyInput extends Omit<ArcInput, "geometry" | "position" | "rotation" | "componentType" | "unit"> {
  readonly min: Vec3;
  readonly max: Vec3;
  readonly unit?: ArcUnit;
}

/** An assembly parent: group geometry over the envelope [min, max]. */
export function arcAssembly(i: AssemblyInput): ComponentRecord {
  const size: Vec3 = [i.max[0] - i.min[0], i.max[1] - i.min[1], i.max[2] - i.min[2]];
  const position: Vec3 = [(i.min[0] + i.max[0]) / 2, (i.min[1] + i.max[1]) / 2, (i.min[2] + i.max[2]) / 2];
  const geometry = Object.freeze({ kind: "group" as const, size: Object.freeze(size) as Vec3 });
  const unit = i.unit ?? "nr";
  archMaterial(i.materialId);
  return freezeRecord({
    id: arcId(i.type, i.floor, i.location),
    name: i.name,
    system: "architecture",
    componentType: `${i.assemblyType}_assembly`,
    assemblyType: i.assemblyType,
    floor: i.floor,
    materialId: i.materialId,
    dimensions: Object.freeze({ ...i.dimensions }),
    quantity: quantityFor(unit, i.dimensions, geometry),
    unit,
    condition: "good",
    recoveryRoute: "inspect",
    confidence: "assumed",
    ...(i.parentId !== undefined ? { parentId: i.parentId } : {}),
    ...(i.apartmentId !== undefined ? { apartmentId: i.apartmentId } : {}),
    ...(i.roomId !== undefined ? { roomId: i.roomId } : {}),
    dependencies: Object.freeze([...(i.dependencies ?? [])]),
    originalPosition: Object.freeze(position) as Vec3,
    originalRotation: Object.freeze([0, 0, 0]) as Vec3,
    assembly: i.category,
    geometry,
  });
}

// ── Box helpers ──────────────────────────────────────────────────────────────

export interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

export const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Box => ({
  min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
  max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
});

export const boxSize = (b: Box): Vec3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
export const boxCentre = (b: Box): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];

/** Geometry + position for an axis-aligned box. */
export function boxGeom(b: Box): { geometry: SolidDescriptor; position: Vec3 } {
  return { geometry: { kind: "box", size: boxSize(b) }, position: boxCentre(b) };
}

/** Dimensions of a box: horizontal panel (thin in Y). */
export function dimsHorizontal(b: Box): ComponentDimensions {
  const [sx, sy, sz] = boxSize(b);
  return { length: Math.max(sx, sz), width: Math.min(sx, sz), thickness: sy };
}

/** Dimensions of a vertical element running along `axis` (walls, panels on walls). */
export function dimsVertical(b: Box, axis: "x" | "z"): ComponentDimensions {
  const [sx, sy, sz] = boxSize(b);
  return axis === "x" ? { length: sx, height: sy, thickness: sz } : { length: sz, height: sy, thickness: sx };
}

/** Dimensions of a compact solid: length = X, width = Z, height = Y. */
export function dimsSolid(b: Box): ComponentDimensions {
  const [sx, sy, sz] = boxSize(b);
  return { length: sx, width: sz, height: sy };
}

/** Union envelope of boxes. */
export function unionBox(bs: readonly Box[]): Box {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of bs)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, b.min[k]!);
      max[k] = Math.max(max[k]!, b.max[k]!);
    }
  return { min, max };
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** Floor tag used in IDs: G, F01..F04, RF (matches ids.ts). */
export function floorTag(floor: number): string {
  if (floor <= 0) return "G";
  if (floor >= 5) return "RF";
  return `F${pad2(floor)}`;
}
