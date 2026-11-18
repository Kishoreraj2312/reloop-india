/**
 * 3D highlight of a scenario selection (B4). Imperative and fully reversible; it uses the technique B3's removal overlay
 * already proved, on the EXISTING meshes and instanced batches (no second viewer, no duplicate geometry, no scene rebuild):
 * a translucent tint, a child of the source mesh that shares its geometry (instanced: one InstancedMesh per source batch and
 * colour, following the A4 explosion), drawn without depth testing so members enclosed by the facade stay visible.
 *
 * It changes no material, colour or visibility of any component, so floor isolation, layer toggles, X-ray, sections and the
 * A4 exploded views keep working (the tints are children, so they follow their sources and copy the section clipping planes),
 * and removing the tints leaves the model exactly as it was. Priority with the other overlays:
 *   B3 removal simulation   wins: the highlight is not drawn while the simulation is shown
 *   B2 recovery colouring   is suspended while the highlight is drawn (RecoveryColoring) and resumes afterwards
 * The highlight exists only while the scenario workspace is open.
 */

import { useEffect } from "react";
import { DoubleSide, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, type BufferGeometry, type Material, type Plane } from "three";
import { useThree } from "@react-three/fiber";
import { registry } from "@/building/registry";
import type { Pathway } from "@/engine/scenarios";
import { instanceExplosion } from "../explode/instances";
import { useRecovery } from "../recovery/recoveryStore";
import { useRemoval } from "../removal/removalStore";
import { OUTCOME_COLOURS } from "./colors";
import { highlightApplies, highlightMatches, useScenarios } from "./scenarioStore";

const NAME = "__scenario";

/** Dev only: the ids the highlight actually tinted (those that have a drawn mesh), by outcome, for the browser verification. */
export type AppliedHighlight = Record<Pathway, string[]>;
declare global {
  interface Window {
    __scenarioOverlay?: AppliedHighlight;
  }
}

export function ScenarioHighlight({ selectedId, clipKey, xray }: { selectedId: string | null; clipKey: string; xray: boolean }) {
  const sc = useScenarios();
  const rm = useRemoval();
  const recovery = useRecovery();
  const removalActive = rm.open && rm.overlay && rm.plans.some((p) => p.id === rm.activeId);
  const on = highlightApplies(sc, removalActive, recovery.open);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const highlight = sc.highlight;

  useEffect(() => {
    if (!on || !highlight) return;
    const root = scene.getObjectByName("Building_G4");
    if (!root) return;
    const matches = highlightMatches(highlight, sc.basis);

    const inst = new Map<string, InstancedMesh>();
    const plain = new Map<string, Mesh>();
    root.traverse((o) => {
      if (o instanceof InstancedMesh && Array.isArray(o.userData.componentIds)) inst.set(o.uuid, o);
      else if (o instanceof Mesh && typeof o.userData.componentId === "string") plain.set(o.userData.componentId as string, o);
    });

    const undo: (() => void)[] = [];
    const tmp = new Matrix4();
    const applied: AppliedHighlight = { direct_reuse: [], refurbish_reuse: [], recycling: [], disposal: [], unknown: [] };

    type Group = { src: InstancedMesh | Mesh; geometry: BufferGeometry; srcMat: Material; outcome: Pathway; colour: number | undefined; idx: number[] };
    const groups = new Map<string, Group>();
    for (const m of matches) {
      if (m.id === selectedId) continue; // the selection outline marks the selected component itself
      const at = registry.getInstance(m.id);
      const im = at && inst.get(at.meshUuid);
      const src = im && at ? im : plain.get(m.id);
      if (!src) continue;
      const key = `${src.uuid}|${m.outcome}|${m.colour ?? ""}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { src, geometry: src.geometry, srcMat: src.material as Material, outcome: m.outcome, colour: m.colour, idx: [] }));
      if (im && at) g.idx.push(at.index);
      applied[m.outcome].push(m.id);
    }

    // section clipping: the building's materials share one clip plane (or none); copy it so tints are cut too
    const firstMat = groups.size ? [...groups.values()][0]!.srcMat : undefined;
    const clipping: Plane[] | null = firstMat?.clippingPlanes ?? null;
    const mats = new Map<number, MeshBasicMaterial>();
    const matFor = (p: Pathway, own: number | undefined) => {
      const colour = highlight.colour ?? own ?? OUTCOME_COLOURS[p];
      let m = mats.get(colour);
      if (!m) {
        m = new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        m.clippingPlanes = clipping;
        mats.set(colour, m);
      }
      return m;
    };
    for (const g of groups.values()) {
      const mat = matFor(g.outcome, g.colour);
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
      overlay.renderOrder = 997;
      overlay.raycast = () => undefined; // never intercepts clicks
      g.src.add(overlay);
      undo.push(() => g.src.remove(overlay));
    }

    gl.shadowMap.needsUpdate = true; // the shadow map is frozen between view changes
    if (import.meta.env?.DEV) window.__scenarioOverlay = applied;
    invalidate();
    return () => {
      if (import.meta.env?.DEV) delete window.__scenarioOverlay;
      for (let i = undo.length - 1; i >= 0; i--) undo[i]!();
      mats.forEach((m) => m.dispose());
      gl.shadowMap.needsUpdate = true;
      invalidate();
    };
    // sc.scenarios / recovery.assessments: the matched components change when an assumption or an assessment changes;
    // clipKey / xray: re-read the section plane when the section or opacity changes
  }, [on, highlight, sc.basis, sc.scenarios, recovery.assessments, selectedId, scene, gl, invalidate, clipKey, xray]);

  return null;
}
