import { describe, it, expect } from "vitest";
import { recordBounds, type ComponentRecord } from "@/building/structure";
import { eulerFromBasis, placeLocal, type V3 } from "./geom";
import { buildTree, legsOk, routeOrtho, segBlocked } from "./router";
import { MepDrafts } from "./record";
import { Net, type RunSpec } from "./net";

const rec = (size: V3, rotation: V3): ComponentRecord =>
  ({ geometry: { kind: "part", part: "x", size, fill: 1 }, originalPosition: [0, 0, 0], originalRotation: rotation }) as unknown as ComponentRecord;

describe("geometry helpers", () => {
  it("eulerFromBasis reproduces the basis (checked through recordBounds)", () => {
    const axes: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const ex of axes)
      for (const ey of axes) {
        if (Math.abs(ex[0] * ey[0] + ex[1] * ey[1] + ex[2] * ey[2]) > 0.5) continue;
        const b = recordBounds(rec([1, 2, 3], eulerFromBasis(ex, ey)));
        const ext = [0, 1, 2].map((k) => b.max[k]! - b.min[k]!);
        // local X (1) lies along ex, local Y (2) along ey
        const kx = ex.findIndex((v) => v !== 0);
        const ky = ey.findIndex((v) => v !== 0);
        expect(ext[kx]).toBeCloseTo(1, 9);
        expect(ext[ky]).toBeCloseTo(2, 9);
        expect(ext[3 - kx - ky]).toBeCloseTo(3, 9);
      }
  });

  it("placeLocal puts an offset local box where the basis says", () => {
    // Local box x in [0, 2] along world -Z, y in [0, 1] along world +Y
    const pl = placeLocal([5, 0, 5], [0, 0, -1], [0, 1, 0], [0, 0, -0.5], [2, 1, 0.5]);
    const b = recordBounds(rec(pl.size, pl.rotation) as ComponentRecord);
    const c = pl.position;
    expect(c[2]).toBeCloseTo(4, 9);
    expect(c[1]).toBeCloseTo(0.5, 9);
    expect(b.max[2] - b.min[2]).toBeCloseTo(2, 9);
  });
});

describe("plan router", () => {
  const obstacle = { x0: 1, x1: 2, z0: -1, z1: 1 };
  it("routes straight when clear and around an obstacle otherwise", () => {
    expect(routeOrtho([0, 2], [3, 2], [obstacle], { half: 0.05 })).toEqual([[0, 2], [3, 2]]);
    const p = routeOrtho([0, 0], [3, 0], [obstacle], { half: 0.05 })!;
    expect(p.length).toBeGreaterThan(2);
    for (let i = 0; i + 1 < p.length; i++) expect(segBlocked(p[i]!, p[i + 1]!, 0.05, [obstacle])).toBe(false);
  });
  it("respects the allowed region", () => {
    const region = [{ x0: -1, x1: 4, z0: -0.5, z1: 3 }];
    const p = routeOrtho([0, 0], [3, 0], [obstacle], { half: 0.05, region })!;
    expect(p.every(([, z]) => z >= -0.5 && z <= 3)).toBe(true);
  });
  it("legsOk accepts elbows and tees, rejects crosses and three-axis corners", () => {
    expect(legsOk([[1, 0, 0], [0, 0, 1]])).toBe(true);
    expect(legsOk([[1, 0, 0], [-1, 0, 0], [0, -1, 0]])).toBe(true);
    expect(legsOk([[1, 0, 0], [0, 0, 1], [0, -1, 0]])).toBe(false);
    expect(legsOk([[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]])).toBe(false);
  });
  it("buildTree connects every terminal with valid joints", () => {
    const terms = [
      { key: "a", p: [4, 1] as const, legs: [[0, -1, 0]] as V3[] },
      { key: "b", p: [4, -1] as const, legs: [[0, -1, 0]] as V3[] },
      { key: "c", p: [2, 3] as const, legs: [[0, -1, 0]] as V3[] },
    ];
    const t = buildTree({ p: [0, 0], legs: [[-1, 0, 0]] }, terms, [{ x0: 2.5, x1: 3, z0: -0.3, z1: 0.3 }], { half: 0.03, jointGap: 0.1 });
    expect(t.unresolved).toEqual([]);
    expect(t.pts.filter((p) => p.term).map((p) => p.term).sort()).toEqual(["a", "b", "c"]);
    for (const p of t.pts) expect(legsOk(p.legs)).toBe(true);
  });
});

describe("network graph emission", () => {
  const drafts = new MepDrafts();
  const g = drafts.group({ system: "plumbing", type: "CW", floor: 1, loc: "T1", name: "Test", assemblyType: "cold_water", category: "water", materialId: "cpvc_cold" });
  const spec: RunSpec = { kind: "pipe", group: g, networkId: "PLB-NET-T", od: 0.02, materialId: "cpvc_cold", componentType: "pipe", label: "pipe", nominal: "15" };
  const net = new Net();
  const [a, b, c] = net.run([[0, 3, 0], [2, 3, 0], [2, 3, 2]], spec);
  const d = net.node([4, 3, 0]);
  const t = net.node([2, 3, 0]);
  void t;
  net.edge(b!, d, spec);
  net.setRecord(a!, "ARC-TEST-F01-END");
  net.setRecord(c!, "ARC-TEST-F01-END2");
  net.setRecord(d, "ARC-TEST-F01-END3");
  net.emit(drafts);
  const records = drafts.finalize();
  const byId = new Map(records.map((r) => [r.id, r]));
  it("emits one record per run with route lengths, and a tee at the 3-way joint", () => {
    const pipes = records.filter((r) => r.componentType === "pipe");
    expect(pipes.map((p) => p.quantity)).toEqual([2, 2, 2]);
    expect(records.filter((r) => r.componentType === "pipe_tee")).toHaveLength(1);
    expect(records[0]!.geometry.kind).toBe("group");
  });
  it("connections are symmetric between MEP records and reach the endpoints", () => {
    for (const r of records) for (const o of r.connectedTo ?? []) if (byId.has(o)) expect(byId.get(o)!.connectedTo).toContain(r.id);
    const ends = records.flatMap((r) => r.connectedTo ?? []).filter((x) => x.startsWith("ARC-"));
    expect(new Set(ends)).toEqual(new Set(["ARC-TEST-F01-END", "ARC-TEST-F01-END2", "ARC-TEST-F01-END3"]));
  });
});
