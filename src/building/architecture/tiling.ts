/**
 * Wet-room wall tiling (A2 stage 3): thin glazed-tile panels on every wall face of bathrooms
 * and toilets from FFL to the dado height, cut around doors, windows and columns, and
 * returned onto protruding column faces. Assembly ARC-TILE-{floor}-{room}-WAL. Panels are
 * separate thin components in front of the plastered masonry (never coplanar with it).
 */

import type { ComponentRecord, Vec3 } from "../structure";
import type { InteriorContext } from "./interior";
import { columnCuts, intervalMinus } from "./interior";
import type { Side } from "./plan";
import { EPS, intersect, type PlanRect } from "./rect";
import { arcAssembly, arcRecord, box, boxGeom, dimsSolid, dimsVertical, pad2, unionBox, type Box } from "./record";

export const TILED_ROOMS = new Set(["bathroom", "toilet"]);

export function generateWetTiling(ctx: InteriorContext): ComponentRecord[] {
  const { plan, arch, d } = ctx;
  const s = plan.storey;
  const ffl = d.ffl(s);
  const top = ffl + arch.tiling.wetDadoHeight;
  const th = arch.tiling.thickness;
  const out: ComponentRecord[] = [];
  for (const ir of ctx.rooms.values()) {
    if (!TILED_ROOMS.has(ir.room.type)) continue;
    const room = ir.room;
    const parts: { loc: string; b: Box; axis: "x" | "z" }[] = [];
    ir.clears.forEach((c) => {
      // Column returns first; wall panels are then cut by columns and returns.
      const returns: { r: PlanRect; axis: "x" | "z"; tag: string }[] = [];
      for (const col of ctx.cols) {
        const p = intersect(col, c);
        if (!p) continue;
        if (p.z1 < c.z1 - EPS) returns.push({ r: { x0: p.x0, x1: p.x1, z0: p.z1, z1: p.z1 + th }, axis: "x", tag: "N" });
        if (p.z0 > c.z0 + EPS) returns.push({ r: { x0: p.x0, x1: p.x1, z0: p.z0 - th, z1: p.z0 }, axis: "x", tag: "S" });
        if (p.x1 < c.x1 - EPS) returns.push({ r: { x0: p.x1, x1: p.x1 + th, z0: p.z0, z1: p.z1 }, axis: "z", tag: "E" });
        if (p.x0 > c.x0 + EPS) returns.push({ r: { x0: p.x0 - th, x1: p.x0, z0: p.z0, z1: p.z1 }, axis: "z", tag: "W" });
      }
      const ret = returns; // x-returns and z-returns of one column are disjoint (they meet at a corner point)
      for (const side of ["S", "N", "W", "E"] as Side[]) {
        const axis = side === "S" || side === "N" ? "x" : "z";
        // S/N panels run the full face; W/E panels stop at the S/N panels.
        const strip: PlanRect =
          side === "S" ? { x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z0 + th }
          : side === "N" ? { x0: c.x0, x1: c.x1, z0: c.z1 - th, z1: c.z1 }
          : side === "W" ? { x0: c.x0, x1: c.x0 + th, z0: c.z0 + th, z1: c.z1 - th }
          : { x0: c.x1 - th, x1: c.x1, z0: c.z0 + th, z1: c.z1 - th };
        const [lo, hi] = axis === "x" ? [strip.x0, strip.x1] : [strip.z0, strip.z1];
        const ops = ctx.sideOpenings(room.id, c, side);
        const solidCuts = [...columnCuts(strip, ctx.cols, axis), ...columnCuts(strip, ret.map((x) => x.r), axis)];
        const full = intervalMinus(lo, hi, [...solidCuts, ...ops.map((o) => [o.s0, o.s1] as [number, number])], 0.01);
        let n = 0;
        const add = (a0: number, a1: number, y0: number, y1: number) => {
          const r = axis === "x" ? { ...strip, x0: a0, x1: a1 } : { ...strip, z0: a0, z1: a1 };
          parts.push({ loc: `${side}${pad2(++n)}`, b: box(r.x0, r.x1, y0, y1, r.z0, r.z1), axis });
        };
        for (const [a0, a1] of full) add(a0, a1, ffl, top);
        // Below windows (ventilators sit high): tile up to the stone sill.
        for (const o of ops.filter((x) => x.kind === "window" && x.bottom > ffl + 0.05)) {
          for (const [a0, a1] of intervalMinus(Math.max(lo, o.s0), Math.min(hi, o.s1), solidCuts, 0.01)) add(a0, a1, ffl, Math.min(o.bottom, top));
        }
      }
      ret.forEach((rt, i) => {
        if (!intersect(rt.r, c)) return;
        parts.push({ loc: `C${rt.tag}${pad2(i + 1)}`, b: box(rt.r.x0, rt.r.x1, ffl, top, rt.r.z0, rt.r.z1), axis: rt.axis });
      });
    });
    if (parts.length === 0) continue;
    const env = unionBox(parts.map((p) => p.b));
    const asm = arcAssembly({ type: "TILE", floor: s, location: `${room.id}-WAL`, name: `Wall tiling, ${room.name} ${room.aptId}`, assemblyType: "wall_tiling", category: "partitions", materialId: "tile_wall_ceramic", min: env.min as Vec3, max: env.max as Vec3, dimensions: dimsSolid(env), unit: "nr", apartmentId: room.aptId, roomId: room.id });
    out.push(asm);
    for (const p of parts) {
      const { geometry, position } = boxGeom(p.b);
      out.push(arcRecord({ type: "TILE", floor: s, location: `${room.id}-WAL-${p.loc}`, name: `${room.name} ${room.aptId}: wall tile panel`, componentType: "wall_tile_panel", assemblyType: "wall_tiling", category: "partitions", materialId: "tile_wall_ceramic", geometry, position, dimensions: dimsVertical(p.b, p.axis), unit: "m2", parentId: asm.id, apartmentId: room.aptId, roomId: room.id }));
    }
  }
  return out;
}
