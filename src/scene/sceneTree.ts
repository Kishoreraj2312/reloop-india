/**
 * Pure grouping of ComponentRecords into the scene hierarchy:
 * Floor > System (structure) > Assembly > Component.
 */

import { LEVEL_NAMES } from "@/building/config";
import { ASSEMBLY_NAMES, type AssemblyName, type ComponentRecord } from "@/building/structure";
import type { FloorKey } from "./SceneHierarchy";

export const FLOOR_ORDER: readonly FloorKey[] = ["FDN", ...LEVEL_NAMES];

/** A0 floor index (-1 foundation, 0..4, 5 roof) -> floor group key. */
export function floorKeyOf(floor: number): FloorKey {
  return floor < 0 ? "FDN" : LEVEL_NAMES[floor]!;
}

export interface AssemblyNode {
  readonly assembly: AssemblyName;
  readonly records: readonly ComponentRecord[];
}

export interface FloorNode {
  readonly floor: FloorKey;
  readonly assemblies: readonly AssemblyNode[];
}

export function buildSceneTree(records: readonly ComponentRecord[]): FloorNode[] {
  const buckets = new Map<FloorKey, Map<AssemblyName, ComponentRecord[]>>();
  for (const r of records) {
    const fk = floorKeyOf(r.floor);
    let byAssembly = buckets.get(fk);
    if (!byAssembly) buckets.set(fk, (byAssembly = new Map()));
    let list = byAssembly.get(r.assembly);
    if (!list) byAssembly.set(r.assembly, (list = []));
    list.push(r);
  }
  const tree: FloorNode[] = [];
  for (const fk of FLOOR_ORDER) {
    const byAssembly = buckets.get(fk);
    if (!byAssembly) continue;
    const assemblies: AssemblyNode[] = [];
    for (const a of ASSEMBLY_NAMES) {
      const list = byAssembly.get(a);
      if (list) assemblies.push({ assembly: a, records: list });
    }
    tree.push({ floor: fk, assemblies });
  }
  return tree;
}
