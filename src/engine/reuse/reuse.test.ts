import { describe, expect, it } from "vitest";
import type { ComponentRecord } from "@/building/structure";
import { buildInventory, getModelInventory, type Inventory } from "@/engine/quantities";
import { box, rec } from "@/engine/quantities/testing";
import { applyPatch, serializeAssessments, type AssessmentPatch, type Assessments } from "@/engine/recovery";
import { applyMeta, type MetaMap, type MetaPatch } from "@/engine/passport";
import {
  allocate,
  allocateBatch,
  allocatedByComponent,
  createRequirement,
  DEFAULT_CONFIG,
  demandRows,
  demandStatus,
  draftFromComponent,
  EMPTY_DRAFT,
  evaluate,
  explain,
  matchRequirement,
  opportunities,
  parseReuse,
  planToCsv,
  planToJson,
  potentialSupply,
  proposeFill,
  reconcile,
  removeAllocation,
  removeForRequirement,
  reviewAllocations,
  scopeInfo,
  serializeReuse,
  substanceIndex,
  typeLabel,
  statusCounts,
  supplyOf,
  totalsByUnit,
  updateRequirement,
  validateConfig,
  validateDraft,
  withWeight,
  type Allocation,
  type MatchConfig,
  type MatchContext,
  type Requirement,
  type RequirementDraft,
} from "./index";
import { CSV_HEADER, SCHEMA } from "./export";

// ── fixtures: a small synthetic inventory, so every expectation can be checked by hand ──────────────

const NOW = "2026-01-01T00:00:00.000Z";
let seq = 0;
const newId = () => `A${++seq}`;

const tile = (id: string, L: number, W: number, T: number, materialId = "tile_porcelain_floor"): ComponentRecord =>
  rec({ id, componentType: "floor_tile", materialId, geometry: box(L, T, W), unit: "m2", quantity: L * W, dimensions: { length: L, width: W, thickness: T } });
const door = (id: string): ComponentRecord => rec({ id, componentType: "door_leaf", materialId: "timber_door_light", geometry: box(0.9, 0.04, 2.1), unit: "m2", quantity: 0.9 * 2.1, dimensions: { length: 2.1, width: 0.9, thickness: 0.04 } });
const basin = (id: string): ComponentRecord => rec({ id, componentType: "basin", materialId: "sanitary_ceramic", geometry: box(0.5, 0.16, 0.42), unit: "nr", quantity: 1, dimensions: { length: 0.5, width: 0.42, height: 0.16 } });
const wcPan = (id: string): ComponentRecord => rec({ id, componentType: "wc_pan", materialId: "sanitary_ceramic", geometry: box(0.38, 0.4, 0.55), unit: "nr", quantity: 1, dimensions: { length: 0.55, width: 0.38, height: 0.4 } });
const column = (id: string): ComponentRecord => rec({ id, componentType: "column", system: "structure", materialId: "rcc_conceptual", geometry: box(0.45, 3.6, 0.45), unit: "m3", quantity: 0.45 * 3.6 * 0.45, dimensions: { length: 3.6, width: 0.45, height: 0.45 } });
/** A tile that records only a length and a width: no thickness. */
const flatTile = (id: string): ComponentRecord => rec({ id, componentType: "floor_tile", materialId: "tile_porcelain_floor", geometry: box(0.6, 0.01, 0.6), unit: "m2", quantity: 0.36, dimensions: { length: 0.6, width: 0.6 } });

const RECORDS: readonly ComponentRecord[] = [
  tile("TILE-A", 0.6, 0.6, 0.01), // 0.36 m2
  tile("TILE-B", 0.3, 0.3, 0.01), // 0.09 m2
  tile("TILE-C", 1.2, 0.6, 0.01), // 0.72 m2 (oversize)
  tile("TILE-D", 0.3, 0.3, 0.008, "tile_antiskid"), // ceramic, not porcelain
  tile("TILE-E", 0.6, 0.6, 0.02), // too thick
  tile("TILE-F", 0.6, 0.6, 0.01), // identical to A
  flatTile("TILE-G"),
  door("DOOR-1"),
  basin("BASIN-1"),
  basin("BASIN-2"),
  wcPan("WC-1"),
  column("COL-1"),
];
const inv: Inventory = buildInventory([...RECORDS]);
const row = (id: string) => ({ rec: inv.recordById.get(id)!, q: inv.byId.get(id)! });

const EMPTY: Assessments = new Map();
const NO_META: MetaMap = new Map();
const assess = (ids: readonly string[], patch: AssessmentPatch, from: Assessments = EMPTY): Assessments => applyPatch(inv, from, ids, patch).map;
const observe = (id: string, patch: MetaPatch, from: MetaMap = NO_META): MetaMap => applyMeta(from, id, patch, NOW).map;
const ctxOf = (assessments: Assessments = EMPTY, meta: MetaMap = NO_META, config: MatchConfig = DEFAULT_CONFIG): MatchContext => ({ inv, assessments, meta, config });

const REUSE: AssessmentPatch = { classification: "direct_reuse", recoveryPct: 100, preparation: "none" };
const draft = (over: Partial<RequirementDraft> = {}): RequirementDraft => ({ ...EMPTY_DRAFT, name: "Hall floor", substance: "porcelain_tile", form: "tile_floor", unit: "m2", quantity: 1, ...over });
const mkReq = (over: Partial<RequirementDraft> = {}, id = "REQ-1"): Requirement => {
  const r = createRequirement(id, draft(over), NOW);
  if (!r.requirement) throw new Error(r.error ?? "invalid");
  return r.requirement;
};
const tierOf = (ctx: MatchContext, req: Requirement, id: string) => evaluate(ctx, req, row(id)).tier;
const rng = (min: number | null, max: number | null) => ({ min, max });
const dims = (d: Partial<RequirementDraft["dims"]>) => ({ ...EMPTY_DRAFT.dims, ...d });

describe("supply: what a component can offer", () => {
  it("a reuse assessment with a recovery % gives the recoverable estimate, labelled as such", () => {
    const s = supplyOf(row("TILE-A"), assess(["TILE-A"], { classification: "direct_reuse", recoveryPct: 75 }).get("TILE-A"));
    expect(s.basis).toBe("recoverable");
    expect(s.value).toBeCloseTo(0.27, 12);
    expect(s.unit).toBe("m2");
  });
  it("without a recovery estimate the modelled quantity is an upper bound, never a recoverable quantity", () => {
    expect(supplyOf(row("TILE-A"), undefined)).toMatchObject({ basis: "upper_bound", unit: "m2" });
    expect(supplyOf(row("TILE-A"), undefined).value).toBeCloseTo(0.36, 12);
    expect(supplyOf(row("TILE-A"), assess(["TILE-A"], { classification: "direct_reuse" }).get("TILE-A")).basis).toBe("upper_bound");
  });
  it("whole items are only allocated whole: a single item recovered at 90 % supplies nothing", () => {
    expect(supplyOf(row("BASIN-1"), assess(["BASIN-1"], { classification: "direct_reuse", recoveryPct: 90 }).get("BASIN-1")).value).toBe(0);
    expect(supplyOf(row("BASIN-1"), assess(["BASIN-1"], { classification: "direct_reuse", recoveryPct: 100 }).get("BASIN-1")).value).toBe(1);
    expect(supplyOf(row("BASIN-1"), undefined).value).toBe(1);
  });
});

describe("requirements", () => {
  it("validates what the user types and never creates an invalid requirement", () => {
    expect(validateDraft(draft())).toBeNull();
    expect(validateDraft(draft({ name: "  " }))).toMatch(/name/i);
    expect(validateDraft(draft({ substance: "" }))).toMatch(/material category/i);
    expect(validateDraft(draft({ quantity: 0 }))).toMatch(/above 0/);
    expect(validateDraft(draft({ quantity: Number.NaN }))).toMatch(/above 0/);
    expect(validateDraft(draft({ unit: "nr", quantity: 2.5 }))).toMatch(/whole number/);
    expect(validateDraft(draft({ dims: dims({ length: rng(2, 1) }) }))).toMatch(/larger than maximum/);
    expect(validateDraft(draft({ dims: dims({ width: rng(-1, null) }) }))).toMatch(/≥ 0/);
    expect(validateDraft(draft({ toleranceMm: 500 }))).toMatch(/Tolerance/);
    expect(validateDraft(draft({ extraSpecs: [{ label: "", value: "x" }] }))).toMatch(/needs a name/);
    expect(createRequirement("X", draft({ name: "" }), NOW)).toEqual({ requirement: null, error: expect.any(String) });
  });
  it("editing returns the same object when nothing changed, and refuses an invalid edit", () => {
    const r = mkReq();
    expect(updateRequirement(r, draft(), "later").requirement).toBe(r);
    expect(updateRequirement(r, draft({ quantity: 5 }), "later").requirement?.quantity).toBe(5);
    expect(updateRequirement(r, draft({ quantity: -1 }), "later").requirement).toBeNull();
  });
  it("starting a requirement from a real component copies its category, form and unit but not its sizes", () => {
    const d = draftFromComponent(row("TILE-A"), undefined);
    expect(d).toMatchObject({ substance: "porcelain_tile", form: "tile_floor", unit: "m2" });
    expect(d.dims).toEqual(EMPTY_DRAFT.dims);
    expect(draftFromComponent(row("BASIN-1"), undefined)).toMatchObject({ unit: "nr", quantity: 1, form: "sanitary" });
  });
});

describe("matching: incompatible, conditional and strong", () => {
  const req = mkReq();

  it("only components of the requested material category are evaluated; the rest are counted, not judged", () => {
    const r = matchRequirement(ctxOf(), req);
    expect(r.evaluated).toBe(6); // 6 porcelain tiles
    expect(r.excluded).toBe(inv.rows.length - 6);
    expect(r.strong.length + r.conditional.length + r.incompatible.length).toBe(r.evaluated);
    expect(r.byId.has("TILE-D")).toBe(false);
    expect(r.byId.has("DOOR-1")).toBe(false);
  });

  it("a different material or component form is incompatible with the reason named", () => {
    const d = evaluate(ctxOf(), req, row("TILE-D"));
    expect(d.tier).toBe("incompatible");
    expect(d.blockers[0]).toMatchObject({ code: "material" });
    expect(d.blockers[0]!.text).toMatch(/ceramic tile.*porcelain tile/);
    expect(d.score).toBeNull();
    const f = evaluate(ctxOf(), mkReq({ form: "tile_wall" }), row("TILE-A"));
    expect(f.tier).toBe("incompatible");
    expect(f.blockers.map((b) => b.code)).toContain("form");
  });

  it("an unassessed component is conditional, never strong: its missing recovery data is named", () => {
    const c = evaluate(ctxOf(), req, row("TILE-A"));
    expect(c.tier).toBe("conditional");
    expect(c.states.recovery).toBe("unknown");
    expect(c.missing.map((m) => m.code)).toContain("unassessed");
    expect(c.notes.map((n) => n.code)).toContain("upper_bound");
    expect(c.supply.basis).toBe("upper_bound");
  });

  it("direct reuse with a recovery % and no processing is strong", () => {
    const c = evaluate(ctxOf(assess(["TILE-A"], REUSE)), req, row("TILE-A"));
    expect(c.tier).toBe("strong");
    expect(c.blockers).toEqual([]);
    expect(c.conditions).toEqual([]);
    expect(c.missing).toEqual([]);
    expect(c.known).toBe(c.total);
    expect(c.supply.basis).toBe("recoverable");
  });

  it("a reuse classification without a recovery % is conditional: the quantity is only an upper bound", () => {
    const c = evaluate(ctxOf(assess(["TILE-A"], { classification: "direct_reuse" })), req, row("TILE-A"));
    expect(c.tier).toBe("conditional");
    expect(c.missing.map((m) => m.code)).toContain("no_pct");
  });

  it("refurbishment, cleaning and testing make a match conditional, with the step named", () => {
    const refurb = evaluate(ctxOf(assess(["TILE-A"], { classification: "refurbish_reuse", recoveryPct: 80 })), req, row("TILE-A"));
    expect(refurb.tier).toBe("conditional");
    expect(refurb.conditions.map((n) => n.code)).toContain("refurbishment");
    const clean = evaluate(ctxOf(assess(["TILE-A"], { ...REUSE, preparation: "cleaning" })), req, row("TILE-A"));
    expect(clean.tier).toBe("conditional");
    expect(clean.conditions.map((n) => n.code)).toEqual(["cleaning"]);
    const test = evaluate(ctxOf(assess(["TILE-A"], { classification: "further_assessment" })), req, row("TILE-A"));
    expect(test.tier).toBe("conditional");
    expect(test.conditions.map((n) => n.code)).toContain("testing");
  });

  it("a step the requirement does not accept makes the component incompatible", () => {
    const a = assess(["TILE-A"], { classification: "refurbish_reuse", recoveryPct: 80 });
    const strict = mkReq({ accept: { cleaning: true, refurbishment: false, cutting: false, testing: true } });
    const c = evaluate(ctxOf(a), strict, row("TILE-A"));
    expect(c.tier).toBe("incompatible");
    expect(c.blockers.map((b) => b.code)).toContain("refused_refurbishment");
    const noTest = mkReq({ accept: { cleaning: true, refurbishment: true, cutting: false, testing: false } });
    expect(evaluate(ctxOf(assess(["TILE-A"], { classification: "further_assessment" })), noTest, row("TILE-A")).blockers.map((b) => b.code)).toContain("refused_testing");
  });

  it("material assessed for recycling, or for reprocessing, is not a reuse candidate", () => {
    expect(evaluate(ctxOf(assess(["TILE-A"], { classification: "recycling", recoveryPct: 90 })), req, row("TILE-A")).blockers.map((b) => b.code)).toContain("recycling");
    expect(evaluate(ctxOf(assess(["TILE-A"], { ...REUSE, preparation: "reprocessing" })), req, row("TILE-A")).blockers.map((b) => b.code)).toContain("reprocessing");
  });

  it("'only components assessed for reuse' excludes the unassessed ones outright", () => {
    const only = mkReq({ includeUnassessed: false });
    expect(tierOf(ctxOf(), only, "TILE-A")).toBe("incompatible");
    expect(tierOf(ctxOf(assess(["TILE-A"], REUSE)), only, "TILE-A")).toBe("strong");
  });

  it("structural elements are incompatible unless asked for, and then always conditional", () => {
    const concrete = { substance: "concrete", form: null, unit: "m3" as const, quantity: 1 };
    const a = assess(["COL-1"], { classification: "direct_reuse", recoveryPct: 100, preparation: "none" });
    expect(evaluate(ctxOf(a), mkReq(concrete), row("COL-1")).blockers.map((b) => b.code)).toContain("structural");
    const on = evaluate(ctxOf(a), mkReq({ ...concrete, includeStructural: true }), row("COL-1"));
    expect(on.tier).toBe("conditional");
    expect(on.conditions.map((n) => n.code)).toContain("structural");
    expect(on.conditions.find((n) => n.code === "structural")!.text).toMatch(/cannot judge/);
  });
});

describe("component type", () => {
  const a = assess(["BASIN-1", "BASIN-2", "WC-1"], REUSE);
  const sanitary = { substance: "sanitary_ceramic", form: "sanitary" as const, unit: "nr" as const, quantity: 2 };
  it("a form alone cannot tell a basin from a WC pan, a type can", () => {
    const byForm = matchRequirement(ctxOf(a), mkReq(sanitary));
    expect(byForm.strong.map((c) => c.id).sort()).toEqual(["BASIN-1", "BASIN-2", "WC-1"]);
    const byType = matchRequirement(ctxOf(a), mkReq({ ...sanitary, componentType: "basin" }));
    expect(byType.strong.map((c) => c.id).sort()).toEqual(["BASIN-1", "BASIN-2"]);
    const wc = evaluate(ctxOf(a), mkReq({ ...sanitary, componentType: "basin" }), row("WC-1"));
    expect(wc.tier).toBe("incompatible");
    expect(wc.blockers[0]).toMatchObject({ code: "type", text: "Component is a wc pan, the requirement is a basin" });
  });
  it("explain shows the type row", () => {
    const c = explain(ctxOf(a), mkReq({ ...sanitary, componentType: "basin" }), row("BASIN-1"));
    expect(c.criteria!.find((x) => x.key === "material")!.lines.find((l) => l.label === "Component type")).toMatchObject({ required: "Basin", actual: "Basin", state: "met" });
  });
  it("a requirement started from a component carries its type; the type label reads as words", () => {
    expect(draftFromComponent(row("BASIN-1"), undefined).componentType).toBe("basin");
    expect(typeLabel("kitchen_countertop")).toBe("Kitchen countertop");
  });
  it("offers only what the model has: material categories, and the forms, types, variants and units within one", () => {
    expect(substanceIndex(inv).map((s) => s.substance)).toEqual(expect.arrayContaining(["porcelain_tile", "sanitary_ceramic", "timber", "concrete"]));
    const s = scopeInfo(inv, "sanitary_ceramic", "sanitary");
    expect(s.count).toBe(3);
    expect(s.types.map((t) => [t.type, t.count])).toEqual([["basin", 2], ["wc_pan", 1]]);
    expect(s.units).toEqual([{ unit: "nr", count: 3 }]);
    expect(scopeInfo(inv, "porcelain_tile").units).toEqual([{ unit: "m2", count: 6 }]);
    expect(scopeInfo(inv, "porcelain_tile").hasDiameter).toBe(false);
    expect(scopeInfo(inv, "nothing").count).toBe(0);
  });
});

describe("dimensions", () => {
  const ctx = ctxOf(assess(["TILE-A", "TILE-B", "TILE-C", "TILE-E", "TILE-G"], REUSE));

  it("a component below a required minimum is incompatible, with the numbers in the reason", () => {
    const r = mkReq({ dims: dims({ length: rng(0.5, null) }) });
    expect(tierOf(ctx, r, "TILE-A")).toBe("strong");
    const b = evaluate(ctx, r, row("TILE-B"));
    expect(b.tier).toBe("incompatible");
    expect(b.blockers[0]).toMatchObject({ code: "dim_small" });
    expect(b.blockers[0]!.text).toMatch(/300 mm.*500 mm/);
  });
  it("sizes are compared by magnitude, so orientation does not matter", () => {
    const r = mkReq({ dims: dims({ length: rng(0.55, 0.65), width: rng(0.55, 0.65), thickness: rng(0.008, 0.012) }) });
    expect(tierOf(ctx, r, "TILE-A")).toBe("strong");
  });
  it("an oversize piece is incompatible unless cutting to size is accepted; then it is conditional and the cut is named", () => {
    const max = { dims: dims({ length: rng(null, 0.65) }) };
    const no = evaluate(ctx, mkReq(max), row("TILE-C"));
    expect(no.tier).toBe("incompatible");
    expect(no.blockers[0]!.text).toMatch(/cutting to size is not accepted/);
    const yes = evaluate(ctx, mkReq({ ...max, accept: { cleaning: true, refurbishment: true, cutting: true, testing: true } }), row("TILE-C"));
    expect(yes.tier).toBe("conditional");
    expect(yes.conditions.map((n) => n.code)).toEqual(["cutting"]);
    expect(yes.conditions[0]!.text).toMatch(/1,200 mm down to ≤ 650 mm/);
  });
  it("a piece that is too thick cannot be cut down, even when cutting is accepted", () => {
    const r = mkReq({ dims: dims({ thickness: rng(null, 0.012) }), accept: { cleaning: true, refurbishment: true, cutting: true, testing: true } });
    const c = evaluate(ctx, r, row("TILE-E"));
    expect(c.tier).toBe("incompatible");
    expect(c.blockers[0]!.text).toMatch(/cannot be cut down/);
  });
  it("the tolerance applies at both ends of a range", () => {
    const r = (tol: number) => mkReq({ dims: dims({ thickness: rng(null, 0.0095) }), toleranceMm: tol });
    expect(tierOf(ctx, r(0), "TILE-A")).toBe("incompatible"); // 10 mm > 9.5 mm
    expect(tierOf(ctx, r(1), "TILE-A")).toBe("strong"); // 10 mm <= 9.5 mm + 1 mm
  });
  it("a size the component does not record is unknown, not a match: the match is conditional and says so", () => {
    const c = evaluate(ctx, mkReq({ dims: dims({ thickness: rng(0.008, 0.012) }) }), row("TILE-G"));
    expect(c.tier).toBe("conditional");
    expect(c.states.dimensions).toBe("unknown");
    expect(c.missing.map((m) => m.code)).toContain("dim_missing");
  });
});

describe("units and quantity", () => {
  it("units are never converted: a count requirement does not match an area-measured component", () => {
    const r = mkReq({ unit: "nr", quantity: 4 });
    const c = evaluate(ctxOf(assess(["TILE-A"], REUSE)), r, row("TILE-A"));
    expect(c.tier).toBe("incompatible");
    expect(c.blockers[0]).toMatchObject({ code: "unit" });
    expect(c.blockers[0]!.text).toMatch(/never converted/);
  });
  it("a count requirement matches whole items", () => {
    const r = mkReq({ substance: "sanitary_ceramic", form: "sanitary", unit: "nr", quantity: 2 });
    const a = assess(["BASIN-1", "BASIN-2"], REUSE);
    const res = matchRequirement(ctxOf(a), r);
    expect(res.strong.map((c) => c.id).sort()).toEqual(["BASIN-1", "BASIN-2"]);
    expect(res.strong[0]!.supply).toMatchObject({ value: 1, unit: "nr", basis: "recoverable" });
  });
  it("a component with nothing to allocate is incompatible (a single item at 90 %)", () => {
    const r = mkReq({ substance: "sanitary_ceramic", form: "sanitary", unit: "nr", quantity: 1 });
    const c = evaluate(ctxOf(assess(["BASIN-1"], { classification: "direct_reuse", recoveryPct: 90 })), r, row("BASIN-1"));
    expect(c.tier).toBe("incompatible");
    expect(c.blockers[0]).toMatchObject({ code: "no_quantity" });
  });
});

describe("condition (C1) and other specifications", () => {
  const a = assess(["TILE-A"], REUSE);
  it("a required condition with no inspection recorded is unknown: conditional, never strong", () => {
    const r = mkReq({ minCondition: "fair" });
    const c = evaluate(ctxOf(a), r, row("TILE-A"));
    expect(c.tier).toBe("conditional");
    expect(c.states.condition).toBe("unknown");
    expect(c.missing[0]!.text).toMatch(/generated default/);
  });
  it("an observed condition that meets the requirement makes it strong; one below it, incompatible", () => {
    const r = mkReq({ minCondition: "fair" });
    expect(tierOf(ctxOf(a, observe("TILE-A", { observedCondition: "good" })), r, "TILE-A")).toBe("strong");
    expect(tierOf(ctxOf(a, observe("TILE-A", { observedCondition: "fair" })), r, "TILE-A")).toBe("strong");
    expect(tierOf(ctxOf(a, observe("TILE-A", { observedCondition: "poor" })), r, "TILE-A")).toBe("incompatible");
    expect(tierOf(ctxOf(a, observe("TILE-A", { observedCondition: "fair" })), mkReq({ minCondition: "good" }), "TILE-A")).toBe("incompatible");
  });
  it("a component recorded as damaged is never matched, whatever the requirement says", () => {
    const c = evaluate(ctxOf(a, observe("TILE-A", { observedCondition: "damaged" })), mkReq({ minCondition: "any" }), row("TILE-A"));
    expect(c.tier).toBe("incompatible");
    expect(c.blockers[0]).toMatchObject({ code: "damaged" });
  });
  it("with no condition required, an unrecorded condition does not stop a strong match", () => {
    expect(tierOf(ctxOf(a), mkReq({ minCondition: "any" }), "TILE-A")).toBe("strong");
  });
  it("a specification the model has no data for can be listed but never verified: the match stays conditional", () => {
    const r = mkReq({ extraSpecs: [{ label: "Slip resistance", value: "R10" }] });
    const c = evaluate(ctxOf(a), r, row("TILE-A"));
    expect(c.tier).toBe("conditional");
    expect(c.states.specs).toBe("unknown");
    expect(c.missing.find((m) => m.code === "spec")!.text).toMatch(/Slip resistance \(R10\).*cannot be verified/);
  });
});

describe("score: transparent, configurable, and missing data earns nothing", () => {
  const strongCtx = ctxOf(assess(["TILE-A"], REUSE));
  it("is the weighted share of the criteria the requirement uses, by hand", () => {
    // used: material 25, quantity 10, recovery 15, processing 5 = 55. The tile covers 0.36 of 3.6 m2 = 10 % of the quantity.
    const r = mkReq({ quantity: 3.6 });
    const c = evaluate(strongCtx, r, row("TILE-A"));
    expect(c.score).toBeCloseTo((100 * (25 + 10 * 0.1 + 15 + 5)) / 55, 1);
    // a component that alone covers the requirement earns the full quantity weight
    expect(evaluate(strongCtx, mkReq({ quantity: 0.36 }), row("TILE-A")).score).toBe(100);
  });
  it("criteria the requirement does not use drop out instead of counting as satisfied", () => {
    const withDims = mkReq({ quantity: 0.36, dims: dims({ length: rng(0.55, 0.65) }) });
    expect(evaluate(strongCtx, withDims, row("TILE-A")).total).toBe(5); // material, dimensions, quantity, recovery, processing
    expect(evaluate(strongCtx, mkReq({ quantity: 0.36 }), row("TILE-A")).total).toBe(4);
  });
  it("missing data lowers the score: the same tile scores less when it is not assessed, and less again when unknown credit is 0", () => {
    const r = mkReq({ quantity: 0.36 });
    const assessed = evaluate(strongCtx, r, row("TILE-A")).score!;
    const unassessed = evaluate(ctxOf(), r, row("TILE-A")).score!;
    expect(unassessed).toBeLessThan(assessed);
    const generous = evaluate(ctxOf(EMPTY, NO_META, { ...DEFAULT_CONFIG, unknownCredit: 0.5 }), r, row("TILE-A")).score!;
    expect(generous).toBeGreaterThan(unassessed);
    expect(generous).toBeLessThan(assessed); // still conditional: partial knowledge never equals a verified match
  });
  it("weights are configuration: changing them changes the ranking, and nothing else is hidden", () => {
    const a = assess(["TILE-A", "TILE-C"], REUSE);
    const r = mkReq({ quantity: 0.36, dims: dims({ length: rng(null, 0.65) }), accept: { cleaning: true, refurbishment: true, cutting: true, testing: true } });
    const equal = matchRequirement(ctxOf(a), r);
    expect(equal.strong.map((c) => c.id)).toEqual(["TILE-A"]); // C needs cutting: conditional
    expect(equal.conditional.map((c) => c.id)).toContain("TILE-C");
    const lenient: MatchConfig = { ...DEFAULT_CONFIG, partialCredit: 1 };
    expect(evaluate(ctxOf(a, NO_META, lenient), r, row("TILE-C")).score).toBeGreaterThan(evaluate(ctxOf(a), r, row("TILE-C")).score!);
  });
  it("validates the configuration", () => {
    expect(validateConfig(DEFAULT_CONFIG)).toBeNull();
    expect(withWeight(DEFAULT_CONFIG, "material", 150).error).toMatch(/between 0 and 100/);
    expect(withWeight(DEFAULT_CONFIG, "material", -1).config).toBe(DEFAULT_CONFIG);
    expect(validateConfig({ ...DEFAULT_CONFIG, weights: { material: 0, dimensions: 0, quantity: 0, condition: 0, recovery: 0, processing: 0, specs: 0 } })).toMatch(/above 0/);
    expect(validateConfig({ ...DEFAULT_CONFIG, partialCredit: 2 })).toMatch(/between 0 and 1/);
  });
  it("explain returns every criterion with required and actual values, and the points add up to the score", () => {
    const r = mkReq({ quantity: 3.6, dims: dims({ length: rng(0.5, null) }) });
    const c = explain(strongCtx, r, row("TILE-A"));
    expect(c.criteria!.map((x) => x.key)).toEqual(["material", "dimensions", "quantity", "condition", "recovery", "processing", "specs"]);
    const used = c.criteria!.filter((x) => x.state !== "na");
    const sumW = used.reduce((s, x) => s + x.weight, 0);
    expect((100 * used.reduce((s, x) => s + x.weight * x.points, 0)) / sumW).toBeCloseTo(c.score!, 1);
    const dim = c.criteria!.find((x) => x.key === "dimensions")!;
    expect(dim.lines[0]).toMatchObject({ label: "Length", required: expect.stringContaining("≥ 500 mm"), actual: "600 mm", state: "met" });
    expect(c.criteria!.find((x) => x.key === "specs")!.state).toBe("na");
  });
});

describe("ranking", () => {
  it("lists strong before conditional before incompatible, then by score, supply and id (deterministic)", () => {
    const a = assess(["TILE-A", "TILE-B", "TILE-F"], REUSE);
    const r = mkReq({ quantity: 1 });
    const res = matchRequirement(ctxOf(a), r);
    expect(res.strong.map((c) => c.id)).toEqual(["TILE-A", "TILE-F", "TILE-B"]); // A and F: equal score, larger supply, id order; B covers less
    expect(res.conditional.every((c) => c.score !== null)).toBe(true);
    expect(res.incompatible.every((c) => c.score === null)).toBe(true);
    expect(matchRequirement(ctxOf(a), r)).toBe(res); // memoised per input objects
    expect(matchRequirement(ctxOf(a), r).strong.map((c) => c.id)).toEqual(res.strong.map((c) => c.id));
  });
  it("counts why components are incompatible", () => {
    const res = matchRequirement(ctxOf(), mkReq({ dims: dims({ length: rng(0.5, null) }) }));
    expect(res.blockerCounts.get("dim_small")!.count).toBe(1); // TILE-B
  });
  it("evaluates one component against every requirement (reuse opportunities)", () => {
    const reqs = [mkReq({}, "R1"), mkReq({ name: "Basins", substance: "sanitary_ceramic", form: "sanitary", unit: "nr", quantity: 2 }, "R2")];
    const o = opportunities(ctxOf(assess(["TILE-A"], REUSE)), reqs, row("TILE-A"));
    expect(o.map((x) => x.candidate.tier)).toEqual(["strong", "incompatible"]);
  });
});

describe("allocation ledger", () => {
  const A = assess(["TILE-A", "TILE-F", "TILE-C", "TILE-D", "BASIN-1"], REUSE);
  const ctx = ctxOf(A);
  const r1 = mkReq({ name: "Hall", quantity: 0.5 }, "R1");
  const r2 = mkReq({ name: "Corridor", quantity: 0.4 }, "R2");
  const reqs = [r1, r2];
  const go = (allocs: readonly Allocation[], requirementId: string, componentId: string, quantity: number) => allocate(ctx, reqs, allocs, { requirementId, componentId, quantity }, NOW, newId);

  it("confirms an allocation and records what the match looked like at that moment", () => {
    const r = go([], "R1", "TILE-A", 0.3);
    expect(r.error).toBeNull();
    expect(r.allocation).toMatchObject({ requirementId: "R1", componentId: "TILE-A", quantity: 0.3, unit: "m2" });
    expect(r.allocation!.basis).toMatchObject({ tier: "strong", supply: 0.36, supplyBasis: "recoverable", classification: "direct_reuse" });
  });

  it("prevents double allocation of one component across competing requirements", () => {
    const first = go([], "R1", "TILE-A", 0.3).allocations; // 0.06 of the 0.36 m2 is left
    const tooMuch = go(first, "R2", "TILE-A", 0.1);
    expect(tooMuch.error).toMatch(/Only 0\.060 m² of this component is free.*already allocated to other requirements/);
    expect(tooMuch.allocations).toBe(first); // refused: the ledger is untouched
    const ok = go(first, "R2", "TILE-A", 0.06);
    expect(ok.error).toBeNull();
    expect(allocatedByComponent(ok.allocations).get("TILE-A")).toBeCloseTo(0.36, 9);
    expect(go(ok.allocations, "R2", "TILE-F", 0.001).error).toBeNull(); // another component is unaffected
    // R1 cannot grow its own allocation beyond what R2 left it (0.36 - 0.06 = 0.30 m2), but it may shrink it
    expect(go(ok.allocations, "R1", "TILE-A", 0.31).error).toMatch(/Only 0\.300 m² of this component is free/);
    expect(go(ok.allocations, "R1", "TILE-A", 0.3).error).toBeNull();
    expect(go(ok.allocations, "R1", "TILE-A", 0.1).error).toBeNull();
  });

  it("supports partial matches: the demand status follows the allocated quantity", () => {
    const a = go([], "R1", "TILE-A", 0.3).allocations;
    const rows = demandRows(reqs, a);
    expect(rows.map((d) => [d.requirement.id, d.status, d.allocated, d.remaining])).toEqual([["R1", "partial", 0.3, 0.2], ["R2", "unmet", 0, 0.4]]);
    const full = go(a, "R1", "TILE-F", 0.2).allocations;
    expect(demandRows(reqs, full)[0]).toMatchObject({ status: "matched", remaining: 0 });
    expect(statusCounts(demandRows(reqs, full))).toEqual({ unmet: 1, partial: 0, matched: 1, over: 0 });
  });

  it("reports how much of a requirement is matched only by conditional material (its conditions are still open)", () => {
    const cut = mkReq({ name: "Cut", quantity: 1, dims: dims({ length: rng(null, 0.65) }), accept: { cleaning: true, refurbishment: true, cutting: true, testing: true } }, "R5");
    const all = [r1, cut];
    let a = go([], "R1", "TILE-A", 0.3).allocations; // strong
    a = allocate(ctx, all, a, { requirementId: "R5", componentId: "TILE-C", quantity: 0.5 }, NOW, newId).allocations; // conditional: cutting
    a = allocate(ctx, all, a, { requirementId: "R5", componentId: "TILE-A", quantity: 0.06 }, NOW, newId).allocations; // strong
    const rows = demandRows(all, a);
    expect(rows.map((d) => [d.requirement.id, d.allocated, d.conditional])).toEqual([["R1", 0.3, 0], ["R5", 0.56, 0.5]]);
  });

  it("never allocates more than the requirement still needs", () => {
    const a = go([], "R1", "TILE-A", 0.3).allocations;
    expect(go(a, "R1", "TILE-F", 0.25).error).toMatch(/still needs \(0\.200 m² remaining\)/);
    expect(go(a, "R1", "TILE-F", 0.2).error).toBeNull();
  });

  it("revising an allocation replaces it (one per requirement and component), freeing the difference", () => {
    const a = go([], "R1", "TILE-A", 0.3).allocations;
    const revised = go(a, "R1", "TILE-A", 0.1);
    expect(revised.error).toBeNull();
    expect(revised.allocations).toHaveLength(1);
    expect(revised.allocation!.id).toBe(a[0]!.id);
    expect(revised.allocation!.quantity).toBe(0.1);
    expect(go(revised.allocations, "R2", "TILE-A", 0.26).error).toBeNull(); // 0.36 - 0.1 is now free for R2
    // an allocation may be revised up to the component's whole supply (its own quantity is not counted against it), and no further
    expect(go(a, "R1", "TILE-A", 0.36).error).toBeNull();
    expect(go(a, "R1", "TILE-A", 0.37).error).toMatch(/can supply 0\.360 m²/);
  });

  it("removes an allocation and releases its quantity", () => {
    const a = go(go([], "R1", "TILE-A", 0.36).allocations, "R2", "TILE-F", 0.2).allocations;
    expect(go(a, "R2", "TILE-A", 0.1).error).toMatch(/free/);
    const released = removeAllocation(a, a[0]!.id);
    expect(released).toHaveLength(1);
    expect(go(released, "R2", "TILE-A", 0.1).error).toBeNull();
    expect(removeAllocation(a, "nope")).toBe(a);
    expect(removeForRequirement(a, "R1").map((x) => x.requirementId)).toEqual(["R2"]);
  });

  it("refuses incompatible material, unknown ids, assemblies and bad quantities, each with the reason", () => {
    expect(go([], "R1", "TILE-D", 0.1).error).toMatch(/^Incompatible: Material is ceramic tile/);
    expect(go([], "R1", "NOPE", 0.1).error).toMatch(/not a component/);
    expect(go([], "NOPE", "TILE-A", 0.1).error).toMatch(/does not exist/);
    expect(go([], "R1", "TILE-A", 0).error).toMatch(/above 0/);
    expect(go([], "R1", "TILE-A", -1).error).toMatch(/above 0/);
    expect(go([], "R1", "TILE-A", Number.NaN).error).toMatch(/above 0/);
    const nr = mkReq({ substance: "sanitary_ceramic", form: "sanitary", unit: "nr", quantity: 2 }, "R3");
    expect(allocate(ctx, [nr], [], { requirementId: "R3", componentId: "BASIN-1", quantity: 0.5 }, NOW, newId).error).toMatch(/whole items/);
    expect(allocate(ctx, [nr], [], { requirementId: "R3", componentId: "BASIN-1", quantity: 1 }, NOW, newId).error).toBeNull();
  });

  it("units are never combined: a count requirement cannot take an area-measured component", () => {
    const nr = mkReq({ unit: "nr", quantity: 2 }, "R3");
    expect(allocate(ctx, [nr], [], { requirementId: "R3", componentId: "TILE-A", quantity: 1 }, NOW, newId).error).toMatch(/Incompatible: Measured in m²; the requirement is in nr/);
  });

  it("allocates a conditional match, recording its conditions, and keeps the original quantities and assessments unchanged", () => {
    const before = JSON.stringify([...inv.byId].map(([id, q]) => [id, q.primary.value, q.mass.value]));
    const aBefore = serializeAssessments(A);
    const cut = mkReq({ quantity: 1, dims: dims({ length: rng(null, 0.65) }), accept: { cleaning: true, refurbishment: true, cutting: true, testing: true } }, "R4");
    const r = allocate(ctx, [cut], [], { requirementId: "R4", componentId: "TILE-C", quantity: 0.5 }, NOW, newId);
    expect(r.error).toBeNull();
    expect(r.allocation!.basis.tier).toBe("conditional");
    expect(r.allocation!.basis.conditions.join(" ")).toMatch(/Cut length/);
    expect(JSON.stringify([...inv.byId].map(([id, q]) => [id, q.primary.value, q.mass.value]))).toBe(before);
    expect(serializeAssessments(A)).toBe(aBefore);
  });

  it("batch allocation applies what fits and reports what was refused", () => {
    const b = allocateBatch(ctx, reqs, [], [
      { requirementId: "R1", componentId: "TILE-A", quantity: 0.3 },
      { requirementId: "R2", componentId: "TILE-A", quantity: 0.3 }, // only 0.06 left
      { requirementId: "R2", componentId: "TILE-F", quantity: 0.3 },
    ], NOW, newId);
    expect(b.applied).toBe(2);
    expect(b.errors).toHaveLength(1);
    expect(b.errors[0]).toMatch(/TILE-A.*free/);
  });

  it("reconciles: the books balance after any sequence of valid operations", () => {
    let a: readonly Allocation[] = [];
    for (const [rq, id, q] of [["R1", "TILE-A", 0.2], ["R2", "TILE-A", 0.16], ["R1", "TILE-F", 0.3], ["R2", "TILE-F", 0.2], ["R1", "TILE-A", 0.1], ["R2", "TILE-A", 0.26]] as const) a = go(a, rq, id, q).allocations;
    expect(reconcile(ctx, reqs, a)).toEqual([]);
    const by = allocatedByComponent(a);
    expect(by.get("TILE-A")!).toBeLessThanOrEqual(0.36 + 1e-9);
    expect(by.get("TILE-F")!).toBeLessThanOrEqual(0.36 + 1e-9);
  });

  it("never adds different units: totals are one line per unit", () => {
    const nr = mkReq({ substance: "sanitary_ceramic", form: "sanitary", unit: "nr", quantity: 2 }, "R3");
    const all = [r1, r2, nr];
    const a = allocate(ctx, all, go([], "R1", "TILE-A", 0.3).allocations, { requirementId: "R3", componentId: "BASIN-1", quantity: 1 }, NOW, newId).allocations;
    const t = totalsByUnit(demandRows(all, a));
    expect(t.map((x) => x.unit)).toEqual(["m2", "nr"]);
    expect(t[0]).toMatchObject({ requirements: 2, required: 0.9, allocated: 0.3, remaining: 0.6 });
    expect(t[1]).toMatchObject({ requirements: 1, required: 2, allocated: 1, remaining: 1 });
  });

  it("demandStatus covers the edges", () => {
    expect(demandStatus(10, 0)).toBe("unmet");
    expect(demandStatus(10, 4)).toBe("partial");
    expect(demandStatus(10, 10)).toBe("matched");
    expect(demandStatus(0.3, 0.1 + 0.2)).toBe("matched"); // float noise
    expect(demandStatus(10, 11)).toBe("over");
  });
});

describe("review: an allocation is flagged when the data under it changes, never silently altered", () => {
  const A = assess(["TILE-A"], REUSE);
  const r1 = mkReq({ quantity: 0.36 }, "R1");
  const made = allocate(ctxOf(A), [r1], [], { requirementId: "R1", componentId: "TILE-A", quantity: 0.36 }, NOW, newId).allocations;

  it("is clean when nothing changed", () => {
    expect(reviewAllocations(ctxOf(A), [r1], made)).toEqual([]);
  });
  it("flags more allocated than the component can now supply when the recovery % is lowered", () => {
    const lowered = assess(["TILE-A"], { recoveryPct: 50 }, A);
    const rv = reviewAllocations(ctxOf(lowered), [r1], made);
    expect(rv[0]!.flags.map((f) => f.code)).toContain("over_supply");
    expect(rv[0]!.flags.find((f) => f.code === "over_supply")!.fits).toBeCloseTo(0.18, 9);
    expect(reconcile(ctxOf(lowered), [r1], made)[0]).toMatch(/allocated, supply/);
  });
  it("flags a component that has become incompatible", () => {
    const recycled = assess(["TILE-A"], { classification: "recycling", recoveryPct: 90 }, A);
    expect(reviewAllocations(ctxOf(recycled), [r1], made)[0]!.flags.map((f) => f.code)).toContain("now_incompatible");
    const damaged = observe("TILE-A", { observedCondition: "damaged" });
    expect(reviewAllocations(ctxOf(A, damaged), [r1], made)[0]!.flags.find((f) => f.code === "now_incompatible")!.text).toMatch(/damaged/);
  });
  it("flags a strong match that has weakened to conditional", () => {
    const needsStep = assess(["TILE-A"], { preparation: "cleaning" }, A);
    expect(reviewAllocations(ctxOf(needsStep), [r1], made)[0]!.flags.map((f) => f.code)).toContain("now_conditional");
  });
  it("flags a component that is not in the model", () => {
    const orphan: Allocation = { ...made[0]!, id: "ORPH", componentId: "GONE" };
    expect(reviewAllocations(ctxOf(A), [r1], [orphan])[0]!.flags[0]!.code).toBe("missing_component");
  });
  it("flags a unit that no longer matches", () => {
    const wrongUnit: Allocation = { ...made[0]!, unit: "nr" };
    expect(reviewAllocations(ctxOf(A), [r1], [wrongUnit])[0]!.flags.map((f) => f.code)).toContain("unit_changed");
  });
});

describe("suggested allocation", () => {
  const A = assess(["TILE-A", "TILE-B", "TILE-F", "TILE-C"], REUSE);
  const ctx = ctxOf(A);
  const r1 = mkReq({ quantity: 0.8 }, "R1");

  it("fills the ranking until the requirement is covered, larger supply first, and is deterministic", () => {
    const res = matchRequirement(ctx, r1);
    const p = proposeFill(r1, res, []);
    expect(p.items.map((i) => [i.componentId, i.quantity])).toEqual([["TILE-C", 0.72], ["TILE-A", 0.08]]);
    expect(p.items[1]!.partialPiece).toBe(true); // 0.08 of 0.36: a piece would be cut
    expect(p.quantity).toBeCloseTo(0.8, 9);
    expect(p.remainingAfter).toBe(0);
    expect(proposeFill(r1, res, [])).toEqual(p);
  });
  it("uses conditional components only when asked, and reports what stays unmet", () => {
    const res = matchRequirement(ctxOf(assess(["TILE-A"], REUSE)), r1);
    const strongOnly = proposeFill(r1, res, [], { includeConditional: false });
    expect(strongOnly.items.map((i) => i.componentId)).toEqual(["TILE-A"]);
    expect(strongOnly.remainingAfter).toBeCloseTo(0.44, 9);
    const withCond = proposeFill(r1, res, [], { includeConditional: true });
    expect(withCond.conditionalCount).toBeGreaterThan(0);
    expect(withCond.items[0]!.tier).toBe("strong");
  });
  it("respects what other requirements and confirmed allocations have already taken", () => {
    const other = allocate(ctx, [mkReq({ quantity: 0.72 }, "R0"), r1], [], { requirementId: "R0", componentId: "TILE-C", quantity: 0.72 }, NOW, newId).allocations;
    const p = proposeFill(r1, matchRequirement(ctx, r1), other);
    expect(p.items.map((i) => i.componentId)).not.toContain("TILE-C");
    expect(p.items.every((i) => i.quantity > 0)).toBe(true);
    // a component already confirmed for this requirement is skipped, and its quantity counts toward the demand
    const mine = allocate(ctx, [r1], [], { requirementId: "R1", componentId: "TILE-C", quantity: 0.72 }, NOW, newId).allocations;
    const p2 = proposeFill(r1, matchRequirement(ctx, r1), mine);
    expect(p2.items.map((i) => i.componentId)).toEqual(["TILE-A"]);
    expect(p2.quantity).toBeCloseTo(0.08, 9);
  });
  it("a proposal can be confirmed through the same validated path", () => {
    const p = proposeFill(r1, matchRequirement(ctx, r1), []);
    const b = allocateBatch(ctx, [r1], [], p.items, NOW, newId);
    expect(b.errors).toEqual([]);
    expect(demandRows([r1], b.allocations)[0]!.status).toBe("matched");
  });
  it("reports the potential supply of the candidates net of other requirements' allocations", () => {
    const res = matchRequirement(ctx, r1);
    const pot = potentialSupply(res, [], "R1");
    expect(pot.strong).toBeCloseTo(0.36 + 0.09 + 0.36 + 0.72, 9);
    const taken = allocate(ctx, [mkReq({ quantity: 0.3 }, "R9"), r1], [], { requirementId: "R9", componentId: "TILE-A", quantity: 0.3 }, NOW, newId).allocations;
    expect(potentialSupply(res, taken, "R1").strong).toBeCloseTo(0.36 + 0.09 + 0.36 + 0.72 - 0.3, 9);
  });
});

describe("persistence", () => {
  const r1 = mkReq({ quantity: 0.5, extraSpecs: [{ label: "Grade", value: "A" }], dims: dims({ length: rng(0.5, null) }) }, "R1");
  const ctx = ctxOf(assess(["TILE-A"], REUSE));
  const allocs = allocate(ctx, [r1], [], { requirementId: "R1", componentId: "TILE-A", quantity: 0.3, note: "kitchen" }, NOW, newId).allocations;
  const cfg: MatchConfig = { ...DEFAULT_CONFIG, weights: { ...DEFAULT_CONFIG.weights, dimensions: 40 }, partialCredit: 0.4 };
  const text = serializeReuse({ requirements: [r1], allocations: allocs, config: cfg, activeId: "R1" });

  it("round-trips requirements, allocations, configuration and the active requirement", () => {
    const back = parseReuse(text);
    expect(back.requirements).toEqual([r1]);
    expect(back.allocations).toEqual(allocs);
    expect(back.config).toEqual(cfg);
    expect(back.activeId).toBe("R1");
    expect(back.dropped).toEqual({ requirements: 0, allocations: 0 });
  });
  it("is empty for missing, malformed or outdated data, and never throws", () => {
    for (const t of [null, "", "{", "[]", "null", JSON.stringify({ version: 99, requirements: [r1] }), JSON.stringify({ requirements: [r1] })]) {
      const p = parseReuse(t);
      expect(p.requirements).toEqual([]);
      expect(p.allocations).toEqual([]);
      expect(p.config).toEqual(DEFAULT_CONFIG);
      expect(p.activeId).toBeNull();
    }
  });
  it("drops invalid entries and counts them, keeping the valid ones", () => {
    const d = JSON.parse(text);
    d.requirements.push({ id: "BAD", name: "", unit: "m2", quantity: 1 }, { ...d.requirements[0], id: "R1" }, "junk", { ...d.requirements[0], id: "R2", quantity: -3 });
    d.allocations.push({ ...d.allocations[0], id: "X1", requirementId: "NOPE" }, { ...d.allocations[0], id: "X2" }, { ...d.allocations[0], id: "X3", componentId: "TILE-F", quantity: 0 }, null);
    const p = parseReuse(JSON.stringify(d));
    expect(p.requirements.map((r) => r.id)).toEqual(["R1"]);
    expect(p.allocations.map((a) => a.id)).toEqual([allocs[0]!.id]);
    expect(p.dropped.requirements).toBe(4);
    expect(p.dropped.allocations).toBe(4);
  });
  it("keeps allocations of components that are not in the model (the model may be regenerated) so the review can flag them", () => {
    const d = JSON.parse(text);
    d.allocations[0].componentId = "REGENERATED-ID";
    const p = parseReuse(JSON.stringify(d));
    expect(p.allocations[0]!.componentId).toBe("REGENERATED-ID");
    expect(reviewAllocations(ctx, p.requirements, p.allocations)[0]!.flags[0]!.code).toBe("missing_component");
  });
  it("falls back to the default configuration when the stored one is invalid, and to the first requirement when the active one is gone", () => {
    const d = JSON.parse(text);
    d.config.weights.material = 999;
    d.activeId = "GONE";
    const p = parseReuse(JSON.stringify(d));
    expect(p.config).toEqual(DEFAULT_CONFIG);
    expect(p.activeId).toBe("R1");
  });
});

describe("export (hand-off to C3)", () => {
  const r1 = mkReq({ quantity: 0.5 }, "R1");
  const ctx = ctxOf(assess(["TILE-A"], REUSE));
  const allocs = allocate(ctx, [r1], [], { requirementId: "R1", componentId: "TILE-A", quantity: 0.3 }, NOW, newId).allocations;
  const input = { requirements: [r1], allocations: allocs, reviews: reviewAllocations(ctx, [r1], allocs), inventory: inv };
  it("JSON carries the schema, the disclaimer and a planned outcome with nothing recovered or reused recorded", () => {
    const j = JSON.parse(planToJson(input, NOW));
    expect(j.schema).toBe(SCHEMA);
    expect(j.disclaimer).toMatch(/not an assessment of structural suitability, code compliance/);
    expect(j.requirements[0]).toMatchObject({ id: "R1", unit: "m2", required: 0.5, allocated: 0.3, remaining: 0.2, status: "partial" });
    expect(j.allocations[0]).toMatchObject({ componentId: "TILE-A", quantity: 0.3, unit: "m2", outcome: { status: "planned", recoveredQuantity: null, reusedQuantity: null } });
    expect(j.allocations[0].matchAtConfirmation.tier).toBe("strong");
  });
  it("CSV has a header and one row per allocation", () => {
    const lines = planToCsv(input).trim().split("\r\n");
    expect(lines[0]).toBe(CSV_HEADER.join(","));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("TILE-A");
  });
});

describe("the real model", () => {
  const real = getModelInventory();
  const realCtx = (assessments: Assessments = EMPTY): MatchContext => ({ inv: real, assessments, meta: NO_META, config: DEFAULT_CONFIG });
  const realReq = (): Requirement => mkReq({ name: "Floor tiles", substance: "porcelain_tile", form: "tile_floor", unit: "m2", quantity: 40, dims: dims({ length: rng(0.3, null), width: rng(0.3, null) }) }, "REAL");

  it("every leaf component is accounted for: evaluated + excluded = all, and the three tiers partition the evaluated ones", () => {
    const res = matchRequirement(realCtx(), realReq());
    expect(res.evaluated + res.excluded).toBe(real.rows.length);
    expect(res.strong.length + res.conditional.length + res.incompatible.length).toBe(res.evaluated);
    expect(res.evaluated).toBeGreaterThan(1000);
    expect(res.strong).toHaveLength(0); // nothing is assessed, so nothing can be a strong match
    for (const c of [...res.conditional, ...res.incompatible]) expect(real.recordById.get(c.id)!.materialId).toMatch(/porcelain|tile_porcelain_floor/);
  });
  it("with no assessments every candidate is conditional or incompatible, and the conditional ones say the recovery data is missing", () => {
    const res = matchRequirement(realCtx(), realReq());
    const c = res.conditional[0]!;
    expect(c.missing.map((m) => m.code)).toContain("unassessed");
    expect(c.supply.basis).toBe("upper_bound");
  });
  it("assessing real components for reuse turns them into strong matches whose supply is the B2 estimate", () => {
    const ids = matchRequirement(realCtx(), realReq()).conditional.slice(0, 5).map((c) => c.id);
    const a = applyPatch(real, EMPTY, ids, { classification: "direct_reuse", recoveryPct: 80, preparation: "none" }).map;
    const res = matchRequirement(realCtx(a), realReq());
    expect(res.strong.map((c) => c.id).sort()).toEqual([...ids].sort());
    for (const c of res.strong) expect(c.supply.value).toBeCloseTo(real.byId.get(c.id)!.primary.value! * 0.8, 9);
  });
  it("allocates real tiles across two competing requirements without double counting", () => {
    const base = matchRequirement(realCtx(), realReq()).conditional.slice(0, 3).map((c) => c.id);
    const a = applyPatch(real, EMPTY, base, { classification: "direct_reuse", recoveryPct: 100, preparation: "none" }).map;
    const ctx = realCtx(a);
    const A = mkReq({ name: "A", quantity: 40 }, "A");
    const B = mkReq({ name: "B", quantity: 40 }, "B");
    const plan = proposeFill(A, matchRequirement(ctx, A), []);
    let allocs = allocateBatch(ctx, [A, B], [], plan.items, NOW, newId).allocations;
    const supplyOfFirst = matchRequirement(ctx, A).byId.get(base[0]!)!.supply.value!;
    const first = allocs.find((x) => x.componentId === base[0])!;
    // the first component is fully taken by A; B cannot take any of it
    expect(first.quantity).toBeCloseTo(supplyOfFirst, 9);
    expect(allocate(ctx, [A, B], allocs, { requirementId: "B", componentId: base[0]!, quantity: 0.001 }, NOW, newId).error).toMatch(/free|supply/);
    allocs = allocate(ctx, [A, B], allocs, { requirementId: "B", componentId: base[0]!, quantity: 0.001 }, NOW, newId).allocations;
    expect(reconcile(ctx, [A, B], allocs)).toEqual([]);
    for (const [id, total] of allocatedByComponent(allocs)) expect(total).toBeLessThanOrEqual(real.byId.get(id)!.primary.value! + 1e-9);
  });
  it("matches 20,000+ components fast enough for live use", () => {
    const t = performance.now();
    matchRequirement(realCtx(new Map(EMPTY)), realReq());
    expect(performance.now() - t).toBeLessThan(5000);
  });
});
