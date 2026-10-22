import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../config";
import { buildGrid, deriveStair, getStructure, recordBounds, type ComponentRecord } from "../structure";
import { ARCH_CONFIG, archDatums } from "./config";
import { generateArchitectureModel } from "./generate";
import { generateStairFinishes } from "./stairFinish";
import { findOverlaps } from "./validateComponents";

const cfg = DEFAULT_CONFIG;
const model = generateArchitectureModel(cfg);
const records = model.records;
const byId = new Map(records.map((r) => [r.id, r]));
const structure = getStructure(cfg);
const d = archDatums(cfg);
const st = deriveStair(buildGrid(cfg));
const of = (t: string) => records.filter((r) => r.componentType === t);

describe("stair finish rule", () => {
  const { levels } = generateStairFinishes(cfg);

  it("finishes every stair storey including the roof-access flight (5 storeys)", () => {
    expect(levels).toHaveLength(st.storeyCount);
    expect(st.storeyCount).toBe(5);
  });

  it("every finished riser equals the A1 riser height; bottom = FFL, top = next FFL", () => {
    for (const l of levels) {
      const steps = [l.ffl, ...l.treadTops, l.nextFfl];
      expect(steps).toHaveLength(cfg.stair.risersPerStorey + 1);
      for (let i = 1; i < steps.length; i++) expect(steps[i]! - steps[i - 1]!).toBeCloseTo(cfg.stair.riserHeight, 9);
      expect(steps[0]).toBeCloseTo(d.ffl(levels.indexOf(l)), 9);
    }
  });

  it("tread finish thickness equals the floor build-up (so no riser adjustment is needed)", () => {
    expect(ARCH_CONFIG.stairFinish.tread).toBe(ARCH_CONFIG.datums.floorBuildUp);
  });

  it("each flight has 11 treads, 12 riser linings, 11 balusters and a sloping handrail", () => {
    for (const fl of ["ARC-STAIRFIN-F02-FL1", "ARC-STAIRFIN-F02-FL2"]) {
      const kids = records.filter((r) => r.parentId === fl);
      expect(kids.filter((r) => r.componentType === "stair_tread")).toHaveLength(11);
      expect(kids.filter((r) => r.componentType === "stair_riser")).toHaveLength(12);
      expect(kids.filter((r) => r.componentType === "stair_baluster")).toHaveLength(11);
      const rail = kids.find((r) => r.componentType === "stair_handrail")!;
      expect(rail.originalRotation[0]).not.toBe(0);
    }
  });

  it("the stair well stays clear: lining walls stand outside the slab opening", () => {
    const op = { x0: 1.6, x1: 4.4, z0: -2.7, z1: 2.7 };
    for (const r of records.filter((x) => x.id.includes("-CM-STC-WELL-"))) {
      const b = recordBounds(r);
      const inside = b.min[0] < op.x1 - 1e-9 && b.max[0] > op.x0 + 1e-9 && b.min[2] < op.z1 - 1e-9 && b.max[2] > op.z0 + 1e-9;
      expect(inside, r.id).toBe(false);
    }
  });

  it("exact sloped-member check catches planted faults (mutation controls)", () => {
    const tread = byId.get("ARC-STAIRFIN-F01-FL1-TRD05")!;
    const sunk: ComponentRecord = { ...tread, originalPosition: [tread.originalPosition[0], tread.originalPosition[1] - 0.03, tread.originalPosition[2]] };
    expect(findOverlaps([sunk], structure).length).toBeGreaterThan(0); // into the A1 flight
    const bal = byId.get("ARC-STAIRFIN-F01-FL1-BLS05")!;
    const raised: ComponentRecord = { ...bal, originalPosition: [bal.originalPosition[0], bal.originalPosition[1] + 0.05, bal.originalPosition[2]] };
    expect(findOverlaps([raised, byId.get("ARC-STAIRFIN-F01-FL1-HRL")!]).length).toBe(1); // into the sloping rail
    expect(findOverlaps([bal, byId.get("ARC-STAIRFIN-F01-FL1-HRL")!])).toEqual([]);
  });
});

describe("floor finishes", () => {
  it("tiles top out at FFL = slab top + 0.05; screed below", () => {
    for (const t of of("floor_tile").slice(0, 2000)) expect(recordBounds(t).max[1]).toBeCloseTo(d.ffl(t.floor), 9);
    for (const t of of("floor_screed")) expect(recordBounds(t).min[1]).toBeCloseTo(d.slabTop(t.floor), 9);
  });

  it("wet rooms use 300 mm anti-skid tiles, dry rooms 600 mm porcelain", () => {
    const bath = records.find((r) => r.id === "ARC-TILE-F01-A1-BATH2-R02C02")!;
    expect(bath.materialId).toBe("tile_antiskid");
    expect(bath.dimensions.length).toBeCloseTo(0.3 - ARCH_CONFIG.floor.grout, 9);
    const liv = records.find((r) => r.id === "ARC-TILE-F01-A1-LIV-R02C02")!;
    expect(liv.materialId).toBe("tile_porcelain_floor");
    expect(liv.dimensions.length).toBeCloseTo(0.6 - ARCH_CONFIG.floor.grout, 9);
  });

  it("tiles cover the screed (minus grout joints) in every room", () => {
    const area = (rs: ComponentRecord[]) => rs.reduce((s, r) => s + r.quantity, 0);
    for (const asm of records.filter((r) => r.assemblyType === "floor_finish" && r.geometry.kind === "group")) {
      const kids = records.filter((r) => r.parentId === asm.id);
      const screed = area(kids.filter((r) => r.componentType === "floor_screed"));
      const tiles = area(kids.filter((r) => r.componentType === "floor_tile"));
      expect(tiles / screed, asm.id).toBeGreaterThan(0.97);
      expect(tiles).toBeLessThanOrEqual(screed + 1e-9);
    }
  });

  it("skirting sits on the tiles in dry rooms only", () => {
    const sk = of("skirting");
    expect(sk.length).toBeGreaterThan(500);
    for (const r of sk) expect(recordBounds(r).min[1]).toBeCloseTo(d.ffl(r.floor), 9);
    expect(sk.some((r) => /BATH|KIT|UTL|TLT/.test(r.id))).toBe(false);
  });
});

describe("ceilings", () => {
  it("field boards at FFL + 2.8; cove bands dropped in living rooms and bedrooms", () => {
    for (const r of of("ceiling_board")) expect(recordBounds(r).min[1]).toBeCloseTo(d.ceiling(r.floor), 9);
    const cove = of("ceiling_cove");
    expect(cove.some((r) => r.roomId === "A1-LIV")).toBe(true);
    expect(cove.some((r) => r.roomId === "A1-BATH1")).toBe(false);
    for (const r of cove) expect(recordBounds(r).min[1]).toBeCloseTo(d.ceiling(r.floor) - ARCH_CONFIG.ceiling.cove.drop, 9);
  });

  it("ceilings never touch walls or columns: at least the 5 mm shadow gap in plan", () => {
    const gap = ARCH_CONFIG.ceiling.shadowGap;
    const solids = [...records.filter((r) => r.assembly === "exteriorWalls" || r.assembly === "partitions"), ...structure.filter((r) => r.componentType === "column")].filter((r) => r.geometry.kind !== "group").map(recordBounds);
    const bad: string[] = [];
    for (const c of [...of("ceiling_board"), ...of("ceiling_cove")].filter((r) => r.floor === 1)) {
      const b = recordBounds(c);
      for (const w of solids) {
        if (w.max[1] < b.min[1] || w.min[1] > b.max[1]) continue;
        const dx = Math.max(w.min[0] - b.max[0], b.min[0] - w.max[0]);
        const dz = Math.max(w.min[2] - b.max[2], b.min[2] - w.max[2]);
        if (Math.max(dx, dz) < gap - 1e-9) bad.push(c.id);
      }
    }
    expect(bad).toEqual([]);
  });

  it("ceiling light fittings hang under the ceiling and travel with the ceiling layer", () => {
    const lights = records.filter((r) => r.componentType.startsWith("light_") && r.id.startsWith("ARC-FIX-"));
    expect(lights.length).toBeGreaterThan(300);
    for (const l of lights) expect(l.assembly).toBe("ceilings");
  });
});

describe("wet-room wall tiling", () => {
  it("bathrooms and toilets are tiled to FFL + 2.1 with thin panels; doors stay open", () => {
    const panels = of("wall_tile_panel");
    expect(new Set(panels.filter((p) => p.floor === 1).map((p) => p.roomId)).size).toBe(6 * 2 + 3 + 1); // BATH1 + BATH2 in 6 apartments, BATH3 in A4-A6, BATH4 in A4
    for (const p of panels) {
      const b = recordBounds(p);
      expect(b.min[1]).toBeCloseTo(d.ffl(p.floor), 9);
      expect(b.max[1]).toBeLessThanOrEqual(d.ffl(p.floor) + ARCH_CONFIG.tiling.wetDadoHeight + 1e-9);
      expect(Math.min(p.dimensions.thickness!, p.dimensions.length!, p.dimensions.height!)).toBeCloseTo(ARCH_CONFIG.tiling.thickness, 9);
    }
  });
});
