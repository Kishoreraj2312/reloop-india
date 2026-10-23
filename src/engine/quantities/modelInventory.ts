/**
 * The default building's inventory (STR + ARC + MEP records, the same arrays the viewer registers),
 * built once and shared by the inspector and the inventory drawer.
 */

import { DEFAULT_CONFIG, type BuildingConfig } from "@/building/config";
import { getStructure } from "@/building/structure";
import { getArchitecture } from "@/building/architecture/generate";
import { getMep } from "@/building/mep/generate";
import type { ComponentRecord } from "@/building/structure";
import { buildInventory, type Inventory } from "./inventory";

const recordCache = new WeakMap<BuildingConfig, readonly ComponentRecord[]>();

export function modelRecords(cfg: BuildingConfig = DEFAULT_CONFIG): readonly ComponentRecord[] {
  let r = recordCache.get(cfg);
  if (!r) recordCache.set(cfg, (r = Object.freeze([...getStructure(cfg), ...getArchitecture(cfg).records, ...getMep(cfg).records])));
  return r;
}

export function getModelInventory(cfg: BuildingConfig = DEFAULT_CONFIG): Inventory {
  return buildInventory(modelRecords(cfg), getArchitecture(cfg));
}
