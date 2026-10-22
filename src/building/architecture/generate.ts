/**
 * ReLoop India — A2 architecture generator entry point.
 *
 * generateArchitecture: BuildingConfig -> ComponentRecord[] (pure, deterministic), from the
 * same plan model the validators check. Output order per storey: walls, openings,
 * balconies; then facade, entrance and roof.
 */

import { validateConfig, type BuildingConfig } from "../config";
import type { ComponentRecord } from "../structure";
import { ARCH_CONFIG, validateArchConfig, type ArchitectureConfig } from "./config";
import { buildFloorPlan, type FloorPlan } from "./plan";
import { generateWalls, type WallBuild } from "./walls";
import { generateOpenings } from "./openings";
import { generateBalconies } from "./balconies";
import { generateFacade } from "./facade";
import { generateEntrance } from "./entrance";
import { generateRoof } from "./roof";

export interface StoreyBuild {
  readonly plan: FloorPlan;
  readonly walls: readonly WallBuild[];
}

export interface ArchitectureModel {
  readonly records: readonly ComponentRecord[];
  readonly storeys: readonly StoreyBuild[];
}

export function generateArchitectureModel(cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): ArchitectureModel {
  const errors = [...validateConfig(cfg), ...validateArchConfig(cfg, arch)];
  if (errors.length > 0) throw new Error(`Invalid config: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`);
  const records: ComponentRecord[] = [];
  const storeys: StoreyBuild[] = [];
  for (let s = 0; s < cfg.storeyCount; s++) {
    const plan = buildFloorPlan(cfg, s, arch);
    const w = generateWalls(plan, cfg, arch);
    records.push(...w.records, ...generateOpenings(plan, w.walls, cfg, arch), ...generateBalconies(plan, cfg, arch));
    storeys.push({ plan, walls: w.walls });
  }
  const ground = storeys[0]!.plan;
  const typical = storeys[Math.min(1, storeys.length - 1)]!.plan;
  records.push(
    ...generateFacade({ cfg, arch, balconies: typical.balconies, ground }),
    ...generateEntrance(ground, typical.balconies, cfg, arch),
    ...generateRoof(typical.balconies, cfg, arch),
  );
  return { records, storeys };
}

export function generateArchitecture(cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): ComponentRecord[] {
  return [...generateArchitectureModel(cfg, arch).records];
}

const cache = new WeakMap<BuildingConfig, ArchitectureModel>();

/** Memoised generation per config object (configs are treated as immutable). */
export function getArchitecture(cfg: BuildingConfig): ArchitectureModel {
  let m = cache.get(cfg);
  if (!m) {
    const g = generateArchitectureModel(cfg);
    m = Object.freeze({ records: Object.freeze(g.records), storeys: g.storeys });
    cache.set(cfg, m);
  }
  return m;
}
