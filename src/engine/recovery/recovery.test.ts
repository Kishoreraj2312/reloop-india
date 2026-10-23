import { beforeAll, describe, expect, it } from "vitest";
import { buildInventory, getModelInventory, type Inventory, type InventoryRow } from "@/engine/quantities";
import { box, rec } from "@/engine/quantities/testing";
import {
  applyPatch,
  evaluateRow,
  GROUP_BYS,
  parseAssessments,
  parsePct,
  serializeAssessments,
  summarize,
  suggestFor,
  targetLeafIds,
  validatePct,
  type Assessments,
} from "./index";

const near = (a: number | null, b: number, tol = 1e-9) => {
  expect(a).not.toBeNull();
  expect(Math.abs(a! - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
};
const EMPTY: Assessments = new Map();

let inv: Inventory;
beforeAll(() => {
  inv = getModelInventory();
});
const row = (id: string): InventoryRow => {
  const r = inv.rows.find((x) => x.rec.id === id);
  if (!r) throw new Error(`no row ${id}`);
  return r;
};
const set = (a: Assessments, ids: string[], patch: Parameters<typeof applyPatch>[3]) => applyPatch(inv, a, ids, patch).map;

describe("percentage validation", () => {
  it("accepts 0..100, rejects negative, > 100, NaN, Infinity, non-numbers", () => {
    for (const ok of [0, 0.5, 60, 100]) expect(validatePct(ok)).toBeNull();
    for (const bad of [-1, -0.01, 100.01, 150, Number.NaN, Number.POSITIVE_INFINITY, "60", null, undefined]) expect(validatePct(bad), String(bad)).not.toBeNull();
  });
  it("parses user text", () => {
    expect(parsePct("")).toEqual({ value: null, error: null });
    expect(parsePct(" 60 % ")).toEqual({ value: 60, error: null });
    expect(parsePct("abc").error).toBeTruthy();
    expect(parsePct("-5").error).toMatch(/negative/);
    expect(parsePct("101").error).toMatch(/exceed/);
  });
  it("applyPatch refuses an invalid percentage and changes nothing", () => {
    const r = applyPatch(inv, EMPTY, ["STR-COL-F01-A1"], { classification: "direct_reuse", recoveryPct: 120 });
    expect(r.error).toMatch(/exceed/);
    expect(r.map.size).toBe(0);
    expect(r.applied).toBe(0);
  });
});

describe("hand-calculated recoverable quantities (Available × Recovery %)", () => {
  it("structural column: 0.729 m3 × 60 % = 0.4374 m3", () => {
    const a = set(EMPTY, ["STR-COL-F01-A1"], { classification: "direct_reuse", recoveryPct: 60 });
    const ev = evaluateRow(row("STR-COL-F01-A1"), a.get("STR-COL-F01-A1"));
    near(ev.available.value, 0.729);
    expect(ev.available.unit).toBe("m3");
    near(ev.recoverable, 0.4374);
    expect(ev.formula).toBe("0.729 m³ × 60% = 0.437 m³");
    expect(ev.status).toBe("direct_reuse");
  });

  it("architectural floor tile: 0.597 × 0.3785 = 0.2259645 m2 × 50 % = 0.11298225 m2", () => {
    const id = "ARC-TILE-G-CM-COR-R01C01";
    const a = set(EMPTY, [id], { classification: "recycling", recoveryPct: 50 });
    const ev = evaluateRow(row(id), a.get(id));
    near(ev.available.value, 0.597 * 0.3785, 1e-6);
    expect(ev.available.unit).toBe("m2");
    near(ev.recoverable, (0.597 * 0.3785) / 2, 1e-6);
  });

  it("MEP drain stack: 0.375 m × 25 % = 0.09375 m", () => {
    const id = "PLB-DR-G-A1-P001";
    const a = set(EMPTY, [id], { classification: "recycling", recoveryPct: 25 });
    const ev = evaluateRow(row(id), a.get(id));
    near(ev.available.value, 0.375);
    expect(ev.available.unit).toBe("m");
    near(ev.recoverable, 0.09375);
  });

  it("a counted item: WC pan 1 nr × 100 % = 1 nr", () => {
    const id = "ARC-BATH-G-A1-BATH1-WC-P";
    const ev = evaluateRow(row(id), set(EMPTY, [id], { classification: "direct_reuse", recoveryPct: 100 }).get(id));
    near(ev.recoverable, 1);
    expect(ev.available.unit).toBe("nr");
  });

  it("mass basis: column 1,749.6 kg × 60 % = 1,049.76 kg; a WC pan has no mass so it is unavailable, not 0", () => {
    const col = row("STR-COL-F01-A1");
    const a = set(EMPTY, ["STR-COL-F01-A1", "ARC-BATH-G-A1-BATH1-WC-P"], { classification: "direct_reuse", recoveryPct: 60 });
    const ev = evaluateRow(col, a.get(col.rec.id), "mass");
    near(ev.available.value, 1749.6);
    expect(ev.available.unit).toBe("kg");
    near(ev.recoverable, 1049.76);
    const wc = evaluateRow(row("ARC-BATH-G-A1-BATH1-WC-P"), a.get("ARC-BATH-G-A1-BATH1-WC-P"), "mass");
    expect(wc.available.value).toBeNull();
    expect(wc.recoverable).toBeNull();
    expect(wc.notes.join(" ")).toMatch(/no estimated mass/);
  });

  it("loss is not a second factor: the loss note changes nothing", () => {
    const id = "STR-COL-F01-A1";
    const a = set(EMPTY, [id], { classification: "direct_reuse", recoveryPct: 60, lossNote: "10 % damage expected" });
    near(evaluateRow(row(id), a.get(id)).recoverable, 0.4374);
  });
});

describe("missing data", () => {
  it("not assessed → no recoverable number", () => {
    const ev = evaluateRow(row("STR-COL-F01-A1"), undefined);
    expect(ev.status).toBe("unassessed");
    expect(ev.recoverable).toBeNull();
  });
  it("recovery classification without a percentage → null with a note", () => {
    const id = "STR-COL-F01-A1";
    const ev = evaluateRow(row(id), set(EMPTY, [id], { classification: "recycling" }).get(id));
    expect(ev.recoverable).toBeNull();
    expect(ev.notes).toContain("recovery % not set");
  });
  it("further assessment / insufficient information clear the percentage and recover nothing", () => {
    const id = "STR-COL-F01-A1";
    let a = set(EMPTY, [id], { classification: "direct_reuse", recoveryPct: 80 });
    a = set(a, [id], { classification: "further_assessment" });
    expect(a.get(id)!.recoveryPct).toBeNull();
    const ev = evaluateRow(row(id), a.get(id));
    expect(ev.recoverable).toBeNull();
    expect(ev.status).toBe("further_assessment");
  });
  it("a component with no valid B1 quantity has no available or recoverable figure", () => {
    const bad = rec({ id: "T-BAD", componentType: "beam", geometry: box(1, 0, 1), quantity: 0 });
    const small = buildInventory([bad]);
    const a = applyPatch(small, EMPTY, ["T-BAD"], { classification: "direct_reuse", recoveryPct: 50 }).map;
    const ev = evaluateRow(small.rows[0]!, a.get("T-BAD"));
    expect(ev.available.value).toBeNull();
    expect(ev.recoverable).toBeNull();
    const s = summarize(small, a, { basis: "quantity", groupBy: "status" });
    expect(s.rows[0]).toMatchObject({ components: 1, quantified: 0, unquantified: 1, available: null, recoverable: null });
  });
  it("destination vs classification clash is flagged, not blocked", () => {
    const id = "STR-COL-F01-A1";
    const ev = evaluateRow(row(id), set(EMPTY, [id], { classification: "recycling", recoveryPct: 10, destination: "reuse_other_project" }).get(id));
    expect(ev.notes.join(" ")).toMatch(/disagree/);
  });
});

describe("assessment edits", () => {
  it("edits merge, empty assessments are dropped, and re-applying the same value is a no-op", () => {
    const id = "STR-COL-F01-A1";
    const r1 = applyPatch(inv, EMPTY, [id], { classification: "direct_reuse", recoveryPct: 40 });
    expect(r1.applied).toBe(1);
    const r2 = applyPatch(inv, r1.map, [id], { recoveryPct: 40 });
    expect(r2.applied).toBe(0);
    const r3 = applyPatch(inv, r1.map, [id], { destination: "reuse_same_building", note: "x" });
    expect(r3.map.get(id)).toMatchObject({ classification: "direct_reuse", recoveryPct: 40, destination: "reuse_same_building", note: "x" });
    expect(r1.map.get(id)!.destination).toBeNull(); // the previous map is untouched (immutable update)
    const cleared = applyPatch(inv, r3.map, [id], { classification: null, recoveryPct: null, destination: null, note: "" });
    expect(cleared.map.size).toBe(0);
  });

  it("assemblies and unknown ids are ignored; an assembly edit targets its leaves once", () => {
    const win = "ARC-WIN-G-A1-LIV-S-01";
    const direct = applyPatch(inv, EMPTY, [win, "NOPE"], { classification: "refurbish_reuse", recoveryPct: 50 });
    expect(direct.map.size).toBe(0);
    expect(direct.ignored).toEqual([win, "NOPE"]);
    const leaves = targetLeafIds(inv, win);
    expect(leaves).toHaveLength(26);
    const viaAssembly = applyPatch(inv, EMPTY, [...leaves, ...leaves], { classification: "refurbish_reuse", recoveryPct: 50 });
    expect(viaAssembly.applied).toBe(26); // duplicates in the id list count once
    expect(viaAssembly.map.size).toBe(26);
    expect(targetLeafIds(inv, "STR-COL-F01-A1")).toEqual(["STR-COL-F01-A1"]);
  });
});

describe("persistence", () => {
  it("round-trips and survives bad input", () => {
    const ids = ["STR-COL-F01-A1", "ARC-TILE-G-CM-COR-R01C01"];
    let a = set(EMPTY, ids, { classification: "recycling", recoveryPct: 33.5, destination: "material_recycling", lossNote: "some cracking" });
    a = set(a, [ids[0]!], { preparation: "cleaning", note: "n" });
    const back = parseAssessments(serializeAssessments(a), (id) => inv.byId.has(id));
    expect(back.dropped).toBe(0);
    expect([...back.map]).toEqual([...a].sort((x, y) => (x[0] < y[0] ? -1 : 1)));
    expect(parseAssessments(null).map.size).toBe(0);
    expect(parseAssessments("{not json").map.size).toBe(0);
    expect(parseAssessments('{"version":99,"entries":[]}').map.size).toBe(0);
    const bad = '{"version":1,"entries":[["STR-COL-F01-A1",{"classification":"recycling","recoveryPct":500}],["GONE",{"classification":"recycling"}],[7,{}],["STR-COL-F02-A1",{"classification":"bogus"}]]}';
    const p = parseAssessments(bad, (id) => inv.byId.has(id));
    expect(p.map.get("STR-COL-F01-A1")).toMatchObject({ classification: "recycling", recoveryPct: null }); // invalid % dropped, entry kept
    expect(p.map.has("GONE")).toBe(false);
    expect(p.dropped).toBe(3);
  });
});

describe("recovery inventory (summary)", () => {
  // Hand case: three components, two floors.
  //   A column 0.729 m3 direct reuse 60 %  -> 0.4374
  //   B beam   0.8325 m3 recycling 50 %    -> 0.41625
  //   C beam   0.8325 m3 not assessed
  //   D tile   0.24 m2 recycling 100 %
  const recs = [
    rec({ id: "A", componentType: "column", geometry: box(0.45, 3.6, 0.45), quantity: 0.729, system: "structure", floor: 1 }),
    rec({ id: "B", componentType: "beam", geometry: box(5.55, 0.5, 0.3), quantity: 0.8325, system: "structure", floor: 1 }),
    rec({ id: "C", componentType: "beam", geometry: box(5.55, 0.5, 0.3), quantity: 0.8325, system: "structure", floor: 2 }),
    rec({ id: "D", componentType: "floor_tile", geometry: box(0.6, 0.01, 0.4), unit: "m2", quantity: 0.24, floor: 2, materialId: "tile_porcelain_floor" }),
    rec({ id: "G", componentType: "window_assembly", assemblyType: "window", geometry: { kind: "group", size: [1, 1, 1] }, unit: "nr", quantity: 1, floor: 2 }),
  ];
  const small = buildInventory(recs);
  let a = applyPatch(small, EMPTY, ["A"], { classification: "direct_reuse", recoveryPct: 60 }).map;
  a = applyPatch(small, a, ["B"], { classification: "recycling", recoveryPct: 50 }).map;
  a = applyPatch(small, a, ["D"], { classification: "recycling", recoveryPct: 100 }).map;

  it("hand-checked rows by floor; units stay separate; the assembly is not counted", () => {
    const s = summarize(small, a, { basis: "quantity", groupBy: "floor" });
    expect(s.leafCount).toBe(4);
    expect(s.assessedCount).toBe(3);
    const f1m3 = s.rows.find((r) => r.key === "1" && r.unit === "m3")!;
    near(f1m3.available, 0.729 + 0.8325);
    near(f1m3.recoverable, 0.4374 + 0.41625);
    near(f1m3.pct, ((0.4374 + 0.41625) / (0.729 + 0.8325)) * 100);
    expect(f1m3.requiresAssessment).toBe(0);
    const f2m3 = s.rows.find((r) => r.key === "2" && r.unit === "m3")!;
    near(f2m3.available, 0.8325);
    expect(f2m3.recoverable).toBeNull(); // C is not assessed: no figure, not 0
    near(f2m3.requiresAssessment, 0.8325);
    const f2m2 = s.rows.find((r) => r.key === "2" && r.unit === "m2")!;
    near(f2m2.recoverable, 0.24);
    near(f2m2.pct, 100);
    expect(s.rows.some((r) => r.unit === "nr")).toBe(false); // the window assembly adds nothing
    expect(s.totals.map((t) => t.unit)).toEqual(["m3", "m2"]);
    near(s.totals[0]!.available, 0.729 + 2 * 0.8325);
  });

  it("every grouping gives the same totals per unit (no double counting, no unit mixing)", () => {
    const base = summarize(small, a, { basis: "quantity", groupBy: "floor" }).totals;
    for (const by of GROUP_BYS) {
      const s = summarize(small, a, { basis: "quantity", groupBy: by });
      for (const t of base) {
        const rows = s.rows.filter((r) => r.unit === t.unit);
        near(rows.reduce((x, r) => x + (r.available ?? 0), 0), t.available!);
        near(rows.reduce((x, r) => x + (r.recoverable ?? 0), 0), t.recoverable ?? 0);
        expect(rows.reduce((x, r) => x + r.components, 0)).toBe(t.components);
      }
      expect(s.rows.every((r) => ["m3", "m2", "m", "nr", "kg"].includes(r.unit))).toBe(true);
    }
  });

  it("the pathway and status groupings", () => {
    const withDest = applyPatch(small, a, ["A"], { destination: "reuse_same_building" }).map;
    const p = summarize(small, withDest, { basis: "quantity", groupBy: "pathway" });
    expect(p.rows.find((r) => r.key === "reuse_same_building" && r.unit === "m3")!.components).toBe(1);
    expect(p.rows.find((r) => r.key === "none" && r.unit === "m3")!.components).toBe(2);
    const st = summarize(small, a, { basis: "quantity", groupBy: "status" });
    near(st.rows.find((r) => r.key === "unassessed")!.requiresAssessment, 0.8325);
  });

  it("mass basis uses kg only; components without a mass are unquantified", () => {
    const s = summarize(small, a, { basis: "mass", groupBy: "status" });
    expect(new Set(s.rows.map((r) => r.unit))).toEqual(new Set(["kg"]));
    near(s.totals[0]!.available, 2400 * (0.729 + 2 * 0.8325) + 0.6 * 0.01 * 0.4 * 2400); // three RCC members + the tile (5.76 kg)
    near(s.totals[0]!.recoverable, 2400 * (0.4374 + 0.41625) + 5.76); // tile at 100 %
  });
});

describe("real model: no double counting", () => {
  it("assess every leaf under every wall assembly once: Σ recoverable = Σ available × pct", () => {
    const walls = inv.records.filter((r) => r.componentType === "wall_assembly").map((r) => r.id);
    const ids = walls.flatMap((w) => targetLeafIds(inv, w));
    expect(new Set(ids).size).toBe(ids.length); // each leaf belongs to one assembly
    const r = applyPatch(inv, EMPTY, ids, { classification: "recycling", recoveryPct: 50 });
    expect(r.applied).toBe(ids.length);
    const s = summarize(inv, r.map, { basis: "quantity", groupBy: "componentCategory" });
    const masonry = s.rows.filter((x) => x.key === "masonry");
    const concrete = s.rows.filter((x) => x.key === "concrete" && x.unit === "m3");
    // wall-assembly leaves: masonry pieces + lintel concrete; recoverable = half of what they hold
    const wallMasonry = inv.walls.reduce((x, w) => x + w.net.value!, 0);
    near(masonry[0]!.recoverable, wallMasonry / 2, 1e-9);
    expect(concrete[0]!.recoverable).not.toBeNull();
    expect(s.assessedCount).toBe(ids.length);
  });

  it("every category has a suggestion; structure is always 'further assessment'", () => {
    for (const r of inv.rows.slice(0, 5000)) expect(suggestFor(r.rec, r.q.category).classification).toBeTruthy();
    expect(suggestFor(row("STR-COL-F01-A1").rec, "concrete").classification).toBe("further_assessment");
    expect(suggestFor(row("ARC-TILE-G-CM-COR-R01C01").rec, "tile_floor").classification).toBe("recycling");
    // no suggestion carries a number
    for (const r of inv.rows.filter((_, i) => i % 997 === 0)) expect(JSON.stringify(suggestFor(r.rec, r.q.category))).not.toMatch(/\d\s*%/);
  });

  it("summaries over the full model are fast", () => {
    const t0 = performance.now();
    summarize(inv, EMPTY, { basis: "quantity", groupBy: "materialCategory" });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
