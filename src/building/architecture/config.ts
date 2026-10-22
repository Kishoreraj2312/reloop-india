/**
 * ReLoop India — Architecture configuration (A2).
 *
 * Single source of truth for every architectural convention. Generators read sizes from
 * here and elevations from the building config (via `archDatums`); they hold no literals.
 * All values are conceptual planning assumptions (see DECISIONS_AND_ASSUMPTIONS.md), not
 * code-compliant design values.
 */

import type { BuildingConfig } from "../config";

export type DoorTypeKey = "D" | "MD" | "BD" | "SD" | "RD" | "ED" | "OP";
export type WindowTypeKey = "W1" | "W2" | "W3" | "W4" | "V1" | "SL";

export interface DoorType {
  readonly width: number; // structural opening width (m)
  readonly height: number; // head above FFL
  readonly leaves: 0 | 1 | 2; // 0 = cased opening, no door assembly
  readonly leafMaterial: string;
  readonly glazed: boolean;
}

/** casement: outer frame + mullions + side-hung sashes; sliding: two tracks; fixed-top: single top-hung sash. */
export type WindowStyle = "casement" | "sliding" | "tophung";

export interface WindowType {
  readonly width: number;
  readonly height: number;
  readonly sill: number; // above FFL; head = sill + height
  readonly style: WindowStyle;
  readonly panes: number; // sashes across the width
}

export interface ArchitectureConfig {
  readonly datums: {
    /** FFL = slab top + floorBuildUp (screed + tile). */
    readonly floorBuildUp: number;
    readonly screed: number;
    readonly tile: number;
    /** Finished ceiling above FFL. */
    readonly ceilingAboveFFL: number;
    /** Finished site grade relative to the L0 slab top (y = 0). */
    readonly siteGrade: number;
  };
  readonly walls: { readonly exterior: number; readonly partition: number; readonly core: number };
  readonly openings: {
    readonly revealDepth: number; // window frame set back from the wall's outer face
    readonly revealWidth: number; // jamb return piece width along the wall
    readonly lintelDepth: number; // lintel band height above the head
    readonly fitTolerance: number; // gap between an assembly and its opening, each side
    readonly stoneSill: { readonly thickness: number; readonly projection: number };
    readonly minPier: number; // smallest solid wall piece kept beside an opening
  };
  readonly doorTypes: Readonly<Record<DoorTypeKey, DoorType>>;
  readonly windowTypes: Readonly<Record<WindowTypeKey, WindowType>>;
  readonly frames: {
    readonly window: {
      readonly frame: number; // outer frame face width
      readonly frameDepth: number;
      readonly sash: number; // sash member face width
      readonly sashDepth: number;
      readonly mullion: number;
      readonly glass: number;
      readonly trackOffset: number; // depth offset between sliding tracks
    };
    readonly door: {
      readonly jamb: number; // frame face width
      readonly jambDepthMax: number; // frame depth, capped by wall thickness
      readonly leafThickness: number;
      readonly leafGap: number; // gap leaf-to-frame
      readonly floorGap: number; // gap leaf-to-FFL
      readonly handleHeight: number; // above FFL
      readonly hinge: { readonly height: number; readonly width: number; readonly depth: number; readonly count: number };
      readonly glazedStile: number; // stile/rail width on glazed leaves
    };
  };
  readonly floor: {
    readonly tileModule: number;
    readonly wetTileModule: number;
    readonly grout: number;
    readonly skirting: { readonly height: number; readonly thickness: number };
    readonly threshold: { readonly overhang: number };
  };
  readonly ceiling: {
    readonly board: number; // board thickness
    readonly shadowGap: number; // gap to walls / columns (no coplanar contact)
    readonly maxPanel: number; // panel group module (m)
    readonly cove: { readonly width: number; readonly drop: number }; // perimeter cove band
  };
  readonly tiling: {
    readonly thickness: number;
    readonly wetDadoHeight: number; // above FFL
    readonly backsplash: { readonly bottom: number; readonly top: number };
  };
  readonly balcony: {
    readonly depth: number; // projection beyond the wall face
    readonly slabThickness: number;
    readonly finish: number; // balcony finish (sits 15 mm below room FFL)
    readonly soffit: number;
    readonly kerb: { readonly height: number; readonly width: number };
    readonly railing: {
      readonly height: number; // top of handrail above balcony finish
      readonly post: number;
      readonly postSpacingMax: number;
      readonly baluster: number;
      readonly balusterSpacing: number; // centre to centre
      readonly handrail: { readonly width: number; readonly depth: number };
      readonly bottomRail: number;
    };
    readonly outlet: { readonly radius: number; readonly length: number };
  };
  readonly facade: {
    readonly fin: { readonly thickness: number; readonly depth: number };
    readonly band: { readonly projection: number }; // floor bands and column cladding (flush frame grid)
    /** Window sunshade (chajja) over exterior windows: projection, thickness, overhang past the opening. */
    readonly sunshade: { readonly depth: number; readonly thickness: number; readonly overhang: number };
    readonly plinth: { readonly thickness: number; readonly module: number; readonly capHeight: number };
    /** Rainwater pipes on the gables, `inset` from the facade gridlines; standoff clears the floor bands. */
    readonly downpipe: { readonly radius: number; readonly standoff: number; readonly inset: number; readonly bottom: number };
    readonly numberPanel: { readonly width: number; readonly height: number; readonly depth: number; readonly centreAboveFFL: number };
    readonly wallLight: { readonly width: number; readonly height: number; readonly depth: number; readonly centreAboveFFL: number };
  };
  readonly entrance: {
    /** Risers from site grade to FFL (riser height is derived: (FFL - grade) / risers). */
    readonly risers: number;
    readonly tread: number;
    readonly landingDepth: number;
    readonly width: number;
    readonly canopy: { readonly depth: number; readonly thickness: number; readonly underside: number }; // underside above FFL
  };
  readonly roof: {
    readonly finish: number; // waterproofing + screed + tile
    readonly parapetHeight: number; // above roof finish
    readonly coping: { readonly thickness: number; readonly overhang: number };
    readonly enclosure: { readonly height: number; readonly slab: number; readonly slabOverhang: number; readonly southZ: number };
    readonly outlet: { readonly radius: number };
  };
  readonly stairFinish: {
    readonly tread: number; // tread finish thickness (== floorBuildUp keeps riser arithmetic)
    readonly riser: number; // riser lining thickness
    readonly balustradeHeight: number;
    readonly baluster: number;
    readonly handrailRadius: number;
    readonly dadoHeight: number; // stairwell wall finish height above FFL
  };
  /** Minimum clear room dimensions (planning assumptions, not code values). */
  readonly minClear: {
    readonly bedroom: number;
    readonly kitchen: number;
    readonly bathroom: { readonly min: number; readonly max: number };
    readonly corridor: number; // also apartment passages
  };
  readonly fixtures: {
    readonly downlightRadius: number;
    readonly surfaceLight: { readonly radius: number; readonly height: number };
  };
}

export const ARCH_CONFIG: ArchitectureConfig = {
  datums: { floorBuildUp: 0.05, screed: 0.04, tile: 0.01, ceilingAboveFFL: 2.8, siteGrade: -0.45 },
  walls: { exterior: 0.23, partition: 0.115, core: 0.23 },
  openings: {
    revealDepth: 0.115,
    revealWidth: 0.05,
    lintelDepth: 0.15,
    fitTolerance: 0.005,
    stoneSill: { thickness: 0.03, projection: 0.03 },
    minPier: 0.05,
  },
  doorTypes: {
    D: { width: 0.9, height: 2.1, leaves: 1, leafMaterial: "timber_door_light", glazed: false },
    MD: { width: 1.05, height: 2.1, leaves: 1, leafMaterial: "timber_door_teak", glazed: false },
    BD: { width: 0.75, height: 2.1, leaves: 1, leafMaterial: "laminate_door_wet", glazed: false },
    SD: { width: 0.75, height: 2.1, leaves: 1, leafMaterial: "metal_frame", glazed: false },
    RD: { width: 0.9, height: 2.1, leaves: 1, leafMaterial: "metal_frame", glazed: false },
    ED: { width: 1.8, height: 2.4, leaves: 2, leafMaterial: "metal_frame", glazed: true },
    OP: { width: 2.8, height: 2.1, leaves: 0, leafMaterial: "", glazed: false },
  },
  windowTypes: {
    W1: { width: 1.5, height: 1.2, sill: 0.9, style: "casement", panes: 2 },
    W2: { width: 1.2, height: 1.2, sill: 0.9, style: "casement", panes: 2 },
    W3: { width: 2.4, height: 1.2, sill: 0.9, style: "casement", panes: 3 },
    W4: { width: 0.9, height: 1.2, sill: 0.9, style: "casement", panes: 1 },
    V1: { width: 0.6, height: 0.45, sill: 1.65, style: "tophung", panes: 1 },
    SL: { width: 2.4, height: 2.1, sill: 0, style: "sliding", panes: 2 },
  },
  frames: {
    window: { frame: 0.06, frameDepth: 0.07, sash: 0.045, sashDepth: 0.03, mullion: 0.06, glass: 0.006, trackOffset: 0.032 },
    door: {
      jamb: 0.05,
      jambDepthMax: 0.1,
      leafThickness: 0.035,
      leafGap: 0.003,
      floorGap: 0.008,
      handleHeight: 1.0,
      hinge: { height: 0.1, width: 0.012, depth: 0.03, count: 3 },
      glazedStile: 0.08,
    },
  },
  floor: {
    tileModule: 0.6,
    wetTileModule: 0.3,
    grout: 0.003,
    skirting: { height: 0.1, thickness: 0.012 },
    threshold: { overhang: 0.0 },
  },
  ceiling: { board: 0.0125, shadowGap: 0.005, maxPanel: 2.4, cove: { width: 0.3, drop: 0.1 } },
  tiling: { thickness: 0.008, wetDadoHeight: 2.1, backsplash: { bottom: 0.9, top: 1.5 } },
  balcony: {
    depth: 1.5,
    slabThickness: 0.15,
    finish: 0.035,
    soffit: 0.012,
    kerb: { height: 0.1, width: 0.1 },
    railing: {
      height: 1.05,
      post: 0.05,
      postSpacingMax: 1.5,
      baluster: 0.02,
      balusterSpacing: 0.12,
      handrail: { width: 0.06, depth: 0.04 },
      bottomRail: 0.04,
    },
    outlet: { radius: 0.025, length: 0.15 },
  },
  facade: {
    fin: { thickness: 0.2, depth: 0.6 },
    band: { projection: 0.05 },
    sunshade: { depth: 0.45, thickness: 0.075, overhang: 0.1 },
    plinth: { thickness: 0.03, module: 0.6, capHeight: 0.05 },
    downpipe: { radius: 0.05, standoff: 0.06, inset: 0.6, bottom: 0.15 },
    numberPanel: { width: 0.16, height: 0.5, depth: 0.015, centreAboveFFL: 1.9 },
    wallLight: { width: 0.12, height: 0.25, depth: 0.1, centreAboveFFL: 2.3 },
  },
  entrance: {
    risers: 3,
    tread: 0.3,
    landingDepth: 1.5,
    width: 3.6,
    canopy: { depth: 2.0, thickness: 0.15, underside: 2.7 },
  },
  roof: {
    finish: 0.05,
    parapetHeight: 1.0,
    coping: { thickness: 0.05, overhang: 0.03 },
    enclosure: { height: 2.7, slab: 0.12, slabOverhang: 0.15, southZ: -4.8 },
    outlet: { radius: 0.06 },
  },
  stairFinish: { tread: 0.05, riser: 0.015, balustradeHeight: 0.9, baluster: 0.02, handrailRadius: 0.025, dadoHeight: 1.2 },
  minClear: { bedroom: 2.8, kitchen: 2.0, bathroom: { min: 1.2, max: 1.8 }, corridor: 1.2 },
  fixtures: { downlightRadius: 0.06, surfaceLight: { radius: 0.18, height: 0.06 } },
};

// ── Derived datums (all elevations come from the building config) ────────────

export interface ArchDatums {
  /** Slab top of level i. */
  slabTop(level: number): number;
  /** Finished floor level of level i (slab top + build-up). */
  ffl(level: number): number;
  /** Top of masonry in storey s: soffit of the beams of level s+1. */
  wallTop(storey: number): number;
  /** Underside of the finished ceiling in storey s. */
  ceiling(storey: number): number;
  /** Masonry clear height (slab top to beam soffit). */
  readonly clearHeight: number;
}

export function archDatums(cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): ArchDatums {
  const slabTop = (i: number) => i * cfg.storeyHeight;
  return {
    slabTop,
    ffl: (i) => slabTop(i) + arch.datums.floorBuildUp,
    wallTop: (s) => slabTop(s + 1) - cfg.beam.depth,
    ceiling: (s) => slabTop(s) + arch.datums.floorBuildUp + arch.datums.ceilingAboveFFL,
    clearHeight: cfg.storeyHeight - cfg.beam.depth,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface ArchValidationError {
  readonly field: string;
  readonly message: string;
}

/** Checks the conventions against each other and against the structural config. */
export function validateArchConfig(cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): ArchValidationError[] {
  const errors: ArchValidationError[] = [];
  const d = arch.datums;
  const clear = cfg.storeyHeight - cfg.beam.depth;
  const push = (field: string, message: string) => errors.push({ field, message });

  if (Math.abs(d.screed + d.tile - d.floorBuildUp) > 1e-9) push("datums", "screed + tile must equal the floor build-up");
  if (d.floorBuildUp + d.ceilingAboveFFL + arch.ceiling.board > clear)
    push("datums", "finished ceiling is above the beam soffit");
  for (const [k, w] of Object.entries(arch.walls)) {
    if (w > cfg.beam.width + 1e-9) push(`walls.${k}`, "wall thicker than the beam it sits under");
  }
  if (arch.walls.exterior > cfg.column.width / 2 + cfg.beam.width / 2)
    push("walls.exterior", "exterior wall would reach past the beam inner face");

  for (const [k, t] of Object.entries(arch.doorTypes)) {
    const head = d.floorBuildUp + t.height + arch.openings.lintelDepth;
    if (head > clear + 1e-9) push(`doorTypes.${k}`, `door head + lintel (${head.toFixed(3)}) above clear height ${clear}`);
    if (t.height >= d.ceilingAboveFFL && t.leaves > 0 && k !== "ED") push(`doorTypes.${k}`, "door head above ceiling");
  }
  for (const [k, t] of Object.entries(arch.windowTypes)) {
    const head = d.floorBuildUp + t.sill + t.height;
    if (head + arch.openings.lintelDepth > clear + 1e-9) push(`windowTypes.${k}`, "window head + lintel above clear height");
    if (t.sill + t.height > d.ceilingAboveFFL) push(`windowTypes.${k}`, "window head above ceiling");
  }
  if (arch.doorTypes.OP.width !== cfg.stairOpening.width)
    push("doorTypes.OP", "stair entry opening must match the A1 stair opening width");
  if (Math.abs(arch.stairFinish.tread - d.floorBuildUp) > 1e-9)
    push("stairFinish.tread", "tread finish must equal the floor build-up or risers change (see stair finish rule)");
  if (arch.balcony.finish >= d.floorBuildUp) push("balcony.finish", "balcony finish must sit below room FFL");
  const entranceRiser = (d.floorBuildUp - d.siteGrade) / arch.entrance.risers;
  if (entranceRiser > 0.175 || entranceRiser < 0.1) push("entrance.risers", `entrance riser ${entranceRiser.toFixed(3)} outside 0.10..0.175`);
  return errors;
}
