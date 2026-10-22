/**
 * Facade elements (A2): vertical fins, floor bands, stone plinth, rainwater downpipes,
 * building-number panel and entrance wall lights.
 *
 * - Fins sit on the column lines that flank each balcony stack (south: A, B, D, E, F, G;
 *   north: B, C, D, F, G), one segment per storey plus a roof segment up to the coping top.
 * - Floor bands clad the edge-beam zone at every level above ground, 50 mm proud of the wall
 *   face; they stop at fins and drop below balcony slabs. S/N bands wrap the corners.
 * - The plinth is stone-effect cladding on the pedestal line from site grade to L0, with a cap.
 * Grouped per floor and facade side (ARC-FAC-{floor}-{side}); the plinth is ARC-FAC-G-PLN.
 */

import type { BuildingConfig } from "../config";
import { buildGrid, nodeLabel, type ComponentRecord, type Vec3 } from "../structure";
import { archDatums, type ArchitectureConfig } from "./config";
import { facadeBox, facadeFrame, type FacadeFrame } from "./balconies";
import type { FloorPlan, PlanBalcony, Side } from "./plan";
import { subtractAll, type PlanRect } from "./rect";
import { arcAssembly, arcRecord, boxGeom, dimsSolid, dimsVertical, pad2, unionBox, type Box } from "./record";

export interface FacadeContext {
  readonly cfg: BuildingConfig;
  readonly arch: ArchitectureConfig;
  /** Balconies of a typical floor (they repeat F01..F04), used for fins and band drops. */
  readonly balconies: readonly PlanBalcony[];
  /** Plan of the ground floor (entrance door position). */
  readonly ground: FloorPlan;
}

/** Fin gridline positions per long facade: both gridlines of every balcony bay. */
export function finLines(balconies: readonly PlanBalcony[]): Map<Side, number[]> {
  const m = new Map<Side, number[]>();
  for (const b of balconies) {
    const l = m.get(b.side) ?? [];
    for (const g of b.bay) if (!l.some((x) => Math.abs(x - g) < 1e-9)) l.push(g);
    m.set(b.side, l.sort((p, q) => p - q));
  }
  return m;
}

/** Plan footprint of a fin (along range x distances from the wall face). */
function finRect(f: FacadeFrame, g: number, arch: ArchitectureConfig): PlanRect {
  const b = facadeBox(f, g - arch.facade.fin.thickness / 2, g + arch.facade.fin.thickness / 2, 0, 1, f.wallFace, 0, arch.facade.fin.depth);
  return { x0: b.min[0], x1: b.max[0], z0: b.min[2], z1: b.max[2] };
}

/** Along-range of a facade side including corner wraps (S/N wrap the corners; E/W stop at their faces). */
function sideRange(cfg: BuildingConfig, side: Side, extra: number): [number, number] {
  const g = buildGrid(cfg);
  if (side === "S" || side === "N") return [g.xs[0]! - cfg.column.width / 2 - extra, g.xs[g.xs.length - 1]! + cfg.column.width / 2 + extra];
  return [g.zs[0]! - cfg.column.depth / 2, g.zs[g.zs.length - 1]! + cfg.column.depth / 2];
}

/** Grid bays along a side, as [a0, a1, nodeA, nodeB], first/last bays stretched to [lo, hi]. */
function bays(cfg: BuildingConfig, side: Side, lo: number, hi: number): [number, number, string, string][] {
  const g = buildGrid(cfg);
  const along = side === "S" || side === "N" ? g.xs : g.zs;
  const fixed = side === "S" ? 0 : side === "N" ? g.zs.length - 1 : side === "W" ? 0 : g.xs.length - 1;
  const label = (i: number) => (side === "S" || side === "N" ? nodeLabel(i, fixed) : nodeLabel(fixed, i));
  return along.slice(0, -1).map((a, i) => [i === 0 ? lo : a, i === along.length - 2 ? hi : along[i + 1]!, label(i), label(i + 1)]);
}

const SIDES: readonly Side[] = ["S", "N", "W", "E"];

/** Grid node label of a gridline position on a long facade (e.g. "D1" for x = 0 on the south side). */
function gridNode(cfg: BuildingConfig, side: Side, along: number): string {
  const g = buildGrid(cfg);
  return nodeLabel(g.xs.findIndex((x) => Math.abs(x - along) < 1e-9), side === "S" ? 0 : g.zs.length - 1);
}

export function generateFacade(ctx: FacadeContext): ComponentRecord[] {
  const { cfg, arch } = ctx;
  const d = archDatums(cfg, arch);
  const fa = arch.facade;
  const fins = finLines(ctx.balconies);
  const roof = cfg.storeyCount;
  const parapetTop = d.slabTop(roof) + arch.roof.finish + arch.roof.parapetHeight + arch.roof.coping.thickness;
  const plinthTop = fa.plinth.capHeight;
  const out: ComponentRecord[] = [];

  for (let floor = 0; floor <= roof; floor++) {
    for (const side of SIDES) {
      const f = facadeFrame(cfg, side);
      const loc = side;
      const parts: { suffix: string; name: string; type: string; mat: string; b: Box; cyl?: { r: number; h: number; axis: "x" | "y" | "z" }; unit: "m3" | "m2" | "m" | "nr"; dims?: ReturnType<typeof dimsSolid> }[] = [];
      const finsHere = side === "S" || side === "N" ? fins.get(side) ?? [] : [];

      // Fins: storey segments 0..4, roof segment up to the coping top
      for (const g of finsHere) {
        const y0 = floor === 0 ? plinthTop : d.slabTop(floor);
        const y1 = floor === roof ? parapetTop : d.slabTop(floor + 1);
        const b = facadeBox(f, g - fa.fin.thickness / 2, g + fa.fin.thickness / 2, y0, y1, f.wallFace, 0, fa.fin.depth);
        parts.push({ suffix: `FIN-${gridNode(cfg, side, g)}`, name: "vertical fin", type: "facade_fin", mat: "concrete_fin", b, unit: "m3" });
      }

      // Column cladding on exposed column faces between bands, flush with the bands (frame grid)
      if (floor < roof) {
        const g = buildGrid(cfg);
        const lines = side === "S" || side === "N" ? g.xs : g.zs;
        const fixed = side === "S" ? 0 : side === "N" ? g.zs.length - 1 : side === "W" ? 0 : g.xs.length - 1;
        const half = (side === "S" || side === "N" ? cfg.column.width : cfg.column.depth) / 2;
        const y0 = floor === 0 ? plinthTop : d.slabTop(floor);
        const y1 = d.slabTop(floor + 1) - cfg.beam.depth;
        const finRects = finsHere.map((x) => finRect(f, x, arch));
        lines.forEach((c, i) => {
          const long = side === "S" || side === "N";
          const first = i === 0;
          const last = i === lines.length - 1;
          // S/N cladding wraps the building corners; E/W stops at the S/N faces.
          const a0 = long && first ? c - half - fa.band.projection : c - half;
          const a1 = long && last ? c + half + fa.band.projection : c + half;
          const plan = facadeBox(f, a0, a1, 0, 1, f.wallFace, 0, fa.band.projection);
          const pieces = subtractAll({ x0: plan.min[0], x1: plan.max[0], z0: plan.min[2], z1: plan.max[2] }, finRects, !long).sort((p, q) => (long ? p.x0 - q.x0 : p.z0 - q.z0));
          const node = long ? nodeLabel(i, fixed) : nodeLabel(fixed, i);
          pieces.forEach((pr, k) => {
            const b: Box = { min: [pr.x0, y0, pr.z0], max: [pr.x1, y1, pr.z1] };
            parts.push({ suffix: `CLD-${node}${pieces.length > 1 ? `-${k + 1}` : ""}`, name: "column cladding", type: "column_cladding", mat: "concrete_band", b, unit: "m2", dims: dimsVertical(b, f.axis) });
          });
        });
      }

      // Floor band at this level (levels 1..roof), split at fins, dropped under balconies
      if (floor >= 1) {
        const E = d.slabTop(floor);
        const [lo, hi] = sideRange(cfg, side, side === "S" || side === "N" ? fa.band.projection : 0);
        const finRects = finsHere.map((g) => finRect(f, g, arch));
        for (const [a0, a1, na, nb] of bays(cfg, side, lo, hi)) {
          const under = ctx.balconies.some((bl) => bl.side === side && bl.bay[0] < (a0 + a1) / 2 && bl.bay[1] > (a0 + a1) / 2);
          const yTop = under ? E - arch.balcony.slabThickness - arch.balcony.soffit : E;
          const plan = facadeBox(f, a0, a1, 0, 1, f.wallFace, 0, fa.band.projection);
          const pieces = subtractAll({ x0: plan.min[0], x1: plan.max[0], z0: plan.min[2], z1: plan.max[2] }, finRects, f.axis === "z");
          pieces.sort((p, q) => (f.axis === "x" ? p.x0 - q.x0 : p.z0 - q.z0));
          pieces.forEach((pr, i) => {
            const b: Box = { min: [pr.x0, E - cfg.beam.depth, pr.z0], max: [pr.x1, yTop, pr.z1] };
            parts.push({ suffix: `BND-${na}-${nb}${pieces.length > 1 ? `-${i + 1}` : ""}`, name: under ? "floor band (below balcony)" : "floor band", type: "facade_band", mat: "concrete_band", b, unit: "m2", dims: dimsVertical(b, f.axis) });
          });
        }
      }

      // Downpipes on the gables, near both ends; rainwater heads at the roof
      if (side === "W" || side === "E") {
        const g = buildGrid(cfg);
        const ends = [g.zs[0]! + fa.downpipe.inset, g.zs[g.zs.length - 1]! - fa.downpipe.inset];
        const dist = fa.downpipe.standoff + fa.downpipe.radius;
        const rwhBottom = d.slabTop(roof) + 0.3;
        ends.forEach((z, k) => {
          const y0 = floor === 0 ? fa.downpipe.bottom : d.slabTop(floor);
          const y1 = floor === roof ? rwhBottom : d.slabTop(floor + 1);
          const c = f.wallFace + f.out * dist;
          const b: Box = { min: [c - fa.downpipe.radius, y0, z - fa.downpipe.radius], max: [c + fa.downpipe.radius, y1, z + fa.downpipe.radius] };
          parts.push({ suffix: `DP${k + 1}`, name: "rainwater downpipe", type: "facade_downpipe", mat: "pvc_pipe", b, cyl: { r: fa.downpipe.radius, h: y1 - y0, axis: "y" }, unit: "m", dims: { length: y1 - y0, diameter: 2 * fa.downpipe.radius } });
          if (floor === roof) {
            const rh = facadeBox(f, z - 0.15, z + 0.15, rwhBottom, rwhBottom + 0.3, f.wallFace, 0.01, dist + fa.downpipe.radius + 0.05);
            parts.push({ suffix: `RWH${k + 1}`, name: "rainwater head", type: "facade_rainwater_head", mat: "pvc_pipe", b: rh, unit: "nr" });
          }
        });
      }

      // Ground floor, south: building-number panel on the fin east of the entrance; wall lights on the entrance fins
      if (floor === 0 && side === "S") {
        const ed = ctx.ground.doors.find((x) => x.typeKey === "ED");
        if (ed) {
          const [gL, gR] = [Math.max(...finsHere.filter((g) => g < ed.centre)), Math.min(...finsHere.filter((g) => g > ed.centre))];
          const ffl = d.ffl(0);
          const np = fa.numberPanel;
          parts.push({ suffix: "NUM", name: "building number panel", type: "facade_sign", mat: "metal_panel", b: facadeBox(f, gR - np.width / 2, gR + np.width / 2, ffl + np.centreAboveFFL - np.height / 2, ffl + np.centreAboveFFL + np.height / 2, f.wallFace, fa.fin.depth, fa.fin.depth + np.depth), unit: "nr" });
          const wl = fa.wallLight;
          const mid = fa.fin.depth / 2;
          const ly = ffl + wl.centreAboveFFL;
          const t2 = fa.fin.thickness / 2;
          parts.push({ suffix: "LGT1", name: "entrance wall light", type: "light_fixture", mat: "fixture_light", b: facadeBox(f, gL + t2, gL + t2 + wl.depth, ly - wl.height / 2, ly + wl.height / 2, f.wallFace, mid - wl.width / 2, mid + wl.width / 2), unit: "nr" });
          parts.push({ suffix: "LGT2", name: "entrance wall light", type: "light_fixture", mat: "fixture_light", b: facadeBox(f, gR - t2 - wl.depth, gR - t2, ly - wl.height / 2, ly + wl.height / 2, f.wallFace, mid - wl.width / 2, mid + wl.width / 2), unit: "nr" });
        }
      }

      if (parts.length === 0) continue;
      const env = unionBox(parts.map((p) => p.b));
      out.push(
        arcAssembly({
          type: "FAC",
          floor,
          location: loc,
          name: `Facade ${side} (${floor === 0 ? "G" : floor === roof ? "roof" : `F${pad2(floor)}`})`,
          assemblyType: "facade",
          category: "facade",
          materialId: "concrete_band",
          min: env.min as Vec3,
          max: env.max as Vec3,
          dimensions: dimsSolid(env),
          unit: "nr",
        }),
      );
      const parentId = out[out.length - 1]!.id;
      for (const p of parts) {
        const { geometry, position } = boxGeom(p.b);
        out.push(
          arcRecord({
            type: "FAC",
            floor,
            location: `${loc}-${p.suffix}`,
            name: `Facade ${side}: ${p.name}`,
            componentType: p.type,
            assemblyType: "facade",
            category: "facade",
            materialId: p.mat,
            geometry: p.cyl ? { kind: "cylinder", radius: p.cyl.r, height: p.cyl.h, axis: p.cyl.axis } : geometry,
            position,
            dimensions: p.dims ?? dimsSolid(p.b),
            unit: p.unit,
            parentId,
          }),
        );
      }
    }
  }
  out.push(...plinth(cfg, arch));
  return out;
}

/** Stone-effect plinth cladding (0.6 m modules) and its cap, around the whole perimeter. */
function plinth(cfg: BuildingConfig, arch: ArchitectureConfig): ComponentRecord[] {
  const pl = arch.facade.plinth;
  const grade = arch.datums.siteGrade;
  const out: ComponentRecord[] = [];
  const kids: { loc: string; name: string; type: string; b: Box; dims: ReturnType<typeof dimsSolid>; unit: "m2" | "m3" }[] = [];
  for (const side of SIDES) {
    const f = facadeFrame(cfg, side);
    const off = cfg.pedestal.width / 2 - (side === "S" || side === "N" ? cfg.column.depth : cfg.column.width) / 2; // pedestal face beyond wall face
    const longSide = side === "S" || side === "N";
    const g = buildGrid(cfg);
    const [lo, hi] = longSide
      ? [g.xs[0]! - cfg.pedestal.width / 2 - pl.thickness, g.xs[g.xs.length - 1]! + cfg.pedestal.width / 2 + pl.thickness]
      : [g.zs[0]! - cfg.pedestal.depth / 2, g.zs[g.zs.length - 1]! + cfg.pedestal.depth / 2];
    const n = Math.ceil((hi - lo) / pl.module - 1e-9);
    for (let i = 0; i < n; i++) {
      const a0 = lo + i * pl.module;
      const a1 = Math.min(hi, a0 + pl.module);
      const b = facadeBox(f, a0, a1, grade, 0, f.wallFace, off, off + pl.thickness);
      kids.push({ loc: `${side}-${pad2(i + 1)}`, name: `plinth cladding module ${side}${i + 1}`, type: "plinth_cladding", b, dims: dimsVertical(b, f.axis), unit: "m2" });
    }
    const [c0, c1] = longSide ? [lo, hi] : [g.zs[0]! - cfg.column.depth / 2, g.zs[g.zs.length - 1]! + cfg.column.depth / 2];
    const cap = facadeBox(f, c0, c1, 0, pl.capHeight, f.wallFace, 0, off + pl.thickness);
    kids.push({ loc: `CAP-${side}`, name: `plinth cap ${side}`, type: "plinth_cap", b: cap, dims: dimsSolid(cap), unit: "m3" });
  }
  const env = unionBox(kids.map((k) => k.b));
  out.push(
    arcAssembly({ type: "FAC", floor: 0, location: "PLN", name: "Stone plinth", assemblyType: "plinth", category: "facade", materialId: "stone_cladding", min: env.min as Vec3, max: env.max as Vec3, dimensions: dimsSolid(env), unit: "nr" }),
  );
  const parentId = out[0]!.id;
  for (const k of kids) {
    const { geometry, position } = boxGeom(k.b);
    out.push(arcRecord({ type: "FAC", floor: 0, location: `PLN-${k.loc}`, name: k.name, componentType: k.type, assemblyType: "plinth", category: "facade", materialId: k.type === "plinth_cap" ? "stone_coping" : "stone_cladding", geometry, position, dimensions: k.dims, unit: k.unit, parentId }));
  }
  return out;
}
