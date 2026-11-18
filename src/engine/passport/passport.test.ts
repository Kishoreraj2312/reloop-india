import { describe, expect, it } from "vitest";
import { getModelInventory } from "@/engine/quantities";
import { applyPatch, serializeAssessments, type Assessments } from "@/engine/recovery";
import { componentCarbon, emptyFactor, EMPTY_ASSUMPTIONS, illustrativeFactors, type FactorLibrary } from "@/engine/carbon";
import { evaluateLeaf, makeContext, makeRule, newScenario, setCategoryRule } from "@/engine/scenarios";
import {
  applyMeta,
  buildPassport,
  clearMeta,
  CSV_HEADER,
  EMPTY_META,
  fieldOf,
  isIsoDate,
  parseMeta,
  passportFileName,
  passportToCsv,
  passportToJson,
  SCHEMA,
  serializeMeta,
  type MetaMap,
  type Passport,
  type PassportInput,
  type RemovalStatus,
  type ScenarioOutcome,
} from "./index";

const inv = getModelInventory();
const NONE: Assessments = new Map();
const NOW = "2026-01-01T00:00:00.000Z";
const COLUMN = "STR-COL-F01-A1"; // 0.729 m3 reinforced-concrete column
const noMeta: MetaMap = new Map();
const base = (over: Partial<PassportInput> = {}): PassportInput => ({ id: COLUMN, inventory: inv, assessments: NONE, meta: undefined, removal: null, carbon: null, scenarios: [], ...over });
const pp = (over: Partial<PassportInput> = {}): Passport => {
  const p = buildPassport(base(over));
  if (!p.found) throw new Error("not found");
  return p;
};
const val = (p: Passport, s: Parameters<typeof fieldOf>[1], k: string) => fieldOf(p, s, k);

describe("component linking", () => {
  it("a passport is linked to the stable component id and shows identity, material, dimensions and quantity from the existing modules", () => {
    const p = pp();
    expect(p.id).toBe(COLUMN);
    expect(p.kind).toBe("component");
    const rec = inv.recordById.get(COLUMN)!;
    expect(val(p, "identity", "id")!.value).toBe(COLUMN);
    expect(val(p, "identity", "name")!.value).toBe(rec.name);
    expect(val(p, "identity", "floor")!.value).toBe("F01");
    expect(val(p, "material", "materialId")!.value).toBe(rec.materialId);
    expect(val(p, "material", "materialName")!.value).toBe("reinforced concrete (conceptual)");
    expect(val(p, "material", "materialCategory")!.value).toBe("Concrete");
    const dims = p.sections.find((s) => s.key === "quantity")!.fields.filter((f) => f.key.startsWith("dim."));
    expect(dims.length).toBeGreaterThan(0);
    for (const d of dims) expect(d.unit).toBe("m");
    const primary = val(p, "quantity", "primary")!;
    expect(primary.value).toBeCloseTo(0.729, 9);
    expect(primary.unit).toBe("m³");
    expect(primary.status).toBe("calculated");
    expect(primary.source).toBe("B1");
    expect(val(p, "quantity", "mass")!.status).toBe("estimated");
    expect(val(p, "quantity", "mass")!.value).toBeCloseTo(0.729 * 2400, 6);
    expect(val(p, "quantity", "recordedQuantity")!.source).toBe("model");
  });

  it("the model's condition and route are labelled as generated defaults, never as observations", () => {
    const p = pp();
    expect(val(p, "condition", "modelCondition")!.status).toBe("assumed");
    expect(val(p, "condition", "modelCondition")!.note).toMatch(/not an inspection/);
    expect(val(p, "condition", "modelRoute")!.status).toBe("assumed");
    expect(val(p, "condition", "observedCondition")!.status).toBe("missing");
    expect(val(p, "condition", "inspectionStatus")!.value).toBeNull();
    expect(p.cautions.join(" ")).toMatch(/design assumptions, not site measurements/);
  });

  it("an unknown id returns a MissingPassport instead of throwing", () => {
    for (const id of ["", "NO-SUCH-ID", "STR-COL-F01-A1 "]) {
      const p = buildPassport(base({ id }));
      expect(p.found).toBe(false);
      if (!p.found) expect(p.reason).toMatch(/not a component/);
    }
  });

  it("an assembly passport rolls up its parts once and never invents a quantity", () => {
    const asm = inv.records.find((r) => r.componentType === "wall_assembly")!;
    const p = pp({ id: asm.id });
    expect(p.kind).toBe("assembly");
    expect(val(p, "quantity", "parts")!.value).toBeGreaterThan(1);
    expect(val(p, "quantity", "primary")).toBeUndefined();
    expect(val(p, "recovery", "assessedParts")!.value).toMatch(/^0 of \d+$/);
    expect(val(p, "sustainability", "carbon")!.status).toBe("missing");
  });
});

describe("recovery, removal and sustainability data from existing modules", () => {
  it("B2: not assessed is missing; an assessment appears as the user's estimate with B2's own calculation", () => {
    expect(val(pp(), "recovery", "classification")!.status).toBe("missing");
    expect(val(pp(), "recovery", "recoverable")!.value).toBeNull();
    const a = applyPatch(inv, NONE, [COLUMN], { classification: "recycling", recoveryPct: 60, destination: "material_recycling" }).map;
    const p = pp({ assessments: a });
    expect(val(p, "recovery", "classification")!.value).toMatch(/recycling/i);
    expect(val(p, "recovery", "classification")!.status).toBe("user");
    expect(val(p, "recovery", "recoveryPct")!).toMatchObject({ value: 60, status: "estimated", unit: "%" });
    expect(val(p, "recovery", "recoverable")!.value).toBeCloseTo(0.4374, 9);
    expect(val(p, "recovery", "recoverable")!.note).toBe("0.729 m³ × 60% = 0.437 m³");
    expect(val(p, "recovery", "destination")!.value).toMatch(/recycling/i);
    // a recoverable class without a % says why the quantity is missing
    const noPct = applyPatch(inv, NONE, [COLUMN], { classification: "direct_reuse" }).map;
    expect(val(pp({ assessments: noPct }), "recovery", "recoverable")!.note).toMatch(/recovery % not set/);
  });
  it("B3: no plan, a plan without the component, and a planned step are distinguished", () => {
    expect(val(pp(), "removal", "plan")!.status).toBe("missing");
    const notIn: RemovalStatus = { planName: "P", step: null, steps: 3, state: null, blocked: false, viaAssembly: null };
    expect(val(pp({ removal: notIn }), "removal", "step")!.status).toBe("missing");
    const planned: RemovalStatus = { planName: "P", step: 2, steps: 5, state: "Planned", blocked: true, viaAssembly: null };
    const p = pp({ removal: planned });
    expect(val(p, "removal", "step")!.value).toBe("2 of 5");
    expect(val(p, "removal", "state")!.note).toMatch(/does not show that anything has been removed/);
    expect(val(p, "removal", "blocked")!.value).toMatch(/^yes/);
  });
  it("B5: not assessed without a factor; with the illustrative set the figure and a caution say so; with a user factor no caution", () => {
    const row = { rec: inv.recordById.get(COLUMN)!, q: inv.byId.get(COLUMN)! };
    const none = componentCarbon(row, new Map(), EMPTY_ASSUMPTIONS);
    expect(val(pp({ carbon: none }), "sustainability", "carbon")!.note).toMatch(/no emission factor/);
    const illus = pp({ carbon: componentCarbon(row, illustrativeFactors(), EMPTY_ASSUMPTIONS) });
    expect(val(illus, "sustainability", "carbon")!).toMatchObject({ status: "estimated", unit: "kgCO₂e" });
    expect(val(illus, "sustainability", "carbon")!.note).toMatch(/ILLUSTRATIVE/);
    expect(illus.cautions.join(" ")).toMatch(/ILLUSTRATIVE/);
    const lib: FactorLibrary = new Map([["concrete", { ...emptyFactor("concrete", "m3"), value: 300, origin: "assumed" as const }]]);
    const user = pp({ carbon: componentCarbon(row, lib, EMPTY_ASSUMPTIONS) });
    expect(val(user, "sustainability", "carbon")!.value).toBeCloseTo(0.729 * 300, 9);
    expect(user.cautions.join(" ")).not.toMatch(/ILLUSTRATIVE/);
  });
  it("B4: the outcome in each compared scenario comes from B4's own allocation", () => {
    const a = applyPatch(inv, NONE, [COLUMN], { classification: "recycling", recoveryPct: 60 }).map;
    const s = setCategoryRule(newScenario("s", "Selective", "selective", ["concrete"]), "concrete", makeRule("recycling", 80)).scenario;
    const o = evaluateLeaf(makeContext(inv, a, s), { rec: inv.recordById.get(COLUMN)!, q: inv.byId.get(COLUMN)! }, "quantity");
    const outcome: ScenarioOutcome = { scenario: s.name, unit: o.unit, quantity: o.allocation!.quantity, outcome: o.allocation!.outcome, missing: null };
    const p = pp({ assessments: a, scenarios: [outcome] });
    const f = val(p, "sustainability", "scenario.Selective")!;
    expect(f.source).toBe("B4");
    expect(f.value).toMatch(/recycling 0\.5832/);
    expect(f.value).toMatch(/disposal 0\.1458/);
    expect(val(pp({ scenarios: [{ scenario: "X", unit: "m3", quantity: null, outcome: null, missing: null }] }), "sustainability", "scenario.X")!.status).toBe("missing");
  });
});

describe("data quality: missing is never fabricated", () => {
  it("every field with no value is 'missing', every field with a value is not, and no value is NaN or undefined — for a sample of the whole model", () => {
    let n = 0;
    for (let i = 0; i < inv.records.length; i += 9) {
      const r = inv.records[i]!;
      const p = buildPassport(base({ id: r.id }));
      expect(p.found, r.id).toBe(true);
      if (!p.found) continue;
      for (const s of p.sections)
        for (const f of s.fields) {
          expect(f.value === null ? f.status === "missing" : f.status !== "missing", `${r.id} ${f.key}`).toBe(true);
          expect(typeof f.value === "number" ? Number.isFinite(f.value) : true, `${r.id} ${f.key}`).toBe(true);
          expect(f.value).not.toBeUndefined();
        }
      expect(Object.values(p.counts).reduce((a, b) => a + b, 0)).toBe(p.sections.reduce((a, s) => a + s.fields.length, 0));
      n++;
    }
    expect(n).toBeGreaterThan(9000);
  });
  it("a component whose mass B1 cannot estimate shows the mass as missing with B1's reason", () => {
    const row = inv.rows.find((r) => r.q.mass.value === null && r.rec.system === "plumbing")!;
    const f = val(pp({ id: row.rec.id }), "quantity", "mass")!;
    expect(f.value).toBeNull();
    expect(f.status).toBe("missing");
    expect(f.note).toBeTruthy();
  });
});

describe("editable metadata", () => {
  it("applies valid entries, keeps the map sparse and stamps the edit time", () => {
    const a = applyMeta(noMeta, COLUMN, { inspectionStatus: "inspected", observedCondition: "fair", inspectedOn: "2026-03-14", inspectedBy: "A. Tester", conditionNote: "hairline crack", provenanceNote: "cast 2009" }, NOW);
    expect(a.error).toBeNull();
    expect(a.map.get(COLUMN)).toMatchObject({ inspectionStatus: "inspected", observedCondition: "fair", inspectedOn: "2026-03-14", updatedAt: NOW });
    expect(noMeta.size).toBe(0); // immutable
    expect(applyMeta(a.map, COLUMN, { conditionNote: "hairline crack" }, "later").map).toBe(a.map); // no change, no new stamp
    const cleared = applyMeta(applyMeta(noMeta, COLUMN, { conditionNote: "x" }, NOW).map, COLUMN, { conditionNote: "" }, NOW);
    expect(cleared.map.size).toBe(0);
    expect(clearMeta(a.map, COLUMN).size).toBe(0);
    expect(clearMeta(a.map, "OTHER")).toBe(a.map);
  });
  it("rejects invalid input and returns the same map", () => {
    const m = applyMeta(noMeta, COLUMN, { conditionNote: "ok" }, NOW).map;
    for (const bad of [{ inspectionStatus: "done" as never }, { observedCondition: "great" as never }, { inspectedOn: "2026-02-30" }, { inspectedOn: "14/03/2026" }, { inspectedOn: "1800-01-01" }, { conditionNote: "x".repeat(2001) }, { inspectedBy: "y".repeat(121) }]) {
      const r = applyMeta(m, COLUMN, bad, NOW);
      expect(r.error, JSON.stringify(bad)).toBeTruthy();
      expect(r.map).toBe(m);
    }
    expect(applyMeta(m, "", { conditionNote: "x" }, NOW).error).toBeTruthy();
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2023-02-29")).toBe(false);
  });
  it("entries appear in the passport as user entries and nothing else changes", () => {
    const meta = applyMeta(noMeta, COLUMN, { inspectionStatus: "scheduled", observedCondition: "poor", conditionNote: "spalling", provenanceNote: "supplier X" }, NOW).map.get(COLUMN);
    const withMeta = pp({ meta });
    expect(val(withMeta, "condition", "inspectionStatus")).toMatchObject({ value: "Inspection scheduled", status: "user", source: "user" });
    expect(val(withMeta, "condition", "observedCondition")!.value).toBe("Poor");
    expect(val(withMeta, "provenance", "provenanceNote")!.value).toBe("supplier X");
    expect(val(withMeta, "provenance", "updatedAt")!.value).toBe(NOW);
    const plain = pp();
    expect(val(withMeta, "quantity", "primary")).toEqual(val(plain, "quantity", "primary")); // B1 is read-only
    expect(val(withMeta, "recovery", "classification")).toEqual(val(plain, "recovery", "classification"));
  });
});

describe("persistence", () => {
  it("round-trips, drops invalid parts, and keeps notes for ids that are not in the model (reported as orphans)", () => {
    let m: MetaMap = new Map();
    m = applyMeta(m, COLUMN, { inspectionStatus: "inspected", inspectedOn: "2026-01-02", conditionNote: "a, \"quoted\"\nnote" }, NOW).map;
    m = applyMeta(m, "GONE-1", { provenanceNote: "from an older model" }, NOW).map;
    const back = parseMeta(serializeMeta(m), (id) => inv.recordById.has(id));
    expect(new Map(back.map)).toEqual(new Map(m));
    expect(back.orphans).toEqual(["GONE-1"]);
    expect(back.dropped).toBe(0);
    expect(parseMeta(null).map.size).toBe(0);
    expect(parseMeta("{nope").map.size).toBe(0);
    expect(parseMeta(JSON.stringify({ version: 9, entries: [] })).map.size).toBe(0);
    const bad = parseMeta(JSON.stringify({ version: 1, entries: [["A", { inspectionStatus: "bogus", observedCondition: "fair", inspectedOn: "2026-13-01", conditionNote: 5 }], ["B", {}], ["C", 7], [1, { conditionNote: "x" }], ["D", { conditionNote: "y".repeat(5000) }]] }));
    expect(bad.map.get("A")).toMatchObject({ inspectionStatus: null, observedCondition: "fair", inspectedOn: "", conditionNote: "" });
    expect(bad.map.get("D")!.conditionNote.length).toBe(2000);
    expect(bad.dropped).toBe(3);
  });
  it("stores only the user's metadata (no B1 / B2 / B4 / B5 data)", () => {
    const text = serializeMeta(applyMeta(noMeta, COLUMN, { conditionNote: "n" }, NOW).map);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["entries", "version"]);
    expect(Object.keys(JSON.parse(text).entries[0][1]).sort()).toEqual(Object.keys(EMPTY_META).sort());
  });
});

describe("export", () => {
  const meta = applyMeta(noMeta, COLUMN, { conditionNote: "has, comma and \"quote\"\nand newline", provenanceNote: "p" }, NOW).map.get(COLUMN);
  const p = pp({ meta, assessments: applyPatch(inv, NONE, [COLUMN], { classification: "recycling", recoveryPct: 60 }).map });
  it("JSON carries every field with its status and source, null for missing values, and is deterministic", () => {
    const text = passportToJson(p, NOW);
    expect(passportToJson(p, NOW)).toBe(text);
    const j = JSON.parse(text);
    expect(j.schema).toBe(SCHEMA);
    expect(j.exportedAt).toBe(NOW);
    expect(j.component).toEqual({ id: COLUMN, name: p.name, kind: "component" });
    expect(j.disclaimer).toMatch(/not site measurements/);
    const fields = j.sections.flatMap((s: { fields: unknown[] }) => s.fields) as { key: string; value: unknown; status: string; source: string; unit: string | null }[];
    expect(fields.length).toBe(p.sections.reduce((n, s) => n + s.fields.length, 0));
    expect(fields.find((f) => f.key === "primary")).toMatchObject({ value: 0.729, status: "calculated", source: "B1", unit: "m³" }); // 12 significant digits: no float noise
    expect(fields.find((f) => f.key === "observedCondition")).toMatchObject({ value: null, status: "missing" });
    expect(fields.find((f) => f.key === "conditionNote")!.value).toBe("has, comma and \"quote\"\nand newline");
    expect(j.dataQuality).toEqual(p.counts);
  });
  it("CSV has one row per field, a fixed header, and escapes commas, quotes and newlines (parseable back)", () => {
    const csv = passportToCsv(p);
    const rows = parseCsvRows(csv);
    expect(rows[0]).toEqual([...CSV_HEADER]);
    expect(rows.length).toBe(1 + 1 + p.sections.reduce((n, s) => n + s.fields.length, 0));
    expect(rows[1]).toEqual([COLUMN, "component", p.name, "", "", "", "component"]);
    const note = rows.find((r) => r[1] === "Condition note")!;
    expect(note[2]).toBe("has, comma and \"quote\"\nand newline");
    expect(note[4]).toBe("user entry");
    const miss = rows.find((r) => r[1] === "Observed condition")!;
    expect(miss[2]).toBe("");
    expect(miss[4]).toBe("missing");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
  it("file names are safe", () => {
    expect(passportFileName("STR-COL-F01-A1", "json")).toBe("passport_STR-COL-F01-A1.json");
    expect(passportFileName("a/b c:d", "csv")).toBe("passport_a_b_c_d.csv");
  });
});

describe("regression safety: read-only on B1 / B2", () => {
  it("building passports and exporting them leaves the inventory and the assessments untouched", () => {
    const a = applyPatch(inv, NONE, [COLUMN], { classification: "recycling", recoveryPct: 60 }).map;
    const before = serializeAssessments(a);
    const sum = () => inv.rows.reduce((n, r) => n + (r.q.primary.value ?? 0) + (r.q.mass.value ?? 0), 0);
    const s0 = sum();
    for (let i = 0; i < inv.records.length; i += 97) {
      const q = buildPassport(base({ id: inv.records[i]!.id, assessments: a }));
      if (q.found) {
        passportToJson(q, NOW);
        passportToCsv(q);
      }
    }
    expect(sum()).toBe(s0);
    expect(serializeAssessments(a)).toBe(before);
  });
});

/** Minimal RFC 4180 reader for the test (quotes, commas, newlines inside quotes). */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") (row.push(cur), (cur = ""));
    else if (c === "\r" && text[i + 1] === "\n") (row.push(cur), rows.push(row), (row = []), (cur = ""), i++);
    else cur += c;
  }
  return rows;
}

describe("recovery tracking (C3) and reuse allocation (C2) in the passport", () => {
  const TILE = "ARC-TILE-G-A1-LIV-R01C01";
  const tracked = { stage: "Recovered", stageAt: "2026-10-01T00:00:00.000Z", unit: "m²", planned: 0.32, plannedBasis: "b2_estimate" as const, recovered: 0.28, reused: null, recycled: null, disposed: null, unrecovered: null, inHand: 0.28, unaccounted: 0.08, quality: "measured" as const, flags: ["Recovered less than planned"], events: 4, lastRecordedAt: "2026-10-02T00:00:00.000Z" };
  it("a section for tracking is always present; an untracked component says so instead of showing a value", () => {
    const p = pp({ id: TILE });
    expect(p.sections.map((x) => x.key)).toEqual(["identity", "material", "quantity", "condition", "recovery", "removal", "sustainability", "provenance", "tracking"]);
    expect(val(p, "tracking", "stage")).toMatchObject({ value: null, status: "missing", source: "C3" });
    expect(val(p, "tracking", "stage")!.note).toMatch(/not tracked/);
    expect(val(p, "tracking", "allocation")).toMatchObject({ value: null, status: "missing", source: "C2" });
  });
  it("tracked quantities carry their source: B2's plan is an estimate, measured actuals are the user's entry, an unrecorded one is missing (not 0)", () => {
    const p = pp({ id: TILE, tracking: tracked });
    expect(val(p, "tracking", "stage")).toMatchObject({ value: "Recovered", status: "user", source: "C3" });
    expect(val(p, "tracking", "planned")).toMatchObject({ value: 0.32, status: "estimated", source: "B2", unit: "m²" });
    expect(val(p, "tracking", "recovered")).toMatchObject({ value: 0.28, status: "user", source: "C3" });
    expect(val(p, "tracking", "reused")).toMatchObject({ value: null, status: "missing" });
    expect(val(p, "tracking", "reused")!.note).toMatch(/unknown, not zero/);
    expect(val(p, "tracking", "unaccounted")).toMatchObject({ value: 0.08, status: "calculated" });
    expect(val(p, "tracking", "attention")!.value).toBe("Recovered less than planned");
  });
  it("estimated or assumed actual quantities are labelled as such, never as measured", () => {
    expect(val(pp({ id: TILE, tracking: { ...tracked, quality: "assumed" } }), "tracking", "recovered")!.status).toBe("assumed");
    expect(val(pp({ id: TILE, tracking: { ...tracked, quality: "estimated" } }), "tracking", "recovered")!.status).toBe("estimated");
    expect(val(pp({ id: TILE, tracking: { ...tracked, plannedBasis: "user" } }), "tracking", "planned")).toMatchObject({ status: "user", source: "C3" });
    expect(val(pp({ id: TILE, tracking: { ...tracked, planned: null, plannedBasis: "none" } }), "tracking", "planned")).toMatchObject({ value: null, status: "missing" });
  });
  it("C2 allocations are shown with how much was recorded as actually reused", () => {
    const p = pp({ id: TILE, allocations: [{ requirement: "Hall floor", quantity: 0.3, unit: "m²", reused: 0.2 }] });
    expect(val(p, "tracking", "allocation.0")).toMatchObject({ label: "Reuse allocation: Hall floor", value: 0.3, status: "recorded", source: "C2", unit: "m²" });
    expect(val(p, "tracking", "allocation.0")!.note).toMatch(/reused against it \(C3\): 0\.2 m²/);
  });
  it("an assembly is tracked per part", () => {
    const asm = [...inv.recordById.values()].find((r) => r.geometry.kind === "group")!;
    expect(val(pp({ id: asm.id }), "tracking", "tracking")).toMatchObject({ status: "missing", source: "C3" });
  });
});
