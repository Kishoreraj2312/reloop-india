/**
 * ReLoop India — world plan model (A2).
 *
 * Resolves the layout contract (layout.ts) against the A1 grid into world-coordinate rooms,
 * doors, windows, open boundaries and balconies for each storey. Pure and deterministic;
 * walls, openings and finishes are generated from this model only.
 */

import type { BuildingConfig } from "../config";
import { buildGrid, openingOf, type GridModel } from "../structure";
import { ARCH_CONFIG, type ArchitectureConfig, type DoorTypeKey, type WindowTypeKey } from "./config";
import {
  APARTMENT_TYPES,
  COMMON,
  FLOOR_PLANS,
  floorKindOf,
  type ApartmentInstance,
  type ApartmentType,
  type FloorKind,
  type LocalRect,
  type LocalSide,
  type RoomType,
} from "./layout";
import { EPS, rect, subtract, type PlanRect } from "./rect";

export type Side = "N" | "S" | "E" | "W";

/** A straight wall line: `axis` is the direction it runs; `c` the fixed coordinate (z for "x", x for "z"). */
export interface PlanLine {
  readonly axis: "x" | "z";
  readonly c: number;
}

export interface PlanRoom {
  readonly id: string; // "A3-LIV", "CM-COR"
  readonly aptId: string; // "A1".."A6" or "CM"
  readonly code: string;
  readonly type: RoomType;
  readonly name: string;
  readonly rects: readonly PlanRect[];
}

export interface PlanDoor {
  /** ID location part: "{room}-{side}-{nn}", room = the room the leaf swings into. */
  readonly key: string;
  readonly typeKey: DoorTypeKey;
  readonly rooms: readonly [string, string]; // room ids or "EXT"
  readonly swingInto: string;
  readonly side: Side; // side of `swingInto` the door is on
  readonly line: PlanLine;
  readonly centre: number; // along the line
  readonly width: number;
  readonly height: number; // head above FFL
  /** Along-line coordinate of the hinged jamb (leaf width measured from here toward the centre). */
  readonly hingeAt: number;
}

export interface PlanWindow {
  readonly key: string; // "{room}-{side}-{nn}"
  readonly typeKey: WindowTypeKey;
  readonly roomId: string;
  readonly side: Side;
  readonly line: PlanLine;
  readonly centre: number;
}

export interface PlanBalcony {
  readonly key: string; // "{apt}-{side}"
  readonly aptId: string;
  readonly roomId: string;
  readonly side: Side;
  /** Bay along the facade, gridline to gridline (world, ascending). */
  readonly bay: readonly [number, number];
}

export interface PlanApartment {
  readonly id: string;
  readonly typeKey: string;
  readonly entranceRoom: string;
  /** Gross area rectangles from the type envelope (independent of the rooms). */
  readonly envelope: readonly PlanRect[];
}

export interface FloorPlan {
  readonly storey: number;
  readonly kind: FloorKind;
  readonly rooms: readonly PlanRoom[];
  readonly doors: readonly PlanDoor[];
  readonly windows: readonly PlanWindow[];
  readonly open: readonly (readonly [string, string])[];
  readonly balconies: readonly PlanBalcony[];
  readonly apartments: readonly PlanApartment[];
  /** Building outline at the facade gridlines (room boundaries reach these lines). */
  readonly outline: PlanRect;
}

// ── Local -> world transform ─────────────────────────────────────────────────

interface Frame {
  readonly x: (u: number) => number;
  readonly z: (v: number) => number;
  readonly rect: (r: LocalRect) => PlanRect;
}

function frameOf(grid: GridModel, inst: ApartmentInstance): Frame {
  const x0 = grid.xs[inst.gridX]!;
  const south = inst.block === "south";
  const zf = south ? grid.zs[0]! : grid.zs[grid.zs.length - 1]!;
  const x = (u: number) => (inst.mirror ? x0 - u : x0 + u);
  const z = (v: number) => (south ? zf + v : zf - v);
  return { x, z, rect: ([u0, u1, v0, v1]) => rect(x(u0), x(u1), z(v0), z(v1)) };
}

const sideOfRoomOnLine = (room: PlanRect, line: PlanLine): Side => {
  if (line.axis === "x") return (room.z0 + room.z1) / 2 > line.c ? "S" : "N";
  return (room.x0 + room.x1) / 2 > line.c ? "W" : "E";
};

/** Segments where two rooms' rectangles share an edge. */
export interface SharedEdge {
  readonly line: PlanLine;
  readonly s0: number;
  readonly s1: number;
}

export function sharedEdges(a: readonly PlanRect[], b: readonly PlanRect[]): SharedEdge[] {
  const out: SharedEdge[] = [];
  for (const ra of a) {
    for (const rb of b) {
      const zo0 = Math.max(ra.z0, rb.z0);
      const zo1 = Math.min(ra.z1, rb.z1);
      if (zo1 - zo0 > EPS) {
        if (Math.abs(ra.x1 - rb.x0) < EPS) out.push({ line: { axis: "z", c: ra.x1 }, s0: zo0, s1: zo1 });
        if (Math.abs(ra.x0 - rb.x1) < EPS) out.push({ line: { axis: "z", c: ra.x0 }, s0: zo0, s1: zo1 });
      }
      const xo0 = Math.max(ra.x0, rb.x0);
      const xo1 = Math.min(ra.x1, rb.x1);
      if (xo1 - xo0 > EPS) {
        if (Math.abs(ra.z1 - rb.z0) < EPS) out.push({ line: { axis: "x", c: ra.z1 }, s0: xo0, s1: xo1 });
        if (Math.abs(ra.z0 - rb.z1) < EPS) out.push({ line: { axis: "x", c: ra.z0 }, s0: xo0, s1: xo1 });
      }
    }
  }
  return out;
}

/** The world line and along-range of a room rect's side that lies on the building outline. */
function outlineEdge(r: PlanRect, outline: PlanRect, side: Side): SharedEdge | null {
  switch (side) {
    case "S":
      return Math.abs(r.z0 - outline.z0) < EPS ? { line: { axis: "x", c: r.z0 }, s0: r.x0, s1: r.x1 } : null;
    case "N":
      return Math.abs(r.z1 - outline.z1) < EPS ? { line: { axis: "x", c: r.z1 }, s0: r.x0, s1: r.x1 } : null;
    case "W":
      return Math.abs(r.x0 - outline.x0) < EPS ? { line: { axis: "z", c: r.x0 }, s0: r.z0, s1: r.z1 } : null;
    case "E":
      return Math.abs(r.x1 - outline.x1) < EPS ? { line: { axis: "z", c: r.x1 }, s0: r.z0, s1: r.z1 } : null;
  }
}

function worldSide(inst: ApartmentInstance, side: LocalSide): Side {
  if (side === "facade") return inst.block === "south" ? "S" : "N";
  const lowU = side === "u0";
  // u grows toward +X unless mirrored; the u0 side faces -u.
  return lowU !== inst.mirror ? "W" : "E";
}

// ── Plan assembly ────────────────────────────────────────────────────────────

interface Builder {
  rooms: PlanRoom[];
  doors: Omit<PlanDoor, "key" | "side">[];
  windows: Omit<PlanWindow, "key">[];
  open: (readonly [string, string])[];
  balconies: PlanBalcony[];
  apartments: PlanApartment[];
}

function roomById(b: Builder, id: string): PlanRoom {
  const r = b.rooms.find((x) => x.id === id);
  if (!r) throw new Error(`plan: unknown room ${id}`);
  return r;
}

/** Find the shared edge between two rooms that contains `centre` (with the door's half width). */
function edgeFor(b: Builder, a: string, other: string, outline: PlanRect, facade: Side, centre: (e: SharedEdge) => number, width: number): { edge: SharedEdge; at: number } {
  const ra = roomById(b, a);
  const edges =
    other === "EXT"
      ? ra.rects.map((r) => outlineEdge(r, outline, facade)).filter((e): e is SharedEdge => e !== null)
      : sharedEdges(ra.rects, roomById(b, other).rects);
  for (const e of edges) {
    const at = centre(e);
    if (at - width / 2 >= e.s0 - EPS && at + width / 2 <= e.s1 + EPS) return { edge: e, at };
  }
  throw new Error(`plan: no shared boundary ${a}/${other} fits an opening of ${width} m`);
}

function addInstance(b: Builder, grid: GridModel, inst: ApartmentInstance, t: ApartmentType, kind: FloorKind, storey: number, arch: ArchitectureConfig, outline: PlanRect): void {
  const f = frameOf(grid, inst);
  const rid = (code: string) => (code.includes("-") || code === "EXT" ? code : `${inst.id}-${code}`);
  for (const r of t.rooms) {
    b.rooms.push({ id: rid(r.code), aptId: inst.id, code: r.code, type: r.type, name: r.name, rects: r.rects.map(f.rect) });
  }
  const existing = b.apartments.findIndex((x) => x.id === inst.id);
  if (existing >= 0) {
    // A common block (ground lobby) extends the common envelope; the corridor stays its entrance.
    const cm = b.apartments[existing]!;
    b.apartments[existing] = { ...cm, envelope: [...cm.envelope, ...t.envelope.map(f.rect)] };
  } else {
    b.apartments.push({ id: inst.id, typeKey: t.key, entranceRoom: rid(t.entrance), envelope: t.envelope.map(f.rect) });
  }
  for (const pair of t.open) b.open.push([rid(pair[0]), rid(pair[1])]);

  const facade: Side = inst.block === "south" ? "S" : "N";
  for (const d of t.doors) {
    const type = arch.doorTypes[d.type];
    const [a, o] = [rid(d.rooms[0]), rid(d.rooms[1])];
    // Local `at` maps to the world along-coordinate of the edge's axis (u -> x, v -> z).
    const { edge, at } = edgeFor(b, a === "EXT" ? o : a, a === "EXT" ? a : o, outline, facade, (e) => (e.line.axis === "x" ? f.x(d.at) : f.z(d.at)), type.width);
    // Local low end -> world low or high end, depending on the axis direction.
    const flips = edge.line.axis === "x" ? inst.mirror : inst.block === "north";
    const lowWorld = (d.hinge === "low") !== flips;
    b.doors.push({
      typeKey: d.type,
      rooms: [a, o],
      swingInto: rid(d.swingInto),
      line: edge.line,
      centre: at,
      width: type.width,
      height: type.height,
      hingeAt: lowWorld ? at - type.width / 2 : at + type.width / 2,
    });
  }

  for (const w of t.windows) {
    const room = b.rooms.find((x) => x.id === rid(w.room))!;
    const side = worldSide(inst, w.side);
    const typeKey = kind === "ground" && w.ground ? w.ground : w.type;
    const width = arch.windowTypes[typeKey].width;
    for (const r of room.rects) {
      const e = outlineEdge(r, outline, side);
      if (!e) continue;
      const at = e.line.axis === "x" ? f.x(w.at) : f.z(w.at);
      if (at - width / 2 < e.s0 - EPS || at + width / 2 > e.s1 + EPS) continue;
      b.windows.push({ typeKey, roomId: room.id, side, line: e.line, centre: at });
    }
  }

  if (t.balcony && storey >= 1) {
    const xs = [f.x(t.balcony.bay[0]), f.x(t.balcony.bay[1])].sort((p, q) => p - q) as [number, number];
    b.balconies.push({ key: `${inst.id}-${facade}`, aptId: inst.id, roomId: rid(t.balcony.room), side: facade, bay: xs });
  }
}

function addCommon(b: Builder, grid: GridModel, arch: ArchitectureConfig): void {
  const { cfg, xs, zs } = grid;
  const zc = zs[COMMON.corridor.gridZ]!;
  const corridor = rect(xs[0]!, xs[xs.length - 1]!, zc - COMMON.corridor.width, zc);
  const stair = cfg.stairBay;
  const stc = rect(xs[stair.xStart]!, xs[stair.xEnd]!, zs[stair.zStart]!, zs[stair.zEnd]!);
  const sh = cfg.shaftBay;
  const svcBay = rect(xs[sh.xStart]!, xs[sh.xEnd]!, zs[sh.zStart]!, zs[sh.zEnd]!);
  const op = openingOf(grid, "shaft");
  const half = arch.walls.core / 2;
  const shf = rect(op.x0 - half, op.x1 + half, op.z0 - half, op.z1 + half);
  const add = (code: string, type: RoomType, name: string, rects: PlanRect[]) =>
    b.rooms.push({ id: `CM-${code}`, aptId: "CM", code, type, name, rects });
  b.apartments.push({ id: "CM", typeKey: "core", entranceRoom: "CM-COR", envelope: [corridor, stc, svcBay] });
  add("COR", "corridor", "Common corridor", [corridor]);
  add("STC", "stair", "Stair core", [stc]);
  add("SVC", "services", "Services room", subtract(svcBay, shf));
  add("SHF", "shaft", "Service shaft", [shf]);

  const stairOp = openingOf(grid, "stair");
  const opType = arch.doorTypes.OP;
  const opCentre = (stairOp.x0 + stairOp.x1) / 2;
  b.doors.push({ typeKey: "OP", rooms: ["CM-COR", "CM-STC"], swingInto: "CM-STC", line: { axis: "x", c: zc }, centre: opCentre, width: opType.width, height: opType.height, hingeAt: opCentre - opType.width / 2 });

  const sd = arch.doorTypes[COMMON.servicesDoor.type];
  const sdc = svcBay.x0 + COMMON.servicesDoor.offset;
  b.doors.push({ typeKey: COMMON.servicesDoor.type, rooms: ["CM-COR", "CM-SVC"], swingInto: "CM-SVC", line: { axis: "x", c: zc }, centre: sdc, width: sd.width, height: sd.height, hingeAt: sdc - sd.width / 2 });

  const fd = arch.doorTypes[COMMON.shaftDoor.type];
  const fdc = (shf.x0 + shf.x1) / 2;
  b.doors.push({ typeKey: COMMON.shaftDoor.type, rooms: ["CM-SHF", "CM-SVC"], swingInto: "CM-SVC", line: { axis: "x", c: shf.z0 }, centre: fdc, width: fd.width, height: fd.height, hingeAt: fdc - fd.width / 2 });

  const zw = (corridor.z0 + corridor.z1) / 2;
  b.windows.push({ typeKey: COMMON.corridorWindow, roomId: "CM-COR", side: "W", line: { axis: "z", c: corridor.x0 }, centre: zw });
  b.windows.push({ typeKey: COMMON.corridorWindow, roomId: "CM-COR", side: "E", line: { axis: "z", c: corridor.x1 }, centre: zw });
}

/** Deterministic "{room}-{side}-{nn}" keys, numbered per room+side in along-line order. */
function keyed<T extends { line: PlanLine; centre: number }>(items: readonly T[], room: (t: T) => string, side: (t: T) => Side): (T & { key: string; side: Side })[] {
  const sorted = [...items].sort((p, q) => room(p).localeCompare(room(q)) || side(p).localeCompare(side(q)) || p.centre - q.centre);
  const count = new Map<string, number>();
  return sorted.map((t) => {
    const base = `${room(t)}-${side(t)}`;
    const n = (count.get(base) ?? 0) + 1;
    count.set(base, n);
    return { ...t, side: side(t), key: `${base}-${String(n).padStart(2, "0")}` };
  });
}

export function buildFloorPlan(cfg: BuildingConfig, storey: number, arch: ArchitectureConfig = ARCH_CONFIG): FloorPlan {
  const grid = buildGrid(cfg);
  const kind = floorKindOf(storey, cfg.storeyCount);
  const outline = rect(grid.xs[0]!, grid.xs[grid.xs.length - 1]!, grid.zs[0]!, grid.zs[grid.zs.length - 1]!);
  const b: Builder = { rooms: [], doors: [], windows: [], open: [], balconies: [], apartments: [] };
  addCommon(b, grid, arch);
  for (const inst of FLOOR_PLANS[kind]) {
    const t = APARTMENT_TYPES[inst.type];
    if (!t) throw new Error(`plan: unknown apartment type ${inst.type}`);
    addInstance(b, grid, inst, t, kind, storey, arch, outline);
  }
  const roomRects = new Map(b.rooms.map((r) => [r.id, r.rects]));
  const sideOfDoor = (d: (typeof b.doors)[number]) => {
    const rs = roomRects.get(d.swingInto)!;
    const touching = rs.find((r) => (d.line.axis === "x" ? Math.abs(r.z0 - d.line.c) < EPS || Math.abs(r.z1 - d.line.c) < EPS : Math.abs(r.x0 - d.line.c) < EPS || Math.abs(r.x1 - d.line.c) < EPS));
    return sideOfRoomOnLine(touching ?? rs[0]!, d.line);
  };
  return {
    storey,
    kind,
    rooms: b.rooms,
    doors: keyed(b.doors, (d) => d.swingInto, sideOfDoor),
    windows: keyed(b.windows, (w) => w.roomId, (w) => w.side),
    open: b.open,
    balconies: b.balconies,
    apartments: b.apartments,
    outline,
  };
}

const planCache = new WeakMap<BuildingConfig, Map<number, FloorPlan>>();

/** Memoised floor plans (configs are treated as immutable). */
export function getFloorPlan(cfg: BuildingConfig, storey: number): FloorPlan {
  let m = planCache.get(cfg);
  if (!m) planCache.set(cfg, (m = new Map()));
  let p = m.get(storey);
  if (!p) m.set(storey, (p = buildFloorPlan(cfg, storey)));
  return p;
}
