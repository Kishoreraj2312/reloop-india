/**
 * ReLoop India — A1 geometry descriptors and the generator record type.
 *
 * Generators are pure: BuildingConfig -> ComponentRecord[]. The renderer only
 * consumes records; it never recomputes dimensions.
 *
 * Frame: each record's `originalPosition` is the local origin of its geometry.
 *   box   — centred on the origin, `size` = extents along X, Y, Z.
 *   prism — a 2D profile extruded symmetrically about the origin:
 *           plane "xz": profile points are (x, z), extruded along Y by `extent`
 *           plane "zy": profile points are (z, y), extruded along X by `extent`
 *   cylinder — centred on the origin, axis along X, Y or Z (A2 pipes, rails, fittings).
 *   group — an assembly: no mesh of its own; `size` is the assembly envelope centred on
 *           the origin (children must lie inside it).
 * Rotations are zero for every A1 member; orientation is baked into the geometry. A2 uses
 * a non-zero rotation (Euler XYZ, radians) only where a member is not axis-aligned
 * (sloping stair handrails).
 */

import type { BuildingComponent } from "../types";

export type Vec3 = readonly [number, number, number];
export type Point2 = readonly [number, number];

export interface BoxDescriptor {
  readonly kind: "box";
  readonly size: Vec3;
}

export interface PrismDescriptor {
  readonly kind: "prism";
  readonly plane: "xz" | "zy";
  readonly profile: readonly Point2[];
  readonly extent: number;
}

export interface CylinderDescriptor {
  readonly kind: "cylinder";
  readonly radius: number;
  readonly height: number;
  readonly axis: "x" | "y" | "z";
}

export interface GroupDescriptor {
  readonly kind: "group";
  readonly size: Vec3;
}

export type GeometryDescriptor = BoxDescriptor | PrismDescriptor | CylinderDescriptor | GroupDescriptor;
/** Descriptors that produce a mesh. */
export type SolidDescriptor = Exclude<GeometryDescriptor, GroupDescriptor>;

/** Scene-hierarchy assemblies inside the structure system. */
export const ASSEMBLY_NAMES = ["footings", "columns", "beams", "slabs", "stairs", "roof"] as const;
export type StructureAssemblyName = (typeof ASSEMBLY_NAMES)[number];

/** Assembly categories inside the architecture system (A2). */
export const ARCH_CATEGORIES = [
  "exteriorWalls",
  "partitions",
  "openings",
  "floors",
  "ceilings",
  "fixtures",
  "stairFinishes",
  "balconies",
  "facade",
  "roof",
] as const;
export type ArchCategory = (typeof ARCH_CATEGORIES)[number];

export type AssemblyName = StructureAssemblyName | ArchCategory;

/** A BuildingComponent plus what the renderer needs. Produced once, consumed by registry and viewer. */
export interface ComponentRecord extends BuildingComponent {
  readonly assembly: AssemblyName;
  readonly geometry: GeometryDescriptor;
}

/** Signed-area magnitude of a simple polygon (shoelace). */
export function polygonArea(profile: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < profile.length; i++) {
    const [x0, y0] = profile[i]!;
    const [x1, y1] = profile[(i + 1) % profile.length]!;
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
}

export function descriptorVolume(g: GeometryDescriptor): number {
  switch (g.kind) {
    case "box":
      return g.size[0] * g.size[1] * g.size[2];
    case "prism":
      return polygonArea(g.profile) * g.extent;
    case "cylinder":
      return Math.PI * g.radius * g.radius * g.height;
    case "group":
      return 0;
  }
}
