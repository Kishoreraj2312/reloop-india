/**
 * One InstancedMesh per batch (floor > category > material > unit shape). Identity lives
 * here: userData.componentIds[i] and the registry instance link map instanceId -> component.
 */

import { memo, useEffect, useMemo } from "react";
import { InstancedMesh, type BufferGeometry, type Material, type Object3D } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { registry } from "@/building/registry";
import type { Batch } from "./batches";
import { instanceExplosion } from "../explode/instances";

/** True if the object and all its ancestors are visible (R3F raycasts hidden objects too). */
export function visibleInScene(o: Object3D | null): boolean {
  for (let c: Object3D | null = o; c; c = c.parent) if (!c.visible) return false;
  return true;
}

interface InstancedBatchProps {
  batch: Batch;
  geometry: BufferGeometry;
  material: Material;
  onSelect?: (id: string) => void;
}

export const InstancedBatch = memo(function InstancedBatch({ batch, geometry, material, onSelect }: InstancedBatchProps) {
  const mesh = useMemo(() => {
    const m = new InstancedMesh(geometry, material, batch.ids.length);
    m.instanceMatrix.array.set(batch.matrices);
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingBox();
    m.computeBoundingSphere();
    m.name = `batch:${batch.key}`;
    m.userData = { componentIds: batch.ids, batchKey: batch.key };
    m.castShadow = !material.transparent;
    m.receiveShadow = true;
    return m;
  }, [batch, geometry, material]);

  useEffect(() => {
    registry.linkInstances(mesh.uuid, batch.ids);
    // A4: the batch's generated matrices are the canonical reference the exploded view is derived from (never written)
    instanceExplosion.register(mesh, batch.ids, batch.matrices);
    return () => {
      registry.unlinkInstances(mesh.uuid);
      instanceExplosion.unregister(mesh);
      mesh.dispose(); // instance buffers only; geometry and material are shared
    };
  }, [mesh, batch]);

  return (
    <primitive
      object={mesh}
      onClick={
        onSelect
          ? (e: ThreeEvent<MouseEvent>) => {
              if (e.instanceId === undefined || !visibleInScene(e.object)) return;
              e.stopPropagation();
              onSelect(batch.ids[e.instanceId]!);
            }
          : undefined
      }
    />
  );
});
