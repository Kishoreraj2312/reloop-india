/**
 * ReLoop India — combined material lookup over the A2 architectural and A3 MEP libraries.
 * Structure keeps its own single material (STRUCTURAL_MATERIAL).
 */

import { ARCH_MATERIALS, type ArchMaterial } from "./architecture/materials";
import { MEP_MATERIALS } from "./mep/materials";

export const ALL_MATERIALS: readonly ArchMaterial[] = Object.freeze([...ARCH_MATERIALS, ...MEP_MATERIALS]);

const BY_ID = new Map(ALL_MATERIALS.map((x) => [x.id, x]));

export function materialById(id: string): ArchMaterial {
  const x = BY_ID.get(id);
  if (!x) throw new Error(`Unknown material "${id}"`);
  return x;
}

export function hasMaterial(id: string): boolean {
  return BY_ID.has(id);
}
