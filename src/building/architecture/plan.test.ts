import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../config";
import { ARCH_CONFIG, archDatums, validateArchConfig } from "./config";
import { ARCH_MATERIALS } from "./materials";
import { floorBoundaries, clearRect } from "./boundaries";
import { buildFloorPlan, type FloorPlan } from "./plan";
import { checkClearDims, checkConnectivity, checkOpeningsFit, checkSwings, checkTiling, validatePlan } from "./validatePlan";
import { rectD, rectW } from "./rect";

const cfg = DEFAULT_CONFIG;
const plans = [0, 1, 2, 3, 4].map((s) => buildFloorPlan(cfg, s));
const [ground, typical, , , top] = plans as [FloorPlan, FloorPlan, FloorPlan, FloorPlan, FloorPlan];

describe("architecture config", () => {
  it("is consistent with itself and with the structure", () => {
    expect(validateArchConfig(cfg)).toEqual([]);
  });

  it("datums: FFL = slab top + 0.05, wall top = beam soffit (clear 3.1), ceiling = FFL + 2.8", () => {
    const d = archDatums(cfg);
    expect(d.ffl(1)).toBeCloseTo(3.65, 9);
    expect(d.wallTop(1)).toBeCloseTo(7.2 - 0.5, 9);
    expect(d.clearHeight).toBeCloseTo(3.1, 9);
    expect(d.ceiling(0)).toBeCloseTo(2.85, 9);
  });

  it("every opening head + lintel fits under the beam soffit; window heads are at FFL + 2.1", () => {
    for (const w of Object.values(ARCH_CONFIG.windowTypes)) {
      if (w.style !== "tophung") expect(w.sill + w.height).toBeCloseTo(2.1, 9);
      expect(ARCH_CONFIG.datums.floorBuildUp + w.sill + w.height + ARCH_CONFIG.openings.lintelDepth).toBeLessThanOrEqual(3.1 + 1e-9);
    }
  });

  it("material library ids are unique", () => {
    expect(new Set(ARCH_MATERIALS.map((m) => m.id)).size).toBe(ARCH_MATERIALS.length);
  });
});

describe("floor plans", () => {
  it("ground has 5 apartments + the common entrance block; floors 1-4 have 6 apartments", () => {
    const apts = (p: FloorPlan) => p.apartments.map((a) => a.id).filter((id) => id !== "CM");
    expect(apts(ground)).toEqual(["A1", "A3", "A4", "A5", "A6"]);
    expect(ground.rooms.filter((r) => r.aptId === "CM").map((r) => r.code)).toEqual(["COR", "STC", "SVC", "SHF", "SOC", "SEC", "TLT", "MTR", "LOB"]);
    for (const p of plans.slice(1)) expect(apts(p)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);
    expect(top.kind).toBe("top");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildFloorPlan(cfg, 2))).toBe(JSON.stringify(plans[2]));
  });

  it("room ids and door/window keys are unique per floor", () => {
    for (const p of plans) {
      const ids = p.rooms.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const keys of [p.doors.map((d) => d.key), p.windows.map((w) => w.key)]) expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("balconies: none at ground, one per apartment on floors 1-4, all on the long facades", () => {
    expect(ground.balconies).toHaveLength(0);
    for (const p of plans.slice(1)) {
      expect(p.balconies).toHaveLength(6);
      for (const b of p.balconies) {
        expect(["N", "S"]).toContain(b.side);
        expect(b.bay[1] - b.bay[0]).toBeCloseTo(6, 9); // one structural bay
      }
    }
  });

  it("ground living rooms get windows where upper floors get balcony sliders", () => {
    const liv = (p: FloorPlan) => p.windows.filter((w) => w.roomId === "A1-LIV" && w.side === "S").map((w) => w.typeKey);
    expect(liv(ground)).toEqual(["W3"]);
    expect(liv(typical)).toEqual(["SL"]);
  });
});

describe("plan validation (rooms, connectivity, clearances, swings, openings)", () => {
  plans.forEach((p) => {
    it(`storey ${p.storey}: rooms tile the floor and each apartment envelope`, () => expect(checkTiling(p)).toEqual([]));
    it(`storey ${p.storey}: every room reachable from its entrance; every apartment reaches the stair`, () =>
      expect(checkConnectivity(p)).toEqual([]));
    it(`storey ${p.storey}: minimum clear dimensions`, () => expect(checkClearDims(p, cfg)).toEqual([]));
    it(`storey ${p.storey}: door swings stay in their room, miss columns and each other`, () => expect(checkSwings(p, cfg)).toEqual([]));
    it(`storey ${p.storey}: openings fit their walls, clear of columns and junctions`, () => expect(checkOpeningsFit(p, cfg)).toEqual([]));
  });

  it("walls: exterior 0.23, corridor/core/party 0.23, partitions 0.115", () => {
    const b = floorBoundaries(typical);
    const between = (a: string, c: string) => b.find((x) => (x.low === a && x.high === c) || (x.low === c && x.high === a));
    expect(between("A1-FOY", "CM-COR")?.kind).toBe("core");
    expect(between("A1-BED1", "A2-BED1")?.kind).toBe("party");
    expect(between("A1-BED1", "A1-BED2")?.thickness).toBeCloseTo(0.115, 9);
    expect(between("A1-LIV", "A1-DIN")?.kind).toBe("open");
    expect(b.filter((x) => x.kind === "exterior").every((x) => x.thickness === 0.23)).toBe(true);
  });

  it("corridor clear width 1.57 m between wall faces (1.46 m at the columns)", () => {
    const b = floorBoundaries(typical);
    const cor = typical.rooms.find((r) => r.id === "CM-COR")!;
    const c = clearRect(cor.rects[0]!, cor.id, b, cfg);
    expect(rectD(c)).toBeCloseTo(1.8 - 0.115 - 0.115, 9);
    expect(rectW(c)).toBeCloseTo(36 - 2 * 0.005, 9);
  });
});

describe("validators catch broken plans (mutation checks)", () => {
  const mutate = (p: FloorPlan, f: (q: { -readonly [K in keyof FloorPlan]: FloorPlan[K] }) => void): FloorPlan => {
    const q = JSON.parse(JSON.stringify(p)) as { -readonly [K in keyof FloorPlan]: FloorPlan[K] };
    f(q);
    return q;
  };

  it("a missing bedroom door breaks connectivity", () => {
    const bad = mutate(typical, (q) => {
      q.doors = q.doors.filter((d) => d.key !== "A1-BED2-N-01" && !(d.swingInto === "A1-BED2"));
    });
    expect(checkConnectivity(bad).some((e) => e.includes("A1-BED2"))).toBe(true);
  });

  it("an overlapping room breaks tiling", () => {
    const bad = mutate(typical, (q) => {
      const r = q.rooms.find((x) => x.id === "A1-KIT")! as unknown as { rects: { x1: number }[] };
      r.rects[0]!.x1 += 0.3;
    });
    expect(checkTiling(bad).length).toBeGreaterThan(0);
  });

  it("a door slid onto a column is rejected", () => {
    const bad = mutate(typical, (q) => {
      const d = q.doors.find((x) => x.swingInto === "A1-BATH2")! as { centre: number };
      d.centre = -12 + 0.6; // 0.375 m half width: the jamb lands on column B3 (x = -12)
    });
    expect(checkOpeningsFit(bad, cfg).some((e) => e.includes("column"))).toBe(true);
  });

  it("two doors swinging into each other are rejected", () => {
    // Both passage-side doors (bedroom and widened kitchen door) re-hung to open into the passage.
    const bad = mutate(typical, (q) => {
      type W = { swingInto: string; side: string; typeKey: string; width: number; hingeAt: number; centre: number };
      const bed = q.doors.find((x) => x.swingInto === "A1-BED1" && x.rooms.includes("A1-PAS"))! as W;
      const kit = q.doors.find((x) => x.swingInto === "A1-KIT")! as W;
      for (const d of [bed, kit]) {
        d.swingInto = "A1-PAS";
        d.side = d.side === "N" ? "S" : "N";
      }
      kit.typeKey = "MD";
      kit.width = ARCH_CONFIG.doorTypes.MD.width;
      kit.hingeAt = kit.centre - kit.width / 2; // hung from the same end as the bedroom door
    });
    expect(checkSwings(bad, cfg).some((e) => e.startsWith("swings overlap"))).toBe(true);
    expect(validatePlan(typical, cfg)).toEqual([]);
  });
});
