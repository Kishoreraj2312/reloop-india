/**
 * Dev-only selection feedback: an edge outline plus a faint tint on the selected
 * component. Both are children of the selected mesh, so they follow its transform.
 */

import { useEffect } from "react";
import {
  DoubleSide,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from "three";
import { useThree } from "@react-three/fiber";

const ACCENT = 0xff5a1f;

export function SelectionOutline({ selectedId }: { selectedId: string | null }) {
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (!selectedId) return;
    const target = scene.getObjectByName(selectedId);
    if (!(target instanceof Mesh)) return;

    const edges = new EdgesGeometry(target.geometry, 20);
    const lineMat = new LineBasicMaterial({ color: ACCENT, depthTest: false, transparent: true });
    const lines = new LineSegments(edges, lineMat);
    const tintMat = new MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.35,
      depthTest: false,
      side: DoubleSide,
    });
    const tint = new Mesh(target.geometry, tintMat); // shares the geometry: not disposed here
    for (const o of [lines, tint]) {
      o.renderOrder = 999;
      o.raycast = () => undefined; // never intercept clicks
      o.name = `${selectedId}__selection`;
      target.add(o);
    }
    invalidate();
    return () => {
      target.remove(lines, tint);
      edges.dispose();
      lineMat.dispose();
      tintMat.dispose();
      invalidate();
    };
  }, [selectedId, scene, invalidate]);

  return null;
}
