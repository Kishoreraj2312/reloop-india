import { describe, expect, it } from "vitest";
import { modelRecords } from "@/engine/quantities";
import { recordBounds } from "@/building/structure";
import { floorKeyOf as sceneFloorKeyOf, buildSceneTree } from "@/scene/sceneTree";
import {
  ASSEMBLY_RULES,
  DEFAULT_EXPLODE_CONFIG,
  EXPLODE_MODES,
  ExplodeSolver,
  buildExplodeModel,
  clusterLayers,
  defaultParams,
  displayedBounds,
  displayedBoundsOf,
  ease,
  floorKeyOf,
  norm0,
  solveOffsets,
  windowed,
  type ExplodeModel,
  type ExplodeParams,
  type FloorKey,
} from "./index";

const recs = modelRecords();
const model: ExplodeModel = buildExplodeModel(recs);
const P = (o: Partial<ExplodeParams> = {}): ExplodeParams => ({ ...defaultParams(), ...o });
const zeroBits = (a: Float64Array) => Array.from(a).every((v) => Object.is(v, 0));
const sameBits = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((v, i) => Object.is(v, b[i]));
const drawn = recs.filter((r) => r.geometry.kind !== "group");
const groups = recs.filter((r) => r.geometry.kind === "group");

describe("easing", () => {
  it("is exactly 0 at 0, exactly 1 at 1, monotonic and clamped", () => {
    expect(Object.is(ease(0), 0)).toBe(true);
    expect(ease(1)).toBe(1);
    expect(ease(-3)).toBe(0);
    expect(ease(4)).toBe(1);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const e = ease(i / 100);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
  });
  it("windows the master parameter", () => {
    expect(windowed(0.1, [0.2, 0.6])).toBe(0);
    expect(windowed(0.4, [0.2, 0.6])).toBeCloseTo(0.5, 12);
    expect(windowed(0.9, [0.2, 0.6])).toBe(1);
    expect(windowed(0.5, [0.5, 0.5])).toBe(1); // degenerate window is a step
  });
  it("norm0 turns -0 into +0", () => {
    expect(Object.is(norm0(-0), 0)).toBe(true);
    expect(Object.is(norm0(-1 * 6 * 0), 0)).toBe(true);
  });
  it("clusters layers by single linkage, deterministically", () => {
    expect(clusterLayers([0, 0.004, 0.2, 0.205, 0.5], 0.01)).toEqual({ layer: [0, 0, 1, 1, 2], count: 3 });
    expect(clusterLayers([0.5, 0, 0.2], 0.01).layer).toEqual([2, 0, 1]);
    expect(clusterLayers([], 0.01).count).toBe(0);
  });
});

describe("grouping (real model)", () => {
  it("uses the scene's floor rule: the explicit floor field", () => {
    for (const f of [-1, 0, 1, 2, 3, 4, 5]) expect(floorKeyOf(f)).toBe(sceneFloorKeyOf(f));
    expect(model.floors).toEqual(["FDN", "L0", "L1", "L2", "L3", "L4", "ROOF"]);
    expect(model.floorRel).toEqual([-1, 0, 1, 2, 3, 4, 5]);
    expect(model.systems).toEqual(["structure", "architecture", "plumbing", "electrical"]);
  });

  it("places every drawn component in exactly one floor / system / category cell, matching the scene hierarchy", () => {
    expect(model.ungrouped).toEqual([]);
    expect(model.cells.reduce((n, c) => n + c.count, 0)).toBe(drawn.length);
    const cells = new Map(model.cells.map((c) => [`${c.floor}|${c.system}|${c.category}`, c.count]));
    let tree = 0;
    for (const fl of buildSceneTree(recs))
      for (const sys of fl.systems)
        for (const a of sys.assemblies) {
          const n = a.records.filter((r) => r.geometry.kind !== "group").length;
          if (!n) continue;
          tree += n;
          expect(cells.get(`${fl.floor}|${sys.system}|${a.assembly}`)).toBe(n);
        }
    expect(tree).toBe(drawn.length);
    // the floor group of a record is a pure function of its own floor field
    for (const r of drawn) expect(model.floorSlot.has(floorKeyOf(r.floor))).toBe(true);
  });

  it("no floor group has an out-of-range or ambiguous floor: every component is within one storey of its floor's storey band", () => {
    const H = 3.6;
    for (const r of drawn) {
      const b = recordBounds(r);
      const mid = (b.min[1] + b.max[1]) / 2;
      const k = Math.max(-1, Math.min(5, Math.floor((mid + 0.5) / H)));
      expect(Math.abs(k - r.floor)).toBeLessThanOrEqual(1);
    }
  });

  it("every assembly record is either supported (a plan) or unsupported (with a reason), never both, never neither", () => {
    expect(model.assemblyMembers.size).toBe(groups.length);
    const ok = new Set(model.assemblies.map((a) => a.id));
    const no = new Set(model.unsupported.map((u) => u.id));
    expect(ok.size + no.size).toBe(groups.length);
    for (const g of groups) expect(ok.has(g.id) !== no.has(g.id)).toBe(true);
    for (const u of model.unsupported) {
      expect(u.reason.length).toBeGreaterThan(10);
      expect(u.members).toBe(model.assemblyMembers.get(u.id)!.length);
    }
    expect(model.assemblies.length).toBeGreaterThan(1000);
  });

  it("assembly membership is explicit containment: each member is a drawn leaf of exactly one assembly and shares its floor", () => {
    const seen = new Set<string>();
    for (const a of model.assemblies) {
      const g = model.byId.get(a.id)!;
      for (const id of a.members) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        const m = model.byId.get(id)!;
        expect(m.parentId).toBe(a.id); // containment, not dependencies or connections
        expect(m.geometry.kind).not.toBe("group");
        expect(m.floor).toBe(g.floor);
        expect(model.memberAssembly.get(id)).toBe(model.assemblyIndex.get(a.id));
      }
    }
    expect(seen.size).toBe(model.memberAssembly.size);
    expect(model.memberUnit.size).toBe(seen.size);
  });

  it("reports what has no assembly hierarchy: the 945 structural members fall back to floor / system / category", () => {
    expect(Object.keys(model.unassembled)).toEqual(["structure"]);
    expect(model.unassembled.structure!.count).toBe(recs.filter((r) => r.system === "structure").length);
    expect(model.unassembled.structure!.reason).toMatch(/no assembly records/);
    for (const r of recs.filter((x) => x.system === "structure")) expect(model.memberAssembly.has(r.id)).toBe(false);
  });

  it("derives every axis and unit offset from geometry: finite, unit axes, symmetric layers", () => {
    for (const a of model.assemblies) {
      expect(a.layerCount).toBeGreaterThanOrEqual(2);
      let maxU = 0;
      for (const id of a.members) {
        const u = model.memberUnit.get(id)!;
        expect(u.every(Number.isFinite)).toBe(true);
        maxU = Math.max(maxU, Math.hypot(...u));
      }
      expect(a.maxUnit).toBeCloseTo(maxU, 9);
      if (a.strategy === "layers") {
        expect(a.axis!.reduce((s, v) => s + v * v, 0)).toBe(1);
        expect(a.maxUnit).toBeCloseTo((a.layerCount - 1) / 2, 9);
        // layers are centred: the signed layer indices of the members span -mid..+mid
        const proj = a.members.map((id) => model.memberUnit.get(id)!.reduce((s, v, i) => s + v * a.axis![i]!, 0));
        expect(Math.min(...proj)).toBeCloseTo(-a.maxUnit, 9);
        expect(Math.max(...proj)).toBeCloseTo(a.maxUnit, 9);
      } else {
        expect(a.axis).toBeNull();
        for (const id of a.members) expect(Math.hypot(...model.memberUnit.get(id)!)).toBeCloseTo(1, 9);
      }
    }
  });

  it("openings layer along their host wall's normal (the thin horizontal axis of the host assembly)", () => {
    let checked = 0;
    for (const a of model.assemblies.filter((x) => x.kind === "normal" && x.axisSource.startsWith("host wall"))) {
      const g = model.byId.get(a.id)!;
      const host = g.dependencies.map((d) => model.byId.get(d)!).find((r) => r.geometry.kind === "group" && r.componentType === "wall_assembly")!;
      if (host.geometry.kind !== "group") throw new Error("host is not an assembly");
      const [sx, , sz] = host.geometry.size;
      expect(a.axis).toEqual(sx < sz ? [1, 0, 0] : [0, 0, 1]);
      checked++;
    }
    expect(checked).toBeGreaterThan(400);
    const win = model.assemblies.find((a) => a.type === "window_assembly")!;
    expect(win.layerCount).toBeGreaterThanOrEqual(3);
  });

  it("documents a rule or a reason for every assembly type present", () => {
    for (const t of new Set(groups.map((g) => g.componentType))) expect(ASSEMBLY_RULES[t], t).toBeDefined();
  });
});

describe("offsets", () => {
  it("progress 0 (and mode assembled at any progress) gives exactly +0 for every group and assembly: bit-identical to canonical", () => {
    const s = new ExplodeSolver(model);
    for (const mode of EXPLODE_MODES) {
      s.solve(P({ mode, t: 0, focus: model.assemblies[0]!.id }));
      expect(zeroBits(s.floorOffset)).toBe(true);
      expect(zeroBits(s.systemOffset)).toBe(true);
      expect(zeroBits(s.assemblyFactor)).toBe(true);
      expect(s.assemblyActive).toBe(false);
    }
    s.solve(P({ mode: "assembled", t: 1 }));
    expect(zeroBits(s.floorOffset) && zeroBits(s.systemOffset) && zeroBits(s.assemblyFactor)).toBe(true);
    const o = [0, 0, 0];
    for (const r of drawn.slice(0, 2000)) {
      s.solve(P({ mode: "cinematic", t: 0 }));
      s.offsetOf(r.id, o);
      expect(o.every((v) => Object.is(v, 0))).toBe(true);
    }
  });

  it("is deterministic and never accumulates: the same parameters always give the same offsets, whatever came before", () => {
    const a = new ExplodeSolver(model);
    const b = new ExplodeSolver(model);
    const target = P({ mode: "cinematic", t: 0.62, floorGap: 7.5, systemGap: 9, assemblyGap: 0.4, layout: "row-x" });
    a.solve(target);
    const history = [0.1, 0.9, 0.3, 1, 0, 0.77].map((t) => P({ mode: "floors", t }));
    for (const h of history) b.solve(h);
    b.solve(P({ mode: "systems", t: 1, layout: "grid" }));
    b.solve(target);
    expect(sameBits(a.floorOffset, b.floorOffset)).toBe(true);
    expect(sameBits(a.systemOffset, b.systemOffset)).toBe(true);
    expect(sameBits(a.assemblyFactor, b.assemblyFactor)).toBe(true);
  });

  it("floors: each group moves by (floor index - anchor) x gap, vertically only, foundation down and roof up", () => {
    const s = solveOffsets(model, P({ mode: "floors", t: 1 }));
    expect(model.floors.map((f) => s.floorOffsetOf(f))).toEqual([
      [0, -6, 0],
      [0, 0, 0],
      [0, 6, 0],
      [0, 12, 0],
      [0, 18, 0],
      [0, 24, 0],
      [0, 30, 0],
    ]);
    expect(zeroBits(s.systemOffset)).toBe(true);
    const half = solveOffsets(model, P({ mode: "floors", t: 0.5 }));
    expect(half.floorOffsetOf("L2")[1]).toBe(12 * ease(0.5));
    const wide = solveOffsets(model, P({ mode: "floors", t: 1, floorGap: 10 }));
    expect(wide.floorOffsetOf("L4")[1]).toBe(40);
  });

  it("floors separate monotonically: no group ever moves back as progress grows, and the gaps only widen", () => {
    const s = new ExplodeSolver(model);
    let prev: number[] | null = null;
    for (let i = 0; i <= 50; i++) {
      s.solve(P({ mode: "floors", t: i / 50 }));
      const y = model.floors.map((_, k) => s.floorOffset[k * 3 + 1]!);
      if (prev) {
        for (let k = 0; k < y.length; k++) if (model.floorRel[k]! > 0) expect(y[k]!).toBeGreaterThanOrEqual(prev[k]!);
        for (let k = 0; k < y.length; k++) if (model.floorRel[k]! < 0) expect(y[k]!).toBeLessThanOrEqual(prev[k]!);
        for (let k = 1; k < y.length; k++) expect(y[k]! - y[k - 1]!).toBeGreaterThanOrEqual(prev[k]! - prev[k - 1]!);
      }
      prev = y;
    }
  });

  it("floor group bounds are disjoint vertically at full explosion (and overlap when assembled)", () => {
    const at = (t: number) => {
      const s = solveOffsets(model, P({ mode: "floors", t }));
      return model.floors.map((f, i) => {
        const b = model.floorBounds.get(f)!;
        return { f, lo: b.min[1] + s.floorOffset[i * 3 + 1]!, hi: b.max[1] + s.floorOffset[i * 3 + 1]! };
      });
    };
    const full = at(1);
    for (let i = 1; i < full.length; i++) expect(full[i]!.lo, `${full[i - 1]!.f} / ${full[i]!.f}`).toBeGreaterThan(full[i - 1]!.hi);
    const home = at(0);
    expect(home.some((x, i) => i > 0 && x.lo < home[i - 1]!.hi)).toBe(true); // they do overlap assembled: the gap is needed
  });

  it("systems: the layers never overlap in plan at full explosion, for every layout, and keep the arrangement centred", () => {
    for (const layout of ["grid", "row-x", "row-z"] as const) {
      const s = solveOffsets(model, P({ mode: "systems", t: 1, layout }));
      const boxes = model.systems.map((sys, i) => {
        const b = model.systemBounds.get(sys)!;
        const dx = s.systemOffset[i * 3]!;
        const dz = s.systemOffset[i * 3 + 2]!;
        return { sys, x0: b.min[0] + dx, x1: b.max[0] + dx, z0: b.min[2] + dz, z1: b.max[2] + dz, dy: s.systemOffset[i * 3 + 1]! };
      });
      for (let i = 0; i < boxes.length; i++) {
        expect(boxes[i]!.dy).toBe(0); // purely horizontal
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const c = boxes[j]!;
          const sepX = Math.max(c.x0 - a.x1, a.x0 - c.x1);
          const sepZ = Math.max(c.z0 - a.z1, a.z0 - c.z1);
          expect(Math.max(sepX, sepZ), `${layout}: ${a.sys} / ${c.sys}`).toBeGreaterThanOrEqual(DEFAULT_EXPLODE_CONFIG.systemGap - 1e-9);
        }
      }
      if (layout === "row-x") expect(Array.from({ length: 4 }, (_, i) => s.systemOffset[i * 3 + 2])).toEqual([0, 0, 0, 0]);
      if (layout === "row-z") expect(Array.from({ length: 4 }, (_, i) => s.systemOffset[i * 3])).toEqual([0, 0, 0, 0]);
      // centred on the assembled union: the mean displaced centre equals the mean natural centre (within the layout's own asymmetry)
      const natural = [...model.systemBounds.values()];
      const cx0 = (Math.min(...natural.map((b) => b.min[0])) + Math.max(...natural.map((b) => b.max[0]))) / 2;
      const cx1 = (Math.min(...boxes.map((b) => b.x0)) + Math.max(...boxes.map((b) => b.x1))) / 2;
      expect(Math.abs(cx1 - cx0)).toBeLessThan(1e-6);
    }
  });

  it("systems separate monotonically and only horizontally; systems left out of the arrangement stay put", () => {
    const s = new ExplodeSolver(model);
    let prev = 0;
    for (let i = 0; i <= 40; i++) {
      s.solve(P({ mode: "systems", t: i / 40 }));
      const spread = Math.hypot(s.systemOffset[0]! - s.systemOffset[3 * 3]!, s.systemOffset[2]! - s.systemOffset[3 * 3 + 2]!);
      expect(spread).toBeGreaterThanOrEqual(prev);
      prev = spread;
      expect(zeroBits(s.floorOffset)).toBe(true);
    }
    s.solve(P({ mode: "systems", t: 1, systems: ["plumbing"] })); // a single participant: nothing to arrange
    expect(zeroBits(s.systemOffset)).toBe(true);
    s.solve(P({ mode: "systems", t: 1, systems: ["structure", "architecture"] }));
    expect(s.systemOffsetOf("plumbing")).toEqual([0, 0, 0]);
    expect(s.systemOffsetOf("electrical")).toEqual([0, 0, 0]);
    expect(s.systemOffsetOf("structure")[0]).not.toBe(0);
  });

  it("cinematic stages the sequence: floors, then systems, then assemblies, all driven by one parameter", () => {
    const ph = DEFAULT_EXPLODE_CONFIG.phases;
    const s = new ExplodeSolver(model);
    s.solve(P({ mode: "cinematic", t: ph.systems[0] / 2 }));
    expect(s.eFloor).toBeGreaterThan(0);
    expect(s.eSystem).toBe(0);
    expect(s.eAssembly).toBe(0);
    expect(zeroBits(s.systemOffset) && zeroBits(s.assemblyFactor)).toBe(true);
    s.solve(P({ mode: "cinematic", t: (ph.systems[0] + ph.systems[1]) / 2 }));
    expect(s.eFloor).toBe(1);
    expect(s.eSystem).toBeGreaterThan(0);
    expect(s.eSystem).toBeLessThan(1);
    expect(s.eAssembly).toBe(0);
    s.solve(P({ mode: "cinematic", t: 1 }));
    expect([s.eFloor, s.eSystem, s.eAssembly]).toEqual([1, 1, 1]);
    expect(s.assemblyActive).toBe(true);
    expect(s.floorOffsetOf("ROOF")[1]).toBe(30);
  });

  it("the effective offset of a component is floor + system + assembly, additive and independent of order", () => {
    const s = solveOffsets(model, P({ mode: "cinematic", t: 1 }));
    const win = model.assemblies.find((a) => a.type === "window_assembly" && a.floor === "L2")!;
    const id = win.members[0]!;
    const rec = model.byId.get(id)!;
    const out = [0, 0, 0];
    s.offsetOf(id, out);
    const f = s.floorOffsetOf(floorKeyOf(rec.floor));
    const y = s.systemOffsetOf(rec.system);
    const u = model.memberUnit.get(id)!;
    const k = s.assemblyFactor[model.memberAssembly.get(id)!]!;
    expect(out[0]).toBeCloseTo(f[0] + y[0] + u[0] * k, 12);
    expect(out[1]).toBeCloseTo(f[1] + y[1] + u[1] * k, 12);
    expect(out[2]).toBeCloseTo(f[2] + y[2] + u[2] * k, 12);
    expect(out[1]).toBeCloseTo(12 + u[1] * k, 12); // L2 = 2 floors up
    // a structural member (no assembly) has only floor + system
    const col = recs.find((r) => r.id === "STR-COL-F02-A1")!;
    s.offsetOf(col.id, out);
    expect(out[1]).toBe(12);
    expect(out[0]).toBe(s.systemOffsetOf("structure")[0]);
  });

  it("assembly focus moves only the chosen assembly; an unsupported or unknown focus moves nothing", () => {
    const a = model.assemblies.find((x) => x.type === "kitchen_assembly")!;
    const s = solveOffsets(model, P({ mode: "assembly", t: 1, focus: a.id }));
    const idx = model.assemblyIndex.get(a.id)!;
    for (let i = 0; i < s.assemblyFactor.length; i++) expect(s.assemblyFactor[i]! > 0).toBe(i === idx);
    expect(zeroBits(s.floorOffset) && zeroBits(s.systemOffset)).toBe(true);
    s.solve(P({ mode: "assembly", t: 1, focus: model.unsupported[0]!.id }));
    expect(s.assemblyActive).toBe(false);
    s.solve(P({ mode: "assembly", t: 1, focus: "nope" }));
    expect(s.assemblyActive).toBe(false);
    s.solve(P({ mode: "assembly", t: 1, focus: null }));
    expect(s.assemblyActive).toBe(false);
  });

  it("an assembly never spreads further than maxSpan / 2, however many layers it has", () => {
    const s = solveOffsets(model, P({ mode: "cinematic", t: 1, assemblyGap: 5 }));
    const cap = DEFAULT_EXPLODE_CONFIG.assembly.maxSpan / 2;
    const o = [0, 0, 0];
    for (const a of model.assemblies.filter((x) => x.strategy === "layers")) for (const id of a.members) {
      const f = s.assemblyFactor[model.assemblyIndex.get(a.id)!]!;
      expect(Math.hypot(...model.memberUnit.get(id)!) * f).toBeLessThanOrEqual(cap + 1e-9);
    }
    expect(s.maxAssemblyDisplacement).toBeLessThanOrEqual(5 * DEFAULT_EXPLODE_CONFIG.assembly.radialFactor);
    void o;
  });

  it("every offset is finite across modes, progress values and extreme distances", () => {
    const s = new ExplodeSolver(model);
    for (const mode of EXPLODE_MODES)
      for (const t of [-1, 0, 0.001, 0.5, 0.999, 1, 2, Number.MAX_SAFE_INTEGER])
        for (const [fg, sg, ag] of [[0, 0, 0], [6, 6, 0.3], [50, 100, 2]] as const) {
          s.solve(P({ mode, t, floorGap: fg, systemGap: sg, assemblyGap: ag, focus: model.assemblies[3]!.id }));
          for (const arr of [s.floorOffset, s.systemOffset, s.assemblyFactor]) expect(Array.from(arr).every(Number.isFinite)).toBe(true);
        }
  });
});

describe("displayed bounds", () => {
  it("equal the union of the canonical bounds when assembled, and follow the offsets when exploded", () => {
    const s = solveOffsets(model, P());
    const b = displayedBounds(model, s);
    let min = Infinity;
    let max = -Infinity;
    for (const r of drawn) {
      const rb = recordBounds(r);
      min = Math.min(min, rb.min[1]);
      max = Math.max(max, rb.max[1]);
    }
    expect(b.min[1]).toBe(min);
    expect(b.max[1]).toBe(max);
    const full = displayedBounds(model, solveOffsets(model, P({ mode: "floors", t: 1 })));
    expect(full.max[1]).toBe(max + 30);
    expect(full.min[1]).toBe(Math.min(...model.cells.filter((c) => c.floor === "FDN").map((c) => c.bounds.min[1])) - 6);
  });

  it("honours a visibility filter (hidden groups do not count)", () => {
    const s = solveOffsets(model, P({ mode: "floors", t: 1 }));
    const noRoof = displayedBounds(model, s, (c) => c.floor !== "ROOF");
    expect(noRoof.max[1]).toBeLessThan(displayedBounds(model, s).max[1]);
    const none = displayedBounds(model, s, () => false);
    expect(none.min[0]).toBe(Infinity);
  });

  it("a component's displayed bounds are its canonical bounds shifted by its effective offset; an assembly is the union of its members", () => {
    const s = solveOffsets(model, P({ mode: "cinematic", t: 1 }));
    const a = model.assemblies.find((x) => x.type === "door_assembly")!;
    const b = displayedBoundsOf(model, s, a.members[0]!)!;
    const rb = recordBounds(model.byId.get(a.members[0]!)!);
    const o = [0, 0, 0];
    s.offsetOf(a.members[0]!, o);
    for (let i = 0; i < 3; i++) {
      expect(b.min[i]).toBeCloseTo(rb.min[i]! + o[i]!, 9);
      expect(b.max[i]).toBeCloseTo(rb.max[i]! + o[i]!, 9);
    }
    const u = displayedBoundsOf(model, s, a.id)!;
    expect(u.min[1]).toBeLessThanOrEqual(b.min[1]);
    expect(displayedBoundsOf(model, s, "nope")).toBeNull();
  });
});

describe("the model is read-only input", () => {
  it("building and solving never changes the records", () => {
    const snap = () => JSON.stringify(recs.slice(0, 3000).map((r) => [r.id, r.floor, r.originalPosition, r.dependencies, r.parentId ?? null, r.quantity]));
    const before = snap();
    const m2 = buildExplodeModel(recs);
    const s = new ExplodeSolver(m2);
    for (const mode of EXPLODE_MODES) s.solve(P({ mode, t: 0.7, focus: m2.assemblies[0]!.id }));
    expect(snap()).toBe(before);
    expect(Object.isFrozen(recs[0])).toBe(true);
  });
});

export type { FloorKey };
