import { describe, expect, it } from "vitest";
import type { ComponentRecord } from "@/building/structure";
import { buildInventory, getModelInventory, type Inventory } from "@/engine/quantities";
import { box, rec } from "@/engine/quantities/testing";
import { applyPatch, type AssessmentPatch, type Assessments } from "@/engine/recovery";
import {
  apply,
  buildRows,
  byCategory,
  byFloor,
  byStatus,
  coverage,
  createBatch,
  CSV_HEADER,
  deleteBatch,
  discrepancies,
  fold,
  isClosed,
  leafIdsOf,
  liveFn,
  moves,
  parseAt,
  parseTracking,
  planNow,
  planScope,
  quantityError,
  reconcileRows,
  renameBatch,
  rollup,
  SCHEMA,
  serializeTracking,
  snapshotOf,
  start,
  statusCounts,
  summarize,
  syncAllocations,
  totals,
  trackingToCsv,
  trackingToJson,
  unresolved,
  type AllocationInput,
  type Op,
  type OpContext,
  type Records,
  type RemovalView,
  type Summary,
  type TrackingContext,
  type TrackingRecord,
} from "./index";

// ── fixtures: a tiny inventory whose every number can be checked by hand ────────────────────────────

const NOW = "2026-10-01T10:00:00.000Z";
let seq = 0;
const newId = () => `E${++seq}`;

const tile = (id: string, L: number, W: number, over: Partial<Parameters<typeof rec>[0]> = {}): ComponentRecord =>
  rec({ id, componentType: "floor_tile", materialId: "tile_porcelain_floor", geometry: box(L, 0.01, W), unit: "m2", quantity: L * W, dimensions: { length: L, width: W, thickness: 0.01 }, ...over });
const basin = (id: string): ComponentRecord => rec({ id, componentType: "basin", materialId: "sanitary_ceramic", geometry: box(0.5, 0.16, 0.42), unit: "nr", quantity: 1, dimensions: { length: 0.5, width: 0.42, height: 0.16 } });

const RECORDS: readonly ComponentRecord[] = [
  tile("TILE-A", 0.6, 0.6, { floor: 0 }), // 0.36 m2
  tile("TILE-B", 0.3, 0.3, { floor: 1 }), // 0.09 m2
  tile("TILE-C", 0.6, 0.6, { floor: 1 }), // 0.36 m2
  basin("BASIN-1"),
  basin("BASIN-2"),
  rec({ id: "ASM-1", componentType: "floor_assembly", geometry: { kind: "group", size: [1, 1, 1] }, unit: "nr", quantity: 1 }),
  tile("ASM-1-T1", 0.6, 0.6, { parentId: "ASM-1" }),
  tile("ASM-1-T2", 0.3, 0.3, { parentId: "ASM-1" }),
];
const inv: Inventory = buildInventory([...RECORDS]);

const EMPTY: Assessments = new Map();
const assess = (ids: readonly string[], patch: AssessmentPatch, from: Assessments = EMPTY): Assessments => applyPatch(inv, from, ids, patch).map;
const REUSE90: AssessmentPatch = { classification: "direct_reuse", recoveryPct: 90, preparation: "none" };

const ctxOf = (over: Partial<TrackingContext> = {}): TrackingContext => ({ inv, assessments: EMPTY, allocations: [], requirementNames: new Map(), removal: new Map(), ...over });
const alloc = (id: string, componentId: string, quantity: number, requirementId = "R1"): AllocationInput => ({ id, requirementId, componentId, quantity });
const names = new Map([["R1", "Hall floor"], ["R2", "Corridor"]]);

const oc = (tc: TrackingContext, id: string, now = NOW): OpContext => ({ now, newId, live: liveFn(tc)(id) });
function begin(id: string, tc: TrackingContext = ctxOf({ assessments: assess([id], REUSE90) })): { record: TrackingRecord; tc: TrackingContext } {
  const live = liveFn(tc)(id);
  const r = start({ componentId: id, plan: snapshotOf(live.plan) }, oc(tc, id));
  if (!r.record) throw new Error(r.error ?? "start failed");
  return { record: r.record, tc };
}
const run = (record: TrackingRecord, tc: TrackingContext, op: Op, now = NOW) => apply(record, op, oc(tc, record.componentId, now));
function must(record: TrackingRecord, tc: TrackingContext, op: Op, now = NOW): TrackingRecord {
  const r = run(record, tc, op, now);
  if (!r.record) throw new Error(`${op.type}: ${r.error}`);
  return r.record;
}
const sum = (record: TrackingRecord, tc: TrackingContext): Summary => summarize(record, liveFn(tc)(record.componentId));
const rec2 = (q: number, complete = false): Op => ({ type: "recover", quantity: q, source: "measured", method: "weighed", complete });
const out = (outcome: "reused" | "recycled" | "disposed", q: number, extra: Partial<Extract<Op, { type: "outcome" }>> = {}): Op => ({ type: "outcome", outcome, quantity: q, source: "measured", ...extra });
const near = (a: number | null, b: number, tol = 1e-9) => {
  expect(a).not.toBeNull();
  expect(Math.abs(a! - b)).toBeLessThanOrEqual(tol);
};

describe("the plan is read from B2, never invented", () => {
  const row = { rec: inv.recordById.get("TILE-A")!, q: inv.byId.get("TILE-A")! };
  it("planned recovery = B1 quantity × the recovery % of a reuse, refurbish or recycling classification", () => {
    near(planNow(row, assess(["TILE-A"], REUSE90).get("TILE-A")).quantity, 0.324);
    near(planNow(row, assess(["TILE-A"], { classification: "refurbish_reuse", recoveryPct: 50 }).get("TILE-A")).quantity, 0.18);
    expect(planNow(row, assess(["TILE-A"], { classification: "recycling", recoveryPct: 80 }).get("TILE-A"))).toMatchObject({ expected: "recycling" });
    expect(planNow(row, assess(["TILE-A"], REUSE90).get("TILE-A")).expected).toBe("reuse");
  });
  it("anything else has no planned quantity (null, not 0)", () => {
    for (const patch of [{ classification: "further_assessment" }, { classification: "insufficient_information" }, { classification: "direct_reuse" }] as AssessmentPatch[]) expect(planNow(row, assess(["TILE-A"], patch).get("TILE-A")).quantity).toBeNull();
    expect(planNow(row, undefined).quantity).toBeNull();
    expect(snapshotOf(planNow(row, undefined))).toMatchObject({ quantity: null, basis: "none" });
  });
  it("whole items are planned to the nearest whole item", () => {
    const b = { rec: inv.recordById.get("BASIN-1")!, q: inv.byId.get("BASIN-1")! };
    expect(planNow(b, assess(["BASIN-1"], { classification: "direct_reuse", recoveryPct: 90 }).get("BASIN-1")).quantity).toBe(1);
    expect(planNow(b, assess(["BASIN-1"], { classification: "direct_reuse", recoveryPct: 40 }).get("BASIN-1")).quantity).toBe(0);
  });
});

describe("starting to track", () => {
  it("creates one planned record in the component's own B1 unit, with the plan as it stood", () => {
    const { record, tc } = begin("TILE-A");
    const s = sum(record, tc);
    expect(record.unit).toBe("m2");
    expect(record.availableAtStart).toBeCloseTo(0.36, 12);
    expect(s).toMatchObject({ status: "planned", plannedBasis: "b2_estimate", expected: "reuse", recovered: null, reused: null, flags: expect.any(Array) });
    near(s.planned, 0.324);
    near(s.unaccounted, 0.36); // nothing recorded: the whole quantity is unaccounted, not "zero recovered"
    expect(s.inHand).toBeNull();
    expect(s.completion).toBeNull();
    expect(record.events).toHaveLength(1);
  });
  it("refuses assemblies, unknown ids and anything that is not a leaf of the model", () => {
    const tc = ctxOf();
    for (const id of ["ASM-1", "NOPE"]) {
      const r = start({ componentId: id, plan: snapshotOf(planNow({ rec: inv.recordById.get("TILE-A")!, q: inv.byId.get("TILE-A")! }, undefined)) }, oc(tc, id));
      expect(r.record).toBeNull();
      expect(r.error).toMatch(/not a component of the model/);
    }
  });
  it("an unplanned component can be tracked: it has no planned quantity and says so", () => {
    const { record, tc } = begin("TILE-B", ctxOf());
    const s = sum(record, tc);
    expect(s.planned).toBeNull();
    expect(s.flags.map((f) => f.code)).toContain("no_plan");
  });
  it("C2 allocations that already exist are logged (not silently adopted) and remembered", () => {
    const tc = ctxOf({ assessments: assess(["TILE-A"], REUSE90), allocations: [alloc("AL1", "TILE-A", 0.2)], requirementNames: names });
    const { record } = begin("TILE-A", tc);
    expect(record.events.map((e) => e.kind)).toEqual(["track", "allocation"]);
    expect(record.events[1]).toMatchObject({ change: "created", requirementName: "Hall floor", by: "system", note: "existing when tracking started" });
    expect(record.seen.AL1).toMatchObject({ quantity: 0.2 });
  });
  it("tracking a component twice is the store's refusal; the engine record itself is keyed by the component id", () => {
    const { record } = begin("TILE-A");
    const records: Records = { [record.componentId]: record };
    expect(Object.keys({ ...records, [record.componentId]: record })).toEqual(["TILE-A"]);
  });
});

describe("recording actual recovery: partial, complete, unknown and zero", () => {
  it("partial recovery moves the record to in progress and keeps planned and actual apart", () => {
    const { record, tc } = begin("TILE-A");
    const r1 = must(record, tc, rec2(0.2));
    const s = sum(r1, tc);
    expect(s.status).toBe("in_progress");
    near(s.recovered, 0.2);
    near(s.planned, 0.324);
    near(s.completion!, 0.2 / 0.324);
    near(s.difference, 0.2 - 0.324);
    near(s.inHand, 0.2);
    near(s.notYetRecovered, 0.16);
    near(s.unaccounted, 0.36);
    expect(s.reused).toBeNull();
  });
  it("recovery is cumulative; 'complete' moves it to recovered and a shortfall against the plan is flagged", () => {
    const { record, tc } = begin("TILE-A");
    let r = must(record, tc, rec2(0.2));
    r = must(r, tc, rec2(0.08, true));
    const s = sum(r, tc);
    expect(s.status).toBe("recovered");
    near(s.recovered, 0.28);
    expect(s.flags.map((f) => f.code)).toContain("below_plan"); // 0.28 / 0.324 = 86 %
    expect(s.flags.find((f) => f.code === "below_plan")!.level).toBe("warning");
  });
  it("recovering more than planned (within what is available) is flagged the other way", () => {
    const { record, tc } = begin("TILE-A");
    const s = sum(must(record, tc, rec2(0.36, true)), tc);
    expect(s.flags.map((f) => f.code)).toContain("above_plan"); // 0.36 / 0.324 = 111 %
  });
  it("an explicit zero is a recorded zero; never recording is unknown: the two are different", () => {
    const { record, tc } = begin("TILE-A");
    expect(sum(record, tc).recovered).toBeNull();
    const zero = must(record, tc, rec2(0));
    expect(sum(zero, tc).recovered).toBe(0);
    expect(sum(zero, tc).completion).toBe(0);
    expect(sum(zero, tc).status).toBe("in_progress"); // any recovery record starts the work
  });
  it("validates quantities: numbers, sign, whole items and the available quantity", () => {
    const { record, tc } = begin("TILE-A");
    for (const q of [Number.NaN, Number.POSITIVE_INFINITY, -1]) expect(run(record, tc, rec2(q)).error).toMatch(/number|negative/);
    expect(run(record, tc, rec2(0.37)).error).toMatch(/More booked \(0\.37 m²\) than the available 0\.36 m²/);
    expect(run(record, tc, rec2(0.37)).record).toBeNull();
    const b = begin("BASIN-1", ctxOf({ assessments: assess(["BASIN-1"], { classification: "direct_reuse", recoveryPct: 100 }) }));
    expect(run(b.record, b.tc, rec2(0.5)).error).toMatch(/whole items/);
    expect(run(b.record, b.tc, rec2(2)).error).toMatch(/More booked/);
    expect(run(b.record, b.tc, rec2(1, true)).error).toBeNull();
  });
  it("a source is required, so measured, estimated and assumed values are never mixed up", () => {
    const { record, tc } = begin("TILE-A");
    expect(run(record, tc, { type: "recover", quantity: 0.1, source: "guess" as never }).error).toMatch(/measured, estimated or assumed/);
    const r = must(must(record, tc, rec2(0.1)), tc, { type: "recover", quantity: 0.1, source: "assumed" });
    expect(sum(r, tc).quality).toBe("assumed"); // the weakest source wins
    expect(sum(r, tc).flags.map((f) => f.code)).toContain("assumed_values");
    expect(sum(must(record, tc, rec2(0.1)), tc).quality).toBe("measured");
  });
  it("dates: a past date is kept, a future one is refused", () => {
    const { record, tc } = begin("TILE-A");
    const r = must(record, tc, { ...rec2(0.1), at: "2026-09-28" });
    expect(r.events[r.events.length - 2]!.at).toBe("2026-09-28T00:00:00.000Z");
    expect(run(record, tc, { ...rec2(0.1), at: "2026-12-31" }).error).toMatch(/future/);
    expect(parseAt("2026-02-30", NOW).error).toMatch(/real date/);
    expect(parseAt("garbage", NOW).error).toMatch(/YYYY-MM-DD/);
    expect(parseAt("", NOW)).toEqual({ at: NOW, error: null });
  });
});

describe("a documented variance is the only way past the available quantity", () => {
  it("needs a reason, raises (or lowers) the effective quantity, and never changes B1", () => {
    const { record, tc } = begin("TILE-A");
    expect(run(record, tc, { type: "variance", quantity: 0.05, source: "measured", reason: "" }).error).toMatch(/needs its reason/);
    expect(run(record, tc, { type: "variance", quantity: 0, source: "measured", reason: "x" }).error).toMatch(/changes nothing/);
    const v = must(record, tc, { type: "variance", quantity: 0.05, source: "measured", method: "tape", reason: "tile area measured on site is larger" });
    near(sum(v, tc).effective, 0.41);
    near(sum(v, tc).available, 0.36); // B1 untouched
    const r = must(v, tc, rec2(0.4));
    near(sum(r, tc).recovered, 0.4);
    expect(inv.byId.get("TILE-A")!.primary.value).toBeCloseTo(0.36, 12);
  });
  it("cannot be withdrawn below what is already booked", () => {
    const { record, tc } = begin("TILE-A");
    let r = must(record, tc, { type: "variance", quantity: 0.05, source: "measured", reason: "measured" });
    r = must(r, tc, rec2(0.4));
    const v = run(r, tc, { type: "variance", quantity: -0.1, source: "measured", reason: "re-measured" });
    expect(v.error).toMatch(/More booked/);
  });
});

describe("outcomes: reused, recycled and disposed are only ever recorded, never implied", () => {
  const recovered = (): { record: TrackingRecord; tc: TrackingContext } => {
    const b = begin("TILE-A");
    return { record: must(b.record, b.tc, rec2(0.3, true)), tc: b.tc };
  };
  it("recovery alone never makes material reused: the stage is refused without a recorded outcome", () => {
    const { record, tc } = recovered();
    expect(sum(record, tc).reused).toBeNull();
    const r = run(record, tc, { type: "status", status: "reused" });
    expect(r.error).toMatch(/does not make material reused/);
    expect(run(record, tc, { type: "status", status: "recycled" }).error).toMatch(/recycled outcome first/);
    expect(run(record, tc, { type: "status", status: "disposed" }).error).toMatch(/disposed outcome first/);
  });
  it("a C2 allocation alone never makes it reused either: allocated is a stage, reused still needs an outcome", () => {
    const b = begin("TILE-A", ctxOf({ assessments: assess(["TILE-A"], REUSE90), allocations: [alloc("AL1", "TILE-A", 0.3)], requirementNames: names }));
    let r = must(b.record, b.tc, rec2(0.3, true));
    r = must(r, b.tc, { type: "status", status: "allocated" });
    expect(sum(r, b.tc)).toMatchObject({ status: "allocated", reused: null });
    expect(run(r, b.tc, { type: "status", status: "reused" }).error).toMatch(/does not make material reused/);
  });
  it("an outcome needs recovery first, a quantity above 0 and no more than is in hand", () => {
    const b = begin("TILE-A");
    expect(run(b.record, b.tc, out("reused", 0.1)).error).toMatch(/Record the recovered quantity first/);
    const { record, tc } = recovered();
    expect(run(record, tc, out("reused", 0)).error).toMatch(/above 0/);
    expect(run(record, tc, out("reused", 0.31)).error).toMatch(/Only 0\.3 m² of the recovered material is still in hand/);
    const r = must(record, tc, out("reused", 0.2));
    near(sum(r, tc).inHand, 0.1);
    expect(run(r, tc, out("recycled", 0.11)).error).toMatch(/Only 0\.1 m²/);
  });
  it("moving material from one stage to the next never counts it twice: recovered = in hand + reused + recycled + disposed", () => {
    const { record, tc } = recovered();
    let r = must(record, tc, out("reused", 0.2));
    r = must(r, tc, out("recycled", 0.05));
    r = must(r, tc, out("disposed", 0.02));
    const s = sum(r, tc);
    near(s.recovered!, 0.3);
    near(s.reused, 0.2);
    near(s.recycled, 0.05);
    near(s.disposed, 0.02);
    near(s.inHand, 0.03);
    near(s.recovered! - s.reused! - s.recycled! - s.disposed!, s.inHand!);
    near(s.unaccounted, 0.36 - 0.27); // 0.03 in hand + 0.06 not yet recovered
    near(s.notYetRecovered, 0.06);
  });
  it("when everything recovered has an outcome the record closes with the outcome that holds most of it", () => {
    const { record, tc } = recovered();
    let r = must(record, tc, out("reused", 0.25));
    expect(sum(r, tc).status).toBe("recovered"); // 0.05 still in hand: no automatic close
    r = must(r, tc, out("recycled", 0.05));
    expect(sum(r, tc).status).toBe("reused"); // reused holds 0.25 of 0.3
    expect(sum(r, tc).flags.map((f) => f.code)).toContain("incomplete"); // 0.06 neither recovered nor written off
    expect(r.events.filter((e) => e.kind === "status" && e.by === "system").length).toBeGreaterThan(0);
  });
  it("the remainder can be written off as not recovered, with a reason; then the record is closed", () => {
    const { record, tc } = recovered();
    let r = must(record, tc, out("reused", 0.3));
    expect(sum(r, tc).status).toBe("reused");
    expect(run(r, tc, { type: "unrecovered", quantity: 0.06, source: "estimated", reason: "" }).error).toMatch(/why it was not recovered/);
    r = must(r, tc, { type: "unrecovered", quantity: 0.06, source: "estimated", reason: "broken on removal" });
    const s = sum(r, tc);
    near(s.unaccounted, 0);
    expect(isClosed(s)).toBe(true);
    expect(s.flags.map((f) => f.code)).not.toContain("incomplete");
  });
  it("an unrecovered write-off needs recovery recorded first and cannot exceed what is left", () => {
    const b = begin("TILE-A");
    expect(run(b.record, b.tc, { type: "unrecovered", quantity: 0.1, source: "estimated", reason: "lost" }).error).toMatch(/Record the recovered quantity first/);
    const { record, tc } = recovered();
    expect(run(record, tc, { type: "unrecovered", quantity: 0.07, source: "estimated", reason: "lost" }).error).toMatch(/More booked/);
  });
  it("a different outcome can follow a close while material is still in hand, and a stage needs its quantity", () => {
    const { record, tc } = recovered();
    const r = must(record, tc, out("reused", 0.1));
    expect(run(r, tc, { type: "status", status: "recycled" }).error).toMatch(/recycled outcome first/);
    expect(run(r, tc, { type: "status", status: "reused" }).error).toBeNull();
  });
});

describe("status changes are validated", () => {
  it("lists every other stage with whether it is allowed now and why not", () => {
    const { record, tc } = begin("TILE-A");
    const m = moves(record, liveFn(tc)("TILE-A"));
    expect(m).toHaveLength(8);
    const by = Object.fromEntries(m.map((x) => [x.status, x.error]));
    expect(by.in_progress).toBeNull();
    expect(by.hold).toBeNull();
    expect(by.recovered).toMatch(/recovered quantity first/);
    expect(by.allocated).toMatch(/recovered quantity first/);
    expect(by.reused).toMatch(/does not make material reused/);
  });
  it("planned -> in progress -> recovered -> inspected, in that order of guards", () => {
    const { record, tc } = begin("TILE-A");
    let r = must(record, tc, { type: "status", status: "in_progress", note: "scaffold up" });
    expect(sum(r, tc).status).toBe("in_progress");
    expect(run(r, tc, { type: "status", status: "inspected" }).error).toMatch(/recovered quantity first/);
    r = must(r, tc, rec2(0.3));
    r = must(r, tc, { type: "status", status: "recovered" });
    r = must(r, tc, { type: "status", status: "inspected" });
    expect(sum(r, tc).status).toBe("inspected");
    expect(run(r, tc, { type: "status", status: "inspected" }).error).toMatch(/already/);
  });
  it("allocated needs an active C2 allocation", () => {
    const { record, tc } = begin("TILE-A");
    const r = must(record, tc, rec2(0.3, true));
    expect(run(r, tc, { type: "status", status: "allocated" }).error).toMatch(/no active C2 allocation/);
    const tc2 = ctxOf({ assessments: assess(["TILE-A"], REUSE90), allocations: [alloc("AL1", "TILE-A", 0.3)], requirementNames: names });
    expect(apply(r, { type: "status", status: "allocated" }, oc(tc2, "TILE-A")).error).toBeNull();
  });
  it("planned is only possible while no recovery is recorded", () => {
    const { record, tc } = begin("TILE-A");
    const started = must(record, tc, { type: "status", status: "in_progress" });
    expect(run(started, tc, { type: "status", status: "planned" }).error).toBeNull();
    const rec1 = must(started, tc, rec2(0.1));
    expect(run(rec1, tc, { type: "status", status: "planned" }).error).toMatch(/void them first/);
  });
  it("on hold needs a reason; the record is flagged (outcome unknown, not zero) and can be resumed", () => {
    const { record, tc } = begin("TILE-A");
    expect(run(record, tc, { type: "status", status: "hold" }).error).toMatch(/Say why/);
    let r = must(record, tc, { type: "status", status: "hold", note: "waiting for the contractor" });
    const s = sum(r, tc);
    expect(s.status).toBe("hold");
    expect(s.recovered).toBeNull();
    expect(s.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["on_hold", "recovery_not_recorded"]));
    r = must(r, tc, { type: "status", status: "in_progress" });
    expect(sum(r, tc).status).toBe("in_progress");
  });
  it("an outcome stage with nothing in hand cannot go back to an earlier stage", () => {
    const { record, tc } = begin("TILE-A");
    let r = must(record, tc, rec2(0.3, true));
    r = must(r, tc, out("reused", 0.3));
    expect(run(r, tc, { type: "status", status: "inspected" }).error).toMatch(/already has an outcome/);
  });
  it("rejects an unknown stage", () => {
    const { record, tc } = begin("TILE-A");
    expect(run(record, tc, { type: "status", status: "teleported" as never }).error).toMatch(/Unknown stage/);
  });
});

describe("the history is append-only: a mistake is voided, never edited", () => {
  it("a voided event leaves the totals but stays in the history with its reason", () => {
    const { record, tc } = begin("TILE-A");
    const r1 = must(record, tc, rec2(0.1));
    const r2 = must(r1, tc, rec2(0.05));
    const wrong = r2.events.find((e) => e.kind === "recovered" && e.quantity === 0.05)!;
    const r3 = must(r2, tc, { type: "void", eventId: wrong.id, reason: "typed twice" });
    near(sum(r3, tc).recovered, 0.1);
    expect(r3.events.some((e) => e.id === wrong.id)).toBe(true);
    expect(r3.events[r3.events.length - 1]).toMatchObject({ kind: "void", voids: wrong.id, reason: "typed twice" });
    expect(fold(r3).voided.has(wrong.id)).toBe(true);
  });
  it("cannot void what later records depend on; the reason says what to void first", () => {
    const { record, tc } = begin("TILE-A");
    let r = must(record, tc, rec2(0.3, true));
    r = must(r, tc, out("reused", 0.2));
    const recEv = r.events.find((e) => e.kind === "recovered")!;
    const v = run(r, tc, { type: "void", eventId: recEv.id, reason: "wrong" });
    expect(v.error).toMatch(/cannot be voided/);
    expect(v.error).toMatch(/outcomes and write-offs are of recovered material/);
    expect(v.error).toMatch(/Void the events that depend on it first/);
    expect(v.record).toBeNull();
  });
  it("voiding the evidence under a status reverts the stage with a logged system event", () => {
    const { record, tc } = begin("TILE-A");
    let r = must(record, tc, rec2(0.3, true));
    r = must(r, tc, out("reused", 0.3));
    expect(sum(r, tc).status).toBe("reused");
    const outEv = r.events.find((e) => e.kind === "outcome")!;
    r = must(r, tc, { type: "void", eventId: outEv.id, reason: "recorded against the wrong tile" });
    const s = sum(r, tc);
    expect(s.reused).toBeNull();
    expect(s.status).toBe("recovered");
    const sys = r.events[r.events.length - 1]!;
    expect(sys).toMatchObject({ kind: "status", by: "system", status: "recovered", from: "reused" });
    expect(sys.note).toMatch(/reverted/);
  });
  it("track, void and system events cannot be voided; a void needs a reason and cannot be repeated", () => {
    const { record, tc } = begin("TILE-A");
    const r = must(record, tc, rec2(0.1));
    expect(run(r, tc, { type: "void", eventId: r.events[0]!.id, reason: "x" }).error).toMatch(/start of tracking/);
    const sysStatus = r.events.find((e) => e.kind === "status")!;
    expect(sysStatus.by).toBe("system");
    expect(run(r, tc, { type: "void", eventId: sysStatus.id, reason: "x" }).error).toMatch(/Events recorded by the system/);
    const ev = r.events.find((e) => e.kind === "recovered")!;
    expect(run(r, tc, { type: "void", eventId: ev.id, reason: "" }).error).toMatch(/why it is voided/);
    const v = must(r, tc, { type: "void", eventId: ev.id, reason: "dup" });
    expect(run(v, tc, { type: "void", eventId: ev.id, reason: "dup" }).error).toMatch(/already voided/);
    expect(run(v, tc, { type: "void", eventId: v.events[v.events.length - 1]!.id, reason: "x" }).error).toMatch(/cannot be voided/);
    expect(run(v, tc, { type: "void", eventId: "nope", reason: "x" }).error).toMatch(/does not exist/);
  });
  it("notes are events too", () => {
    const { record, tc } = begin("TILE-A");
    expect(run(record, tc, { type: "note", note: "  " }).error).toMatch(/Write the note/);
    expect(must(record, tc, { type: "note", note: "stored on pallet 4" }).events.at(-1)).toMatchObject({ kind: "note", note: "stored on pallet 4" });
  });
});

describe("C2 allocations: fulfilled, changed and cancelled are logged, never silently overwritten", () => {
  const withAlloc = (q: number) => ctxOf({ assessments: assess(["TILE-A"], REUSE90), allocations: [alloc("AL1", "TILE-A", q)], requirementNames: names });
  it("a reused outcome can fulfil an allocation; it cannot exceed it, and only reused can", () => {
    const tc = withAlloc(0.2);
    let r = must(begin("TILE-A", tc).record, tc, rec2(0.3, true));
    expect(run(r, tc, out("recycled", 0.1, { allocationId: "AL1" })).error).toMatch(/Only a reused outcome/);
    expect(run(r, tc, out("reused", 0.1, { allocationId: "NOPE" })).error).toMatch(/does not exist/);
    expect(run(r, tc, out("reused", 0.25, { allocationId: "AL1" })).error).toMatch(/needs only 0\.2 m² more/);
    r = must(r, tc, out("reused", 0.1, { allocationId: "AL1", destination: "Community hall" }));
    expect(r.events.filter((e) => e.kind === "allocation" && e.change === "fulfilled")).toHaveLength(0);
    r = must(r, tc, out("reused", 0.1, { allocationId: "AL1" }));
    const fulfilled = r.events.filter((e) => e.kind === "allocation" && e.change === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    near(sum(r, tc).fulfilled.get("AL1")!, 0.2);
    const o = r.events.find((e) => e.kind === "outcome")!;
    expect(o).toMatchObject({ allocationId: "AL1", requirementId: "R1", requirementName: "Hall floor", destination: "Community hall" });
  });
  it("an allocation that is not fulfilled when the record closes is flagged", () => {
    const tc = withAlloc(0.3);
    let r = must(begin("TILE-A", tc).record, tc, rec2(0.3, true));
    r = must(r, tc, out("recycled", 0.3));
    const f = sum(r, tc).flags.find((x) => x.code === "allocation_unfulfilled")!;
    expect(f.text).toContain("Hall floor");
    expect(sum(r, tc).flags.map((x) => x.code)).toContain("outcome_differs"); // reuse planned, recycled in fact
  });
  it("created / changed / cancelled allocations are appended as system events and remembered; unchanged data changes nothing", () => {
    const tc0 = ctxOf({ assessments: assess(["TILE-A"], REUSE90), requirementNames: names });
    const { record } = begin("TILE-A", tc0);
    const same = syncAllocations(record, oc(tc0, "TILE-A"));
    expect(same.record).toBe(record);
    const tc1 = withAlloc(0.2);
    const created = syncAllocations(record, oc(tc1, "TILE-A")).record!;
    expect(created.events.at(-1)).toMatchObject({ kind: "allocation", change: "created", quantity: 0.2, by: "system" });
    expect(syncAllocations(created, oc(tc1, "TILE-A")).record).toBe(created); // idempotent
    const tc2 = withAlloc(0.15);
    const changed = syncAllocations(created, oc(tc2, "TILE-A")).record!;
    expect(changed.events.at(-1)).toMatchObject({ change: "changed", quantity: 0.15, previous: 0.2 });
    const cancelled = syncAllocations(changed, oc(tc0, "TILE-A")).record!;
    expect(cancelled.events.at(-1)).toMatchObject({ change: "cancelled", requirementName: "Hall floor" });
    expect(Object.keys(cancelled.seen)).toEqual([]);
    expect(cancelled.events.filter((e) => e.kind === "allocation")).toHaveLength(3);
  });
  it("when the last allocation is cancelled an 'allocated' record steps back with a logged event; recorded outcomes are kept", () => {
    const tc = withAlloc(0.3);
    let r = must(begin("TILE-A", tc).record, tc, rec2(0.3, true));
    r = must(r, tc, { type: "status", status: "inspected" });
    r = must(r, tc, { type: "status", status: "allocated" });
    const tc0 = ctxOf({ assessments: assess(["TILE-A"], REUSE90), requirementNames: names });
    const back = syncAllocations(r, oc(tc0, "TILE-A")).record!;
    expect(sum(back, tc0).status).toBe("inspected");
    expect(back.events.filter((e) => e.kind === "status").at(-1)).toMatchObject({ by: "system", status: "inspected", from: "allocated" });
    // history of the earlier 'allocated' stage is still there
    expect(back.events.some((e) => e.kind === "status" && e.status === "allocated" && e.by === "user")).toBe(true);
  });
  it("reuse recorded against an allocation that was later cancelled keeps its outcome and is flagged as such", () => {
    const tc = withAlloc(0.3);
    let r = must(begin("TILE-A", tc).record, tc, rec2(0.3, true));
    r = must(r, tc, out("reused", 0.1, { allocationId: "AL1" }));
    const tc0 = ctxOf({ assessments: assess(["TILE-A"], REUSE90), requirementNames: names });
    r = syncAllocations(r, oc(tc0, "TILE-A")).record!;
    const s = sum(r, tc0);
    near(s.reused, 0.1);
    expect(s.flags.map((f) => f.code)).toContain("allocation_cancelled_used");
  });
  it("reuse outside any C2 allocation is allowed and noted", () => {
    const tc = ctxOf({ assessments: assess(["TILE-A"], { classification: "recycling", recoveryPct: 90 }) });
    let r = must(begin("TILE-A", tc).record, tc, rec2(0.3, true));
    r = must(r, tc, out("reused", 0.1));
    expect(sum(r, tc).flags.map((f) => f.code)).toContain("reused_outside_plan");
  });
});

describe("drift: the plan at the start is kept, and the difference with B2 now is shown", () => {
  it("flags a changed B2 estimate without touching the snapshot", () => {
    const { record } = begin("TILE-A");
    const later = ctxOf({ assessments: assess(["TILE-A"], { classification: "direct_reuse", recoveryPct: 50, preparation: "none" }) });
    const s = sum(record, later);
    near(s.planned, 0.324); // unchanged: this is what was planned
    expect(s.flags.map((f) => f.code)).toContain("plan_drift");
  });
  it("a plan the user states replaces the snapshot's quantity (as an event), with its source", () => {
    const b = begin("TILE-B", ctxOf());
    expect(sum(b.record, b.tc).planned).toBeNull();
    const r = must(b.record, b.tc, { type: "plan", quantity: 0.08, source: "estimated", method: "site survey" });
    const s = sum(r, b.tc);
    near(s.planned, 0.08);
    expect(s).toMatchObject({ plannedBasis: "user", plannedSource: "estimated" });
    expect(s.flags.map((f) => f.code)).not.toContain("no_plan");
    expect(run(r, b.tc, { type: "plan", quantity: -1, source: "estimated" }).error).toMatch(/negative/);
    const withdrawn = must(r, b.tc, { type: "plan", quantity: null, source: "estimated" });
    expect(sum(withdrawn, b.tc).planned).toBeNull();
  });
  it("model changes are flagged, not absorbed: a missing component and a changed unit", () => {
    const { record } = begin("TILE-A");
    const empty = ctxOf({ inv: buildInventory([]) });
    expect(sum(record, empty).flags.map((f) => f.code)).toContain("missing_component");
    expect(sum(record, empty).effective).toBeNull();
    const asNr = { ...record, unit: "nr" as const };
    expect(sum(asNr, ctxOf()).flags.map((f) => f.code)).toContain("unit_changed");
  });
  it("quantity bookkeeping that no longer fits the model is an error flag, not a silent change", () => {
    const { record, tc } = begin("TILE-A");
    const r = must(record, tc, rec2(0.36, true));
    const smaller = buildInventory([tile("TILE-A", 0.3, 0.3)]);
    expect(sum(r, ctxOf({ inv: smaller })).flags.map((f) => f.code)).toContain("over_available");
  });
});

// ── reporting ────────────────────────────────────────────────────────────────

function population() {
  const A = assess(["TILE-A", "TILE-C", "TILE-B", "BASIN-1", "BASIN-2"], REUSE90);
  const tc = ctxOf({ assessments: assess(["BASIN-1", "BASIN-2"], { classification: "direct_reuse", recoveryPct: 100, preparation: "none" }, A), allocations: [alloc("AL1", "TILE-A", 0.3)], requirementNames: names });
  const records: Record<string, TrackingRecord> = {};
  for (const id of ["TILE-A", "TILE-B", "TILE-C", "BASIN-1", "BASIN-2"]) records[id] = begin(id, tc).record;
  // TILE-A: fully recovered 0.3, reused 0.2 (fulfilling AL1) + recycled 0.1, remainder written off
  let a = must(records["TILE-A"]!, tc, rec2(0.3, true));
  a = must(a, tc, out("reused", 0.2, { allocationId: "AL1" }));
  a = must(a, tc, out("recycled", 0.1));
  a = must(a, tc, { type: "unrecovered", quantity: 0.06, source: "estimated", reason: "broken" });
  records["TILE-A"] = a;
  // TILE-B: started, partly recovered
  records["TILE-B"] = must(records["TILE-B"]!, tc, rec2(0.04));
  // TILE-C: recorded zero
  records["TILE-C"] = must(records["TILE-C"]!, tc, rec2(0));
  // BASIN-1 recovered and disposed; BASIN-2 untouched (planned, nothing recorded)
  let b1 = must(records["BASIN-1"]!, tc, rec2(1, true));
  b1 = must(b1, tc, out("disposed", 1));
  records["BASIN-1"] = b1;
  return { tc, records: records as Records };
}

describe("planned versus actual reporting", () => {
  const { tc, records } = population();
  const rows = buildRows(records, tc);
  const byUnit = (r: ReturnType<typeof totals>, u: string) => r.find((x) => x.unit === u)!;

  it("one row per tracked component, each counted once, and the report reconciles", () => {
    expect(rows.map((r) => r.id)).toEqual(["BASIN-1", "BASIN-2", "TILE-A", "TILE-B", "TILE-C"]);
    expect(reconcileRows(rows)).toEqual([]);
    expect(reconcileRows([...rows, rows[0]!])[0]).toMatch(/counted twice/);
  });
  it("totals are one line per unit: area and count are never added together", () => {
    const t = totals(rows);
    expect(t.map((x) => x.unit)).toEqual(["m2", "nr"]);
    const m2 = byUnit(t, "m2");
    expect(m2.records).toBe(3);
    near(m2.available, 0.36 + 0.09 + 0.36);
    near(m2.planned, 0.324 + 0.081 + 0.324);
    near(m2.recovered, 0.3 + 0.04 + 0);
    near(m2.reused, 0.2);
    near(m2.recycled, 0.1);
    near(m2.unrecovered, 0.06);
    const nr = byUnit(t, "nr");
    expect(nr).toMatchObject({ records: 2, recovered: 1, disposed: 1, reused: 0 });
  });
  it("completion is recovered ÷ planned over the records where both are known; a recorded zero counts, a never-recorded one does not", () => {
    const m2 = byUnit(totals(rows), "m2");
    near(m2.completion!, (0.3 + 0.04 + 0) / (0.324 + 0.081 + 0.324), 1e-9);
    expect(m2.pairedRecords).toBe(3);
    expect(m2.notRecorded).toBe(0);
    const nr = byUnit(totals(rows), "nr");
    expect(nr.notRecorded).toBe(1); // BASIN-2: nothing recorded: unknown, not 0
    expect(nr.recoveredRecords).toBe(1);
    near(nr.completion!, 1); // only BASIN-1 is paired: 1 ÷ 1
    expect(nr.pairedRecords).toBe(1);
  });
  it("reused, recycled, disposed and unaccounted are reported separately; unaccounted includes material of records with no recovery recorded", () => {
    const m2 = byUnit(totals(rows), "m2");
    // TILE-A closed (0), TILE-B: 0.09 - 0 outcomes - 0 write-off = 0.09, TILE-C: 0.36
    near(m2.unaccounted, 0 + 0.09 + 0.36);
    near(m2.inHand, 0 + 0.04 + 0);
    const nr = byUnit(totals(rows), "nr");
    near(nr.unaccounted, 1); // BASIN-2: the whole item, since nothing was recorded
  });
  it("breakdowns by material category, floor and status each cover every record once and add up to the totals", () => {
    for (const dim of [byCategory, byFloor, byStatus]) {
      const parts = dim(rows);
      expect(parts.filter((p) => p.unit === "m2").reduce((s, p) => s + p.records, 0)).toBe(3);
      near(parts.filter((p) => p.unit === "m2").reduce((s, p) => s + p.recovered, 0), 0.34);
    }
    expect(byCategory(rows).map((c) => `${c.key}:${c.unit}`)).toEqual(["porcelain_tile:m2", "sanitary_ceramic:nr"]);
    expect(byFloor(rows).filter((f) => f.unit === "m2").map((f) => f.key)).toEqual(["0", "1"]);
  });
  it("status counts", () => {
    expect(statusCounts(rows)).toMatchObject({ reused: 1, in_progress: 2, disposed: 1, planned: 1 });
  });
  it("the differences between expected and actual are listed with their cause", () => {
    const d = discrepancies(rows);
    const codes = (id: string) => d.find((x) => x.row.id === id)?.flags.map((f) => f.code) ?? [];
    expect(codes("BASIN-1")).toContain("outcome_differs"); // reuse planned, disposed in fact
    expect(codes("TILE-A")).toContain("outcome_differs"); // 0.1 recycled although reuse was planned
    expect(codes("TILE-A")).not.toContain("incomplete"); // the remainder was written off
    expect(codes("TILE-A")).toContain("allocation_unfulfilled"); // allocated 0.3, reused 0.2
  });
  it("unresolved records say what is missing; a closed record is not listed", () => {
    const u = unresolved(rows);
    const reason = (id: string) => u.find((x) => x.row.id === id)?.reason;
    expect(reason("BASIN-2")).toBe("Planned, deconstruction not started");
    expect(reason("TILE-B")).toBe("Recovered material has no outcome yet");
    expect(reason("TILE-C")).toBe("Material neither recovered nor written off");
    expect(reason("TILE-A")).toBeUndefined();
    expect(reason("BASIN-1")).toBeUndefined();
  });
  it("coverage: how much of the planned scope is tracked, and the planned quantity still untracked", () => {
    const empty: Records = {};
    const c0 = coverage(empty, tc);
    expect(c0.scope).toBe(5);
    expect(c0.untracked).toBe(5);
    const c = coverage({ "TILE-A": records["TILE-A"]!, "TILE-B": records["TILE-B"]! }, tc);
    expect(c).toMatchObject({ scope: 5, trackedInScope: 2, trackedOutside: 0, untracked: 3 });
    expect(c.untrackedPlanned.find((x) => x.unit === "nr")).toMatchObject({ components: 2, planned: 2 });
    const outside = coverage({ ...records, "ASM-1-T1": begin("ASM-1-T1", ctxOf()).record }, tc);
    expect(outside.trackedOutside).toBe(1);
  });
  it("the planned scope is exactly B2 reuse / recycling classes, the B3 plan and C2 allocations", () => {
    const removal = new Map<string, RemovalView>([["ASM-1-T2", { planName: "P", step: 1, steps: 2 }]]);
    const scope = planScope(ctxOf({ assessments: assess(["TILE-A"], REUSE90), allocations: [alloc("AL9", "BASIN-1", 1)], removal }));
    expect([...scope.keys()].sort()).toEqual(["ASM-1-T2", "BASIN-1", "TILE-A"]);
    expect(scope.get("TILE-A")).toMatchObject({ b2: true, c2: false, b3: null });
    expect(scope.get("BASIN-1")).toMatchObject({ b2: false, c2: true, planned: null });
    expect(scope.get("ASM-1-T2")!.b3).toMatchObject({ step: 1 });
  });
  it("a rollup of a subset reports only that subset, per unit", () => {
    const tiles = rollup(rows.filter((r) => r.category === "tile_floor"), (r) => r.substance);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ unit: "m2", records: 3 });
  });
  it("closing needs a final outcome and nothing unaccounted", () => {
    expect(isClosed(rows.find((r) => r.id === "TILE-A")!.summary)).toBe(true);
    expect(isClosed(rows.find((r) => r.id === "TILE-B")!.summary)).toBe(false);
  });
});

describe("persistence", () => {
  const { tc, records } = population();
  const batches = [{ id: "B1", name: "Living tiles", componentIds: ["TILE-A", "TILE-C"], createdAt: NOW }];
  const text = serializeTracking({ records, batches });
  it("round-trips records with their full history, remembered allocations and batches", () => {
    const back = parseTracking(text);
    expect(back.records).toEqual(records);
    expect(back.batches).toEqual(batches);
    expect(back.dropped).toEqual({ records: 0, batches: 0 });
    expect(sum(back.records["TILE-A"]!, tc)).toEqual(sum(records["TILE-A"]!, tc));
  });
  it("is empty for missing, malformed or outdated data, and never throws", () => {
    for (const t of [null, "", "{", "[]", "null", JSON.stringify({ version: 99, records: [] }), JSON.stringify({ records: [] })]) {
      const p = parseTracking(t);
      expect(p.records).toEqual({});
      expect(p.batches).toEqual([]);
    }
  });
  it("drops a history that does not replay to a possible state, and counts it", () => {
    const d = JSON.parse(text);
    const a = d.records.find((r: TrackingRecord) => r.componentId === "TILE-A");
    const b = d.records.find((r: TrackingRecord) => r.componentId === "BASIN-1");
    // outcomes above the recovered quantity
    a.events.find((e: { kind: string; outcome?: string }) => e.kind === "outcome" && e.outcome === "recycled").quantity = 5;
    // a duplicate event id
    b.events[2].id = b.events[1].id;
    d.records.push({ ...d.records[0], events: [{ ...d.records[0].events[1] }] }); // first event is not "track"
    d.records.push("junk", { componentId: "X" });
    const p = parseTracking(JSON.stringify(d));
    expect(Object.keys(p.records).sort()).toEqual(["BASIN-2", "TILE-B", "TILE-C"]);
    expect(p.dropped.records).toBe(5);
  });
  it("drops a status its quantities do not support (reused with no reused outcome) rather than repairing it", () => {
    const d = JSON.parse(text);
    const a = d.records.find((r: TrackingRecord) => r.componentId === "TILE-A");
    a.events = a.events.filter((e: { kind: string; outcome?: string }) => !(e.kind === "outcome" && e.outcome === "reused"));
    expect(parseTracking(JSON.stringify(d)).records["TILE-A"]).toBeUndefined();
  });
  it("keeps records of components that are not in the model (the model may be regenerated); the report flags them", () => {
    const d = JSON.parse(text);
    d.records[0].componentId = "REGENERATED";
    const p = parseTracking(JSON.stringify(d));
    expect(p.records.REGENERATED).toBeDefined();
    const row = buildRows(p.records, tc).find((r) => r.id === "REGENERATED")!;
    expect(row.summary.flags.map((f) => f.code)).toContain("missing_component");
    expect(reconcileRows(buildRows(p.records, tc))).toEqual([]);
  });
  it("drops invalid and duplicate batches", () => {
    const d = JSON.parse(text);
    d.batches.push({ ...d.batches[0] }, { id: "B2", name: "", componentIds: [], createdAt: NOW }, "junk");
    const p = parseTracking(JSON.stringify(d));
    expect(p.batches).toHaveLength(1);
    expect(p.dropped.batches).toBe(3);
  });
});

describe("batches hold no quantities", () => {
  it("keeps leaf components only, each once; groups and unknown ids are ignored", () => {
    const r = leafIdsOf(inv, ["TILE-A", "ASM-1", "TILE-A", "NOPE", "BASIN-1"]);
    expect(r).toEqual({ ids: ["TILE-A", "BASIN-1"], ignored: 2 });
  });
  it("creates, renames and deletes with unique names; overlapping batches still count components once in a report", () => {
    let b = createBatch([], inv, "B1", "Hall", ["TILE-A", "TILE-C"], NOW);
    expect(b.error).toBeNull();
    expect(createBatch(b.batches, inv, "B2", "hall", ["TILE-A"], NOW).error).toMatch(/exists/);
    expect(createBatch(b.batches, inv, "B2", "Corridor", ["ASM-1"], NOW).error).toMatch(/at least one component/);
    expect(createBatch(b.batches, inv, "B2", "  ", ["TILE-A"], NOW).error).toMatch(/name/);
    b = createBatch(b.batches, inv, "B2", "Overlap", ["TILE-A", "BASIN-1"], NOW);
    expect(b.error).toBeNull();
    expect(renameBatch(b.batches, "B2", "Hall").error).toMatch(/exists/);
    expect(renameBatch(b.batches, "B2", "Overlap 2").batch!.name).toBe("Overlap 2");
    expect(renameBatch(b.batches, "NOPE", "x").error).toMatch(/does not exist/);
    expect(deleteBatch(b.batches, "B1")).toHaveLength(1);
    expect(deleteBatch(b.batches, "NOPE")).toBe(b.batches);
    // TILE-A is in both batches, but a report is built from the tracked components, so it appears once
    const { tc, records } = population();
    expect(buildRows(records, tc).filter((r) => r.id === "TILE-A")).toHaveLength(1);
  });
});

describe("export", () => {
  const { tc, records } = population();
  const rows = buildRows(records, tc);
  it("JSON states the schema and disclaimer, keeps the full history, and writes null (not 0) for what was never recorded", () => {
    const j = JSON.parse(trackingToJson(records, rows, NOW));
    expect(j.schema).toBe(SCHEMA);
    expect(j.disclaimer).toMatch(/No environmental saving is asserted/);
    const b2 = j.records.find((r: { componentId: string }) => r.componentId === "BASIN-2");
    expect(b2).toMatchObject({ status: "planned", recovered: null, reused: null, disposed: null, completion: null });
    expect(b2.unaccounted).toBe(1);
    const a = j.records.find((r: { componentId: string }) => r.componentId === "TILE-A");
    expect(a.history.length).toBe(records["TILE-A"]!.events.length);
    expect(a).toMatchObject({ unit: "m2", reused: 0.2, recycled: 0.1, notRecovered: 0.06 });
    const c = j.records.find((r: { componentId: string }) => r.componentId === "TILE-C");
    expect(c.recovered).toBe(0); // a recorded zero stays 0
  });
  it("CSV has the header and one row per record; unknown stays empty, zero stays 0", () => {
    const lines = trackingToCsv(rows).trim().split("\r\n");
    expect(lines[0]).toBe(CSV_HEADER.join(","));
    expect(lines).toHaveLength(6);
    const cols = lines[0]!.split(",");
    const at = (id: string, col: string) => lines.find((l) => l.startsWith(id))!.split(",")[cols.indexOf(col)];
    expect(at("BASIN-2", "recovered")).toBe("");
    expect(at("TILE-C", "recovered")).toBe("0");
    expect(at("TILE-A", "status")).toBe("Reused");
  });
});

describe("quantity validation", () => {
  it("covers numbers, sign, whole items and signed variances", () => {
    expect(quantityError("m2", 0.5)).toBeNull();
    expect(quantityError("m2", 0)).toMatch(/above 0/);
    expect(quantityError("m2", 0, { allowZero: true })).toBeNull();
    expect(quantityError("m2", -1, { allowZero: true })).toMatch(/negative/);
    expect(quantityError("nr", 1.5)).toMatch(/whole items/);
    expect(quantityError("m2", "1" as never)).toMatch(/number/);
    expect(quantityError("m2", -0.1, { signed: true })).toBeNull();
    expect(quantityError("m2", 0, { signed: true })).toMatch(/changes nothing/);
  });
});

describe("the real model", () => {
  const real = getModelInventory();
  const tiles = real.rows.filter((r) => r.rec.componentType === "floor_tile" && r.rec.materialId === "tile_porcelain_floor").slice(0, 400).map((r) => r.rec.id);
  const realCtx = (assessments: Assessments): TrackingContext => ({ inv: real, assessments, allocations: [], requirementNames: new Map(), removal: new Map() });

  it("tracks hundreds of real components; the report reconciles and never counts a component twice", () => {
    const A = applyPatch(real, EMPTY, tiles, { classification: "direct_reuse", recoveryPct: 80, preparation: "none" }).map;
    const tc = realCtx(A);
    const records: Record<string, TrackingRecord> = {};
    tiles.forEach((id, i) => {
      let r = begin(id, tc).record;
      if (i % 3 === 0) r = must(r, tc, rec2(real.byId.get(id)!.primary.value! * 0.5, i % 2 === 0));
      records[id] = r;
    });
    const rows = buildRows(records, tc);
    expect(rows).toHaveLength(400);
    expect(reconcileRows(rows)).toEqual([]);
    const t = totals(rows);
    expect(t).toHaveLength(1);
    expect(t[0]!.unit).toBe("m2");
    expect(t[0]!.records).toBe(400);
    const expectedAvail = tiles.reduce((s, id) => s + real.byId.get(id)!.primary.value!, 0);
    near(t[0]!.available, expectedAvail, 1e-6);
    near(t[0]!.planned, expectedAvail * 0.8, 1e-6);
    // B1 is untouched by tracking
    expect(real.byId.get(tiles[0]!)!.primary.value).toBe(real.rows.find((r) => r.rec.id === tiles[0])!.q.primary.value);
  });
  it("the planned scope of a real model is the B2 reuse / recycling assessments", () => {
    const A = applyPatch(real, EMPTY, tiles.slice(0, 50), { classification: "recycling", recoveryPct: 70 }).map;
    expect(planScope(realCtx(A)).size).toBe(50);
  });
  it("an assembly of the real model can never hold a record; its parts can", () => {
    const asm = [...real.recordById.values()].find((r) => r.geometry.kind === "group")!;
    const tc = realCtx(EMPTY);
    expect(start({ componentId: asm.id, plan: snapshotOf(planNow({ rec: tiles.length ? real.rows[0]!.rec : asm, q: real.rows[0]!.q }, undefined)) }, oc(tc, asm.id)).error).toMatch(/assemblies/);
  });
});
