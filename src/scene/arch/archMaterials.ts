/**
 * Three.js materials for the architectural and MEP material libraries: one shared
 * MeshStandardMaterial per materialId (PBR, controlled roughness). Glass is plain
 * transparency over the environment map (no transmission), drawn without depth writes, with a Fresnel response (surface/).
 * Presentation overrides of a few render values come from look/palette.ts (MATERIAL_LOOK). Each material also gets a restrained procedural finish chosen from its assumed substance (surface/surfaceSpecs.ts).
 * MEP catalogue parts carry their colours as vertex colours, so they get a white-based
 * variant of their material (`partMaterialKey`).
 */

import { MeshStandardMaterial } from "three";
import { ALL_MATERIALS } from "@/building/materialLibrary";
import { applySurface } from "../surface/surfaceShader";
import { reflectionFor, surfaceSpecFor } from "../surface/surfaceSpecs";
import { MATERIAL_LOOK } from "../look/palette";

export type ArchMaterialSet = Map<string, MeshStandardMaterial>;

export const partMaterialKey = (materialId: string) => `${materialId}|parts`;

export function createArchMaterials(): ArchMaterialSet {
  const set: ArchMaterialSet = new Map();
  for (const m of ALL_MATERIALS) {
    const r = { ...m.render, ...MATERIAL_LOOK[m.id] }; // presentation overrides (look/palette.ts); the library record is unchanged
    const transparent = r.opacity !== undefined && r.opacity < 1;
    const refl = reflectionFor(m.substance, r.roughness, r.envMapIntensity);
    const mat = new MeshStandardMaterial({
      color: r.color,
      roughness: refl.roughness,
      metalness: r.metalness,
      transparent,
      opacity: r.opacity ?? 1,
      depthWrite: !transparent,
      envMapIntensity: refl.envMapIntensity,
    });
    mat.name = m.id;
    applySurface(mat, surfaceSpecFor(m.id, m.substance)); // procedural finish by assumed substance (appearance only)
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
