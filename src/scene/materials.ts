/**
 * One material per structural member type (restrained, distinct warm-neutral concrete tones, with a shared procedural
 * concrete finish; appearance only: A1 records one assumed RCC material for every member).
 */

import { MeshStandardMaterial, type Material } from "three";
import type { ComponentRecord } from "@/building/structure";
import { applySurface } from "./surface/surfaceShader";
import { STRUCTURE_SPEC } from "./surface/surfaceSpecs";

export type MemberKind = "footing" | "pedestal" | "column" | "beam" | "slab" | "stair";

export const MEMBER_COLORS: Record<MemberKind, number> = {
  footing: 0x6a6863, // dark
  pedestal: 0x7b7973,
  column: 0xa19e97, // mid
  beam: 0xb6b3ab, // lighter
  slab: 0xd0cdc6, // pale
  stair: 0xc3a984, // warm neutral
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
  const make = (kind: MemberKind) => {
    const m = new MeshStandardMaterial({ color: MEMBER_COLORS[kind], roughness: 0.9, metalness: 0 });
    applySurface(m, STRUCTURE_SPEC);
    return m;
  };
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
