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
  beam: { width: number; depth: number };
  slab: { thickness: number };

  // Core positions (bay indices, 0-based from bottom-left of grid)
  stairBay: { xStart: number; xEnd: number; zStart: number; zEnd: number };
  shaftBay: { xStart: number; xEnd: number; zStart: number; zEnd: number };

  // Stair geometry
  stair: {
    risersPerStorey: number;
    riserHeight: number;
    treadDepth: number;
    width: number;
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
  beam: { width: 0.30, depth: 0.50 },
  slab: { thickness: 0.15 },

  // Bay indices: stair well at grid D-E / 3-4 (indices 3-4 along X, 2-3 along Z)
  stairBay: { xStart: 3, xEnd: 4, zStart: 2, zEnd: 3 },
  // Service shaft at grid E-F / 3-4 (indices 4-5 along X, 2-3 along Z)
  shaftBay: { xStart: 4, xEnd: 5, zStart: 2, zEnd: 3 },

  stair: { risersPerStorey: 24, riserHeight: 0.15, treadDepth: 0.28, width: 1.2 },
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

  // Grid label count matches
  if (GRID_LABELS_X.length !== cfg.gridCountX) {
    errors.push({ field: "gridLabelsX", message: "Grid label count X mismatch" });
  }
  if (GRID_LABELS_Z.length !== cfg.gridCountZ) {
    errors.push({ field: "gridLabelsZ", message: "Grid label count Z mismatch" });
  }

  return errors;
}
