/**
 * Dog-leg stair — per storey: two flights (FL1 up the low-x side, FL2 back down the
 * high-x side) and one mid-landing (LND).
 *
 * Plan (inside the stair opening, x across, z along the flight direction):
 *
 *   z1 +---------------------------+
 *      |   (unused guard clearance) |
 *      +------------+-------------+      landing: full stair width, landingDepth deep,
 *      |    LND     |    LND      |      top at E_s + storeyHeight/2
 *      +------------+-------------+  zrun = z0 + (N/2 - 1) * tread
 *      |    FL1 ^   |   v FL2     |
 *      |   (up +z)  |  (up -z)    |
 *   z0 +------------+-------------+      arrival edge (opening edge); the floor slab strip
 *                                         beyond z0 receives FL2's top step and starts FL1.
 *
 * Each flight is ONE extruded stepped profile (plane "zy"): sawtooth tread/riser top,
 * sloping soffit one `waistThickness` below the nosing line, clipped at the base level.
 * The N/2-th riser of FL1 reaches the landing top exactly; the N-th riser of FL2
 * reaches the next level exactly.
 */

import { buildComponentId } from "../ids";
import type { ComponentRecord, Point2 } from "./geometry";
import { boxGeometry, makeRecord } from "./record";
import type { GridModel } from "./grid";
import { openingOf } from "./openings";

export interface StairDerived {
  readonly riser: number;
  readonly tread: number;
  readonly risersPerFlight: number;
  readonly treadsPerFlight: number;
  /** Plan length of one flight (nosing of riser 1 to face of riser N/2). */
  readonly run: number;
  readonly landingHeight: number; // rise of one flight == mid-landing height above its storey level
  readonly storeyRise: number;
  readonly planWidth: number;
  readonly planLength: number;
  readonly storeyCount: number; // stair-bearing storeys
}

/** Stair arithmetic, derived from config. Throws if the config is inconsistent. */
export function deriveStair(grid: GridModel): StairDerived {
  const { cfg } = grid;
  const s = cfg.stair;
  const n = s.risersPerStorey;
  if (n % 2 !== 0) throw new Error(`risersPerStorey (${n}) must be even`);
  const rise = n * s.riserHeight;
  if (Math.abs(rise - cfg.storeyHeight) > 1e-9) {
    throw new Error(`Stair rise ${rise} ≠ storeyHeight ${cfg.storeyHeight}`);
  }
  const risersPerFlight = n / 2;
  const treadsPerFlight = risersPerFlight - 1;
  const run = treadsPerFlight * s.treadDepth;
  return {
    riser: s.riserHeight,
    tread: s.treadDepth,
    risersPerFlight,
    treadsPerFlight,
    run,
    landingHeight: risersPerFlight * s.riserHeight,
    storeyRise: rise,
    planWidth: 2 * s.width + s.flightGap,
    planLength: run + s.landingDepth,
    storeyCount: s.roofAccess ? cfg.storeyCount : cfg.storeyCount - 1,
  };
}

export function stairId(storey: number, part: "FL1" | "FL2" | "LND"): string {
  return buildComponentId({ system: "structure", type: "STAIR", floor: storey, location: part });
}

/** FL1 profile in (z, y): y relative to the storey level, z absolute. */
function flightUpProfile(d: StairDerived, z0: number, waist: number): Point2[] {
  const r = d.riser;
  const t = d.tread;
  const y0 = r - waist; // soffit height at z0
  const pts: Point2[] = [[z0, Math.max(y0, 0)]];
  for (let k = 1; k <= d.risersPerFlight; k++) {
    const zk = z0 + (k - 1) * t;
    pts.push([zk, k * r]); // top of riser k
    if (k < d.risersPerFlight) pts.push([zk + t, k * r]); // end of tread k
  }
  const zEnd = z0 + d.run;
  pts.push([zEnd, d.risersPerFlight * r - waist]); // bottom of the end face (soffit)
  if (y0 < 0) pts.push([z0 + ((waist - r) * t) / r, 0]); // soffit meets the base level
  return pts;
}

/** FL2 profile in (z, y): starts at the landing edge zEnd, climbs toward low z, ends at z0. */
function flightDownProfile(d: StairDerived, z0: number, waist: number): Point2[] {
  const r = d.riser;
  const t = d.tread;
  const zStart = z0 + d.run; // landing edge
  const h0 = d.landingHeight;
  const pts: Point2[] = [];
  for (let k = 1; k <= d.risersPerFlight; k++) {
    const zk = zStart - (k - 1) * t;
    pts.push([zk, h0 + k * r]); // top of riser k
    if (k < d.risersPerFlight) pts.push([zk - t, h0 + k * r]); // end of tread k
  }
  pts.push([z0, d.storeyRise - waist]); // bottom of the top end face
  pts.push([zStart, h0 + r - waist]); // soffit start at the landing edge
  return pts;
}

export function generateStairs(grid: GridModel): ComponentRecord[] {
  const { cfg, levels } = grid;
  const d = deriveStair(grid);
  const op = openingOf(grid, "stair");
  const cx = (op.x0 + op.x1) / 2;
  const w = cfg.stair.width;
  const waist = cfg.stair.waistThickness;
  const z0 = op.z0; // stair is set against the low-z opening edge (arrival edge)
  const zMid = z0 + d.run / 2;
  const xFl1 = cx - (cfg.stair.flightGap / 2 + w / 2);
  const xFl2 = cx + (cfg.stair.flightGap / 2 + w / 2);
  const out: ComponentRecord[] = [];

  for (let s = 0; s < d.storeyCount; s++) {
    const base = levels[s]!.elevation;
    const label = `${levels[s]!.name}→${levels[s + 1]!.name}`;
    const landingId = stairId(s, "LND");

    const flights: ReadonlyArray<{ part: "FL1" | "FL2"; x: number; profile: Point2[] }> = [
      { part: "FL1", x: xFl1, profile: flightUpProfile(d, z0, waist) },
      { part: "FL2", x: xFl2, profile: flightDownProfile(d, z0, waist) },
    ];
    for (const f of flights) {
      const local = f.profile.map(([z, y]) => [z - zMid, y] as const);
      const ys = local.map((p) => p[1]);
      out.push(
        makeRecord({
          type: "STAIR",
          location: f.part,
          name: `Stair flight ${f.part === "FL1" ? 1 : 2} ${label}`,
          componentType: "stair_flight",
          floor: s,
          assembly: "stairs",
          position: [f.x, base, zMid],
          geometry: Object.freeze({
            kind: "prism" as const,
            plane: "zy" as const,
            profile: Object.freeze(local),
            extent: w,
          }),
          dimensions: { length: d.run, width: w, height: Math.max(...ys) - Math.min(...ys) },
          dependencies: [landingId],
        }),
      );
    }

    const t = cfg.slab.thickness;
    out.push(
      makeRecord({
        type: "STAIR",
        location: "LND",
        name: `Stair landing ${label}`,
        componentType: "stair_landing",
        floor: s,
        assembly: "stairs",
        position: [cx, base + d.landingHeight - t / 2, z0 + d.run + cfg.stair.landingDepth / 2],
        geometry: boxGeometry(d.planWidth, t, cfg.stair.landingDepth),
        dimensions: { length: d.planWidth, width: cfg.stair.landingDepth, thickness: t },
      }),
    );
  }
  return out;
}
