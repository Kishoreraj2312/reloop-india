import { describe, it, expect } from "vitest";
import type { BufferGeometry } from "three";
import { DEFAULT_CONFIG } from "@/building/config";
import { descriptorVolume, getStructure } from "@/building/structure";
import { GeometryPool, geometryKey } from "./geometryPool";

/** Divergence-theorem volume: equals the true volume only for a closed, outward-wound mesh. */
function signedVolume(g: BufferGeometry): number {
  const pos = g.getAttribute("position");
  const idx = g.getIndex();
  const n = idx ? idx.count : pos.count;
  let vol = 0;
  for (let i = 0; i < n; i += 3) {
    const at = (k: number) => {
      const j = idx ? idx.getX(i + k) : i + k;
      return [pos.getX(j), pos.getY(j), pos.getZ(j)] as const;
    };
    const [a, b, c] = [at(0), at(1), at(2)];
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return vol;
}

describe("geometry pool meshes are closed and outward-wound", () => {
  const records = getStructure(DEFAULT_CONFIG);
  const pool = new GeometryPool();

  it("every unique geometry's signed volume equals its descriptor volume (regression: three r175 ExtrudeGeometry has no caps)", () => {
    const seen = new Set<string>();
    for (const r of records) {
      const key = geometryKey(r.geometry);
      if (seen.has(key)) continue;
      seen.add(key);
      expect(signedVolume(pool.get(r.geometry)), r.id).toBeCloseTo(descriptorVolume(r.geometry), 6);
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it("prism geometry stays inside its record bounds in local space (centred frame)", () => {
    const flight = records.find((r) => r.id === "STR-STAIR-G-FL1")!;
    const g = pool.get(flight.geometry);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.x).toBeCloseTo(-flight.dimensions.width! / 2, 5);
    expect(g.boundingBox!.max.x).toBeCloseTo(flight.dimensions.width! / 2, 5);
    expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeCloseTo(flight.dimensions.length!, 5);
    const slab = records.find((r) => r.id === "STR-SLAB-F01-P01")!;
    const sg = pool.get(slab.geometry);
    sg.computeBoundingBox();
    expect(sg.boundingBox!.max.y - sg.boundingBox!.min.y).toBeCloseTo(DEFAULT_CONFIG.slab.thickness, 5);
  });

  it("shares geometry between identical members", () => {
    const cols = records.filter((r) => r.componentType === "column");
    expect(pool.get(cols[0]!.geometry)).toBe(pool.get(cols[1]!.geometry));
  });
});
