import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "@/building/config";
import { getStructure } from "@/building/structure";
import { getArchitecture } from "@/building/architecture/generate";
import { checkHierarchy, findOverlaps } from "@/building/architecture/validateComponents";
import { getMep } from "./generate";
import { checkConnectivity, checkMepIds, checkMepQuantities, findMepClashes } from "./validate";

const cfg = DEFAULT_CONFIG;
const mep = getMep(cfg);
const structure = getStructure(cfg);
const arch = getArchitecture(cfg).records;
const building = [...structure, ...arch];
const all = new Map([...building, ...mep.records].map((r) => [r.id, r]));
const elec = mep.records.filter((r) => r.system === "electrical");
const byType = (t: string) => elec.filter((r) => r.componentType === t);
const flats = getArchitecture(cfg).storeys.reduce((n, s) => n + s.plan.apartments.filter((a) => a.id !== "CM").length, 0);

describe("electrical: records", () => {
  it("ids are unique, valid, ELC-prefixed; hierarchy and quantities match the geometry", () => {
    expect(checkMepIds(elec)).toEqual([]);
    expect(checkHierarchy(elec)).toEqual([]);
    expect(checkMepQuantities(elec)).toEqual([]);
  });
  it("connections are symmetric and every network / circuit is one connected graph", () => {
    expect(checkConnectivity(elec, all, new Set(mep.networks.map((n) => n.id)))).toEqual([]);
  });
});

describe("electrical: distribution", () => {
  it("incoming supply -> MDB -> one meter and one DB per flat, one common DB per floor", () => {
    expect(byType("feeder_pillar")).toHaveLength(1);
    expect(byType("main_panel")).toHaveLength(1);
    expect(byType("energy_meter")).toHaveLength(flats + 1);
    expect(byType("distribution_board")).toHaveLength(flats);
    expect(byType("common_distribution_board")).toHaveLength(cfg.storeyCount);
  });
  it("every flat submain runs from its meter to its DB incomer, through the tray system", () => {
    for (const n of mep.networks.filter((x) => x.kind === "submain")) {
      const recs = elec.filter((r) => r.networkId === n.id);
      const links = new Set(recs.flatMap((r) => r.connectedTo ?? []));
      expect([...links].some((id) => all.get(id)?.componentType === "energy_meter"), n.id).toBe(true);
      expect([...links].some((id) => all.get(id)?.componentType === "isolator"), n.id).toBe(true);
      const trays = elec.filter((r) => /cable_tray/.test(r.componentType) && (r.carries ?? []).includes(n.id));
      expect(trays.length, n.id).toBeGreaterThan(0);
    }
  });
  it("each circuit has an MCB in its DB and reaches at least one device or light", () => {
    for (const n of mep.networks.filter((x) => x.kind === "circuit")) {
      const recs = elec.filter((r) => r.networkId === n.id);
      expect(recs.some((r) => r.componentType === "mcb"), n.id).toBe(true);
    }
    const lit = new Set(elec.flatMap((r) => r.connectedTo ?? []));
    for (const l of arch.filter((r) => r.componentType.startsWith("light_"))) expect(lit.has(l.id), l.id).toBe(true);
  });
  it("earthing: two pits, a main earthing terminal and an earth bar on every floor", () => {
    expect(byType("earth_pit")).toHaveLength(2);
    expect(byType("earth_bar")).toHaveLength(cfg.storeyCount + 1);
  });
  it("devices that could not be wired are reported, not left in the model", () => {
    const ids = new Set(elec.map((r) => r.id));
    for (const u of mep.unresolved.filter((x) => x.reason.includes("device not placed"))) expect(ids.has(u.subject)).toBe(false);
  });
});

describe("electrical: geometry", () => {
  it("nothing passes through a beam, column, pedestal, footing or stair", () => {
    expect(findOverlaps(elec, structure.filter((r) => r.componentType !== "slab"))).toEqual([]);
  });
  it("no unintended clash with A1/A2 or between MEP components (documented allow-list only)", () => {
    const c = findMepClashes(mep.records, building);
    expect(c.building).toEqual([]);
    expect(c.internal).toEqual([]);
  });
});
