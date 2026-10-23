/**
 * Reconciliation on the real model. These identities prove the takeoff has no double counting,
 * no unit mixing and no silent gaps.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/building/config";
import { getStructure, descriptorVolume } from "@/building/structure";
import { getArchitecture } from "@/building/architecture/generate";
import { hasMaterial, materialById } from "@/building/materialLibrary";
import { interiorContext } from "@/building/architecture/interior";
import {
  buildInventory,
  buildSummary,
  categoryCounts,
  concreteTable,
  finishesTable,
  getModelInventory,
  masonryTable,
  modelRecords,
  MATERIAL_PROPS,
  countOf,
  type Inventory,
  measureIn,
  type Unit,
} from "./index";

const UNITS: Unit[] = ["m3", "m2", "m", "nr", "kg"];
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

const arch = getArchitecture(DEFAULT_CONFIG);
const str = getStructure(DEFAULT_CONFIG);
const strArc = [...str, ...arch.records]; // the A1 + A2 model the brief describes
let full: Inventory;
let sa: Inventory;
let buildMs = 0;

beforeAll(() => {
  const all = modelRecords(); // generation is cached; time only the engine
  const t0 = performance.now();
  full = buildInventory([...all], arch); // fresh array: bypasses the memo
  buildMs = performance.now() - t0;
  sa = buildInventory(strArc, arch);
  console.log(`[B1] engine build: ${buildMs.toFixed(0)} ms for ${all.length} records (${full.rows.length} leaves)`);
});

describe("model facts", () => {
  it("record counts", () => {
    expect(str).toHaveLength(945);
    expect(arch.records).toHaveLength(50549);
    expect(strArc).toHaveLength(51494);
    expect(sa.rows).toHaveLength(945 + 47812);
    expect(sa.assemblyCount).toBe(2737);
    expect(full.records.length).toBe(87380);
  });

  it("every componentType is classified (0 UNCLASSIFIED) and every materialId has a density entry", () => {
    expect(full.issueCounts.UNCLASSIFIED).toBeUndefined();
    expect(full.breakdowns.category.has("other")).toBe(false);
    const ids = new Set(full.records.map((r) => r.materialId));
    for (const id of ids) expect(MATERIAL_PROPS[id], `density entry for ${id}`).toBeDefined();
    for (const id of ids) expect(id === "rcc_conceptual" || hasMaterial(id), `${id} is in a material library`).toBe(true);
    // ...and every library material too, so a new generator material is caught
    for (const id of Object.keys(MATERIAL_PROPS)) expect(id === "rcc_conceptual" || hasMaterial(id), id).toBe(true);
  });

  it("no record mismatches, duplicates or invalid values", () => {
    expect(full.issueCounts.RECORD_MISMATCH).toBeUndefined();
    expect(full.issueCounts.DUPLICATE_ID).toBeUndefined();
    expect(full.issueCounts.INVALID_VALUE).toBeUndefined();
    expect(full.issueCounts.MISSING_DIMENSION).toBeUndefined();
    const warnings = full.issues.filter((i) => i.severity === "warning");
    // the only warning: the roof-access door, hosted by the roof enclosure (not a wall assembly)
    expect(warnings.map((w) => [w.code, w.componentId])).toEqual([["UNLINKED_OPENING", "ARC-DOOR-RF-MUM-S-01"]]);
  });
});

describe("identity 1: Σ by floor = Σ by category = Σ by material = building (per unit)", () => {
  it.each(["full", "strArc"])("%s", (which) => {
    const inv = which === "full" ? full : sa;
    for (const u of UNITS) {
      const total = inv.totals.totals[u]?.value ?? null;
      const sums = (m: ReadonlyMap<string, { totals: Partial<Record<Unit, { value: number | null }>> }>) => [...m.values()].reduce((s, b) => s + (b.totals[u]?.value ?? 0), 0);
      if (total === null) continue;
      for (const dim of ["floor", "category", "material", "system", "componentType"] as const) {
        expect(near(sums(inv.breakdowns[dim]), total), `${u} by ${dim}: ${sums(inv.breakdowns[dim])} vs ${total}`).toBe(true);
      }
      // assemblies of leaves with a parent
      const withParent = inv.rows.filter((r) => r.rec.parentId !== undefined).reduce((s, r) => s + (measureIn(r, u) ?? 0), 0);
      expect(near(sums(inv.breakdowns.assembly), withParent)).toBe(true);
    }
  });

  it("each unit's total equals a plain sum over the leaves", () => {
    for (const u of UNITS) {
      let s = 0;
      for (const r of full.rows) s += measureIn(r, u) ?? 0;
      expect(near(s, full.totals.totals[u]!.value!), u).toBe(true);
    }
  });
});

describe("identity 2: recomputed quantity = record.quantity", () => {
  it("0 mismatches over every leaf", () => {
    let checked = 0;
    let mismatches = 0;
    for (const { rec, q } of full.rows) {
      if (q.primary.unit !== rec.unit || q.primary.value === null) continue;
      checked++;
      if (!near(q.primary.value, rec.quantity)) mismatches++;
    }
    console.log(`[B1] identity 2: ${checked} leaves checked, ${mismatches} mismatches`);
    expect(checked).toBe(full.rows.length);
    expect(mismatches).toBe(0);
  });
});

describe("identity 3: concrete total = Σ STR + Σ ARC concrete parts", () => {
  it("matches independent sums", () => {
    const strVol = str.reduce((s, r) => s + descriptorVolume(r.geometry), 0);
    // independent ARC concrete: material substance "concrete" (library), leaves only
    const arcConcrete = arch.records.filter((r) => r.geometry.kind !== "group" && materialById(r.materialId).substance === "concrete").reduce((s, r) => s + descriptorVolume(r.geometry), 0);
    const strCat = sa.rows.filter((r) => r.rec.system === "structure").reduce((s, r) => s + (measureIn(r, "m3") ?? 0), 0);
    expect(near(strCat, strVol)).toBe(true);
    const concrete = sa.breakdowns.category.get("concrete")!.totals.m3!.value!;
    console.log(`[B1] identity 3: STR ${strVol.toFixed(3)} + ARC ${arcConcrete.toFixed(3)} = ${(strVol + arcConcrete).toFixed(3)} m3; engine concrete ${concrete.toFixed(3)}`);
    expect(near(concrete, strVol + arcConcrete)).toBe(true);
  });
});

describe("identity 4: wall gross = net + lintel + voids = the solid band", () => {
  const hosted = arch.storeys.flatMap((s) => s.walls);

  /** Independent band volume from the generator's piece boxes + hosted openings, cell by cell. */
  function band(w: (typeof hosted)[number]) {
    const ai = w.axis === "x" ? 0 : 2;
    const ci = w.axis === "x" ? 2 : 0;
    const H = w.y1 - w.y0;
    const cuts = new Set<number>();
    for (const p of w.pieces) {
      cuts.add(p.box.min[ai]!);
      cuts.add(p.box.max[ai]!);
    }
    for (const o of w.openings) {
      cuts.add(o.o0);
      cuts.add(o.o1);
    }
    const xs = [...cuts].sort((a, b) => a - b);
    let vol = 0;
    for (let i = 0; i + 1 < xs.length; i++) {
      const [a, b] = [xs[i]!, xs[i + 1]!];
      if (b - a < 1e-9) continue;
      const m = (a + b) / 2;
      const cover = w.pieces.filter((p) => p.box.min[ai]! < m && p.box.max[ai]! > m);
      const open = w.openings.find((o) => o.o0 < m && o.o1 > m);
      if (cover.length === 0 && !open) continue; // outside the wall (junction owned by another wall)
      const t = cover[0]!.box.max[ci]! - cover[0]!.box.min[ci]!;
      const covered = cover.reduce((s, p) => s + (p.box.max[1]! - p.box.min[1]!), 0);
      const missing = H - covered;
      const expectedVoid = open ? open.head - open.bottom + (open.kind === "window" ? 0.03 : 0) : 0;
      expect(Math.abs(missing - expectedVoid), `${w.id} cell ${a.toFixed(3)}..${b.toFixed(3)}`).toBeLessThan(1e-9);
      vol += (b - a) * t * H;
    }
    return vol;
  }

  it("every hosted wall: net + lintel + voids = gross = independent band volume", () => {
    let n = 0;
    for (const w of hosted) {
      const t = full.wallById.get(w.id)!;
      expect(t.gross.status, w.id).toBe("calculated");
      const gross = t.gross.value!;
      expect(near(gross, t.net.value! + t.lintel.value! + t.voids.value!), w.id).toBe(true);
      expect(near(gross, band(w), 1e-9), `${w.id} gross ${gross} vs band`).toBe(true);
      n++;
    }
    expect(n).toBe(896);
  });

  it("25 sampled walls with openings", () => {
    const withOpenings = hosted.filter((w) => w.openings.length > 0);
    const step = Math.floor(withOpenings.length / 25);
    const sample = Array.from({ length: 25 }, (_, i) => withOpenings[i * step]!);
    expect(new Set(sample.map((w) => w.id)).size).toBe(25);
    for (const w of sample) {
      const t = full.wallById.get(w.id)!;
      expect(t.openings.length).toBe(w.openings.length);
      expect(near(t.gross.value!, band(w))).toBe(true);
    }
  });

  it("each opening is deducted once; one roof door is reported unlinked", () => {
    const ids = full.walls.flatMap((w) => w.openings.map((o) => o.openingId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(439);
    const holders = full.records.filter((r) => r.geometry.kind === "group" && ["door", "window", "cased_opening"].includes(r.assemblyType ?? ""));
    expect(holders).toHaveLength(440);
    expect(full.issues.filter((i) => i.code === "UNLINKED_OPENING")).toHaveLength(1);
  });

  it("lintels are concrete, not masonry", () => {
    const lintels = full.rows.filter((r) => r.rec.componentType === "wall_lintel");
    expect(lintels).toHaveLength(439);
    expect(lintels.every((r) => r.q.category === "concrete")).toBe(true);
    const wallLintel = full.walls.reduce((s, w) => s + w.lintel.value!, 0);
    expect(near(wallLintel, lintels.reduce((s, r) => s + (measureIn(r, "m3") ?? 0), 0))).toBe(true);
  });

  it("stairwell lining walls (U of three piers, no own thickness) take the pieces' common thickness", () => {
    const t = full.wallById.get("ARC-WALL-G-CM-STC-WELL")!;
    expect(t.thicknessM).toBeCloseTo(0.115, 9);
    expect(t.gross.status).toBe("calculated");
    expect(near(t.gross.value!, t.net.value!)).toBe(true);
  });
});

describe("identity 5: floor finishes", () => {
  it("Σ tile ≤ Σ screed ≤ Σ room clear area; per room tile/screed ≥ 0.97", () => {
    const clearByRoom = new Map<string, { clear: number; finish: number }>();
    arch.storeys.forEach((s, st) => {
      const ctx = interiorContext(s.plan, DEFAULT_CONFIG);
      for (const ir of ctx.rooms.values()) {
        const area = (rs: readonly { x0: number; x1: number; z0: number; z1: number }[]) => rs.reduce((a, r) => a + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
        clearByRoom.set(`${st}|${ir.room.id}`, { clear: area(ir.clears), finish: area(ir.floor) });
      }
    });
    const per = new Map<string, { tile: number; screed: number }>();
    for (const r of full.rows) {
      const t = r.rec.componentType;
      if ((t !== "floor_tile" && t !== "floor_screed") || !r.rec.roomId) continue;
      const k = `${r.rec.floor}|${r.rec.roomId}`;
      const e = per.get(k) ?? { tile: 0, screed: 0 };
      e[t === "floor_tile" ? "tile" : "screed"] += r.q.primary.value!;
      per.set(k, e);
    }
    let tile = 0;
    let screed = 0;
    let clear = 0;
    let minRatio = Infinity;
    for (const [k, e] of per) {
      const c = clearByRoom.get(k)!;
      expect(c, `room ${k}`).toBeDefined();
      expect(e.tile, k).toBeLessThanOrEqual(e.screed + 1e-9);
      expect(e.screed, k).toBeLessThanOrEqual(c.finish + 1e-9);
      expect(c.finish, k).toBeLessThanOrEqual(c.clear + 1e-9);
      minRatio = Math.min(minRatio, e.tile / e.screed);
      expect(e.tile / e.screed, `tile/screed ${k}`).toBeGreaterThanOrEqual(0.97);
      tile += e.tile;
      screed += e.screed;
      clear += c.clear;
    }
    console.log(`[B1] identity 5: tile ${tile.toFixed(2)} m2 ≤ screed ${screed.toFixed(2)} m2 ≤ room clear ${clear.toFixed(2)} m2 (tile/screed ${(100 * tile / screed).toFixed(2)}%, worst room ${(100 * minRatio).toFixed(2)}%)`);
    expect(tile).toBeLessThanOrEqual(screed);
    expect(screed).toBeLessThanOrEqual(clear);
    expect(tile).toBeLessThan(screed); // grout joints exist
    // the floor_tile category also holds balcony / roof-enclosure tiles; the engine's totals agree
    const tileCat = full.breakdowns.componentType.get("floor_tile")!.totals.m2!.value!;
    const screedCat = full.breakdowns.componentType.get("floor_screed")!.totals.m2!.value!;
    expect(near(tileCat, tile)).toBe(true);
    expect(near(screedCat, screed)).toBe(true);
  });
});

describe("identity 6: determinism", () => {
  it("two builds give identical output", () => {
    const a = buildInventory([...strArc], arch);
    const b = buildInventory([...strArc], arch);
    expect(a).not.toBe(b);
    expect(b.totals).toEqual(a.totals);
    expect(b.breakdowns).toEqual(a.breakdowns);
    expect(b.walls).toEqual(a.walls);
    expect(b.counts).toEqual(a.counts);
    expect(b.issues).toEqual(a.issues);
    // per-row quantities: compare serialisations (a deep toEqual over ~50k rows is slow)
    expect(JSON.stringify(b.rows.map((r) => r.q))).toBe(JSON.stringify(a.rows.map((r) => r.q)));
  });
});

describe("hand-checkable anchors (config.ts)", () => {
  const bt = (t: string) => sa.breakdowns.componentType.get(t)!.totals.m3!.value!;
  it("structure", () => {
    expect(near(bt("column"), 153.09)).toBe(true); // 210 x 0.45 x 0.45 x 3.6
    expect(near(bt("footing"), 100.8)).toBe(true); // 42 x 2.0 x 2.0 x 0.6
    expect(near(bt("pedestal"), 13.608)).toBe(true); // 42 x 0.6 x 0.6 x 0.9
    expect(sa.breakdowns.componentType.get("column")!.leafCount).toBe(210);
    expect(sa.breakdowns.componentType.get("beam")!.leafCount).toBe(426);
    expect(sa.breakdowns.componentType.get("slab")!.leafCount).toBe(210);
    expect(sa.breakdowns.system.get("structure")!.leafCount).toBe(945);
  });

  it("beams: clear 5.55 x 0.30 x 0.50 above L0, 5.40 at the L0 plinth beam", () => {
    const beams = sa.rows.filter((r) => r.rec.componentType === "beam");
    expect(beams.some((r) => r.rec.floor === 1 && near(measureIn(r, "m3")!, 5.55 * 0.3 * 0.5))).toBe(true);
    expect(beams.filter((r) => r.rec.floor === 0).every((r) => near(measureIn(r, "m3")!, 5.4 * 0.3 * 0.5))).toBe(true);
    expect(near(measureIn(beams.find((r) => r.rec.floor === 1)!, "m3")!, 0.8325)).toBe(true);
  });

  it("a notched slab panel and a stair flight are below their bounding boxes", () => {
    const slab = sa.rows.find((r) => r.rec.id === "STR-SLAB-G-P01")!;
    const handArea = 5.7 * 5.7 - 4 * 0.15 * 0.15;
    expect(near(measureIn(slab, "m3")!, handArea * 0.15)).toBe(true);
    expect(measureIn(slab, "m3")!).toBeLessThan(5.7 * 5.7 * 0.15);
    const flight = sa.rows.find((r) => r.rec.id === "STR-STAIR-G-FL1")!;
    expect(flight.rec.geometry.kind === "prism" && flight.rec.geometry.plane).toBe("zy");
    expect(measureIn(flight, "m3")!).toBeLessThan(3.08 * 1.8 * 1.2);
  });

  it("mass: 0.729 m3 x 2400 = 1,749.6 kg (estimated); reinforcement stays unavailable", () => {
    const col = sa.rows.find((r) => r.rec.componentType === "column")!;
    expect(near(col.q.mass.value!, 1749.6)).toBe(true);
    expect(col.q.mass.status).toBe("estimated");
    expect(col.q.mass.assumptions.join(" ")).toMatch(/reinforcement/);
  });

  it("rotated rail: local size, not the world bounding box", () => {
    const rail = sa.rows.find((r) => r.rec.componentType === "stair_handrail")!;
    expect(rail.rec.originalRotation[0]).not.toBe(0);
    const g = rail.rec.geometry;
    if (g.kind !== "box") throw new Error("box expected");
    expect(near(rail.q.primary.value!, Math.max(...g.size))).toBe(true);
    expect(near(rail.q.solidVolumeM3!, g.size[0] * g.size[1] * g.size[2])).toBe(true);
  });
});

describe("product counts", () => {
  it("by assembly, not by part", () => {
    const c = full.counts;
    expect(countOf(c, "doors")).toBe(264);
    expect(countOf(c, "cased_openings")).toBe(5);
    expect(countOf(c, "windows")).toBe(171);
    expect(countOf(c, "kitchens")).toBe(29);
    expect(countOf(c, "wc")).toBe(79);
    expect(countOf(c, "basins")).toBe(79);
    expect(countOf(c, "shower_trays")).toBe(63);
    expect(countOf(c, "washers")).toBe(29);
    expect(countOf(c, "balcony_railings")).toBe(24);
    expect(countOf(c, "stair_balustrades")).toBe(15);
    expect(countOf(c, "light_fittings")).toBe(1181 + 5);
    expect(countOf(c, "balusters")).toBe(1488 + 225);
    expect(countOf(c, "posts")).toBe(168);
    expect(c.find((x) => x.key === "balusters")!.segments).toBe(true);
    expect(c.find((x) => x.key === "windows")!.result.sourceIds).toHaveLength(171);
  });
});

describe("summary cards and breakdown tables agree", () => {
  it("table totals equal the cards", () => {
    const s = buildSummary(sa);
    const card = (k: string) => s.cards.find((c) => c.key === k)!;
    const conc = concreteTable(sa);
    expect(near(conc.totals.at(-1)!, card("concrete").value!)).toBe(true);
    // rows sum to the totals row
    for (let c = 0; c < conc.totals.length; c++) expect(near(conc.rows.reduce((a, r) => a + (r.values[c] ?? 0), 0), conc.totals[c] ?? 0)).toBe(true);
    const mas = masonryTable(sa);
    expect(near(mas.totals[0]!, card("masonry").value!)).toBe(true);
    for (let c = 0; c < mas.totals.length; c++) expect(near(mas.rows.reduce((a, r) => a + (r.values[c] ?? 0), 0), mas.totals[c] ?? 0)).toBe(true);
    const fin = finishesTable(sa);
    const keys = ["tile_floor", "screed", "ceiling_board", "tile_wall", "skirting"];
    const cardKeys = ["tile_floor", "screed", "ceiling_board", "tile_wall", "skirting"];
    keys.forEach((_, i) => {
      expect(near(fin.totals[i]!, card(cardKeys[i]!).value!), keys[i]).toBe(true);
      expect(near(fin.rows.reduce((a, r) => a + (r.values[i] ?? 0), 0), fin.totals[i]!)).toBe(true);
    });
    const cc = categoryCounts(sa);
    expect(cc.rows.reduce((a, r) => a + r.components, 0)).toBe(cc.total);
    expect(cc.total).toBe(sa.rows.length);
    // the lintel card sits inside the concrete card
    expect(card("lintels").value!).toBeLessThan(card("concrete").value!);
    expect(near(card("lintels").value!, sa.walls.reduce((a, w) => a + w.lintel.value!, 0) + (sa.breakdowns.componentType.get("enclosure_wall_lintel")?.totals.m3?.value ?? 0))).toBe(true);
  });

  it("an unavailable value reads Not available with a reason, never 0", () => {
    const s = buildSummary(buildInventory([]));
    const c = s.cards.find((x) => x.key === "concrete")!;
    expect(c.value).toBeNull();
    expect(c.display).toBe("Not available");
    expect(c.reason).toBeTruthy();
    expect(s.cards.find((x) => x.key === "mass")!.display).toBe("Not available");
  });

  it("mass covers most, not all, of the modelled solid volume", () => {
    const pct = full.massCoverage.pct!;
    console.log(`[B1] mass coverage: ${pct.toFixed(1)}% of ${full.massCoverage.totalM3.toFixed(1)} m3 (A1+A2+A3); A1+A2 ${sa.massCoverage.pct!.toFixed(1)}%`);
    expect(pct).toBeGreaterThan(50);
    expect(pct).toBeLessThan(100);
  });
});

describe("performance", () => {
  it("the engine builds the full model in < 1.5 s", () => {
    expect(buildMs).toBeLessThan(1500);
  });

  it("the shared model inventory is memoised", () => {
    expect(getModelInventory()).toBe(getModelInventory());
  });
});
