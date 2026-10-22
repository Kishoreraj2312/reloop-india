/**
 * StructuralModel — renders generated ComponentRecords through the scene hierarchy:
 * Building > Floor > System(structure) > Assembly > Component.
 */

import { useEffect, useMemo } from "react";
import { DoubleSide, FrontSide, Plane, Vector3 } from "three";
import { useThree } from "@react-three/fiber";
import type { ComponentRecord } from "@/building/structure";
import { AssemblyGroup, BuildingGroup, FloorGroup, SystemGroup } from "./SceneHierarchy";
import { ComponentMesh } from "./ComponentMesh";
import { GeometryPool } from "./geometryPool";
import { createMaterials, disposeMaterials, memberKind } from "./materials";
import { buildSceneTree } from "./sceneTree";
import type { ClipSpec } from "./framing";

interface StructuralModelProps {
  records: readonly ComponentRecord[];
  onSelect?: (id: string) => void;
  /** Cut the model: keep coordinates <= value along the axis. Members are cut open, so back faces render too. */
  clip?: ClipSpec;
}

export function StructuralModel({ records, onSelect, clip }: StructuralModelProps) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const tree = useMemo(() => buildSceneTree(records), [records]);
  const pool = useMemo(() => new GeometryPool(), []);
  const materials = useMemo(() => createMaterials(), []);

  // Per-material (local) clip planes, so the frozen shadow map is clipped too
  // (clipShadows); global renderer clip planes would not apply to the shadow pass.
  useEffect(() => {
    gl.localClippingEnabled = true;
    const plane = clip
      ? new Plane(clip.axis === "z" ? new Vector3(0, 0, -1) : new Vector3(0, -1, 0), clip.value)
      : null;
    for (const m of Object.values(materials)) {
      m.clippingPlanes = plane ? [plane] : null;
      m.clipShadows = plane !== null;
      m.side = plane ? DoubleSide : FrontSide;
      m.needsUpdate = true;
    }
    gl.shadowMap.needsUpdate = true; // shadow map is otherwise frozen (see Lighting)
    invalidate();
  }, [clip, materials, gl, invalidate]);

  // Dispose GPU resources on unmount. (Re-use after a StrictMode remount is safe: three
  // re-uploads disposed geometries/materials on next draw.)
  useEffect(
    () => () => {
      pool.dispose();
      disposeMaterials(materials);
    },
    [pool, materials],
  );

  return (
    <BuildingGroup>
      {tree.map((floor) => (
        <FloorGroup key={floor.floor} level={floor.floor}>
          <SystemGroup system="structure" level={floor.floor}>
            {floor.assemblies.map((a) => (
              <AssemblyGroup key={a.assembly} assembly={a.assembly} system="structure" level={floor.floor}>
                {a.records.map((r) => (
                  <ComponentMesh
                    key={r.id}
                    record={r}
                    geometry={pool.get(r.geometry)}
                    material={materials[memberKind(r)]}
                    onSelect={onSelect}
                  />
                ))}
              </AssemblyGroup>
            ))}
          </SystemGroup>
        </FloorGroup>
      ))}
    </BuildingGroup>
  );
}
