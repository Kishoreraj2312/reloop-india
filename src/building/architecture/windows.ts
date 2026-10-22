/**
 * Window assemblies (A2): frame, mullions, sashes, glazing, handles and a stone sill, fitted
 * into the wall opening with the configured tolerance. The window lintel is a piece of the
 * host wall (referenced as a dependency). Frames sit `revealDepth` behind the outer face.
 *
 * Styles: casement (n side-hung sashes divided by mullions), sliding (two sashes in two
 * tracks overlapping at the meeting stiles), top-hung (one ventilator sash).
 */

import type { ComponentRecord, Vec3 } from "../structure";
import { ARCH_CONFIG, type ArchitectureConfig, type WindowTypeKey } from "./config";
import { arcAssembly, arcId, arcRecord, box, boxGeom, dimsSolid, dimsVertical, pad2, type Box } from "./record";

export interface WindowParams {
  readonly key: string; // location, e.g. "A3-LIV-N-01"
  readonly floor: number;
  readonly typeKey: WindowTypeKey;
  readonly axis: "x" | "z"; // host wall direction
  readonly o0: number; // structural opening along the wall
  readonly o1: number;
  readonly bottom: number; // sill top (y)
  readonly head: number; // head (y)
  readonly outerFace: number; // across-coordinate of the wall's outer face
  readonly innerFace: number;
  readonly hostId: string;
  readonly lintelId: string;
  readonly apartmentId?: string;
  readonly roomId?: string;
  readonly name: string;
  /** Exterior casement windows get a sunshade unless disabled. */
  readonly sunshade?: boolean;
}

export function buildWindow(p: WindowParams, arch: ArchitectureConfig = ARCH_CONFIG): ComponentRecord[] {
  const t = arch.windowTypes[p.typeKey];
  const fr = arch.frames.window;
  const tol = arch.openings.fitTolerance;
  const dIn = Math.sign(p.innerFace - p.outerFace) as 1 | -1;
  const at = (d: number) => p.outerFace + dIn * d; // across coordinate at depth d from the outer face
  const st = arch.openings.stoneSill;
  const proj = t.sill > 0 ? st.projection : 0; // floor-level sills (balcony sliders) do not project
  const id = arcId("WIN", p.floor, p.key);
  // Box from along/y/across-depth ranges in the wall's frame.
  const B = (a0: number, a1: number, y0: number, y1: number, d0: number, d1: number): Box =>
    p.axis === "x" ? box(a0, a1, y0, y1, at(d0), at(d1)) : box(at(d0), at(d1), y0, y1, a0, a1);
  const out: ComponentRecord[] = [];
  const common = { type: "WIN" as const, floor: p.floor, category: "openings" as const, assemblyType: "window", parentId: id, ...(p.apartmentId ? { apartmentId: p.apartmentId } : {}), ...(p.roomId ? { roomId: p.roomId } : {}) };
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

  // Stone sill under the frame, full wall depth, projecting outside (except floor-level sills).
  part("SIL", "stone sill", "window_sill", "stone_coping", B(p.o0, p.o1, p.bottom - st.thickness, p.bottom, -proj, Math.abs(p.innerFace - p.outerFace)), "m3");

  // Outer frame
  const fx0 = p.o0 + tol;
  const fx1 = p.o1 - tol;
  const fy0 = p.bottom;
  const fy1 = p.head - tol;
  const d0 = arch.openings.revealDepth;
  const d1 = d0 + fr.frameDepth;
  const f = fr.frame;
  part("FRM-B", "frame bottom rail", "window_frame", "metal_frame", B(fx0, fx1, fy0, fy0 + f, d0, d1));
  part("FRM-H", "frame head", "window_frame", "metal_frame", B(fx0, fx1, fy1 - f, fy1, d0, d1));
  part("FRM-L", "frame jamb", "window_frame", "metal_frame", B(fx0, fx0 + f, fy0 + f, fy1 - f, d0, d1));
  part("FRM-R", "frame jamb", "window_frame", "metal_frame", B(fx1 - f, fx1, fy0 + f, fy1 - f, d0, d1));
  const ix0 = fx0 + f;
  const ix1 = fx1 - f;
  const iy0 = fy0 + f;
  const iy1 = fy1 - f;
  const sw = fr.sash;

  const sash = (n: number, a0: number, a1: number, sd0: number, sd1: number, handleAt: "a0" | "a1" | "bottom") => {
    const tag = `SSH${pad2(n)}`;
    part(`${tag}-B`, "sash bottom rail", "window_sash", "metal_frame", B(a0, a1, iy0, iy0 + sw, sd0, sd1));
    part(`${tag}-H`, "sash top rail", "window_sash", "metal_frame", B(a0, a1, iy1 - sw, iy1, sd0, sd1));
    part(`${tag}-L`, "sash stile", "window_sash", "metal_frame", B(a0, a0 + sw, iy0 + sw, iy1 - sw, sd0, sd1));
    part(`${tag}-R`, "sash stile", "window_sash", "metal_frame", B(a1 - sw, a1, iy0 + sw, iy1 - sw, sd0, sd1));
    const gm = (sd0 + sd1) / 2;
    part(`GLZ${pad2(n)}`, "glazing", "glazing", "glass_clear", B(a0 + sw, a1 - sw, iy0 + sw, iy1 - sw, gm - fr.glass / 2, gm + fr.glass / 2), "m2");
    // Handle on the room side of the sash
    const hy = handleAt === "bottom" ? iy0 + sw / 2 : (iy0 + iy1) / 2;
    const ha = handleAt === "a0" ? a0 + sw / 2 : handleAt === "a1" ? a1 - sw / 2 : (a0 + a1) / 2;
    const [hw, hh] = handleAt === "bottom" ? [0.1, 0.02] : [0.02, 0.1];
    part(`HDL${pad2(n)}`, "handle", "window_handle", "metal_hardware", B(ha - hw / 2, ha + hw / 2, hy - hh / 2, hy + hh / 2, sd1, sd1 + 0.025));
  };

  if (t.style === "sliding") {
    const w = (ix1 - ix0 + sw) / 2; // sashes overlap by one stile at the meeting rail
    const tr0 = d0 + 0.004;
    sash(1, ix0, ix0 + w, tr0, tr0 + fr.sashDepth, "a0");
    sash(2, ix1 - w, ix1, tr0 + fr.trackOffset, tr0 + fr.trackOffset + fr.sashDepth, "a1");
  } else {
    const n = t.panes;
    const m = fr.mullion;
    const pw = (ix1 - ix0 - (n - 1) * m) / n;
    for (let k = 1; k < n; k++) {
      const mx = ix0 + k * pw + (k - 1) * m;
      part(`MUL${pad2(k)}`, "mullion", "window_mullion", "metal_frame", B(mx, mx + m, iy0, iy1, d0, d1));
    }
    const sd0 = d0 + (fr.frameDepth - fr.sashDepth) / 2;
    for (let k = 0; k < n; k++) {
      const a0 = ix0 + k * (pw + m);
      sash(k + 1, a0, a0 + pw, sd0, sd0 + fr.sashDepth, t.style === "tophung" ? "bottom" : k < n / 2 ? "a1" : "a0");
    }
  }

  // Sunshade (chajja) on the lintel band of exterior casement windows.
  const sh = arch.facade.sunshade;
  const shade = t.style === "casement" && p.sunshade !== false;
  const lintelTop = p.head + arch.openings.lintelDepth;
  if (shade) part("SHD", "sunshade (chajja)", "window_sunshade", "concrete_band", B(p.o0 - sh.overhang, p.o1 + sh.overhang, lintelTop - sh.thickness, lintelTop, -sh.depth, 0), "m3");

  // Assembly envelope: the structural opening, through the wall, plus sill projection (and sunshade).
  const env = shade
    ? B(p.o0 - sh.overhang, p.o1 + sh.overhang, p.bottom - st.thickness, lintelTop, -sh.depth, Math.abs(p.innerFace - p.outerFace))
    : B(p.o0, p.o1, p.bottom - st.thickness, p.head, -proj, Math.abs(p.innerFace - p.outerFace));
  out.unshift(
    arcAssembly({
      type: "WIN",
      floor: p.floor,
      location: p.key,
      name: p.name,
      assemblyType: "window",
      category: "openings",
      materialId: "metal_frame",
      min: env.min as Vec3,
      max: env.max as Vec3,
      dimensions: { length: p.o1 - p.o0, height: p.head - p.bottom },
      unit: "nr",
      dependencies: [p.hostId, p.lintelId],
      ...(p.apartmentId ? { apartmentId: p.apartmentId } : {}),
      ...(p.roomId ? { roomId: p.roomId } : {}),
    }),
  );
  return out;
}
