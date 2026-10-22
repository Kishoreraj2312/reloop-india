/**
 * Stairwell lining (A2): walls standing on the slab just outside the A1 stair opening on its
 * west, east and north edges, so the well is an enclosed shaft entered from the corridor at
 * its south edge. The slab opening itself stays clear. Each storey's lining rises from the
 * slab top to the soffit of the slab above (no beam crosses the opening edges); on the roof
 * it rises to the access-enclosure slab.
 */

import type { BuildingConfig } from "../config";
import { buildGrid, openingOf } from "../structure";
import { ARCH_CONFIG, type ArchitectureConfig } from "./config";
import type { PlanRect } from "./rect";

export interface WellLining {
  readonly side: "W" | "E" | "N";
  readonly rect: PlanRect;
}

export function wellLining(cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): WellLining[] {
  const op = openingOf(buildGrid(cfg), "stair");
  const t = arch.walls.partition;
  return [
    { side: "W", rect: { x0: op.x0 - t, x1: op.x0, z0: op.z0, z1: op.z1 } },
    { side: "E", rect: { x0: op.x1, x1: op.x1 + t, z0: op.z0, z1: op.z1 } },
    { side: "N", rect: { x0: op.x0 - t, x1: op.x1 + t, z0: op.z1, z1: op.z1 + t } },
  ];
}

/** Plan area taken by the well and its lining (excluded from floor finishes). */
export function wellFootprint(cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): PlanRect {
  const op = openingOf(buildGrid(cfg), "stair");
  const t = arch.walls.partition;
  return { x0: op.x0 - t, x1: op.x1 + t, z0: op.z0, z1: op.z1 + t };
}
