/**
 * One material per structural member type (restrained, distinct neutrals).
 */

import { MeshStandardMaterial, type Material } from "three";
import type { ComponentRecord } from "@/building/structure";

export type MemberKind = "footing" | "pedestal" | "column" | "beam" | "slab" | "stair";

export const MEMBER_COLORS: Record<MemberKind, number> = {
  footing: 0x474c52, // dark grey
  pedestal: 0x5a6068,
  column: 0x848b93, // mid grey
  beam: 0xaab0b6, // lighter grey
  slab: 0xd3d7da, // pale
  stair: 0xc4a77f, // warm neutral
};

export function memberKind(r: ComponentRecord): MemberKind {
  switch (r.componentType) {
    case "footing":
    case "pedestal":
    case "column":
    case "beam":
    case "slab":
      return r.componentType;
    case "stair_flight":
    case "stair_landing":
      return "stair";
    default:
      throw new Error(`No material for component type "${r.componentType}"`);
  }
}

export type MaterialSet = Record<MemberKind, MeshStandardMaterial>;

export function createMaterials(): MaterialSet {
  const make = (kind: MemberKind) =>
    new MeshStandardMaterial({ color: MEMBER_COLORS[kind], roughness: 0.92, metalness: 0 });
  return {
    footing: make("footing"),
    pedestal: make("pedestal"),
    column: make("column"),
    beam: make("beam"),
    slab: make("slab"),
    stair: make("stair"),
  };
}

export function disposeMaterials(set: MaterialSet): void {
  for (const m of Object.values(set) as Material[]) m.dispose();
}
