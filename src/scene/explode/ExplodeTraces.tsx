/**
 * Trace lines (A4, optional, default off): for the inspected assembly, one thin line per member from where it would sit if
 * the assembly were assembled (inside the exploded building) to where it is displayed. The only data behind a line is the
 * member's canonical position and its assembly offset: no relationship between components is implied or drawn.
 * The inspected assembly is the focused one, else the one containing the selection (supported assemblies only).
 */

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments } from "three";
import { recordBounds } from "@/building/structure";
import { floorKeyOf } from "@/engine/explode";
import { explodeRuntime } from "./ExplodeController";
import { explodeStore, useExplode } from "./explodeStore";
import { getExplodeModel } from "./model";

export function ExplodeTraces({ selectedId }: { selectedId: string | null }) {
  const s = useExplode();
  const asmIndex = useMemo(() => {
    if (!s.open || !s.connectors) return -1;
    const m = getExplodeModel();
    const id = s.params.focus ?? selectedId;
    if (!id) return -1;
    const rec = m.byId.get(id);
    if (!rec) return -1;
    const asm = rec.geometry.kind === "group" ? rec.id : rec.parentId;
    return asm !== undefined ? (m.assemblyIndex.get(asm) ?? -1) : -1;
  }, [s.open, s.connectors, s.params.focus, selectedId]);

  const lines = useMemo(() => {
    if (asmIndex < 0) return null;
    const m = getExplodeModel();
    const plan = m.assemblies[asmIndex]!;
    const n = plan.members.length;
    const centres = new Float32Array(n * 3);
    const units = new Float32Array(n * 3);
    const floorSlot = new Int32Array(n);
    const sysSlot = new Int32Array(n);
    plan.members.forEach((id, i) => {
      const r = m.byId.get(id)!;
      const b = recordBounds(r);
      centres[i * 3] = (b.min[0] + b.max[0]) / 2;
      centres[i * 3 + 1] = (b.min[1] + b.max[1]) / 2;
      centres[i * 3 + 2] = (b.min[2] + b.max[2]) / 2;
      const u = m.memberUnit.get(id)!;
      units.set(u, i * 3);
      floorSlot[i] = m.floorSlot.get(floorKeyOf(r.floor)) ?? 0;
      sysSlot[i] = m.systemSlot.get(r.system) ?? 0;
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(n * 6), 3));
    const material = new LineBasicMaterial({ color: 0x3b4650, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
    const obj = new LineSegments(geometry, material);
    obj.frustumCulled = false;
    obj.renderOrder = 997;
    obj.raycast = () => undefined; // never intercepts clicks
    obj.name = "__explode_trace";
    return { obj, geometry, material, n, centres, units, floorSlot, sysSlot };
  }, [asmIndex]);

  useEffect(
    () => () => {
      lines?.geometry.dispose();
      lines?.material.dispose();
    },
    [lines],
  );

  useFrame((state) => {
    const solver = explodeRuntime.solver;
    if (!lines || !solver || asmIndex < 0) return;
    const k = solver.assemblyFactor[asmIndex]!;
    const pos = lines.geometry.getAttribute("position") as BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < lines.n; i++) {
      const fo = lines.floorSlot[i]! * 3;
      const so = lines.sysSlot[i]! * 3;
      // "home" in the exploded building: floor and system offsets applied, assembly offset not
      const hx = lines.centres[i * 3]! + solver.floorOffset[fo]! + solver.systemOffset[so]!;
      const hy = lines.centres[i * 3 + 1]! + solver.floorOffset[fo + 1]! + solver.systemOffset[so + 1]!;
      const hz = lines.centres[i * 3 + 2]! + solver.floorOffset[fo + 2]! + solver.systemOffset[so + 2]!;
      a[i * 6] = hx;
      a[i * 6 + 1] = hy;
      a[i * 6 + 2] = hz;
      a[i * 6 + 3] = hx + lines.units[i * 3]! * k;
      a[i * 6 + 4] = hy + lines.units[i * 3 + 1]! * k;
      a[i * 6 + 5] = hz + lines.units[i * 3 + 2]! * k;
    }
    pos.needsUpdate = true;
    lines.obj.visible = k > 0;
    if (explodeStore.get().playing) state.invalidate();
  });

  return lines ? <primitive object={lines.obj} /> : null;
}
