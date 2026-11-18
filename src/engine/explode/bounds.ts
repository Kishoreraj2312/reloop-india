/**
 * Displayed bounds (A4): canonical bounds translated by the solved offsets. Used for fit-to-exploded, focus-on-selection
 * and the shadow frustum; never read back from the scene.
 */

import { recordBounds, type Box3 } from "@/building/structure";
import type { Cell, ExplodeModel } from "./model";
import type { ExplodeSolver } from "./offsets";
import type { Box } from "./types";

export const emptyBox = (): Box => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
export const isEmptyBox = (b: Box) => b.min[0] > b.max[0];

const addInto = (a: Box, b: Box3, dx: number, dy: number, dz: number, pad = 0) => {
  a.min[0] = Math.min(a.min[0], b.min[0] + dx - pad);
  a.min[1] = Math.min(a.min[1], b.min[1] + dy - pad);
  a.min[2] = Math.min(a.min[2], b.min[2] + dz - pad);
  a.max[0] = Math.max(a.max[0], b.max[0] + dx + pad);
  a.max[1] = Math.max(a.max[1], b.max[1] + dy + pad);
  a.max[2] = Math.max(a.max[2], b.max[2] + dz + pad);
};

/**
 * Union of the displayed bounds of the cells accepted by `visible` (all when omitted). Assembly spread pads the box.
 * Pass `out` to reuse a box (no allocation, for the animation hot path).
 */
export function displayedBounds(model: ExplodeModel, solver: ExplodeSolver, visible?: (c: Cell) => boolean, out: Box = emptyBox()): Box {
  out.min[0] = out.min[1] = out.min[2] = Infinity;
  out.max[0] = out.max[1] = out.max[2] = -Infinity;
  const pad = solver.assemblyActive ? solver.maxAssemblyDisplacement : 0;
  for (const c of model.cells) {
    if (visible && !visible(c)) continue;
    const fs = model.floorSlot.get(c.floor)!;
    const ss = model.systemSlot.get(c.system)!;
    addInto(
      out,
      c.bounds,
      solver.floorOffset[fs * 3]! + solver.systemOffset[ss * 3]!,
      solver.floorOffset[fs * 3 + 1]! + solver.systemOffset[ss * 3 + 1]!,
      solver.floorOffset[fs * 3 + 2]! + solver.systemOffset[ss * 3 + 2]!,
      pad,
    );
  }
  return out;
}

/** Displayed bounds of one component, or of all members of an assembly record. */
export function displayedBoundsOf(model: ExplodeModel, solver: ExplodeSolver, id: string): Box | null {
  const rec = model.byId.get(id);
  if (!rec) return null;
  const ids = rec.geometry.kind === "group" ? (model.assemblyMembers.get(id) ?? []) : [id];
  const out = emptyBox();
  const o = [0, 0, 0];
  for (const i of ids) {
    const r = model.byId.get(i);
    if (!r) continue;
    solver.offsetOf(i, o);
    addInto(out, recordBounds(r), o[0]!, o[1]!, o[2]!);
  }
  return isEmptyBox(out) ? null : out;
}
