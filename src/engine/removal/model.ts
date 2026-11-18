/** The default building's relationship graph (STR + ARC + MEP records, the same arrays the viewer registers), built once. */

import { DEFAULT_CONFIG, type BuildingConfig } from "@/building/config";
import { modelRecords } from "@/engine/quantities";
import { nodeOf, RelationshipGraph } from "./graph";

const cache = new WeakMap<BuildingConfig, RelationshipGraph>();

export function getModelGraph(cfg: BuildingConfig = DEFAULT_CONFIG): RelationshipGraph {
  let g = cache.get(cfg);
  if (!g) cache.set(cfg, (g = new RelationshipGraph(modelRecords(cfg).map(nodeOf))));
  return g;
}
