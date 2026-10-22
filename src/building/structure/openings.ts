/**
 * Slab openings (stair well, service shaft) derived from config.
 * Openings are rectangles centred in their single bay.
 */

import type { GridModel } from "./grid";

export interface Rect {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

export type OpeningKind = "stair" | "shaft";

export interface Opening extends Rect {
  readonly kind: OpeningKind;
  /** Bay index along X / Z (0-based, between gridline i and i+1). */
  readonly bayX: number;
  readonly bayZ: number;
}

export function openingOf(grid: GridModel, kind: OpeningKind): Opening {
  const { cfg, xs, zs } = grid;
  const bay = kind === "stair" ? cfg.stairBay : cfg.shaftBay;
  const size = kind === "stair" ? cfg.stairOpening : cfg.shaftOpening;
  const cx = (xs[bay.xStart]! + xs[bay.xEnd]!) / 2;
  const cz = (zs[bay.zStart]! + zs[bay.zEnd]!) / 2;
  return {
    kind,
    bayX: bay.xStart,
    bayZ: bay.zStart,
    x0: cx - size.width / 2,
    x1: cx + size.width / 2,
    z0: cz - size.length / 2,
    z1: cz + size.length / 2,
  };
}

/**
 * Openings present in the slab at a level.
 * Stair well: L1..L4 (and ROOF only when stair.roofAccess). Shaft: L1..ROOF. L0 is slab-on-grade.
 */
export function openingsAtLevel(grid: GridModel, levelIndex: number): Opening[] {
  const roof = grid.cfg.storeyCount;
  const out: Opening[] = [];
  if (levelIndex >= 1 && (levelIndex < roof || grid.cfg.stair.roofAccess)) {
    out.push(openingOf(grid, "stair"));
  }
  if (levelIndex >= 1) out.push(openingOf(grid, "shaft"));
  return out;
}
