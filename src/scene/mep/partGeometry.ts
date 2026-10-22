/**
 * Unit meshes for MEP catalogue parts (A3). Each part is modelled in its local frame with
 * the proportions from building/mep/parts.ts (fittings in pipe radii, fixed parts in metres),
 * then normalised so its record box maps to the unit cube; the instance matrix scales it
 * back to the record box. Vertex colours carry the part's own accents (handwheels, door
 * seams, dials); the body colour is the record material's colour, so one shared material
 * per material id draws every part instance.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  LatheGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FIT, FIXED_PARTS, TRAY, fittingBox, type FittingPart } from "@/building/mep/parts";

type Axis = "x" | "y" | "z";

interface Prim {
  readonly g: BufferGeometry;
  /** Accent colour; undefined = body colour of the record material. */
  readonly color?: number;
}

const ACCENT = {
  seam: 0x2c2f33,
  wheel: 0x8a3b31,
  lever: 0x93412f,
  glass: 0x3a4148,
  dial: 0xe6e2d6,
  chrome: 0xc6c9cb,
  insulator: 0x6f2f29,
  copper: 0xa7713f,
  rocker: 0xd8d6cf,
  hole: 0x2a2b2d,
  dark: 0x232427,
  knob: 0x6b6e72,
  concrete: 0xa8a49b,
  castIron: 0x3b3d40,
  plinth: 0x34373a,
  lcd: 0x5d6b5e,
  rubber: 0x1d1e20,
} as const;

// ── primitive helpers (local coordinates) ─────────────────────────────────────

function cyl(r: number, y0: number, y1: number, axis: Axis = "y", at: [number, number] = [0, 0], seg = 18, color?: number): Prim {
  const g = new CylinderGeometry(r, r, y1 - y0, seg, 1);
  g.translate(0, (y0 + y1) / 2, 0);
  orient(g, axis);
  if (axis === "y") g.translate(at[0], 0, at[1]);
  if (axis === "x") g.translate(0, at[0], at[1]);
  if (axis === "z") g.translate(at[0], at[1], 0);
  return { g, ...(color !== undefined ? { color } : {}) };
}

/** Cylinder along `axis` (local y of the primitive is mapped onto it). */
function orient(g: BufferGeometry, axis: Axis) {
  if (axis === "x") g.rotateZ(-Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
}

function cone(r0: number, r1: number, y0: number, y1: number, axis: Axis = "y", seg = 18, color?: number): Prim {
  const g = new CylinderGeometry(r1, r0, y1 - y0, seg, 1);
  g.translate(0, (y0 + y1) / 2, 0);
  orient(g, axis);
  return { g, ...(color !== undefined ? { color } : {}) };
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color?: number): Prim {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return { g, ...(color !== undefined ? { color } : {}) };
}

function sphere(r: number, c: [number, number, number], scale: [number, number, number] = [1, 1, 1], color?: number, half = false): Prim {
  const g = new SphereGeometry(r, 18, half ? 7 : 12, 0, Math.PI * 2, 0, half ? Math.PI / 2 : Math.PI);
  g.scale(...scale);
  g.translate(...c);
  return { g, ...(color !== undefined ? { color } : {}) };
}

/** Quarter torus joining the +X leg and the +Y leg, tangent to both axes at distance rb. */
function bend(rb: number, tube: number, color?: number): Prim {
  const g = new TorusGeometry(rb, tube, 12, 12, Math.PI / 2);
  g.rotateZ(Math.PI);
  g.translate(rb, rb, 0);
  return { g, ...(color !== undefined ? { color } : {}) };
}

function ring(r: number, tube: number, y: number, axis: Axis = "y", color?: number): Prim {
  const g = new TorusGeometry(r, tube, 8, 28);
  g.rotateX(Math.PI / 2); // torus in the XZ plane (normal Y)
  g.translate(0, y, 0);
  if (axis === "x") g.rotateZ(-Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  return { g, ...(color !== undefined ? { color } : {}) };
}

function lathe(profile: [number, number][], seg = 32, color?: number): Prim {
  const g = new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), seg);
  return { g, ...(color !== undefined ? { color } : {}) };
}

// ── normalise + merge ─────────────────────────────────────────────────────────

function finish(prims: Prim[], base: number, lo: readonly number[], hi: readonly number[]): BufferGeometry {
  const parts = prims.map(({ g, color }) => {
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    flat.deleteAttribute("uv");
    const n = flat.getAttribute("position").count;
    const c = new Color(color ?? base);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    flat.setAttribute("color", new BufferAttribute(col, 3));
    return flat;
  });
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("part geometry merge failed");
  for (const g of parts) g.dispose();
  // Map the local box [lo, hi] onto the unit cube centred at the origin.
  const size = [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!];
  const c = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
  const pos = merged.getAttribute("position") as BufferAttribute;
  const nor = merged.getAttribute("normal") as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, (pos.getX(i) - c[0]!) / size[0]!, (pos.getY(i) - c[1]!) / size[1]!, (pos.getZ(i) - c[2]!) / size[2]!);
    // Normals: inverse-transpose of the 1/size scale (the instance matrix applies its own).
    const nx = nor.getX(i) * size[0]!;
    const ny = nor.getY(i) * size[1]!;
    const nz = nor.getZ(i) * size[2]!;
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.setXYZ(i, nx / l, ny / l, nz / l);
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

// ── fittings (r = 1) ──────────────────────────────────────────────────────────

const PIPE = 1.08; // body tube radius relative to the pipe
const HUB = FIT.hub;
const LEG = FIT.leg;

function fittingPrims(part: FittingPart): Prim[] {
  switch (part) {
    case "elbow":
      return [bend(1.35, PIPE), cyl(HUB, 1.35, LEG, "x"), cyl(HUB, 1.35, LEG, "y"), ring(HUB, 0.07, LEG - 0.06, "x"), ring(HUB, 0.07, LEG - 0.06, "y")];
    case "bend-conduit":
      return [bend(2.0, 1.02), cyl(1.12, 2.0, 3.2, "x"), cyl(1.12, 2.0, 3.2, "y")];
    case "tee":
      return [cyl(PIPE, -LEG, LEG, "x"), cyl(HUB, -LEG, -1.4, "x"), cyl(HUB, 1.4, LEG, "x"), cyl(PIPE, 0, LEG, "y"), cyl(HUB, 1.4, LEG, "y"), sphere(1.2, [0, 0, 0])];
    case "cap":
      return [cyl(HUB, 0, LEG, "x"), sphere(HUB, [0, 0, 0], [0.55, 1, 1])];
    case "valve-gate":
      return [
        cyl(1.42, -2.8, 2.8, "x", [0, 0], 6),
        sphere(1.45, [0, 0, 0], [1.1, 1.05, 1.05]),
        cyl(0.95, 0.8, 3.6, "y"),
        cyl(1.15, 3.4, 3.9, "y", [0, 0], 6),
        cyl(0.24, 3.9, 5.7, "y", [0, 0], 8, ACCENT.chrome),
        ring(2.0, 0.24, 5.55, "y", ACCENT.wheel),
        box(-2.0, 2.0, 5.45, 5.65, -0.16, 0.16, ACCENT.wheel),
        box(-0.16, 0.16, 5.45, 5.65, -2.0, 2.0, ACCENT.wheel),
        cyl(0.42, 5.4, 5.75, "y", [0, 0], 10, ACCENT.wheel),
      ];
    case "valve-ball":
      return [cyl(1.3, -2.5, 2.5, "x", [0, 0], 6), sphere(1.45, [0, 0, 0]), cyl(0.5, 1.2, 2.25, "y", [0, 0], 10, ACCENT.chrome), box(-0.45, 5.4, 2.2, 2.95, -0.55, 0.55, ACCENT.lever)];
    case "valve-check":
      return [cyl(1.45, -3.0, 3.0, "x", [0, 0], 6), sphere(1.65, [0, 0.3, 0], [1.25, 1, 1]), cyl(1.1, 1.2, 2.9, "y", [0, 0], 6)];
    case "valve-float":
      return [cyl(1.3, 0, LEG, "x", [0, 0], 6), sphere(1.4, [0, 0, 0]), cyl(0.28, -9.4, 0, "x", [0.4, 0], 8, ACCENT.chrome), sphere(2.55, [-9.4, -2.9, 0], [1, 1, 1], ACCENT.chrome)];
    case "meter-water":
      return [cyl(1.45, -3.4, 3.4, "x", [0, 0], 6), sphere(1.7, [0, 0, 0], [1.4, 1, 1.05]), cyl(1.85, 0.9, 3.0, "y"), cyl(1.6, 3.0, 3.35, "y", [0, 0], 24, ACCENT.dial), ring(1.75, 0.15, 3.3, "y")];
    case "trap-bottle":
      return [cyl(1.05, 0, LEG, "y", [0, 0], 16), cyl(1.7, -3.6, 0.7, "y"), sphere(1.7, [0, 0.7, 0], [1, 0.35, 1], undefined, true), cyl(1.05, 0, LEG, "x")];
    case "trap-floor":
      return [cyl(2.3, -2.6, 0.8, "y", [0, 0], 22), cyl(1.35, 0.8, LEG, "y"), ring(1.35, 0.12, LEG - 0.1, "y"), cyl(PIPE, 0, Math.max(LEG, 2.3), "x"), cyl(HUB, 1.6, Math.max(LEG, 2.3), "x")];
    case "cleanout":
      return [cyl(PIPE + 0.05, -2.5, 2.5, "x"), cyl(1.05, 0, 1.9, "y", [0, 0], 16), cyl(1.25, 1.9, 2.4, "y", [0, 0], 6, ACCENT.knob)];
    case "cowl":
      return [cyl(PIPE, -1.4, 1.4, "x"), cone(2.1, 1.0, -2.4, -1.75, "x"), cyl(2.1, -1.85, -1.7, "x"), box(-1.75, -1.2, -0.15, 0.15, -1.0, 1.0), box(-1.75, -1.2, -1.0, 1.0, -0.15, 0.15)];
    case "jb":
      return [cyl(3.2, -1.6, 1.25, "z", [0, 0], 24), cyl(3.3, 1.25, 1.6, "z", [0, 0], 24, ACCENT.rocker), cyl(1.12, -3.3, 3.3, "x"), cyl(1.12, 0, 3.3, "y")];
  }
}

// ── fixed parts (metres, anchor-relative) ─────────────────────────────────────

function fixedPrims(part: keyof typeof FIXED_PARTS): Prim[] {
  const S = FIXED_PARTS[part];
  const [w, h, d] = S.size;
  const lo = [S.centre[0] - w / 2, S.centre[1] - h / 2, S.centre[2] - d / 2];
  const hi = [S.centre[0] + w / 2, S.centre[1] + h / 2, S.centre[2] + d / 2];
  switch (part) {
    case "switch-plate": {
      const out: Prim[] = [box(-w / 2 + 0.01, w / 2 - 0.01, -h / 2 + 0.008, h / 2 - 0.008, lo[2]!, 0, ACCENT.seam), box(-w / 2, w / 2, -h / 2, h / 2, 0, 0.008)];
      for (let i = 0; i < 4; i++) {
        const x = -0.066 + i * 0.044;
        out.push(box(x - 0.017, x + 0.017, -0.028, 0.028, 0.008, 0.012, ACCENT.rocker));
      }
      return out;
    }
    case "socket-plate":
    case "socket-16a": {
      const big = part === "socket-16a";
      const out: Prim[] = [box(-w / 2 + 0.01, w / 2 - 0.01, -h / 2 + 0.008, h / 2 - 0.008, lo[2]!, 0, ACCENT.seam), box(-w / 2, w / 2, -h / 2, h / 2, 0, 0.008)];
      const sx = -w / 2 + 0.028;
      out.push(box(sx - 0.014, sx + 0.014, -0.022, 0.022, 0.008, hi[2]!, ACCENT.rocker));
      const cx = big ? 0.025 : 0.02;
      const rr = big ? 0.033 : 0.027;
      out.push(cyl(rr, 0.008, hi[2]! - 0.001, "z", [cx, 0], 24, ACCENT.rocker));
      for (const [px, py, pr] of [
        [cx, rr * 0.45, big ? 0.006 : 0.005],
        [cx - rr * 0.42, -rr * 0.3, big ? 0.0045 : 0.0035],
        [cx + rr * 0.42, -rr * 0.3, big ? 0.0045 : 0.0035],
      ] as const)
        out.push(cyl(pr, hi[2]! - 0.0012, hi[2]!, "z", [px, py], 10, ACCENT.hole));
      return out;
    }
    case "db": {
      const out: Prim[] = [box(-w / 2 + 0.01, w / 2 - 0.01, -h / 2 + 0.01, h / 2 - 0.01, lo[2]!, 0, ACCENT.seam), box(-w / 2, w / 2, -h / 2, h / 2, 0, 0.012)];
      out.push(box(-w / 2 + 0.025, w / 2 - 0.025, -h / 2 + 0.03, h / 2 - 0.03, 0.012, 0.02));
      out.push(box(-w / 2 + 0.06, w / 2 - 0.06, 0.03, 0.09, 0.02, 0.022, ACCENT.glass));
      out.push(box(w / 2 - 0.05, w / 2 - 0.035, -0.04, 0.04, 0.02, hi[2]!, ACCENT.knob));
      return out;
    }
    case "fdb":
      return [
        box(-w / 2, w / 2, -h / 2, h / 2, 0, d - 0.015),
        box(-w / 2 + 0.012, w / 2 - 0.012, -h / 2 + 0.012, h / 2 - 0.012, d - 0.015, d - 0.004),
        box(-w / 2 + 0.006, w / 2 - 0.006, -h / 2 + 0.006, h / 2 - 0.006, d - 0.0155, d - 0.0145, ACCENT.seam),
        box(-0.13, 0.13, 0.08, 0.16, d - 0.004, d - 0.001, ACCENT.glass),
        box(w / 2 - 0.05, w / 2 - 0.03, -0.05, 0.05, d - 0.004, d, ACCENT.knob),
        box(-0.15, 0.15, -h / 2 + 0.03, -h / 2 + 0.045, d - 0.004, d - 0.001, ACCENT.seam),
      ];
    case "earth-bar":
      return [
        box(-w / 2, -w / 2 + 0.03, -0.025, 0.025, 0, 0.03, ACCENT.insulator),
        box(w / 2 - 0.03, w / 2, -0.025, 0.025, 0, 0.03, ACCENT.insulator),
        box(-w / 2, w / 2, -0.02, 0.02, 0.03, 0.04),
        ...[-0.1, -0.05, 0, 0.05, 0.1].map((x) => cyl(0.006, 0.04, 0.045, "z", [x, 0], 6, ACCENT.chrome)),
      ];
    case "bulkhead":
      return [box(-w / 2, w / 2, -h / 2, h / 2, 0, 0.025, ACCENT.knob), sphere(1, [0, 0, 0.025], [w / 2 - 0.01, h / 2 - 0.01, d - 0.025], undefined, false)].map((p, i) =>
        i === 1 ? { g: clipFront(p.g, 0.025) } : p,
      );
    case "geyser": {
      const r = 0.17;
      const cz = 0.21;
      return [
        box(-0.12, 0.12, -0.18, 0.18, 0, 0.03, ACCENT.knob),
        cyl(r, -0.2, 0.2, "y", [0, cz], 28),
        sphere(r, [0, 0.2, cz], [1, 0.42, 1], undefined, true),
        { g: flipY(sphere(r, [0, 0, 0], [1, 0.42, 1], undefined, true).g, -0.2, cz) },
        { g: translate(cyl(0.028, 0, 0.025, "z").g, 0.07, 0.02, cz + r - 0.01), color: ACCENT.knob },
        { g: translate(cyl(0.008, 0, 0.004, "z", [0, 0], 10).g, -0.06, 0.06, cz + r - 0.004), color: ACCENT.insulator },
        cyl(0.011, -0.28, -0.2, "y", [-0.06, cz], 10, ACCENT.chrome),
        cyl(0.011, -0.28, -0.2, "y", [0.06, cz], 10, ACCENT.chrome),
      ];
    }
    case "pump-panel":
      return [
        box(-w / 2, w / 2, -h / 2, h / 2, 0, d - 0.012),
        box(-w / 2 + 0.01, w / 2 - 0.01, -h / 2 + 0.01, h / 2 - 0.01, d - 0.012, d - 0.003),
        box(-0.12, 0.12, 0.1, 0.2, d - 0.003, d, ACCENT.glass),
        cyl(0.022, d - 0.003, d, "z", [-0.08, -0.05], 16, ACCENT.lever),
        cyl(0.022, d - 0.003, d, "z", [0.0, -0.05], 16, ACCENT.lcd),
        cyl(0.022, d - 0.003, d, "z", [0.08, -0.05], 16, ACCENT.seam),
      ];
    case "meter-board":
      return [
        box(-w / 2, w / 2, -h / 2, h / 2, 0, 0.03),
        box(-w / 2, -w / 2 + 0.03, -h / 2, h / 2, 0.03, d),
        box(w / 2 - 0.03, w / 2, -h / 2, h / 2, 0.03, d),
        box(-w / 2, w / 2, h / 2 - 0.03, h / 2, 0.03, d),
        box(-w / 2, w / 2, -h / 2, -h / 2 + 0.03, 0.03, d),
        box(-w / 2 + 0.03, w / 2 - 0.03, -0.006, 0.006, 0.03, 0.05, ACCENT.seam),
      ];
    case "panel": {
      const out: Prim[] = [box(-w / 2, w / 2, 0, 0.1, -d / 2 + 0.02, d / 2 - 0.02, ACCENT.plinth), box(-w / 2, w / 2, 0.1, h, -d / 2, d / 2 - 0.01)];
      // two doors with seams, handles, meter windows and a top canopy
      out.push(box(-0.003, 0.003, 0.14, h - 0.04, d / 2 - 0.012, d / 2, ACCENT.seam));
      for (const sx of [-1, 1]) {
        out.push(box(sx * 0.07 - 0.008, sx * 0.07 + 0.008, 0.9, 1.1, d / 2 - 0.01, d / 2, ACCENT.knob));
        for (let i = 0; i < 2; i++) out.push(box(sx * 0.27 - 0.07, sx * 0.27 + 0.07, 1.45 - i * 0.2, 1.55 - i * 0.2, d / 2 - 0.01, d / 2, ACCENT.glass));
        out.push(box(sx * 0.27 - 0.1, sx * 0.27 + 0.1, 0.35, 0.37, d / 2 - 0.01, d / 2, ACCENT.seam));
        out.push(box(sx * 0.27 - 0.1, sx * 0.27 + 0.1, 0.42, 0.44, d / 2 - 0.01, d / 2, ACCENT.seam));
      }
      out.push(box(-w / 2 - 0.0, w / 2 + 0.0, h - 0.03, h, -d / 2, d / 2, ACCENT.knob));
      return out;
    }
    case "tank-hdpe": {
      const R = w / 2;
      const prof: [number, number][] = [[0, 0], [R - 0.04, 0], [R - 0.01, 0.02]];
      const ribs = 6;
      const top = h - 0.42;
      for (let i = 0; i <= ribs; i++) {
        const y = 0.06 + (i * (top - 0.12)) / ribs;
        prof.push([R - 0.012, y - 0.06], [R, y - 0.03], [R, y + 0.03], [R - 0.012, y + 0.06]);
      }
      prof.push([R - 0.03, top], [R * 0.86, top + 0.12], [R * 0.6, top + 0.24], [0.33, h - 0.1], [0.33, h - 0.09], [0, h - 0.09]);
      return [lathe(prof, 40), cyl(0.3, h - 0.1, h - 0.02, "y", [0, 0], 28, ACCENT.dark), cyl(0.26, h - 0.02, h, "y", [0, 0], 28, ACCENT.dark)];
    }
    case "pump": {
      return [
        box(-w / 2, w / 2, 0, 0.04, -d / 2, d / 2, ACCENT.plinth),
        cyl(0.115, -0.33, 0.06, "x", [0.17, 0], 22),
        ...Array.from({ length: 6 }, (_, i) => box(-0.3 + i * 0.06, -0.28 + i * 0.06, 0.04, 0.3, -0.125, 0.125)),
        cyl(0.07, -0.385, -0.33, "x", [0.17, 0], 18, ACCENT.knob),
        box(-0.08, 0.06, 0.04, 0.12, -0.08, 0.08, ACCENT.plinth),
        { g: translate(cyl(0.135, -0.07, 0.07, "z", [0, 0], 26).g, 0.2, 0.17, 0) },
        cyl(0.045, 0.2, 0.35, "x", [0.17, 0], 16),
        cyl(0.06, 0.35, 0.38, "x", [0.17, 0], 16, ACCENT.knob),
        cyl(0.04, 0.3, h, "y", [0.2, 0], 16),
        cyl(0.055, h - 0.03, h, "y", [0.2, 0], 16, ACCENT.knob),
        box(-0.18, 0.02, 0.3, 0.38, -0.06, 0.06, ACCENT.seam),
      ];
    }
    case "feeder-pillar":
      return [
        box(-w / 2, w / 2, 0, 0.12, -d / 2, d / 2, ACCENT.concrete),
        box(-w / 2 + 0.03, w / 2 - 0.03, 0.12, h - 0.1, -d / 2 + 0.03, d / 2 - 0.03),
        box(-w / 2, w / 2, h - 0.1, h, -d / 2, d / 2),
        box(-0.004, 0.004, 0.2, h - 0.16, d / 2 - 0.035, d / 2 - 0.02, ACCENT.seam),
        box(-0.06, -0.04, 0.6, 0.75, d / 2 - 0.03, d / 2 - 0.015, ACCENT.knob),
        box(0.04, 0.06, 0.6, 0.75, d / 2 - 0.03, d / 2 - 0.015, ACCENT.knob),
        box(-0.15, 0.15, 0.95, 1.05, d / 2 - 0.03, d / 2 - 0.02, ACCENT.lever),
      ];
    case "chamber":
    case "earth-pit": {
      const top = hi[1]!;
      const wall = part === "chamber" ? 0.08 : 0.05;
      return [
        box(-w / 2, w / 2, lo[1]!, top - 0.04, -d / 2, -d / 2 + wall, ACCENT.concrete),
        box(-w / 2, w / 2, lo[1]!, top - 0.04, d / 2 - wall, d / 2, ACCENT.concrete),
        box(-w / 2, -w / 2 + wall, lo[1]!, top - 0.04, -d / 2, d / 2, ACCENT.concrete),
        box(w / 2 - wall, w / 2, lo[1]!, top - 0.04, -d / 2, d / 2, ACCENT.concrete),
        box(-w / 2, w / 2, lo[1]!, lo[1]! + 0.06, -d / 2, d / 2, ACCENT.concrete),
        box(-w / 2, w / 2, top - 0.04, top, -d / 2, -d / 2 + wall, ACCENT.concrete),
        box(-w / 2, w / 2, top - 0.04, top, d / 2 - wall, d / 2, ACCENT.concrete),
        box(-w / 2, -w / 2 + wall, top - 0.04, top, -d / 2 + wall, d / 2 - wall, ACCENT.concrete),
        box(w / 2 - wall, w / 2, top - 0.04, top, -d / 2 + wall, d / 2 - wall, ACCENT.concrete),
        box(-w / 2 + wall, w / 2 - wall, top - 0.03, top - 0.005, -d / 2 + wall, d / 2 - wall, ACCENT.castIron),
        box(-0.05, 0.05, top - 0.006, top - 0.002, -0.012, 0.012, ACCENT.dark),
        ...(part === "earth-pit" ? [cyl(0.02, lo[1]! + 0.06, top - 0.12, "y", [0, 0], 10, ACCENT.copper)] : []),
      ];
    }
    case "manhole":
    case "recharge-pit": {
      const top = hi[1]!;
      const R = w / 2;
      const ringW = part === "manhole" ? 0.1 : 0.12;
      return [
        lathe([[R - ringW, lo[1]!], [R, lo[1]!], [R, top], [R - ringW, top], [R - ringW, lo[1]!]], 36, ACCENT.concrete),
        cyl(R - ringW, lo[1]!, lo[1]! + 0.08, "y", [0, 0], 36, ACCENT.concrete),
        cyl(R - ringW + 0.005, top - 0.035, top - 0.005, "y", [0, 0], 36, ACCENT.castIron),
        ...(part === "recharge-pit"
          ? Array.from({ length: 5 }, (_, i) => box(-R + ringW + 0.1, R - ringW - 0.1, top - 0.006, top - 0.002, -0.32 + i * 0.16 - 0.015, -0.32 + i * 0.16 + 0.015, ACCENT.dark))
          : [ring(0.25, 0.012, top - 0.004, "y", ACCENT.dark)]),
      ];
    }
    case "manhole-cover":
      return [box(-w / 2, w / 2, 0, 0.04, -d / 2, d / 2, ACCENT.concrete), box(-w / 2 + 0.07, w / 2 - 0.07, 0.04, h, -d / 2 + 0.07, d / 2 - 0.07, ACCENT.castIron), box(-0.06, 0.06, h - 0.005, h, -0.015, 0.015, ACCENT.dark)];
    case "mcb":
      return [box(-w / 2, w / 2, -h / 2, h / 2, -d / 2, d / 2 - 0.012), box(-w / 2 + 0.002, w / 2 - 0.002, -0.022, 0.022, d / 2 - 0.012, d / 2 - 0.006), box(-0.004, 0.004, 0.0, 0.018, d / 2 - 0.006, d / 2, ACCENT.dark)];
    case "meter-elec":
      return [box(-w / 2, w / 2, -h / 2, h / 2, -d / 2, d / 2 - 0.004), box(-0.045, 0.045, 0.02, 0.06, d / 2 - 0.004, d / 2, ACCENT.lcd), box(-0.05, 0.05, -0.08, -0.03, d / 2 - 0.004, d / 2 - 0.001, ACCENT.seam)];
  }
}

/** Keep the front half of a scaled sphere (light diffuser). */
function clipFront(g: BufferGeometry, z0: number): BufferGeometry {
  const pos = g.getAttribute("position") as BufferAttribute;
  for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < z0) pos.setZ(i, z0);
  g.computeVertexNormals();
  return g;
}

function flipY(g: BufferGeometry, y: number, z: number): BufferGeometry {
  g.scale(1, -1, 1);
  // scaling by -1 flips the winding; re-index faces to keep them outward
  const idx = g.index;
  if (idx) for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i);
    idx.setX(i, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  g.translate(0, y, z);
  g.computeVertexNormals();
  return g;
}

function translate(g: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  g.translate(x, y, z);
  return g;
}

// ── trays ─────────────────────────────────────────────────────────────────────

function trayPrims(node: boolean): Prim[] {
  const { width: w, depth: d, sheet: t } = TRAY;
  if (node) {
    return [box(-w / 2, w / 2, 0, t, -w / 2, w / 2), box(-w / 2, -w / 2 + t, 0, d * 0.4, -w / 2, -w / 2 + 0.03), box(w / 2 - t, w / 2, 0, d * 0.4, -w / 2, -w / 2 + 0.03)];
  }
  // Straight U channel, along x in [0, 1]; return lips at the top edges.
  return [
    box(0, 1, 0, t, -w / 2, w / 2),
    box(0, 1, 0, d, -w / 2, -w / 2 + t),
    box(0, 1, 0, d, w / 2 - t, w / 2),
    box(0, 1, d - t, d, -w / 2, -w / 2 + 0.012),
    box(0, 1, d - t, d, w / 2 - 0.012, w / 2),
  ];
}

// ── entry point ───────────────────────────────────────────────────────────────

export function buildPartGeometry(part: string, bodyColor: number): BufferGeometry {
  if (part === "tray") return finish(trayPrims(false), bodyColor, [0, 0, -TRAY.width / 2], [1, TRAY.depth, TRAY.width / 2]);
  if (part === "tray-node") return finish(trayPrims(true), bodyColor, [-TRAY.width / 2, 0, -TRAY.width / 2], [TRAY.width / 2, TRAY.depth, TRAY.width / 2]);
  if (part in FIXED_PARTS) {
    const S = FIXED_PARTS[part as keyof typeof FIXED_PARTS];
    const lo = [S.centre[0] - S.size[0] / 2, S.centre[1] - S.size[1] / 2, S.centre[2] - S.size[2] / 2];
    const hi = [S.centre[0] + S.size[0] / 2, S.centre[1] + S.size[1] / 2, S.centre[2] + S.size[2] / 2];
    return finish(fixedPrims(part as keyof typeof FIXED_PARTS), bodyColor, lo, hi);
  }
  const { lo, hi } = fittingBox(part as FittingPart, 1);
  return finish(fittingPrims(part as FittingPart), bodyColor, lo, hi);
}
