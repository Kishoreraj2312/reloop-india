/**
 * Slab panels — one component per bay (or per piece, for bays with an opening).
 *
 * Panel region R = bay inset to the beam inner faces (slab top at E, so the slab
 * sits inside the beam depth envelope). The joint members (columns, pedestals at
 * L0) are wider than the beams, so each panel corner that touches a joint is
 * notched around it; panels are therefore rectilinear polygons (rectangles with up
 * to four corner notches), extruded by the slab thickness. No CSG is used.
 *
 * A bay with an opening is split into at most four rectangles around it:
 *   W (low-x side), E (high-x side), S (low-z strip), N (high-z strip).
 */

import { buildComponentId } from "../ids";
import type { ComponentRecord, Point2 } from "./geometry";
import { nodeLabel, panelTag, type GridModel } from "./grid";
import { makeRecord } from "./record";
import { beamId } from "./beams";
import type { Opening, Rect } from "./openings";
import { openingsAtLevel } from "./openings";

const EPS = 1e-9;

export function slabId(levelIndex: number, bayNumber: number, piece?: string): string {
  return buildComponentId({
    system: "structure",
    type: "SLAB",
    floor: levelIndex,
    location: piece ? `${panelTag(bayNumber)}-${piece}` : panelTag(bayNumber),
  });
}

/** 1-based bay number, row-major with X fastest: P01 = (bayX 0, bayZ 0). */
export function bayNumber(grid: GridModel, bayX: number, bayZ: number): number {
  return bayZ * grid.spansX + bayX + 1;
}

interface Piece {
  readonly suffix: string | undefined;
  readonly rect: Rect;
}

/** Split R around one opening into the minimal set of surrounding rectangles. */
function splitAround(r: Rect, o: Opening | undefined): Piece[] {
  if (!o) return [{ suffix: undefined, rect: r }];
  const candidates: Piece[] = [
    { suffix: "W", rect: { x0: r.x0, z0: r.z0, x1: o.x0, z1: r.z1 } },
    { suffix: "E", rect: { x0: o.x1, z0: r.z0, x1: r.x1, z1: r.z1 } },
    { suffix: "S", rect: { x0: o.x0, z0: r.z0, x1: o.x1, z1: o.z0 } },
    { suffix: "N", rect: { x0: o.x0, z0: o.z1, x1: o.x1, z1: r.z1 } },
  ];
  return candidates.filter((p) => p.rect.x1 - p.rect.x0 > EPS && p.rect.z1 - p.rect.z0 > EPS);
}

/**
 * Polygon (x, z) for a piece: its rectangle with a corner notch wherever that corner
 * coincides with a corner of the bay region R (where a joint member protrudes).
 * Points are counter-clockwise in the (x right, z up) plane.
 */
function notchedPolygon(p: Rect, r: Rect, nx: number, nz: number): Point2[] {
  const at = (a: number, b: number) => Math.abs(a - b) < EPS;
  const ll = nx > EPS && nz > EPS && at(p.x0, r.x0) && at(p.z0, r.z0);
  const lr = nx > EPS && nz > EPS && at(p.x1, r.x1) && at(p.z0, r.z0);
  const ur = nx > EPS && nz > EPS && at(p.x1, r.x1) && at(p.z1, r.z1);
  const ul = nx > EPS && nz > EPS && at(p.x0, r.x0) && at(p.z1, r.z1);
  const { x0, z0, x1, z1 } = p;
  const pts: Point2[] = [];
  if (ll) pts.push([x0, z0 + nz], [x0 + nx, z0 + nz], [x0 + nx, z0]);
  else pts.push([x0, z0]);
  if (lr) pts.push([x1 - nx, z0], [x1 - nx, z0 + nz], [x1, z0 + nz]);
  else pts.push([x1, z0]);
  if (ur) pts.push([x1, z1 - nz], [x1 - nx, z1 - nz], [x1 - nx, z1]);
  else pts.push([x1, z1]);
  if (ul) pts.push([x0 + nx, z1], [x0 + nx, z1 - nz], [x0, z1 - nz]);
  else pts.push([x0, z1]);
  return pts;
}

export function generateSlabs(grid: GridModel): ComponentRecord[] {
  const { cfg, xs, zs, levels } = grid;
  const t = cfg.slab.thickness;
  const out: ComponentRecord[] = [];

  for (const level of levels) {
    const node = grid.nodeSize(level.index);
    const beams = grid.hasBeams(level.index);
    // Inset from the gridline to the supporting face; without beams, to the joint face.
    const inset = beams ? cfg.beam.width / 2 : 0;
    const nx = node.width / 2 - inset; // notch size along X
    const nz = node.depth / 2 - inset; // notch size along Z
    const openings = openingsAtLevel(grid, level.index);
    const assembly = level.index === cfg.storeyCount ? "roof" : "slabs";

    for (let bz = 0; bz < grid.spansZ; bz++) {
      for (let bx = 0; bx < grid.spansX; bx++) {
        const region: Rect = {
          x0: xs[bx]! + inset,
          x1: xs[bx + 1]! - inset,
          z0: zs[bz]! + inset,
          z1: zs[bz + 1]! - inset,
        };
        const opening = openings.find((o) => o.bayX === bx && o.bayZ === bz);
        const n = bayNumber(grid, bx, bz);

        const supports: string[] = beams
          ? [
              beamId(level.index, "X", [bx, bz], [bx + 1, bz]),
              beamId(level.index, "X", [bx, bz + 1], [bx + 1, bz + 1]),
              beamId(level.index, "Z", [bx, bz], [bx, bz + 1]),
              beamId(level.index, "Z", [bx + 1, bz], [bx + 1, bz + 1]),
            ]
          : [];

        for (const piece of splitAround(region, opening)) {
          const rc = piece.rect;
          const cx = (rc.x0 + rc.x1) / 2;
          const cz = (rc.z0 + rc.z1) / 2;
          const polygon = notchedPolygon(rc, region, nx, nz).map(
            ([x, z]) => [x - cx, z - cz] as const,
          );
          const sx = rc.x1 - rc.x0;
          const sz = rc.z1 - rc.z0;
          const label = piece.suffix ? `${panelTag(n)}-${piece.suffix}` : panelTag(n);
          out.push(
            makeRecord({
              type: "SLAB",
              location: label,
              name: `Slab panel ${label} @ ${level.name} (bay ${nodeLabel(bx, bz)}–${nodeLabel(bx + 1, bz + 1)})`,
              componentType: "slab",
              floor: level.index,
              assembly,
              position: [cx, level.elevation - t / 2, cz],
              geometry: Object.freeze({
                kind: "prism" as const,
                plane: "xz" as const,
                profile: Object.freeze(polygon),
                extent: t,
              }),
              dimensions: { length: sx, width: sz, thickness: t },
              dependencies: supports,
            }),
          );
        }
      }
    }
  }
  return out;
}
