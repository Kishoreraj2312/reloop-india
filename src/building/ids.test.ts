import { describe, it, expect } from "vitest";
import { buildComponentId, parseComponentId, isValidComponentId } from "./ids";
import type { ComponentIdParts } from "./ids";

describe("Component ID builder", () => {
  const cases: [ComponentIdParts, string][] = [
    [{ system: "structure", type: "FTG", floor: 0, location: "A1" }, "STR-FTG-G-A1"],
    [{ system: "structure", type: "COL", floor: 1, location: "A1" }, "STR-COL-F01-A1"],
    [{ system: "structure", type: "BM", floor: 2, location: "X-A1-B1" }, "STR-BM-F02-X-A1-B1"],
    [{ system: "structure", type: "SLAB", floor: 3, location: "P03" }, "STR-SLAB-F03-P03"],
    [{ system: "architecture", type: "WALL", floor: 0, location: "A1-B1" }, "ARC-WALL-G-A1-B1"],
    [{ system: "plumbing", type: "PIPE", floor: 4, location: "R01" }, "PLB-PIPE-F04-R01"],
    [{ system: "electrical", type: "DB", floor: 0, location: "M01" }, "ELC-DB-G-M01"],
  ];

  it.each(cases)("builds %j → %s", (parts, expected) => {
    expect(buildComponentId(parts)).toBe(expected);
  });

  it.each(cases)("round-trips %s", (parts, id) => {
    const parsed = parseComponentId(id);
    expect(parsed).toEqual(parts);
  });

  it("rejects malformed IDs", () => {
    expect(isValidComponentId("bad-id")).toBe(false);
    expect(isValidComponentId("STR-COL")).toBe(false);
    expect(isValidComponentId("XXX-COL-G-A1")).toBe(false);
    expect(isValidComponentId("")).toBe(false);
  });

  it("produces unique IDs for different inputs", () => {
    const ids = cases.map(([p]) => buildComponentId(p));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
