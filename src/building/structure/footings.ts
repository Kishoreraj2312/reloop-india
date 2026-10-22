/**
 * Footings and pedestals — one pair per grid node.
 *
 * Footing: bottom at -foundationDepth, top at -foundationDepth + thickness.
 * Pedestal: from footing top up to y = 0 (L0 datum), where the ground column begins.
 */

import { buildComponentId } from "../ids";
import { boxGeometry, makeRecord } from "./record";
import type { ComponentRecord } from "./geometry";
import { nodeLabel, type GridModel } from "./grid";

const FOUNDATION_FLOOR = -1;

export function footingId(ix: number, iz: number): string {
  return buildComponentId({
    system: "structure",
    type: "FTG",
    floor: FOUNDATION_FLOOR,
    location: nodeLabel(ix, iz),
  });
}

export function pedestalId(ix: number, iz: number): string {
  return buildComponentId({
    system: "structure",
    type: "PED",
    floor: FOUNDATION_FLOOR,
    location: nodeLabel(ix, iz),
  });
}

export function generateFoundations(grid: GridModel): ComponentRecord[] {
  const { cfg, xs, zs } = grid;
  const { footing, pedestal } = cfg;
  const footingBottom = -cfg.foundationDepth;
  const footingTop = footingBottom + footing.thickness;
  const footings: ComponentRecord[] = [];
  const pedestals: ComponentRecord[] = [];

  for (let iz = 0; iz < zs.length; iz++) {
    for (let ix = 0; ix < xs.length; ix++) {
      const x = xs[ix]!;
      const z = zs[iz]!;
      const label = nodeLabel(ix, iz);

      footings.push(
        makeRecord({
          type: "FTG",
          location: label,
          name: `Footing ${label}`,
          componentType: "footing",
          floor: FOUNDATION_FLOOR,
          assembly: "footings",
          position: [x, footingBottom + footing.thickness / 2, z],
          geometry: boxGeometry(footing.width, footing.thickness, footing.depth),
          dimensions: { length: footing.width, width: footing.depth, height: footing.thickness },
        }),
      );

      pedestals.push(
        makeRecord({
          type: "PED",
          location: label,
          name: `Pedestal ${label}`,
          componentType: "pedestal",
          floor: FOUNDATION_FLOOR,
          assembly: "footings",
          position: [x, footingTop + pedestal.height / 2, z],
          geometry: boxGeometry(pedestal.width, pedestal.height, pedestal.depth),
          dimensions: { length: pedestal.width, width: pedestal.depth, height: pedestal.height },
          parentId: footingId(ix, iz),
          dependencies: [footingId(ix, iz)],
        }),
      );
    }
  }
  return [...footings, ...pedestals];
}
