import { describe, expect, it } from "vitest";
import { polygonArea } from "@/building/structure";
import type { ArchitectureModel } from "@/building/architecture/generate";
import type { WallBuild } from "@/building/architecture/walls";
import { ARCH_CONFIG } from "@/building/architecture/config";
import {
  addQty,
  buildInventory,
  computeComponent,
  countProducts,
  csvValue,
  CSV_COLUMNS,
  csvField,
  filterRows,
  formatTonnes,
  formatValue,
  parseCsv,
  qty,
  rowsToCsv,
  SORT_COLUMNS,
  sortRows,
  totalOf,
  wallTakeoffs,
  type SortColumn,
  HOLLOW_TYPES,
  MATERIAL_PROPS,
} from "./index";
import { box, rec } from "./testing";

const close = (a: number | null, b: number, tol = 1e-9) => {
  expect(a).not.toBeNull();
  expect(Math.abs(a! - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
};

describe("geometry measures", () => {
  it("rectangular volume", () => {
    const q = computeComponent(rec({ id: "T-1", componentType: "beam", geometry: box(2, 3, 4), quantity: 24 }));
    expect(q.primary).toMatchObject({ kind: "volume", unit: "m3", value: 24, status: "calculated" });
    expect(q.primary.issues).toEqual([]);
    expect(q.primary.sourceIds).toEqual(["T-1"]);
  });

  it("column 0.45 x 3.6 x 0.45 = 0.729 m3", () => {
    const q = computeComponent(rec({ id: "T-COL", componentType: "column", geometry: box(0.45, 3.6, 0.45), quantity: 0.45 * 3.6 * 0.45 }));
    close(q.primary.value, 0.729);
    close(q.mass.value, 1749.6); // 0.729 x 2400
    expect(q.mass.status).toBe("estimated");
    expect(q.mass.assumptions.join(" ")).toContain("reinforcement");
  });

  it("beam clear span 5.55 x 0.30 x 0.50 = 0.8325 m3", () => {
    const q = computeComponent(rec({ id: "T-BM", componentType: "beam", geometry: box(5.55, 0.5, 0.3), quantity: 5.55 * 0.5 * 0.3 }));
    close(q.primary.value, 0.8325);
  });

  it("xz prism slab uses the polygon, not the bounding box (notched corners)", () => {
    // 5.7 x 5.7 plate with four 0.15 x 0.15 corner notches, 0.15 thick.
    const profile = [[-2.85, -2.7], [-2.7, -2.7], [-2.7, -2.85], [2.7, -2.85], [2.7, -2.7], [2.85, -2.7], [2.85, 2.7], [2.7, 2.7], [2.7, 2.85], [-2.7, 2.85], [-2.7, 2.7], [-2.85, 2.7]] as const;
    const handArea = 5.7 * 5.7 - 4 * 0.15 * 0.15; // 32.40
    const g = { kind: "prism", plane: "xz", profile, extent: 0.15 } as const;
    const q = computeComponent(rec({ id: "T-SLAB", componentType: "slab", geometry: g, quantity: handArea * 0.15 }));
    close(q.primary.value, handArea * 0.15); // 4.86
    expect(q.primary.value!).toBeLessThan(5.7 * 5.7 * 0.15); // < bbox 4.8735
    expect(q.primary.issues).toEqual([]);
    expect(q.secondary).toHaveLength(1);
    expect(q.secondary[0]).toMatchObject({ kind: "area", unit: "m2" });
    close(q.secondary[0]!.value, handArea);
  });

  it("zy prism stair flight: area x width, below the bounding box", () => {
    // 3 steps (0.28 run x 0.15 rise) on a 0.1 m thick waist, hand-integrated with a trapezoid rule.
    const profile: [number, number][] = [[0, 0], [0, 0.15], [0.28, 0.15], [0.28, 0.3], [0.56, 0.3], [0.56, 0.45], [0.84, 0.45], [0.84, 0]];
    // Green's theorem independently of polygonArea (signed sum of trapezoids).
    let a = 0;
    for (let i = 0; i < profile.length; i++) {
      const [x0, y0] = profile[i]!;
      const [x1, y1] = profile[(i + 1) % profile.length]!;
      a += ((x0 + x1) * (y1 - y0)) / 2;
    }
    const handArea = Math.abs(a);
    expect(handArea).toBeCloseTo(0.28 * 0.15 + 0.28 * 0.3 + 0.28 * 0.45 + 0, 12);
    const g = { kind: "prism", plane: "zy", profile, extent: 1.2 } as const;
    const q = computeComponent(rec({ id: "T-FL", componentType: "stair_flight", geometry: g, quantity: handArea * 1.2 }));
    close(q.primary.value, handArea * 1.2);
    expect(q.primary.value!).toBeLessThan(0.84 * 0.45 * 1.2);
    expect(polygonArea(profile)).toBeCloseTo(handArea, 12);
  });

  it("cylinder: pi r^2 h and length = axis height", () => {
    const g = { kind: "cylinder", radius: 0.025, height: 2, axis: "y" } as const;
    const v = computeComponent(rec({ id: "T-CY", componentType: "facade_downpipe", geometry: g, unit: "m", quantity: 2, materialId: "pvc_pipe" }));
    close(v.primary.value, 2); // length
    expect(v.primary.unit).toBe("m");
    const solid = computeComponent(rec({ id: "T-CY2", componentType: "pump_plinth", geometry: g, unit: "nr", quantity: 1, materialId: "concrete_precast" }));
    expect(solid.secondary[0]).toMatchObject({ kind: "volume" });
    close(solid.secondary[0]!.value, Math.PI * 0.025 * 0.025 * 2);
  });

  it("rotated box uses its local size, not the world bounding box", () => {
    const L = 3.176476034853718;
    const q = computeComponent(rec({ id: "T-HR", componentType: "stair_handrail", geometry: box(0.05, 0.05, L), unit: "m", quantity: L, rotation: [-0.4918, 0, 0], materialId: "metal_railing" }));
    close(q.primary.value, L);
    expect(q.solidVolumeM3).toBeCloseTo(0.05 * 0.05 * L, 12);
  });

  it("a catalogue part: volume = envelope x fill, estimated; no mass", () => {
    const q = computeComponent(rec({ id: "T-PT", componentType: "pipe_elbow", geometry: { kind: "part", part: "elbow", size: [0.3, 0.3, 0.2], fill: 0.18 }, unit: "nr", quantity: 1, system: "plumbing", materialId: "upvc_swr" }));
    expect(q.primary).toMatchObject({ kind: "count", value: 1 });
    expect(q.mass.value).toBeNull();
    expect(q.solidVolumeM3).toBeNull();
  });
});

describe("floor and finish areas", () => {
  it("a tile's area is the exposed face (two largest sides); thickness is the third", () => {
    const q = computeComponent(rec({ id: "T-TILE", componentType: "floor_tile", geometry: box(0.6, 0.01, 0.4), unit: "m2", quantity: 0.24, materialId: "tile_porcelain_floor" }));
    close(q.primary.value, 0.24);
    expect(q.primary).toMatchObject({ kind: "area", unit: "m2" });
    close(q.secondary[0]!.value, 0.6 * 0.01 * 0.4);
    close(q.mass.value, 0.6 * 0.01 * 0.4 * 2400);
  });

  it("a vertical panel: length x height", () => {
    const q = computeComponent(rec({ id: "T-WT", componentType: "wall_tile_panel", geometry: box(3, 2.1, 0.01), unit: "m2", quantity: 6.3, materialId: "tile_wall_ceramic" }));
    close(q.primary.value, 6.3);
  });
});

describe("mass", () => {
  it("mass = volume x density, estimated", () => {
    const q = computeComponent(rec({ id: "T-M", componentType: "balcony_slab", geometry: box(2, 0.1, 1), quantity: 0.2, materialId: "concrete_balcony" }));
    close(q.mass.value, 0.2 * 2400);
    expect(q.mass.status).toBe("estimated");
    expect(q.mass.method).toContain("density");
  });

  it("thin panel (glass): area x thickness x density, estimated", () => {
    const q = computeComponent(rec({ id: "T-GL", componentType: "glazing", geometry: box(2, 1, 0.006), unit: "m2", quantity: 2, materialId: "glass_clear" }));
    close(q.primary.value, 2);
    close(q.mass.value, 2 * 0.006 * 2500); // 30 kg
    expect(q.mass.status).toBe("estimated");
  });

  it("hollow / assembled items have density null: no mass, with the reason", () => {
    for (const [type, mat] of [["wc_pan", "sanitary_ceramic"], ["kitchen_base_cabinet", "cabinet_laminate"], ["kitchen_fridge", "appliance_white"], ["light_downlight", "fixture_light"], ["window_frame", "metal_frame"], ["door_leaf", "timber_door_light"]] as const) {
      const q = computeComponent(rec({ id: `T-${type}`, componentType: type, geometry: box(0.5, 0.5, 0.5), unit: type === "door_leaf" ? "m2" : "nr", quantity: type === "door_leaf" ? 0.25 : 1, materialId: mat }));
      expect(q.mass.value, type).toBeNull();
      expect(q.mass.status).toBe("unavailable");
      expect(q.mass.issues[0]).toMatchObject({ code: "NO_DENSITY", severity: "info" });
      expect(q.secondary.some((s) => s.kind === "volume"), `${type} reports no product volume`).toBe(false);
    }
    expect(computeComponent(rec({ id: "T-w", componentType: "wc_pan", geometry: box(1, 1, 1), unit: "nr", quantity: 1, materialId: "sanitary_ceramic" })).mass.issues[0]!.message).toContain("solid box is not the product volume");
  });

  it("hollow component types override a solid material", () => {
    expect(HOLLOW_TYPES["sump_tank"]).toBeDefined();
    const q = computeComponent(rec({ id: "T-ST", componentType: "sump_tank", geometry: box(4, 2.4, 3.2), unit: "nr", quantity: 1, materialId: "concrete_precast", system: "plumbing" }));
    expect(q.mass.value).toBeNull();
  });

  it("an unknown material gives a NO_DENSITY warning, never a 0", () => {
    const q = computeComponent(rec({ id: "T-U", componentType: "beam", geometry: box(1, 1, 1), quantity: 1, materialId: "mystery_material" }));
    expect(q.mass.value).toBeNull();
    expect(q.mass.issues[0]).toMatchObject({ code: "NO_DENSITY", severity: "warning" });
  });

  it("every material has a basis and a source", () => {
    for (const [id, p] of Object.entries(MATERIAL_PROPS)) {
      expect(p.source.length, id).toBeGreaterThan(2);
      expect(["reference", "assumed"]).toContain(p.basis);
      if (p.densityKgM3 !== null) expect(p.densityKgM3).toBeGreaterThan(0);
      else expect(p.note, id).toBeTruthy();
    }
  });
});

describe("invalid input", () => {
  it("a missing / zero dimension gives null + INVALID_VALUE, never 0", () => {
    const q = computeComponent(rec({ id: "T-Z", componentType: "beam", geometry: box(1, 0, 1), quantity: 0 }));
    expect(q.primary.value).toBeNull();
    expect(q.primary.status).toBe("unavailable");
    expect(q.primary.issues[0]).toMatchObject({ code: "INVALID_VALUE", componentId: "T-Z", severity: "warning" });
    expect(q.mass.value).toBeNull();
  });

  it("NaN, Infinity and negative sizes are invalid", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      const q = computeComponent(rec({ id: "T-B", componentType: "beam", geometry: box(1, bad, 1), quantity: 1 }));
      expect(q.primary.value, String(bad)).toBeNull();
      expect(q.primary.issues[0]!.code).toBe("INVALID_VALUE");
    }
    const cyl = computeComponent(rec({ id: "T-C", componentType: "pipe", geometry: { kind: "cylinder", radius: -1, height: 1, axis: "y" }, unit: "m", quantity: 1 }));
    expect(cyl.primary.value).toBeNull();
    const prism = computeComponent(rec({ id: "T-P", componentType: "slab", geometry: { kind: "prism", plane: "xz", profile: [[0, 0], [1, 0]], extent: 1 }, quantity: 1 }));
    expect(prism.primary.value).toBeNull();
  });

  it("a record whose quantity disagrees with its geometry is reported", () => {
    const q = computeComponent(rec({ id: "T-MM", componentType: "beam", geometry: box(1, 1, 1), quantity: 2 }));
    expect(q.primary.value).toBe(1);
    expect(q.primary.issues[0]!.code).toBe("RECORD_MISMATCH");
  });

  it("an unclassified componentType is 'other' with an UNCLASSIFIED issue", () => {
    const q = computeComponent(rec({ id: "T-X", componentType: "flux_capacitor", geometry: box(1, 1, 1), quantity: 1 }));
    expect(q.category).toBe("other");
    expect(q.primary.issues.map((i) => i.code)).toContain("UNCLASSIFIED");
  });
});

describe("units", () => {
  it("never mixes units in one sum (type-enforced)", () => {
    expect(addQty(qty(1, "m2"), qty(2, "m2")).value).toBe(3);
    // @ts-expect-error m2 + m3 does not compile
    addQty(qty(1, "m2"), qty(1, "m3"));
  });

  it("fixed decimals per unit", () => {
    expect(formatValue(1234.5678, "m3")).toBe("1,234.568");
    expect(formatValue(1234.5678, "m2")).toBe("1,234.57");
    expect(formatValue(1234.5678, "m")).toBe("1,234.57");
    expect(formatValue(1749.6, "kg")).toBe("1,750");
    expect(formatTonnes(1749.6)).toBe("1.75");
    expect(formatValue(null, "m3")).toBe("Not available");
    expect(csvValue(null)).toBe("");
    expect(csvValue(1234.5678912)).toBe("1234.567891");
  });
});

describe("aggregation", () => {
  const A = rec({ id: "T-A", componentType: "beam", geometry: box(1, 1, 1), quantity: 1, floor: 0 });
  const B = rec({ id: "T-B", componentType: "beam", geometry: box(2, 1, 1), quantity: 2, floor: 1 });
  const C = rec({ id: "T-C", componentType: "floor_tile", geometry: box(1, 0.01, 2), unit: "m2", quantity: 2, floor: 1, materialId: "tile_porcelain_floor" });
  const G = rec({ id: "T-G", componentType: "wall_assembly", geometry: { kind: "group", size: [1, 1, 1] }, unit: "nr", quantity: 1, floor: 1, assemblyType: "wall" });

  it("aggregates by floor and building; assemblies contribute nothing physical", () => {
    const inv = buildInventory([A, B, C, G]);
    expect(inv.rows).toHaveLength(3);
    expect(inv.assemblyCount).toBe(1);
    close(inv.breakdowns.floor.get("0")!.totals.m3!.value, 1);
    close(inv.breakdowns.floor.get("1")!.totals.m3!.value, 2 + 0.02);
    close(inv.totals.totals.m3!.value, 3.02);
    close(inv.totals.totals.m2!.value, 2);
    expect(inv.totals.totals.nr).toBeUndefined(); // the assembly's count of 1 is not summed
    expect(inv.totals.leafCount).toBe(3);
  });

  it("a duplicate id is excluded and reported", () => {
    const inv = buildInventory([A, { ...A, quantity: 99 }]);
    expect(inv.rows).toHaveLength(1);
    expect(inv.issues.some((i) => i.code === "DUPLICATE_ID" && i.componentId === "T-A")).toBe(true);
    close(inv.totals.totals.m3!.value, 1);
  });

  it("a total takes the worst member status and counts incomplete members", () => {
    const bad = rec({ id: "T-BAD", componentType: "beam", geometry: box(1, 0, 1), quantity: 0 });
    const inv = buildInventory([A, bad]);
    const m3 = inv.totals.totals.m3!;
    expect(m3.value).toBe(1); // the invalid one adds nothing...
    expect(m3.incompleteCount).toBe(1); // ...and is counted, not hidden
    expect(inv.totals.warningCount).toBe(1);
    const only = buildInventory([bad]);
    expect(only.totals.totals.m3).toMatchObject({ value: null, status: "unavailable" });
    expect(inv.totals.totals.kg!.status).toBe("estimated");
  });

  it("is memoised per records array", () => {
    const recs = [A, B];
    expect(buildInventory(recs)).toBe(buildInventory(recs));
  });
});

describe("product counts", () => {
  it("counts assemblies and single-part products, never the parts of an assembly", () => {
    const win = rec({ id: "W", componentType: "window_assembly", assemblyType: "window", geometry: { kind: "group", size: [1, 1, 1] }, unit: "nr", quantity: 1 });
    const parts = [1, 2, 3].map((i) => rec({ id: `W-${i}`, componentType: "window_sash", parentId: "W", geometry: box(1, 1, 0.05), unit: "nr", quantity: 1, materialId: "metal_frame" }));
    const pan = rec({ id: "P", componentType: "wc_pan", geometry: box(0.4, 0.4, 0.6), unit: "nr", quantity: 1, materialId: "sanitary_ceramic" });
    const bal = rec({ id: "B-1", componentType: "balcony_baluster", geometry: box(0.02, 1, 0.02), unit: "nr", quantity: 1, materialId: "metal_railing" });
    const c = countProducts([win, ...parts, pan, bal]);
    const get = (k: string) => c.find((x) => x.key === k)!;
    expect(get("windows").result.value).toBe(1);
    expect(get("wc").result.value).toBe(1);
    expect(get("balusters")).toMatchObject({ segments: true });
    expect(get("balusters").result.value).toBe(1);
    expect(get("doors").result.value).toBe(0);
  });
});

describe("wall takeoff (hand-checked: 5.0 m wall, 3.1 m high, 0.23 m thick, one door and one window)", () => {
  const T = 0.23;
  const H = 3.1;
  const W = "ARC-WALL-G-TEST";
  const stone = ARCH_CONFIG.openings.stoneSill.thickness; // 0.03
  const piece = (suffix: string, componentType: string, a0: number, a1: number, y0: number, y1: number) => {
    const v = (a1 - a0) * (y1 - y0) * T;
    return rec({ id: `${W}-${suffix}`, componentType, parentId: W, geometry: box(a1 - a0, y1 - y0, T), quantity: v, materialId: componentType === "wall_lintel" ? "lintel_rcc_ext" : "masonry_paint_ext", dimensions: { length: a1 - a0, height: y1 - y0, thickness: T } });
  };
  const wall = rec({ id: W, componentType: "wall_assembly", assemblyType: "wall", geometry: { kind: "group", size: [5, H, T] }, unit: "m2", quantity: 5 * H, dimensions: { length: 5, height: H, thickness: T } });
  // Door 1.0–1.9 (slab top 0 → head 2.1). Window 3.0–4.0, bottom 0.9, head 2.1, reveal 0.05 each side.
  const pieces = [
    piece("P01", "wall_pier", 0, 1.0, 0, H),
    piece("P02", "wall_pier", 1.9, 2.95, 0, H),
    piece("LN01", "wall_lintel", 1.0, 1.9, 2.1, 2.25),
    piece("AB01", "wall_above", 1.0, 1.9, 2.25, H),
    piece("SL02", "wall_sill", 2.95, 4.05, 0, 0.9 - stone),
    piece("RV03", "wall_reveal", 2.95, 3.0, 0.9 - stone, 2.1),
    piece("RV04", "wall_reveal", 4.0, 4.05, 0.9 - stone, 2.1),
    piece("LN02", "wall_lintel", 2.95, 4.05, 2.1, 2.25),
    piece("AB02", "wall_above", 2.95, 4.05, 2.25, H),
    piece("P03", "wall_pier", 4.05, 5, 0, H),
  ];
  const door = rec({ id: "ARC-DOOR-G-TEST-01", componentType: "door_assembly", assemblyType: "door", geometry: { kind: "group", size: [1, 2, 0.2] }, unit: "nr", quantity: 1, dependencies: [W, `${W}-LN01`] });
  const win = rec({ id: "ARC-WIN-G-TEST-01", componentType: "window_assembly", assemblyType: "window", geometry: { kind: "group", size: [1, 1, 0.2] }, unit: "nr", quantity: 1, dependencies: [W, `${W}-LN02`] });
  const build = {
    id: W,
    axis: "x",
    across: [0, T],
    y0: 0,
    y1: H,
    pieces: [],
    openings: [
      { kind: "door", key: "d", o0: 1.0, o1: 1.9, bottom: 0, head: 2.1, lintelId: `${W}-LN01` },
      { kind: "window", key: "w", o0: 3.0, o1: 4.0, bottom: 0.9, head: 2.1, lintelId: `${W}-LN02` },
    ],
  } as unknown as WallBuild;
  const model = { records: [], storeys: [{ plan: {}, walls: [build], clearances: [] }] } as unknown as ArchitectureModel;
  const records = [wall, ...pieces, door, win];

  it("net, lintel, voids and gross by hand", () => {
    const { walls, issues } = wallTakeoffs(records, model);
    expect(issues).toEqual([]);
    const w = walls[0]!;
    close(w.net.value, 12.08 * T); // piers 3.1+3.255, door-above 0.765, sill .957, reveals .123, window-above .935, P03 2.945
    close(w.lintel.value, 0.3 * T);
    close(w.voids.value, (0.9 * 2.1 + 1.0 * (2.1 - 0.9 + 0.03)) * T); // door + window (stone sill added)
    close(w.gross.value, 5 * H * T); // = the solid band, 3.565
    close(w.gross.value, w.net.value! + w.lintel.value! + w.voids.value!);
    expect(w.gross.status).toBe("calculated");
    close(w.grossFaceArea.value, 5 * H);
    close(w.netFaceArea.value, 12.08);
    expect(w.openings.map((o) => o.openingId).sort()).toEqual([door.id, win.id]);
  });

  it("an opening that cannot be linked gives UNLINKED_OPENING and an estimated gross", () => {
    const { walls } = wallTakeoffs([wall, ...pieces, door], model); // window assembly missing
    const w = walls[0]!;
    expect(w.gross.status).toBe("estimated");
    expect(w.issues.some((i) => i.code === "UNLINKED_OPENING")).toBe(true);
    close(w.gross.value, (12.08 + 0.3 + 0.9 * 2.1) * T);
  });

  it("each opening is deducted once even if two assemblies claim it", () => {
    const dup = { ...door, id: "ARC-DOOR-G-TEST-02" };
    const { walls, issues } = wallTakeoffs([wall, ...pieces, door, dup, win], model);
    expect(walls[0]!.openings.filter((o) => o.kind === "door")).toHaveLength(1);
    expect(issues.some((i) => i.code === "UNLINKED_OPENING" && i.componentId === dup.id)).toBe(true);
  });

  it("without the architecture model gross is unavailable (not 0), net is still calculated", () => {
    const w = wallTakeoffs(records).walls[0]!;
    expect(w.gross.value).toBeNull();
    close(w.net.value, 12.08 * T);
  });
});

describe("query helpers and CSV", () => {
  const recs = [
    rec({ id: "STR-COL-F01-A1", componentType: "column", geometry: box(0.45, 3.6, 0.45), quantity: 0.729, floor: 1, system: "structure" }),
    rec({ id: "ARC-TILE-F02-X", componentType: "floor_tile", geometry: box(0.6, 0.01, 0.4), unit: "m2", quantity: 0.24, floor: 2, materialId: "tile_porcelain_floor" }),
    rec({ id: "ARC-TILE-F02-Y", componentType: "floor_tile", geometry: box(0.3, 0.01, 0.3), unit: "m2", quantity: 0.09, floor: 2, materialId: "tile_antiskid" }),
    { ...rec({ id: 'ARC-FIX-G-"quoted", name', componentType: "wc_pan", geometry: box(0.4, 0.4, 0.6), unit: "nr", quantity: 1, materialId: "sanitary_ceramic" }), name: 'WC "pan", white\nsecond line' },
  ];
  const inv = buildInventory(recs);

  it("filters by floor, category, material, status and text (case-insensitive on id / name)", () => {
    expect(filterRows(inv.rows, { floor: 2 })).toHaveLength(2);
    expect(filterRows(inv.rows, { floor: 2, category: "tile_floor" })).toHaveLength(2);
    expect(filterRows(inv.rows, { material: "tile_antiskid" }).map((r) => r.rec.id)).toEqual(["ARC-TILE-F02-Y"]);
    expect(filterRows(inv.rows, { system: "structure" })).toHaveLength(1);
    expect(filterRows(inv.rows, { status: "calculated" })).toHaveLength(4);
    expect(filterRows(inv.rows, { status: "estimated" })).toHaveLength(0);
    expect(filterRows(inv.rows, { text: "str-col" })).toHaveLength(1);
    expect(filterRows(inv.rows, { text: "PAN" })).toHaveLength(1); // matches the name
    expect(filterRows(inv.rows, { componentTypes: ["column", "wc_pan"] })).toHaveLength(2);
  });

  it("sorts by any column, stably and deterministically", () => {
    const ids = (c: SortColumn, d: "asc" | "desc") => sortRows(inv.rows, c, d).map((r) => r.rec.id);
    expect(ids("id", "asc")).toEqual([...ids("id", "asc")].sort());
    expect(ids("quantity", "desc")).toEqual(["ARC-FIX-G-\"quoted\", name", "STR-COL-F01-A1", "ARC-TILE-F02-X", "ARC-TILE-F02-Y"]); // numeric, whatever the unit
    expect(ids("quantity", "asc")[0]).toBe("ARC-TILE-F02-Y");
    expect(ids("floor", "desc")[0]).toMatch(/F02/);
    for (const c of SORT_COLUMNS) expect(sortRows(inv.rows, c, "asc")).toHaveLength(4);
    expect(ids("unit", "asc")).toEqual(ids("unit", "asc"));
  });

  it("footer totals of a filtered set are per unit", () => {
    const t = totalOf(filterRows(inv.rows, { floor: 2 }));
    close(t.totals.m2!.value, 0.33);
    expect(t.totals.nr).toBeUndefined();
  });

  it("CSV: RFC 4180 quoting round-trips, one record per row, empty cell for unknown", () => {
    const csv = rowsToCsv(inv.rows);
    const table = parseCsv(csv);
    expect(table).toHaveLength(1 + inv.rows.length);
    expect(table[0]).toEqual([...CSV_COLUMNS]);
    expect(table.every((r) => r.length === CSV_COLUMNS.length)).toBe(true);
    const wc = table.find((r) => r[0]!.startsWith("ARC-FIX"))!;
    expect(wc[0]).toBe('ARC-FIX-G-"quoted", name');
    expect(wc[1]).toBe('WC "pan", white\nsecond line');
    expect(wc[CSV_COLUMNS.indexOf("mass_kg")]).toBe(""); // unavailable, not 0
    expect(wc[CSV_COLUMNS.indexOf("mass_status")]).toBe("unavailable");
    const col = table.find((r) => r[0] === "STR-COL-F01-A1")!;
    expect(col[CSV_COLUMNS.indexOf("quantity")]).toBe("0.729");
    expect(col[CSV_COLUMNS.indexOf("unit")]).toBe("m3");
    expect(col[CSV_COLUMNS.indexOf("floor")]).toBe("F01");
    expect(col[CSV_COLUMNS.indexOf("mass_kg")]).toBe("1749.6");
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("plain")).toBe("plain");
  });
});
