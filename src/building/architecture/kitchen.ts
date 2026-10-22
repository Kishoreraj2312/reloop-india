/**
 * Modular kitchens (A2 stage 4), one assembly per kitchen (ARC-KIT-{floor}-{room}).
 *
 * Runs: the longest wall free of doors/openings is the main run; a second run goes on an
 * adjacent free wall (L) or, failing that, the opposite wall when the aisle allows (galley).
 * Runs are trimmed to stay clear of door swings, door approach zones and columns.
 * Main run: fridge at the end nearest the entrance, 600 mm base modules (carcass, door and
 * drawer fronts, plinth), sink module (under a window if there is one), worktop cut around
 * the sink bowl, faucet, wall units (none over windows or the hob), backsplash.
 * Hob + hood on the second run (or on the main run, away from the sink).
 * Service connection points (water, drain) are visual stubs only: no plumbing network.
 */

import type { ComponentRecord, Vec3 } from "../structure";
import type { InteriorContext } from "./interior";
import { intervalMinus } from "./interior";
import { ADJACENT, blockedAlong, fixtureSpace, OPPOSITE, sideAxis, sideRange, wallBand, type FixtureSpace } from "./fixtureSpace";
import type { Side } from "./plan";
import { subtractAll, type PlanRect } from "./rect";
import { arcAssembly, arcRecord, box, boxGeom, dimsHorizontal, dimsSolid, dimsVertical, pad2, unionBox, type Box } from "./record";

interface Run {
  readonly tag: "M" | "L";
  readonly side: Side;
  readonly a0: number;
  readonly a1: number;
}

interface Part {
  readonly loc: string;
  readonly name: string;
  readonly ctype: string;
  readonly mat: string;
  readonly b: Box;
  readonly unit: "nr" | "m2" | "m";
  readonly dims: ReturnType<typeof dimsSolid>;
  readonly cyl?: { r: number; h: number; axis: "x" | "y" | "z" };
}

/** Largest free interval along a wall for a band `depth` deep, avoiding obstacles. */
function freeRun(sp: FixtureSpace, side: Side, depth: number, extra: readonly PlanRect[] = []): [number, number] | null {
  const [lo, hi] = sideRange(sp.clear, side);
  const band = wallBand(sp.clear, side, lo, hi, 0, depth);
  const free = intervalMinus(lo, hi, blockedAlong(sp, band, sideAxis(side), extra), 1e-6);
  if (free.length === 0) return null;
  return free.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
}

export function generateKitchens(ctx: InteriorContext): ComponentRecord[] {
  const { plan, arch, d } = ctx;
  const k = arch.kitchen;
  const s = plan.storey;
  const ffl = d.ffl(s);
  const out: ComponentRecord[] = [];

  for (const ir of ctx.rooms.values()) {
    if (ir.room.type !== "kitchen") continue;
    const room = ir.room;
    const sp = fixtureSpace(ctx, ir);
    const K = sp.clear;
    const sides: Side[] = ["S", "N", "W", "E"];
    const freeSides = sides.filter((sd) => !ctx.sideOpenings(room.id, K, sd).some((o) => o.kind !== "window"));
    const runs: Run[] = [];
    const candidates = freeSides
      .map((sd) => ({ sd, r: freeRun(sp, sd, k.counterDepth) }))
      .filter((c): c is { sd: Side; r: [number, number] } => c.r !== null && c.r[1] - c.r[0] >= k.minRun)
      .sort((p, q) => q.r[1] - q.r[0] - (p.r[1] - p.r[0]) || sides.indexOf(p.sd) - sides.indexOf(q.sd));
    const main = candidates[0];
    if (!main) continue;
    runs.push({ tag: "M", side: main.sd, a0: main.r[0], a1: main.r[1] });
    const mainRect = wallBand(K, main.sd, main.r[0], main.r[1], 0, k.counterDepth);
    // Second run: adjacent free wall (L) first, then the opposite wall (galley) if the aisle allows.
    const second = [
      ...ADJACENT[main.sd].filter((sd) => freeSides.includes(sd)).map((sd) => ({ sd, extra: [mainRect] })),
      ...(freeSides.includes(OPPOSITE[main.sd]) ? [{ sd: OPPOSITE[main.sd], extra: [wallBand(K, main.sd, main.r[0], main.r[1], 0, k.counterDepth + k.aisle)] }] : []),
    ]
      .map((c) => ({ ...c, r: freeRun(sp, c.sd, k.counterDepth, c.extra) }))
      .filter((c): c is { sd: Side; extra: PlanRect[]; r: [number, number] } => c.r !== null && c.r[1] - c.r[0] >= k.minRun);
    if (second[0]) runs.push({ tag: "L", side: second[0].sd, a0: second[0].r[0], a1: second[0].r[1] });

    // Entrance point: the door swinging into the kitchen (fridge goes to the run end nearest it).
    const door = plan.doors.find((x) => x.swingInto === room.id) ?? plan.doors.find((x) => x.rooms.includes(room.id))!;
    const doorPt = door.line.axis === "x" ? [door.centre, door.line.c] : [door.line.c, door.centre];
    const parts: Part[] = [];
    const add = (p: Part) => parts.push(p);
    const B = (side: Side, a0: number, a1: number, d0: number, d1: number, y0: number, y1: number): Box => {
      const r = wallBand(K, side, a0, a1, d0, d1);
      return box(r.x0, r.x1, y0, y1, r.z0, r.z1);
    };
    const top = ffl + k.counterTop;
    const carcassTop = top - k.counterThickness;
    let hobPlaced = false;

    runs.forEach((run) => {
      const axis = sideAxis(run.side);
      const along = (x: number, z: number) => (axis === "x" ? x : z);
      const windows = ctx.sideOpenings(room.id, K, run.side).filter((o) => o.kind === "window");
      let z0 = run.a0;
      let z1 = run.a1;
      // Fridge on the main run, at the end nearest the entrance
      if (run.tag === "M" && z1 - z0 >= k.minRun + k.fridge.width) {
        const dp = along(doorPt[0]!, doorPt[1]!);
        const atHi = Math.abs(dp - z1) < Math.abs(dp - z0);
        const [f0, f1] = atHi ? [z1 - k.fridge.width, z1] : [z0, z0 + k.fridge.width];
        const fb = B(run.side, f0, f1, 0.02, 0.02 + k.fridge.depth, ffl, ffl + k.fridge.height);
        add({ loc: "FRG", name: "refrigerator", ctype: "kitchen_fridge", mat: "appliance_white", b: fb, unit: "nr", dims: dimsSolid(fb) });
        if (atHi) z1 = f0;
        else z0 = f1;
      }
      const n = Math.floor((z1 - z0) / k.module + 1e-9);
      if (n < 1) return;
      const filler = z1 - z0 - n * k.module;
      const m0 = (i: number) => z0 + i * k.module;
      const winMid = windows.map((w) => (w.s0 + w.s1) / 2);
      const overWindow = (i: number) => windows.some((w) => w.s1 > m0(i) && w.s0 < m0(i) + k.module);
      // Sink: module under a window, else the middle module (main run only)
      let sinkI = -1;
      if (run.tag === "M") {
        const wm = winMid.find((c) => c > z0 && c < z1);
        sinkI = wm !== undefined ? Math.min(n - 1, Math.max(0, Math.floor((wm - z0) / k.module))) : Math.floor((n - 1) / 2);
      }
      // Hob: middle of the second run, else the main-run module farthest from the sink (>= 1 module gap)
      let hobI = -1;
      if (!hobPlaced) {
        if (run.tag === "L") hobI = Math.floor((n - 1) / 2);
        else if (runs.length === 1 && n >= 3) hobI = sinkI >= n / 2 ? 0 : n - 1;
        if (hobI >= 0 && overWindow(hobI)) hobI = [...Array(n).keys()].find((i) => !overWindow(i) && Math.abs(i - sinkI) >= 2) ?? -1;
        if (hobI >= 0) hobPlaced = true;
      }
      const R = run.tag;
      // Plinth and worktop over the cabinet zone
      const pl = B(run.side, z0, z1, 0, k.carcassDepth - k.plinthSetback, ffl, ffl + k.plinth);
      add({ loc: `${R}-PLN`, name: "plinth (toe kick)", ctype: "kitchen_plinth", mat: "cabinet_laminate", b: pl, unit: "m", dims: dimsVertical(pl, axis) });
      const sinkA0 = sinkI >= 0 ? m0(sinkI) + (k.module - k.sink.width) / 2 : 0;
      const sinkA1 = sinkA0 + k.sink.width;
      const sd1 = k.counterDepth - k.sink.front;
      const sd0 = sd1 - k.sink.depth;
      const cut = sinkI >= 0 ? [wallBand(K, run.side, sinkA0, sinkA1, sd0, sd1)] : [];
      subtractAll(wallBand(K, run.side, z0, z1, 0, k.counterDepth), cut, axis === "z").forEach((r, i) => {
        const b = box(r.x0, r.x1, carcassTop, top, r.z0, r.z1);
        add({ loc: `${R}-CTP${i + 1}`, name: "granite worktop", ctype: "kitchen_countertop", mat: "countertop_granite", b, unit: "m2", dims: dimsHorizontal(b) });
      });
      // Base modules
      for (let i = 0; i < n; i++) {
        const a0 = m0(i);
        const a1 = a0 + k.module;
        const tag = `${R}-BAS${pad2(i + 1)}`;
        const sink = i === sinkI;
        const cb = B(run.side, a0, a1, sink ? k.serviceVoid : 0, k.carcassDepth, ffl + k.plinth, sink ? ffl + k.sinkBaseTop : carcassTop);
        add({ loc: tag, name: sink ? "sink base unit carcass" : "base unit carcass", ctype: "kitchen_base_cabinet", mat: "cabinet_laminate", b: cb, unit: "nr", dims: dimsSolid(cb) });
        const g = k.frontGap;
        const fd: [number, number] = [k.carcassDepth, k.carcassDepth + k.front];
        if (sink) {
          const fb = B(run.side, a0 + g, a1 - g, fd[0], fd[1], ffl + k.plinth + g, carcassTop - g);
          add({ loc: `${tag}-DR`, name: "sink unit door front", ctype: "kitchen_door_front", mat: "cabinet_laminate", b: fb, unit: "nr", dims: dimsSolid(fb) });
        } else {
          const dr = B(run.side, a0 + g, a1 - g, fd[0], fd[1], carcassTop - k.drawer, carcassTop - g);
          add({ loc: `${tag}-DW`, name: "drawer front", ctype: "kitchen_drawer_front", mat: "cabinet_laminate", b: dr, unit: "nr", dims: dimsSolid(dr) });
          const dd = B(run.side, a0 + g, a1 - g, fd[0], fd[1], ffl + k.plinth + g, carcassTop - k.drawer - g);
          add({ loc: `${tag}-DR`, name: "door front", ctype: "kitchen_door_front", mat: "cabinet_laminate", b: dd, unit: "nr", dims: dimsSolid(dd) });
        }
        // Wall units: not over windows or the hob
        if (run.tag === "M" && i !== hobI && !overWindow(i)) {
          const wu = k.wallUnit;
          const wc = B(run.side, a0, a1, 0, wu.depth - k.front, ffl + wu.bottom, ffl + wu.top);
          add({ loc: `${R}-WAL${pad2(i + 1)}`, name: "wall unit carcass", ctype: "kitchen_wall_cabinet", mat: "cabinet_laminate", b: wc, unit: "nr", dims: dimsSolid(wc) });
          const wf = B(run.side, a0 + g, a1 - g, wu.depth - k.front, wu.depth, ffl + wu.bottom + g, ffl + wu.top - g);
          add({ loc: `${R}-WAL${pad2(i + 1)}-DR`, name: "wall unit shutter", ctype: "kitchen_door_front", mat: "cabinet_front_light", b: wf, unit: "nr", dims: dimsSolid(wf) });
        }
        if (i === hobI) {
          const mc = (a0 + a1) / 2;
          const hb = B(run.side, mc - k.hob.width / 2, mc + k.hob.width / 2, 0.05, 0.05 + k.hob.depth, top, top + k.hob.height);
          add({ loc: "HOB", name: "built-in hob", ctype: "kitchen_hob", mat: "appliance_black", b: hb, unit: "nr", dims: dimsSolid(hb) });
          const hc = B(run.side, a0, a1, 0, k.hood.depth, ffl + k.hood.bottom, ffl + k.hood.bottom + k.hood.canopy);
          add({ loc: "HOD-C", name: "chimney hood canopy", ctype: "kitchen_hood", mat: "stainless_steel", b: hc, unit: "nr", dims: dimsSolid(hc) });
          const hf = B(run.side, mc - k.hood.flue / 2, mc + k.hood.flue / 2, 0, k.hood.flue, ffl + k.hood.bottom + k.hood.canopy, ffl + k.wallUnit.top);
          add({ loc: "HOD-F", name: "chimney hood flue", ctype: "kitchen_hood", mat: "stainless_steel", b: hf, unit: "nr", dims: dimsSolid(hf) });
        }
      }
      if (filler > 0.01) {
        const fb = B(run.side, z0 + n * k.module, z1, 0, k.carcassDepth + k.front, ffl + k.plinth, carcassTop);
        add({ loc: `${R}-FIL`, name: "filler panel", ctype: "kitchen_filler", mat: "cabinet_laminate", b: fb, unit: "nr", dims: dimsSolid(fb) });
      }
      // Sink bowl (bottom + four walls inside the worktop cut-out), faucet, service stubs
      if (sinkI >= 0) {
        const w = k.sink.wall;
        const yb = top - k.sink.bowl;
        const bowl = (loc: string, a0: number, a1: number, dd0: number, dd1: number, y0: number) => {
          const b = B(run.side, a0, a1, dd0, dd1, y0, top);
          add({ loc, name: "sink bowl", ctype: "kitchen_sink", mat: "stainless_steel", b, unit: "nr", dims: dimsSolid(b) });
        };
        // Base plate, then four walls standing on it up to the worktop surface.
        const bottom = B(run.side, sinkA0, sinkA1, sd0, sd1, yb, yb + w);
        add({ loc: "SNK-B", name: "sink bowl base", ctype: "kitchen_sink", mat: "stainless_steel", b: bottom, unit: "nr", dims: dimsSolid(bottom) });
        bowl("SNK-1", sinkA0, sinkA1, sd0, sd0 + w, yb + w);
        bowl("SNK-2", sinkA0, sinkA1, sd1 - w, sd1, yb + w);
        bowl("SNK-3", sinkA0, sinkA0 + w, sd0 + w, sd1 - w, yb + w);
        bowl("SNK-4", sinkA1 - w, sinkA1, sd0 + w, sd1 - w, yb + w);
        const fc = (sinkA0 + sinkA1) / 2;
        const fr = 0.015;
        const fdep = sd0 / 2;
        const body = B(run.side, fc - fr, fc + fr, fdep - fr, fdep + fr, top, top + 0.25);
        add({ loc: "FCT-B", name: "faucet body", ctype: "kitchen_faucet", mat: "stainless_steel", b: body, unit: "nr", dims: dimsSolid(body), cyl: { r: fr, h: 0.25, axis: "y" } });
        const spout = B(run.side, fc - 0.01, fc + 0.01, fdep + fr, sd0 + k.sink.depth / 2, top + 0.22, top + 0.245);
        add({ loc: "FCT-S", name: "faucet spout", ctype: "kitchen_faucet", mat: "stainless_steel", b: spout, unit: "nr", dims: dimsSolid(spout) });
        const stub = (loc: string, name: string, a: number, y: number) => {
          const r = 0.02;
          const b = B(run.side, a - r, a + r, 0, k.serviceVoid - 0.005, y - r, y + r);
          add({ loc, name, ctype: "connection_point", mat: "pvc_pipe", b, unit: "nr", dims: dimsSolid(b), cyl: { r, h: k.serviceVoid - 0.005, axis: axis === "x" ? "z" : "x" } });
        };
        stub("CPW", "water supply connection point", fc - 0.12, ffl + 0.5);
        stub("CPD", "drain connection point", fc + 0.12, ffl + 0.35);
      }
      // Backsplash over the cabinet zone, cut at windows
      const bs = arch.tiling.backsplash;
      for (const [a0, a1] of intervalMinus(z0, z1, windows.map((w) => [w.s0, w.s1] as [number, number]), 0.01)) {
        const b = B(run.side, a0, a1, 0, arch.tiling.thickness, ffl + bs.bottom, ffl + bs.top);
        add({ loc: `${R}-BSP${parts.filter((p) => p.loc.startsWith(`${R}-BSP`)).length + 1}`, name: "tiled backsplash", ctype: "kitchen_backsplash", mat: "tile_backsplash", b, unit: "m2", dims: dimsVertical(b, axis) });
      }
    });

    if (parts.length === 0) continue;
    const env = unionBox(parts.map((p) => p.b));
    const asm = arcAssembly({ type: "KIT", floor: s, location: room.id, name: `Kitchen, ${room.aptId}`, assemblyType: "kitchen", category: "fixtures", materialId: "cabinet_laminate", min: env.min as Vec3, max: env.max as Vec3, dimensions: dimsSolid(env), unit: "nr", apartmentId: room.aptId, roomId: room.id });
    out.push(asm);
    for (const p of parts) {
      const { geometry, position } = boxGeom(p.b);
      out.push(
        arcRecord({
          type: "KIT",
          floor: s,
          location: `${room.id}-${p.loc}`,
          name: `Kitchen ${room.aptId}: ${p.name}`,
          componentType: p.ctype,
          assemblyType: "kitchen",
          category: "fixtures",
          materialId: p.mat,
          geometry: p.cyl ? { kind: "cylinder", radius: p.cyl.r, height: p.cyl.h, axis: p.cyl.axis } : geometry,
          position,
          dimensions: p.dims,
          unit: p.unit,
          parentId: asm.id,
          apartmentId: room.aptId,
          roomId: room.id,
        }),
      );
    }
  }
  return out;
}
