/**
 * Plan-level validation (A2 stage 1): checks the layout contract before any geometry.
 * Each check returns human-readable problems; an empty list means the check passed.
 */

import type { BuildingConfig } from "../config";
import { ARCH_CONFIG, type ArchitectureConfig } from "./config";
import { boundaryAt, clearRect, floorBoundaries, wallFootprint, type Boundary } from "./boundaries";
import type { FloorPlan, PlanDoor, PlanRoom } from "./plan";
import { contains, EPS, overlaps, rectArea, rectD, rectW, subtractAll, totalArea, type PlanRect } from "./rect";
import { arcBox, arcHitsRect, arcsOverlap, swingArcs, type SwingArc } from "./swing";
import { buildGrid } from "../structure";

const AREA_TOL = 1e-6;

/** Column footprints of storey s (plan). */
export function columnRects(cfg: BuildingConfig, storey: number): PlanRect[] {
  const g = buildGrid(cfg);
  const c = g.columnSize(Math.min(storey, cfg.storeyCount - 1));
  const out: PlanRect[] = [];
  for (const z of g.zs) for (const x of g.xs) out.push({ x0: x - c.width / 2, x1: x + c.width / 2, z0: z - c.depth / 2, z1: z + c.depth / 2 });
  return out;
}

export function checkTiling(plan: FloorPlan): string[] {
  const errs: string[] = [];
  const all = plan.rooms.flatMap((r) => r.rects.map((rc) => ({ id: r.id, rc })));
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      if (overlaps(all[i]!.rc, all[j]!.rc)) errs.push(`rooms overlap: ${all[i]!.id} / ${all[j]!.id}`);
  const sum = totalArea(all.map((a) => a.rc));
  if (Math.abs(sum - rectArea(plan.outline)) > AREA_TOL) errs.push(`rooms cover ${sum.toFixed(4)} m2 of ${rectArea(plan.outline)} m2 floor`);
  for (const apt of plan.apartments) {
    const rooms = plan.rooms.filter((r) => r.aptId === apt.id);
    const roomArea = totalArea(rooms.flatMap((r) => r.rects));
    const env = totalArea(apt.envelope);
    if (Math.abs(roomArea - env) > AREA_TOL) errs.push(`${apt.id}: rooms ${roomArea.toFixed(4)} m2 != envelope ${env.toFixed(4)} m2`);
    for (const r of rooms)
      for (const rc of r.rects)
        if (!apt.envelope.some((e) => contains(e, rc, 1e-9))) errs.push(`${r.id} lies outside the ${apt.id} envelope`);
  }
  return errs;
}

/** Room graph: doors (incl. cased openings) and open boundaries. "EXT" is the outside. */
export function roomGraph(plan: FloorPlan): Map<string, Set<string>> {
  const g = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!g.has(a)) g.set(a, new Set());
    if (!g.has(b)) g.set(b, new Set());
    g.get(a)!.add(b);
    g.get(b)!.add(a);
  };
  for (const r of plan.rooms) if (!g.has(r.id)) g.set(r.id, new Set());
  for (const d of plan.doors) link(d.rooms[0], d.rooms[1]);
  for (const [a, b] of plan.open) link(a, b);
  return g;
}

function reach(g: Map<string, Set<string>>, from: string, allowed?: (id: string) => boolean): Set<string> {
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const n = q.shift()!;
    for (const m of g.get(n) ?? []) {
      if (seen.has(m) || (allowed && !allowed(m))) continue;
      seen.add(m);
      q.push(m);
    }
  }
  return seen;
}

export function checkConnectivity(plan: FloorPlan): string[] {
  const errs: string[] = [];
  const g = roomGraph(plan);
  const byId = new Map(plan.rooms.map((r) => [r.id, r]));
  for (const apt of plan.apartments) {
    const inApt = (id: string) => byId.get(id)?.aptId === apt.id;
    const seen = reach(g, apt.entranceRoom, inApt);
    for (const r of plan.rooms) if (r.aptId === apt.id && !seen.has(r.id)) errs.push(`${r.id} not reachable from ${apt.entranceRoom} through its own doors`);
    if (apt.id !== "CM" && !g.get(apt.entranceRoom)?.has("CM-COR")) errs.push(`${apt.id}: entrance ${apt.entranceRoom} has no door to the corridor`);
  }
  const fromStair = reach(g, "CM-STC");
  for (const r of plan.rooms) if (!fromStair.has(r.id)) errs.push(`${r.id} not reachable from the stair`);
  if (plan.kind === "ground") {
    // Entrance path: outside -> lobby -> corridor -> stair, through common rooms only.
    const common = (id: string) => id === "EXT" || byId.get(id)?.aptId === "CM";
    const path = reach(g, "EXT", common);
    for (const id of ["CM-LOB", "CM-COR", "CM-STC"]) if (!path.has(id)) errs.push(`ground entrance path does not reach ${id}`);
  }
  return errs;
}

/** Exact clear area of a room: its boundary rects minus every wall footprint (disjoint rects). */
export function roomClearArea(room: PlanRoom, bounds: readonly Boundary[], cfg: BuildingConfig): PlanRect[] {
  const walls = bounds.filter((b) => b.kind !== "open").map((b) => wallFootprint(b, cfg));
  return room.rects.flatMap((r) => subtractAll(r, walls));
}

/** Clear rectangles (finished faces) of a room's boundary rects. */
export function roomClearRects(room: PlanRoom, bounds: readonly Boundary[], cfg: BuildingConfig): PlanRect[] {
  return room.rects.map((r) => clearRect(r, room.id, bounds, cfg));
}

export function checkClearDims(plan: FloorPlan, cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG, bounds = floorBoundaries(plan, arch)): string[] {
  const errs: string[] = [];
  const cols = columnRects(cfg, plan.storey);
  const mc = arch.minClear;
  for (const room of plan.rooms) {
    const clears = roomClearRects(room, bounds, cfg);
    const main = clears.reduce((a, b) => (rectArea(b) > rectArea(a) ? b : a));
    const lo = Math.min(rectW(main), rectD(main));
    const hi = Math.max(rectW(main), rectD(main));
    const fail = (what: string) => errs.push(`${room.id} (${room.type}) clear ${rectW(main).toFixed(3)} x ${rectD(main).toFixed(3)}: ${what}`);
    switch (room.type) {
      case "bedroom":
        if (lo < mc.bedroom - 1e-9) fail(`min side < ${mc.bedroom}`);
        break;
      case "kitchen":
        if (lo < mc.kitchen - 1e-9) fail(`min side < ${mc.kitchen}`);
        break;
      case "bathroom":
      case "toilet":
        if (lo < mc.bathroom.min - 1e-9 || hi < mc.bathroom.max - 1e-9) fail(`smaller than ${mc.bathroom.min} x ${mc.bathroom.max}`);
        break;
      case "corridor":
      case "passage": {
        // Narrowest clear width, including columns that protrude past the wall faces.
        const alongX = rectW(main) >= rectD(main);
        let width = alongX ? rectD(main) : rectW(main);
        for (const c of cols) {
          if (!overlaps(c, main)) continue;
          const intoZ = Math.min(c.z1, main.z1) - Math.max(c.z0, main.z0);
          const intoX = Math.min(c.x1, main.x1) - Math.max(c.x0, main.x0);
          width = Math.min(width, alongX ? rectD(main) - intoZ : rectW(main) - intoX);
        }
        if (width < mc.corridor - 1e-9) fail(`clear width ${width.toFixed(3)} < ${mc.corridor}`);
        break;
      }
      default:
        break;
    }
  }
  return errs;
}

export function planArcs(plan: FloorPlan, cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG, bounds = floorBoundaries(plan, arch)): Map<string, SwingArc[]> {
  return new Map(plan.doors.map((d) => [d.key, swingArcs(d, bounds, cfg, arch)]));
}

export function checkSwings(plan: FloorPlan, cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG, bounds = floorBoundaries(plan, arch)): string[] {
  const errs: string[] = [];
  const arcs = planArcs(plan, cfg, arch, bounds);
  const cols = columnRects(cfg, plan.storey);
  const byId = new Map(plan.rooms.map((r) => [r.id, r]));
  for (const d of plan.doors) {
    const room = byId.get(d.swingInto);
    if (!room) {
      errs.push(`${d.key}: swing room ${d.swingInto} missing`);
      continue;
    }
    const area = roomClearArea(room, bounds, cfg);
    for (const a of arcs.get(d.key)!) {
      // The swept square must lie inside the room's clear area (walls excluded exactly).
      if (subtractAll(arcBox(a), area, false, 1e-6).some((r) => rectArea(r) > 1e-8)) errs.push(`${d.key}: swing leaves ${room.id}`);
      for (const c of cols) if (arcHitsRect(a, c)) errs.push(`${d.key}: swing hits a column`);
    }
  }
  const list = [...arcs.values()].flat();
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      if (list[i]!.doorKey !== list[j]!.doorKey && arcsOverlap(list[i]!, list[j]!)) errs.push(`swings overlap: ${list[i]!.doorKey} / ${list[j]!.doorKey}`);
  return errs;
}

/** Plan footprint of an opening (along-interval x wall band) widened by `margin` each side. */
export function openingFootprint(o: { line: PlanDoor["line"]; centre: number; width: number }, host: Boundary, cfg: BuildingConfig, margin: number): PlanRect {
  return wallFootprint(host, cfg, o.centre - o.width / 2 - margin, o.centre + o.width / 2 + margin);
}

export function checkOpeningsFit(plan: FloorPlan, cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG, bounds = floorBoundaries(plan, arch)): string[] {
  const errs: string[] = [];
  const cols = columnRects(cfg, plan.storey);
  const ops = [
    ...plan.doors.map((d) => ({ key: `door ${d.key}`, line: d.line, centre: d.centre, width: d.width, margin: arch.openings.minPier, exterior: false })),
    ...plan.windows.map((w) => ({ key: `window ${w.key}`, line: w.line, centre: w.centre, width: arch.windowTypes[w.typeKey].width, margin: arch.openings.revealWidth + arch.openings.minPier, exterior: true })),
  ];
  const fp: { key: string; r: PlanRect; axis: string; c: number }[] = [];
  for (const o of ops) {
    const host = boundaryAt(bounds, o.line, o.centre - o.width / 2, o.centre + o.width / 2);
    if (!host || host.kind === "open") {
      errs.push(`${o.key}: no wall hosts it`);
      continue;
    }
    if (o.exterior && host.kind !== "exterior") errs.push(`${o.key}: window on a non-exterior wall`);
    const r = openingFootprint(o, host, cfg, o.margin);
    for (const c of cols) if (overlaps(r, c)) errs.push(`${o.key}: runs into a column`);
    for (const b of bounds) {
      if (b === host || b.kind === "open" || b.line.axis === host.line.axis) continue;
      if (overlaps(r, wallFootprint(b, cfg))) errs.push(`${o.key}: runs into a perpendicular wall`);
    }
    fp.push({ key: o.key, r, axis: o.line.axis, c: o.line.c });
  }
  for (let i = 0; i < fp.length; i++)
    for (let j = i + 1; j < fp.length; j++)
      if (fp[i]!.axis === fp[j]!.axis && Math.abs(fp[i]!.c - fp[j]!.c) < EPS && overlaps(fp[i]!.r, fp[j]!.r)) errs.push(`openings too close: ${fp[i]!.key} / ${fp[j]!.key}`);
  return errs;
}

export function validatePlan(plan: FloorPlan, cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): string[] {
  const bounds = floorBoundaries(plan, arch);
  return [
    ...checkTiling(plan),
    ...checkConnectivity(plan),
    ...checkClearDims(plan, cfg, arch, bounds),
    ...checkSwings(plan, cfg, arch, bounds),
    ...checkOpeningsFit(plan, cfg, arch, bounds),
  ];
}
