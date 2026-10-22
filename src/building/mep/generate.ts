/**
 * ReLoop India — A3 MEP generator entry point.
 *
 * generateMep: BuildingConfig -> MEP records (plumbing + electrical) connected to the A1/A2
 * model, plus the network registry, the A2 endpoint ledger and the unresolved list. Pure and
 * deterministic; memoised per config like getStructure / getArchitecture. Order matters only
 * for clash avoidance: drainage (largest, fixed falls) first, then rainwater, water supply,
 * electrical.
 */

import type { BuildingConfig } from "../config";
import type { ComponentRecord } from "../structure";
import { createContext, type Endpoint, type NetworkInfo, type Unresolved } from "./context";
import { generateDrainage, type Stack } from "./drainage";
import { generateRainwater } from "./rainwater";
import { generateWater } from "./water";

export interface MepModel {
  readonly records: readonly ComponentRecord[];
  readonly networks: readonly NetworkInfo[];
  readonly endpoints: readonly Endpoint[];
  readonly unresolved: readonly Unresolved[];
  readonly stacks: readonly Stack[];
}

export function generateMep(cfg: BuildingConfig): MepModel {
  const ctx = createContext(cfg);
  const drainage = generateDrainage(ctx);
  generateRainwater(ctx);
  generateWater(ctx);
  const records = ctx.drafts.finalize();
  return {
    records,
    networks: [...ctx.networks.values()],
    endpoints: [...ctx.endpoints.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    unresolved: ctx.unresolved,
    stacks: drainage.stacks,
  };
}

const cache = new WeakMap<BuildingConfig, MepModel>();

/** Memoised generation per config object (configs are treated as immutable). */
export function getMep(cfg: BuildingConfig): MepModel {
  let m = cache.get(cfg);
  if (!m) {
    const g = generateMep(cfg);
    m = Object.freeze({ ...g, records: Object.freeze([...g.records]) });
    cache.set(cfg, m);
  }
  return m;
}
