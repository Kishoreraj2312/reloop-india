/**
 * Selection feedback: an edge outline plus a faint tint on the selected component. For a
 * plain mesh both are children of the mesh; for an instanced component they are children
 * of its InstancedMesh carrying the instance matrix. Selecting an assembly highlights all
 * of its children. Nothing here writes to records or instance buffers.
 */

import { useEffect } from "react";
import {
  DoubleSide,
  EdgesGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from "three";
import { useThree } from "@react-three/fiber";
import { registry } from "@/building/registry";
import { instanceExplosion } from "./explode/instances";

const ACCENT = 0xd9531e; // a calm deep orange: visible on pale plaster and on dark ghosts without glowing

export function SelectionOutline({ selectedId, traceIds = [] }: { selectedId: string | null; traceIds?: readonly string[] }) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (!selectedId && !traceIds.length) return;
    const sel = selectedId ? registry.getById(selectedId) : undefined;
    const drawn = !!selectedId && (scene.getObjectByName(selectedId) instanceof Mesh || registry.getInstance(selectedId) !== undefined);
    const own = sel ? (drawn ? [sel.id] : registry.getChildren(sel.id).map((c) => c.id)) : []; // an assembly: its children
    const targets = [...new Set([...own, ...traceIds])];
    const lineMat = new LineBasicMaterial({ color: ACCENT, depthTest: false, depthWrite: false, transparent: true });
    const tintMat = new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.28, depthTest: false, depthWrite: false, side: DoubleSide });
    const added: { parent: Object3D; objs: Object3D[]; edges: EdgesGeometry }[] = [];
    const unfollow: (() => void)[] = []; // A4: outlines of instances follow an exploded assembly
    const edgeCache = new Map<string, EdgesGeometry>();
    for (const id of targets) {
      let parent: Object3D | undefined;
      let geometry;
      let matrix: Matrix4 | null = null;
      const plain = scene.getObjectByName(id);
      if (plain instanceof Mesh) {
        parent = plain;
        geometry = plain.geometry;
      } else {
        const inst = registry.getInstance(id);
        const mesh = inst && scene.getObjectByProperty("uuid", inst.meshUuid);
        if (!(mesh instanceof InstancedMesh)) continue;
        parent = mesh;
        geometry = mesh.geometry;
        matrix = new Matrix4();
        const canonical = instanceExplosion.canonicalOf(mesh); // the generated matrix: the explosion offsets are added by the follower below
        if (canonical) matrix.fromArray(canonical, inst!.index * 16);
        else mesh.getMatrixAt(inst!.index, matrix);
      }
      let edges = edgeCache.get(geometry.uuid);
      if (!edges) edgeCache.set(geometry.uuid, (edges = new EdgesGeometry(geometry, 20)));
      const lines = new LineSegments(edges, lineMat);
      const tint = new Mesh(geometry, tintMat); // shares the geometry: not disposed here
      for (const o of [lines, tint]) {
        o.renderOrder = 999;
        o.raycast = () => undefined; // never intercept clicks
        o.name = `${id}__selection`;
        if (matrix) {
          o.matrixAutoUpdate = false;
          o.matrix.copy(matrix);
        }
        parent.add(o);
        if (matrix) unfollow.push(instanceExplosion.followObject(o, id));
      }
      added.push({ parent, objs: [lines, tint], edges });
    }
    invalidate();
    return () => {
      for (const u of unfollow) u();
      for (const a of added) a.parent.remove(...a.objs);
      for (const e of edgeCache.values()) e.dispose();
      lineMat.dispose();
      tintMat.dispose();
      invalidate();
    };
  }, [selectedId, traceIds, scene, invalidate]);

  return null;
}
