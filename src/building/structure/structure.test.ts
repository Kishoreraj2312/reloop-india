import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, type BuildingConfig } from "../config";
import { isValidComponentId, parseComponentId } from "../ids";
import { ComponentRegistry } from "../registry";
import {
  buildGrid,
  deriveStair,
  generateStructure,
  getStructure,
  openingsAtLevel,
  recordBounds,
  recordSolids,
  STRUCTURAL_MATERIAL,
  type Box3,
  type ComponentRecord,
} from "./index";
import { polygonArea } from "./geometry";

const TOL = 1e-6;
const cfg = DEFAULT_CONFIG;
const grid = buildGrid(cfg);
const records = generateStructure(cfg);
const byType = (t: string, list: readonly ComponentRecord[] = records) =>
  list.filter((r) => r.componentType === t);
const byId = new Map(records.map((r) => [r.id, r]));
const get = (id: string): ComponentRecord => {
  const r = byId.get(id);
  if (!r) throw new Error(`missing record ${id}`);
  return r;
};

describe("component counts", () => {
  it("42 footings, 42 pedestals", () => {
    expect(byType("footing")).toHaveLength(42);
    expect(byType("pedestal")).toHaveLength(42);
  });

  it("42 columns per storey x 5 storeys = 210", () => {
    const cols = byType("column");
    expect(cols).toHaveLength(210);
    for (let s = 0; s < 5; s++) expect(cols.filter((c) => c.floor === s)).toHaveLength(42);
  });

  it("71 beams per level (36 X + 35 Z); 426 over 6 levels with plinth beams", () => {
    const beams = byType("beam");
    expect(beams).toHaveLength(426);
    for (let i = 0; i <= 5; i++) {
      const lvl = beams.filter((b) => b.floor === i);
      expect(lvl).toHaveLength(71);
      expect(lvl.filter((b) => b.id.includes("-X-"))).toHaveLength(36);
      expect(lvl.filter((b) => b.id.includes("-Z-"))).toHaveLength(35);
    }
  });

  it("plinth flag off removes only the L0 beams", () => {
    const off = generateStructure({ ...cfg, includePlinthBeams: false });
    const beams = byType("beam", off);
    expect(beams).toHaveLength(355);
    expect(beams.some((b) => b.floor === 0)).toBe(false);
  });

  it("default config has roof access (A2): the stair continues to the roof-access enclosure", () => {
    expect(cfg.stair.roofAccess).toBe(true);
  });

  it("slab panel counts: L0 30, L1-L4 36 (stair + shaft bays split in 4), ROOF 36 (roof stair opening)", () => {
    const slabs = byType("slab");
    expect(slabs.filter((s) => s.floor === 0)).toHaveLength(30);
    for (let i = 1; i <= 4; i++) expect(slabs.filter((s) => s.floor === i)).toHaveLength(36);
    expect(slabs.filter((s) => s.floor === 5)).toHaveLength(36);
    expect(slabs).toHaveLength(210);
  });

  it("stairs: 5 storeys (L0->L1 .. L4->ROOF) x (2 flights + 1 landing)", () => {
    expect(byType("stair_flight")).toHaveLength(10);
    expect(byType("stair_landing")).toHaveLength(5);
  });

  it("without roof access: 4 stair storeys and a solid roof bay (33 roof panels, 939 members)", () => {
    const noRoof = generateStructure({ ...cfg, stair: { ...cfg.stair, roofAccess: false } });
    expect(byType("stair_flight", noRoof)).toHaveLength(8);
    expect(byType("stair_landing", noRoof)).toHaveLength(4);
    expect(byType("slab", noRoof).filter((s) => s.floor === 5)).toHaveLength(33);
    expect(noRoof).toHaveLength(939);
  });

  it("roofAccess flag adds the L4->ROOF flight pair, landing and a roof stair opening", () => {
    const withRoof = generateStructure({ ...cfg, stair: { ...cfg.stair, roofAccess: true } });
    expect(byType("stair_flight", withRoof)).toHaveLength(10);
    expect(byType("stair_landing", withRoof)).toHaveLength(5);
    expect(byType("slab", withRoof).filter((s) => s.floor === 5)).toHaveLength(36);
  });

  it("total is 945 components (939 + roof-access flight pair, landing and 3 extra roof panel pieces)", () => {
    expect(records).toHaveLength(945);
  });
});

describe("datum and vertical junctions", () => {
  it("level elevations come from config", () => {
    [0, 3.6, 7.2, 10.8, 14.4, 18].forEach((e, i) => expect(grid.levels[i]!.elevation).toBeCloseTo(e, 9));
  });

  it("footing bottom -1.5, footing top -0.9, pedestal top 0", () => {
    for (const f of byType("footing")) {
      const b = recordBounds(f);
      expect(b.min[1]).toBeCloseTo(-1.5, 9);
      expect(b.max[1]).toBeCloseTo(-0.9, 9);
    }
    for (const p of byType("pedestal")) {
      const b = recordBounds(p);
      expect(b.min[1]).toBeCloseTo(-0.9, 9);
      expect(b.max[1]).toBeCloseTo(0, 9);
    }
  });

  it("column bottoms/tops sit exactly on level elevations; ground column starts on the pedestal top", () => {
    for (const c of byType("column")) {
      const b = recordBounds(c);
      expect(b.min[1]).toBeCloseTo(grid.levels[c.floor]!.elevation, 9);
      expect(b.max[1]).toBeCloseTo(grid.levels[c.floor + 1]!.elevation, 9);
      const parent = get(c.parentId!);
      expect(recordBounds(parent).max[1]).toBeCloseTo(b.min[1], 9);
    }
  });

  it("column tops are flush with the top of the beams/slab at that level; beam undersides are E - depth", () => {
    for (const bm of byType("beam")) {
      const b = recordBounds(bm);
      const e = grid.levels[bm.floor]!.elevation;
      expect(b.max[1]).toBeCloseTo(e, 9);
      expect(b.min[1]).toBeCloseTo(e - cfg.beam.depth, 9);
    }
    for (const s of byType("slab")) {
      expect(recordBounds(s).max[1]).toBeCloseTo(grid.levels[s.floor]!.elevation, 9);
    }
  });

  it("columns are centred on gridline intersections", () => {
    for (const c of byType("column")) {
      const [x, , z] = c.originalPosition;
      expect(grid.xs.some((gx) => Math.abs(gx - x) < TOL)).toBe(true);
      expect(grid.zs.some((gz) => Math.abs(gz - z) < TOL)).toBe(true);
    }
  });

  it("per-storey column override is honoured and beams re-fit to the new faces", () => {
    const big: BuildingConfig = { ...cfg, columnOverrides: { 0: { width: 0.6, depth: 0.6 } } };
    const out = generateStructure(big);
    const ground = out.find((r) => r.id === "STR-COL-G-B2")!;
    expect(recordBounds(ground).max[0] - recordBounds(ground).min[0]).toBeCloseTo(0.6, 9);
    const upper = out.find((r) => r.id === "STR-COL-F01-B2")!;
    expect(recordBounds(upper).max[0] - recordBounds(upper).min[0]).toBeCloseTo(0.45, 9);
    // L1 beams butt against the (0.6) ground-storey column below them
    const bm = out.find((r) => r.id === "STR-BM-F01-X-A1-B1")!;
    expect(recordBounds(bm).max[0] - recordBounds(bm).min[0]).toBeCloseTo(6 - 0.6, 9);
  });
});

describe("beams", () => {
  it("beam ends meet joint-member faces (column faces; pedestal faces at L0)", () => {
    for (const bm of byType("beam")) {
      const b = recordBounds(bm);
      const isX = bm.id.includes("-X-");
      const [aId, bId] = bm.dependencies;
      const a = recordBounds(get(aId!));
      const c = recordBounds(get(bId!));
      const axis = isX ? 0 : 2;
      const lo = Math.min(a.max[axis]!, c.max[axis]!);
      const hi = Math.max(a.min[axis]!, c.min[axis]!);
      expect(b.min[axis]!).toBeCloseTo(lo, 9);
      expect(b.max[axis]!).toBeCloseTo(hi, 9);
    }
  });

  it("beam is centred on its gridline (transverse axis) and has the configured section", () => {
    for (const bm of byType("beam")) {
      const b = recordBounds(bm);
      const isX = bm.id.includes("-X-");
      const t = isX ? 2 : 0;
      expect((b.max[t]! + b.min[t]!) / 2).toSatisfy((m: number) =>
        (isX ? grid.zs : grid.xs).some((g) => Math.abs(g - m) < TOL),
      );
      expect(b.max[t]! - b.min[t]!).toBeCloseTo(cfg.beam.width, 9);
      expect(b.max[1]! - b.min[1]!).toBeCloseTo(cfg.beam.depth, 9);
    }
  });

  it("no duplicate beams (unique IDs and unique placement)", () => {
    const keys = byType("beam").map((b) => `${b.originalPosition.map((v) => v.toFixed(6))}`);
    expect(new Set(keys).size).toBe(keys.length);
    const ids = byType("beam").map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("slabs and openings", () => {
  const solids = (r: ComponentRecord) => recordSolids(r);

  it("openings sit fully inside their bay, clear of beams and columns", () => {
    for (let i = 0; i <= 5; i++) {
      for (const o of openingsAtLevel(grid, i)) {
        const x0 = grid.xs[o.bayX]!;
        const x1 = grid.xs[o.bayX + 1]!;
        const z0 = grid.zs[o.bayZ]!;
        const z1 = grid.zs[o.bayZ + 1]!;
        expect(o.x0).toBeGreaterThanOrEqual(x0 + cfg.beam.width / 2 - TOL);
        expect(o.x1).toBeLessThanOrEqual(x1 - cfg.beam.width / 2 + TOL);
        expect(o.z0).toBeGreaterThanOrEqual(z0 + cfg.beam.width / 2 - TOL);
        expect(o.z1).toBeLessThanOrEqual(z1 - cfg.beam.width / 2 + TOL);
        // no overlap with any column/beam/pedestal solid in plan at this level's slab depth
        const slabBox: Box3 = {
          min: [o.x0, grid.levels[i]!.elevation - cfg.slab.thickness, o.z0],
          max: [o.x1, grid.levels[i]!.elevation, o.z1],
        };
        for (const m of records.filter((r) => ["column", "beam", "pedestal"].includes(r.componentType))) {
          for (const s of solids(m)) expect(overlap(slabBox, s)).toBeLessThan(TOL);
        }
      }
    }
  });

  it("stair opening L1..ROOF (roof access); shaft opening L1..ROOF; none at L0", () => {
    expect(openingsAtLevel(grid, 0)).toHaveLength(0);
    for (let i = 1; i <= 5; i++) expect(openingsAtLevel(grid, i).map((o) => o.kind)).toEqual(["stair", "shaft"]);
    const noRoof = buildGrid({ ...cfg, stair: { ...cfg.stair, roofAccess: false } });
    expect(openingsAtLevel(noRoof, 5).map((o) => o.kind)).toEqual(["shaft"]);
  });

  it("per bay: panels + opening + beam footprints + joint footprints = bay area (tol 1e-6)", () => {
    const nodeOf = (i: number, ix: number, iz: number) =>
      get(i === 0 ? `STR-PED-G-${"ABCDEFG"[ix]}${iz + 1}` : colId(i - 1, ix, iz));
    for (const level of grid.levels) {
      const lvlSlabs = byType("slab").filter((s) => s.floor === level.index);
      const opens = openingsAtLevel(grid, level.index);
      for (let bz = 0; bz < grid.spansZ; bz++) {
        for (let bx = 0; bx < grid.spansX; bx++) {
          const n = bz * grid.spansX + bx + 1;
          const tag = `P${String(n).padStart(2, "0")}`;
          const panels = lvlSlabs.filter((s) => {
            const loc = parseComponentId(s.id)!.location;
            return loc === tag || loc.startsWith(`${tag}-`);
          });
          const panelArea = panels.reduce((a, p) => {
            const g = p.geometry;
            if (g.kind !== "prism") throw new Error("slab must be a prism");
            return a + polygonArea(g.profile);
          }, 0);
          const o = opens.find((q) => q.bayX === bx && q.bayZ === bz);
          const openArea = o ? (o.x1 - o.x0) * (o.z1 - o.z0) : 0;
          const bayArea = (grid.xs[bx + 1]! - grid.xs[bx]!) * (grid.zs[bz + 1]! - grid.zs[bz]!);

          // beam footprints belonging to this bay: half of each bounding beam's plan area
          let beamArea = 0;
          if (grid.hasBeams(level.index)) {
            for (const dep of panels[0]!.dependencies) {
              const b = recordBounds(get(dep));
              beamArea += ((b.max[0]! - b.min[0]!) * (b.max[2]! - b.min[2]!)) / 2;
            }
          }
          // joint-member footprints: a quarter of each corner node
          let nodeArea = 0;
          for (const [ix, iz] of [[bx, bz], [bx + 1, bz], [bx, bz + 1], [bx + 1, bz + 1]] as const) {
            const nb = recordBounds(nodeOf(level.index, ix, iz));
            nodeArea += ((nb.max[0]! - nb.min[0]!) * (nb.max[2]! - nb.min[2]!)) / 4;
          }
          expect(panelArea + openArea + beamArea + nodeArea).toBeCloseTo(bayArea, 6);
        }
      }
    }
  });

  it("same area identity holds with plinth beams off (L0 panels extend to the pedestals)", () => {
    const off = generateStructure({ ...cfg, includePlinthBeams: false });
    const l0 = byType("slab", off).filter((s) => s.floor === 0);
    const area = l0.reduce((a, p) => a + (p.geometry.kind === "prism" ? polygonArea(p.geometry.profile) : 0), 0);
    const ped = 0.6 * 0.6;
    // 1080 m² footprint minus the full pedestal footprint at 42 nodes, with edge/corner nodes only partly inside
    const expected = 36 * 30 - (4 * ped / 4 + 2 * (5 + 4) * ped / 2 + 20 * ped);
    expect(area).toBeCloseTo(expected, 6);
  });
});

describe("stairs", () => {
  const d = deriveStair(grid);

  it("arithmetic: 24 risers x 0.15 = 3.6 per storey, 12 per flight, mid-landing at +1.8", () => {
    expect(cfg.stair.risersPerStorey * d.riser).toBeCloseTo(cfg.storeyHeight, 9);
    expect(d.risersPerFlight).toBe(12);
    expect(d.treadsPerFlight).toBe(11);
    expect(d.landingHeight).toBeCloseTo(1.8, 9);
    expect(d.run).toBeCloseTo(3.08, 9);
  });

  it("deriveStair rejects inconsistent riser arithmetic", () => {
    const bad = buildGrid({ ...cfg, stair: { ...cfg.stair, riserHeight: 0.16 } });
    expect(() => deriveStair(bad)).toThrow();
  });

  const flights = byType("stair_flight");

  it("each flight has 11 treads (0.28 deep) at consecutive 0.15 heights => 12 risers from base to top", () => {
    for (const f of flights) {
      const g = f.geometry;
      if (g.kind !== "prism") throw new Error("flight must be a prism");
      const isFl1 = f.id.endsWith("-FL1");
      const base = isFl1 ? 0 : d.landingHeight; // profile y is relative to the storey level
      const top = isFl1 ? d.landingHeight : d.storeyRise;
      const treadYs: number[] = [];
      for (let i = 0; i < g.profile.length; i++) {
        const [z0, y0] = g.profile[i]!;
        const [z1, y1] = g.profile[(i + 1) % g.profile.length]!;
        if (Math.abs(y1 - y0) < TOL && Math.abs(Math.abs(z1 - z0) - d.tread) < TOL) treadYs.push(y0);
      }
      treadYs.sort((a, b) => a - b);
      expect(treadYs).toHaveLength(11);
      expect(treadYs[0]! - base).toBeCloseTo(d.riser, 9);
      for (let i = 1; i < treadYs.length; i++) expect(treadYs[i]! - treadYs[i - 1]!).toBeCloseTo(d.riser, 9);
      expect(top - treadYs[10]!).toBeCloseTo(d.riser, 9); // 11 treads + base/top => 12 risers
      expect(Math.max(...g.profile.map((p) => p[1]))).toBeCloseTo(top, 9);
    }
  });

  it("FL1 top step meets the mid-landing; FL2 top step meets the next level exactly", () => {
    for (let s = 0; s < 4; s++) {
      const base = grid.levels[s]!.elevation;
      const fl1 = recordBounds(get(`STR-STAIR-${tag(s)}-FL1`));
      const fl2 = recordBounds(get(`STR-STAIR-${tag(s)}-FL2`));
      const lnd = recordBounds(get(`STR-STAIR-${tag(s)}-LND`));
      expect(fl1.max[1]).toBeCloseTo(base + 1.8, 9);
      expect(lnd.max[1]).toBeCloseTo(base + 1.8, 9);
      expect(fl2.max[1]).toBeCloseTo(grid.levels[s + 1]!.elevation, 9);
      expect(fl1.min[1]).toBeGreaterThanOrEqual(base - TOL); // never dips below its base level
      // FL1 ends where the landing begins; FL2 starts at the same plane
      expect(fl1.max[2]).toBeCloseTo(lnd.min[2], 9);
      expect(fl2.max[2]).toBeCloseTo(lnd.min[2], 9);
    }
  });

  it("the stair plan fits inside the stair opening with non-negative clearance", () => {
    const op = openingsAtLevel(grid, 1)[0]!;
    for (const r of [...flights, ...byType("stair_landing")]) {
      const b = recordBounds(r);
      expect(b.min[0]).toBeGreaterThanOrEqual(op.x0 - TOL);
      expect(b.max[0]).toBeLessThanOrEqual(op.x1 + TOL);
      expect(b.min[2]).toBeGreaterThanOrEqual(op.z0 - TOL);
      expect(b.max[2]).toBeLessThanOrEqual(op.z1 + TOL);
    }
    expect(op.x1 - op.x0 - d.planWidth).toBeGreaterThanOrEqual(0);
    expect(op.z1 - op.z0 - d.planLength).toBeGreaterThanOrEqual(0);
  });
});

describe("identity and data model", () => {
  it("all IDs unique, valid and parseable", () => {
    const ids = records.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(isValidComponentId(id)).toBe(true);
      expect(parseComponentId(id)).not.toBeNull();
    }
  });

  it("documented examples", () => {
    for (const id of [
      "STR-FTG-G-B2",
      "STR-PED-G-B2",
      "STR-COL-G-B2",
      "STR-COL-F01-B2",
      "STR-BM-F01-X-B2-C2",
      "STR-BM-G-Z-A1-A2",
      "STR-SLAB-F02-P03",
      "STR-SLAB-F01-P16-W",
      "STR-STAIR-G-FL1",
      "STR-STAIR-F02-LND",
    ]) {
      expect(byId.has(id), id).toBe(true);
    }
  });

  it("generation is deterministic across repeated runs", () => {
    expect(JSON.stringify(generateStructure(cfg))).toBe(JSON.stringify(generateStructure(cfg)));
  });

  it("getStructure memoises per config object", () => {
    expect(getStructure(cfg)).toBe(getStructure(cfg));
  });

  it("every record is a complete, frozen BuildingComponent in the structure system", () => {
    for (const r of records) {
      expect(r.system).toBe("structure");
      expect(r.materialId).toBe(STRUCTURAL_MATERIAL.id);
      expect(STRUCTURAL_MATERIAL.name).toBe("reinforced concrete (conceptual)");
      expect(r.unit).toBe("m3");
      expect(r.quantity).toBeGreaterThan(0);
      expect(r.originalRotation).toEqual([0, 0, 0]);
      expect(Object.isFrozen(r)).toBe(true);
      expect(Object.isFrozen(r.originalPosition)).toBe(true);
      expect(Object.isFrozen(r.originalRotation)).toBe(true);
    }
  });

  it("parent/dependency references resolve to existing records", () => {
    for (const r of records) {
      if (r.parentId) expect(byId.has(r.parentId), `${r.id} parent`).toBe(true);
      for (const dep of r.dependencies) expect(byId.has(dep), `${r.id} dep ${dep}`).toBe(true);
    }
  });

  it("all records register without duplicates", () => {
    const reg = new ComponentRegistry();
    reg.registerAll(records);
    expect(reg.size).toBe(945);
  });
});

describe("generic overlap check across all members", () => {
  /**
   * Allow-list: none. Face contact (zero-volume overlap) between stacked/abutting members
   * is expected and is not an overlap; only positive-volume intersection is reported.
   */
  it("no two members share volume", () => {
    const entries = records.map((r) => ({ r, solids: recordSolids(r), bounds: recordBounds(r) }));
    const offenders: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]!;
        const b = entries[j]!;
        if (overlap(a.bounds, b.bounds) <= TOL * TOL) continue; // cheap reject
        for (const sa of a.solids) {
          for (const sb of b.solids) {
            const v = overlap(sa, sb);
            if (v > 1e-9) offenders.push(`${a.r.id} x ${b.r.id} (${v.toExponential(2)} m3)`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("holds with plinth beams off and with the roof-access stair", () => {
    for (const variant of [
      { ...cfg, includePlinthBeams: false },
      { ...cfg, stair: { ...cfg.stair, roofAccess: true } },
      { ...cfg, columnOverrides: { 0: { width: 0.6, depth: 0.6 } } },
    ]) {
      const out = generateStructure(variant);
      const ents = out.map((r) => ({ id: r.id, solids: recordSolids(r), bounds: recordBounds(r) }));
      const hits: string[] = [];
      for (let i = 0; i < ents.length; i++) {
        for (let j = i + 1; j < ents.length; j++) {
          if (overlap(ents[i]!.bounds, ents[j]!.bounds) <= 0) continue;
          for (const sa of ents[i]!.solids)
            for (const sb of ents[j]!.solids)
              if (overlap(sa, sb) > 1e-9) hits.push(`${ents[i]!.id} x ${ents[j]!.id}`);
        }
      }
      expect(hits).toEqual([]);
    }
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────
function overlap(a: Box3, b: Box3): number {
  const dx = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const dy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  const dz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
  return dx > 0 && dy > 0 && dz > 0 ? dx * dy * dz : 0;
}

function tag(storey: number): string {
  return storey === 0 ? "G" : `F${String(storey).padStart(2, "0")}`;
}

function colId(storey: number, ix: number, iz: number): string {
  return `STR-COL-${tag(storey)}-${"ABCDEFG"[ix]}${iz + 1}`;
}
