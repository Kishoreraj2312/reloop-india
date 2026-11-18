import { describe, expect, it } from "vitest";
import { getModelInventory } from "@/engine/quantities";
import { RECYCLE_GROUPS, groupTotals } from "./recycleGuide";

describe("recycle guide", () => {
  it("has six groups, each with a route, a few ways and a caution, and no category in two groups", () => {
    expect(RECYCLE_GROUPS.length).toBe(6);
    const cats = RECYCLE_GROUPS.flatMap((g) => g.categories);
    expect(new Set(cats).size).toBe(cats.length);
    for (const g of RECYCLE_GROUPS) {
      expect(g.route.length).toBeGreaterThan(5);
      expect(g.ways.length).toBeGreaterThanOrEqual(3);
      expect(g.watch.length).toBeGreaterThan(20);
    }
  });

  it("totals come from the real B1 inventory: concrete, masonry, metal and glass are all present in the model", () => {
    const t = groupTotals(getModelInventory());
    for (const id of ["concrete", "masonry", "metals", "glass"]) {
      const x = t.get(id)!;
      expect(x.components).toBeGreaterThan(0);
      expect(x.withMass).toBeGreaterThan(0);
      expect(x.tonnes).toBeGreaterThan(0);
    }
    // a tonnage is only offered where most of the group has a mass estimate (metalwork is mostly hollow sections with none)
    for (const id of ["concrete", "masonry"]) expect(t.get(id)!.massReliable).toBe(true);
    for (const x of t.values()) expect(x.massReliable).toBe(x.withMass >= x.components * 0.5);
    expect(t.size).toBe(RECYCLE_GROUPS.length);
  });
});
