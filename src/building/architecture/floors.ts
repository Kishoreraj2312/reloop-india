/**
 * Floor finishes (A2 stage 3), one assembly per room (ARC-FLR-{floor}-{room}):
 * - screed panels over the finishable floor (clear area minus columns / stair well)
 * - tile modules (ARC-TILE-...-R{row}C{col}) on a grid anchored at the room's clear corner,
 *   with grout joints as real gaps over the screed; cut tiles at walls and columns
 * - skirting (ARC-SKT) on dry-room walls, interrupted at doors and open boundaries, and
 *   returned around protruding columns. Wet rooms and kitchens get tiled walls instead.
 * FFL = slab top + screed + tile; skirting sits on the tiles.
 */

import type { ComponentRecord, Vec3 } from "../structure";
import type { InteriorContext } from "./interior";
import { columnCuts, intervalMinus, UNFINISHED } from "./interior";
import type { RoomType } from "./layout";
import type { Side } from "./plan";
import { EPS, intersect, subtractAll, type PlanRect } from "./rect";
import { arcAssembly, arcRecord, box, boxGeom, dimsHorizontal, dimsVertical, pad2, unionBox, type Box } from "./record";

const WET: ReadonlySet<RoomType> = new Set(["bathroom", "toilet", "utility"]);
const NO_SKIRTING: ReadonlySet<RoomType> = new Set(["bathroom", "toilet", "utility", "kitchen", "shaft"]);

export function tileMaterial(type: RoomType): string {
  return WET.has(type) ? "tile_antiskid" : "tile_porcelain_floor";
}

export function generateFloors(ctx: InteriorContext): ComponentRecord[] {
  const { plan, arch, d } = ctx;
  const s = plan.storey;
  const E = d.slabTop(s);
  const ffl = d.ffl(s);
  const dt = arch.datums;
  const out: ComponentRecord[] = [];

  for (const ir of ctx.rooms.values()) {
    const room = ir.room;
    if (UNFINISHED.has(room.type) || ir.floor.length === 0) continue;
    const aid = `${room.id}`;
    const parts: { type: "FLR" | "TILE" | "SKT"; loc: string; name: string; ctype: string; mat: string; b: Box; unit: "m2" | "m"; dims: ReturnType<typeof dimsHorizontal> }[] = [];

    ir.floor.forEach((r, i) => {
      const b = box(r.x0, r.x1, E, E + dt.screed, r.z0, r.z1);
      parts.push({ type: "FLR", loc: `${aid}-SCR${pad2(i + 1)}`, name: "screed / bedding", ctype: "floor_screed", mat: "cement_screed", b, unit: "m2", dims: dimsHorizontal(b) });
    });

    // Tile modules
    const m = WET.has(room.type) ? arch.floor.wetTileModule : arch.floor.tileModule;
    const g = arch.floor.grout;
    const ox = Math.min(...ir.clears.map((c) => c.x0));
    const oz = Math.min(...ir.clears.map((c) => c.z0));
    const seen = new Map<string, number>();
    for (const p of ir.floor) {
      const c0 = Math.floor((p.x0 - ox) / m + 1e-9);
      const c1 = Math.ceil((p.x1 - ox) / m - 1e-9);
      const r0 = Math.floor((p.z0 - oz) / m + 1e-9);
      const r1 = Math.ceil((p.z1 - oz) / m - 1e-9);
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++) {
          const cell: PlanRect = { x0: ox + c * m + g / 2, x1: ox + (c + 1) * m - g / 2, z0: oz + r * m + g / 2, z1: oz + (r + 1) * m - g / 2 };
          const t = intersect(cell, p);
          if (!t || t.x1 - t.x0 < 0.005 || t.z1 - t.z0 < 0.005) continue;
          const base = `${aid}-R${pad2(r + 1)}C${pad2(c + 1)}`;
          const n = (seen.get(base) ?? 0) + 1;
          seen.set(base, n);
          const b = box(t.x0, t.x1, E + dt.screed, ffl, t.z0, t.z1);
          parts.push({ type: "TILE", loc: n > 1 ? `${base}-${n}` : base, name: `floor tile ${(m * 1000).toFixed(0)} mm`, ctype: "floor_tile", mat: tileMaterial(room.type), b, unit: "m2", dims: dimsHorizontal(b) });
        }
      }
    }

    // Skirting
    if (!NO_SKIRTING.has(room.type)) {
      const sk = arch.floor.skirting;
      let k = 0;
      const addSk = (rect: PlanRect, axis: "x" | "z") => {
        const b = box(rect.x0, rect.x1, ffl, ffl + sk.height, rect.z0, rect.z1);
        parts.push({ type: "SKT", loc: `${aid}-${pad2(++k)}`, name: "skirting", ctype: "skirting", mat: "tile_porcelain_floor", b, unit: "m", dims: dimsVertical(b, axis) });
      };
      // Returns around protruding columns first (they cut the wall-side strips)
      const returns: { r: PlanRect; axis: "x" | "z" }[] = [];
      ir.clears.forEach((c) => {
        for (const col of ctx.cols) {
          const p = intersect(col, c);
          if (!p) continue;
          if (p.z1 < c.z1 - EPS) returns.push({ r: { x0: p.x0, x1: p.x1, z0: p.z1, z1: p.z1 + sk.thickness }, axis: "x" });
          if (p.z0 > c.z0 + EPS) returns.push({ r: { x0: p.x0, x1: p.x1, z0: p.z0 - sk.thickness, z1: p.z0 }, axis: "x" });
          if (p.x1 < c.x1 - EPS) returns.push({ r: { x0: p.x1, x1: p.x1 + sk.thickness, z0: p.z0, z1: p.z1 }, axis: "z" });
          if (p.x0 > c.x0 + EPS) returns.push({ r: { x0: p.x0 - sk.thickness, x1: p.x0, z0: p.z0, z1: p.z1 }, axis: "z" });
        }
      });
      const keepReturns = returns.filter((rt) => ir.clears.some((c) => intersect(rt.r, c)) && !ir.columns.some((col) => intersect(rt.r, col)));
      ir.clears.forEach((c) => {
        for (const side of ["S", "N", "W", "E"] as Side[]) {
          const axis = side === "S" || side === "N" ? "x" : "z";
          const strip: PlanRect =
            side === "S" ? { x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z0 + sk.thickness }
            : side === "N" ? { x0: c.x0, x1: c.x1, z0: c.z1 - sk.thickness, z1: c.z1 }
            : side === "W" ? { x0: c.x0, x1: c.x0 + sk.thickness, z0: c.z0 + sk.thickness, z1: c.z1 - sk.thickness }
            : { x0: c.x1 - sk.thickness, x1: c.x1, z0: c.z0 + sk.thickness, z1: c.z1 - sk.thickness };
          const [lo, hi] = axis === "x" ? [strip.x0, strip.x1] : [strip.z0, strip.z1];
          const cuts = [
            ...ctx.sideOpenings(room.id, c, side).filter((o) => o.kind !== "window" || o.bottom < ffl + sk.height).map((o) => [o.s0, o.s1] as [number, number]),
            ...columnCuts(strip, ctx.cols, axis),
            ...columnCuts(strip, keepReturns.map((x) => x.r), axis),
          ];
          for (const [a0, a1] of intervalMinus(lo, hi, cuts, 0.02)) {
            addSk(axis === "x" ? { ...strip, x0: a0, x1: a1 } : { ...strip, z0: a0, z1: a1 }, axis);
          }
        }
      });
      for (const rt of keepReturns) {
        for (const piece of subtractAll(rt.r, ctx.cols as PlanRect[])) addSk(piece, rt.axis);
      }
    }

    if (parts.length === 0) continue;
    const env = unionBox(parts.map((p) => p.b));
    const asm = arcAssembly({
      type: "FLR",
      floor: s,
      location: aid,
      name: `Floor finish, ${room.name} ${room.aptId}`,
      assemblyType: "floor_finish",
      category: "floors",
      materialId: tileMaterial(room.type),
      min: env.min as Vec3,
      max: env.max as Vec3,
      dimensions: { length: env.max[0] - env.min[0], width: env.max[2] - env.min[2], height: env.max[1] - env.min[1] },
      unit: "nr",
      apartmentId: room.aptId,
      roomId: room.id,
    });
    out.push(asm);
    for (const p of parts) {
      const { geometry, position } = boxGeom(p.b);
      out.push(arcRecord({ type: p.type, floor: s, location: p.loc, name: `${room.name} ${room.aptId}: ${p.name}`, componentType: p.ctype, assemblyType: "floor_finish", category: "floors", materialId: p.mat, geometry, position, dimensions: p.dims, unit: p.unit, parentId: asm.id, apartmentId: room.aptId, roomId: room.id }));
    }
  }
  return out;
}
