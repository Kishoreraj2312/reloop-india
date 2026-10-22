import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../config";
import { recordBounds, type ComponentRecord } from "../structure";
import { ARCH_CONFIG, archDatums } from "./config";
import { generateArchitectureModel } from "./generate";
import { floorBoundaries } from "./boundaries";
import { roomClearRects } from "./validatePlan";
import { arcHitsRect, swingArcs } from "./swing";
import { overlaps, type PlanRect } from "./rect";
import { floorTag } from "./record";

const cfg = DEFAULT_CONFIG;
const model = generateArchitectureModel(cfg);
const records = model.records;
const d = archDatums(cfg);
const plan2 = (r: ComponentRecord): PlanRect => {
  const b = recordBounds(r);
  return { x0: b.min[0], x1: b.max[0], z0: b.min[2], z1: b.max[2] };
};
const kidsOf = (id: string) => records.filter((r) => r.parentId === id);
const fixtureAssemblies = records.filter((r) => r.geometry.kind === "group" && ["kitchen", "bathroom", "utility_appliances"].includes(r.assemblyType!));

describe("kitchens", () => {
  const kitchens = model.storeys.flatMap((st) => st.plan.rooms.filter((r) => r.type === "kitchen").map((r) => `ARC-KIT-${floorTag(st.plan.storey)}-${r.id}`));

  it("every kitchen (29) has a kitchen assembly", () => {
    expect(kitchens).toHaveLength(29);
    for (const id of kitchens) expect(records.some((r) => r.id === id), id).toBe(true);
  });

  it.each([
    "kitchen_base_cabinet", "kitchen_door_front", "kitchen_drawer_front", "kitchen_countertop", "kitchen_sink", "kitchen_faucet",
    "kitchen_backsplash", "kitchen_fridge", "kitchen_hob", "kitchen_hood", "kitchen_wall_cabinet", "kitchen_plinth", "connection_point",
  ])("every kitchen has %s", (t) => {
    for (const id of kitchens) expect(kidsOf(id).some((r) => r.componentType === t), `${id} ${t}`).toBe(true);
  });

  it("worktops at FFL + 0.9; wall units 1.5 - 2.2 above FFL", () => {
    for (const r of records.filter((x) => x.componentType === "kitchen_countertop")) expect(recordBounds(r).max[1]).toBeCloseTo(d.ffl(r.floor) + ARCH_CONFIG.kitchen.counterTop, 9);
    for (const r of records.filter((x) => x.componentType === "kitchen_wall_cabinet")) {
      expect(recordBounds(r).min[1]).toBeCloseTo(d.ffl(r.floor) + ARCH_CONFIG.kitchen.wallUnit.bottom, 9);
      expect(recordBounds(r).max[1]).toBeCloseTo(d.ffl(r.floor) + ARCH_CONFIG.kitchen.wallUnit.top, 9);
    }
  });
});

describe("bathrooms and toilets", () => {
  const rooms = model.storeys.flatMap((st) => st.plan.rooms.filter((r) => r.type === "bathroom" || r.type === "toilet").map((r) => ({ id: `ARC-BATH-${floorTag(st.plan.storey)}-${r.id}`, type: r.type })));

  it("every wet room has its fittings: bathrooms shower + WC + basin + mirror; toilets WC + basin + floor drain", () => {
    expect(rooms).toHaveLength(79);
    for (const { id, type } of rooms) {
      const t = kidsOf(id).map((r) => r.componentType);
      expect(t, id).toContain("wc_pan");
      expect(t, id).toContain("wc_cistern");
      expect(t, id).toContain("basin");
      expect(t, id).toContain("mirror");
      expect(t, id).toContain("floor_drain");
      expect(t, id).toContain("connection_point");
      if (type === "bathroom") {
        for (const x of ["shower_tray", "shower_screen", "shower_head", "shower_mixer"]) expect(t, id).toContain(x);
      }
    }
  });

  it("utilities have a washing machine with connection points", () => {
    const util = records.filter((r) => r.componentType === "appliance_washer");
    expect(util.length).toBe(29);
  });
});

describe("fixture clearances (plan)", () => {
  it("every fitting lies inside its room's clear area", () => {
    const bad: string[] = [];
    for (const st of model.storeys) {
      const b = floorBoundaries(st.plan);
      for (const asm of fixtureAssemblies.filter((a) => a.floor === st.plan.storey)) {
        const room = st.plan.rooms.find((r) => r.id === asm.roomId)!;
        const clears = roomClearRects(room, b, cfg);
        for (const k of kidsOf(asm.id)) {
          const p = plan2(k);
          if (!clears.some((c) => p.x0 >= c.x0 - 1e-6 && p.x1 <= c.x1 + 1e-6 && p.z0 >= c.z0 - 1e-6 && p.z1 <= c.z1 + 1e-6)) bad.push(k.id);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("no fitting lies in the swing of any door opening into its room", () => {
    const bad: string[] = [];
    for (const st of model.storeys) {
      const b = floorBoundaries(st.plan);
      for (const asm of fixtureAssemblies.filter((a) => a.floor === st.plan.storey)) {
        const arcs = st.plan.doors.filter((x) => x.swingInto === asm.roomId).flatMap((x) => swingArcs(x, b, cfg));
        for (const k of kidsOf(asm.id)) if (arcs.some((a) => arcHitsRect(a, plan2(k)))) bad.push(k.id);
      }
    }
    expect(bad).toEqual([]);
  });

  it("WC front (0.6 m), basin front and shower entry zones are inside the room and free of other fittings", () => {
    const bad: string[] = [];
    let wc = 0;
    for (const st of model.storeys) {
      const b = floorBoundaries(st.plan);
      for (const c of st.clearances) {
        if (c.kind === "wc") {
          wc++;
          const depth = Math.min(c.rect.x1 - c.rect.x0, c.rect.z1 - c.rect.z0);
          if (Math.abs(depth - ARCH_CONFIG.bathroom.clearance) > 1e-9 && Math.abs(Math.max(c.rect.x1 - c.rect.x0, c.rect.z1 - c.rect.z0) - ARCH_CONFIG.bathroom.clearance) > 1e-9) bad.push(`${c.roomId} wc zone depth`);
        }
        const room = st.plan.rooms.find((r) => r.id === c.roomId)!;
        const clears = roomClearRects(room, b, cfg);
        if (!clears.some((k) => c.rect.x0 >= k.x0 - 1e-6 && c.rect.x1 <= k.x1 + 1e-6 && c.rect.z0 >= k.z0 - 1e-6 && c.rect.z1 <= k.z1 + 1e-6)) bad.push(`${c.roomId} ${c.kind} zone leaves the room`);
        const floorItems = records.filter((r) => r.roomId === c.roomId && r.floor === st.plan.storey && r.assembly === "fixtures" && r.geometry.kind !== "group" && recordBounds(r).min[1] < d.ffl(r.floor) + 1.0);
        for (const f of floorItems) if (f.componentType !== "floor_drain" && overlaps(plan2(f), c.rect)) bad.push(`${c.roomId} ${c.kind} zone blocked by ${f.id}`);
      }
    }
    expect(wc).toBe(79);
    expect(bad).toEqual([]);
  });
});
