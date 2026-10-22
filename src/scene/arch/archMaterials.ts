/**
 * Three.js materials for the architectural material library: one shared
 * MeshStandardMaterial per materialId (PBR, controlled roughness). Glass is plain
 * transparency over the environment map (no transmission), drawn without depth writes.
 */

import { MeshStandardMaterial } from "three";
import { ARCH_MATERIALS } from "@/building/architecture/materials";

export type ArchMaterialSet = Map<string, MeshStandardMaterial>;

export function createArchMaterials(): ArchMaterialSet {
  const set: ArchMaterialSet = new Map();
  for (const m of ARCH_MATERIALS) {
    const r = m.render;
    const transparent = r.opacity !== undefined && r.opacity < 1;
    const mat = new MeshStandardMaterial({
      color: r.color,
      roughness: r.roughness,
      metalness: r.metalness,
      transparent,
      opacity: r.opacity ?? 1,
      depthWrite: !transparent,
      envMapIntensity: r.envMapIntensity ?? 1,
    });
    mat.name = m.id;
    set.set(m.id, mat);
  }
  return set;
}

export function disposeArchMaterials(set: ArchMaterialSet): void {
  for (const m of set.values()) m.dispose();
  set.clear();
}
