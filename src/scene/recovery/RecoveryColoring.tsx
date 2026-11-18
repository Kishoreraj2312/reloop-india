/**
 * 3D recovery overlay (B2). Imperative and reversible: it recolours the EXISTING meshes and instanced
 * batches (no second viewer, no duplicate geometry) and restores them on switch-off.
 *   plain meshes (structure)  swap to a cached per-status clone of their material
 *   instanced batches         swap to a white clone of their material and write instanceColor
 * Clones copy the original's clipping planes, side and transparency, so section views and glass
 * still work. Selection outlines are children of the meshes and are not touched.
 * While the B3 removal simulation is shown it takes priority: this overlay is suspended (originals restored) and
 * resumes when the simulation is hidden, so the two never write the same materials. It is suspended the same way while a
 * B4 scenario highlight is shown, so one colour meaning is on screen at a time.
 */

import { useEffect } from "react";
import { Color, InstancedMesh, Mesh, MeshStandardMaterial, type Material, type Object3D } from "three";
import { useThree } from "@react-three/fiber";
import { STATUS_COLOURS } from "./colors";
import { useRemoval } from "../removal/removalStore";
import { useScenarios } from "../scenarios/scenarioStore";
import { useRecovery } from "./recoveryStore";

export function RecoveryColoring({ clipKey, xray }: { clipKey: string; xray: boolean }) {
  const { colour, assessments, focus } = useRecovery();
  const rm = useRemoval();
  const sc = useScenarios();
  const suspended = (rm.open && rm.overlay && rm.plans.some((p) => p.id === rm.activeId)) || ((sc.open || sc.externalOpen) && sc.highlight !== null);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (!colour || suspended) return;
    const root = scene.getObjectByName("Building_G4");
    if (!root) return;
    const cls = (id: string): number => {
      if (focus && !focus.has(id)) return STATUS_COLOURS.dimmed;
      return STATUS_COLOURS[assessments.get(id)?.classification ?? "unassessed"];
    };
    const clones: Material[] = [];
    const restore: (() => void)[] = [];
    const white = new Map<Material, MeshStandardMaterial>();
    const tinted = new Map<string, MeshStandardMaterial>();
    const clone = (orig: Material, colourHex: number): MeshStandardMaterial => {
      const m = (orig as MeshStandardMaterial).clone();
      m.color.setHex(colourHex);
      m.vertexColors = false;
      m.needsUpdate = true;
      clones.push(m);
      return m;
    };
    const c = new Color();
    root.traverse((o: Object3D) => {
      if (o.name.endsWith("__selection")) return;
      if (o instanceof InstancedMesh && Array.isArray(o.userData.componentIds)) {
        const ids = o.userData.componentIds as string[];
        const orig = o.material as Material;
        let w = white.get(orig);
        if (!w) white.set(orig, (w = clone(orig, 0xffffff)));
        o.material = w;
        ids.forEach((id, i) => o.setColorAt(i, c.setHex(cls(id))));
        if (o.instanceColor) o.instanceColor.needsUpdate = true;
        restore.push(() => {
          o.material = orig;
          o.instanceColor = null;
        });
      } else if (o instanceof Mesh && typeof o.userData.componentId === "string") {
        const orig = o.material as Material;
        const hexv = cls(o.userData.componentId as string);
        const key = `${orig.uuid}|${hexv}`;
        let t = tinted.get(key);
        if (!t) tinted.set(key, (t = clone(orig, hexv)));
        o.material = t;
        restore.push(() => {
          o.material = orig;
        });
      }
    });
    invalidate();
    return () => {
      restore.forEach((r) => r());
      clones.forEach((m) => m.dispose());
      invalidate();
    };
    // clipKey / xray: re-clone when the originals' clipping or opacity change
  }, [colour, suspended, assessments, focus, scene, invalidate, clipKey, xray]);

  return null;
}
