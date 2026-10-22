/**
 * Three.js materials for the architectural and MEP material libraries: one shared
 * MeshStandardMaterial per materialId (PBR, controlled roughness). Glass is plain
 * transparency over the environment map (no transmission), drawn without depth writes.
 * MEP catalogue parts carry their colours as vertex colours, so they get a white-based
 * variant of their material (`partMaterialKey`).
 */

import { MeshStandardMaterial } from "three";
import { ALL_MATERIALS } from "@/building/materialLibrary";

export type ArchMaterialSet = Map<string, MeshStandardMaterial>;

export const partMaterialKey = (materialId: string) => `${materialId}|parts`;

export function createArchMaterials(): ArchMaterialSet {
  const set: ArchMaterialSet = new Map();
  for (const m of ALL_MATERIALS) {
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
    const pm = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: r.roughness, metalness: r.metalness, envMapIntensity: r.envMapIntensity ?? 1 });
    pm.name = partMaterialKey(m.id);
    set.set(pm.name, pm);
  }
  return set;
}

export function disposeArchMaterials(set: ArchMaterialSet): void {
  for (const m of set.values()) m.dispose();
  set.clear();
}
