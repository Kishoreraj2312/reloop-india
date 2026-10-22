import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "@/building/config";
import { getStructure } from "@/building/structure";
import { boxCorners, centreOf, clipFor, fitDistance, frameBox, unionBounds, viewSpec, type V3 } from "./framing";
import { buildSceneTree, floorKeyOf } from "./sceneTree";
import { geometryKey } from "./geometryPool";

const records = getStructure(DEFAULT_CONFIG);
const box = unionBounds(records);

/** Project a point with a look-at camera; returns NDC x/y and view depth. */
function project(p: V3, pos: V3, target: V3, vfovDeg: number, aspect: number) {
  const f = norm(sub(target, pos));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const rel = sub(p, pos);
  const depth = dot(rel, f);
  const t = Math.tan((vfovDeg * Math.PI) / 360);
  return { x: dot(rel, r) / (depth * t * aspect), y: dot(rel, u) / (depth * t), depth };
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

describe("bounds from records", () => {
  it("cover the full building: 38 x 32 footing extent, -1.5 .. 18", () => {
    expect(box.min[0]).toBeCloseTo(-19, 9); // outer footing edge = 18 + 2.0 / 2
    expect(box.max[0]).toBeCloseTo(19, 9);
    expect(box.min[2]).toBeCloseTo(-16, 9);
    expect(box.max[2]).toBeCloseTo(16, 9);
    expect(box.min[1]).toBeCloseTo(-1.5, 9);
    expect(box.max[1]).toBeCloseTo(18, 9);
  });
});

describe("camera framing", () => {
  for (const aspect of [1.78, 1.0, 0.6]) {
    it(`full view keeps every corner inside the viewport at aspect ${aspect}`, () => {
      const { pose } = viewSpec("full", box, 40, aspect, {
        stair: { centre: [3, 9, 0], halfX: 1.4, halfZ: 2.7 },
        sectionZ: -3,
        stairCutY: 10.2,
      });
      for (const c of boxCorners(box)) {
        const p = project(c, pose.position, pose.target, 40, aspect);
        expect(p.depth).toBeGreaterThan(0);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1 / 1.1 + 1e-9);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1 / 1.1 + 1e-9);
      }
    });
  }

  it("fitDistance is tight: the limiting corner lands exactly on the margin edge", () => {
    const dir: V3 = [0.85, 0.62, 1.0];
    const target = centreOf(box);
    const dist = fitDistance(box, target, dir, 40, 1.78, 1.1);
    const d = norm(dir);
    const pos: V3 = [target[0] + d[0] * dist, target[1] + d[1] * dist, target[2] + d[2] * dist];
    const worst = Math.max(
      ...boxCorners(box).map((c) => {
        const p = project(c, pos, target, 40, 1.78);
        return Math.max(Math.abs(p.x), Math.abs(p.y));
      }),
    );
    expect(worst).toBeCloseTo(1 / 1.1, 6);
  });

  it("top view looks straight down", () => {
    const top = frameBox(box, [0, 1, 0.0005], 40, 1.78);
    expect(Math.abs(top.position[0] - top.target[0])).toBeLessThan(1e-6);
  });

  it("each cutaway view fits its cut volume, and clip planes match the view", () => {
    const ctx = { stair: { centre: [3, 9, 0] as V3, halfX: 1.4, halfZ: 2.7 }, sectionZ: -3, stairCutY: 10.2 };
    expect(clipFor("full", ctx)).toBeUndefined();
    expect(clipFor("top", ctx)).toBeUndefined();
    expect(clipFor("section", ctx)).toEqual({ axis: "z", value: -3 });
    expect(clipFor("stair", ctx)).toEqual({ axis: "y", value: 10.2 });

    const { pose } = viewSpec("stair", box, 40, 1.78, ctx);
    const focus = { min: [3 - 1.4 - 0.6, 0, -2.7 - 0.6] as V3, max: [3 + 1.4 + 0.6, 10.2, 2.7 + 0.6] as V3 };
    for (const c of boxCorners(focus)) {
      const p = project(c, pose.position, pose.target, 40, 1.78);
      expect(p.depth).toBeGreaterThan(0);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
  });
});

describe("scene tree", () => {
  const tree = buildSceneTree(records);

  it("maps floors to groups: foundation, L0..L4, ROOF", () => {
    expect(floorKeyOf(-1)).toBe("FDN");
    expect(floorKeyOf(0)).toBe("L0");
    expect(floorKeyOf(5)).toBe("ROOF");
    expect(tree.map((f) => f.floor)).toEqual(["FDN", "L0", "L1", "L2", "L3", "L4", "ROOF"]);
  });

  it("places every record exactly once", () => {
    const ids = tree.flatMap((f) => f.assemblies.flatMap((a) => a.records.map((r) => r.id)));
    expect(ids).toHaveLength(records.length);
    expect(new Set(ids).size).toBe(records.length);
  });

  it("puts footings in FDN and roof-level beams/slabs in the roof assembly", () => {
    const fdn = tree.find((f) => f.floor === "FDN")!;
    expect(fdn.assemblies.map((a) => a.assembly)).toEqual(["footings"]);
    expect(fdn.assemblies[0]!.records).toHaveLength(84);
    const roof = tree.find((f) => f.floor === "ROOF")!;
    expect(roof.assemblies.map((a) => a.assembly)).toEqual(["roof"]);
    expect(roof.assemblies[0]!.records).toHaveLength(71 + 33);
  });
});

describe("geometry sharing", () => {
  it("identical members share one geometry key", () => {
    const keys = new Set(records.map((r) => geometryKey(r.geometry)));
    expect(keys.size).toBeLessThan(records.length / 10);
    const cols = records.filter((r) => r.componentType === "column");
    expect(new Set(cols.map((r) => geometryKey(r.geometry))).size).toBe(1);
  });
});
