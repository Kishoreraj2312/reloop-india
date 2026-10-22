/**
 * Stair finishes (A2 stage 3) on the A1 dog-leg stair, per stair storey s (floor tag = s):
 *   ARC-STAIRFIN-{F}-FL1 / -FL2: tread finishes, riser linings, inner balustrade (balusters +
 *     sloping handrail), outer string on the well wall
 *   ARC-STAIRFIN-{F}-LND: landing finish and a guard along its open north edge
 *   ARC-WALL-{F}-STC-WELL: stairwell lining walls (stairwell.ts)
 *
 * Riser arithmetic (stair finish rule): the tread finish thickness equals the floor build-up
 * (0.05), so every finished riser stays exactly `riserHeight`:
 *   first riser  FFL(E) -> tread 1 top: (E + r + 0.05) - (E + 0.05) = r
 *   landing      tread 11 top -> landing finish top: (E + 12r + 0.05) - (E + 11r + 0.05) = r
 *   last riser   tread 23 top -> next FFL: (E + 24r + 0.05) - (E + 23r + 0.05) = r
 * No adjustment is needed; stairFinish.test asserts it. Tread finishes overhang the riser
 * linings (nosing); linings stop under the nosing.
 */

import type { BuildingConfig } from "../config";
import { buildGrid, deriveStair, openingOf, type ComponentRecord, type Vec3 } from "../structure";
import { ARCH_CONFIG, archDatums, type ArchitectureConfig } from "./config";
import { arcAssembly, arcRecord, box, boxGeom, dimsHorizontal, dimsSolid, dimsVertical, floorTag, pad2, unionBox, type Box } from "./record";
import { wellLining } from "./stairwell";

interface Part {
  readonly loc: string;
  readonly name: string;
  readonly ctype: string;
  readonly mat: string;
  readonly b: Box; // envelope (rotated parts: the unrotated box centred on the rotated centre)
  readonly rot?: Vec3;
  readonly size?: Vec3; // rotated parts: local size
  readonly unit: "m2" | "m" | "nr" | "m3";
  readonly dims: ReturnType<typeof dimsSolid>;
}

/** Finished levels of every step of a stair storey (for the stair finish rule test). */
export interface StairLevels {
  readonly ffl: number;
  readonly treadTops: readonly number[]; // FL1 treads 1..11, landing, FL2 treads 1..11
  readonly nextFfl: number;
}

export function generateStairFinishes(cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): { records: ComponentRecord[]; levels: StairLevels[] } {
  const grid = buildGrid(cfg);
  const st = deriveStair(grid);
  const op = openingOf(grid, "stair");
  const d = archDatums(cfg, arch);
  const sf = arch.stairFinish;
  const bu = arch.datums.floorBuildUp;
  const r = st.riser;
  const t = st.tread;
  const rt = sf.riser;
  const w = cfg.stair.width;
  const cx = (op.x0 + op.x1) / 2;
  const xFl1 = cx - (cfg.stair.flightGap / 2 + w / 2);
  const xFl2 = cx + (cfg.stair.flightGap / 2 + w / 2);
  const z0 = op.z0;
  const zrun = z0 + st.run;
  const L = cfg.stair.landingDepth;
  const out: ComponentRecord[] = [];
  const levels: StairLevels[] = [];
  const alpha = Math.atan2(r, t);

  const emit = (floor: number, loc: string, name: string, assemblyType: string, category: "stairFinishes" | "partitions", type: "STAIRFIN" | "WALL", mat: string, parts: Part[]) => {
    const env = unionBox(parts.map((p) => p.b));
    const asm = arcAssembly({ type, floor, location: loc, name, assemblyType, category, materialId: mat, min: env.min as Vec3, max: env.max as Vec3, dimensions: dimsSolid(env), unit: "nr", apartmentId: "CM", roomId: "CM-STC" });
    out.push(asm);
    for (const p of parts) {
      const { geometry, position } = boxGeom(p.b);
      out.push(
        arcRecord({
          type,
          floor,
          location: `${loc}-${p.loc}`,
          name: `${name}: ${p.name}`,
          componentType: p.ctype,
          assemblyType,
          category,
          materialId: p.mat,
          geometry: p.size ? { kind: "box", size: p.size } : geometry,
          position,
          ...(p.rot ? { rotation: p.rot } : {}),
          dimensions: p.dims,
          unit: p.unit,
          parentId: asm.id,
          apartmentId: "CM",
          roomId: "CM-STC",
        }),
      );
    }
  };

  /** A sloping member: centre line from (za, ya) to (zb, yb) at x, section sx (x) by sy (perpendicular). */
  const sloped = (loc: string, name: string, ctype: string, mat: string, x: number, za: number, ya: number, zb: number, yb: number, sx: number, sy: number): Part => {
    const len = Math.hypot(zb - za, yb - ya);
    const theta = -Math.atan2(yb - ya, zb - za); // rotation about X tilting local +Z toward +Y
    const c: Vec3 = [x, (ya + yb) / 2, (za + zb) / 2];
    // Envelope of the rotated box (for the assembly bounds only).
    const hz = Math.abs(Math.cos(theta)) * len / 2 + Math.abs(Math.sin(theta)) * sy / 2;
    const hy = Math.abs(Math.sin(theta)) * len / 2 + Math.abs(Math.cos(theta)) * sy / 2;
    return { loc, name, ctype, mat, b: box(x - sx / 2, x + sx / 2, c[1] - hy, c[1] + hy, c[2] - hz, c[2] + hz), rot: [theta, 0, 0], size: [sx, sy, len], unit: "m", dims: { length: len, width: sx, height: sy } };
  };

  for (let s = 0; s < st.storeyCount; s++) {
    const E = d.slabTop(s);
    const landTop = E + st.landingHeight + bu;
    const treadTops: number[] = [];
    for (const [fl, dir, zStart, h0, x] of [
      ["FL1", 1, z0, E, xFl1],
      ["FL2", -1, zrun, E + st.landingHeight, xFl2],
    ] as const) {
      const parts: Part[] = [];
      const zk = (k: number) => zStart + dir * (k - 1) * t;
      const n = st.risersPerFlight;
      for (let k = 1; k <= n; k++) {
        const bottom = k === 1 ? (fl === "FL1" ? d.ffl(s) : landTop) : h0 + (k - 1) * r + bu;
        const top = k < n ? h0 + k * r : h0 + n * r + bu; // last riser runs up to the finished level above it
        const [a, b] = [zk(k) - dir * rt, zk(k)].sort((p, q) => p - q) as [number, number];
        const bx = box(x - w / 2, x + w / 2, bottom, top, a, b);
        parts.push({ loc: `RSR${pad2(k)}`, name: `riser lining ${k}`, ctype: "stair_riser", mat: "stone_tread", b: bx, unit: "m2", dims: dimsVertical(bx, "x") });
        if (k < n) {
          const [c, e] = [zk(k) - dir * rt, zk(k + 1) - dir * rt].sort((p, q) => p - q) as [number, number];
          const tb = box(x - w / 2, x + w / 2, h0 + k * r, h0 + k * r + sf.tread, c, e);
          parts.push({ loc: `TRD${pad2(k)}`, name: `tread finish ${k}`, ctype: "stair_tread", mat: "stone_tread", b: tb, unit: "m2", dims: dimsHorizontal(tb) });
          treadTops.push(h0 + k * r + sf.tread);
        }
      }
      if (fl === "FL1") treadTops.push(landTop);
      // Inner balustrade (well side): one baluster per tread, sloping handrail above.
      const inner = fl === "FL1" ? x + w / 2 - 0.04 : x - w / 2 + 0.04;
      const nose = (k: number): [number, number] => [zk(k) - dir * rt, h0 + k * r + sf.tread];
      const [za, ya] = nose(1);
      const [zb, yb] = nose(n - 1);
      const hrT = 2 * sf.handrailRadius;
      const railAt = (z: number) => ya + ((z - za) * (yb - ya)) / (zb - za) + sf.balustradeHeight;
      parts.push(sloped("HRL", "handrail", "stair_handrail", "metal_railing", inner, za, ya + sf.balustradeHeight, zb, yb + sf.balustradeHeight, hrT, hrT));
      const bw = sf.baluster;
      for (let k = 1; k < n; k++) {
        const zc = (zk(k) + zk(k + 1)) / 2 - dir * rt;
        const underside = railAt(zc) - hrT / 2 / Math.cos(alpha) - (bw / 2) * Math.tan(alpha) - 0.001;
        const bb = box(inner - bw / 2, inner + bw / 2, h0 + k * r + sf.tread, underside, zc - bw / 2, zc + bw / 2);
        parts.push({ loc: `BLS${pad2(k)}`, name: "baluster", ctype: "stair_baluster", mat: "metal_railing", b: bb, unit: "nr", dims: dimsSolid(bb) });
      }
      // Outer string on the well-lining wall face, parallel to the nosing line.
      const wallFace = fl === "FL1" ? op.x0 : op.x1;
      const sx = 0.02;
      const sxC = fl === "FL1" ? wallFace + sx / 2 : wallFace - sx / 2;
      const [sa, sya] = nose(2);
      const [sb, syb] = nose(n - 2);
      parts.push(sloped("STR", "wall string", "stair_string", "stone_tread", sxC, sa, sya - 0.05, sb, syb - 0.05, sx, 0.25));
      emit(s, fl, `Stair finish ${fl} ${floorTag(s)}`, "stair_finish", "stairFinishes", "STAIRFIN", "stone_tread", parts);
    }
    levels.push({ ffl: d.ffl(s), treadTops, nextFfl: d.ffl(s + 1) });

    // Landing finish + guard along the open north edge
    const lx0 = cx - st.planWidth / 2;
    const lx1 = cx + st.planWidth / 2;
    const lz1 = zrun + L;
    const lp: Part[] = [];
    const lf = box(lx0, lx1, E + st.landingHeight, landTop, zrun, lz1);
    lp.push({ loc: "FIN", name: "landing finish", ctype: "stair_landing_finish", mat: "stone_tread", b: lf, unit: "m2", dims: dimsHorizontal(lf) });
    const gz = lz1 - 0.04;
    const hrT = 2 * sf.handrailRadius;
    const gTop = landTop + sf.balustradeHeight;
    const hr = box(lx0, lx1, gTop - hrT, gTop, gz - hrT / 2, gz + hrT / 2);
    lp.push({ loc: "HRL", name: "guard handrail", ctype: "stair_handrail", mat: "metal_railing", b: hr, unit: "m", dims: dimsSolid(hr) });
    const nb = Math.floor((lx1 - lx0) / 0.12);
    for (let i = 0; i <= nb; i++) {
      const bx = lx0 + 0.03 + ((lx1 - lx0 - 0.06) * i) / nb;
      const bb = box(bx - sf.baluster / 2, bx + sf.baluster / 2, landTop, gTop - hrT, gz - sf.baluster / 2, gz + sf.baluster / 2);
      lp.push({ loc: `BLS${pad2(i + 1)}`, name: "guard baluster", ctype: "stair_baluster", mat: "metal_railing", b: bb, unit: "nr", dims: dimsSolid(bb) });
    }
    emit(s, "LND", `Stair landing finish ${floorTag(s)}`, "stair_finish", "stairFinishes", "STAIRFIN", "stone_tread", lp);
  }

  // Stairwell lining walls: every storey, plus the roof level inside the access enclosure.
  const lining = wellLining(cfg, arch);
  for (let s = 0; s <= cfg.storeyCount; s++) {
    const E = d.slabTop(s);
    const top = s < cfg.storeyCount ? d.slabTop(s + 1) - cfg.slab.thickness : E + arch.roof.enclosure.height;
    const parts: Part[] = lining.map((l) => {
      const b = box(l.rect.x0, l.rect.x1, E, top, l.rect.z0, l.rect.z1);
      const axis = l.side === "N" ? "x" : "z";
      return { loc: l.side, name: "stairwell lining wall", ctype: "wall_pier", mat: "masonry_paint_core", b, unit: "m3", dims: dimsVertical(b, axis) };
    });
    emit(s, "CM-STC-WELL", `Stairwell lining ${floorTag(s)}`, "wall", "partitions", "WALL", "masonry_paint_core", parts);
  }
  return { records: out, levels };
}
