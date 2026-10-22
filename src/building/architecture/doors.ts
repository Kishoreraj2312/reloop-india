/**
 * Door assemblies (A2): threshold, frame (two jambs + head), leaf or leaves (solid, or
 * glazed stiles/rails + glass), hinges and lever handles, fitted into the wall opening.
 * Leaves are modelled closed; the swing is data (see swing.ts) used by the clearance checks.
 * Cased openings (no leaves) get a threshold and a frame lining only.
 */

import type { ComponentRecord, Vec3 } from "../structure";
import { ARCH_CONFIG, type ArchitectureConfig, type DoorTypeKey } from "./config";
import { arcAssembly, arcId, arcRecord, box, boxGeom, dimsSolid, dimsVertical, pad2, type Box } from "./record";

export interface DoorParams {
  readonly key: string; // location, e.g. "A3-BED1-N-01"
  readonly floor: number;
  readonly typeKey: DoorTypeKey;
  readonly axis: "x" | "z";
  readonly o0: number;
  readonly o1: number;
  readonly slabTop: number; // opening bottom
  readonly ffl: number;
  readonly head: number;
  /** Wall thickness band across the line, and the side the leaf swings toward (+1 = high side). */
  readonly across: readonly [number, number];
  readonly swingDir: 1 | -1;
  /** Along-coordinate end the (single) leaf is hung from. */
  readonly hingeEnd: "o0" | "o1";
  readonly hostId: string;
  readonly lintelId: string;
  readonly apartmentId?: string;
  readonly roomId?: string;
  readonly name: string;
}

/** How far hardware may stand proud of the door frame (handles, hinge knuckles). */
export const DOOR_HARDWARE_PROJECTION = 0.05;

export function buildDoor(p: DoorParams, arch: ArchitectureConfig = ARCH_CONFIG): ComponentRecord[] {
  const t = arch.doorTypes[p.typeKey];
  const f = arch.frames.door;
  const tol = arch.openings.fitTolerance;
  const id = arcId("DOOR", p.floor, p.key);
  const [c0, c1] = p.across;
  const mid = (c0 + c1) / 2;
  const fd = Math.min(c1 - c0, f.jambDepthMax);
  const [fc0, fc1] = [mid - fd / 2, mid + fd / 2]; // frame band
  const swingFace = p.swingDir > 0 ? fc1 : fc0;
  const backFace = swingFace - p.swingDir * f.leafThickness;
  const B = (a0: number, a1: number, y0: number, y1: number, k0: number, k1: number): Box =>
    p.axis === "x" ? box(a0, a1, y0, y1, k0, k1) : box(k0, k1, y0, y1, a0, a1);
  const frameMat = t.leafMaterial === "metal_frame" ? "metal_frame" : "timber_frame";
  const out: ComponentRecord[] = [];
  const common = { type: "DOOR" as const, floor: p.floor, category: "openings" as const, assemblyType: "door", parentId: id, ...(p.apartmentId ? { apartmentId: p.apartmentId } : {}), ...(p.roomId ? { roomId: p.roomId } : {}) };
  const part = (suffix: string, name: string, componentType: string, materialId: string, b: Box, unit: "m3" | "m2" | "nr" = "nr") => {
    const { geometry, position } = boxGeom(b);
    out.push(
      arcRecord({
        ...common,
        location: `${p.key}-${suffix}`,
        name: `${p.name}: ${name}`,
        componentType,
        materialId,
        geometry,
        position,
        dimensions: unit === "m2" ? dimsVertical(b, p.axis) : dimsSolid(b),
        unit,
      }),
    );
  };

  part("THR", "threshold", "door_threshold", "stone_tread", B(p.o0, p.o1, p.slabTop, p.ffl, c0, c1), "m3");
  const j0 = p.o0 + tol;
  const j1 = p.o1 - tol;
  const top = p.head - tol;
  part("JMB-L", "frame jamb", "door_frame", frameMat, B(j0, j0 + f.jamb, p.ffl, top, fc0, fc1));
  part("JMB-R", "frame jamb", "door_frame", frameMat, B(j1 - f.jamb, j1, p.ffl, top, fc0, fc1));
  part("HED", "frame head", "door_frame", frameMat, B(j0 + f.jamb, j1 - f.jamb, top - f.jamb, top, fc0, fc1));

  const l0 = j0 + f.jamb + f.leafGap;
  const l1 = j1 - f.jamb - f.leafGap;
  const ly0 = p.ffl + f.floorGap;
  const ly1 = top - f.jamb - f.leafGap;
  const [lk0, lk1] = [Math.min(swingFace, backFace), Math.max(swingFace, backFace)];
  const leaves: { a0: number; a1: number; hinge: "a0" | "a1" }[] =
    t.leaves === 2
      ? [
          { a0: l0, a1: (l0 + l1) / 2 - f.leafGap / 2, hinge: "a0" },
          { a0: (l0 + l1) / 2 + f.leafGap / 2, a1: l1, hinge: "a1" },
        ]
      : t.leaves === 1
        ? [{ a0: l0, a1: l1, hinge: p.hingeEnd === "o0" ? "a0" : "a1" }]
        : [];

  leaves.forEach((lf, i) => {
    const n = t.leaves === 2 ? pad2(i + 1) : "";
    if (t.glazed) {
      const g = f.glazedStile;
      part(`LEF${n}-STL-L`, "leaf stile", "door_leaf_frame", t.leafMaterial, B(lf.a0, lf.a0 + g, ly0, ly1, lk0, lk1));
      part(`LEF${n}-STL-R`, "leaf stile", "door_leaf_frame", t.leafMaterial, B(lf.a1 - g, lf.a1, ly0, ly1, lk0, lk1));
      part(`LEF${n}-RAIL-B`, "leaf bottom rail", "door_leaf_frame", t.leafMaterial, B(lf.a0 + g, lf.a1 - g, ly0, ly0 + 2 * g, lk0, lk1));
      part(`LEF${n}-RAIL-T`, "leaf top rail", "door_leaf_frame", t.leafMaterial, B(lf.a0 + g, lf.a1 - g, ly1 - g, ly1, lk0, lk1));
      const gm = (lk0 + lk1) / 2;
      const gl = arch.frames.window.glass;
      part(`LEF${n}-GLZ`, "leaf glazing", "glazing", "glass_clear", B(lf.a0 + g, lf.a1 - g, ly0 + 2 * g, ly1 - g, gm - gl / 2, gm + gl / 2), "m2");
    } else {
      part(`LEF${n}`, "door leaf", "door_leaf", t.leafMaterial, B(lf.a0, lf.a1, ly0, ly1, lk0, lk1), "m2");
    }
    // Hinge knuckles on the swing face at the hinge joint
    const joint = lf.hinge === "a0" ? lf.a0 - f.leafGap / 2 : lf.a1 + f.leafGap / 2;
    const h = f.hinge;
    const ys = [ly0 + 0.2, (ly0 + ly1) / 2, ly1 - 0.25].slice(0, h.count);
    ys.forEach((y, k) =>
      part(`HNG${n}${pad2(k + 1)}`, "hinge", "door_hinge", "metal_hardware", B(joint - h.width / 2, joint + h.width / 2, y - h.height / 2, y + h.height / 2, swingFace, swingFace + p.swingDir * h.depth)),
    );
    // Lever handles on both faces, near the free edge
    const free = lf.hinge === "a0" ? lf.a1 - 0.07 : lf.a0 + 0.07;
    const toward = lf.hinge === "a0" ? -1 : 1; // lever points toward the hinge side
    const hy = p.ffl + f.handleHeight;
    for (const [face, dir, tag] of [
      [swingFace, p.swingDir, "A"],
      [backFace, -p.swingDir as 1 | -1, "B"],
    ] as const) {
      const plate = face + dir * 0.008;
      part(`HDL${n}-${tag}-PLT`, "handle rose plate", "door_handle", "metal_hardware", B(free - 0.02, free + 0.02, hy - 0.08, hy + 0.08, face, plate));
      const lv = [free, free + toward * 0.12].sort((a, b) => a - b) as [number, number];
      part(`HDL${n}-${tag}-LVR`, "lever handle", "door_handle", "metal_hardware", B(lv[0], lv[1], hy - 0.009, hy + 0.009, plate, plate + dir * 0.02));
    }
  });

  const env = B(p.o0, p.o1, p.slabTop, p.head, c0 - DOOR_HARDWARE_PROJECTION, c1 + DOOR_HARDWARE_PROJECTION);
  out.unshift(
    arcAssembly({
      type: "DOOR",
      floor: p.floor,
      location: p.key,
      name: p.name,
      assemblyType: t.leaves === 0 ? "cased_opening" : "door",
      category: "openings",
      materialId: t.leaves === 0 ? "stone_tread" : t.leafMaterial,
      min: env.min as Vec3,
      max: env.max as Vec3,
      dimensions: { length: p.o1 - p.o0, height: p.head - p.ffl },
      unit: "nr",
      dependencies: [p.hostId, p.lintelId],
      ...(p.apartmentId ? { apartmentId: p.apartmentId } : {}),
      ...(p.roomId ? { roomId: p.roomId } : {}),
    }),
  );
  return out;
}
