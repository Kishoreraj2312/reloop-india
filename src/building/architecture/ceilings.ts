/**
 * Ceilings (A2 stage 3), one assembly per room (ARC-CEIL-{floor}-{room}):
 * - field boards at FFL + 2.8, split into panels of at most `maxPanel` (panel groups)
 * - in living/dining/bedroom/study/lobby: a perimeter cove band dropped by `cove.drop`, with
 *   fascia boards standing on its inner edge up to the field
 * - every board keeps `shadowGap` from walls and columns (never coplanar with them)
 * The void above is open (hideable layer). Light fittings: ceilingFixtures().
 */

import type { ComponentRecord, Vec3 } from "../structure";
import type { InteriorContext, InteriorRoom } from "./interior";
import { UNFINISHED } from "./interior";
import type { RoomType } from "./layout";
import { inset, subtractAll, type PlanRect } from "./rect";
import { arcAssembly, arcRecord, box, boxGeom, dimsHorizontal, dimsSolid, dimsVertical, pad2, unionBox, type Box } from "./record";

export const COVE_ROOMS: ReadonlySet<RoomType> = new Set(["living", "dining", "bedroom", "study", "lobby"]);
const NO_CEILING: ReadonlySet<RoomType> = new Set(["stair", "shaft"]);

const grow = (r: PlanRect, d: number): PlanRect => ({ x0: r.x0 - d, x1: r.x1 + d, z0: r.z0 - d, z1: r.z1 + d });

/** Split a rectangle into a grid of panels no larger than `max` on either side. */
function panels(r: PlanRect, max: number): PlanRect[] {
  const nx = Math.max(1, Math.ceil((r.x1 - r.x0) / max - 1e-9));
  const nz = Math.max(1, Math.ceil((r.z1 - r.z0) / max - 1e-9));
  const out: PlanRect[] = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++)
      out.push({ x0: r.x0 + ((r.x1 - r.x0) * i) / nx, x1: r.x0 + ((r.x1 - r.x0) * (i + 1)) / nx, z0: r.z0 + ((r.z1 - r.z0) * j) / nz, z1: r.z0 + ((r.z1 - r.z0) * (j + 1)) / nz });
  return out;
}

/** Plan geometry of a room's ceiling: field (at the ceiling datum) and cove ring (dropped). */
export function ceilingLayout(ir: InteriorRoom, ctx: InteriorContext): { field: PlanRect[]; cove: PlanRect[]; fieldRect: PlanRect | null } {
  const c = ctx.arch.ceiling;
  const cutters = ctx.cols.map((k) => grow(k, c.shadowGap));
  const cove = COVE_ROOMS.has(ir.room.type) && ir.clears.length === 1;
  if (!cove) return { field: ir.clears.flatMap((r) => subtractAll(inset(r, c.shadowGap), cutters)), cove: [], fieldRect: null };
  const outer = inset(ir.clears[0]!, c.shadowGap);
  const fieldRect = inset(ir.clears[0]!, c.shadowGap + c.cove.width);
  return {
    field: subtractAll(fieldRect, cutters),
    cove: subtractAll(outer, [fieldRect, ...cutters]),
    fieldRect,
  };
}

export function generateCeilings(ctx: InteriorContext): ComponentRecord[] {
  const { plan, arch, d } = ctx;
  const s = plan.storey;
  const cc = arch.ceiling;
  const y = d.ceiling(s);
  const out: ComponentRecord[] = [];
  for (const ir of ctx.rooms.values()) {
    const room = ir.room;
    if (NO_CEILING.has(room.type) || UNFINISHED.has(room.type)) continue;
    const { field, cove, fieldRect } = ceilingLayout(ir, ctx);
    const parts: { loc: string; name: string; ctype: string; b: Box; dims: ReturnType<typeof dimsHorizontal> }[] = [];
    let n = 0;
    for (const f of field)
      for (const p of panels(f, cc.maxPanel)) {
        const b = box(p.x0, p.x1, y, y + cc.board, p.z0, p.z1);
        parts.push({ loc: `FLD${pad2(++n)}`, name: "ceiling board", ctype: "ceiling_board", b, dims: dimsHorizontal(b) });
      }
    let k = 0;
    const yc = y - cc.cove.drop;
    for (const r of cove)
      for (const p of panels(r, cc.maxPanel)) {
        const b = box(p.x0, p.x1, yc, yc + cc.board, p.z0, p.z1);
        parts.push({ loc: `COV${pad2(++k)}`, name: "cove band board", ctype: "ceiling_cove", b, dims: dimsHorizontal(b) });
      }
    if (fieldRect) {
      const t = cc.board;
      const F = fieldRect;
      const cutters = ctx.cols.map((c) => grow(c, cc.shadowGap));
      const fascia: [string, PlanRect, "x" | "z"][] = [
        ["S", { x0: F.x0 - t, x1: F.x1 + t, z0: F.z0 - t, z1: F.z0 }, "x"],
        ["N", { x0: F.x0 - t, x1: F.x1 + t, z0: F.z1, z1: F.z1 + t }, "x"],
        ["W", { x0: F.x0 - t, x1: F.x0, z0: F.z0, z1: F.z1 }, "z"],
        ["E", { x0: F.x1, x1: F.x1 + t, z0: F.z0, z1: F.z1 }, "z"],
      ];
      for (const [side, r, axis] of fascia) {
        subtractAll(r, cutters, axis === "z").forEach((p, i, all) => {
          const b = box(p.x0, p.x1, yc + t, y + t, p.z0, p.z1);
          parts.push({ loc: `FSC-${side}${all.length > 1 ? i + 1 : ""}`, name: "cove fascia", ctype: "ceiling_fascia", b, dims: dimsVertical(b, axis) });
        });
      }
    }
    if (parts.length === 0) continue;
    const env = unionBox(parts.map((p) => p.b));
    const asm = arcAssembly({
      type: "CEIL",
      floor: s,
      location: room.id,
      name: `Ceiling, ${room.name} ${room.aptId}`,
      assemblyType: "ceiling",
      category: "ceilings",
      materialId: "ceiling_gypsum",
      min: env.min as Vec3,
      max: env.max as Vec3,
      dimensions: dimsSolid(env),
      unit: "nr",
      apartmentId: room.aptId,
      roomId: room.id,
    });
    out.push(asm);
    for (const p of parts) {
      const { geometry, position } = boxGeom(p.b);
      out.push(arcRecord({ type: "CEIL", floor: s, location: `${room.id}-${p.loc}`, name: `${room.name} ${room.aptId}: ${p.name}`, componentType: p.ctype, assemblyType: "ceiling", category: "ceilings", materialId: "ceiling_gypsum", geometry, position, dimensions: p.dims, unit: "m2", parentId: asm.id, apartmentId: room.aptId, roomId: room.id }));
    }
  }
  return out;
}

/**
 * Ceiling light fittings (ARC-FIX-{floor}-{room}-LGT{nn}): a surface light at the centre of
 * cove-room fields, recessed downlight trims in the cove band (one per side) and, elsewhere,
 * downlights spaced along the room's long axis (about one per 6 m2, max spacing 3 m).
 */
export function ceilingFixtures(ctx: InteriorContext): ComponentRecord[] {
  const { plan, arch, d } = ctx;
  const s = plan.storey;
  const y = d.ceiling(s);
  const fx = arch.fixtures;
  const cc = arch.ceiling;
  const out: ComponentRecord[] = [];
  for (const ir of ctx.rooms.values()) {
    const room = ir.room;
    if (NO_CEILING.has(room.type) || UNFINISHED.has(room.type)) continue;
    const { field, cove, fieldRect } = ceilingLayout(ir, ctx);
    const lights: { kind: "surface" | "down"; x: number; z: number; top: number }[] = [];
    if (fieldRect) {
      lights.push({ kind: "surface", x: (fieldRect.x0 + fieldRect.x1) / 2, z: (fieldRect.z0 + fieldRect.z1) / 2, top: y });
      const yc = y - cc.cove.drop;
      const mid = cc.shadowGap + cc.cove.width / 2;
      const c = ir.clears[0]!;
      const cand = [
        { x: (c.x0 + c.x1) / 2, z: c.z0 + mid },
        { x: (c.x0 + c.x1) / 2, z: c.z1 - mid },
        { x: c.x0 + mid, z: (c.z0 + c.z1) / 2 },
        { x: c.x1 - mid, z: (c.z0 + c.z1) / 2 },
      ];
      for (const p of cand) if (cove.some((r) => inside(r, p.x, p.z, fx.downlightRadius))) lights.push({ kind: "down", ...p, top: yc });
    } else {
      for (const f of field) {
        const area = (f.x1 - f.x0) * (f.z1 - f.z0);
        if (area < 0.5) continue;
        const alongX = f.x1 - f.x0 >= f.z1 - f.z0;
        const len = alongX ? f.x1 - f.x0 : f.z1 - f.z0;
        const nByArea = Math.max(1, Math.round(area / 6));
        const nBySpacing = Math.ceil(len / 3);
        const count = Math.max(nByArea, nBySpacing);
        for (let i = 0; i < count; i++) {
          const t = (i + 0.5) / count;
          const x = alongX ? f.x0 + t * (f.x1 - f.x0) : (f.x0 + f.x1) / 2;
          const z = alongX ? (f.z0 + f.z1) / 2 : f.z0 + t * (f.z1 - f.z0);
          if (inside(f, x, z, fx.downlightRadius)) lights.push({ kind: "down", x, z, top: y });
        }
      }
    }
    if (lights.length === 0) continue;
    const boxes = lights.map((l) => {
      const r = l.kind === "surface" ? fx.surfaceLight.radius : fx.downlightRadius;
      const h = l.kind === "surface" ? fx.surfaceLight.height : 0.012;
      return { l, r, h, b: box(l.x - r, l.x + r, l.top - h, l.top, l.z - r, l.z + r) };
    });
    const env = unionBox(boxes.map((x) => x.b));
    // Ceiling-mounted fittings travel with the ceiling layer (hidden together in cutaway views).
    const asm = arcAssembly({ type: "FIX", floor: s, location: room.id, name: `Ceiling light fittings, ${room.name} ${room.aptId}`, assemblyType: "ceiling_fixtures", category: "ceilings", materialId: "fixture_light", min: env.min as Vec3, max: env.max as Vec3, dimensions: dimsSolid(env), unit: "nr", apartmentId: room.aptId, roomId: room.id });
    out.push(asm);
    boxes.forEach(({ l, r, h, b }, i) => {
      const { position } = boxGeom(b);
      out.push(
        arcRecord({
          type: "FIX",
          floor: s,
          location: `${room.id}-LGT${pad2(i + 1)}`,
          name: `${room.name} ${room.aptId}: ${l.kind === "surface" ? "surface ceiling light" : "recessed downlight trim"}`,
          componentType: l.kind === "surface" ? "light_surface" : "light_downlight",
          assemblyType: "ceiling_fixtures",
          category: "ceilings",
          materialId: "fixture_light",
          geometry: { kind: "cylinder", radius: r, height: h, axis: "y" },
          position,
          dimensions: { diameter: 2 * r, height: h },
          unit: "nr",
          parentId: asm.id,
          apartmentId: room.aptId,
          roomId: room.id,
        }),
      );
    });
  }
  return out;
}

function inside(r: PlanRect, x: number, z: number, m: number): boolean {
  return x - m >= r.x0 && x + m <= r.x1 && z - m >= r.z0 && z + m <= r.z1;
}
