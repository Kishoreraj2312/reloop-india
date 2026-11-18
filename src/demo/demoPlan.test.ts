import { describe, expect, it } from "vitest";
import { getModelInventory } from "@/engine/quantities";
import { applyPatch, serializeAssessments, type Assessments } from "@/engine/recovery";
import { DEMO_REQUIREMENTS, DEMO_TAG, demoAssessments, demoExtraRemovalPlans, demoPassports, demoRemovalEntries, demoTracked, rowsOf } from "./demoPlan";

const inv = getModelInventory();

describe("demo project (built from the real model)", () => {
  const groups = demoAssessments(inv);
  let a: Assessments = new Map();
  for (const g of groups) {
    const r = applyPatch(inv, a, g.ids, g.patch);
    a = r.map;
  }

  it("every B2 patch is valid, labelled as demo, and applies to leaf components only", () => {
    for (const g of groups) {
      const r = applyPatch(inv, new Map(), g.ids, g.patch);
      expect(r.error).toBeNull();
      expect(r.ignored).toEqual([]);
      expect(g.patch.note).toBe(DEMO_TAG);
    }
  });

  it("covers more than 90 % of the modelled mass (B4's whole-building threshold) and fits the browser storage budget", () => {
    const mass = (id: string) => inv.byId.get(id)?.mass.value ?? 0;
    const total = inv.rows.reduce((s, r) => s + mass(r.rec.id), 0);
    const covered = [...a.keys()].reduce((s, id) => s + mass(id), 0);
    expect(covered / total).toBeGreaterThan(0.9);
    expect(serializeAssessments(a).length).toBeLessThan(2.5e6);
  });

  it("the removal plan, passports, reuse requirements and tracked components all exist in the model", () => {
    expect(demoRemovalEntries(inv).length).toBeGreaterThan(20);
    for (const id of demoRemovalEntries(inv)) expect(inv.recordById.has(id)).toBe(true);
    const p = demoPassports(inv);
    expect(p.length).toBeGreaterThanOrEqual(10);
    expect(new Set(p.map((x) => x.id)).size).toBe(p.length); // one note per component
    for (const { meta } of p) expect(meta.provenanceNote).toMatch(/Demo/);
    const extra = demoExtraRemovalPlans(inv);
    expect(extra.length).toBe(2);
    for (const plan of extra) for (const id of plan.ids) expect(inv.recordById.has(id)).toBe(true);
    for (const r of DEMO_REQUIREMENTS) expect(rowsOf(inv, r.componentType, r.materialId).length).toBeGreaterThan(0);
    const t = demoTracked(inv);
    expect(t.reused.length).toBeGreaterThan(0);
    expect(t.recycled.length).toBeGreaterThan(0);
    expect(t.inProgress.length).toBeGreaterThan(0);
    for (const stage of [t.inspected, t.allocatable, t.planned, t.onHold]) expect(stage.length).toBeGreaterThan(0);
    // tracked components are assessed, so C3's plan comes from B2, and no component is in two stages
    const all = [...t.reused, ...t.recycled, ...t.inProgress, ...t.inspected, ...t.allocatable, ...t.planned, ...t.onHold];
    for (const id of all) expect(a.has(id)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});
