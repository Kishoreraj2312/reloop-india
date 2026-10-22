/**
 * BuildingModel — renders generated ComponentRecords through the scene hierarchy:
 * Building > Floor > System > Assembly category > Component.
 *   structure:    one mesh per member (ComponentMesh)
 *   architecture, plumbing, electrical: instanced batches per category, material and unit
 *                 shape (InstancedBatch); MEP parts use vertex-coloured unit meshes
 * Visibility (layers, isolation, ceilings) is applied imperatively to the named groups, so
 * toggles never re-render the component tree.
 */

import { useEffect, useMemo } from "react";
import { DoubleSide, FrontSide, Plane, Vector3, type Group } from "three";
import { useThree } from "@react-three/fiber";
import { ARCH_CATEGORIES, type ComponentRecord } from "@/building/structure";
import { AssemblyGroup, BuildingGroup, FloorGroup, SystemGroup } from "./SceneHierarchy";
import { ComponentMesh } from "./ComponentMesh";
import { GeometryPool } from "./geometryPool";
import { createMaterials, disposeMaterials, memberKind } from "./materials";
import { buildSceneTree } from "./sceneTree";
import type { ClipSpec } from "./framing";
import { buildBatches } from "./arch/batches";
import { InstancedBatch } from "./arch/InstancedBatch";
import { createArchMaterials, disposeArchMaterials, partMaterialKey } from "./arch/archMaterials";
import { UnitGeometries } from "./arch/unitGeometry";
import { MEP_MATERIALS } from "@/building/mep/materials";
import { groupVisibility, type ViewState } from "./viewState";

interface BuildingModelProps {
  records: readonly ComponentRecord[];
  onSelect?: (id: string) => void;
  /** Cut the model: keep coordinates <= value along the axis. Members are cut open, so back faces render too. */
  clip?: ClipSpec;
  view: ViewState;
}

export function BuildingModel({ records, onSelect, clip, view }: BuildingModelProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const tree = useMemo(() => buildSceneTree(records), [records]);
  const batches = useMemo(() => {
    const m = new Map<string, ReturnType<typeof buildBatches>>();
    for (const f of tree)
      for (const s of f.systems)
        if (s.system !== "structure") for (const a of s.assemblies) m.set(`${f.floor}|${s.system}|${a.assembly}`, buildBatches(a.records));
    return m;
  }, [tree]);
  const pool = useMemo(() => new GeometryPool(), []);
  const units = useMemo(() => new UnitGeometries(), []);
  const materials = useMemo(() => createMaterials(), []);
  const archMaterials = useMemo(() => createArchMaterials(), []);

  // Per-material (local) clip planes, so the frozen shadow map is clipped too
  // (clipShadows); global renderer clip planes would not apply to the shadow pass.
  useEffect(() => {
    gl.localClippingEnabled = true;
    const normal = clip?.axis === "x" ? new Vector3(-1, 0, 0) : clip?.axis === "z" ? new Vector3(0, 0, -1) : new Vector3(0, -1, 0);
    const plane = clip ? new Plane(normal, clip.value) : null;
    for (const m of [...Object.values(materials), ...archMaterials.values()]) {
      m.clippingPlanes = plane ? [plane] : null;
      m.clipShadows = plane !== null;
      m.side = plane ? DoubleSide : FrontSide;
      m.needsUpdate = true;
    }
    gl.shadowMap.needsUpdate = true; // shadow map is otherwise frozen (see Lighting)
    invalidate();
  }, [clip, materials, archMaterials, gl, invalidate]);

  // X-ray: ghost structure and architecture materials (MEP materials stay opaque).
  useEffect(() => {
    const mep = new Set(MEP_MATERIALS.map((m) => m.id));
    for (const m of [...Object.values(materials), ...archMaterials.values()]) {
      if (mep.has(m.name.split("|")[0]!)) continue;
      const base = (m.userData.base ??= { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite }) as { opacity: number; transparent: boolean; depthWrite: boolean };
      m.opacity = view.xray ? Math.min(base.opacity, 0.12) : base.opacity;
      m.transparent = view.xray ? true : base.transparent;
      m.depthWrite = view.xray ? false : base.depthWrite;
      m.needsUpdate = true;
    }
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [view.xray, materials, archMaterials, gl, invalidate]);

  // Layer / floor visibility: set group flags directly.
  useEffect(() => {
    const vis = groupVisibility(view, ARCH_CATEGORIES);
    const root = scene.getObjectByName("Building_G4") as Group | undefined;
    root?.traverse((o) => {
      const v = vis.get(o.name);
      if (v !== undefined) o.visible = v;
    });
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [view, scene, gl, invalidate, tree]);

  // Dispose GPU resources on unmount. (Re-use after a StrictMode remount is safe: three
  // re-uploads disposed geometries/materials on next draw.)
  useEffect(
    () => () => {
      pool.dispose();
      units.dispose();
      disposeMaterials(materials);
      disposeArchMaterials(archMaterials);
    },
    [pool, units, materials, archMaterials],
  );

  return (
    <BuildingGroup>
      {tree.map((floor) => (
        <FloorGroup key={floor.floor} level={floor.floor}>
          {floor.systems.map((sys) => (
            <SystemGroup key={sys.system} system={sys.system} level={floor.floor}>
              {sys.assemblies.map((a) => (
                <AssemblyGroup key={a.assembly} assembly={a.assembly} system={sys.system} level={floor.floor}>
                  {sys.system === "structure"
                    ? a.records.map((r) => (
                        <ComponentMesh key={r.id} record={r} geometry={pool.get(r.geometry)} material={materials[memberKind(r)]} onSelect={onSelect} />
                      ))
                    : (batches.get(`${floor.floor}|${sys.system}|${a.assembly}`) ?? []).map((b) => (
                        <InstancedBatch
                          key={b.key}
                          batch={b}
                          geometry={units.get(b.shape, b.materialId, b.system !== "architecture")}
                          material={archMaterials.get(b.shape.startsWith("part:") ? partMaterialKey(b.materialId) : b.materialId)!}
                          onSelect={onSelect}
                        />
                      ))}
                </AssemblyGroup>
              ))}
            </SystemGroup>
          ))}
        </FloorGroup>
      ))}
    </BuildingGroup>
  );
}
