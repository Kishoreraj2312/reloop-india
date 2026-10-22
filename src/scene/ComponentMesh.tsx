/**
 * ComponentMesh — the single place a ComponentRecord becomes a Three.js mesh.
 *
 * Identity (userData.componentId, mesh name, registry link) lives here, so swapping the
 * one-mesh-per-component strategy for instancing later only changes this wrapper.
 * Position/rotation are copied from the record's originalPosition/originalRotation;
 * the record itself is never written to.
 */

import { memo, useEffect, useMemo, useRef } from "react";
import type { BufferGeometry, Material, Mesh } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { registry } from "@/building/registry";
import { visibleInScene } from "./arch/InstancedBatch";
import type { ComponentRecord } from "@/building/structure";

interface ComponentMeshProps {
  record: ComponentRecord;
  geometry: BufferGeometry;
  material: Material;
  onSelect?: (id: string) => void;
}

export const ComponentMesh = memo(function ComponentMesh({
  record,
  geometry,
  material,
  onSelect,
}: ComponentMeshProps) {
  const ref = useRef<Mesh>(null);
  const position = useMemo(() => [...record.originalPosition] as [number, number, number], [record]);
  const rotation = useMemo(() => [...record.originalRotation] as [number, number, number], [record]);
  const userData = useMemo(() => ({ componentId: record.id }), [record.id]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    registry.linkMesh(mesh.uuid, record.id);
    return () => registry.unlinkMesh(mesh.uuid);
  }, [record.id]);

  return (
    <mesh
      ref={ref}
      name={record.id}
      userData={userData}
      position={position}
      rotation={rotation}
      geometry={geometry}
      material={material}
      castShadow
      receiveShadow
      onClick={
        onSelect
          ? (e: ThreeEvent<MouseEvent>) => {
              if (!visibleInScene(e.object)) return; // hidden layers do not catch clicks
              e.stopPropagation();
              onSelect(record.id);
            }
          : undefined
      }
    />
  );
});
