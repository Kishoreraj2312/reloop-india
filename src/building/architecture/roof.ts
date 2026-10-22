/**
 * Roof (A2), floor RF:
 * - Parapets (0.23, outer face flush with the column outer face) per facade bay, with stone
 *   coping overhanging both faces; coping stops at the fins that rise through it.
 * - Roof finish (waterproofing + screed + reflective tile) per structural bay, inside the
 *   parapets, around the access enclosure and the shaft upstand.
 * - Roof-access enclosure over the stair bay ("mumty"): walls, door, roof slab, floor finish.
 * - Shaft upstand with cap; roof drains at the corners (rainwater heads/downpipes: facade.ts).
 */

import type { BuildingConfig } from "../config";
import { buildGrid, nodeLabel, openingOf, type ComponentRecord, type Vec3 } from "../structure";
import { ARCH_CONFIG, archDatums, type ArchitectureConfig } from "./config";
import { facadeBox, facadeFrame } from "./balconies";
import { finLines } from "./facade";
import { buildDoor } from "./doors";
import { wellFootprint } from "./stairwell";
import type { PlanBalcony, Side } from "./plan";
import { rect, subtractAll, type PlanRect } from "./rect";
import { arcAssembly, arcRecord, box, boxGeom, dimsHorizontal, dimsSolid, dimsVertical, pad2, unionBox, type Box } from "./record";

const RF = 5;

interface Part {
  readonly loc: string;
  readonly name: string;
  readonly type: string;
  readonly mat: string;
  readonly b: Box;
  readonly unit: "m3" | "m2" | "nr";
  readonly dims: ReturnType<typeof dimsSolid>;
  readonly cyl?: { r: number; h: number };
}

function group(loc: string, name: string, assemblyType: string, mat: string, parts: Part[], extra: Partial<{ apartmentId: string; roomId: string }> = {}): ComponentRecord[] {
  const env = unionBox(parts.map((p) => p.b));
  const a = arcAssembly({ type: "ROOF", floor: RF, location: loc, name, assemblyType, category: "roof", materialId: mat, min: env.min as Vec3, max: env.max as Vec3, dimensions: dimsSolid(env), unit: "nr", ...extra });
  return [
    a,
    ...parts.map((p) => {
      const { geometry, position } = boxGeom(p.b);
      return arcRecord({
        type: "ROOF",
        floor: RF,
        location: `${loc}-${p.loc}`,
        name: `${name}: ${p.name}`,
        componentType: p.type,
        assemblyType,
        category: "roof",
        materialId: p.mat,
        geometry: p.cyl ? { kind: "cylinder", radius: p.cyl.r, height: p.cyl.h, axis: "y" } : geometry,
        position,
        dimensions: p.dims,
        unit: p.unit,
        parentId: a.id,
        ...extra,
      });
    }),
  ];
}

export function generateRoof(balconies: readonly PlanBalcony[], cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): ComponentRecord[] {
  const g = buildGrid(cfg);
  const d = archDatums(cfg, arch);
  const rf = arch.roof;
  const E = d.slabTop(RF);
  const top = E + rf.finish + rf.parapetHeight;
  const t = arch.walls.exterior;
  const ov = rf.coping.overhang;
  const fins = finLines(balconies);
  const out: ComponentRecord[] = [];
  const ch = cfg.column.depth / 2;
  const cw = cfg.column.width / 2;
  const outline = rect(g.xs[0]! - cw, g.xs[g.xs.length - 1]! + cw, g.zs[0]! - ch, g.zs[g.zs.length - 1]! + ch);
  const inner = rect(outline.x0 + t, outline.x1 - t, outline.z0 + t, outline.z1 - t);

  // Parapets and coping per side and bay
  for (const side of ["S", "N", "W", "E"] as Side[]) {
    const f = facadeFrame(cfg, side);
    const long = side === "S" || side === "N";
    const along = long ? g.xs : g.zs;
    const [lo, hi] = long ? [outline.x0, outline.x1] : [inner.z0, inner.z1];
    const [clo, chi] = long ? [outline.x0 - ov, outline.x1 + ov] : [inner.z0 + ov, inner.z1 - ov];
    const finRects: PlanRect[] = (long ? fins.get(side) ?? [] : []).map((x) => {
      const b = facadeBox(f, x - arch.facade.fin.thickness / 2, x + arch.facade.fin.thickness / 2, 0, 1, f.wallFace, 0, arch.facade.fin.depth);
      return { x0: b.min[0], x1: b.max[0], z0: b.min[2], z1: b.max[2] };
    });
    const parts: Part[] = [];
    for (let i = 0; i < along.length - 1; i++) {
      const fixed = side === "S" ? 0 : side === "N" ? g.zs.length - 1 : side === "W" ? 0 : g.xs.length - 1;
      const lab = (k: number) => (long ? nodeLabel(k, fixed) : nodeLabel(fixed, k));
      const bay = `${lab(i)}-${lab(i + 1)}`;
      const a0 = i === 0 ? lo : along[i]!;
      const a1 = i === along.length - 2 ? hi : along[i + 1]!;
      const pb = facadeBox(f, a0, a1, E, top, f.wallFace, -t, 0);
      parts.push({ loc: `PAR-${bay}`, name: `parapet ${bay}`, type: "parapet", mat: "masonry_paint_ext", b: pb, unit: "m3", dims: dimsVertical(pb, f.axis) });
      const c0 = i === 0 ? clo : along[i]!;
      const c1 = i === along.length - 2 ? chi : along[i + 1]!;
      const cb = facadeBox(f, c0, c1, top, top + rf.coping.thickness, f.wallFace, -t - ov, ov);
      const pieces = subtractAll({ x0: cb.min[0], x1: cb.max[0], z0: cb.min[2], z1: cb.max[2] }, finRects, !long).sort((p, q) => (long ? p.x0 - q.x0 : p.z0 - q.z0));
      pieces.forEach((pr, k) => {
        const b: Box = { min: [pr.x0, cb.min[1], pr.z0], max: [pr.x1, cb.max[1], pr.z1] };
        parts.push({ loc: `CPG-${bay}${pieces.length > 1 ? `-${k + 1}` : ""}`, name: `coping ${bay}`, type: "coping", mat: "stone_coping", b, unit: "m3", dims: dimsHorizontal(b) });
      });
    }
    out.push(...group(`PAR-${side}`, `Roof parapet ${side}`, "parapet", "masonry_paint_ext", parts));
  }

  // Roof-access enclosure over the stair bay, extended south to the configured line
  const sb = cfg.stairBay;
  const ex0 = g.xs[sb.xStart]!;
  const ex1 = g.xs[sb.xEnd]!;
  const ez1 = g.zs[sb.zEnd]!;
  const ez0 = rf.enclosure.southZ;
  const wt = arch.walls.core;
  const h = wt / 2;
  const encTop = E + rf.enclosure.height;
  const encOuter = rect(ex0 - h, ex1 + h, ez0 - h, ez1 + h);
  const door = arch.doorTypes.RD;
  const dc = (ex0 + ex1) / 2;
  const [o0, o1] = [dc - door.width / 2, dc + door.width / 2];
  const ffl = E + rf.finish;
  const head = ffl + door.height;
  const lintelTop = head + arch.openings.lintelDepth;
  const mum: Part[] = [];
  const wall = (loc: string, b: Box, role = "masonry") =>
    mum.push({ loc, name: `enclosure wall ${role}`, type: `enclosure_wall_${role.replace(/ /g, "_")}`, mat: role === "lintel" ? "lintel_rcc_ext" : "masonry_paint_ext", b, unit: "m3", dims: dimsVertical(b, b.max[0] - b.min[0] > b.max[2] - b.min[2] ? "x" : "z") });
  wall("WAL-W", box(ex0 - h, ex0 + h, E, encTop, ez0 - h, ez1 + h));
  wall("WAL-E", box(ex1 - h, ex1 + h, E, encTop, ez0 - h, ez1 + h));
  wall("WAL-N", box(ex0 + h, ex1 - h, E, encTop, ez1 - h, ez1 + h));
  wall("WAL-S-P01", box(ex0 + h, o0, E, encTop, ez0 - h, ez0 + h));
  wall("WAL-S-P02", box(o1, ex1 - h, E, encTop, ez0 - h, ez0 + h));
  wall("WAL-S-LN01", box(o0, o1, head, lintelTop, ez0 - h, ez0 + h), "lintel");
  wall("WAL-S-AB01", box(o0, o1, lintelTop, encTop, ez0 - h, ez0 + h), "above lintel");
  const so0 = rf.enclosure.slabOverhang;
  const slab = box(encOuter.x0 - so0, encOuter.x1 + so0, encTop, encTop + rf.enclosure.slab, encOuter.z0 - so0, encOuter.z1 + so0);
  mum.push({ loc: "SLB", name: "enclosure roof slab", type: "enclosure_slab", mat: "concrete_balcony", b: slab, unit: "m3", dims: dimsHorizontal(slab) });
  const floorRects = subtractAll(rect(ex0 + h, ex1 - h, ez0 + h, ez1 - h), [wellFootprint(cfg, arch)]);
  floorRects.forEach((r, i) => {
    const b = box(r.x0, r.x1, E, ffl, r.z0, r.z1);
    mum.push({ loc: `FLR${pad2(i + 1)}`, name: "enclosure floor finish", type: "enclosure_floor", mat: "tile_porcelain_floor", b, unit: "m2", dims: dimsHorizontal(b) });
  });
  out.push(...group("MUM", "Roof-access enclosure", "roof_enclosure", "masonry_paint_ext", mum, { apartmentId: "CM", roomId: "CM-STC" }));
  out.push(
    ...buildDoor(
      {
        key: "MUM-S-01",
        floor: RF,
        typeKey: "RD",
        axis: "x",
        o0,
        o1,
        slabTop: E,
        ffl,
        head,
        across: [ez0 - h, ez0 + h],
        swingDir: -1, // opens out onto the roof
        hingeEnd: "o0",
        hostId: `ARC-ROOF-RF-MUM`,
        lintelId: `ARC-ROOF-RF-MUM-WAL-S-LN01`,
        apartmentId: "CM",
        roomId: "CM-STC",
        name: "Roof-access door",
      },
      arch,
    ),
  );

  // Shaft upstand and cap
  const sh = openingOf(g, "shaft");
  const upTop = E + 0.9;
  const shf: Part[] = [];
  const sw = (loc: string, b: Box) => shf.push({ loc, name: "shaft upstand wall", type: "shaft_upstand", mat: "masonry_paint_ext", b, unit: "m3", dims: dimsVertical(b, b.max[0] - b.min[0] > b.max[2] - b.min[2] ? "x" : "z") });
  sw("WAL-S", box(sh.x0 - wt, sh.x1 + wt, E, upTop, sh.z0 - wt, sh.z0));
  sw("WAL-N", box(sh.x0 - wt, sh.x1 + wt, E, upTop, sh.z1, sh.z1 + wt));
  sw("WAL-W", box(sh.x0 - wt, sh.x0, E, upTop, sh.z0, sh.z1));
  sw("WAL-E", box(sh.x1, sh.x1 + wt, E, upTop, sh.z0, sh.z1));
  const cap = box(sh.x0 - wt, sh.x1 + wt, upTop, upTop + 0.1, sh.z0 - wt, sh.z1 + wt);
  shf.push({ loc: "CAP", name: "shaft cap", type: "shaft_cap", mat: "concrete_balcony", b: cap, unit: "m3", dims: dimsHorizontal(cap) });
  out.push(...group("SHF", "Shaft upstand", "shaft_upstand", "masonry_paint_ext", shf, { apartmentId: "CM", roomId: "CM-SHF" }));

  // Roof finish per bay, around the enclosure and the shaft upstand
  const obstacles = [encOuter, rect(sh.x0 - wt, sh.x1 + wt, sh.z0 - wt, sh.z1 + wt)];
  const fin: Part[] = [];
  for (let bz = 0; bz < g.zs.length - 1; bz++) {
    for (let bx = 0; bx < g.xs.length - 1; bx++) {
      const bayR = rect(Math.max(g.xs[bx]!, inner.x0), Math.min(g.xs[bx + 1]!, inner.x1), Math.max(g.zs[bz]!, inner.z0), Math.min(g.zs[bz + 1]!, inner.z1));
      const pieces = subtractAll(bayR, obstacles);
      const n = bz * (g.xs.length - 1) + bx + 1;
      pieces.forEach((r, k) => {
        const b = box(r.x0, r.x1, E, E + rf.finish, r.z0, r.z1);
        fin.push({ loc: `P${pad2(n)}${pieces.length > 1 ? `-${k + 1}` : ""}`, name: `roof finish bay ${n}`, type: "roof_finish", mat: "roof_finish", b, unit: "m2", dims: dimsHorizontal(b) });
      });
    }
  }
  out.push(...group("FIN", "Roof finish", "roof_finish", "roof_finish", fin));

  // Roof drains near the corners, above the rainwater heads
  const drn: Part[] = [];
  const r = rf.outlet.radius;
  const zIn = arch.facade.downpipe.inset;
  [
    [inner.x0 + 0.4, g.zs[0]! + zIn],
    [inner.x0 + 0.4, g.zs[g.zs.length - 1]! - zIn],
    [inner.x1 - 0.4, g.zs[0]! + zIn],
    [inner.x1 - 0.4, g.zs[g.zs.length - 1]! - zIn],
  ].forEach(([x, z], i) => {
    const b = box(x! - r, x! + r, E + rf.finish, E + rf.finish + 0.015, z! - r, z! + r);
    drn.push({ loc: `DRN${i + 1}`, name: "roof drain grating", type: "roof_drain", mat: "metal_hardware", b, unit: "nr", dims: dimsSolid(b), cyl: { r, h: 0.015 } });
  });
  out.push(...group("DRN", "Roof drains", "roof_drain", "metal_hardware", drn));
  return out;
}
