/**
 * Spatial index over records (A3): positive-volume box queries against the actual A1/A2
 * geometry (and MEP items placed so far), used to place stacks, devices and equipment only
 * where the building is really free. Solids come from recordSolids (exact for boxes and
 * plan prisms, conservative bounding boxes otherwise).
 */

import { recordSolids, type Box3, type ComponentRecord } from "../structure";

const CELL = 1.0;
const EPS = 1e-7;

interface Entry {
  readonly r: ComponentRecord;
  readonly solids: readonly Box3[];
}

const cellRange = (b: Box3): [number, number, number, number, number, number] => [
  Math.floor(b.min[0] / CELL),
  Math.floor(b.max[0] / CELL),
  Math.floor(b.min[1] / CELL),
  Math.floor(b.max[1] / CELL),
  Math.floor(b.min[2] / CELL),
  Math.floor(b.max[2] / CELL),
];

export const boxOverlap = (a: Box3, b: Box3, eps = EPS) =>
  Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]) > eps &&
  Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]) > eps &&
  Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]) > eps;

export class SpaceIndex {
  private readonly cells = new Map<string, Entry[]>();

  constructor(records: readonly ComponentRecord[] = []) {
    for (const r of records) this.add(r);
  }

  add(r: ComponentRecord): void {
    if (r.geometry.kind === "group") return;
    const e: Entry = { r, solids: recordSolids(r) };
    for (const s of e.solids) {
      const [i0, i1, j0, j1, k0, k1] = cellRange(s);
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++)
          for (let k = k0; k <= k1; k++) {
            const key = `${i},${j},${k}`;
            let l = this.cells.get(key);
            if (!l) this.cells.set(key, (l = []));
            if (l[l.length - 1] !== e) l.push(e);
          }
    }
  }

  /** Records sharing positive volume with the box (optionally filtered). */
  query(b: Box3, filter?: (r: ComponentRecord) => boolean): ComponentRecord[] {
    const out = new Set<ComponentRecord>();
    const [i0, i1, j0, j1, k0, k1] = cellRange(b);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (let k = k0; k <= k1; k++)
          for (const e of this.cells.get(`${i},${j},${k}`) ?? []) {
            if (out.has(e.r) || (filter && !filter(e.r))) continue;
            if (e.solids.some((s) => boxOverlap(s, b))) out.add(e.r);
          }
    return [...out];
  }

  free(b: Box3, filter?: (r: ComponentRecord) => boolean): boolean {
    return this.query(b, filter).length === 0;
  }
}

export const box3 = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Box3 => ({
  min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
  max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
});
