/**
 * Bathroom fittings (A2 stage 4), assembly ARC-BATH-{floor}-{room}, laid out against the
 * wall opposite the door (the back wall), in front of the wall tiling:
 *   shower corner (bathrooms only) at the back-wall end farthest from the door: tray, glass
 *   screen, mixer, arm + head, soap shelf, drain grating
 *   WC next to it: pan + wall cistern, paper holder, towel rail above
 *   basin on the remaining back wall or, failing that, a side wall: wall-hung basin, faucet,
 *   mirror; floor drain in toilets without a shower
 *   connection points (visual stubs only; no plumbing network)
 * Every candidate position is checked against door swings, door approach zones, columns and
 * the other fittings; clearance zones (WC front 0.6, basin front 0.6, shower entry 0.6) are
 * returned for validation. Utilities get a washing machine and stubs (ARC-FIX-...-APP).
 */

import type { ComponentRecord, Vec3 } from "../structure";
import type { InteriorContext } from "./interior";
import { ADJACENT, fixtureSpace, isFree, OPPOSITE, sideAxis, sideRange, wallBand, type FixtureSpace } from "./fixtureSpace";
import type { Side } from "./plan";
import { EPS, inset, overlaps, type PlanRect } from "./rect";
import { arcAssembly, arcRecord, box, boxGeom, dimsSolid, dimsVertical, unionBox, type ArcType, type Box } from "./record";

export interface Clearance {
  readonly roomId: string;
  readonly kind: "wc" | "basin" | "shower" | "washer";
  readonly rect: PlanRect;
}

interface Part {
  readonly loc: string;
  readonly name: string;
  readonly ctype: string;
  readonly mat: string;
  readonly b: Box;
  readonly cyl?: { r: number; h: number; axis: "x" | "y" | "z" };
  readonly unit?: "nr" | "m2";
}

/** Side of the room that holds its (first) door. */
function doorSide(ctx: InteriorContext, roomId: string, clear: PlanRect): Side | null {
  for (const sd of ["S", "N", "W", "E"] as Side[]) if (ctx.sideOpenings(roomId, clear, sd).some((o) => o.kind === "door")) return sd;
  return null;
}

export function generateBathrooms(ctx: InteriorContext): { records: ComponentRecord[]; clearances: Clearance[] } {
  const { plan, arch, d } = ctx;
  const bc = arch.bathroom;
  const s = plan.storey;
  const ffl = d.ffl(s);
  const records: ComponentRecord[] = [];
  const clearances: Clearance[] = [];

  for (const ir of ctx.rooms.values()) {
    const type = ir.room.type;
    if (type !== "bathroom" && type !== "toilet" && type !== "utility") continue;
    const room = ir.room;
    // Compact wet rooms: the approach zone is the 0.6 m fixture clearance (the swing arc is checked separately).
    const base = fixtureSpace(ctx, ir, bc.clearance);
    const tiled = type !== "utility";
    // Fittings stand in front of the wall tiling.
    const th = tiled ? arch.tiling.thickness : 0;
    const sp: FixtureSpace = { ...base, clear: inset(base.clear, th), columns: base.columns.map((c) => inset(c, -th)) };
    const U = sp.clear;
    const ds = doorSide(ctx, room.id, base.clear);
    if (!ds) continue;
    const back = OPPOSITE[ds];
    const [lo, hi] = sideRange(U, back);
    const door = plan.doors.find((x) => x.rooms.includes(room.id))!;
    const dAlong = sideAxis(back) === sideAxis(door.line.axis === "x" ? "S" : "W") ? door.centre : door.line.c;
    const farHi = Math.abs(hi - dAlong) >= Math.abs(lo - dAlong); // farthest back-wall end from the door
    const parts: Part[] = [];
    const taken: PlanRect[] = [];
    const B = (side: Side, a0: number, a1: number, d0: number, d1: number, y0: number, y1: number): Box => {
      const r = wallBand(U, side, a0, a1, d0, d1);
      return box(r.x0, r.x1, y0, y1, r.z0, r.z1);
    };
    const plan2 = (b: Box): PlanRect => ({ x0: b.min[0], x1: b.max[0], z0: b.min[2], z1: b.max[2] });
    const zones: PlanRect[] = []; // clearance zones already granted in this room
    const fits = (rs: PlanRect[]) => rs.every((r) => isFree(sp, r, [...taken, ...zones]));
    const place = (ps: Part[]) => {
      for (const p of ps) {
        parts.push(p);
        taken.push(plan2(p.b));
      }
    };
    const clear = (kind: Clearance["kind"], r: PlanRect) => {
      clearances.push({ roomId: room.id, kind, rect: r });
      zones.push(r);
    };
    const clearOk = (r: PlanRect) => r.x0 >= U.x0 - 1e-9 && r.x1 <= U.x1 + 1e-9 && r.z0 >= U.z0 - 1e-9 && r.z1 <= U.z1 + 1e-9 && !taken.some((t) => overlaps(t, r)) && !sp.columns.some((c) => overlaps(c, r));
    const stub = (loc: string, name: string, side: Side, a: number, y: number) => {
      const r = 0.02;
      const b = B(side, a - r, a + r, 0, 0.05, y - r, y + r);
      parts.push({ loc, name, ctype: "connection_point", mat: "pvc_pipe", b, cyl: { r, h: 0.05, axis: sideAxis(side) === "x" ? "z" : "x" } });
    };

    if (type === "utility") {
      const w = bc.washer;
      const [a0, a1] = farHi ? [hi - w.width, hi] : [lo, lo + w.width];
      const wb = B(back, a0, a1, 0.05, 0.05 + w.depth, ffl, ffl + w.height);
      const front = wallBand(U, back, a0, a1, 0.05 + w.depth, 0.05 + w.depth + bc.clearance);
      if (!fits([plan2(wb)]) || !clearOk(front)) continue;
      place([{ loc: "WSH", name: "washing machine", ctype: "appliance_washer", mat: "appliance_white", b: wb }]);
      clear("washer", front);
      stub("CPW", "water supply connection point", back, (a0 + a1) / 2 - 0.15, ffl + 1.0);
      stub("CPD", "drain connection point", back, (a0 + a1) / 2 + 0.15, ffl + 0.9);
      const dg = bc.drain;
      const ad = farHi ? a0 - 0.25 : a1 + 0.25;
      const db = B(back, ad - dg / 2, ad + dg / 2, 0.2, 0.2 + dg, ffl, ffl + 0.004);
      if (fits([plan2(db)])) place([{ loc: "DRN", name: "floor drain grating", ctype: "floor_drain", mat: "stainless_steel", b: db }]);
      emit(records, "FIX", s, `${room.id}-APP`, `Utility appliances, ${room.name} ${room.aptId}`, "utility_appliances", room.aptId, room.id, parts);
      continue;
    }

    // Shower corner
    let cursor = farHi ? hi : lo; // back-wall position next free fitting starts from
    const dir = farHi ? -1 : 1;
    const tray = bc.tray.size;
    /** First position from the preferred end (stepping inward) where `ok(a0, a1)` holds. */
    const slide = (from: number, width: number, ok: (a0: number, a1: number) => boolean): [number, number] | null => {
      for (let off = 0; off <= hi - lo - width + 1e-9; off += 0.025) {
        const [a0, a1] = dir < 0 ? [from - off - width, from - off] : [from + off, from + off + width];
        if (a0 < lo - 1e-9 || a1 > hi + 1e-9) break;
        if (ok(a0, a1)) return [a0, a1];
      }
      return null;
    };
    const trayAt = slide(cursor, tray, (a0, a1) => fits([plan2(B(back, a0, a1, 0, tray, ffl, ffl + bc.tray.height))]) && clearOk(wallBand(U, back, a0, a1, tray, tray + bc.clearance)));
    if (type === "bathroom" && trayAt) {
      const [a0, a1] = trayAt;
      const tb = B(back, a0, a1, 0, tray, ffl, ffl + bc.tray.height);
      const entry = wallBand(U, back, a0, a1, tray, tray + bc.clearance);
      {
        const yT = ffl + bc.tray.height;
        const ac = (a0 + a1) / 2;
        const inner = farHi ? a0 : a1;
        const sc = bc.screen;
        place([{ loc: "SHW-T", name: "shower tray", ctype: "shower_tray", mat: "sanitary_ceramic", b: tb }]);
        parts.push({ loc: "SHW-G", name: "glass shower screen", ctype: "shower_screen", mat: "glass_clear", b: B(back, Math.min(inner, inner - dir * sc.thickness), Math.max(inner, inner - dir * sc.thickness), 0, tray, yT, yT + sc.height), unit: "m2" });
        parts.push({ loc: "SHW-M", name: "shower mixer", ctype: "shower_mixer", mat: "stainless_steel", b: B(back, ac - 0.08, ac + 0.08, 0, 0.06, ffl + bc.shower.mixerHeight - 0.08, ffl + bc.shower.mixerHeight + 0.08) });
        const ar = 0.012;
        const hy = ffl + bc.shower.headHeight;
        parts.push({ loc: "SHW-A", name: "shower arm", ctype: "shower_arm", mat: "stainless_steel", b: B(back, ac - ar, ac + ar, 0, bc.shower.arm, hy - ar, hy + ar), cyl: { r: ar, h: bc.shower.arm, axis: sideAxis(back) === "x" ? "z" : "x" } });
        parts.push({ loc: "SHW-H", name: "shower head", ctype: "shower_head", mat: "stainless_steel", b: B(back, ac - 0.08, ac + 0.08, bc.shower.arm - 0.16, bc.shower.arm, hy - ar - 0.02, hy - ar), cyl: { r: 0.08, h: 0.02, axis: "y" } });
        parts.push({ loc: "SHW-S", name: "soap shelf", ctype: "bath_accessory", mat: "stainless_steel", b: B(back, ac + 0.18 * -dir - 0.12, ac + 0.18 * -dir + 0.12, 0, 0.1, ffl + 1.3, ffl + 1.32) });
        const dg = bc.drain;
        parts.push({ loc: "DRN", name: "shower drain grating", ctype: "floor_drain", mat: "stainless_steel", b: B(back, ac - dg / 2, ac + dg / 2, tray / 2 - dg / 2, tray / 2 + dg / 2, yT, yT + 0.004) });
        clear("shower", entry);
        cursor = farHi ? a0 : a1;
      }
    }

    // WC next to the shower (or at the far end)
    const wc = bc.wc;
    const wcParts = (z0: number, z1: number) => {
      const c = (z0 + z1) / 2;
      return {
        c,
        pan: B(back, c - wc.width / 2, c + wc.width / 2, wc.cisternDepth, wc.cisternDepth + wc.depth, ffl, ffl + wc.height),
        cis: B(back, c - 0.2, c + 0.2, 0, wc.cisternDepth, ffl + wc.height - 0.1, ffl + wc.cisternTop),
        front: wallBand(U, back, c - wc.width / 2, c + wc.width / 2, wc.cisternDepth + wc.depth, wc.cisternDepth + wc.depth + bc.clearance),
      };
    };
    const wcAt = slide(cursor, wc.zone, (z0, z1) => {
      const w = wcParts(z0, z1);
      return fits([plan2(w.pan), plan2(w.cis)]) && clearOk(w.front);
    });
    if (wcAt) {
      const [z0, z1] = wcAt;
      const { c: wcC, pan, cis, front: wcFront } = wcParts(z0, z1);
      place([
        { loc: "WC-P", name: "WC pan", ctype: "wc_pan", mat: "sanitary_ceramic", b: pan },
        { loc: "WC-C", name: "WC cistern", ctype: "wc_cistern", mat: "sanitary_ceramic", b: cis },
      ]);
      clear("wc", wcFront);
      // Accessories on the side away from the shower screen.
      stub("CP-WC", "WC water connection point", back, wcC + dir * 0.3, ffl + 0.2);
      const tph = wcC + dir * 0.32;
      const holder = B(back, tph - 0.06, tph + 0.06, 0, 0.1, ffl + 0.62, ffl + 0.7);
      if (fits([plan2(holder)])) parts.push({ loc: "TPH", name: "toilet paper holder", ctype: "bath_accessory", mat: "stainless_steel", b: holder });
      const rl = bc.rail;
      const ry = ffl + rl.height;
      // Towel rail above the WC, shortened if a column stands in the way.
      for (const len of [rl.length, rl.length * 0.75, rl.length * 0.5]) {
        const rail = B(back, wcC - len / 2, wcC + len / 2, 0, rl.standoff + rl.radius, ry - rl.radius, ry + rl.radius);
        if (!fits([plan2(rail)])) continue;
        parts.push({ loc: "TWR", name: "towel rail", ctype: "towel_rail", mat: "stainless_steel", b: B(back, wcC - len / 2, wcC + len / 2, rl.standoff - rl.radius, rl.standoff + rl.radius, ry - rl.radius, ry + rl.radius), cyl: { r: rl.radius, h: len, axis: sideAxis(back) } });
        for (const [i, e] of [wcC - len / 2 + 0.03, wcC + len / 2 - 0.03].entries())
          parts.push({ loc: `TWR-B${i + 1}`, name: "towel rail bracket", ctype: "towel_rail", mat: "stainless_steel", b: B(back, e - 0.01, e + 0.01, 0, rl.standoff - rl.radius, ry - 0.01, ry + 0.01) });
        break;
      }
      cursor = dir < 0 ? z0 : z1;
    }

    // Basin: remaining back wall, else a side wall
    const bs = bc.basin;
    const basinAt = (side: Side, ac: number): Part[] | null => {
      const bb = B(side, ac - bs.width / 2, ac + bs.width / 2, 0, bs.depth, ffl + bs.top - bs.height, ffl + bs.top);
      const front = wallBand(U, side, ac - bs.width / 2, ac + bs.width / 2, bs.depth, bs.depth + bc.clearance);
      if (!fits([plan2(bb)]) || !clearOk(front)) return null;
      clear("basin", front);
      const fr = 0.015;
      const fd = 0.06;
      const bt = ffl + bs.top;
      const m = bc.mirror;
      return [
        { loc: "BSN", name: "wall-hung basin", ctype: "basin", mat: "sanitary_ceramic", b: bb },
        { loc: "BSN-FCT-B", name: "basin faucet body", ctype: "basin_faucet", mat: "stainless_steel", b: B(side, ac - fr, ac + fr, fd - fr, fd + fr, bt, bt + 0.15), cyl: { r: fr, h: 0.15, axis: "y" } },
        { loc: "BSN-FCT-S", name: "basin faucet spout", ctype: "basin_faucet", mat: "stainless_steel", b: B(side, ac - 0.01, ac + 0.01, fd + fr, fd + 0.12, bt + 0.12, bt + 0.14) },
        { loc: "MIR", name: "mirror", ctype: "mirror", mat: "glass_mirror", b: B(side, ac - m.width / 2, ac + m.width / 2, 0, m.thickness, ffl + m.bottom, ffl + m.bottom + m.height), unit: "m2" },
      ];
    };
    let basin: { side: Side; ac: number; parts: Part[] } | null = null;
    const rest: [number, number] = dir < 0 ? [lo, cursor] : [cursor, hi];
    if (rest[1] - rest[0] >= bs.width + 0.05) {
      const ac = dir < 0 ? rest[0] + 0.025 + bs.width / 2 : rest[1] - 0.025 - bs.width / 2;
      const p = basinAt(back, ac);
      if (p) basin = { side: back, ac, parts: p };
    }
    if (!basin) {
      for (const side of ADJACENT[back]) {
        const [s0, s1] = sideRange(U, side);
        // Near the door end of the side wall first, then toward the back.
        const nearDoorLow = (ds === "S" && side !== "S") || (ds === "W" && side !== "W") ? true : false;
        // Slide from the door end toward the back wall in 25 mm steps.
        const tries: number[] = [];
        for (let off = 0.05; off <= s1 - s0 - bs.width; off += 0.025) tries.push(nearDoorLow ? s0 + off + bs.width / 2 : s1 - off - bs.width / 2);
        for (const ac of tries) {
          if (ac - bs.width / 2 < s0 - EPS || ac + bs.width / 2 > s1 + EPS) continue;
          const p = basinAt(side, ac);
          if (p) {
            basin = { side, ac, parts: p };
            break;
          }
        }
        if (basin) break;
      }
    }
    if (basin) {
      place(basin.parts.slice(0, 1));
      parts.push(...basin.parts.slice(1));
      stub("CP-BSN-W", "basin water connection point", basin.side, basin.ac - 0.1, ffl + 0.55);
      stub("CP-BSN-D", "basin drain connection point", basin.side, basin.ac + 0.1, ffl + 0.45);
    }
    if (type === "toilet") {
      // Floor drain: first free spot on a coarse grid over the room, nearest the back wall.
      const dg = bc.drain;
      const depthMax = Math.abs(sideAxis(back) === "x" ? U.z1 - U.z0 : U.x1 - U.x0);
      search: for (let dd = 0.25; dd + dg < depthMax; dd += 0.1) {
        for (let a = lo + 0.2; a + dg < hi - 0.2; a += 0.1) {
          const db = B(back, a, a + dg, dd, dd + dg, ffl, ffl + 0.004);
          if (fits([plan2(db)])) {
            place([{ loc: "DRN", name: "floor drain grating", ctype: "floor_drain", mat: "stainless_steel", b: db }]);
            break search;
          }
        }
      }
    }
    if (parts.length === 0) continue;
    emit(records, "BATH", s, room.id, `Bathroom fittings, ${room.name} ${room.aptId}`, "bathroom", room.aptId, room.id, parts);
  }
  return { records, clearances };
}

function emit(out: ComponentRecord[], type: ArcType, floor: number, loc: string, name: string, assemblyType: string, aptId: string, roomId: string, parts: Part[]): void {
  const env = unionBox(parts.map((p) => p.b));
  const asm = arcAssembly({ type, floor, location: loc, name, assemblyType, category: "fixtures", materialId: "sanitary_ceramic", min: env.min as Vec3, max: env.max as Vec3, dimensions: dimsSolid(env), unit: "nr", apartmentId: aptId, roomId });
  out.push(asm);
  for (const p of parts) {
    const { geometry, position } = boxGeom(p.b);
    out.push(
      arcRecord({
        type,
        floor,
        location: `${loc}-${p.loc}`,
        name: `${name.split(",")[0]}: ${p.name}`,
        componentType: p.ctype,
        assemblyType,
        category: "fixtures",
        materialId: p.mat,
        geometry: p.cyl ? { kind: "cylinder", radius: p.cyl.r, height: p.cyl.h, axis: p.cyl.axis } : geometry,
        position,
        dimensions: p.unit === "m2" ? dimsVertical(p.b, Math.abs(p.b.max[0] - p.b.min[0]) >= Math.abs(p.b.max[2] - p.b.min[2]) ? "x" : "z") : dimsSolid(p.b),
        unit: p.unit ?? "nr",
        parentId: asm.id,
        apartmentId: aptId,
        roomId,
      }),
    );
  }
}
