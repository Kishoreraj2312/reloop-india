/**
 * Wiring devices (A3): distribution boards, switch boards, sockets and appliance points,
 * placed by rules on the real A2 room geometry. Every candidate position is checked against
 * the building (openings, columns, fixtures, tiles), door swings, other services and a
 * clear wall chase up to its conduit layer, so a device is only placed where it can
 * actually be wired.
 *
 * Rules (conceptual, typical Indian residential practice):
 *   switch board   one per room at the latch side of its entry, 1.2 m (wet rooms: outside the door)
 *   6 A sockets    living 3, bedroom 2 bedside + 1, study 2, dining / foyer 1, offices 1-2
 *   AC point       living, bedrooms, study: high on a wall, exterior wall preferred
 *   kitchen        2 counter sockets on the backsplash, fridge, chimney hood point
 *   utility        washing-machine point near the washer
 *   bathrooms      geyser point beside the geyser
 *   flat DB        in the foyer by the entrance; common DB (CDB) per floor in the services room
 */

import type { ComponentRecord } from "../structure";
import type { InteriorRoom } from "../architecture/interior";
import type { PlanDoor, Side } from "../architecture/plan";
import type { PlanRect } from "../architecture/rect";
import { arcHitsRect, swingArcs, type SwingArc } from "../architecture/swing";
import { MEP_CONFIG } from "./config";
import { CEILINGS, FINISHES, indexDrafts, MASONRY, type MepContext } from "./context";
import { box3 } from "./space";
import { FIXED_PARTS, type FixedPart } from "./parts";
import { findChase, mountOn, wallPart, wallPartBox, wallPoint, type Mount } from "./walls";
import type { Group } from "./record";
import type { P2, V3 } from "./geom";

const C = MEP_CONFIG;
const RF = 5;
export const ftag = (s: number) => (s === 0 ? "G" : s === RF ? "RF" : `F0${s}`);

export type Layer = "lighting" | "power";
export type DeviceKind = "switch" | "socket" | "ac" | "counter" | "fridge" | "hood" | "washer" | "geyser" | "power16" | "db" | "cdb";

export interface Device {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly storey: number;
  readonly aptId: string;
  readonly roomId: string;
  readonly layer: Layer;
  circuit: string;
  readonly m: Mount;
  readonly a: number;
  /** Chase points from the device top up to the void (bottom first), and the void stub point. */
  readonly chase: V3[];
  readonly q: P2;
  /** Leg at q pointing back into the wall. */
  readonly leg: V3;
}

export interface Board extends Device {
  /** Chase tops and void points for the lighting, power and submain conduits. */
  readonly ports: Readonly<Record<Layer | "submain", { chase: V3[]; q: P2 }>>;
}

interface Spec {
  readonly part: FixedPart;
  readonly label: string;
  readonly ctype: string;
  readonly layer: Layer;
}

const SPEC: Readonly<Record<Exclude<DeviceKind, "db" | "cdb">, Spec>> = {
  switch: { part: "switch-plate", label: "modular switch board (6 module)", ctype: "switch_board", layer: "lighting" },
  socket: { part: "socket-plate", label: "6 A socket outlet with switch", ctype: "socket_outlet", layer: "power" },
  ac: { part: "socket-16a", label: "air-conditioner point 16 A", ctype: "ac_point", layer: "power" },
  counter: { part: "socket-16a", label: "kitchen counter socket 16 A", ctype: "power_outlet", layer: "power" },
  fridge: { part: "socket-16a", label: "refrigerator point 16 A", ctype: "power_outlet", layer: "power" },
  hood: { part: "socket-16a", label: "chimney hood point", ctype: "power_outlet", layer: "power" },
  washer: { part: "socket-16a", label: "washing-machine point 16 A", ctype: "power_outlet", layer: "power" },
  geyser: { part: "socket-16a", label: "geyser point 16 A (DP switch)", ctype: "geyser_point", layer: "power" },
  power16: { part: "socket-16a", label: "16 A power socket", ctype: "power_outlet", layer: "power" },
};

const conduitR = (layer: Layer | "submain") => (layer === "lighting" ? C.conduit.lighting.od : layer === "power" ? C.conduit.power.od : C.conduit.submain.od) / 2;
const layerY = (ctx: MepContext, s: number, layer: Layer | "submain") => ctx.d.slabTop(s) + C.layers[layer];

/** Thickness of tile / backsplash on the face at (a, y), if any. */
function finishAt(ctx: MepContext, m: Mount, a: number, y: number): number {
  const p0 = wallPoint(m, a, y, 0.0005);
  const p1 = wallPoint(m, a, y, 0.0095);
  const hits = ctx.space.query({ min: [Math.min(p0[0], p1[0]) - 0.001, y - 0.001, Math.min(p0[2], p1[2]) - 0.001], max: [Math.max(p0[0], p1[0]) + 0.001, y + 0.001, Math.max(p0[2], p1[2]) + 0.001] }, (x) => x.componentType === "wall_tile_panel" || x.componentType === "kitchen_backsplash");
  return hits.length ? ctx.arch.tiling.thickness : 0;
}

export interface PlaceCtx {
  readonly ctx: MepContext;
  readonly s: number;
  readonly ir: InteriorRoom;
  readonly arcs: readonly SwingArc[];
  readonly group: Group;
}

interface Fit {
  readonly depth: number;
  readonly chase: V3[];
  readonly q: P2;
}

/** Device of `part` at (m, a, y): free, out of door swings, with a clear chase to its layer. */
function fits(pc: PlaceCtx, part: FixedPart, m: Mount, a: number, y: number, layer: Layer, chases: readonly { da: number; layer: Layer | "submain" }[] = [{ da: 0, layer }]): Fit | null {
  const { ctx, s } = pc;
  const depth = finishAt(ctx, m, a, y);
  const bx = wallPartBox(part, m, a, y, depth);
  if (ctx.space.query(bx, (x) => !MASONRY.has(x.componentType)).length) return null;
  if (!ctx.mep.free(bx)) return null;
  const S = FIXED_PARTS[part];
  // swing arcs against the device front in plan
  const front = wallPartBox(part, m, a, y, depth, 0);
  const plan: PlanRect = { x0: front.min[0], x1: front.max[0], z0: front.min[2], z1: front.max[2] };
  if (pc.arcs.some((arc) => arcHitsRect(arc, plan))) return null;
  let first: { chase: V3[]; q: P2 } | null = null;
  for (const c of chases) {
    const ly = layerY(ctx, s, c.layer);
    const ch = findChase(ctx, m, a + c.da, y + S.size[1] / 2 - 0.01, ly, conduitR(c.layer), { reach: 0.0001, clear: 0.004 });
    if (!ch) return null;
    const qp = wallPoint(m, ch.a, ly, C.voidStub);
    if (!voidReachable(ctx, ch.points[ch.points.length - 1]!, qp, conduitR(c.layer))) return null;
    if (!first) first = { chase: ch.points, q: [qp[0], qp[2]] };
  }
  return { depth, chase: first?.chase ?? [], q: first?.q ?? [0, 0] };
}

/** The stub out of the wall and the void point around it are clear at the conduit layer (room for the router). */
function voidReachable(ctx: MepContext, top: V3, q: V3, r: number): boolean {
  const h = r + C.clearance + 0.015;
  const solidOk = (x: { componentType: string }) => !MASONRY.has(x.componentType) && !CEILINGS.has(x.componentType) && !FINISHES.has(x.componentType);
  const around = box3(q[0] - h, q[0] + h, q[1] - r - 0.004, q[1] + r + 0.004, q[2] - h, q[2] + h);
  if (ctx.space.query(around, solidOk).length || !ctx.mep.free(around)) return false;
  const stub = box3(Math.min(top[0], q[0]) - r, Math.max(top[0], q[0]) + r, q[1] - r, q[1] + r, Math.min(top[2], q[2]) - r, Math.max(top[2], q[2]) + r);
  return !ctx.space.query(stub, solidOk).length && ctx.mep.free(stub);
}

/** Candidate positions along every wall of a room. */
function spots(ir: InteriorRoom, s: number, margin = 0.12, step = 0.05): { m: Mount; a: number }[] {
  const out: { m: Mount; a: number }[] = [];
  for (const c of ir.clears)
    for (const side of ["S", "N", "W", "E"] as Side[]) {
      const m = mountOn(s, ir.room.id, c, side);
      const [s0, s1] = m.axis === "x" ? [c.x0, c.x1] : [c.z0, c.z1];
      for (let a = s0 + margin; a <= s1 - margin + 1e-9; a += step) out.push({ m, a });
    }
  return out;
}

const facePlan = (m: Mount, a: number): P2 => (m.axis === "x" ? [a, m.face] : [m.face, a]);
const dist2 = (p: P2, q: P2) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);

export interface DeviceRequest {
  readonly kind: Exclude<DeviceKind, "db" | "cdb">;
  readonly y: number; // above FFL
  readonly circuit: string;
  /** Lower is better; null = not allowed. */
  readonly score: (m: Mount, a: number) => number | null;
  readonly name?: string;
}

/** Place one device by scanning candidate positions (best score first). */
export function placeDevice(pc: PlaceCtx, req: DeviceRequest, candidates = spots(pc.ir, pc.s)): Device | null {
  const sp = SPEC[req.kind];
  const ffl = pc.ctx.d.ffl(pc.s);
  const scored = candidates
    .map((c) => ({ ...c, sc: req.score(c.m, c.a) }))
    .filter((c): c is { m: Mount; a: number; sc: number } => c.sc !== null)
    .sort((p, q) => p.sc - q.sc || p.a - q.a);
  for (const c of scored) {
    const y = ffl + req.y;
    const f = fits(pc, sp.part, c.m, c.a, y, sp.layer);
    if (!f) continue;
    const d = wallPart(pc.ctx, pc.group, sp.part, c.m, c.a, y, f.depth, { code: "D", name: `${pc.group.name}: ${req.name ?? sp.label}`, componentType: sp.ctype, materialId: "device_white", networkId: req.circuit, roomId: pc.ir.room.id, category: sp.layer, nominalSize: sp.part === "socket-plate" ? "6 A" : sp.part === "switch-plate" ? "6 A, 6 module" : "16 A" });
    indexDrafts(pc.ctx, pc.ctx.drafts.drafts.length - 1);
    return { id: d.id, kind: req.kind, storey: pc.s, aptId: pc.ir.room.aptId, roomId: pc.ir.room.id, layer: sp.layer, circuit: req.circuit, m: c.m, a: c.a, chase: f.chase, q: f.q, leg: [-c.m.n[0], 0, -c.m.n[2]] as V3 };
  }
  return null;
}

/** Distribution board (flat DB in the foyer, CDB in the services room) with three conduit chases. */
export function placeBoard(pc: PlaceCtx, kind: "db" | "cdb", networkId: string, score: (m: Mount, a: number) => number | null, name: string): Board | null {
  const part: FixedPart = kind === "db" ? "db" : "fdb";
  const y = pc.ctx.d.ffl(pc.s) + (kind === "db" ? C.device.db : C.device.fdb);
  const scored = spots(pc.ir, pc.s, 0.3)
    .map((c) => ({ ...c, sc: score(c.m, c.a) }))
    .filter((c): c is { m: Mount; a: number; sc: number } => c.sc !== null)
    .sort((p, q) => p.sc - q.sc || p.a - q.a);
  const S = FIXED_PARTS[part];
  for (const c of scored) {
    const ports: Partial<Record<Layer | "submain", { chase: V3[]; q: P2 }>> = {};
    const f = fits(pc, part, c.m, c.a, y, "lighting", []);
    if (!f) continue;
    let ok = true;
    for (const [layer, da] of [["lighting", -0.1], ["power", 0.1], ["submain", 0]] as const) {
      const ly = layerY(pc.ctx, pc.s, layer);
      const ch = findChase(pc.ctx, c.m, c.a + da, y + S.size[1] / 2 - 0.01, ly, conduitR(layer), { reach: 0.0001, clear: 0.004 });
      if (!ch) {
        ok = false;
        break;
      }
      const qp = wallPoint(c.m, ch.a, ly, C.voidStub);
      if (!voidReachable(pc.ctx, ch.points[ch.points.length - 1]!, qp, conduitR(layer))) {
        ok = false;
        break;
      }
      ports[layer] = { chase: ch.points, q: [qp[0], qp[2]] };
    }
    if (!ok) continue;
    const d = wallPart(pc.ctx, pc.group, part, c.m, c.a, y, f.depth, { code: kind === "db" ? "DB" : "CDB", fixed: true, name: `${pc.group.name}: ${name}`, componentType: kind === "db" ? "distribution_board" : "common_distribution_board", materialId: "enclosure_steel", networkId, roomId: pc.ir.room.id, category: "distribution", nominalSize: kind === "db" ? "12-way SPN, IP43" : "8-way TPN" });
    indexDrafts(pc.ctx, pc.ctx.drafts.drafts.length - 1);
    return { id: d.id, kind, storey: pc.s, aptId: pc.ir.room.aptId, roomId: pc.ir.room.id, layer: "power", circuit: networkId, m: c.m, a: c.a, chase: f.chase, q: f.q, leg: [-c.m.n[0], 0, -c.m.n[2]] as V3, ports: ports as Board["ports"] };
  }
  return null;
}

// ── scoring helpers used by the rules ──────────────────────────────────────────

export function placeCtx(ctx: MepContext, s: number, ir: InteriorRoom, group: Group): PlaceCtx {
  const ictx = ctx.interiors[s]!;
  const arcs = ictx.plan.doors.filter((d) => d.swingInto === ir.room.id).flatMap((d) => swingArcs(d, ictx.bounds, ctx.cfg, ctx.arch));
  return { ctx, s, ir, arcs, group };
}

/** Plan point just inside the latch side of a door, on the side of room `roomId`. */
export function latchPoint(door: PlanDoor, inward: number): P2 {
  const latch = door.hingeAt < door.centre ? door.centre + door.width / 2 : door.centre - door.width / 2;
  const away = Math.sign(latch - door.centre);
  const along = latch + away * 0.16;
  return door.line.axis === "x" ? [along, door.line.c + inward] : [door.line.c + inward, along];
}

/** Score: distance from a target plan point, preferring the wall the target lies on. */
export const near = (target: P2, sameWallBonus = 0.4) => (m: Mount, a: number) => {
  const p = facePlan(m, a);
  const onWall = (m.axis === "x" ? Math.abs(p[1] - target[1]) : Math.abs(p[0] - target[0])) < 0.35;
  return dist2(p, target) + (onWall ? 0 : sameWallBonus);
};

/** Score: far from already placed points (spread sockets), skipping walls with windows if possible. */
export const spread = (taken: P2[], hasWindow: (m: Mount) => boolean) => (m: Mount, a: number) => {
  const p = facePlan(m, a);
  const dmin = taken.length ? Math.min(...taken.map((t) => dist2(t, p))) : 3;
  if (dmin < 0.8) return null;
  return -Math.min(dmin, 4) + (hasWindow(m) ? 0.6 : 0);
};

export const planOfDevice = (d: Device) => facePlan(d.m, d.a);
export type { ComponentRecord };
