import { describe, expect, it } from "vitest";
import { getModelInventory } from "@/engine/quantities";
import { applyPatch, CLASSIFICATIONS, fillWithStarter, isOverStarter, parseAssessments, parseOverStarter, serializeAssessments, serializeOverStarter, starterAssessments, starterGroups, STARTER_NOTE } from "@/engine/recovery";

const inv = getModelInventory();

describe("starter sample (B2 defaults)", () => {
  const t0 = performance.now();
  const sample = starterAssessments(inv);
  const ms = performance.now() - t0;
  console.log(`starter: ${sample.size} entries, ${(serializeAssessments(sample).length / 1e6).toFixed(2)} MB, ${ms.toFixed(0)} ms`);

  it("every rule is valid and applies to leaf components only", () => {
    for (const g of starterGroups(inv)) {
      const r = applyPatch(inv, new Map(), g.ids, g.patch);
      expect(r.error).toBeNull();
      expect(r.ignored).toEqual([]);
      expect(r.applied).toBe(g.ids.length);
    }
  });

  it("every entry says it is a starter sample, and recovery % is only set where a recovery is expected", () => {
    for (const a of sample.values()) {
      expect(a.note).toBe(STARTER_NOTE);
      expect(a.classification).not.toBeNull();
      if (a.classification === "further_assessment" || a.classification === "insufficient_information") expect(a.recoveryPct).toBeNull();
      else expect(a.recoveryPct).toBeGreaterThan(0);
    }
  });

  it("covers more than 90 % of the modelled mass (B4's whole-building threshold) and fits the browser storage budget", () => {
    const mass = (id: string) => inv.byId.get(id)?.mass.value ?? 0;
    const total = inv.rows.reduce((s, r) => s + mass(r.rec.id), 0);
    const covered = [...sample.keys()].reduce((s, id) => s + mass(id), 0);
    expect(covered / total).toBeGreaterThan(0.9);
    expect(serializeAssessments(sample).length).toBeLessThan(3e6);
  });

  it("shows several classifications, so the colouring is not one flat colour", () => {
    const used = new Set([...sample.values()].map((a) => a.classification));
    expect(used.size).toBeGreaterThanOrEqual(4);
    for (const c of used) expect(CLASSIFICATIONS).toContain(c);
  });

  it("the finer material rules split what the category rules would colour alike", () => {
    const by = new Map(starterGroups(inv).map((g) => [g.label, g.patch.classification]));
    expect(by.get("masonry_paint_int")).toBe("refurbish_reuse");
    expect(by.get("masonry")).toBe("recycling"); // exterior and core walls stay recycling
    expect(by.get("concrete_balcony")).toBe("further_assessment");
    expect(by.get("concrete")).toBe("recycling");
  });

  it("round-trips through the persisted format", () => {
    expect(parseAssessments(serializeAssessments(sample)).map.size).toBe(sample.size);
  });

  it("fillWithStarter adds only components that have no entry and never touches an entered one", () => {
    const first = [...sample.keys()][0]!;
    const mine = applyPatch(inv, new Map(), [first], { classification: "direct_reuse", recoveryPct: 5, note: "mine" }).map;
    const { map, filled } = fillWithStarter(inv, mine);
    expect(map.get(first)).toEqual(mine.get(first));
    expect(filled).toBe(sample.size - 1);
    expect(map.size).toBe(sample.size);
    expect(fillWithStarter(inv, map).filled).toBe(0);
  });

  describe("saved as changes over the sample", () => {
    const ids = [...sample.keys()];
    const edited = applyPatch(inv, sample, [ids[0]!, ids[1]!], { classification: "direct_reuse", recoveryPct: 55, note: "mine" }).map;
    const edited2 = new Map(edited);
    edited2.delete(ids[2]!); // removed on purpose
    const extra = inv.rows.find((r) => !sample.has(r.rec.id))!.rec.id; // a component the sample leaves unassessed
    const mine = applyPatch(inv, edited2, [extra], { classification: "further_assessment", note: "surveyed" }).map;

    it("a pristine sample saves nothing but the mark, and reads back as the sample", () => {
      const text = serializeOverStarter(sample, sample);
      expect(text.length).toBeLessThan(200);
      expect(isOverStarter(text)).toBe(true);
      expect(parseOverStarter(text, sample)).toEqual(sample);
    });

    it("edits, removals and additions round-trip, and the save is tiny next to the sample", () => {
      const text = serializeOverStarter(mine, sample);
      expect(text.length).toBeLessThan(2000);
      expect(serializeAssessments(sample).length).toBeGreaterThan(1e6);
      const back = parseOverStarter(text, sample)!;
      expect(back.size).toBe(mine.size);
      expect(back.has(ids[2]!)).toBe(false);
      expect(back.get(ids[0]!)).toEqual(mine.get(ids[0]!));
      expect(back.get(extra)).toEqual(mine.get(extra));
      expect(back.get(ids[5]!)).toEqual(sample.get(ids[5]!)); // untouched entries come from the sample
    });

    it("only recognises its own format, and rejects damaged saves", () => {
      expect(isOverStarter(serializeAssessments(sample))).toBe(false);
      expect(parseOverStarter(serializeAssessments(sample), sample)).toBeNull();
      expect(parseOverStarter("not json", sample)).toBeNull();
      expect(parseOverStarter(JSON.stringify({ version: 1, base: "starter", entries: "x", removed: [] }), sample)).toBeNull();
      // an invalid entry is dropped, the rest still applies
      const odd = JSON.stringify({ version: 1, base: "starter", entries: [[ids[0], { classification: "nonsense" }], [extra, { classification: "recycling", recoveryPct: 40, note: "ok" }]], removed: [ids[1]] });
      const back = parseOverStarter(odd, sample)!;
      expect(back.get(ids[0]!)).toEqual(sample.get(ids[0]!));
      expect(back.get(extra)?.recoveryPct).toBe(40);
      expect(back.has(ids[1]!)).toBe(false);
    });
  });
});
