/**
 * Placement space for fixtures in a room (A2 stage 4): what kitchens, bathrooms and
 * utilities must keep clear of, and a wall-relative frame for laying out along a wall.
 *
 * Obstacles: swing arcs of doors opening into the room, an approach zone in front of every
 * door/opening on the room's walls, and columns protruding into the clear area.
 */

import type { InteriorContext, InteriorRoom } from "./interior";
import type { PlanRoom, Side } from "./plan";
import { intersect, type PlanRect } from "./rect";
import { arcBox, arcHitsRect, swingArcs, type SwingArc } from "./swing";

/** Default depth of the approach zone kept clear in front of a door or opening (kitchens). */
export const APPROACH = 0.75;

export interface FixtureSpace {
  readonly room: PlanRoom;
  readonly clear: PlanRect;
  readonly arcs: readonly SwingArc[];
  readonly approach: readonly PlanRect[];
  readonly columns: readonly PlanRect[];
}

export function fixtureSpace(ctx: InteriorContext, ir: InteriorRoom, approachDepth = APPROACH): FixtureSpace {
  const clear = ir.clears.reduce((a, b) => ((b.x1 - b.x0) * (b.z1 - b.z0) > (a.x1 - a.x0) * (a.z1 - a.z0) ? b : a));
  const arcs = ctx.plan.doors.filter((d) => d.swingInto === ir.room.id).flatMap((d) => swingArcs(d, ctx.bounds, ctx.cfg, ctx.arch));
  const approach: PlanRect[] = [];
  for (const side of ["S", "N", "W", "E"] as Side[]) {
    for (const o of ctx.sideOpenings(ir.room.id, clear, side)) {
      if (o.kind === "window") continue;
      approach.push(wallBand(clear, side, o.s0, o.s1, 0, approachDepth));
    }
  }
  return { room: ir.room, clear, arcs, approach, columns: ir.columns };
}

/** True when a plan rectangle is free of every obstacle and inside the clear area. */
export function isFree(sp: FixtureSpace, r: PlanRect, extra: readonly PlanRect[] = []): boolean {
  if (r.x0 < sp.clear.x0 - 1e-9 || r.x1 > sp.clear.x1 + 1e-9 || r.z0 < sp.clear.z0 - 1e-9 || r.z1 > sp.clear.z1 + 1e-9) return false;
  if (sp.arcs.some((a) => arcHitsRect(a, r))) return false;
  return ![...sp.approach, ...sp.columns, ...extra].some((o) => intersect(o, r) !== null);
}

/** Obstacle projections onto a wall band (for trimming runs of cabinets). */
export function blockedAlong(sp: FixtureSpace, band: PlanRect, axis: "x" | "z", extra: readonly PlanRect[] = []): [number, number][] {
  const out: [number, number][] = [];
  for (const o of [...sp.approach, ...sp.columns, ...extra, ...sp.arcs.map(arcBox)]) {
    const i = intersect(o, band);
    if (i) out.push(axis === "x" ? [i.x0, i.x1] : [i.z0, i.z1]);
  }
  return out;
}

/** Along-wall axis for a side and the along range of the clear rect. */
export function sideAxis(side: Side): "x" | "z" {
  return side === "S" || side === "N" ? "x" : "z";
}

export function sideRange(clear: PlanRect, side: Side): [number, number] {
  return sideAxis(side) === "x" ? [clear.x0, clear.x1] : [clear.z0, clear.z1];
}

/** Plan rect against a wall: along [a0, a1], from `d0` to `d1` metres into the room from the wall face. */
export function wallBand(clear: PlanRect, side: Side, a0: number, a1: number, d0: number, d1: number): PlanRect {
  switch (side) {
    case "S":
      return { x0: a0, x1: a1, z0: clear.z0 + d0, z1: clear.z0 + d1 };
    case "N":
      return { x0: a0, x1: a1, z0: clear.z1 - d1, z1: clear.z1 - d0 };
    case "W":
      return { x0: clear.x0 + d0, x1: clear.x0 + d1, z0: a0, z1: a1 };
    case "E":
      return { x0: clear.x1 - d1, x1: clear.x1 - d0, z0: a0, z1: a1 };
  }
}

/** Distance into the room from the wall face of `side` to plan point (x, z). */
export function depthOf(clear: PlanRect, side: Side, x: number, z: number): number {
  return side === "S" ? z - clear.z0 : side === "N" ? clear.z1 - z : side === "W" ? x - clear.x0 : clear.x1 - x;
}

export const OPPOSITE: Readonly<Record<Side, Side>> = { S: "N", N: "S", W: "E", E: "W" };
export const ADJACENT: Readonly<Record<Side, readonly [Side, Side]>> = { S: ["W", "E"], N: ["W", "E"], W: ["S", "N"], E: ["S", "N"] };
