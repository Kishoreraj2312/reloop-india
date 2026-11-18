import { describe, expect, it } from "vitest";
import { buildInventory, getModelInventory, type Inventory } from "@/engine/quantities";
import { box, rec } from "@/engine/quantities/testing";
import { applyPatch, serializeAssessments, type Assessments } from "@/engine/recovery";
import { makeRule, newScenario, setCategoryRule, setComponentRule, type Scenario } from "@/engine/scenarios";
import {
  collect,
  collectCached,
  EMPTY_ASSUMPTIONS,
  emptyFactor,
  illustrativeFactors,
  massOf,
  measureIn,
  parseCarbon,
  parseNonNegative,
  priceBaseline,
  priceScenario,
  removeFactor,
  sensitivity,
  serializeCarbon,
  setCategoryValue,
  setFactor,
  setReplacement,
  setTransport,
  validateFactor,
  type Assumptions,
  type EmissionFactor,
  type FactorLibrary,
} from "./index";

const EMPTY: Assessments = new Map();
const near = (a: number | null, b: number, tol = 1e-9) => {
  expect(a).not.toBeNull();
  expect(Math.abs(a! - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
};
const fac = (category: string, basis: EmissionFactor["basis"], value: number | null, extra: Partial<EmissionFactor> = {}): EmissionFactor => ({ ...emptyFactor(category, basis), value, origin: "assumed", boundary: "A1–A3 (test)", ...extra });
const lib = (...f: EmissionFactor[]): FactorLibrary => new Map(f.map((x) => [x.category, x]));
const must = <T extends { error: string | null }>(r: T): T => {
  expect(r.error).toBeNull();
  return r;
};
const asm = (over: Partial<Assumptions> = {}): Assumptions => ({ ...EMPTY_ASSUMPTIONS, ...over });
const scn = (rules: [string, ReturnType<typeof makeRule>][] = []): Scenario => {
  let s = newScenario("s", "S", "conventional", []);
  for (const [c, r] of rules) s = setCategoryRule(s, c, r).scenario;
  return s;
};

// small deterministic building: 10 m³ concrete slab (24,000 kg at 2,400 kg/m³), 4 m² tile, 2 WC pans, a 3 m pvc pipe with no density
const records = [
  rec({ id: "C1", componentType: "slab", geometry: box(5, 2, 1), unit: "m3", quantity: 10, materialId: "rcc_conceptual" }),
  rec({ id: "T1", componentType: "floor_tile", geometry: box(2, 2, 0.01), unit: "m2", quantity: 4, materialId: "tile_antiskid" }),
  rec({ id: "W1", componentType: "wc_pan", geometry: box(0.4, 0.4, 0.4), unit: "nr", quantity: 1, materialId: "sanitary_ceramic" }),
  rec({ id: "W2", componentType: "wc_pan", geometry: box(0.4, 0.4, 0.4), unit: "nr", quantity: 1, materialId: "sanitary_ceramic" }),
  rec({ id: "P1", componentType: "pipe", geometry: box(3, 0.05, 0.05), unit: "m", quantity: 3, materialId: "pvc_pipe" }),
];
const inv = buildInventory(records);
const base = (library: FactorLibrary, a = EMPTY_ASSUMPTIONS) => priceBaseline(collect(inv, EMPTY, null, library, a), library);
const row = (b: ReturnType<typeof base>, cat: string) => b.rows.find((r) => r.category === cat)!;

describe("baseline: quantity × emission factor", () => {
  it("10 m³ × 300 kgCO₂e/m³ = 3,000 kgCO₂e; the same slab in kg: 24,000 kg × 0.1 = 2,400", () => {
    near(row(base(lib(fac("concrete", "m3", 300))), "concrete").kgCO2e, 3000);
    near(row(base(lib(fac("concrete", "kg", 0.1))), "concrete").kgCO2e, 2400);
    expect(massOf(inv.rows.find((r) => r.rec.id === "C1")!)).toBeCloseTo(24000, 6);
  });
  it("a density override changes the mass-based result only: 10 m³ × 2,500 kg/m³ × 0.1 = 2,500", () => {
    const a = must(setCategoryValue(EMPTY_ASSUMPTIONS, "densityKgM3", "concrete", 2500)).assumptions;
    near(row(base(lib(fac("concrete", "kg", 0.1)), a), "concrete").kgCO2e, 2500);
    near(row(base(lib(fac("concrete", "m3", 300)), a), "concrete").kgCO2e, 3000); // volume-based factors ignore density
  });
  it("only compatible units: a factor in a unit the component has no measure in is not applied", () => {
    const b = base(lib(fac("pvc", "kg", 5), fac("sanitary_ceramic", "m3", 5), fac("ceramic_tile", "m", 5)));
    for (const c of ["pvc", "sanitary_ceramic", "ceramic_tile"]) {
      expect(row(b, c).kgCO2e, c).toBeNull();
      expect(row(b, c).status).toBe("unassessed");
    }
    expect(row(b, "pvc").unassessed.no_quantity).toBe(1); // no density -> no mass
    expect(measureIn(inv.rows.find((r) => r.rec.id === "P1")!, "kg")).toBeNull();
    expect(measureIn(inv.rows.find((r) => r.rec.id === "P1")!, "m")).toBe(3);
  });
  it("per-item and per-length factors use the own-unit quantity: 2 WC × 50 + 3 m × 2", () => {
    const b = base(lib(fac("sanitary_ceramic", "nr", 50), fac("pvc", "m", 2)));
    near(row(b, "sanitary_ceramic").kgCO2e, 100);
    near(row(b, "pvc").kgCO2e, 6);
  });
  it("missing factor or value = unassessed (null), never 0; coverage says so", () => {
    const b = base(lib(fac("concrete", "m3", 300), fac("pvc", "m", null)));
    expect(row(b, "pvc").kgCO2e).toBeNull();
    expect(row(b, "ceramic_tile").kgCO2e).toBeNull();
    expect(row(b, "ceramic_tile").unassessed.no_factor).toBe(1);
    expect(b.coverage.assessed).toBe(1);
    expect(b.coverage.components).toBe(5);
    expect(b.coverage.componentPct).toBeCloseTo(20, 9);
    expect([...b.coverage.unassessedCategories].sort()).toEqual(["ceramic_tile", "pvc", "sanitary_ceramic"]);
    expect(base(lib()).totalKg).toBe(0); // the total of nothing assessed is shown with 0 categories assessed, never as an estimate
    expect(base(lib()).rows.every((r) => r.kgCO2e === null)).toBe(true);
  });
  it("a valid zero quantity is assessed as 0; zero factor is a legitimate stated value", () => {
    const z = buildInventory([rec({ id: "Z", componentType: "slab", geometry: box(1, 1, 0), unit: "m3", quantity: 0, materialId: "rcc_conceptual" })]);
    const l = lib(fac("concrete", "m3", 300));
    const r = priceBaseline(collect(z, EMPTY, null, l, EMPTY_ASSUMPTIONS), l).rows[0]!;
    expect(r.status).toBe("unassessed"); // B1 marks an invalid zero-thickness box as unavailable, so nothing is invented
    near(row(base(lib(fac("concrete", "m3", 0))), "concrete").kgCO2e, 0);
  });
  it("totals are kept per assessment boundary and never silently mixed; illustrative use is flagged", () => {
    const b = base(lib(fac("concrete", "m3", 300, { boundary: "A1–A3" }), fac("sanitary_ceramic", "nr", 50, { boundary: "A1–A5" })));
    expect(b.mixedBoundaries).toBe(true);
    expect([...b.byBoundary.keys()].sort()).toEqual(["A1–A3", "A1–A5"]);
    near(b.totalKg, 3100);
    expect(b.usesIllustrative).toBe(false);
    expect(base(lib(fac("concrete", "kg", 0.1, { origin: "illustrative" }))).usesIllustrative).toBe(true);
    expect(row(base(lib(fac("concrete", "m3", 300), fac("sanitary_ceramic", "nr", 100))), "concrete").share).toBeCloseTo((3000 / 3200) * 100, 9);
  });
});

describe("validation: factors, numbers and assumptions", () => {
  it("rejects negative, NaN and unsourced 'sourced' values without changing the library", () => {
    const l0 = lib(fac("concrete", "m3", 300));
    for (const v of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = setFactor(l0, fac("concrete", "m3", v));
      expect(r.error).toBeTruthy();
      expect(r.library).toBe(l0);
    }
    expect(validateFactor(fac("concrete", "m3", 1, { origin: "sourced", sourceName: "" }))).toMatch(/source name/);
    expect(validateFactor(fac("concrete", "m3", 1, { origin: "sourced", sourceName: "EPD No. 123" }))).toBeNull();
    expect(validateFactor(fac("concrete", "m3", null, { origin: "sourced" }))).toBeNull(); // an unset value needs no source
    expect(removeFactor(l0, "concrete").size).toBe(0);
    expect(l0.size).toBe(1);
  });
  it("parses numeric text strictly", () => {
    expect(parseNonNegative("")).toEqual({ value: null, error: null });
    expect(parseNonNegative(" 2.5 ").value).toBe(2.5);
    for (const t of ["abc", "-1", "1e999"]) expect(parseNonNegative(t).error, t).toBeTruthy();
    expect(parseNonNegative("0", { positive: true }).error).toBeTruthy();
    expect(parseNonNegative("101", { max: 100 }).error).toBeTruthy();
  });
  it("assumption edits return the SAME object plus an error when invalid", () => {
    const a = asm();
    for (const bad of [-1, 101, Number.NaN]) {
      const r = setReplacement(a, "direct", bad);
      expect(r.error).toBeTruthy();
      expect(r.assumptions).toBe(a);
    }
    expect(setTransport(a, "recoveredKm", -5).assumptions).toBe(a);
    expect(setCategoryValue(a, "densityKgM3", "concrete", 0).error).toBeTruthy();
    expect(setCategoryValue(a, "refurbishFactor", "concrete", Number.NaN).assumptions).toBe(a);
    const ok = setReplacement(setReplacement(a, "direct", 40).assumptions, "direct", 70, "concrete").assumptions;
    expect(ok.replacement.direct).toBe(40);
    expect(ok.replacementByCategory.concrete?.direct).toBe(70);
    expect(setReplacement(ok, "direct", null, "concrete").assumptions.replacementByCategory).toEqual({});
    expect(a.replacement.direct).toBeNull(); // the original is untouched
  });
});

describe("scenario terms", () => {
  const library = lib(fac("concrete", "m3", 300));
  const recycle80 = () => scn([["concrete", makeRule("recycling", 80)]]);
  const run = (s: Scenario, a: Assumptions, l = library) => priceScenario(collect(inv, EMPTY, s, l, a), l, a);
  const conc = (r: ReturnType<typeof run>) => r.categories.find((c) => c.category === "concrete")!;

  it("quantities come from B4's allocation: 10 m³ at 80 % recycling = 8 m³ recycled, 2 m³ disposal", () => {
    const c = conc(run(recycle80(), asm()));
    near(c.recovered.recycling, 8);
    near(c.disposal, 2);
    expect(c.unknown).toBe(0);
  });
  it("with no replacement / processing / transport inputs nothing is credited and the net is NOT ASSESSED (null, not 0)", () => {
    const r = run(recycle80(), asm());
    const c = conc(r);
    expect(c.status).toBe("not_assessed");
    expect(c.net).toBeNull();
    expect(c.avoided).toBeNull();
    expect(c.missing).toEqual(expect.arrayContaining(["substitution rate: recycling", "recycling processing impact", "recovered haul distance", "transport factor"]));
    expect(r.netKg).toBe(0);
    expect(r.assessedCategories).toBe(0);
    expect(r.notAssessedCategories).toBe(1);
    expect(r.missing.get("transport factor")).toBe(1);
  });
  it("hand calculation: avoided 8 × 50 % × 300 = 1,200; processing 8 × 20 = 160; transport 19.2 t × 10 km × 0.1 = 19.2; net 1,020.8", () => {
    let a = asm();
    a = must(setReplacement(a, "recycling", 50)).assumptions;
    a = must(setCategoryValue(a, "processingFactor", "concrete", 20)).assumptions;
    a = must(setTransport(a, "recoveredKm", 10)).assumptions;
    a = must(setTransport(a, "factorKgPerTonneKm", 0.1)).assumptions;
    const r = run(recycle80(), a);
    const c = conc(r);
    near(c.avoided, 1200);
    near(c.processing, 160);
    near(c.transport, 19.2);
    near(c.net, 1020.8);
    expect(c.status).toBe("assessed");
    near(r.netKg, 1020.8);
    expect(c.disposalTransport).toBeNull(); // 2 m³ is disposed but no disposal distance is given: not assessed, not 0
  });
  it("reuse with an incomplete replacement assumption is not assessed; 0 % replacement is a stated zero benefit", () => {
    const s = scn([["concrete", makeRule("direct_reuse", 100)]]);
    let a = asm();
    a = must(setTransport(must(setTransport(a, "recoveredKm", 0)).assumptions, "factorKgPerTonneKm", 0.1)).assumptions;
    expect(conc(run(s, a)).net).toBeNull();
    expect(conc(run(s, a)).missing).toContain("replacement rate: direct reuse");
    const a0 = must(setReplacement(a, "direct", 0)).assumptions;
    near(conc(run(s, a0)).net, 0); // explicit 0 %: assessed, zero benefit
    expect(conc(run(s, a0)).status).toBe("assessed");
    const a60 = must(setReplacement(a, "direct", 60)).assumptions;
    near(conc(run(s, a60)).net, 10 * 0.6 * 300); // 1,800: only 60 % of the reused concrete displaces new concrete
  });
  it("refurbishment impact is netted; a per-category rate overrides the global one", () => {
    const s = scn([["concrete", makeRule("refurbish_reuse", 50)]]);
    let a = asm();
    a = must(setReplacement(a, "refurbish", 100)).assumptions;
    a = must(setReplacement(a, "refurbish", 40, "concrete")).assumptions;
    a = must(setCategoryValue(a, "refurbishFactor", "concrete", 30)).assumptions;
    a = must(setTransport(must(setTransport(a, "recoveredKm", 0)).assumptions, "factorKgPerTonneKm", 0.1)).assumptions;
    near(conc(run(s, a)).net, 5 * 0.4 * 300 - 5 * 30); // 600 − 150 = 450
  });
  it("recycling and disposal get no automatic credit: disposal-only scenario recovers nothing", () => {
    const r = run(scn([["concrete", makeRule("disposal")]]), asm());
    expect(conc(r).status).toBe("none_recovered");
    expect(conc(r).net).toBeNull();
    expect(r.assessedCategories).toBe(0);
    expect(r.noneRecovered).toBeGreaterThan(0);
  });
  it("transport of a recovered component with no mass cannot be assessed (no guessed density)", () => {
    const l = lib(fac("pvc", "m", 2));
    const s = scn([["pvc", makeRule("recycling", 100)]]);
    let a = must(setReplacement(asm(), "recycling", 100)).assumptions;
    a = must(setCategoryValue(a, "processingFactor", "pvc", 0)).assumptions;
    a = must(setTransport(must(setTransport(a, "recoveredKm", 5)).assumptions, "factorKgPerTonneKm", 0.1)).assumptions;
    const c = priceScenario(collect(inv, EMPTY, s, l, a), l, a).categories.find((x) => x.category === "pvc")!;
    expect(c.status).toBe("not_assessed");
    expect(c.missing).toContain("mass of every recovered component (no density)");
    near(c.avoided, 3 * 2); // the avoided term itself is assessable
    expect(c.transport).toBeNull();
  });
  it("a recovered category without a factor is not assessed and says so", () => {
    const c = conc(run(recycle80(), asm(), lib()));
    expect(c.status).toBe("not_assessed");
    expect(c.missing).toContain("emission factor");
  });
  it("haul of disposed material is reported apart and not netted", () => {
    let a = must(setTransport(must(setTransport(asm(), "disposalKm", 20)).assumptions, "factorKgPerTonneKm", 0.1)).assumptions;
    a = must(setReplacement(a, "recycling", 50)).assumptions;
    a = must(setCategoryValue(a, "processingFactor", "concrete", 0)).assumptions;
    a = must(setTransport(a, "recoveredKm", 0)).assumptions;
    const c = conc(run(recycle80(), a));
    near(c.disposalTransport, 4.8 * 20 * 0.1); // 2 m³ = 4.8 t disposed
    near(c.net, 8 * 0.5 * 300);
  });
  it("outcomes reconcile with the quantity in every category (B4 allocation, once)", () => {
    const col = collect(inv, EMPTY, recycle80(), library, asm());
    for (const a of col.aggs.values()) {
      if (!a.outcome) continue;
      const sum = a.outcome.direct_reuse + a.outcome.refurbish_reuse + a.outcome.recycling + a.outcome.disposal + a.outcome.unknown;
      expect(Math.abs(sum - a.qty), a.category).toBeLessThanOrEqual(1e-9 * Math.max(1, a.qty));
    }
  });
});

describe("sensitivity to the editable assumptions", () => {
  it("varies only inputs that are set, by ±20 %, deterministically", () => {
    const library = lib(fac("concrete", "m3", 300));
    const s = scn([["concrete", makeRule("recycling", 80)]]);
    let a = asm();
    a = must(setReplacement(a, "recycling", 50)).assumptions;
    a = must(setCategoryValue(a, "processingFactor", "concrete", 20)).assumptions;
    a = must(setTransport(must(setTransport(a, "recoveredKm", 10)).assumptions, "factorKgPerTonneKm", 0.1)).assumptions;
    const c = collect(inv, EMPTY, s, library, a);
    const sens = sensitivity(c, library, a);
    near(sens.baseNetKg, 1020.8);
    const rate = sens.rows.find((r) => r.key === "replacement.recycling")!;
    near(rate.lowKg, 8 * 0.4 * 300 - 160 - 19.2); // 780.8
    near(rate.highKg, 8 * 0.6 * 300 - 160 - 19.2); // 1,260.8
    expect(sens.rows.find((r) => r.key === "replacement.direct")).toBeUndefined(); // not set -> not varied
    near(sens.rows.find((r) => r.key === "factor.concrete")!.highKg - sens.baseNetKg, 8 * 0.5 * 300 * 0.2);
    expect(sens.rows[0]!.key === "replacement.recycling" || sens.rows[0]!.key === "factor.concrete").toBe(true); // largest effect first
    expect(JSON.stringify(sensitivity(c, library, a))).toBe(JSON.stringify(sens));
  });
  it("returns nothing when no category of the scenario has an assessed net (no fabricated base of 0)", () => {
    const library = lib(fac("concrete", "m3", 300));
    const a = must(setReplacement(asm(), "recycling", 50)).assumptions; // processing, transport still missing
    const c = collect(inv, EMPTY, scn([["concrete", makeRule("recycling", 80)]]), library, a);
    expect(sensitivity(c, library, a).rows).toEqual([]);
  });
});

describe("persistence and immutability", () => {
  it("round-trips the library and assumptions; drops invalid parts; never repairs to a guess", () => {
    let a = must(setReplacement(asm(), "direct", 40)).assumptions;
    a = must(setCategoryValue(a, "densityKgM3", "concrete", 2500)).assumptions;
    a = must(setTransport(a, "recoveredKm", 0)).assumptions;
    const l = lib(fac("concrete", "m3", 300, { origin: "sourced", sourceName: "EPD X", reference: "https://example.org/x", geography: "IN", quality: "medium" }));
    const back = parseCarbon(serializeCarbon({ factors: l, assumptions: a }));
    expect([...back.factors.values()]).toEqual([...l.values()]);
    expect(back.assumptions).toEqual(a);
    expect(parseCarbon(null).factors.size).toBe(0);
    expect(parseCarbon("{nope").assumptions).toBe(EMPTY_ASSUMPTIONS);
    expect(parseCarbon(JSON.stringify({ version: 9, factors: [] })).factors.size).toBe(0);
    const bad = parseCarbon(JSON.stringify({ version: 1, factors: [{ category: "a", basis: "kg", value: -3 }, { category: "b", basis: "parsec", value: 2, origin: "sourced" }, 7, { category: "c", basis: "kg", value: 1, origin: "sourced" }], assumptions: { replacement: { direct: 500, refurbish: 20 }, transport: { recoveredKm: -1, factorKgPerTonneKm: 0.1 }, densityKgM3: { x: 0, y: 1800 } } }));
    expect(bad.factors.get("a")!.value).toBeNull(); // negative value -> not set
    expect(bad.factors.get("b")!.basis).toBe("kg");
    expect(bad.factors.get("c")!.origin).toBe("assumed"); // 'sourced' without a source is downgraded, not kept
    expect(bad.dropped).toBe(1);
    expect(bad.assumptions.replacement).toEqual({ direct: null, refurbish: 20, recycling: null });
    expect(bad.assumptions.transport).toEqual({ recoveredKm: null, disposalKm: null, factorKgPerTonneKm: 0.1 });
    expect(bad.assumptions.densityKgM3).toEqual({ y: 1800 });
  });
  it("the stored form holds factors and assumptions only (no quantities, scenarios or results)", () => {
    expect(Object.keys(JSON.parse(serializeCarbon({ factors: lib(), assumptions: asm() }))).sort()).toEqual(["assumptions", "factors", "version"]);
  });
  it("calculating, pricing and sensitivity do not change inputs (deep-frozen) or B1 / B2", () => {
    const freeze = <T,>(o: T): T => {
      if (o && typeof o === "object" && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o as object)) freeze(v);
      }
      return o;
    };
    const l = lib(fac("concrete", "m3", 300));
    const a = freeze(must(setReplacement(asm(), "recycling", 50)).assumptions);
    const s = freeze(scn([["concrete", makeRule("recycling", 80)]]));
    const before = inv.rows.map((r) => [r.q.primary.value, r.q.mass.value]).join();
    const c = collect(inv, EMPTY, s, l, a);
    priceScenario(c, l, a);
    sensitivity(c, l, a);
    priceBaseline(c, l);
    expect(inv.rows.map((r) => [r.q.primary.value, r.q.mass.value]).join()).toBe(before);
    expect(collectCached(inv, EMPTY, s, l, a)).toBe(collectCached(inv, EMPTY, s, new Map(l).set("concrete", fac("concrete", "m3", 999)), a)); // a changed VALUE reuses the collection
    expect(collectCached(inv, EMPTY, s, lib(fac("concrete", "kg", 1)), a)).not.toBe(collectCached(inv, EMPTY, s, l, a)); // a changed UNIT does not
  });
});

// ── the real building ────────────────────────────────────────────────────────
const real: Inventory = getModelInventory();
const COLUMN = "STR-COL-F01-A1";

describe("real model", () => {
  const l = illustrativeFactors();
  it("baseline: assessed share is partial and stated; reinforcement is not in the inventory; no assembly is counted", () => {
    const col = collect(real, EMPTY, null, l, EMPTY_ASSUMPTIONS);
    const b = priceBaseline(col, l);
    expect(b.usesIllustrative).toBe(true);
    expect(b.totalKg).toBeGreaterThan(0);
    expect(b.coverage.componentPct).toBeGreaterThan(0);
    expect(b.coverage.componentPct).toBeLessThan(100); // pipes, cables, fixtures have no factor / mass
    expect(b.coverage.massPct).not.toBeNull();
    expect(b.coverage.massPct!).toBeLessThanOrEqual(100);
    expect(b.mixedBoundaries).toBe(false);
    expect(l.has("reinforcing_steel")).toBe(false);
    // components are leaves only: the count equals B1's leaf count and Σ per-category components = leaves
    expect(col.components).toBe(real.rows.length);
    expect(b.rows.reduce((n, r) => n + r.components, 0)).toBe(real.rows.length);
    // independent check: concrete, kg basis = Σ B1 mass of concrete leaves × factor
    let kg = 0;
    for (const r of real.rows) if (r.rec.materialId === "rcc_conceptual" || /^(lintel_rcc|concrete_)/.test(r.rec.materialId)) kg += r.q.mass.value ?? 0;
    near(b.rows.find((r) => r.category === "concrete")!.kgCO2e, kg * 0.13, 1e-9);
    const total = b.rows.reduce((n, r) => n + (r.kgCO2e ?? 0), 0);
    near(b.totalKg, total);
    expect(b.rows[0]!.kgCO2e!).toBeGreaterThanOrEqual(b.rows[1]!.kgCO2e!); // ranked
  });
  it("an assembly rule moves outcomes but never the baseline quantity", () => {
    const wall = real.records.find((r) => r.componentType === "wall_assembly")!.id;
    const s1 = scn();
    const s2 = must(setComponentRule(s1, wall, makeRule("recycling", 50)));
    const c1 = collect(real, EMPTY, s1, l, EMPTY_ASSUMPTIONS);
    const c2 = collect(real, EMPTY, s2.scenario, l, EMPTY_ASSUMPTIONS);
    for (const [k, a] of c1.aggs) near(c2.aggs.get(k)!.qty, a.qty);
    const recycled = (c: typeof c1) => [...c.aggs.values()].reduce((n, a) => n + (a.outcome?.recycling ?? 0), 0);
    expect(recycled(c1)).toBe(0);
    expect(recycled(c2)).toBeGreaterThan(0);
  });
  it("B2 assessments feed the scenario (selective): the assessed column's recovered quantity is exactly 60 % of 0.729 m³", () => {
    const a = applyPatch(real, EMPTY, [COLUMN], { classification: "recycling", recoveryPct: 60 }).map;
    const before = serializeAssessments(a);
    const s = newScenario("x", "", "selective", ["concrete"]);
    const lm3 = lib(fac("concrete", "m3", 300));
    const c = collect(real, a, s, lm3, EMPTY_ASSUMPTIONS);
    near(c.aggs.get("concrete")!.outcome!.recycling, 0.729 * 0.6);
    expect(serializeAssessments(a)).toBe(before);
  });
  it("collection over all leaves is fast", () => {
    const t0 = performance.now();
    collect(real, EMPTY, scn([["concrete", makeRule("recycling", 50)]]), l, EMPTY_ASSUMPTIONS);
    const ms = performance.now() - t0;
    console.log(`[B5] carbon collect: ${ms.toFixed(0)} ms for ${real.rows.length} leaves`);
    expect(ms).toBeLessThan(5000);
  });
});
