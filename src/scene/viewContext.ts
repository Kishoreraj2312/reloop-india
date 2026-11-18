/**
 * The ViewContext (stair core focus, section plane, stair cut height) derived from the building config. One definition shared by the
 * viewer (named views and their clip planes) and the presentation layer (camera presets), so they can never disagree.
 */

import type { BuildingConfig } from "@/building/config";
import { buildGrid, openingOf } from "@/building/structure";
import type { ViewContext } from "./framing";

export function makeViewContext(cfg: BuildingConfig): ViewContext {
  const grid = buildGrid(cfg);
  const op = openingOf(grid, "stair");
  return {
    stair: {
      centre: [(op.x0 + op.x1) / 2, 0, (op.z0 + op.z1) / 2],
      halfX: (op.x1 - op.x0) / 2,
      halfZ: (op.z1 - op.z0) / 2,
    },
    sectionZ: grid.zs[2]!, // gridline 3: cuts through a full line of columns and beams
    // Stair view: cut just below the beams of L3, so L1..L3 stair storeys are visible.
    stairCutY: grid.levels[3]!.elevation - cfg.beam.depth - 0.1,
  };
}
