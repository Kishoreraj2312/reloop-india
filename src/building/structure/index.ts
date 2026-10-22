/**
 * ReLoop India — A1 structural generator entry point.
 *
 * generateStructure: BuildingConfig -> ComponentRecord[] (pure, deterministic).
 * Output order: foundations, columns, beams, slabs, stairs.
 */

import { validateConfig, type BuildingConfig } from "../config";
import type { ComponentRecord } from "./geometry";
import { buildGrid } from "./grid";
import { generateFoundations } from "./footings";
import { generateColumns } from "./columns";
import { generateBeams } from "./beams";
import { generateSlabs } from "./slabs";
import { generateStairs } from "./stairs";

export function generateStructure(cfg: BuildingConfig): ComponentRecord[] {
  const errors = validateConfig(cfg);
  if (errors.length > 0) {
    throw new Error(
      `Invalid building config: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
    );
  }
  const grid = buildGrid(cfg);
  return [
    ...generateFoundations(grid),
    ...generateColumns(grid),
    ...generateBeams(grid),
    ...generateSlabs(grid),
    ...generateStairs(grid),
  ];
}

const cache = new WeakMap<BuildingConfig, readonly ComponentRecord[]>();

/** Memoised generation per config object (configs are treated as immutable). */
export function getStructure(cfg: BuildingConfig): readonly ComponentRecord[] {
  let records = cache.get(cfg);
  if (!records) {
    records = Object.freeze(generateStructure(cfg));
    cache.set(cfg, records);
  }
  return records;
}

export { buildGrid, nodeLabel, type GridModel, type Level } from "./grid";
export { deriveStair } from "./stairs";
export { openingsAtLevel, openingOf } from "./openings";
export { STRUCTURAL_MATERIAL } from "./grid";
export * from "./geometry";
export { recordBounds, recordSolids, type Box3 } from "./bounds";
