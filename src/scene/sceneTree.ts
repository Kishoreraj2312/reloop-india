/**
 * Pure grouping of ComponentRecords into the scene hierarchy:
 * Floor > System (structure | architecture | plumbing | electrical) > Assembly category > Component.
 */

import { LEVEL_NAMES } from "@/building/config";
import type { BuildingSystem } from "@/building/types";
import { ARCH_CATEGORIES, ASSEMBLY_NAMES, ELECTRICAL_CATEGORIES, PLUMBING_CATEGORIES, type AssemblyName, type ComponentRecord } from "@/building/structure";
import type { FloorKey } from "./SceneHierarchy";

export const FLOOR_ORDER: readonly FloorKey[] = ["FDN", ...LEVEL_NAMES];
const SYSTEM_ORDER: readonly BuildingSystem[] = ["structure", "architecture", "plumbing", "electrical"];
const ASSEMBLY_ORDER: Readonly<Record<string, readonly AssemblyName[]>> = {
  structure: ASSEMBLY_NAMES,
  architecture: ARCH_CATEGORIES,
  plumbing: PLUMBING_CATEGORIES,
  electrical: ELECTRICAL_CATEGORIES,
};

/** A0 floor index (-1 foundation, 0..4, 5 roof) -> floor group key. */
export function floorKeyOf(floor: number): FloorKey {
  return floor < 0 ? "FDN" : LEVEL_NAMES[floor]!;
}

export interface AssemblyNode {
  readonly assembly: AssemblyName;
  readonly records: readonly ComponentRecord[];
}

export interface SystemNode {
  readonly system: BuildingSystem;
  readonly assemblies: readonly AssemblyNode[];
}

export interface FloorNode {
  readonly floor: FloorKey;
  readonly systems: readonly SystemNode[];
}

export function buildSceneTree(records: readonly ComponentRecord[]): FloorNode[] {
  const buckets = new Map<string, ComponentRecord[]>();
  for (const r of records) {
    const k = `${floorKeyOf(r.floor)}|${r.system}|${r.assembly}`;
    let list = buckets.get(k);
    if (!list) buckets.set(k, (list = []));
    list.push(r);
  }
  const tree: FloorNode[] = [];
  for (const fk of FLOOR_ORDER) {
    const systems: SystemNode[] = [];
    for (const sys of SYSTEM_ORDER) {
      const assemblies: AssemblyNode[] = [];
      for (const a of ASSEMBLY_ORDER[sys] ?? []) {
        const list = buckets.get(`${fk}|${sys}|${a}`);
        if (list) assemblies.push({ assembly: a, records: list });
      }
      if (assemblies.length) systems.push({ system: sys, assemblies });
    }
    if (systems.length) tree.push({ floor: fk, systems });
  }
  return tree;
}
