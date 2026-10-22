/**
 * ReLoop India — Authoritative Building Configuration
 *
 * Single source of truth for all geometric parameters.
 * Units: metres. Coordinate system: Y-up, X = 36 m axis, Z = 30 m axis.
 * Plan origin at building centre. Ground datum y = 0 is top of L0 slab.
 */

// ── Grid labels ──────────────────────────────────────────────────────────────
/** X-axis grid labels: A through G (7 lines, left to right) */
export const GRID_LABELS_X = ["A", "B", "C", "D", "E", "F", "G"] as const;
/** Z-axis grid labels: 1 through 6 (6 lines, front to back) */
export const GRID_LABELS_Z = ["1", "2", "3", "4", "5", "6"] as const;

export type GridLabelX = (typeof GRID_LABELS_X)[number];
export type GridLabelZ = (typeof GRID_LABELS_Z)[number];

// ── Configuration ────────────────────────────────────────────────────────────
export interface BuildingConfig {
  // Footprint
  footprintX: number;
  footprintZ: number;
  gridSpacingX: number;
  gridSpacingZ: number;
  gridCountX: number; // number of grid lines
  gridCountZ: number;

  // Levels
  storeyHeight: number;
  storeyCount: number; // number of occupied floors (G + 4 = 5)
  foundationDepth: number; // depth below y=0 to bottom of footing

  // Structural members (conceptual defaults, not engineered)
  footing: { width: number; depth: number; thickness: number };
  pedestal: { width: number; depth: number; height: number };
  column: { width: number; depth: number };
  /** Per-storey column size override, keyed by storey index (0 = ground storey). */
  columnOverrides: Readonly<Record<number, { width: number; depth: number }>>;
  beam: { width: number; depth: number };
  /** Add plinth/tie beams at L0 (beams then exist at L0..L4 and ROOF). */
  includePlinthBeams: boolean;
  slab: { thickness: number };

  // Core positions (bay indices, 0-based from bottom-left of grid)
  stairBay: { xStart: number; xEnd: number; zStart: number; zEnd: number };
  shaftBay: { xStart: number; xEnd: number; zStart: number; zEnd: number };

  /** Slab openings, centred in their bay. width = X extent, length = Z extent. */
  stairOpening: { width: number; length: number };
  shaftOpening: { width: number; length: number };

  // Stair geometry
  stair: {
    risersPerStorey: number;
    riserHeight: number;
    treadDepth: number;
    width: number; // width of each flight
    landingDepth: number; // landing extent along the flight direction
    flightGap: number; // plan gap between the two flights of a dog-leg
    waistThickness: number; // vertical thickness of the stepped slab below the nosing line
    roofAccess: boolean; // add a L4 -> ROOF flight and a stair opening in the roof slab
  };
}

export const DEFAULT_CONFIG: BuildingConfig = {
  footprintX: 36,
  footprintZ: 30,
  gridSpacingX: 6,
  gridSpacingZ: 6,
  gridCountX: 7,
  gridCountZ: 6,

  storeyHeight: 3.6,
  storeyCount: 5,
  foundationDepth: 1.5,

  footing: { width: 2.0, depth: 2.0, thickness: 0.6 },
  pedestal: { width: 0.6, depth: 0.6, height: 0.9 },
  column: { width: 0.45, depth: 0.45 },
  columnOverrides: {},
  beam: { width: 0.30, depth: 0.50 },
  includePlinthBeams: true,
  slab: { thickness: 0.15 },

  // Bay indices: stair well at grid D-E / 3-4 (indices 3-4 along X, 2-3 along Z)
  stairBay: { xStart: 3, xEnd: 4, zStart: 2, zEnd: 3 },
  // Service shaft at grid E-F / 3-4 (indices 4-5 along X, 2-3 along Z)
  shaftBay: { xStart: 4, xEnd: 5, zStart: 2, zEnd: 3 },

  // Openings are centred in their bay (stair well ~2.8 x 5.4, shaft 1.5 x 1.5)
  stairOpening: { width: 2.8, length: 5.4 },
  shaftOpening: { width: 1.5, length: 1.5 },

  stair: {
    risersPerStorey: 24,
    riserHeight: 0.15,
    treadDepth: 0.28,
    width: 1.2,
    landingDepth: 1.2,
    flightGap: 0.3,
    waistThickness: 0.2,
    roofAccess: false,
  },
};

// ── Derived values ───────────────────────────────────────────────────────────

/** Compute grid line positions along an axis. Centred on origin. */
export function gridPositions(footprint: number, spacing: number, count: number): number[] {
  const half = footprint / 2;
  return Array.from({ length: count }, (_, i) => -half + i * spacing);
}

/** Level names */
export const LEVEL_NAMES = ["L0", "L1", "L2", "L3", "L4", "ROOF"] as const;
export type LevelName = (typeof LEVEL_NAMES)[number];

/** Compute level elevations (top of slab). L0=0, L1=3.6, ... ROOF=18 */
export function levelElevations(cfg: BuildingConfig): Record<LevelName, number> {
  const result = {} as Record<LevelName, number>;
  for (let i = 0; i <= cfg.storeyCount; i++) {
    result[LEVEL_NAMES[i]!] = i * cfg.storeyHeight;
  }
  return result;
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

export function validateConfig(cfg: BuildingConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  const spansX = (cfg.gridCountX - 1) * cfg.gridSpacingX;
  if (Math.abs(spansX - cfg.footprintX) > 1e-6) {
    errors.push({
      field: "gridCountX/gridSpacingX",
      message: `Grid spans X (${spansX}) ≠ footprintX (${cfg.footprintX})`,
    });
  }

  const spansZ = (cfg.gridCountZ - 1) * cfg.gridSpacingZ;
  if (Math.abs(spansZ - cfg.footprintZ) > 1e-6) {
    errors.push({
      field: "gridCountZ/gridSpacingZ",
      message: `Grid spans Z (${spansZ}) ≠ footprintZ (${cfg.footprintZ})`,
    });
  }

  const roofElev = cfg.storeyCount * cfg.storeyHeight;
  if (Math.abs(roofElev - 18.0) > 1e-6) {
    errors.push({
      field: "storeyCount/storeyHeight",
      message: `Roof elevation (${roofElev}) ≠ 18.0 m`,
    });
  }

  // Stair bay inside grid
  const maxBayX = cfg.gridCountX - 1;
  const maxBayZ = cfg.gridCountZ - 1;
  for (const [name, bay] of [
    ["stairBay", cfg.stairBay],
    ["shaftBay", cfg.shaftBay],
  ] as const) {
    if (bay.xStart < 0 || bay.xEnd > maxBayX || bay.zStart < 0 || bay.zEnd > maxBayZ) {
      errors.push({ field: name, message: `${name} outside grid bounds` });
    }
  }

  // Stair/shaft overlap check
  const sb = cfg.stairBay;
  const sh = cfg.shaftBay;
  const xOverlap = sb.xStart < sh.xEnd && sh.xStart < sb.xEnd;
  const zOverlap = sb.zStart < sh.zEnd && sh.zStart < sb.zEnd;
  if (xOverlap && zOverlap) {
    errors.push({ field: "stairBay/shaftBay", message: "Stair and shaft bays overlap" });
  }

  // Stair risers * height = storey height
  const stairTotal = cfg.stair.risersPerStorey * cfg.stair.riserHeight;
  if (Math.abs(stairTotal - cfg.storeyHeight) > 1e-6) {
    errors.push({
      field: "stair",
      message: `Risers × height (${stairTotal}) ≠ storeyHeight (${cfg.storeyHeight})`,
    });
  }

  // Members fit in bay
  if (cfg.column.width > cfg.gridSpacingX || cfg.column.depth > cfg.gridSpacingZ) {
    errors.push({ field: "column", message: "Column larger than bay spacing" });
  }
  if (cfg.footing.width > cfg.gridSpacingX || cfg.footing.depth > cfg.gridSpacingZ) {
    errors.push({ field: "footing", message: "Footing larger than bay spacing" });
  }

  // Foundation stack: footing + pedestal reach exactly from foundation depth to y = 0
  const stack = cfg.footing.thickness + cfg.pedestal.height;
  if (Math.abs(stack - cfg.foundationDepth) > 1e-6) {
    errors.push({
      field: "foundationDepth",
      message: `Footing + pedestal (${stack}) ≠ foundationDepth (${cfg.foundationDepth})`,
    });
  }

  // Beam must be shallower than a storey and the slab must sit within the beam depth
  if (cfg.beam.depth >= cfg.storeyHeight) {
    errors.push({ field: "beam", message: "Beam depth ≥ storey height" });
  }
  if (cfg.slab.thickness > cfg.beam.depth) {
    errors.push({ field: "slab", message: "Slab thicker than beam depth (breaks junction rule)" });
  }

  // Openings: fully inside their bay, clear of beams and of column/pedestal corners
  const widestNode = Math.max(
    cfg.column.width,
    cfg.pedestal.width,
    ...Object.values(cfg.columnOverrides).map((c) => c.width),
  );
  const deepestNode = Math.max(
    cfg.column.depth,
    cfg.pedestal.depth,
    ...Object.values(cfg.columnOverrides).map((c) => c.depth),
  );
  for (const [name, bay, op] of [
    ["stairOpening", cfg.stairBay, cfg.stairOpening],
    ["shaftOpening", cfg.shaftBay, cfg.shaftOpening],
  ] as const) {
    const bayW = (bay.xEnd - bay.xStart) * cfg.gridSpacingX;
    const bayL = (bay.zEnd - bay.zStart) * cfg.gridSpacingZ;
    if (bay.xEnd - bay.xStart !== 1 || bay.zEnd - bay.zStart !== 1) {
      errors.push({ field: name, message: `${name} bay must be a single grid bay` });
      continue;
    }
    const halfW = op.width / 2;
    const halfL = op.length / 2;
    const innerHalfW = bayW / 2 - cfg.beam.width / 2;
    const innerHalfL = bayL / 2 - cfg.beam.width / 2;
    if (halfW > innerHalfW + 1e-9 || halfL > innerHalfL + 1e-9) {
      errors.push({ field: name, message: `${name} reaches the bay beams` });
    }
    // Clear of column corners: must stay out of at least one of the corner bands
    const clearOfCornerX = halfW <= bayW / 2 - widestNode / 2 + 1e-9;
    const clearOfCornerZ = halfL <= bayL / 2 - deepestNode / 2 + 1e-9;
    if (!clearOfCornerX && !clearOfCornerZ) {
      errors.push({ field: name, message: `${name} intersects column corners` });
    }
  }

  // Stair plan must fit inside the stair opening
  const riserCount = cfg.stair.risersPerStorey;
  if (riserCount % 2 !== 0) {
    errors.push({ field: "stair", message: "risersPerStorey must be even (two equal flights)" });
  } else {
    const flightRun = (riserCount / 2 - 1) * cfg.stair.treadDepth;
    const planW = 2 * cfg.stair.width + cfg.stair.flightGap;
    const planL = flightRun + cfg.stair.landingDepth;
    if (planW > cfg.stairOpening.width + 1e-9 || planL > cfg.stairOpening.length + 1e-9) {
      errors.push({
        field: "stair",
        message: `Stair plan ${planW} x ${planL} does not fit opening ${cfg.stairOpening.width} x ${cfg.stairOpening.length}`,
      });
    }
  }

  // Grid label count matches
  if (GRID_LABELS_X.length !== cfg.gridCountX) {
    errors.push({ field: "gridLabelsX", message: "Grid label count X mismatch" });
  }
  if (GRID_LABELS_Z.length !== cfg.gridCountZ) {
    errors.push({ field: "gridLabelsZ", message: "Grid label count Z mismatch" });
  }

  return errors;
}
