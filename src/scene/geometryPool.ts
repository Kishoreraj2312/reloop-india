/**
 * Shares BufferGeometry between components with identical dimensions.
 *
 * Boxes are keyed by size; prisms by plane + extent + profile. 28 of 36 slab panels on
 * a level, for example, share one geometry. The pool owns the geometries and disposes
 * them on `dispose()`.
 */

import { BufferGeometry, BoxGeometry } from "three";
import type { GeometryDescriptor } from "@/building/structure";
import { buildPrismGeometry } from "./prismGeometry";

const f = (n: number) => (Math.abs(n) < 5e-7 ? 0 : n).toFixed(6);

export function geometryKey(d: GeometryDescriptor): string {
  if (d.kind === "box") return `box:${d.size.map(f).join("x")}`;
  return `prism:${d.plane}:${f(d.extent)}:${d.profile.map((p) => `${f(p[0])},${f(p[1])}`).join(";")}`;
}

function buildGeometry(d: GeometryDescriptor): BufferGeometry {
  if (d.kind === "box") return new BoxGeometry(d.size[0], d.size[1], d.size[2]);
  return buildPrismGeometry(d);
}

export class GeometryPool {
  private readonly cache = new Map<string, BufferGeometry>();

  get(d: GeometryDescriptor): BufferGeometry {
    const key = geometryKey(d);
    let g = this.cache.get(key);
    if (!g) {
      g = buildGeometry(d);
      this.cache.set(key, g);
    }
    return g;
  }

  get size(): number {
    return this.cache.size;
  }

  dispose(): void {
    for (const g of this.cache.values()) g.dispose();
    this.cache.clear();
  }
}
