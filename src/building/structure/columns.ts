/**
 * Column segments — one per grid node per storey.
 *
 * Storey s (0 = ground) runs from level s to level s+1, i.e. y in [E_s, E_{s+1}].
 * The column therefore passes through the beam/slab depth of its top level and its
 * top face is flush with that level's slab top; beams butt against its faces.
 * The ground column starts at y = 0 where the pedestal ends.
 */

import { buildComponentId } from "../ids";
import type { ComponentRecord } from "./geometry";
import { nodeLabel, type GridModel } from "./grid";
import { boxGeometry, makeRecord } from "./record";
import { pedestalId } from "./footings";

export function columnId(storey: number, ix: number, iz: number): string {
  return buildComponentId({
    system: "structure",
    type: "COL",
    floor: storey,
    location: nodeLabel(ix, iz),
  });
}

export function generateColumns(grid: GridModel): ComponentRecord[] {
  const { cfg, xs, zs, levels } = grid;
  const out: ComponentRecord[] = [];

  for (let s = 0; s < cfg.storeyCount; s++) {
    const bottom = levels[s]!.elevation;
    const top = levels[s + 1]!.elevation;
    const height = top - bottom;
    const size = grid.columnSize(s);

    for (let iz = 0; iz < zs.length; iz++) {
      for (let ix = 0; ix < xs.length; ix++) {
        const label = nodeLabel(ix, iz);
        const below = s === 0 ? pedestalId(ix, iz) : columnId(s - 1, ix, iz);
        out.push(
          makeRecord({
            type: "COL",
            location: label,
            name: `Column ${label} (${levels[s]!.name}–${levels[s + 1]!.name})`,
            componentType: "column",
            floor: s,
            assembly: "columns",
            position: [xs[ix]!, bottom + height / 2, zs[iz]!],
            geometry: boxGeometry(size.width, height, size.depth),
            dimensions: { length: size.width, width: size.depth, height },
            parentId: below,
            dependencies: [below],
          }),
        );
      }
    }
  }
  return out;
}
