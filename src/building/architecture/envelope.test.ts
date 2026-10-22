import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../config";
import { getStructure, recordBounds, type ComponentRecord } from "../structure";
import { ARCH_CONFIG, archDatums } from "./config";
import { floorBoundaries, wallFootprint } from "./boundaries";
import { generateArchitecture, generateArchitectureModel } from "./generate";
import { checkHierarchy, checkIds, checkQuantities, findCoplanarFaces, findOverlaps } from "./validateComponents";
import { columnRects } from "./validatePlan";

const cfg = DEFAULT_CONFIG;
const model = generateArchitectureModel(cfg);
const records = model.records;
const structure = getStructure(cfg);
const PREFIXES = ["WALL", "PART", "WIN", "DOOR", "BAL", "FLR", "SKT", "TILE", "CEIL", "FIX", "KIT", "BATH", "STAIRFIN", "FAC", "ROOF", "ENT"];
const byId = new Map(records.map((r) => [r.id, r]));
const d = archDatums(cfg);

describe("envelope records: identity, hierarchy, data", () => {
  it("IDs are valid, ARC-prefixed, unique and carry the record's floor", () => {
    expect(checkIds(records, PREFIXES)).toEqual([]);
  });

  it("generation is deterministic (same ids, positions, quantities)", () => {
    const again = generateArchitecture(cfg);
    const sig = (rs: readonly ComponentRecord[]) => rs.map((r) => `${r.id}|${r.originalPosition.map((v) => v.toFixed(6))}|${r.quantity.toFixed(9)}`);
    expect(sig(again)).toEqual(sig(records));
  });

  it("parents exist, are assemblies, contain their children; child IDs extend the parent's", () => {
    expect(checkHierarchy(records)).toEqual([]);
  });

  it("quantities match unit + dimensions; dimensions match geometry; materials exist", () => {
    expect(checkQuantities(records)).toEqual([]);
  });

  it("records extend the shared model: system architecture, assumed confidence, frozen", () => {
    for (const r of records) {
      expect(r.system).toBe("architecture");
      expect(r.confidence).toBe("assumed");
      expect(r.assemblyType).toBeTruthy();
      expect(Object.isFrozen(r)).toBe(true);
    }
  });
});

describe("envelope geometry: no clashes", () => {
  it("no architecture component shares volume with any structural member", () => {
    expect(findOverlaps(records, structure)).toEqual([]);
  });

  it("no two architecture components share volume", () => {
    expect(findOverlaps(records)).toEqual([]);
  });

  it("no coplanar same-facing faces (z-fighting) within architecture or against structure", () => {
    expect(findCoplanarFaces(records)).toEqual([]);
    expect(findCoplanarFaces(records, structure)).toEqual([]);
  });

  it("checkers catch planted faults (mutation controls)", () => {
    const pier = records.find((r) => r.id === "ARC-WALL-F01-EXT-S-A1-B1-P01")!;
    const grown: ComponentRecord = { ...pier, geometry: { kind: "box", size: [(pier.geometry as unknown as { size: number[] }).size[0]! + 0.2, 3.1, 0.23] } };
    expect(findOverlaps([grown], structure).length).toBeGreaterThan(0); // runs into column A1/B1
    const twin: ComponentRecord = { ...pier, id: `${pier.id}-TWIN`, originalPosition: [pier.originalPosition[0] + 0.1, pier.originalPosition[1], pier.originalPosition[2]] };
    expect(findOverlaps([pier, twin]).length).toBe(1);
    const flushTwin: ComponentRecord = { ...twin, geometry: { kind: "box", size: [1, 3.1, 0.1] }, originalPosition: [pier.originalPosition[0], pier.originalPosition[1], pier.originalPosition[2] - 0.065] };
    expect(findCoplanarFaces([pier, flushTwin]).length).toBeGreaterThan(0);
  });
});

describe("walls", () => {
  it("masonry rises from slab top to the beam soffit (clear height 3.1)", () => {
    for (const st of model.storeys) {
      for (const w of st.walls) {
        expect(w.y0).toBeCloseTo(d.slabTop(st.plan.storey), 9);
        expect(w.y1 - w.y0).toBeCloseTo(3.1, 9);
      }
    }
  });

  it("exterior walls are 0.23 thick with the outer face flush with the column outer face", () => {
    for (const w of model.storeys[1]!.walls.filter((x) => x.kind === "exterior")) {
      expect(w.across[1] - w.across[0]).toBeCloseTo(0.23, 9);
      expect(Math.abs(Math.abs(w.outerFace!) - (w.axis === "x" ? 15.225 : 18.225))).toBeLessThan(1e-9);
    }
  });

  it("piers between columns have clear length span - 0.45 (masonry butts column faces)", () => {
    const p = byId.get("ARC-WALL-F02-CM-STC-CM-SVC-P01")!; // core wall on gridline E between columns E3 and E4, no openings
    expect(p.dimensions.length).toBeCloseTo(6 - 0.45, 9);
  });

  it("no gaps: every wall line is covered by wall pieces, columns or openings (sampled every 5 cm)", () => {
    const misses: string[] = [];
    for (const st of model.storeys) {
      const bounds = floorBoundaries(st.plan);
      const cols = columnRects(cfg, st.plan.storey);
      const pieces = st.walls.flatMap((w) => w.pieces.map((p) => p.box));
      const ops = st.walls.flatMap((w) => w.openings.map((o) => ({ w, o })));
      const y = d.slabTop(st.plan.storey) + 0.5; // below every window sill, inside every door
      for (const b of bounds) {
        if (b.kind === "open") continue;
        const fp = wallFootprint(b, cfg);
        const mid = b.line.axis === "x" ? (fp.z0 + fp.z1) / 2 : (fp.x0 + fp.x1) / 2;
        for (let s = b.s0 + 0.025; s < b.s1; s += 0.05) {
          const [px, pz] = b.line.axis === "x" ? [s, mid] : [mid, s];
          const inBox = (mn: readonly number[], mx: readonly number[]) => px >= mn[0]! - 1e-9 && px <= mx[0]! + 1e-9 && pz >= mn[2]! - 1e-9 && pz <= mx[2]! + 1e-9 && y >= mn[1]! && y <= mx[1]!;
          const covered =
            pieces.some((p) => inBox(p.min, p.max)) ||
            cols.some((c) => px >= c.x0 && px <= c.x1 && pz >= c.z0 && pz <= c.z1) ||
            ops.some(({ w, o }) => w.axis === b.line.axis && Math.abs(w.boundary.line.c - b.line.c) < 1e-9 && s >= o.o0 - 1e-9 && s <= o.o1 + 1e-9);
          if (!covered) misses.push(`storey ${st.plan.storey} ${b.low}|${b.high} at ${s.toFixed(3)}`);
        }
      }
    }
    expect(misses.slice(0, 10)).toEqual([]);
  });
});

describe("openings", () => {
  it("every planned door and window has an assembly; windows hold frame, sashes, glazing and sill", () => {
    for (const st of model.storeys) {
      for (const w of st.plan.windows) {
        const id = `ARC-WIN-${st.plan.storey === 0 ? "G" : `F0${st.plan.storey}`}-${w.key}`;
        const kids = records.filter((r) => r.parentId === id).map((r) => r.componentType);
        expect(kids, id).toContain("window_frame");
        expect(kids).toContain("window_sash");
        expect(kids).toContain("glazing");
        expect(kids).toContain("window_sill");
      }
      for (const dr of st.plan.doors) {
        const id = `ARC-DOOR-${st.plan.storey === 0 ? "G" : `F0${st.plan.storey}`}-${dr.key}`;
        const kids = records.filter((r) => r.parentId === id).map((r) => r.componentType);
        expect(kids, id).toContain("door_threshold");
        if (dr.typeKey !== "OP") {
          expect(kids).toContain("door_frame");
          expect(kids).toContain("door_hinge");
          expect(kids).toContain("door_handle");
        }
      }
    }
  });

  it("window heads at FFL + 2.1 (frame head = head - tolerance), all below the finished ceiling", () => {
    const tol = ARCH_CONFIG.openings.fitTolerance;
    const heads = records.filter((x) => x.id.endsWith("-FRM-H") && x.id.startsWith("ARC-WIN-"));
    expect(heads).toHaveLength(model.storeys.reduce((n, st) => n + st.plan.windows.length, 0)); // 171
    for (const r of heads) {
      const b = recordBounds(r);
      expect(b.max[1]).toBeCloseTo(d.ffl(r.floor) + 2.1 - tol, 9); // every family (incl. V1) heads at FFL + 2.1
      expect(b.max[1]).toBeLessThan(d.ceiling(r.floor));
    }
  });

  it("frames fit their openings with the configured tolerance and sit 0.115 behind the outer face", () => {
    const frm = recordBounds(byId.get("ARC-WIN-F01-A1-BED1-S-01-FRM-L")!);
    const sill = recordBounds(byId.get("ARC-WIN-F01-A1-BED1-S-01-SIL")!); // the stone sill spans the structural opening
    expect(frm.min[0] - sill.min[0]).toBeCloseTo(ARCH_CONFIG.openings.fitTolerance, 9);
    expect(-15.225 + ARCH_CONFIG.openings.revealDepth - frm.min[2]).toBeCloseTo(0, 9);
  });

  it("exterior casement windows carry a sunshade on the lintel band; sliders and ventilators do not", () => {
    expect(byId.has("ARC-WIN-F01-A1-BED1-S-01-SHD")).toBe(true);
    expect(byId.has("ARC-WIN-F01-A1-LIV-S-01-SHD")).toBe(false); // SL slider to the balcony
    const shd = recordBounds(byId.get("ARC-WIN-F01-A1-BED1-S-01-SHD")!);
    expect(shd.max[1]).toBeCloseTo(d.ffl(1) + 2.1 + ARCH_CONFIG.openings.lintelDepth, 9);
  });
});

describe("envelope elements present", () => {
  const types = new Set(records.map((r) => r.componentType));
  it.each([
    "balcony_slab", "balcony_soffit", "balcony_finish", "balcony_kerb", "balcony_post", "balcony_baluster", "balcony_handrail", "balcony_outlet",
    "facade_fin", "facade_band", "column_cladding", "window_sunshade", "plinth_cladding", "plinth_cap", "facade_downpipe", "facade_rainwater_head", "facade_sign", "light_fixture",
    "entrance_landing", "entrance_step", "entrance_canopy", "parapet", "coping", "roof_finish", "enclosure_slab", "shaft_cap", "roof_drain",
  ])("%s", (t) => expect(types.has(t)).toBe(true));

  it("24 balconies on F01-F04 + 6 roof canopies; roof-access door exists", () => {
    expect(records.filter((r) => r.assemblyType === "balcony" && r.geometry.kind === "group")).toHaveLength(24);
    expect(records.filter((r) => r.assemblyType === "balcony_canopy" && r.geometry.kind === "group")).toHaveLength(6);
    expect(byId.has("ARC-DOOR-RF-MUM-S-01")).toBe(true);
  });

  it("entrance steps climb from site grade to FFL in equal risers", () => {
    const steps = records.filter((r) => r.componentType === "entrance_step" || r.componentType === "entrance_landing").map((r) => recordBounds(r).max[1]).sort((a, b) => a - b);
    const rises = [steps[0]! - ARCH_CONFIG.datums.siteGrade, ...steps.slice(1).map((v, i) => v - steps[i]!)];
    for (const r of rises) expect(r).toBeCloseTo((d.ffl(0) - ARCH_CONFIG.datums.siteGrade) / ARCH_CONFIG.entrance.risers, 9);
    expect(steps[steps.length - 1]).toBeCloseTo(d.ffl(0), 9);
  });
});
