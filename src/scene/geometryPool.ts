/**
 * Shares BufferGeometry between components with identical dimensions.
 *
 * Boxes are keyed by size; prisms by plane + extent + profile. 28 of 36 slab panels on
 * a level, for example, share one geometry. The pool owns the geometries and disposes
 * them on `dispose()`.
 */

import { BufferGeometry, BoxGeometry, CylinderGeometry } from "three";
import type { GeometryDescriptor } from "@/building/structure";
import { buildPrismGeometry } from "./prismGeometry";

const f = (n: number) => (Math.abs(n) < 5e-7 ? 0 : n).toFixed(6);

/** Radial segments for cylinders (pipes, rails, fittings): enough to read as round. */
export const CYLINDER_SEGMENTS = 12;

export function geometryKey(d: GeometryDescriptor): string {
  switch (d.kind) {
    case "box":
      return `box:${d.size.map(f).join("x")}`;
    case "prism":
      return `prism:${d.plane}:${f(d.extent)}:${d.profile.map((p) => `${f(p[0])},${f(p[1])}`).join(";")}`;
    case "cylinder":
      return `cyl:${d.axis}:${f(d.radius)}:${f(d.height)}`;
    case "group":
    case "part":
      throw new Error(`${d.kind} descriptors are not pooled (parts are instanced, scene/mep)`);
  }
}

function buildGeometry(d: GeometryDescriptor): BufferGeometry {
  switch (d.kind) {
    case "box":
      return new BoxGeometry(d.size[0], d.size[1], d.size[2]);
    case "prism":
      return buildPrismGeometry(d);
    case "cylinder": {
      const g = new CylinderGeometry(d.radius, d.radius, d.height, CYLINDER_SEGMENTS);
      if (d.axis === "x") g.rotateZ(Math.PI / 2);
      if (d.axis === "z") g.rotateX(Math.PI / 2);
      return g;
    }
    case "group":
    case "part":
      throw new Error(`${d.kind} descriptors are not pooled (parts are instanced, scene/mep)`);
  }
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
