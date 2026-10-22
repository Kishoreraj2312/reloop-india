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
 * Rotations are zero for every A1 member; orientation is baked into the geometry.
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

export type GeometryDescriptor = BoxDescriptor | PrismDescriptor;

/** Scene-hierarchy assemblies inside the structure system. */
export const ASSEMBLY_NAMES = ["footings", "columns", "beams", "slabs", "stairs", "roof"] as const;
export type AssemblyName = (typeof ASSEMBLY_NAMES)[number];

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
  if (g.kind === "box") return g.size[0] * g.size[1] * g.size[2];
  return polygonArea(g.profile) * g.extent;
}
