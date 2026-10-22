import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "@/building/config";
import { getStructure, type ComponentRecord } from "@/building/structure";
import { getArchitecture } from "@/building/architecture/generate";
import { checkHierarchy, findOverlaps } from "@/building/architecture/validateComponents";
import { generateMep, getMep } from "./generate";
import { checkConnectivity, checkFalls, checkMepIds, checkMepQuantities, findMepClashes } from "./validate";

const cfg = DEFAULT_CONFIG;
const mep = getMep(cfg);
const structure = getStructure(cfg);
const arch = getArchitecture(cfg).records;
const building = [...structure, ...arch];
const buildingById = new Map(building.map((r) => [r.id, r]));
const plumbing = mep.records.filter((r) => r.system === "plumbing");
const byId = new Map(mep.records.map((r) => [r.id, r]));
const net = (kind: string) => mep.networks.filter((n) => n.kind === kind);
const inNet = (id: string) => plumbing.filter((r) => r.networkId === id);

describe("plumbing: identity and records", () => {
  it("is deterministic (same ids, positions and quantities on regeneration)", () => {
    const again = generateMep(cfg).records.filter((r) => r.system === "plumbing");
    expect(again.map((r) => r.id)).toEqual(plumbing.map((r) => r.id));
    expect(again.map((r) => [r.quantity, ...r.originalPosition])).toEqual(plumbing.map((r) => [r.quantity, ...r.originalPosition]));
  });
  it("ids are unique, valid, PLB-prefixed and carry the record floor", () => {
    expect(checkMepIds(mep.records)).toEqual([]);
    expect(new Set([...mep.records, ...building].map((r) => r.id)).size).toBe(mep.records.length + building.length);
  });
  it("hierarchy: every component sits in its group assembly; no empty assemblies", () => {
    expect(checkHierarchy(mep.records)).toEqual([]);
  });
  it("quantities follow the geometry: run lengths in m from the route, parts counted in nr", () => {
    expect(checkMepQuantities(mep.records)).toEqual([]);
    const runs = plumbing.filter((r) => r.geometry.kind === "cylinder");
    expect(runs.length).toBeGreaterThan(1000);
    expect(runs.every((r) => r.unit === "m")).toBe(true);
  });
  it("records are frozen and labelled as conceptual", () => {
    for (const r of plumbing.slice(0, 500)) {
      expect(Object.isFrozen(r)).toBe(true);
      expect(r.confidence).toBe("assumed");
      expect(r.assumptions).toMatch(/onceptual/);
    }
  });
});

describe("plumbing: connectivity", () => {
  it("connections are symmetric, reference real records, and every network is one connected graph", () => {
    expect(checkConnectivity(mep.records, buildingById, new Set(mep.networks.map((n) => n.id)))).toEqual([]);
  });
  it("every A2 service endpoint is connected (none unresolved)", () => {
    const roles = ["connection_point", "wc_pan", "floor_drain", "shower_mixer", "shower_arm", "roof_drain"];
    const a2 = arch.filter((r) => roles.includes(r.componentType));
    const ledger = new Map(mep.endpoints.map((e) => [e.id, e]));
    for (const r of a2) expect(ledger.get(r.id)?.connectedBy.length ?? 0, r.id).toBeGreaterThan(0);
    // and the MEP records really touch them
    const touched = new Set(plumbing.flatMap((r) => r.connectedTo ?? []));
    for (const r of a2) expect(touched.has(r.id), r.id).toBe(true);
    expect(mep.unresolved.filter((u) => !u.subject.startsWith("ELC") && !u.reason.includes("socket"))).toEqual([]);
  });
  it("every drainage stack ends in an inspection chamber on a sewer line that reaches a manhole", () => {
    const stacks = net("drainage");
    expect(stacks.length).toBeGreaterThanOrEqual(16);
    const ics = new Set<string>();
    for (const s of stacks) {
      const ic = inNet(s.id).find((r) => r.componentType === "inspection_chamber");
      expect(ic, s.id).toBeDefined();
      ics.add(ic!.id);
    }
    const sewers = net("sewer");
    expect(sewers.length).toBe(2);
    const sewerLinks = new Set(sewers.flatMap((s) => inNet(s.id).flatMap((r) => r.connectedTo ?? [])));
    for (const ic of ics) expect(sewerLinks.has(ic), ic).toBe(true);
    for (const s of sewers) expect(inNet(s.id).some((r) => r.componentType === "manhole")).toBe(true);
  });
  it("water supply: municipal -> sump -> pumps -> rising main -> 2 tanks -> down-take -> a meter per flat", () => {
    const comp = (t: string) => plumbing.filter((r) => r.componentType === t);
    expect(comp("sump_tank")).toHaveLength(1);
    expect(comp("pump")).toHaveLength(2);
    expect(comp("water_tank")).toHaveLength(2);
    const flats = getArchitecture(cfg).storeys.reduce((n, s) => n + s.plan.apartments.filter((a) => a.id !== "CM").length, 0);
    const meters = comp("water_meter").filter((m) => m.networkId === "PLB-NET-WS-DIST");
    expect(meters).toHaveLength(flats + 1); // + ground-floor common block
    // each flat's cold-water network is fed from its own meter
    for (const n of net("cold-water").filter((x) => x.apartmentId && x.apartmentId !== "CM")) {
      const feeds = inNet(n.id).some((r) => (r.connectedTo ?? []).some((c) => byId.get(c)?.componentType === "water_meter"));
      expect(feeds, n.id).toBe(true);
    }
    // floor isolation valves on the down-take, one per storey
    expect(comp("valve").filter((v) => v.name.includes("floor isolation"))).toHaveLength(cfg.storeyCount);
  });
  it("hot water: every geyser feeds the hot inlet of its bathroom's shower mixer", () => {
    for (const n of net("hot-water")) {
      const recs = inNet(n.id);
      expect(recs.some((r) => r.componentType === "water_heater"), n.id).toBe(true);
      expect(recs.some((r) => (r.connectedTo ?? []).some((c) => buildingById.get(c)?.componentType === "shower_mixer")), n.id).toBe(true);
    }
  });
});

describe("plumbing: geometry", () => {
  it("drainage runs fall downstream at no less than their configured gradient, as drawn", () => {
    expect(checkFalls(mep.records)).toEqual([]);
    const branches = plumbing.filter((r) => ["drain_branch", "building_drain", "sewer_pipe"].includes(r.componentType));
    expect(branches.length).toBeGreaterThan(100);
    for (const b of branches) expect(b.gradient, b.id).toBeGreaterThanOrEqual(1 / 100 - 1e-12);
  });
  it("no run or part passes through a beam, column, pedestal, footing or stair", () => {
    const hard = structure.filter((r) => r.componentType !== "slab");
    expect(findOverlaps(plumbing, hard)).toEqual([]);
  });
  it("no unintended clash with any A1/A2 component or between MEP components (documented allow-list only)", () => {
    const c = findMepClashes(mep.records, building);
    expect(c.building).toEqual([]);
    expect(c.internal).toEqual([]);
  });
  it("A1/A2 are untouched by A3 (record counts unchanged, MEP never in their arrays)", () => {
    expect(structure).toHaveLength(945);
    expect(arch).toHaveLength(50549);
    expect(building.some((r: ComponentRecord) => r.system === "plumbing" || r.system === "electrical")).toBe(false);
  });
});
