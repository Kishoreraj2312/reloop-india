/**
 * Beams — X-direction and Z-direction, at every level that has beams.
 *
 * A beam at level E occupies y in [E - depth, E] (top flush with slab top), is
 * centred on its gridline and runs between the faces of the joint members at both
 * ends (column faces; pedestal faces at the L0 plinth). Clear length = span - node size.
 */

import { buildComponentId } from "../ids";
import type { ComponentRecord } from "./geometry";
import { nodeLabel, type GridModel } from "./grid";
import { boxGeometry, makeRecord } from "./record";
import { columnId } from "./columns";
import { pedestalId } from "./footings";

export type BeamDirection = "X" | "Z";

function jointMemberId(levelIndex: number, ix: number, iz: number): string {
  return levelIndex === 0 ? pedestalId(ix, iz) : columnId(levelIndex - 1, ix, iz);
}

export function beamId(
  levelIndex: number,
  dir: BeamDirection,
  a: readonly [number, number],
  b: readonly [number, number],
): string {
  return buildComponentId({
    system: "structure",
    type: "BM",
    floor: levelIndex,
    location: `${dir}-${nodeLabel(a[0], a[1])}-${nodeLabel(b[0], b[1])}`,
  });
}

export function generateBeams(grid: GridModel): ComponentRecord[] {
  const { cfg, xs, zs, levels } = grid;
  const { beam } = cfg;
  const out: ComponentRecord[] = [];

  for (const level of levels) {
    if (!grid.hasBeams(level.index)) continue;
    const node = grid.nodeSize(level.index);
    const e = level.elevation;
    const yMid = e - beam.depth / 2;
    const assembly = level.index === cfg.storeyCount ? "roof" : "beams";
    const floor = level.index;

    // X-direction: along each Z gridline, between consecutive X gridlines
    for (let iz = 0; iz < zs.length; iz++) {
      for (let ix = 0; ix < xs.length - 1; ix++) {
        const span = xs[ix + 1]! - xs[ix]!;
        const clear = span - node.width;
        const a = jointMemberId(level.index, ix, iz);
        const b = jointMemberId(level.index, ix + 1, iz);
        out.push(
          makeRecord({
            type: "BM",
            location: `X-${nodeLabel(ix, iz)}-${nodeLabel(ix + 1, iz)}`,
            name: `X-Beam ${nodeLabel(ix, iz)}–${nodeLabel(ix + 1, iz)} @ ${level.name}`,
            componentType: "beam",
            floor,
            assembly,
            position: [(xs[ix]! + xs[ix + 1]!) / 2, yMid, zs[iz]!],
            geometry: boxGeometry(clear, beam.depth, beam.width),
            dimensions: { length: clear, width: beam.width, height: beam.depth },
            dependencies: [a, b],
          }),
        );
      }
    }

    // Z-direction: along each X gridline, between consecutive Z gridlines
    for (let ix = 0; ix < xs.length; ix++) {
      for (let iz = 0; iz < zs.length - 1; iz++) {
        const span = zs[iz + 1]! - zs[iz]!;
        const clear = span - node.depth;
        const a = jointMemberId(level.index, ix, iz);
        const b = jointMemberId(level.index, ix, iz + 1);
        out.push(
          makeRecord({
            type: "BM",
            location: `Z-${nodeLabel(ix, iz)}-${nodeLabel(ix, iz + 1)}`,
            name: `Z-Beam ${nodeLabel(ix, iz)}–${nodeLabel(ix, iz + 1)} @ ${level.name}`,
            componentType: "beam",
            floor,
            assembly,
            position: [xs[ix]!, yMid, (zs[iz]! + zs[iz + 1]!) / 2],
            geometry: boxGeometry(beam.width, beam.depth, clear),
            dimensions: { length: clear, width: beam.width, height: beam.depth },
            dependencies: [a, b],
          }),
        );
      }
    }
  }
  return out;
}

