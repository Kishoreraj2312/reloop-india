import { describe, expect, it } from "vitest";
import { buildInventory, getModelInventory, type Inventory, type Unit } from "@/engine/quantities";
import { box, rec } from "@/engine/quantities/testing";
import { applyPatch, serializeAssessments, substanceOf, type Assessments } from "@/engine/recovery";
import { createPlan } from "@/engine/removal";
import {
  allocate,
  assessedCategories,
  compareRows,
  computeScenario,
  describeDifferences,
  diverted,
  duplicateScenario,
  evaluateLeaf,
  isModified,
  makeContext,
  makeRule,
  matchLeaves,
  MIN_MASS_VOLUME_COVERAGE_PCT,
  nearlyEqual,
  newScenario,
  parseRecoveryPct,
  parseScenarios,
  PATHWAYS,
  removalContext,
  renameScenario,
  resetScenario,
  resolveRule,
  serializeScenarios,
  setBaseline,
  setCategoryRule,
  setComponentRule,
  setComponentRules,
  setResidual,
  setScope,
  totalOfUnit,
  validateRule,
  type CategoryRow,
  type Scenario,
  type TemplateId,
} from "./index";

const EMPTY: Assessments = new Map();
const near = (a: number | null, b: number, tol = 1e-9) => {
  expect(a).not.toBeNull();
  expect(Math.abs(a! - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
};
const mk = (template: TemplateId, assessed: string[] = []) => newScenario(`s-${template}`, "", template, assessed);
const must = (r: { scenario: Scenario; error: string | null }): Scenario => {
  expect(r.error).toBeNull();
  return r.scenario;
};
const row = (rows: readonly CategoryRow[], key: string, unit: Unit): CategoryRow => {
  const r = rows.find((x) => x.key === key && x.unit === unit);
  if (!r) throw new Error(`no row ${key}/${unit}`);
  return r;
};

// ── the calculation itself (hand-checked cases) ──────────────────────────────

describe("allocate: hand-checked cases", () => {
  it("1. 10 m³ to recycling at 80 % -> 8 m³ recycled, 2 m³ residual", () => {
    const toDisposal = allocate(10, "recycling", 80, "disposal");
    expect(toDisposal.recovered).toBe(8);
    expect(toDisposal.residual).toBe(2);
    expect(toDisposal.outcome).toEqual({ direct_reuse: 0, refurbish_reuse: 0, recycling: 8, disposal: 2, unknown: 0 });
    const toUnknown = allocate(10, "recycling", 80, "unknown");
    expect(toUnknown.outcome).toEqual({ direct_reuse: 0, refurbish_reuse: 0, recycling: 8, disposal: 0, unknown: 2 });
    expect(toUnknown.unconfigured).toBe(false);
  });

  it("2. 4 m² to direct reuse with no recovery % -> recovered unavailable, 4 m² unknown", () => {
    const a = allocate(4, "direct_reuse", null, "disposal");
    expect(a.recovered).toBeNull();
    expect(a.unconfigured).toBe(true);
    expect(a.outcome.unknown).toBe(4);
    expect(a.outcome.direct_reuse).toBe(0); // not 0 as a stated recovery: it is unavailable (null above)
    expect(a.outcome.disposal).toBe(0); // the residual destination does not apply to an unconfigured quantity
  });

  it("3. 5 items to disposal -> 5 items disposed", () => {
    const a = allocate(5, "disposal", null, "unknown");
    expect(a.outcome.disposal).toBe(5);
    expect(a.recovered).toBeNull();
    expect(a.residual).toBe(0);
  });

  it("4. 3 linear metres left undecided -> 3 m unknown", () => {
    const a = allocate(3, "unknown", null, "disposal");
    expect(a.outcome.unknown).toBe(3);
    expect(a.unconfigured).toBe(false);
  });

  it("5. 0 % and 100 % recovery", () => {
    const none = allocate(7.5, "refurbish_reuse", 0, "disposal");
    expect(none.recovered).toBe(0);
    expect(none.outcome.refurbish_reuse).toBe(0);
    expect(none.outcome.disposal).toBe(7.5);
    const all = allocate(7.5, "refurbish_reuse", 100, "disposal");
    expect(all.recovered).toBe(7.5);
    expect(all.residual).toBe(0);
    expect(all.outcome.refurbish_reuse).toBe(7.5);
    expect(all.outcome.disposal).toBe(0);
    const fractional = allocate(0.1 + 0.2, "recycling", 100, "disposal"); // no float residue at 100 %
    expect(fractional.residual).toBe(0);
  });

  it("every outcome sums to the allocated quantity (including awkward floats)", () => {
    for (const q of [0, 1e-9, 0.1, 0.3, 1 / 3, 2.5, 1234.5678, 1e6]) {
      for (const pct of [0, 0.1, 33.3333, 50, 66.6667, 99.9, 100]) {
        for (const res of ["disposal", "unknown"] as const) {
          const a = allocate(q, "recycling", pct, res);
          const sum = PATHWAYS.reduce((s, p) => s + a.outcome[p], 0);
          expect(nearlyEqual(sum, q), `${q} @ ${pct}%`).toBe(true);
          expect(a.residual).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("a stored invalid percentage is treated as not configured, never used", () => {
    for (const bad of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      const a = allocate(10, "recycling", bad, "disposal");
      expect(a.recovered).toBeNull();
      expect(a.outcome.unknown).toBe(10);
    }
  });

  it("rejects an unusable quantity instead of inventing one", () => {
    for (const q of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => allocate(q, "disposal", null, "disposal")).toThrow(RangeError);
  });

  it("tolerance hides float noise only, not a real discrepancy", () => {
    expect(nearlyEqual(0.1 + 0.2, 0.3)).toBe(true);
    expect(nearlyEqual(1_000_000, 1_000_000 + 1e-4)).toBe(true);
    expect(nearlyEqual(1000, 1000.001)).toBe(false);
    expect(nearlyEqual(0, 1e-3)).toBe(false);
  });
});

describe("6. invalid percentages are rejected without corrupting the previous state", () => {
  it("editing operations return the SAME scenario and an error", () => {
    const s0 = must(setCategoryRule(mk("conventional"), "concrete", makeRule("recycling", 60)));
    const snapshot = JSON.stringify(s0);
    for (const bad of [-3, 120, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = setCategoryRule(s0, "concrete", makeRule("recycling", bad));
      expect(r.error, String(bad)).toBeTruthy();
      expect(r.scenario).toBe(s0);
      const c = setComponentRule(s0, "STR-COL-F01-A1", makeRule("direct_reuse", bad));
      expect(c.error).toBeTruthy();
      expect(c.scenario).toBe(s0);
      expect(setBaseline(s0, makeRule("recycling", bad)).scenario).toBe(s0);
    }
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  it("a percentage on a pathway that recovers nothing is rejected; text input is parsed strictly", () => {
    const s0 = mk("conventional");
    expect(setCategoryRule(s0, "concrete", { kind: "disposal", recoveryPct: 50, residual: null }).error).toMatch(/reuse and recycling/);
    expect(parseRecoveryPct("abc").error).toBeTruthy();
    expect(parseRecoveryPct("101").error).toMatch(/exceed/);
    expect(parseRecoveryPct("-5").error).toMatch(/negative/);
    expect(parseRecoveryPct("").value).toBeNull();
    expect(parseRecoveryPct(" 70 % ").value).toBe(70);
  });

  it("all-or-nothing bulk edit: one invalid rule changes none", () => {
    const s0 = mk("conventional");
    const r = setComponentRules(s0, ["A", "B"], { kind: "recycling", recoveryPct: 500, residual: null });
    expect(r.error).toBeTruthy();
    expect(r.scenario).toBe(s0);
    expect(setComponentRules(s0, ["A", "B", "A"], makeRule("recycling", 50)).scenario.componentRules).toEqual({ A: makeRule("recycling", 50), B: makeRule("recycling", 50) });
  });

  it("name, residual, baseline and scope are validated", () => {
    const s0 = mk("selective", ["concrete"]);
    expect(renameScenario(s0, "   ").error).toBeTruthy();
    expect(setResidual(s0, "recycling" as never).error).toBeTruthy();
    expect(setBaseline(s0, makeRule("assessment")).error).toMatch(/baseline/);
    expect(setScope(mk("conventional"), ["concrete"]).error).toBeTruthy();
    expect(must(setScope(s0, ["timber", "concrete", "timber"])).scope).toEqual(["concrete", "timber"]);
    expect(validateRule({ kind: "bogus" as never, recoveryPct: null, residual: null })).toBeTruthy();
  });
});

// ── end to end on a small synthetic building (exact numbers) ─────────────────

describe("scenario results on a synthetic inventory", () => {
  const records = [
    rec({ id: "C1", componentType: "slab", geometry: box(5, 2, 1), unit: "m3", quantity: 10, materialId: "rcc_conceptual" }),
    rec({ id: "T1", componentType: "floor_tile", geometry: box(2, 2, 0.01), unit: "m2", quantity: 4, materialId: "tile_antiskid" }),
    ...[1, 2, 3, 4, 5].map((i) => rec({ id: `W${i}`, componentType: "wc_pan", geometry: box(0.4, 0.4, 0.4), unit: "nr", quantity: 1, materialId: "sanitary_ceramic" })),
    rec({ id: "P1", componentType: "pipe", geometry: box(3, 0.05, 0.05), unit: "m", quantity: 3, materialId: "pvc_pipe" }),
  ];
  const inv = buildInventory(records);

  it("units stay separate and each case reproduces the hand calculation", () => {
    let s = mk("conventional");
    s = must(setCategoryRule(s, "concrete", makeRule("recycling", 80)));
    s = must(setCategoryRule(s, "ceramic_tile", makeRule("direct_reuse"))); // no %
    s = must(setCategoryRule(s, "sanitary_ceramic", makeRule("disposal")));
    s = must(setCategoryRule(s, "pvc", makeRule("unknown")));
    const r = computeScenario(inv, EMPTY, s);
    const c = row(r.quantity.rows, "concrete", "m3");
    near(c.available, 10);
    near(c.outcome.recycling, 8);
    near(c.outcome.disposal, 2);
    near(c.residual, 2);
    near(c.diversionPct, 80);
    near(c.unknownPct, 0);
    expect(c.reconciled).toBe(true);
    const t = row(r.quantity.rows, "ceramic_tile", "m2");
    near(t.available, 4);
    near(t.outcome.unknown, 4);
    near(t.unconfigured, 4);
    near(t.unconfiguredBy.direct_reuse, 4); // the recovered quantity of exactly this pathway is unavailable
    expect(t.unconfiguredBy.recycling + t.unconfiguredBy.refurbish_reuse).toBe(0);
    expect(t.outcome.direct_reuse).toBe(0);
    expect(t.diversionPct).toBe(0);
    near(t.unknownPct, 100);
    const w = row(r.quantity.rows, "sanitary_ceramic", "nr");
    near(w.outcome.disposal, 5);
    near(w.allocated.disposal, 5);
    const p = row(r.quantity.rows, "pvc", "m");
    near(p.outcome.unknown, 3);
    expect(r.reconciled).toBe(true);
    // no unit is mixed: four material categories, four units, one total row per unit
    expect(r.quantity.totals.map((x) => x.unit).sort()).toEqual(["m", "m2", "m3", "nr"]);
    for (const tot of r.quantity.totals) expect(tot.components).toBe(tot.unit === "nr" ? 5 : 1);
    // the missing recovery % is reported, with the affected category
    const miss = r.missing.find((m) => m.code === "pct_missing");
    expect(miss?.components).toBe(1);
    expect(miss?.categories).toEqual(["ceramic_tile"]);
    expect(r.missing.find((m) => m.code === "undecided")?.components).toBe(1);
  });

  it("the residual destination moves only the unrecovered share", () => {
    let s = must(setCategoryRule(mk("conventional"), "concrete", makeRule("recycling", 80)));
    s = must(setResidual(s, "unknown"));
    const c = row(computeScenario(inv, EMPTY, s).quantity.rows, "concrete", "m3");
    near(c.outcome.recycling, 8);
    near(c.outcome.unknown, 2);
    expect(c.outcome.disposal).toBe(0);
    // a rule-level residual wins over the scenario default
    const s2 = must(setCategoryRule(s, "concrete", makeRule("recycling", 80, "disposal")));
    const c2 = row(computeScenario(inv, EMPTY, s2).quantity.rows, "concrete", "m3");
    near(c2.outcome.disposal, 2);
    expect(c2.outcome.unknown).toBe(0);
  });

  it("0 % and 100 % through the whole pipeline", () => {
    const at = (pct: number) => row(computeScenario(inv, EMPTY, must(setCategoryRule(mk("conventional"), "concrete", makeRule("recycling", pct)))).quantity.rows, "concrete", "m3");
    expect(at(0).outcome.recycling).toBe(0);
    near(at(0).outcome.disposal, 10);
    expect(at(0).diversionPct).toBe(0);
    near(at(100).outcome.recycling, 10);
    expect(at(100).outcome.disposal).toBe(0);
    near(at(100).diversionPct, 100);
  });

  it("memoises per scenario object and never returns a stale result after an edit", () => {
    const s = mk("conventional");
    expect(computeScenario(inv, EMPTY, s)).toBe(computeScenario(inv, EMPTY, s));
    const edited = must(setCategoryRule(s, "concrete", makeRule("recycling", 10)));
    expect(computeScenario(inv, EMPTY, edited)).not.toBe(computeScenario(inv, EMPTY, s));
    expect(row(computeScenario(inv, EMPTY, s).quantity.rows, "concrete", "m3").outcome.recycling).toBe(0);
  });

  it("components with no B1 value on a basis are counted, not guessed", () => {
    // mass: the pipe (pvc, no density) and the WCs have none; the slab has one
    const r = computeScenario(inv, EMPTY, mk("conventional"));
    const pipe = row(r.mass.rows, "pvc", "kg");
    expect(pipe.quantified).toBe(0);
    expect(pipe.unquantified).toBe(1);
    expect(pipe.available).toBe(0);
    expect(pipe.diversionPct).toBeNull();
    expect(pipe.reconciled).toBe(true);
  });
});

// ── rule resolution ──────────────────────────────────────────────────────────

describe("resolution order: component -> category -> template -> unknown", () => {
  const records = [
    rec({ id: "ASM", componentType: "wall_assembly", assemblyType: "wall", geometry: { kind: "group", size: [1, 1, 1] }, unit: "nr", quantity: 1 }),
    rec({ id: "P-A", componentType: "wall_pier", geometry: box(1, 1, 1), unit: "m3", quantity: 1, materialId: "masonry_paint_int", parentId: "ASM" }),
    rec({ id: "P-B", componentType: "wall_pier", geometry: box(1, 1, 1), unit: "m3", quantity: 1, materialId: "masonry_paint_int", parentId: "ASM" }),
    rec({ id: "SLAB", componentType: "slab", geometry: box(1, 1, 2), unit: "m3", quantity: 2, materialId: "rcc_conceptual" }),
  ];
  const inv = buildInventory(records);
  const ctx = (s: Scenario) => makeContext(inv, EMPTY, s);
  const kindOf = (s: Scenario, id: string) => {
    const r = inv.rows.find((x) => x.rec.id === id)!;
    return evaluateLeaf(ctx(s), r, "quantity").decision.resolved;
  };

  it("a component override beats a category override, which beats the template", () => {
    let s = mk("conventional"); // template: disposal baseline
    expect(kindOf(s, "P-A")).toMatchObject({ source: "template", rule: { kind: "disposal" } });
    s = must(setCategoryRule(s, "brick_masonry", makeRule("recycling", 50)));
    expect(kindOf(s, "P-A")).toMatchObject({ source: "category", rule: { kind: "recycling", recoveryPct: 50 } });
    expect(kindOf(s, "SLAB")).toMatchObject({ source: "template" });
    s = must(setComponentRule(s, "P-A", makeRule("direct_reuse", 90)));
    expect(kindOf(s, "P-A")).toMatchObject({ source: "component", viaId: "P-A", rule: { kind: "direct_reuse", recoveryPct: 90 } });
    expect(kindOf(s, "P-B")).toMatchObject({ source: "category" });
  });

  it("an assembly override reaches its parts; a part's own override wins; each part is counted once", () => {
    let s = must(setComponentRule(mk("conventional"), "ASM", makeRule("recycling", 40)));
    expect(kindOf(s, "P-A")).toMatchObject({ source: "assembly", viaId: "ASM", rule: { recoveryPct: 40 } });
    expect(kindOf(s, "P-B")).toMatchObject({ source: "assembly" });
    s = must(setComponentRule(s, "P-B", makeRule("disposal")));
    expect(kindOf(s, "P-B")).toMatchObject({ source: "component" });
    const r = computeScenario(inv, EMPTY, s);
    const m = row(r.quantity.rows, "brick_masonry", "m3");
    near(m.available, 2); // the assembly itself is not a row: two parts, 1 m³ each
    expect(m.components).toBe(2);
    near(m.outcome.recycling, 0.4); // P-A only
    near(m.outcome.disposal, 0.6 + 1); // its residual + P-B whole
  });

  it("falls through to unknown when nothing gives a rule", () => {
    const s = { ...mk("conventional"), template: "bogus" as TemplateId };
    expect(resolveRule(s, "P-A", [], "brick_masonry")).toMatchObject({ source: "none", rule: { kind: "unknown" } });
  });

  it("an A1-style parentId (member beneath) is not containment", () => {
    const col = rec({ id: "COL", componentType: "column", geometry: box(1, 1, 1), unit: "m3", quantity: 1 });
    const beam = rec({ id: "BM", componentType: "beam", geometry: box(1, 1, 1), unit: "m3", quantity: 1, parentId: "COL" });
    const i2 = buildInventory([col, beam]);
    const s = must(setComponentRule(mk("conventional"), "COL", makeRule("recycling", 50)));
    const b = evaluateLeaf(makeContext(i2, EMPTY, s), i2.rows.find((x) => x.rec.id === "BM")!, "quantity");
    expect(b.decision.resolved.source).toBe("template");
  });
});

// ── the real building ────────────────────────────────────────────────────────

const inv: Inventory = getModelInventory(); // generation is cached; top level so describe blocks can build fixtures from it
const COLUMN = "STR-COL-F01-A1"; // 0.729 m³ concrete
const assess = (a: Assessments, ids: string[], patch: Parameters<typeof applyPatch>[3]) => applyPatch(inv, a, ids, patch).map;

describe("templates on the real model never manufacture results", () => {
  it("with no B2 assessments: conventional is all disposal, selective is the same, reuse-first is all unknown", () => {
    const conv = computeScenario(inv, EMPTY, mk("conventional"));
    const sel = computeScenario(inv, EMPTY, newScenario("x", "", "selective", assessedCategories(inv, EMPTY)));
    const rf = computeScenario(inv, EMPTY, mk("reuse_first"));
    for (const r of conv.quantity.rows) {
      expect(r.outcome.disposal).toBe(r.available);
      expect(diverted(r.outcome)).toBe(0);
      expect(r.unknownPct === null || r.unknownPct === 0).toBe(true);
    }
    expect(assessedCategories(inv, EMPTY)).toEqual([]);
    for (const r of sel.quantity.rows) expect(r.outcome.disposal).toBe(r.available);
    for (const r of rf.quantity.rows) {
      expect(r.outcome.unknown).toBe(r.available);
      expect(r.outcome.disposal).toBe(0);
      expect(r.diversionPct === null || r.diversionPct === 0).toBe(true);
    }
    expect(conv.missing.length).toBe(0); // a disposal baseline is complete
    expect(rf.missing.find((m) => m.code === "not_assessed")?.components).toBe(inv.rows.length);
  });

  it("selective deconstruction applies B2 only to the selected categories", () => {
    const a = assess(EMPTY, [COLUMN], { classification: "recycling", recoveryPct: 60 });
    const timberId = inv.rows.find((r) => substanceOf(r.rec.materialId) === "timber")!.rec.id;
    const a2 = assess(a, [timberId], { classification: "direct_reuse", recoveryPct: 100 });
    expect(assessedCategories(inv, a2)).toEqual(["concrete", "timber"]);
    const s = must(setScope(mk("selective"), ["concrete"])); // timber is assessed but NOT selected
    const r = computeScenario(inv, a2, s);
    const concrete = r.quantity.rows.filter((x) => x.key === "concrete");
    const m3 = concrete.find((x) => x.unit === "m3")!;
    near(m3.outcome.recycling, 0.729 * 0.6); // 0.4374
    near(m3.outcome.disposal, 0.729 * 0.4); // the column's residual (the rest of the selected category is unassessed)
    near(m3.outcome.unknown, m3.available - 0.729); // every other concrete component: selected but not assessed
    expect(m3.reconciled).toBe(true);
    const timber = r.quantity.rows.filter((x) => x.key === "timber");
    for (const t of timber) {
      expect(t.outcome.disposal).toBe(t.available); // outside the scope -> baseline; the B2 assessment is not applied
      expect(diverted(t.outcome)).toBe(0);
    }
    // widening the scope applies the timber assessment
    const wide = computeScenario(inv, a2, must(setScope(s, ["concrete", "timber"])));
    const t = wide.quantity.rows.filter((x) => x.key === "timber").reduce((n, x) => n + x.outcome.direct_reuse, 0);
    expect(t).toBeGreaterThan(0);
  });

  it("reuse-first uses B2 everywhere, keeps the rest unknown, and sends no residual to disposal", () => {
    const a = assess(EMPTY, [COLUMN], { classification: "direct_reuse", recoveryPct: 75 });
    const r = computeScenario(inv, a, mk("reuse_first"));
    const m3 = row(r.quantity.rows, "concrete", "m3");
    near(m3.outcome.direct_reuse, 0.729 * 0.75);
    expect(m3.outcome.disposal).toBe(0);
    near(m3.outcome.unknown, m3.available - 0.729 * 0.75); // the column's 25 % residual + every unassessed concrete component
    // classifications that give no recoverable quantity stay unknown, each with its own reason
    const further = assess(EMPTY, [COLUMN], { classification: "further_assessment" });
    expect(computeScenario(inv, further, mk("reuse_first")).missing.find((m) => m.code === "needs_assessment")?.components).toBe(1);
    const noPct = assess(EMPTY, [COLUMN], { classification: "recycling" });
    const rn = computeScenario(inv, noPct, mk("reuse_first"));
    expect(rn.missing.find((m) => m.code === "pct_missing")?.components).toBe(1);
    near(row(rn.quantity.rows, "concrete", "m3").unconfigured, 0.729);
  });

  it("scenario results never depend on the template's own wording: changing only the name changes nothing", () => {
    const s = mk("conventional");
    const renamed = must(renameScenario(s, "Another name"));
    const x = computeScenario(inv, EMPTY, s);
    const y = computeScenario(inv, EMPTY, renamed);
    expect(JSON.stringify(x.quantity.rows)).toBe(JSON.stringify(y.quantity.rows));
  });
});

describe("reconciliation on the real model", () => {
  const rich = () => {
    let a = assess(EMPTY, [COLUMN], { classification: "recycling", recoveryPct: 60 });
    const some = inv.rows.filter((_, i) => i % 97 === 0).map((r) => r.rec.id);
    a = assess(a, some.slice(0, 300), { classification: "refurbish_reuse", recoveryPct: 33.3333 });
    a = assess(a, some.slice(300, 500), { classification: "direct_reuse", recoveryPct: 100 });
    a = assess(a, some.slice(500, 600), { classification: "recycling" }); // no %
    return a;
  };
  const wallAssembly = () => inv.records.find((r) => r.componentType === "wall_assembly")!.id;

  for (const template of ["conventional", "selective", "reuse_first"] as const) {
    it(`${template}: every category x unit reconciles, in both bases, and equals the B1 totals`, () => {
      const a = rich();
      let s = newScenario("r", "", template, assessedCategories(inv, a));
      s = must(setCategoryRule(s, "timber", makeRule("refurbish_reuse", 40, "unknown")));
      s = must(setComponentRule(s, wallAssembly(), makeRule("recycling", 12.5)));
      const r = computeScenario(inv, a, s);
      expect(r.reconciled).toBe(true);
      for (const basis of [r.quantity, r.mass]) {
        for (const x of basis.rows) {
          const sum = PATHWAYS.reduce((n, p) => n + x.outcome[p], 0);
          expect(nearlyEqual(sum, x.available), `${x.key}/${x.unit}`).toBe(true);
          expect(x.reconciled).toBe(true);
          // allocated before recovery also sums to available
          expect(nearlyEqual(PATHWAYS.reduce((n, p) => n + x.allocated[p], 0), x.available)).toBe(true);
          expect(x.components).toBe(x.quantified + x.unquantified);
          expect(x.available).toBeGreaterThanOrEqual(0);
        }
        // Σ rows = totals, per unit
        for (const t of basis.totals) {
          const rows = basis.rows.filter((x) => x.unit === t.unit);
          near(rows.reduce((n, x) => n + x.available, 0), t.available);
          for (const p of PATHWAYS) near(rows.reduce((n, x) => n + x.outcome[p], 0), t.outcome[p]);
          expect(t.reconciled).toBe(true);
        }
      }
      // independent check against B1: leaves only, primary quantity per unit
      const byUnit = new Map<Unit, { n: number; sum: number }>();
      for (const l of inv.rows) {
        const v = l.q.primary.value;
        if (v === null) continue;
        const e = byUnit.get(l.q.primary.unit) ?? { n: 0, sum: 0 };
        e.n++;
        e.sum += v;
        byUnit.set(l.q.primary.unit, e);
      }
      for (const t of r.quantity.totals) {
        near(t.available, byUnit.get(t.unit)!.sum, 1e-9);
        expect(t.quantified).toBe(byUnit.get(t.unit)!.n);
      }
      let kg = 0;
      for (const l of inv.rows) kg += l.q.mass.value ?? 0;
      near(r.mass.totals.find((t) => t.unit === "kg")!.available, kg, 1e-9);
      expect(r.leafCount).toBe(inv.rows.length);
      expect(r.quantity.totals.reduce((n, t) => n + t.components, 0)).toBe(inv.rows.length);
    });
  }

  it("an assembly rule does not double count: totals are identical with and without it", () => {
    const base = computeScenario(inv, EMPTY, mk("conventional"));
    const withAsm = computeScenario(inv, EMPTY, must(setComponentRule(mk("conventional"), wallAssembly(), makeRule("recycling", 50))));
    for (const t of base.quantity.totals) near(withAsm.quantity.totals.find((x) => x.unit === t.unit)!.available, t.available);
    // ... but the outcomes moved, by exactly the wall's parts
    const parts = inv.records.filter((r) => r.parentId === wallAssembly() && r.geometry.kind !== "group");
    expect(parts.length).toBeGreaterThan(0);
    const moved = withAsm.quantity.totals.reduce((n, t) => n + diverted(t.outcome), 0);
    expect(moved).toBeGreaterThan(0);
  });

  it("stale overrides are kept and reported, not applied", () => {
    let s = must(setComponentRule(mk("conventional"), "NO-SUCH-ID", makeRule("recycling", 50)));
    s = must(setCategoryRule(s, "no_such_category", makeRule("recycling", 50)));
    const r = computeScenario(inv, EMPTY, s);
    expect(r.missing.find((m) => m.code === "stale_override")?.components).toBe(2);
    expect(Object.keys(s.componentRules)).toContain("NO-SUCH-ID");
    for (const x of r.quantity.rows) expect(x.outcome.disposal).toBe(x.available);
  });

  it("whole-building indicators: shown with coverage when B1's mass covers the solid volume, hidden otherwise", () => {
    const a = assess(EMPTY, [COLUMN], { classification: "recycling", recoveryPct: 60 });
    const r = computeScenario(inv, a, must(setCategoryRule(mk("conventional"), "concrete", makeRule("recycling", 50))));
    const w = r.wholeBuilding;
    expect(inv.massCoverage.pct).toBeGreaterThanOrEqual(MIN_MASS_VOLUME_COVERAGE_PCT);
    expect(w.reliable).toBe(true);
    expect(w.coverage.volumePct).toBeCloseTo(inv.massCoverage.pct!, 9);
    expect(w.coverage.quantified).toBeLessThan(w.coverage.components); // honest: not every component has a mass
    expect(w.coverage.quantified).toBe(r.mass.totals[0]!.quantified);
    expect(w.diversionPct).not.toBeNull();
    expect(w.diversionPct! + w.disposalPct! + w.unknownPct!).toBeCloseTo(100, 6);
    // a model without masses gives no indicator and says why
    const pipes = buildInventory([rec({ id: "P", componentType: "pipe", geometry: box(3, 0.05, 0.05), unit: "m", quantity: 3, materialId: "pvc_pipe" })]);
    const none = computeScenario(pipes, EMPTY, mk("conventional")).wholeBuilding;
    expect(none.reliable).toBe(false);
    expect(none.reason).toMatch(/no component has an estimated mass/);
    expect(none.diversionPct).toBeNull();
  });

  it("computing a scenario takes well under a few seconds for all leaves", () => {
    const t0 = performance.now();
    computeScenario(inv, rich(), must(setComponentRule(mk("selective", ["concrete"]), wallAssembly(), makeRule("recycling", 50))));
    const ms = performance.now() - t0;
    console.log(`[B4] scenario compute: ${ms.toFixed(0)} ms for ${inv.rows.length} leaves (both bases)`);
    expect(ms).toBeLessThan(5000);
  });
});

// ── independence, persistence, reset ─────────────────────────────────────────

describe("scenario management", () => {
  it("a duplicate is independent of the original", () => {
    const a = must(setComponentRule(must(setCategoryRule(mk("selective", ["concrete"]), "timber", makeRule("recycling", 30))), "X", makeRule("disposal")));
    const before = JSON.stringify(a);
    const b = duplicateScenario(a, "dup", "Copy");
    expect(JSON.stringify({ ...b, id: a.id, name: a.name })).toBe(before);
    expect(b.categoryRules).not.toBe(a.categoryRules);
    expect(b.componentRules).not.toBe(a.componentRules);
    expect(b.categoryRules.timber).not.toBe(a.categoryRules.timber);
    expect(b.baseline).not.toBe(a.baseline);
    expect(b.scope).not.toBe(a.scope);
    const b2 = must(setCategoryRule(must(setScope(b, ["stone"])), "timber", null));
    expect(b2.categoryRules.timber).toBeUndefined();
    expect(JSON.stringify(a)).toBe(before); // the original is untouched by edits to the copy
    expect(a.categoryRules.timber).toBeDefined();
    // and the other way round
    const a2 = must(setResidual(a, "unknown"));
    expect(b.residual).toBe("disposal");
    expect(a2.residual).toBe("unknown");
  });

  it("scenarios store assumptions only: no quantities, assessments or results", () => {
    const text = serializeScenarios({ scenarios: [must(setCategoryRule(mk("conventional"), "concrete", makeRule("recycling", 60)))], activeId: "s-conventional", compareIds: [] });
    expect(Object.keys(JSON.parse(text).scenarios[0]).sort()).toEqual(["baseline", "categoryRules", "componentRules", "id", "name", "residual", "scope", "template"]);
    expect(text.length).toBeLessThan(600);
  });

  it("persistence round-trips, drops what is invalid and never throws", () => {
    const a = must(setCategoryRule(mk("conventional"), "concrete", makeRule("recycling", 60, "unknown")));
    const b = must(setComponentRule(mk("selective", ["concrete", "timber"]), COLUMN, makeRule("assessment")));
    const c = mk("reuse_first");
    const text = serializeScenarios({ scenarios: [a, b, c], activeId: b.id, compareIds: [a.id, c.id] });
    const back = parseScenarios(text);
    expect(back.scenarios).toEqual([a, b, c]);
    expect(back.activeId).toBe(b.id);
    expect(back.compareIds).toEqual([a.id, c.id]);
    expect(back.dropped).toBe(0);

    expect(parseScenarios(null).scenarios).toEqual([]);
    expect(parseScenarios("{not json").scenarios).toEqual([]);
    expect(parseScenarios(JSON.stringify({ version: 999, scenarios: [a] })).scenarios).toEqual([]);
    const bad = JSON.stringify({
      version: 1,
      activeId: "ghost",
      compareIds: ["ghost", a.id],
      scenarios: [
        { ...a, categoryRules: { concrete: { kind: "recycling", recoveryPct: 250, residual: null }, timber: { kind: "wizardry", recoveryPct: 1, residual: null }, stone: { kind: "disposal", recoveryPct: 30, residual: "unknown" } } },
        { ...a, id: "badTemplate", template: "nope" },
        { ...a }, // duplicate id
        { ...a, id: "badBaseline", baseline: { kind: "assessment", recoveryPct: null, residual: null } },
        42,
      ],
    });
    const p = parseScenarios(bad);
    expect(p.scenarios).toHaveLength(1);
    expect(p.dropped).toBe(4);
    expect(p.scenarios[0]!.categoryRules.concrete).toEqual({ kind: "recycling", recoveryPct: null, residual: null }); // invalid % -> not set, not guessed
    expect(p.scenarios[0]!.categoryRules.timber).toBeUndefined();
    expect(p.scenarios[0]!.categoryRules.stone).toEqual({ kind: "disposal", recoveryPct: null, residual: null });
    expect(p.activeId).toBe(a.id);
    expect(p.compareIds).toEqual([a.id]);
  });

  it("reset restores the template defaults and clears every override, keeping id, name and template", () => {
    const assessed = ["concrete", "stone"];
    let s = mk("selective", assessed);
    s = must(renameScenario(s, "Mine"));
    expect(isModified(s, assessed)).toBe(false);
    s = must(setCategoryRule(s, "timber", makeRule("recycling", 30)));
    s = must(setComponentRule(s, "X", makeRule("disposal")));
    s = must(setResidual(s, "unknown"));
    s = must(setBaseline(s, makeRule("unknown")));
    s = must(setScope(s, ["glass"]));
    expect(isModified(s, assessed)).toBe(true);
    const r = resetScenario(s, assessed);
    expect(r).toEqual({ ...mk("selective", assessed), id: s.id, name: "Mine" });
    expect(isModified(r, assessed)).toBe(false);
    expect(s.categoryRules.timber).toBeDefined(); // the original object was not mutated
  });

  it("default templates differ exactly as documented", () => {
    expect(mk("conventional")).toMatchObject({ residual: "disposal", baseline: { kind: "disposal" }, scope: null });
    expect(mk("selective", ["concrete"])).toMatchObject({ residual: "disposal", baseline: { kind: "disposal" }, scope: ["concrete"] });
    expect(mk("reuse_first")).toMatchObject({ residual: "unknown", baseline: { kind: "unknown" }, scope: null });
  });
});

// ── B1/B2/B3 are read-only inputs ────────────────────────────────────────────

describe("B1, B2 and B3 data are not modified", () => {
  const checksum = (i: Inventory) => {
    let h = 0;
    for (const r of i.rows) {
      h = (Math.imul(h, 31) + Math.round((r.q.primary.value ?? -1) * 1e6) + Math.round((r.q.mass.value ?? -1) * 1e3)) | 0;
    }
    return `${i.rows.length}/${i.records.length}/${h}`;
  };
  const deepFreeze = <T,>(o: T): T => {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const v of Object.values(o as object)) deepFreeze(v);
    }
    return o;
  };

  it("computing, matching, comparing, editing and the B3 context leave all three untouched", () => {
    const a = assess(EMPTY, [COLUMN], { classification: "recycling", recoveryPct: 60 });
    const assessSnap = serializeAssessments(a);
    const invSnap = checksum(inv);
    const plan = deepFreeze({ ...createPlan("p", "Plan"), entries: [COLUMN, inv.records.find((r) => r.componentType === "wall_assembly")!.id] });
    const planSnap = JSON.stringify(plan);

    const s1 = deepFreeze(mk("conventional"));
    const s2 = deepFreeze(newScenario("b", "", "selective", assessedCategories(inv, a)));
    const r1 = computeScenario(inv, a, s1);
    const r2 = computeScenario(inv, a, s2);
    matchLeaves(inv, a, s2, "quantity", { category: "concrete", outcome: "recycling" });
    describeDifferences([s1, s2], [r1, r2], "quantity");
    compareRows([r1, r2], "quantity", "m3");
    const ctx = removalContext(inv, a, s2, "quantity", plan.entries);
    expect(ctx.recoveryComponents).toBe(1);
    expect(ctx.inPlan).toBe(1);
    expect(ctx.notInPlan).toBe(0);
    must(setCategoryRule(s1, "concrete", makeRule("recycling", 10))); // returns a copy; the frozen original would throw if touched

    expect(serializeAssessments(a)).toBe(assessSnap);
    expect(checksum(inv)).toBe(invSnap);
    expect(JSON.stringify(plan)).toBe(planSnap);
  });

  it("B3 context counts components outside the plan and unknown plan entries, and makes no claim about removal", () => {
    const a = assess(EMPTY, [COLUMN, "STR-COL-F01-A2"], { classification: "recycling", recoveryPct: 60 });
    const s = newScenario("s", "", "selective", assessedCategories(inv, a));
    const ctx = removalContext(inv, a, s, "quantity", [COLUMN, "GHOST"]);
    expect(ctx).toEqual({ recoveryComponents: 2, inPlan: 1, notInPlan: 1, unknownEntries: 1 });
    expect(Object.keys(ctx).sort()).toEqual(["inPlan", "notInPlan", "recoveryComponents", "unknownEntries"]);
  });
});

// ── comparison and "what differs" ────────────────────────────────────────────

describe("comparison", () => {
  const a = assess(EMPTY, [COLUMN], { classification: "recycling", recoveryPct: 60 });
  const conv = mk("conventional");
  it("aligns category rows across scenarios and keeps units apart", () => {
    const s2 = newScenario("sel", "Selective", "selective", ["concrete"]);
    const rc = computeScenario(inv, a, conv);
    const rs = computeScenario(inv, a, s2);
    const rows = compareRows([rc, rs], "quantity", "m3");
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) {
      expect(r.cells).toHaveLength(2);
      for (const c of r.cells) if (c) expect(c.unit).toBe("m3");
      expect(r.cells[0]!.available).toBe(r.cells[1]!.available); // the same B1 quantity under both scenarios
    }
    expect(totalOfUnit(rs.quantity, "m3")!.available).toBe(totalOfUnit(rc.quantity, "m3")!.available);
  });

  it("'what differs' is derived from the actual assumption changes and calculated quantities", () => {
    const s2 = newScenario("sel", "Selective", "selective", ["concrete"]);
    const s3 = must(renameScenario(duplicateScenario(s2, "copy", ""), "Same as selective"));
    const rc = computeScenario(inv, a, conv);
    const rs = computeScenario(inv, a, s2);
    const r3 = computeScenario(inv, a, s3);
    const [g1, g2] = describeDifferences([conv, s2, s3], [rc, rs, r3], "quantity");
    const text = g1!.items.map((i) => i.text).join("\n");
    expect(g1!.items.some((i) => i.kind === "assumption" && /Template: .*Conventional demolition.*Selective deconstruction/.test(i.text))).toBe(true);
    expect(text).toMatch(/Selected for deconstruction in Selective but not in .*: Concrete/);
    const q = g1!.items.filter((i) => i.kind === "quantity");
    expect(q.length).toBeGreaterThan(0);
    expect(text).toMatch(/Concrete \(m³\): diverted \+0\.437 m³, disposal −[\d,.]+ m³, unknown \+[\d,.]+ m³\./); // the column: 0.4374 recycled; the rest of the selected category moves from disposal to unknown
    // a scenario compared with an identical copy differs in nothing but its name
    expect(g2!.againstId).toBe(conv.id);
    const same = describeDifferences([s2, s3], [rs, r3], "quantity")[0]!;
    expect(same.items).toEqual([]);
    // nothing in the text is a cause the data does not show
    expect(text).not.toMatch(/because|due to|therefore/i);
  });

  it("selective vs reuse-first differ only where their documented defaults differ", () => {
    const s2 = newScenario("sel", "Selective", "selective", ["concrete"]);
    const rf = newScenario("rf", "Reuse-first", "reuse_first", []);
    const g = describeDifferences([s2, rf], [computeScenario(inv, a, s2), computeScenario(inv, a, rf)], "quantity")[0]!;
    const t = g.items.map((i) => i.text).join("\n");
    expect(t).toMatch(/Unrecovered share goes to disposal in Selective and to unknown in Reuse-first/);
    expect(t).toMatch(/B2 assessments are applied to every material category in Reuse-first, but only to Concrete in Selective/);
  });
});

// ── 3D highlight identity ────────────────────────────────────────────────────

describe("matching real component ids", () => {
  it("a category selects exactly its leaves; an outcome selects exactly the leaves with that outcome", () => {
    const a = assess(EMPTY, [COLUMN], { classification: "recycling", recoveryPct: 60 });
    const s = must(setScope(mk("selective"), ["concrete"]));
    const concreteLeaves = inv.rows.filter((r) => substanceOf(r.rec.materialId) === "concrete").map((r) => r.rec.id);
    const cat = matchLeaves(inv, a, s, "quantity", { category: "concrete" });
    expect(cat.map((m) => m.id).sort()).toEqual([...concreteLeaves].sort());
    for (const m of cat) {
      const rowx = inv.rows.find((x) => x.rec.id === m.id)!;
      expect(rowx.rec.geometry.kind).not.toBe("group"); // leaves only: an assembly id is never highlighted
    }
    // recycling: only the column; disposal: only its residual; unknown: every other (selected, unassessed) concrete leaf
    expect(matchLeaves(inv, a, s, "quantity", { category: "concrete", outcome: "recycling" })).toEqual([{ id: COLUMN, outcome: "recycling" }]);
    expect(matchLeaves(inv, a, s, "quantity", { category: "concrete", outcome: "disposal" })).toEqual([{ id: COLUMN, outcome: "disposal" }]);
    const unk = matchLeaves(inv, a, s, "quantity", { category: "concrete", outcome: "unknown" }).map((m) => m.id);
    expect(unk).toHaveLength(concreteLeaves.length - 1);
    expect(unk).not.toContain(COLUMN);
    // the matched ids carry the outcome their colour comes from (dominant outcome of the component)
    expect(cat.find((m) => m.id === COLUMN)!.outcome).toBe("recycling");
    // unit filter and missing-assumption selectors
    const m3 = matchLeaves(inv, a, s, "quantity", { category: "concrete", unit: "m3" });
    expect(m3.length).toBeLessThan(concreteLeaves.length);
    expect(m3.length).toBeGreaterThan(0);
    const na = matchLeaves(inv, a, s, "quantity", { missing: "not_assessed" }).map((m) => m.id);
    expect([...na].sort()).toEqual([...unk].sort()); // selected but unassessed = the unknown ones
  });

  it("matching agrees with the aggregate: component counts per outcome equal the result's non-zero components", () => {
    const a = assess(EMPTY, inv.rows.filter((_, i) => i % 211 === 0).map((r) => r.rec.id), { classification: "recycling", recoveryPct: 70 });
    const s = newScenario("s", "", "selective", assessedCategories(inv, a));
    const r = computeScenario(inv, a, s);
    const ids = matchLeaves(inv, a, s, "quantity", { outcome: "recycling" });
    expect(r.quantity.rows.some((x) => x.outcome.recycling > 0)).toBe(ids.length > 0);
    // every matched id really has recycled quantity under the same engine
    const ctx = makeContext(inv, a, s);
    for (const m of ids.slice(0, 200)) {
      const o = evaluateLeaf(ctx, inv.rows.find((x) => x.rec.id === m.id)!, "quantity");
      expect(o.allocation!.outcome.recycling).toBeGreaterThan(0);
    }
    // the assessed components are exactly the ones with recycling in this scenario
    expect(ids.map((m) => m.id).sort()).toEqual([...inv.rows.filter((_, i) => i % 211 === 0).map((r) => r.rec.id)].sort());
  });
});
