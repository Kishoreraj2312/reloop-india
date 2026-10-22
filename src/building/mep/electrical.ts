/**
 * Electrical distribution and final circuits (A3), conceptual:
 *
 *   utility LT service -> feeder pillar (south of the building) -> underground incoming cable
 *   -> main LT panel (MDB) in the ground-floor meter room, beside the meter bank (one energy
 *   meter per flat + common) -> submain cables laid on a perforated cable tray: meter room,
 *   G corridor, services room, vertical riser in the service shaft, and per floor the
 *   services room branch and the corridor tray -> at each flat entrance the submain leaves
 *   the tray in a conduit to the flat DB in the foyer. Common feeders from the MDB serve a
 *   common DB (CDB) per floor in the services room (corridor, services room, stair, ground
 *   common rooms, entrance) and the pump starter panel (underground).
 *   Flat DB -> MCB per circuit -> conduit trees in the ceiling void (lighting / power layers,
 *   round junction boxes at every branch) -> wall chases down to switch boards, sockets and
 *   appliance points; conduit drops through the ceiling to every A2 light fitting.
 *   Earthing: two earth pits -> main earthing terminal in the meter room -> earth strip along
 *   the tray and the riser -> floor earth bars in the shaft (DBs via the submain PE conductor).
 *
 * No load calculation, discrimination, voltage drop or code compliance is implied.
 */

import type { ComponentRecord } from "../structure";
import type { InteriorRoom } from "../architecture/interior";
import type { PlanDoor } from "../architecture/plan";
import type { PlanRect } from "../architecture/rect";
import type { RoomType } from "../architecture/layout";
import { MEP_CONFIG } from "./config";
import { declareNetwork, endpoint, indexDrafts, MASONRY, planObstacles, unresolved, type MepContext } from "./context";
import { FIXED_PARTS, PART_FILL, TRAY } from "./parts";
import { Net, type RunSpec } from "./net";
import { buildTree, legsOk, legTo, routeOrtho } from "./router";
import { add, placeLocal, scale, sub, type P2, type V3 } from "./geom";
import { mountOn, segBox, wallPart, wallPoint, type Mount } from "./walls";
import { box3 } from "./space";
import { envelopeRegion } from "./water";
import { reservedIds, ftag, latchPoint, near, placeBoard, placeCtx, placeDevice, planOfDevice, spread, type Board, type Device, type DeviceRequest, type Layer } from "./devices";
import type { Group } from "./record";

const C = MEP_CONFIG;

interface Circuit {
  readonly id: string;
  readonly code: string;
  readonly layer: Layer;
  readonly label: string;
  readonly rating: string;
  readonly cable: { readonly od: number; readonly nominal: string };
}

interface Unit {
  readonly s: number;
  readonly aptId: string; // flat id, or "CM" for the floor's common services
  readonly board: Board;
  readonly devices: Device[];
  readonly lights: ComponentRecord[];
  readonly region: PlanRect[];
  readonly circuits: Map<string, Circuit>;
  /** circuit code -> circuit id, per light / device */
  readonly lightCircuit: Map<string, string>;
  readonly subNet: string;
  readonly groups: { dev: Group; db: Group; cnd: Group; cbl: Group };
  mcb: Map<string, string>;
  entrance?: ComponentRecord[]; // ground floor: facade / canopy lights fed from the lobby
}

const LIGHT_L1: ReadonlySet<RoomType> = new Set(["living", "dining", "foyer", "passage", "study", "store", "lobby", "office", "security"]);

export function generateElectrical(ctx: MepContext): void {
  const units: Unit[] = [];
  for (let s = 0; s < ctx.cfg.storeyCount; s++) {
    const plan = ctx.interiors[s]!.plan;
    for (const apt of plan.apartments) {
      const u = apt.id === "CM" ? commonUnit(ctx, s) : flatUnit(ctx, s, apt.id);
      if (u) units.push(u);
    }
  }
  distribution(ctx, units);
  for (const u of units) finalCircuits(ctx, u);
}

// ── units: boards, devices, circuits ───────────────────────────────────────────

function groupsFor(ctx: MepContext, s: number, aptId: string, label: string) {
  const g = (type: "DEV" | "PNL" | "CND" | "CBL", name: string, category: "lighting" | "power" | "distribution", mat: string) =>
    ctx.drafts.group({ system: "electrical", type, floor: s, loc: aptId, name: `${name} ${label} ${ftag(s)}`, assemblyType: type === "DEV" ? "wiring_devices" : type === "PNL" ? "distribution_board" : type === "CND" ? "conduits" : "cables", category, materialId: mat, apartmentId: aptId });
  return { dev: g("DEV", "Wiring devices", "power", "device_white"), db: g("PNL", "Distribution board", "distribution", "enclosure_steel"), cnd: g("CND", "Conduits", "lighting", "conduit_lighting"), cbl: g("CBL", "Circuit cables", "lighting", "cable_lighting") };
}

const circuitOf = (ctx: MepContext, s: number, aptId: string, code: string, layer: Layer, label: string, rating: string, cable: { od: number; nominal: string }): Circuit => {
  const id = declareNetwork(ctx, { id: `ELC-NET-CIR-${ftag(s)}-${aptId}-${code}`, system: "electrical", kind: "circuit", name: `${aptId} ${ftag(s)} circuit ${code}: ${label}`, floor: s, apartmentId: aptId, parent: `ELC-NET-SUB-${ftag(s)}-${aptId}` });
  return { id, code, layer, label, rating, cable };
};

const entryDoors = (plan: { doors: readonly PlanDoor[] }, roomId: string) => [...plan.doors.filter((d) => d.swingInto === roomId), ...plan.doors.filter((d) => d.swingInto !== roomId && d.rooms.includes(roomId))];

/** Which side of a door line (signed offset) the room lies on. */
function inwardOf(ir: InteriorRoom, d: PlanDoor, k = 0.2): number {
  const c = ir.clears[0]!;
  const mid = d.line.axis === "x" ? (c.z0 + c.z1) / 2 : (c.x0 + c.x1) / 2;
  return Math.sign(mid - d.line.c) * k;
}

const hasWindowOn = (ctx: MepContext, s: number, ir: InteriorRoom) => (m: Mount) => ctx.interiors[s]!.sideOpenings(ir.room.id, m.clear, m.side).some((o) => o.kind === "window");
const onOutline = (ctx: MepContext, s: number, m: Mount) => {
  const o = ctx.interiors[s]!.plan.outline;
  return m.side === "S" ? Math.abs(m.clear.z0 - (o.z0 + 0.005)) < 0.05 : m.side === "N" ? Math.abs(m.clear.z1 - (o.z1 - 0.005)) < 0.05 : m.side === "W" ? Math.abs(m.clear.x0 - (o.x0 + 0.005)) < 0.05 : Math.abs(m.clear.x1 - (o.x1 - 0.005)) < 0.05;
};

function switchFor(ctx: MepContext, s: number, ir: InteriorRoom, unitRooms: Map<string, InteriorRoom>, g: Group, circuit: string): Device | null {
  const ictx = ctx.interiors[s]!;
  const wet = ir.room.type === "bathroom" || ir.room.type === "toilet";
  const doors = entryDoors(ictx.plan, ir.room.id);
  if (wet && doors[0]) {
    const d = doors[0];
    const otherId = d.rooms.find((r) => r !== ir.room.id)!;
    const other = unitRooms.get(otherId) ?? ictx.rooms.get(otherId);
    if (other) {
      const pc = placeCtx(ctx, s, other, g);
      const dev = placeDevice(pc, { kind: "switch", y: C.device.switch, circuit, score: near(latchPoint(d, inwardOf(other, d))), name: `switch board for ${ir.room.name} (outside the door)` });
      if (dev) return dev;
    }
  }
  const pc = placeCtx(ctx, s, ir, g);
  if (doors[0]) {
    const d = doors[0];
    const dev = placeDevice(pc, { kind: "switch", y: C.device.switch, circuit, score: near(latchPoint(d, inwardOf(ir, d))) });
    if (dev) return dev;
  }
  // open-plan rooms: beside the opening to the foyer / first open boundary
  const open = ictx.bounds.filter((b) => b.kind === "open" && (b.low === ir.room.id || b.high === ir.room.id));
  const pref = open.find((b) => (b.low === ir.room.id ? b.high : b.low)?.endsWith("FOY")) ?? open[0];
  if (pref) {
    const c = ir.clears[0]!;
    const mid = pref.line.axis === "x" ? (c.z0 + c.z1) / 2 : (c.x0 + c.x1) / 2;
    const inward = Math.sign(mid - pref.line.c) * 0.2;
    const t: P2 = pref.line.axis === "x" ? [pref.s0 + 0.2, pref.line.c + inward] : [pref.line.c + inward, pref.s0 + 0.2];
    const dev = placeDevice(pc, { kind: "switch", y: C.device.switch, circuit, score: near(t, 0.2) });
    if (dev) return dev;
  }
  const centre: P2 = [(ir.clears[0]!.x0 + ir.clears[0]!.x1) / 2, (ir.clears[0]!.z0 + ir.clears[0]!.z1) / 2];
  return placeDevice(pc, { kind: "switch", y: C.device.switch, circuit, score: near(centre, 0) });
}

function flatUnit(ctx: MepContext, s: number, aptId: string): Unit | null {
  const ictx = ctx.interiors[s]!;
  const plan = ictx.plan;
  const apt = plan.apartments.find((a) => a.id === aptId)!;
  const rooms = new Map([...ictx.rooms.values()].filter((ir) => ir.room.aptId === aptId).map((ir) => [ir.room.id, ir]));
  const foyer = rooms.get(apt.entranceRoom);
  const door = plan.doors.find((d) => d.typeKey === "MD" && d.rooms.includes("CM-COR") && d.rooms.includes(apt.entranceRoom));
  if (!foyer || !door) return null;
  const groups = groupsFor(ctx, s, aptId, aptId);
  const subNet = declareNetwork(ctx, { id: `ELC-NET-SUB-${ftag(s)}-${aptId}`, system: "electrical", kind: "submain", name: `Submain ${aptId} ${ftag(s)} (meter -> flat DB)`, floor: s, apartmentId: aptId, parent: "ELC-NET-INC" });
  const board = placeBoard(placeCtx(ctx, s, foyer, groups.db), "db", subNet, near(latchPoint(door, inwardOf(foyer, door, 0.25)), 0.3), `flat distribution board (${C.cable.submain.nominal} incomer)`);
  if (!board) {
    unresolved(ctx, `${aptId} ${ftag(s)}`, "no wall position in the foyer for the flat distribution board");
    return null;
  }
  const L = C.cable.lighting;
  const Pw = C.cable.power;
  const H = C.cable.heavy;
  const circuits = new Map<string, Circuit>();
  const cir = (code: string, layer: Layer, label: string, rating: string, cable: { od: number; nominal: string }) => {
    let c = circuits.get(code);
    if (!c) circuits.set(code, (c = circuitOf(ctx, s, aptId, code, layer, label, rating, cable)));
    return c.id;
  };
  const devices: Device[] = [];
  const lightCircuit = new Map<string, string>();
  const lights = ctx.archRecords.filter((r) => r.floor === s && r.apartmentId === aptId && (r.componentType === "light_downlight" || r.componentType === "light_surface"));
  const lc = (ir: InteriorRoom) => (LIGHT_L1.has(ir.room.type) ? cir("L1", "lighting", "lighting: living, dining, foyer, passage, study", "6 A", L) : cir("L2", "lighting", "lighting: bedrooms, baths, kitchen, utility", "6 A", L));
  for (const l of lights) lightCircuit.set(l.id, lc(rooms.get(l.roomId!)!));
  const geysers = ctx.appliances.filter((a) => a.kind === "geyser" && a.storey === s && a.aptId === aptId);
  let ac = 0;
  let wh = 0;
  const add = (d: Device | null, what: string, ir: InteriorRoom) => {
    if (d) devices.push(d);
    else unresolved(ctx, `${ir.room.id} ${ftag(s)}`, `no valid wall position for the ${what}`);
  };
  for (const ir of [...rooms.values()].sort((a, b) => (a.room.id < b.room.id ? -1 : 1))) {
    const t = ir.room.type;
    const pc = placeCtx(ctx, s, ir, groups.dev);
    add(switchFor(ctx, s, ir, rooms, groups.dev, lc(ir)), "switch board", ir);
    const taken: P2[] = devices.filter((d) => d.roomId === ir.room.id).map(planOfDevice);
    const sock = (n: number, label = "6 A socket outlet with switch") => {
      for (let i = 0; i < n; i++) {
        const d = placeDevice(pc, { kind: "socket", y: C.device.socketLow, circuit: cir("P1", "power", "6 A sockets", "16 A", Pw), score: spread(taken, hasWindowOn(ctx, s, ir)), name: label });
        if (d) taken.push(planOfDevice(d));
        add(d, "6 A socket", ir);
      }
    };
    const acPoint = () => {
      const code = `AC${++ac}`;
      const req: DeviceRequest = {
        kind: "ac",
        y: C.device.ac,
        circuit: cir(code, "power", `air conditioner ${ir.room.name}`, "20 A", H),
        score: (m, a) => {
          const [s0, s1] = m.axis === "x" ? [m.clear.x0, m.clear.x1] : [m.clear.z0, m.clear.z1];
          return Math.min(Math.abs(a - s0), Math.abs(s1 - a)) * 0.5 + (onOutline(ctx, s, m) ? 0 : 1.5);
        },
      };
      add(placeDevice(pc, req), "AC point", ir);
    };
    if (t === "living") {
      sock(3);
      acPoint();
    } else if (t === "bedroom") {
      // bedside pair on the longest wall without a door, then one more socket
      const c = ir.clears.reduce((a, b) => ((b.x1 - b.x0) * (b.z1 - b.z0) > (a.x1 - a.x0) * (a.z1 - a.z0) ? b : a));
      const walls = (["S", "N", "W", "E"] as const).map((sd) => mountOn(s, ir.room.id, c, sd)).filter((m) => !ctx.interiors[s]!.sideOpenings(ir.room.id, c, m.side).some((o) => o.kind === "door"));
      const head = walls.sort((p, q) => (q.axis === "x" ? c.x1 - c.x0 : c.z1 - c.z0) - (p.axis === "x" ? c.x1 - c.x0 : c.z1 - c.z0))[0];
      if (head) {
        const [s0, s1] = head.axis === "x" ? [c.x0, c.x1] : [c.z0, c.z1];
        const mid = (s0 + s1) / 2;
        for (const off of [-0.95, 0.95]) {
          const d = placeDevice(pc, { kind: "socket", y: C.device.socketLow, circuit: cir("P1", "power", "6 A sockets", "16 A", Pw), score: (m, a) => (m.side === head.side && Math.abs(m.face - head.face) < 1e-6 ? Math.abs(a - (mid + off)) : null), name: "bedside socket" });
          if (d) taken.push(planOfDevice(d));
          add(d, "bedside socket", ir);
        }
      }
      sock(1);
      acPoint();
    } else if (t === "study") {
      sock(2);
      acPoint();
    } else if (t === "dining" || t === "foyer") {
      sock(1);
    } else if (t === "kitchen") {
      const kitchenPower = cir("P2", "power", "kitchen & utility 16 A", "20 A", H);
      const bsp = ctx.archRecords.filter((r) => r.floor === s && r.roomId === ir.room.id && r.componentType === "kitchen_backsplash").sort((a, b) => longest(b) - longest(a))[0];
      if (bsp) {
        const ax = bsp.geometry.kind === "box" && bsp.geometry.size[0] > bsp.geometry.size[2] ? 0 : 2;
        const lo = bsp.originalPosition[ax]! - (bsp.geometry.kind === "box" ? bsp.geometry.size[ax]! : 0) / 2;
        const len = longest(bsp);
        for (const f of [0.3, 0.72]) {
          const target = lo + f * len;
          add(placeDevice(pc, { kind: "counter", y: C.device.counter, circuit: kitchenPower, score: (m, a) => (m.axis === (ax === 0 ? "x" : "z") && Math.abs(m.face - bsp.originalPosition[ax === 0 ? 2 : 0]!) < 0.05 ? Math.abs(a - target) : null) }), "counter socket", ir);
        }
      }
      const frg = ctx.archRecords.find((r) => r.floor === s && r.roomId === ir.room.id && r.componentType === "kitchen_fridge");
      if (frg) add(placeDevice(pc, { kind: "fridge", y: C.device.fridge, circuit: kitchenPower, score: near([frg.originalPosition[0], frg.originalPosition[2]], 0.3) }), "fridge point", ir);
      const flue = ctx.archRecords.find((r) => r.floor === s && r.roomId === ir.room.id && r.id.endsWith("-HOD-F"));
      if (flue) add(placeDevice(pc, { kind: "hood", y: C.device.hood, circuit: kitchenPower, score: (m, a) => { const p: P2 = m.axis === "x" ? [a, m.face] : [m.face, a]; const d = Math.abs(p[0] - flue.originalPosition[0]) + Math.abs(p[1] - flue.originalPosition[2]); return d < 0.25 ? null : d; } }), "hood point", ir);
    } else if (t === "utility") {
      const w = ctx.archRecords.find((r) => r.floor === s && r.roomId === ir.room.id && r.componentType === "appliance_washer");
      if (w) add(placeDevice(pc, { kind: "washer", y: C.device.washer, circuit: cir("P2", "power", "kitchen & utility 16 A", "20 A", H), score: near([w.originalPosition[0], w.originalPosition[2]], 0.2) }), "washer point", ir);
    } else if (t === "bathroom") {
      const gy = geysers.find((g) => g.roomId === ir.room.id);
      if (gy && gy.along && gy.normal) {
        const code = `WH${++wh}`;
        add(placeDevice(pc, { kind: "geyser", y: gy.anchor[1] - ctx.d.ffl(s), circuit: cir(code, "power", `geyser ${ir.room.name}`, "20 A", H), score: near([gy.anchor[0] + gy.along[0] * 0.33, gy.anchor[2] + gy.along[2] * 0.33], 0.2) }), "geyser point", ir);
      }
    }
  }
  const region = envelopeRegion(apt.envelope, plan.outline);
  return { s, aptId, board, devices, lights, region, circuits, lightCircuit, subNet, groups, mcb: new Map() };
}

const longest = (r: ComponentRecord) => (r.geometry.kind === "box" ? Math.max(r.geometry.size[0], r.geometry.size[2]) : 0);

const COMMON_ROOMS = ["CM-SOC", "CM-SEC", "CM-TLT", "CM-MTR", "CM-LOB"];

function commonUnit(ctx: MepContext, s: number): Unit | null {
  const ictx = ctx.interiors[s]!;
  const plan = ictx.plan;
  const svc = ictx.rooms.get("CM-SVC");
  if (!svc) return null;
  const groups = groupsFor(ctx, s, "CM", "common");
  const subNet = declareNetwork(ctx, { id: `ELC-NET-FDR-${ftag(s)}`, system: "electrical", kind: "feeder", name: `Common feeder ${ftag(s)} (MDB -> CDB)`, floor: s, apartmentId: "CM", parent: "ELC-NET-INC" });
  const sh = ctx.grid.xs[ctx.cfg.shaftBay.xStart]! + (ctx.cfg.gridSpacingX - ctx.cfg.shaftOpening.width) / 2 - ctx.arch.walls.core; // shaft enclosure west face
  const board = placeBoard(placeCtx(ctx, s, svc, groups.db), "cdb", subNet, (m, a) => (m.axis === "z" && Math.abs(m.face - sh) < 0.01 ? Math.abs(a + 0.5) : m.axis === "z" ? 3 + Math.abs(a) : null), "common services DB (corridor, stair, services, common rooms)");
  if (!board) {
    unresolved(ctx, `CM ${ftag(s)}`, "no wall position for the common DB in the services room");
    return null;
  }
  const L = C.cable.lighting;
  const circuits = new Map<string, Circuit>();
  const cir = (code: string, layer: Layer, label: string, rating: string, cable: { od: number; nominal: string }) => {
    let c = circuits.get(code);
    if (!c) circuits.set(code, (c = circuitOf(ctx, s, "CM", code, layer, label, rating, cable)));
    return c.id;
  };
  const devices: Device[] = [];
  const lightCircuit = new Map<string, string>();
  const roomIds = new Set(["CM-COR", "CM-SVC", ...(s === 0 ? COMMON_ROOMS : [])]);
  const lights = ctx.archRecords.filter((r) => r.floor === s && r.roomId && roomIds.has(r.roomId) && (r.componentType === "light_downlight" || r.componentType === "light_surface"));
  for (const l of lights) lightCircuit.set(l.id, l.roomId === "CM-COR" ? cir("CL1", "lighting", "corridor lighting (time switch)", "6 A", L) : cir("CL2", "lighting", "services room, stair and common rooms", "6 A", L));
  const svcPc = placeCtx(ctx, s, svc, groups.dev);
  const svcDoor = plan.doors.find((d) => d.swingInto === "CM-SVC" && d.rooms.includes("CM-COR"));
  const add = (d: Device | null, what: string, roomId: string) => {
    if (d) devices.push(d);
    else unresolved(ctx, `${roomId} ${ftag(s)}`, `no valid wall position for the ${what}`);
  };
  if (svcDoor) add(placeDevice(svcPc, { kind: "switch", y: C.device.switch, circuit: cir("CL2", "lighting", "services room, stair and common rooms", "6 A", L), score: near(latchPoint(svcDoor, inwardOf(svc, svcDoor))) }), "switch board", svc.room.id);
  const bp = planOfDevice(board);
  add(placeDevice(svcPc, { kind: "power16", y: C.device.washer, circuit: cir("CP1", "power", "common 16 A sockets", "20 A", C.cable.heavy), score: (m, a) => { const d = near(bp, 0.2)(m, a); return d < 0.45 ? null : d; }, name: "16 A maintenance socket" }), "maintenance socket", svc.room.id);
  // Stair lighting: a bulkhead on the stair side of the core wall shared with the services room.
  const stair = stairLight(ctx, s, groups.dev, cir("CL2", "lighting", "services room, stair and common rooms", "6 A", L));
  if (stair) devices.push(stair);
  else unresolved(ctx, `CM-STC ${ftag(s)}`, "no position for the staircase light");
  let entrance: ComponentRecord[] | undefined;
  if (s === 0) {
    for (const id of COMMON_ROOMS) {
      const ir = ictx.rooms.get(id);
      if (!ir) continue;
      add(switchFor(ctx, s, ir, new Map(), groups.dev, cir("CL2", "lighting", "services room, stair and common rooms", "6 A", L)), "switch board", id);
      const n = ir.room.type === "office" ? 2 : ir.room.type === "security" || ir.room.type === "meter" ? 1 : 0;
      const taken: P2[] = [];
      const pc = placeCtx(ctx, s, ir, groups.dev);
      for (let i = 0; i < n; i++) {
        const d = placeDevice(pc, { kind: "socket", y: C.device.socketLow, circuit: cir("CP1", "power", "common 16 A sockets", "20 A", C.cable.heavy), score: spread(taken, hasWindowOn(ctx, s, ir)) });
        if (d) taken.push(planOfDevice(d));
        add(d, "socket", id);
      }
    }
    entrance = ctx.archRecords.filter((r) => r.floor === 0 && (r.id.startsWith("ARC-FAC-G-S-LGT") || r.id.startsWith("ARC-ENT-G-MAIN-CLT")));
    for (const l of entrance) lightCircuit.set(l.id, cir("CL3", "lighting", "entrance canopy and facade lights", "6 A", L));
  }
  const regionRooms = plan.rooms.filter((r) => roomIds.has(r.id)).flatMap((r) => r.rects);
  return { s, aptId: "CM", board, devices, lights, region: envelopeRegion(regionRooms, plan.outline), circuits, lightCircuit, subNet, groups, mcb: new Map(), ...(entrance ? { entrance } : {}) };
}

/** Wall bulkhead on the stair-core face of the services-room wall; its chase opens into the services void. */
function stairLight(ctx: MepContext, s: number, g: Group, circuit: string): Device | null {
  const ictx = ctx.interiors[s]!;
  const stc = ictx.rooms.get("CM-STC");
  const svc = ictx.rooms.get("CM-SVC");
  if (!stc || !svc) return null;
  const clear = stc.clears[0]!;
  const m = mountOn(s, stc.room.id, clear, "E");
  const svcClear = svc.clears.find((c) => Math.abs(c.x0 - (clear.x1 + ctx.arch.walls.core)) < 0.02) ?? svc.clears[0]!;
  const ms = mountOn(s, svc.room.id, svcClear, "W");
  const y = ctx.d.ffl(s) + 2.4;
  const ly = ctx.d.slabTop(s) + C.layers.lighting;
  const r = C.conduit.lighting.od / 2;
  for (const a of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9]) {
    const bx = box3(m.face - 0.1, m.face, y - 0.1, y + 0.1, a - 0.15, a + 0.15);
    if (!ctx.space.free(bx) || !ctx.mep.free(bx)) continue;
    const top = y + FIXED_PARTS.bulkhead.size[1] / 2;
    const c0 = wallPoint(m, a, top - 0.01, -C.chase);
    const c1 = wallPoint(m, a, ly, -C.chase);
    if (!ctx.space.free(segBox(c0, c1, r + 0.004), (x) => !MASONRY.has(x.componentType)) || !ctx.mep.free(segBox(c0, c1, r + 0.004))) continue;
    const q = wallPoint(ms, a, ly, C.voidStub);
    const d = wallPart(ctx, g, "bulkhead", m, a, y, 0, { code: "LGT", name: `${g.name}: staircase bulkhead light (LED 12 W)`, componentType: "light_bulkhead", materialId: "fixture_light", networkId: circuit, roomId: stc.room.id, category: "lighting", nominalSize: "LED 12 W, IP65" });
    indexDrafts(ctx, ctx.drafts.drafts.length - 1);
    return { id: d.id, kind: "switch", storey: s, aptId: "CM", roomId: stc.room.id, layer: "lighting", circuit, m, a, chase: [c0, c1], q: [q[0], q[2]], leg: [-1, 0, 0] };
  }
  return null;
}

// ── final circuits: conduit trees + cables ─────────────────────────────────────

interface Term {
  readonly key: string;
  readonly q: P2;
  readonly leg: V3;
  /** Q -> ... -> endpoint (Q first); the endpoint node carries `record`. */
  readonly path: V3[];
  readonly record: string;
  readonly circuit: string;
  readonly keep?: PlanRect;
}

function finalCircuits(ctx: MepContext, u: Unit): void {
  const from = ctx.drafts.drafts.length;
  boardModules(ctx, u);
  const net = new Net();
  const cnet = new Net();
  const joints: Map<number, number>[] = [];
  for (const layer of ["lighting", "power"] as const) {
    const ly = ctx.d.slabTop(u.s) + C.layers[layer];
    const cond = layer === "lighting" ? C.conduit.lighting : C.conduit.power;
    const r = cond.od / 2;
    const terms: Term[] = [];
    if (layer === "lighting") {
      for (const l of u.lights) {
        const top = l.originalPosition[1] + (l.geometry.kind === "cylinder" ? l.geometry.height / 2 : 0);
        terms.push({ key: l.id, q: [l.originalPosition[0], l.originalPosition[2]], leg: [0, -1, 0], path: [[l.originalPosition[0], ly, l.originalPosition[2]], [l.originalPosition[0], top, l.originalPosition[2]]], record: l.id, circuit: u.lightCircuit.get(l.id)! });
        endpoint(ctx, l.id, "light fitting").connectedBy.push(u.lightCircuit.get(l.id)!);
      }
    }
    for (const d of u.devices.filter((x) => x.layer === layer)) {
      const top = d.chase[d.chase.length - 1]!;
      const qv: V3 = [d.q[0], ly, d.q[1]];
      const k = r + C.clearance / 2;
      terms.push({ key: d.id, q: d.q, leg: d.leg, path: [qv, top, ...d.chase.slice(0, -1).reverse()], record: d.id, circuit: d.circuit, keep: { x0: Math.min(qv[0], top[0]) - k, x1: Math.max(qv[0], top[0]) + k, z0: Math.min(qv[2], top[2]) - k, z1: Math.max(qv[2], top[2]) + k } });
    }
    if (layer === "lighting" && u.entrance?.length) terms.push(entranceTerm(ctx, u, ly));
    if (!terms.length) continue;
    const port = u.board.ports[layer];
    const root: V3 = [port.q[0], ly, port.q[1]];
    const area = bboxOf([...u.region, ...terms.map((t) => ({ x0: t.q[0], x1: t.q[0], z0: t.q[1], z1: t.q[1] }))]);
    // chases of the other layer's devices pass up through this layer inside the walls
    const pins = u.devices.filter((d) => d.layer !== layer && ctx.d.slabTop(u.s) + C.layers[d.layer] > ly).flatMap((d) => d.chase.map((p) => ({ x0: p[0] - 0.03, x1: p[0] + 0.03, z0: p[2] - 0.03, z1: p[2] + 0.03 })));
    const obstacles = [...planObstacles(ctx, area, ly, r, { ignore: reservedIds(ctx) }), ...pins];
    const tree = buildTree({ p: [root[0], root[2]], legs: [[-u.board.m.n[0], 0, -u.board.m.n[2]]] }, terms.map((t) => ({ key: t.key, p: t.q, legs: [t.leg], ...(t.keep ? { keep: t.keep } : {}) })), obstacles, { half: r + C.clearance / 2, jointGap: 2 * 3.3 * r + 0.012, region: u.region, bendCost: 0.12 });
    for (const k of tree.unresolved) {
      unresolved(ctx, k, `${layer} conduit to ${k} could not be routed in the ceiling void (device not placed)`);
      if (ctx.drafts.byId.has(k)) ctx.drafts.remove(k);
    }
    // circuits per tree edge (by child node)
    const termOf = new Map(terms.map((t) => [t.key, t]));
    const kids: number[][] = tree.pts.map(() => []);
    for (const [a, b] of tree.segs) kids[a]!.push(b);
    const carried: Set<string>[] = tree.pts.map(() => new Set());
    const visit = (v: number): Set<string> => {
      const s = new Set<string>();
      const t = tree.pts[v]!.term ? termOf.get(tree.pts[v]!.term!) : undefined;
      if (t) s.add(t.circuit);
      for (const k of kids[v]!) for (const c of visit(k)) s.add(c);
      carried[v] = s;
      return s;
    };
    visit(0);
    const cndNet = declareNetwork(ctx, { id: `ELC-NET-CND-${ftag(u.s)}-${u.aptId}-${layer === "lighting" ? "L" : "P"}`, system: "electrical", kind: "containment", name: `${layer} conduits ${u.aptId} ${ftag(u.s)}`, floor: u.s, apartmentId: u.aptId });
    const cspec = (carries: readonly string[], extra: Partial<RunSpec> = {}): RunSpec => ({ kind: "conduit", group: u.groups.cnd, networkId: cndNet, od: cond.od, materialId: layer === "lighting" ? "conduit_lighting" : "conduit_power", componentType: "conduit", label: cond.nominal, nominal: cond.nominal, category: layer, carries: [...carries].sort(), flow: "upstream", ...extra });
    // conduit: board chase -> root -> tree -> terminal paths
    const all = new Set(terms.filter((t) => !tree.unresolved.includes(t.key)).map((t) => t.circuit));
    if (!all.size) continue;
    const rb = net.node(port.chase[0]!, { record: u.board.id });
    const rootIds = [rb, ...port.chase.slice(1).map((p) => net.node(p)), net.node(root)];
    for (let i = 0; i + 1 < rootIds.length; i++) net.edge(rootIds[i]!, rootIds[i + 1]!, cspec([...all], { label: `${cond.nominal} (DB riser chase)` }));
    const ids = tree.pts.map((p, i) => (i === 0 ? rootIds[rootIds.length - 1]! : net.node([p.p[0], ly, p.p[1]])));
    for (const [a, b] of tree.segs) net.edge(ids[a]!, ids[b]!, cspec([...carried[b]!]));
    const termPaths = new Map<string, number[]>();
    tree.pts.forEach((p, i) => {
      if (!p.term) return;
      const t = termOf.get(p.term)!;
      if (t.key === "ENTRANCE") {
        termPaths.set(t.key, [ids[i]!]);
        return;
      }
      const pathIds = [ids[i]!, ...t.path.slice(1).map((pt, k) => net.node(pt, k === t.path.length - 2 ? { record: t.record } : {}))];
      for (let k = 0; k + 1 < pathIds.length; k++) net.edge(pathIds[k]!, pathIds[k + 1]!, cspec([t.circuit], { label: `${cond.nominal} drop` }));
      termPaths.set(t.key, pathIds);
    });
    // Cables per circuit along the same nodes (records at junction boxes are linked after emission)
    const cableNodes = new Map<string, Map<number, number>>(); // circuit -> conduit node -> cable node
    const cnode = (circuit: string, n: number) => {
      let m = cableNodes.get(circuit);
      if (!m) cableNodes.set(circuit, (m = new Map()));
      let c = m.get(n);
      if (c === undefined) m.set(n, (c = cnet.node(net.point(n))));
      return c;
    };
    const cab = (circuit: string, extra: Partial<RunSpec> = {}): RunSpec => {
      const c = [...u.circuits.values()].find((x) => x.id === circuit)!;
      return { kind: "cable", group: u.groups.cbl, networkId: circuit, od: c.cable.od, materialId: c.layer === "lighting" ? "cable_lighting" : "cable_power", componentType: "cable", label: `${c.cable.nominal} (${c.code})`, nominal: c.cable.nominal, category: c.layer, flow: "upstream", ...extra };
    };
    for (const circuit of all) {
      // board chase
      for (let i = 0; i + 1 < rootIds.length; i++) cnet.edge(cnode(circuit, rootIds[i]!), cnode(circuit, rootIds[i + 1]!), cab(circuit));
      for (const [a, b] of tree.segs) if (carried[b]!.has(circuit)) cnet.edge(cnode(circuit, ids[a]!), cnode(circuit, ids[b]!), cab(circuit));
      for (const t of terms) {
        if (t.circuit !== circuit || tree.unresolved.includes(t.key)) continue;
        const pids = termPaths.get(t.key);
        if (!pids) continue;
        for (let k = 0; k + 1 < pids.length; k++) cnet.edge(cnode(circuit, pids[k]!), cnode(circuit, pids[k + 1]!), cab(circuit));
        if (pids.length > 1) cnet.setRecord(cnode(circuit, pids[pids.length - 1]!), t.record);
      }
      cnet.setRecord(cnode(circuit, rb), u.mcb.get(circuit) ?? u.board.id);
    }
    // entrance sub-tree (ground floor common unit)
    const ent = termPaths.get("ENTRANCE");
    if (ent) entranceNet(ctx, u, net, cnet, ent[0]!, ly, cspec, (c) => cab(c), cnode);
    joints.push(...cableNodes.values());
  }
  net.emit(ctx.drafts);
  cnet.emit(ctx.drafts);
  // Cables passing a conduit junction box or bend are joined to it (they are spliced / pulled there).
  for (const m of joints)
    for (const [n, cn] of m) {
      const box = net.emittedAt(n);
      if (box) for (const run of cnet.runsAt(cn)) ctx.drafts.link(run, box);
    }
  indexDrafts(ctx, from);
}

const bboxOf = (rs: readonly PlanRect[]): PlanRect => ({ x0: Math.min(...rs.map((r) => r.x0)) - 1, x1: Math.max(...rs.map((r) => r.x1)) + 1, z0: Math.min(...rs.map((r) => r.z0)) - 1, z1: Math.max(...rs.map((r) => r.z1)) + 1 });

/** DB internals: incomer (DP isolator / MCCB), RCCB, one MCB per circuit; rows inside the enclosure. */
function boardModules(ctx: MepContext, u: Unit): void {
  const b = ctx.drafts.get(u.board.id);
  const m = u.board.m;
  const along: V3 = m.axis === "x" ? [1, 0, 0] : [0, 0, 1];
  const depth = u.board.kind === "db" ? -0.035 : 0.06; // module centre in front of (CDB) / behind (flush DB) the face
  const centre = b.position;
  const S = FIXED_PARTS.mcb;
  const mods: { code: string; label: string; ctype: string; w: number; network: string; nominal: string }[] = [
    { code: "ISO", label: u.board.kind === "db" ? "incomer DP isolator 63 A" : "incomer TPN MCCB 63 A", ctype: "isolator", w: 2, network: u.subNet, nominal: "63 A" },
    { code: "RCCB", label: "RCCB 63 A 30 mA", ctype: "rccb", w: 4, network: u.subNet, nominal: "63 A, 30 mA" },
    ...[...u.circuits.values()].map((c) => ({ code: `MCB-${c.code}`, label: `MCB ${c.rating} circuit ${c.code}`, ctype: "mcb", w: 1, network: c.id, nominal: c.rating })),
  ];
  const perRow = 14;
  let col = 0;
  let row = 0;
  const pitch = S.size[0];
  const prev: string[] = [];
  for (const md of mods) {
    if (col + md.w > perRow) {
      col = 0;
      row++;
    }
    const w = md.w * pitch;
    const off = -perRow * pitch / 2 + col * pitch + w / 2;
    const anchor = add(add([centre[0], centre[1] + 0.06 - row * 0.12, centre[2]], scale(along, off)), scale(m.n, depth - (u.board.kind === "db" ? (FIXED_PARTS.db.centre[2]) : FIXED_PARTS.fdb.centre[2])));
    const pl = placeLocal(anchor, along, [0, 1, 0], [-w / 2, -S.size[1] / 2, -S.size[2] / 2], [w / 2, S.size[1] / 2, S.size[2] / 2]);
    const d = ctx.drafts.add(u.groups.db, { code: md.code, fixed: true, name: `${u.groups.db.name}: ${md.label}`, componentType: md.ctype, materialId: "device_white", geometry: { kind: "part", part: "mcb", size: pl.size, fill: PART_FILL.mcb! }, position: pl.position, rotation: pl.rotation, dimensions: { length: pl.size[0], width: pl.size[2], height: pl.size[1] }, unit: "nr", networkId: md.network, nominalSize: md.nominal, category: "distribution" });
    ctx.drafts.link(d.id, u.board.id);
    // submain cables laid earlier point at the incomer: make those joints two-way
    if (md.code === "ISO") for (const x of ctx.drafts.drafts) if (x.connections.has(d.id)) ctx.drafts.link(x.id, d.id);
    if (md.ctype === "mcb") {
      u.mcb.set(md.network, d.id);
      ctx.drafts.link(d.id, `${u.groups.db.id}-RCCB`);
    } else if (prev.length) ctx.drafts.link(d.id, prev[prev.length - 1]!);
    prev.push(d.id);
    col += md.w;
  }
}

// ── ground-floor entrance lighting (canopy + fin lights) ───────────────────────

function entranceTerm(ctx: MepContext, u: Unit, ly: number): Term {
  const lob = ctx.interiors[0]!.rooms.get("CM-LOB")!;
  const c = lob.clears[0]!;
  const x = (c.x0 + c.x1) / 2;
  const q: P2 = [x, c.z0 + C.voidStub];
  return { key: "ENTRANCE", q, leg: [0, 0, -1], path: [[q[0], ly, q[1]]], record: u.board.id, circuit: u.lightCircuit.get(u.entrance![0]!.id)! };
}

function entranceNet(ctx: MepContext, u: Unit, net: Net, cnet: Net, qNode: number, ly: number, cspec: (carries: readonly string[], extra?: Partial<RunSpec>) => RunSpec, cab: (c: string) => RunSpec, cnode: (circuit: string, n: number) => number): void {
  const lob = ctx.interiors[0]!.rooms.get("CM-LOB")!;
  const c = lob.clears[0]!;
  const cnp = ctx.archRecords.find((r) => r.id === "ARC-ENT-G-MAIN-CNP")!;
  const g = cnp.geometry as { size: readonly [number, number, number] };
  const cy = cnp.originalPosition[1];
  const cx0 = cnp.originalPosition[0] - g.size[0] / 2;
  const cx1 = cnp.originalPosition[0] + g.size[0] / 2;
  const zIn = cnp.originalPosition[2] + g.size[2] / 2 - 0.35;
  const circuit = u.lightCircuit.get(u.entrance![0]!.id)!;
  const x = net.point(qNode)[0];
  const wallZ = c.z0 - C.chase;
  // chase down inside the exterior wall to the canopy, then out into the canopy slab
  const p1 = net.node([x, ly, wallZ]);
  const p2 = net.node([x, cy, wallZ]);
  const jb = net.node([x, cy, zIn]);
  const path: number[][] = [[qNode, p1, p2, jb]];
  const leafs: { node: number[]; rec: string }[] = [];
  for (const l of u.entrance!) {
    const lp = l.originalPosition;
    const top = lp[1] + (l.geometry.kind === "cylinder" ? l.geometry.height / 2 : (l.geometry as { size: readonly [number, number, number] }).size[1] / 2);
    if (l.id.includes("CLT")) {
      const a = net.node([lp[0], cy, zIn]);
      const b = net.node([lp[0], cy, lp[2]]);
      const e = net.node([lp[0], top, lp[2]], { record: l.id });
      leafs.push({ node: [jb, a, b, e], rec: l.id });
    } else {
      // fin light: along the canopy to its edge, out onto the fin face, down to the fitting
      const edge = lp[0] < cnp.originalPosition[0] ? cx0 + 0.03 : cx1 - 0.03;
      const out = lp[0];
      const a = net.node([edge, cy, zIn]);
      const b = net.node([edge, cy, lp[2]]);
      const d0 = net.node([out, cy, lp[2]]);
      const e = net.node([out, top, lp[2]], { record: l.id });
      leafs.push({ node: [jb, a, b, d0, e], rec: l.id });
    }
    endpoint(ctx, l.id, "entrance / facade light").connectedBy.push(circuit);
  }
  // merge the leaf paths that share the canopy trunk (west side and east side)
  const westCLT = leafs.filter((l) => net.point(l.node[1]!)[0] < x).sort((p, q) => net.point(q.node[1]!)[0] - net.point(p.node[1]!)[0]);
  const eastCLT = leafs.filter((l) => net.point(l.node[1]!)[0] > x).sort((p, q) => net.point(p.node[1]!)[0] - net.point(q.node[1]!)[0]);
  const edges: [number, number][] = [];
  for (const side of [westCLT, eastCLT]) {
    let prev = jb;
    for (const l of side) {
      edges.push([prev, l.node[1]!]);
      prev = l.node[1]!;
      for (let k = 1; k + 1 < l.node.length; k++) edges.push([l.node[k]!, l.node[k + 1]!]);
    }
  }
  for (const p of path) for (let k = 0; k + 1 < p.length; k++) edges.push([p[k]!, p[k + 1]!]);
  for (const [a, b] of edges) {
    net.edge(a, b, cspec([circuit], { label: `${C.conduit.lighting.nominal} (in the canopy slab / on the fin)` }));
    cnet.edge(cnode(circuit, a), cnode(circuit, b), cab(circuit));
  }
  for (const l of leafs) cnet.setRecord(cnode(circuit, l.node[l.node.length - 1]!), l.rec);
}

// ── distribution: supply, panels, trays, submains, feeders, earthing ───────────

function distribution(ctx: MepContext, units: Unit[]): void {
  const from = ctx.drafts.drafts.length;
  const grade = ctx.arch.datums.siteGrade;
  const inc = declareNetwork(ctx, { id: "ELC-NET-INC", system: "electrical", kind: "incoming", name: "Incoming LT supply, main panel and meter bank" });
  const trayNet = declareNetwork(ctx, { id: "ELC-NET-TRAY", system: "electrical", kind: "containment", name: "Cable tray system: meter room, corridors, services room, shaft riser" });
  const earth = declareNetwork(ctx, { id: "ELC-NET-EARTH", system: "electrical", kind: "earthing", name: "Earthing: pits, main earthing terminal, earth strips, floor earth bars" });
  const pumpNet = declareNetwork(ctx, { id: "ELC-NET-FDR-PUMP", system: "electrical", kind: "feeder", name: "Pump feeder (MDB -> pump starter -> pumps)", parent: inc });
  const G = (type: "INC" | "PNL" | "TRY" | "SUB" | "EAR", floor: number, loc: string, name: string, category: "distribution" | "containment" | "earthing", mat: string) => ctx.drafts.group({ system: "electrical", type, floor, loc, name, assemblyType: category === "containment" ? "cable_tray" : category === "earthing" ? "earthing" : "distribution", category, materialId: mat, apartmentId: "CM" });
  const gInc = G("INC", 0, "SUPPLY", "Incoming supply", "distribution", "cable_armoured");
  const gPnl = G("PNL", 0, "MTR", "Main LT panel and meter bank", "distribution", "enclosure_steel");
  const gEar = G("EAR", 0, "MAIN", "Earthing", "earthing", "earth_gi");
  const gTry = (s: number) => G("TRY", s, "CM", `Cable trays ${ftag(s)}`, "containment", "tray_gi");
  const gSub = (s: number) => G("SUB", s, "CM", `Submain and feeder cables ${ftag(s)}`, "distribution", "cable_armoured");
  const ictx0 = ctx.interiors[0]!;
  const mtr = ictx0.rooms.get("CM-MTR");
  if (!mtr) {
    unresolved(ctx, "CM-MTR", "no meter room: electrical distribution not generated");
    return;
  }
  const mc = mtr.clears[0]!;
  const yT = (s: number) => ctx.d.slabTop(s) + C.trayBottom;
  const yS = (s: number) => ctx.d.slabTop(s) + C.layers.submain;
  const ffl0 = ctx.d.ffl(0);
  // MDB (floor panel) on the meter-room west wall near the corridor; meter board on the north wall.
  const mdbAnchor: V3 = [mc.x0 + 0.02, ffl0, mc.z1 - 0.8];
  const P = FIXED_PARTS.panel;
  const mdbPl = placeLocal([mdbAnchor[0] + P.size[2] / 2, ffl0, mdbAnchor[2]], [0, 0, -1], [0, 1, 0], sub(P.centre, scale(P.size, 0.5)), add(P.centre, scale(P.size, 0.5)));
  const mdb = ctx.drafts.add(gPnl, { code: "MDB", fixed: true, name: `${gPnl.name}: main LT panel (MDB) with incomer MCCB and outgoing feeders`, componentType: "main_panel", materialId: "enclosure_steel", geometry: { kind: "part", part: "panel", size: mdbPl.size, fill: PART_FILL.panel! }, position: mdbPl.position, rotation: mdbPl.rotation, dimensions: { length: mdbPl.size[0], width: mdbPl.size[2], height: mdbPl.size[1] }, unit: "nr", networkId: inc, nominalSize: "250 A TPN, 415 V" }).id;
  const mdbX = mdbAnchor[0] + P.size[2] / 2;
  const mdbZ = mdbAnchor[2];
  const mN = mountOn(0, "CM-MTR", mc, "N");
  const boardY = ffl0 + 1.55;
  const MB = FIXED_PARTS["meter-board"];
  const boardA = (mc.x0 + mc.x1) / 2 + 0.25;
  const board = wallPart(ctx, gPnl, "meter-board", mN, boardA, boardY, 0, { code: "MBRD", fixed: true, name: `${gPnl.name}: energy meter bank (glazed cabinet)`, componentType: "meter_board", materialId: "enclosure_steel", networkId: inc, nominalSize: "30 meters" }).id;
  ctx.drafts.link(board, mdb);
  // meters: flats on every floor, then the common meter
  const flats = units.filter((u) => u.aptId !== "CM");
  const meterIds = new Map<string, { id: string; p: V3 }>();
  const ME = FIXED_PARTS["meter-elec"];
  const cols = 10;
  const meterList = [...flats.map((u) => ({ key: u.subNet, label: `energy meter ${u.aptId} ${ftag(u.s)}` })), { key: "COMMON", label: "energy meter, common services" }];
  meterList.forEach((mt, i) => {
    const colI = i % cols;
    const rowI = Math.floor(i / cols);
    const a = boardA - MB.size[0] / 2 + 0.18 + colI * 0.21;
    const y = boardY + MB.size[1] / 2 - 0.22 - rowI * 0.33;
    const anchor = wallPoint(mN, a, y, 0.1);
    const pl = placeLocal(anchor, [mN.n[2] !== 0 ? -mN.n[2] : 1, 0, 0] as V3, [0, 1, 0], sub(ME.centre, scale(ME.size, 0.5)), add(ME.centre, scale(ME.size, 0.5)));
    const d = ctx.drafts.add(gPnl, { code: `MTR${String(i + 1).padStart(2, "0")}`, fixed: true, name: `${gPnl.name}: ${mt.label}`, componentType: "energy_meter", materialId: "device_white", geometry: { kind: "part", part: "meter-elec", size: pl.size, fill: PART_FILL["meter-elec"]! }, position: pl.position, rotation: pl.rotation, dimensions: { length: pl.size[0], width: pl.size[2], height: pl.size[1] }, unit: "nr", networkId: mt.key === "COMMON" ? inc : mt.key, nominalSize: "single phase, 10-60 A" });
    ctx.drafts.link(d.id, board);
    meterIds.set(mt.key, { id: d.id, p: [anchor[0], y + ME.size[1] / 2, anchor[2]] });
  });
  ctx.drafts.link(meterIds.get("COMMON")!.id, mdb);

  // Tray system: nodes first, runs after the cables are laid (each run records what it carries)
  const net = new Net();
  const zT = C.trayZ;
  const xSvc = ctx.grid.xs[ctx.cfg.shaftBay.xStart]! + 1.0;
  const shaftX0 = ctx.grid.xs[ctx.cfg.shaftBay.xStart]! + (ctx.cfg.gridSpacingX - ctx.cfg.shaftOpening.width) / 2;
  const zMtr = mc.z1 - 0.39;
  // meter-room tray branch: clear of the common-block water take-off below it
  let xMtr = boardA - 0.2;
  for (const off of [0, 0.3, -0.3, 0.6, -0.6, 0.9]) {
    const x = boardA - 0.2 + off;
    if (ctx.mep.free(box3(x - 0.2, x + 0.2, yT(0) - 0.004, yT(0) + 0.12, zMtr - 0.2, C.trayZ))) {
      xMtr = x;
      break;
    }
  }
  const adj = new Map<number, number[]>();
  const trayRuns: { a: number; b: number; s: number; riser: boolean; label: string }[] = [];
  const tnode = (p: V3) => {
    const id = net.node(p);
    adj.set(id, []);
    return id;
  };
  const tedge = (a: number, b: number, s: number, label: string, riser = false) => {
    trayRuns.push({ a, b, s, riser, label });
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  };
  // flat submain exits along each corridor tray: near the DB, clear of columns and water take-offs
  const exits = new Map<number, { x: number; u: Unit }[]>();
  for (const u of flats) {
    const xs = exits.get(u.s) ?? exits.set(u.s, []).get(u.s)!;
    const want = planOfDevice(u.board)[0];
    let x = want;
    for (const off of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2, 1.5, -1.5]) {
      x = want + off;
      if (ctx.grid.xs.some((g) => Math.abs(g - x) < 0.45)) continue;
      if (xs.some((e) => Math.abs(e.x - x) < 0.12)) continue;
      if (!ctx.mep.free(box3(x - 0.08, x + 0.08, yT(u.s) - 0.05, yS(u.s) + 0.02, -4.7, -3.1), (r) => !r.id.startsWith("STUB-"))) continue;
      break;
    }
    xs.push({ x, u });
  }
  const corridor = new Map<number, Map<number, number>>();
  const branch = new Map<number, number>();
  const riser: number[] = [];
  for (let s = 0; s < ctx.cfg.storeyCount; s++) {
    const xsList = [...(exits.get(s) ?? []).map((e) => e.x), xSvc, ...(s === 0 ? [xMtr] : [])];
    const junctions = [...new Set([Math.min(...xsList) - 0.4, Math.max(...xsList) + 0.4, xSvc, ...(s === 0 ? [xMtr] : [])])].sort((a, b) => a - b);
    const cm = new Map<number, number>();
    for (const x of junctions) cm.set(x, tnode([x, yT(s), zT]));
    for (let i = 0; i + 1 < junctions.length; i++) tedge(cm.get(junctions[i]!)!, cm.get(junctions[i + 1]!)!, s, "300 x 75 perforated GI cable tray (corridor)");
    corridor.set(s, cm);
    const b1 = tnode([xSvc, yT(s), 0]);
    const b2 = tnode([shaftX0, yT(s), 0]);
    tedge(cm.get(xSvc)!, b1, s, "300 x 75 perforated GI cable tray (services room)");
    tedge(b1, b2, s, "300 x 75 perforated GI cable tray (into the shaft)");
    branch.set(s, b1);
    riser.push(b2);
  }
  for (let s = 0; s + 1 < riser.length; s++) tedge(riser[s]!, riser[s + 1]!, s, "300 x 75 perforated GI cable tray riser (shaft)", true);
  const m1 = tnode([xMtr, yT(0), zMtr]);
  const m2 = tnode([mdbX, yT(0), zMtr]);
  const m3 = tnode([boardA + MB.size[0] / 2 - 0.15, yT(0), zMtr]);
  tedge(corridor.get(0)!.get(xMtr)!, m1, 0, "300 x 75 perforated GI cable tray (meter room)");
  tedge(m1, m2, 0, "300 x 75 perforated GI cable tray (meter room, over the MDB)");
  tedge(m1, m3, 0, "300 x 75 perforated GI cable tray (meter room, over the meter bank)");

  // Tree order from the meter-room tee
  const root = m1;
  const parent = new Map<number, number>([[root, -1]]);
  const order = [root];
  for (let i = 0; i < order.length; i++) for (const nb of adj.get(order[i]!)!) if (!parent.has(nb)) {
    parent.set(nb, order[i]!);
    order.push(nb);
  }
  const pathTo = (n: number) => {
    const out: number[] = [];
    for (let c = n; c !== -1; c = parent.get(c)!) out.push(c);
    return out.reverse();
  };
  const P3 = (n: number) => net.point(n);
  const oriented = (a: number, b: number): [number, number] => (parent.get(b) === a ? [a, b] : [b, a]);
  interface TrayCable {
    readonly network: string;
    readonly spec: { od: number; nominal: string };
    readonly label: string;
    readonly record: string; // source module (meter / MDB)
    readonly from: V3; // top of the source
    readonly srcSeg: [number, number]; // entry segment, parent-side node first
    readonly exitSeg: [number, number];
    readonly exitAt: V3;
    readonly side: number; // +1: leaves toward +z (north) / -1 toward -z
    readonly s: number;
    readonly u: Unit;
  }
  const cables: TrayCable[] = [];
  const segOn = (s: number, x: number): [number, number] => {
    const cm = [...corridor.get(s)!.entries()].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i + 1 < cm.length; i++) if (x >= cm[i]![0] - 1e-9 && x <= cm[i + 1]![0] + 1e-9) return oriented(cm[i]![1], cm[i + 1]![1]);
    throw new Error("MEP: exit outside the corridor tray");
  };
  const entrySeg = (x: number): [number, number] => (x <= xMtr ? [m1, m2] : [m1, m3]);
  for (const [s, list] of exits)
    for (const e of list) {
      const u = e.u;
      const mt = meterIds.get(u.subNet)!;
      cables.push({ network: u.subNet, spec: C.cable.submain, label: `submain ${u.aptId} ${ftag(u.s)} (${C.cable.submain.nominal})`, record: mt.id, from: mt.p, srcSeg: entrySeg(mt.p[0]), exitSeg: segOn(s, e.x), exitAt: [e.x, yT(s), zT], side: planOfDevice(u.board)[1] > zT ? 1 : -1, s, u });
    }
  for (const u of units.filter((x) => x.aptId === "CM")) {
    const s = u.s;
    cables.push({ network: u.subNet, spec: C.cable.feeder, label: `common feeder ${ftag(s)} (${C.cable.feeder.nominal})`, record: mdb, from: [mdbX, ffl0 + P.size[1], mdbZ], srcSeg: [m1, m2], exitSeg: oriented(branch.get(s)!, riser[s]!), exitAt: [planOfDevice(u.board)[0] - 0.12, yT(s), 0], side: -1, s, u });
  }
  // Lanes in a stable order; cables in a tray may cross each other at junctions (as laid on site).
  cables.sort((p, q) => q.s - p.s || p.exitAt[0] - q.exitAt[0] || (p.network < q.network ? -1 : 1));
  const lanes = 13;
  const pitch = (TRAY.width - 0.03) / (lanes - 1);
  const cnet = new Net();
  const carries = new Map<string, Set<string>>();
  const segKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const isRiser = (a: number, b: number) => Math.abs(P3(a)[1] - P3(b)[1]) > 0.5;
  const segUp = (a: number, b: number): V3 => (isRiser(a, b) ? [1, 0, 0] : [0, 1, 0]);
  const segLat = (a: number, b: number): V3 => (isRiser(a, b) || Math.abs(P3(a)[0] - P3(b)[0]) > Math.abs(P3(a)[2] - P3(b)[2]) ? [0, 0, 1] : [1, 0, 0]);
  const comb = (a: V3, b: V3): V3 => [a[0] === b[0] ? a[0] : a[0] + b[0], a[1] === b[1] ? a[1] : a[1] + b[1], a[2] === b[2] ? a[2] : a[2] + b[2]];
  const ends: { cb: TrayCable; node: number; pt: V3 }[] = [];
  cables.forEach((cb, k) => {
    const lane = k % lanes;
    const layer = Math.floor(k / lanes);
    const L = -(TRAY.width - 0.03) / 2 + lane * pitch;
    const H = TRAY.sheet + cb.spec.od / 2 + 0.002 + layer * (cb.spec.od + 0.003);
    const off = (a: number, b: number): V3 => add(scale(segLat(a, b), L), scale(segUp(a, b), H));
    const pa = pathTo(cb.srcSeg[0]);
    const pb = pathTo(cb.exitSeg[1]);
    let i = 0;
    while (i < Math.min(pa.length, pb.length) && pa[i] === pb[i]) i++;
    const meet = pa[i - 1]!;
    const upPart = [...pa].reverse();
    const nodePath = [...upPart.slice(0, upPart.indexOf(meet) + 1), ...pb.slice(pb.indexOf(meet) + 1, pb.length - 1)];
    const first: [number, number] = [cb.srcSeg[1], cb.srcSeg[0]];
    const segs: [number, number][] = [first];
    const entry: V3 = add([cb.from[0], P3(first[1])[1], P3(first[1])[2]], off(first[0], first[1]));
    const pts: V3[] = [entry];
    for (let n = 0; n < nodePath.length; n++) {
      const cur = nodePath[n]!;
      const next: [number, number] = [cur, n + 1 < nodePath.length ? nodePath[n + 1]! : cb.exitSeg[1]];
      pts.push(add(P3(cur), comb(off(segs[segs.length - 1]![0], segs[segs.length - 1]![1]), off(next[0], next[1]))));
      segs.push(next);
    }
    const last = segs[segs.length - 1]!;
    const exitPt = add(cb.exitAt, off(last[0], last[1]));
    pts.push(exitPt);
    for (const sg of segs) (carries.get(segKey(sg[0], sg[1])) ?? carries.set(segKey(sg[0], sg[1]), new Set()).get(segKey(sg[0], sg[1]))!).add(cb.network);
    // source: up out of the module, across under the tray to the lane, up into it
    const under = yT(0) - 0.06;
    const drop: V3[] = [cb.from, [cb.from[0], under, cb.from[2]], [cb.from[0], under, entry[2]]];
    // exit: up out of the lane above the tray rim, across to the tray edge
    const ys = yS(cb.s);
    const tail: V3[] = [[exitPt[0], ys, exitPt[2]], [exitPt[0], ys, cb.exitAt[2] + cb.side * (TRAY.width / 2 + 0.03)]];
    const all = [...drop, ...pts, ...tail];
    const clean: V3[] = [];
    for (const p of all) if (!clean.length || Math.hypot(p[0] - clean[clean.length - 1]![0], p[1] - clean[clean.length - 1]![1], p[2] - clean[clean.length - 1]![2]) > 1e-6) clean.push(p);
    const ids = clean.map((p, i2) => cnet.node(p, i2 === 0 ? { record: cb.record } : {}));
    for (let q = 0; q + 1 < ids.length; q++) {
      const st = storeyAt(ctx, (clean[q]![1] + clean[q + 1]![1]) / 2);
      cnet.edge(ids[q]!, ids[q + 1]!, { kind: "cable", group: gSub(st), networkId: cb.network, od: cb.spec.od, materialId: "cable_armoured", componentType: "submain_cable", label: cb.label, nominal: cb.spec.nominal, category: "distribution", flow: "upstream" });
    }
    ends.push({ cb, node: ids[ids.length - 1]!, pt: clean[clean.length - 1]! });
  });
  for (const t of trayRuns) {
    const carried = [...(carries.get(segKey(t.a, t.b)) ?? [])].sort();
    const [a, b] = oriented(t.a, t.b);
    net.edge(a, b, { kind: "tray", group: gTry(t.s), networkId: trayNet, od: TRAY.width, materialId: "tray_gi", componentType: t.riser ? "cable_tray_riser" : "cable_tray", label: t.label, nominal: "300 x 75 mm", category: "containment", flow: "upstream", carries: carried, ...(t.riser ? { up: [1, 0, 0] as V3 } : {}) });
  }
  // From the tray edge to each board: conduit + the same cable, through the corridor wall
  const adaptors: { node: number; seg: [number, number] }[] = [];
  for (const { cb, node, pt } of ends) {
    const u = cb.u;
    const port = u.board.ports.submain;
    const ys = yS(cb.s);
    const r = C.conduit.submain.od / 2;
    const corridorStrip: PlanRect = { x0: pt[0] - 0.05, x1: pt[0] + 0.05, z0: Math.min(pt[2], zT) - 1.6, z1: Math.max(pt[2], zT) + 1.6 };
    const obs = planObstacles(ctx, bboxOf([...u.region, corridorStrip]), ys, r, { ignore: reservedIds(ctx) });
    const top = port.chase[port.chase.length - 1]!;
    const stubLeg = legTo(port.q, [top[0], top[2]]);
    const path = routeOrtho([pt[0], pt[2]], port.q, obs, { half: r + C.clearance / 2, region: [...u.region, corridorStrip], bendCost: 0.2, minLeg: 0.09, endsOk: (_f, last) => legsOk([stubLeg, last]) });
    if (!path) {
      unresolved(ctx, cb.network, "submain conduit from the corridor tray to the board could not be routed");
      continue;
    }
    const pts: V3[] = [...path.map(([x, z]) => [x, ys, z] as V3), ...[...port.chase].reverse()];
    const g = u.groups.db;
    const cspec: RunSpec = { kind: "conduit", group: g, networkId: cb.network, od: C.conduit.submain.od, materialId: "conduit_power", componentType: "conduit", label: C.conduit.submain.nominal, nominal: C.conduit.submain.nominal, category: "distribution", carries: [cb.network], flow: "upstream" };
    const adaptor = { kind: "cap" as const, group: g, networkId: cb.network, materialId: "conduit_power", label: "conduit adaptor at the cable tray", componentType: "conduit_adaptor", category: "distribution" as const };
    const ids = pts.map((p, i) => net.node(p, i === pts.length - 1 ? { record: u.board.id } : i === 0 ? { part: adaptor } : {}));
    adaptors.push({ node: ids[0]!, seg: cb.exitSeg });
    for (let i = 0; i + 1 < ids.length; i++) net.edge(ids[i]!, ids[i + 1]!, cspec);
    const cids = [node, ...pts.slice(1).map((p, i) => cnet.node(p, i === pts.length - 2 ? { record: `${g.id}-ISO` } : {}))];
    for (let i = 0; i + 1 < cids.length; i++) cnet.edge(cids[i]!, cids[i + 1]!, { kind: "cable", group: g, networkId: cb.network, od: cb.spec.od, materialId: "cable_armoured", componentType: "submain_cable", label: cb.label, nominal: cb.spec.nominal, category: "distribution", flow: "upstream" });
  }
  net.emit(ctx.drafts);
  for (const a of adaptors) {
    const id = net.emittedAt(a.node);
    const tray = net.runsAt(a.seg[0]).find((r) => net.runsAt(a.seg[1]).includes(r));
    if (id && tray) ctx.drafts.link(id, tray);
  }
  indexDrafts(ctx, from);
  // Incoming supply, pump feeder, earthing
  const from2 = ctx.drafts.drafts.length;
  supplyAndEarth(ctx, { gInc, gEar, inc, earth, pumpNet, mdb, mdbX, mdbZ, grade, cnet, ffl0, shaftX0 });
  cnet.emit(ctx.drafts);
  indexDrafts(ctx, from2);
}

/** Drop consecutive duplicate points. */
function dedupe(pts: readonly V3[]): V3[] {
  const out: V3[] = [];
  for (const p of pts) if (!out.length || Math.hypot(p[0] - out[out.length - 1]![0], p[1] - out[out.length - 1]![1], p[2] - out[out.length - 1]![2]) > 1e-6) out.push(p);
  return out;
}

function storeyAt(ctx: MepContext, y: number): number {
  for (let L = ctx.cfg.storeyCount - 1; L >= 0; L--) if (y >= ctx.d.slabTop(L) - ctx.cfg.slab.thickness / 2) return L;
  return 0;
}

interface SupplyCtx {
  readonly gInc: Group;
  readonly gEar: Group;
  readonly inc: string;
  readonly earth: string;
  readonly pumpNet: string;
  readonly mdb: string;
  readonly mdbX: number;
  readonly mdbZ: number;
  readonly grade: number;
  readonly cnet: Net;
  readonly ffl0: number;
  readonly shaftX0: number;
}

function supplyAndEarth(ctx: MepContext, k: SupplyCtx): void {
  // Underground depths (below the plinth beams, above the drain crowns): incoming, pump feeder, earth strip.
  const yU = -0.64;
  const yP = -0.57;
  const zFront = ctx.grid.zs[0]! - 2.0;
  const fp = FIXED_PARTS["feeder-pillar"];
  // feeder pillar: south of the building, clear of chambers, the entrance and drains
  let pillar: V3 | null = null;
  for (const dx of [0, -0.6, 0.6, -1.2, 1.2, -1.8, 1.8, -2.4, 2.4]) {
    const x = k.mdbX + dx;
    const bx = { min: [x - fp.size[0] / 2 - 0.2, -1.5, zFront - fp.size[2] / 2 - 0.2] as const, max: [x + fp.size[0] / 2 + 0.2, k.grade + fp.size[1], zFront + fp.size[2] / 2 + 0.2] as const };
    if (!ctx.space.free(bx as never) || !ctx.mep.free(bx as never)) continue;
    pillar = [x, k.grade, zFront];
    break;
  }
  if (!pillar) {
    unresolved(ctx, k.inc, "no clear position for the feeder pillar");
    return;
  }
  const pl = placeLocal(pillar, [-1, 0, 0], [0, 1, 0], sub(fp.centre, scale(fp.size, 0.5)), add(fp.centre, scale(fp.size, 0.5)));
  const fpId = ctx.drafts.add(k.gInc, { code: "FP", fixed: true, name: `${k.gInc.name}: LT feeder pillar (utility cut-out)`, componentType: "feeder_pillar", materialId: "enclosure_steel", geometry: { kind: "part", part: "feeder-pillar", size: pl.size, fill: PART_FILL["feeder-pillar"]! }, position: pl.position, rotation: pl.rotation, dimensions: { length: pl.size[0], width: pl.size[2], height: pl.size[1] }, unit: "nr", networkId: k.inc, nominalSize: "400 A" }).id;
  const cab = (g: Group, network: string, spec: { od: number; nominal: string }, label: string, ctype = "submain_cable"): RunSpec => ({ kind: "cable", group: g, networkId: network, od: spec.od, materialId: "cable_armoured", componentType: ctype, label, nominal: spec.nominal, category: "distribution", flow: "upstream" });
  const run = (raw: V3[], spec: RunSpec, first?: string, last?: string) => {
    const pts = dedupe(raw);
    const ids = pts.map((p, i) => k.cnet.node(p, i === 0 && first ? { record: first } : i === pts.length - 1 && last ? { record: last } : {}));
    for (let i = 0; i + 1 < ids.length; i++) k.cnet.edge(ids[i]!, ids[i + 1]!, spec);
  };
  // utility service (to the site boundary) and the incoming cable to the MDB
  const inSpec = C.cable.incoming;
  run([[pillar[0], k.grade + 0.15, pillar[2]], [pillar[0], yU, pillar[2]], [pillar[0], yU, pillar[2] - 2.4]], cab(k.gInc, k.inc, inSpec, "utility LT service cable (to the street, by authority)", "service_cable"), fpId);
  const obs = planObstacles(ctx, { x0: -30, x1: 30, z0: -25, z1: 25 }, yU, inSpec.od / 2 + 0.02);
  const path = routeOrtho([pillar[0], pillar[2]], [k.mdbX, k.mdbZ], obs, { half: inSpec.od / 2 + C.clearance / 2, minLeg: 0.3, bendCost: 0.5 });
  if (!path) unresolved(ctx, k.inc, "no underground route for the incoming cable");
  else run([[pillar[0], k.grade + 0.15, pillar[2]], ...path.map(([x, z]) => [x, yU, z] as V3), [k.mdbX, k.ffl0 + 0.05, k.mdbZ]], cab(k.gInc, k.inc, inSpec, `incoming cable (${inSpec.nominal})`, "incoming_cable"), fpId, k.mdb);
  // pump feeder: MDB -> underground -> pump starter panel; starter -> each pump
  const pump = ctx.appliances.filter((a) => a.kind === "pump");
  const panel = ctx.appliances.find((a) => a.kind === "pump-panel");
  if (panel) {
    const pan = panel.anchor;
    const pobs = planObstacles(ctx, { x0: -30, x1: 30, z0: -25, z1: 25 }, yP, 0.03);
    const pp = routeOrtho([k.mdbX - 0.2, k.mdbZ], [pan[0] + 0.12, pan[2]], pobs, { half: 0.03, minLeg: 0.3, bendCost: 0.5 });
    if (!pp) unresolved(ctx, k.pumpNet, "no underground route for the pump feeder");
    else run([[k.mdbX - 0.2, k.ffl0 + 0.05, k.mdbZ], ...pp.map(([x, z]) => [x, yP, z] as V3), [pan[0] + 0.12, pan[1] - 0.32, pan[2]]], cab(k.gInc, k.pumpNet, C.cable.feeder, `pump feeder (${C.cable.feeder.nominal})`, "feeder_cable"), k.mdb, panel.id);
    for (const p of pump) {
      const a = p.anchor;
      run([[pan[0] + 0.05, pan[1] - 0.32, pan[2]], [pan[0] + 0.05, k.grade + 0.13, pan[2]], [a[0] - 0.1, k.grade + 0.13, pan[2]], [a[0] - 0.1, k.grade + 0.13, a[2]], [a[0] - 0.1, a[1] + 0.3, a[2]]], cab(k.gInc, k.pumpNet, C.cable.power, "pump motor cable 4C x 2.5 sq mm", "motor_cable"), panel.id, p.id);
    }
  }
  // Earthing: two pits beside the pillar, strip to the main earthing terminal (MET) in the meter room
  const ep = FIXED_PARTS["earth-pit"];
  const pits: string[] = [];
  for (const dx of [-1.6, 1.6, -2.4, 2.4, -3.2, 3.2]) {
    if (pits.length >= C.earth.pits) break;
    const x = pillar[0] + dx;
    const bx = { min: [x - 0.4, -1.0, pillar[2] - 0.4] as const, max: [x + 0.4, 0.3, pillar[2] + 0.4] as const };
    if (!ctx.space.free(bx as never) || !ctx.mep.free(bx as never)) continue;
    const ppl = placeLocal([x, k.grade, pillar[2]], [1, 0, 0], [0, 1, 0], sub(ep.centre, scale(ep.size, 0.5)), add(ep.centre, scale(ep.size, 0.5)));
    pits.push(ctx.drafts.add(k.gEar, { code: `PIT${pits.length + 1}`, fixed: true, name: `${k.gEar.name}: earth pit (pipe electrode, test chamber)`, componentType: "earth_pit", materialId: "concrete_precast", geometry: { kind: "part", part: "earth-pit", size: ppl.size, fill: PART_FILL["earth-pit"]! }, position: ppl.position, rotation: ppl.rotation, dimensions: { length: ppl.size[0], width: ppl.size[2], height: ppl.size[1] }, unit: "nr", networkId: k.earth, nominalSize: "GI pipe electrode 40 mm x 2.5 m" }).id);
  }
  const strip = (g: Group, label: string): RunSpec => ({ kind: "strip", group: g, networkId: k.earth, od: C.earth.strip.width, thickness: C.earth.strip.thickness, materialId: "earth_gi", componentType: "earth_strip", label: `${C.earth.strip.nominal} ${label}`, nominal: C.earth.strip.nominal, category: "earthing", flow: "upstream" });
  const enet = new Net();
  const erun = (raw: V3[], spec: RunSpec, first?: string, last?: string) => {
    const pts = dedupe(raw);
    const ids = pts.map((p, i) => enet.node(p, i === 0 && first ? { record: first } : i === pts.length - 1 && last ? { record: last } : {}));
    for (let i = 0; i + 1 < ids.length; i++) enet.edge(ids[i]!, ids[i + 1]!, spec);
    return ids;
  };
  const yE = -0.69;
  const pitPos = pits.map((id) => ctx.drafts.get(id).position);
  if (pitPos.length === 2) erun([[pitPos[0]![0], yE, pitPos[0]![2]], [pitPos[1]![0], yE, pitPos[1]![2]]], strip(k.gEar, "pit interconnection"), pits[0], pits[1]);
  // MET bar on the meter-room west wall, low, next to the MDB
  const mtr = ctx.interiors[0]!.rooms.get("CM-MTR")!;
  const mW = mountOn(0, "CM-MTR", mtr.clears[0]!, "W");
  const metA = k.mdbZ - 0.9;
  const met = wallPart(ctx, k.gEar, "earth-bar", mW, metA, k.ffl0 + 0.45, 0, { code: "MET", fixed: true, name: `${k.gEar.name}: main earthing terminal (copper bar)`, componentType: "earth_bar", materialId: "earth_gi", networkId: k.earth, category: "earthing", nominalSize: "300 x 50 x 6 mm" }).id;
  if (pitPos[0]) {
    const eobs = planObstacles(ctx, { x0: -30, x1: 30, z0: -25, z1: 25 }, yE, 0.02);
    const metPlan: P2 = [mW.face + 0.12, metA];
    // the lead must not double back over the pit interconnection
    const pitLine = pitPos.length === 2 ? { x0: Math.min(pitPos[0]![0], pitPos[1]![0]) + 0.3, x1: Math.max(pitPos[0]![0], pitPos[1]![0]) - 0.3, z0: pitPos[0]![2] - 0.05, z1: pitPos[0]![2] + 0.05 } : null;
    const ep2 = routeOrtho([pitPos[0][0], pitPos[0][2]], metPlan, pitLine ? [...eobs, pitLine] : eobs, { half: 0.02, minLeg: 0.2, bendCost: 0.5 });
    if (!ep2) unresolved(ctx, k.earth, "no underground route for the earth strip from the pits to the MET");
    else erun([[pitPos[0][0], yE, pitPos[0][2]], ...ep2.map(([x, z]) => [x, yE, z] as V3), [metPlan[0], k.ffl0 + 0.42, metPlan[1]]], strip(k.gEar, "earth lead (pit to MET)"), pits[0], met);
  }
  // MET -> MDB, and the earth continuity strip up the riser with a bar on each floor
  erun([[mW.face + 0.05, k.ffl0 + 0.5, metA + 0.17], [mW.face + 0.05, k.ffl0 + 0.5, k.mdbZ - 0.55]], strip(k.gEar, "bond MET to MDB"), met, k.mdb);
  const zS = TRAY.width / 2 + 0.06;
  const xS = k.shaftX0 + 0.005;
  const bars: string[] = [];
  for (let s = 0; s < ctx.cfg.storeyCount; s++) {
    const shf = ctx.interiors[s]!.rooms.get("CM-SHF");
    if (!shf) continue;
    const m = mountOn(s, "CM-SHF", shf.clears[0]!, "W");
    bars.push(wallPart(ctx, ctx.drafts.group({ system: "electrical", type: "EAR", floor: s, loc: "SHF", name: `Floor earth bar ${ftag(s)}`, assemblyType: "earthing", category: "earthing", materialId: "earth_gi", apartmentId: "CM" }), "earth-bar", m, zS + 0.2, ctx.d.ffl(s) + 2.3, 0, { code: "BAR", fixed: true, name: `Floor earth bar ${ftag(s)}: floor earth bar (shaft)`, componentType: "earth_bar", materialId: "earth_gi", networkId: k.earth, category: "earthing", nominalSize: "300 x 50 x 6 mm" }).id);
  }
  const riserPts: V3[] = [];
  for (let s = 0; s < ctx.cfg.storeyCount; s++) riserPts.push([xS + C.earth.strip.thickness / 2, ctx.d.ffl(s) + 2.3, zS]);
  const ids = riserPts.map((p, i) => enet.node(p, { record: bars[i]! }));
  for (let i = 0; i + 1 < ids.length; i++) enet.edge(ids[i]!, ids[i + 1]!, strip(ctx.drafts.group({ system: "electrical", type: "EAR", floor: i, loc: "SHF", name: `Floor earth bar ${ftag(i)}`, assemblyType: "earthing", category: "earthing", materialId: "earth_gi", apartmentId: "CM" }), "riser earth strip (shaft)"));
  enet.emit(ctx.drafts);
  // The riser strip is bonded to the MET through the main earth conductor in the cable tray (not drawn separately).
  if (bars[0]) ctx.drafts.link(bars[0], met);
}
