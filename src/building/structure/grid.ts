/**
 * ReLoop India — derived grid model.
 *
 * Every coordinate, elevation and node size used by the A1 generators comes from
 * here, which in turn comes from BuildingConfig. No literals live in generators.
 */

import {
  GRID_LABELS_X,
  GRID_LABELS_Z,
  LEVEL_NAMES,
  gridPositions,
  levelElevations,
  type BuildingConfig,
  type LevelName,
} from "../config";
import type { MaterialRef } from "../types";

export const STRUCTURAL_MATERIAL: MaterialRef = {
  id: "rcc_conceptual",
  name: "reinforced concrete (conceptual)",
  densityKgM3: 2400,
};

export interface Level {
  readonly index: number; // 0..storeyCount; storeyCount === ROOF
  readonly name: LevelName;
  readonly elevation: number; // top of slab
}

export interface Size2 {
  readonly width: number; // X extent
  readonly depth: number; // Z extent
}

export interface GridModel {
  readonly cfg: BuildingConfig;
  readonly xs: readonly number[];
  readonly zs: readonly number[];
  readonly levels: readonly Level[];
  readonly spansX: number; // bays along X
  readonly spansZ: number; // bays along Z
  /** Column plan size for storey s (storey s runs from level s to level s+1). */
  columnSize(storey: number): Size2;
  /**
   * Plan size of the vertical member occupying the joint at level i:
   * the pedestal at L0, otherwise the column of the storey below (columns run
   * level-to-level, so that column's top is flush with the level's slab top).
   */
  nodeSize(levelIndex: number): Size2;
  /** True if beams are generated at the level (L0 depends on the plinth flag). */
  hasBeams(levelIndex: number): boolean;
}

export function buildGrid(cfg: BuildingConfig): GridModel {
  const xs = gridPositions(cfg.footprintX, cfg.gridSpacingX, cfg.gridCountX);
  const zs = gridPositions(cfg.footprintZ, cfg.gridSpacingZ, cfg.gridCountZ);
  const elev = levelElevations(cfg);
  const levels: Level[] = [];
  for (let i = 0; i <= cfg.storeyCount; i++) {
    const name = LEVEL_NAMES[i]!;
    levels.push({ index: i, name, elevation: elev[name] });
  }

  const columnSize = (storey: number): Size2 => {
    const c = cfg.columnOverrides[storey] ?? cfg.column;
    return { width: c.width, depth: c.depth };
  };

  return {
    cfg,
    xs,
    zs,
    levels,
    spansX: xs.length - 1,
    spansZ: zs.length - 1,
    columnSize,
    nodeSize: (i) =>
      i === 0
        ? { width: cfg.pedestal.width, depth: cfg.pedestal.depth }
        : columnSize(i - 1),
    hasBeams: (i) => (i === 0 ? cfg.includePlinthBeams : true),
  };
}

/** Grid node label: letter along X, number along Z (A0 convention), e.g. "B2". */
export function nodeLabel(ix: number, iz: number): string {
  return `${GRID_LABELS_X[ix]}${GRID_LABELS_Z[iz]}`;
}

/** Level display name for a level index (L0..L4, ROOF). */
export function levelName(index: number): LevelName {
  return LEVEL_NAMES[index]!;
}

/** Zero-padded panel number, "P01".."P30". */
export function panelTag(n: number): string {
  return `P${String(n).padStart(2, "0")}`;
}
