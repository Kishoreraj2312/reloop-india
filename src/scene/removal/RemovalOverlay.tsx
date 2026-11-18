/**
 * 3D removal-simulation overlay (B3). Imperative and fully reversible; it reuses the EXISTING meshes and instanced
 * batches (no second viewer, no duplicate geometry, no scene rebuild):
 *   simulated as removed   instanced components: the LINEAR part of the instance matrix is zeroed (elements 0..11, original
 *                          saved and restored byte for byte; the translation belongs to the A4 explosion and is never touched);
 *                          plain meshes: mesh.visible = false (previous value restored)
 *   planned / blocked / prerequisite / dependent / advisory
 *                          translucent tint meshes, children of the source mesh that share its geometry
 *                          (instanced: one InstancedMesh per source batch and colour). They are drawn without depth
 *                          testing so members enclosed by the facade stay visible; removing a step makes its ghost vanish.
 * It runs only while the removal drawer is open with "Show in 3D" on and a plan active. While it runs, B2's colour
 * overlay is suspended (RecoveryColoring), so the two never write the same materials; B2 resumes on exit.
 * Layers, floor isolation, X-ray, sections and the camera are untouched: the tints are children of the meshes, so
 * they follow their visibility, and they copy the section clipping planes.
 */

import { useEffect } from "react";
import { DoubleSide, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, type BufferGeometry, type Material, type Plane } from "three";
import { useThree } from "@react-three/fiber";
import { registry } from "@/building/registry";
import { getModelGraph, highlightSets } from "@/engine/removal";
import { REMOVAL_COLOURS, type RemovalColourKey } from "./colors";
import { hideInstance, restoreInstance } from "./hide";
import { instanceExplosion } from "../explode/instances";
import { analysisOf, removedSet, useRemoval } from "./removalStore";

const NAME = "__removal";

/** Dev only: the ids the overlay actually hid / tinted (those that have a drawn mesh), for the browser verification. */
export interface AppliedOverlay {
  hidden: string[];
  planned: string[];
  blocked: string[];
  prerequisite: string[];
  dependent: string[];
  advisory: string[];
}
declare global {
  interface Window {
    __removalOverlay?: AppliedOverlay;
  }
}

export function RemovalOverlay({ selectedId, clipKey, xray }: { selectedId: string | null; clipKey: string; xray: boolean }) {
  const rs = useRemoval();
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const plan = rs.plans.find((p) => p.id === rs.activeId);
  const on = rs.open && rs.overlay && plan !== undefined;

  useEffect(() => {
    if (!on || !plan) return;
    const root = scene.getObjectByName("Building_G4");
    if (!root) return;

    const graph = getModelGraph();
    const analysis = analysisOf(plan);
    const removed = removedSet(plan);
    const sets = highlightSets(graph, analysis, plan, selectedId, removed);

    // one traversal: where every drawn component lives
    const inst = new Map<string, InstancedMesh>();
    const plain = new Map<string, Mesh>();
    root.traverse((o) => {
      if (o instanceof InstancedMesh && Array.isArray(o.userData.componentIds)) inst.set(o.uuid, o);
      else if (o instanceof Mesh && typeof o.userData.componentId === "string") plain.set(o.userData.componentId as string, o);
    });

    const undo: (() => void)[] = [];
    const tmp = new Matrix4();
    const applied: AppliedOverlay = { hidden: [], planned: [], blocked: [], prerequisite: [], dependent: [], advisory: [] };

    // 1) hide the components simulated as removed
    const saved = new Map<InstancedMesh, { index: number; m: Float32Array }[]>();
    for (const id of removed) {
      const at = registry.getInstance(id);
      const im = at && inst.get(at.meshUuid);
      if (im && at) {
        applied.hidden.push(id);
        (saved.get(im) ?? saved.set(im, []).get(im)!).push({ index: at.index, m: hideInstance(im.instanceMatrix.array as Float32Array, at.index) });
        continue;
      }
      const pm = plain.get(id);
      if (pm) {
        applied.hidden.push(id);
        const was = pm.visible;
        pm.visible = false;
        undo.push(() => (pm.visible = was));
      }
    }
    for (const [im, list] of saved) {
      im.instanceMatrix.needsUpdate = true;
      undo.push(() => {
        for (const s of list) restoreInstance(im.instanceMatrix.array as Float32Array, s.index, s.m);
        im.instanceMatrix.needsUpdate = true;
      });
    }

    // 2) tint planned / blocked / relatives (later layers win: a relative is shown over the plan colour)
    const colour = new Map<string, { hex: number; rel: boolean; key: RemovalColourKey }>();
    const paint = (ids: ReadonlySet<string>, key: RemovalColourKey, rel: boolean) => ids.forEach((id) => colour.set(id, { hex: REMOVAL_COLOURS[key], rel, key }));
    paint(sets.planned, "planned", false);
    paint(sets.blocked, "blocked", false);
    paint(sets.advisory, "advisory", true);
    paint(sets.dependents, "dependent", true);
    paint(sets.prerequisites, "prerequisite", true);
    colour.delete(selectedId ?? "\0"); // the selection outline marks the focused component itself

    type Group = { src: InstancedMesh | Mesh; geometry: BufferGeometry; srcMat: Material; hex: number; rel: boolean; idx: number[] };
    const groups = new Map<string, Group>();
    for (const [id, c] of colour) {
      const at = registry.getInstance(id);
      const im = at && inst.get(at.meshUuid);
      const src = im && at ? im : plain.get(id);
      if (!src) continue;
      const key = `${src.uuid}|${c.hex}|${c.rel}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { src, geometry: src.geometry, srcMat: src.material as Material, hex: c.hex, rel: c.rel, idx: [] }));
      if (im && at) g.idx.push(at.index);
      applied[c.key].push(id);
    }
    // section clipping: the building's materials share one clip plane (or none); copy it so tints are cut too
    const firstMat = groups.size ? [...groups.values()][0]!.srcMat : undefined;
    const clipping: Plane[] | null = firstMat?.clippingPlanes ?? null;
    const mats = new Map<string, MeshBasicMaterial>();
    const matFor = (hexv: number, rel: boolean) => {
      const k = `${hexv}|${rel}`;
      let m = mats.get(k);
      if (!m) {
        m = new MeshBasicMaterial({ color: hexv, transparent: true, opacity: rel ? 0.7 : 0.42, depthWrite: false, depthTest: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        m.clippingPlanes = clipping;
        mats.set(k, m);
      }
      return m;
    };
    for (const g of groups.values()) {
      const mat = matFor(g.hex, g.rel);
      let overlay: Mesh | InstancedMesh;
      if (g.src instanceof InstancedMesh) {
        const src = g.src;
        const o = new InstancedMesh(g.geometry, mat, g.idx.length);
        // mirror the source instances' CANONICAL matrices; the explosion moves the copies together with their sources (follow)
        const canonical = instanceExplosion.canonicalOf(src);
        const copy = new Float32Array(g.idx.length * 16);
        g.idx.forEach((srcIndex, k) => {
          if (canonical) copy.set(canonical.subarray(srcIndex * 16, srcIndex * 16 + 16), k * 16);
          else {
            src.getMatrixAt(srcIndex, tmp);
            tmp.toArray(copy, k * 16);
          }
        });
        (o.instanceMatrix.array as Float32Array).set(copy);
        o.instanceMatrix.needsUpdate = true;
        o.frustumCulled = false;
        const srcIds = src.userData.componentIds as string[];
        instanceExplosion.follow(o, g.idx.map((i) => srcIds[i]!), copy);
        undo.push(() => {
          instanceExplosion.unregister(o);
          o.dispose();
        });
        overlay = o;
      } else {
        overlay = new Mesh(g.geometry, mat);
      }
      overlay.name = NAME;
      overlay.renderOrder = g.rel ? 999 : 998;
      overlay.raycast = () => undefined; // never intercepts clicks
      g.src.add(overlay);
      undo.push(() => g.src.remove(overlay));
    }

    gl.shadowMap.needsUpdate = true; // the shadow map is frozen between view changes
    if (import.meta.env?.DEV) window.__removalOverlay = applied;
    invalidate();
    return () => {
      if (import.meta.env?.DEV) delete window.__removalOverlay;
      for (let i = undo.length - 1; i >= 0; i--) undo[i]!();
      mats.forEach((m) => m.dispose());
      gl.shadowMap.needsUpdate = true;
      invalidate();
    };
    // clipKey / xray: re-read the section plane when the section or opacity changes
  }, [on, plan, selectedId, scene, gl, invalidate, clipKey, xray]);

  return null;
}
