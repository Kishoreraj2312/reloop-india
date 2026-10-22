import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIG,
  validateConfig,
  gridPositions,
  levelElevations,
  GRID_LABELS_X,
  GRID_LABELS_Z,
  LEVEL_NAMES,
} from "./config";

describe("BuildingConfig validation", () => {
  it("default config passes validation", () => {
    const errors = validateConfig(DEFAULT_CONFIG);
    expect(errors).toEqual([]);
  });

  it("grid positions are centred and correctly spaced", () => {
    const xPos = gridPositions(36, 6, 7);
    expect(xPos).toEqual([-18, -12, -6, 0, 6, 12, 18]);

    const zPos = gridPositions(30, 6, 6);
    expect(zPos).toEqual([-15, -9, -3, 3, 9, 15]);
  });

  it("level elevations are correct", () => {
    const elevs = levelElevations(DEFAULT_CONFIG);
    expect(elevs.L0).toBe(0);
    expect(elevs.L1).toBe(3.6);
    expect(elevs.L2).toBeCloseTo(7.2);
    expect(elevs.L3).toBeCloseTo(10.8);
    expect(elevs.L4).toBeCloseTo(14.4);
    expect(elevs.ROOF).toBe(18.0);
  });

  it("grid label counts match config", () => {
    expect(GRID_LABELS_X.length).toBe(DEFAULT_CONFIG.gridCountX);
    expect(GRID_LABELS_Z.length).toBe(DEFAULT_CONFIG.gridCountZ);
  });

  it("LEVEL_NAMES has 6 entries (L0-L4 + ROOF)", () => {
    expect(LEVEL_NAMES.length).toBe(6);
  });

  it("detects grid span mismatch", () => {
    const bad = { ...DEFAULT_CONFIG, footprintX: 40 };
    const errors = validateConfig(bad);
    expect(errors.some((e) => e.field.includes("gridCountX"))).toBe(true);
  });

  it("detects stair-shaft overlap", () => {
    const bad = {
      ...DEFAULT_CONFIG,
      shaftBay: { ...DEFAULT_CONFIG.stairBay },
    };
    const errors = validateConfig(bad);
    expect(errors.some((e) => e.field.includes("stairBay"))).toBe(true);
  });

  it("detects bad stair arithmetic", () => {
    const bad = {
      ...DEFAULT_CONFIG,
      stair: { ...DEFAULT_CONFIG.stair, risersPerStorey: 20 },
    };
    const errors = validateConfig(bad);
    expect(errors.some((e) => e.field === "stair")).toBe(true);
  });
  it("detects an opening that reaches the bay beams", () => {
    const bad = { ...DEFAULT_CONFIG, shaftOpening: { width: 5.9, length: 1.5 } };
    expect(validateConfig(bad).some((e) => e.field === "shaftOpening")).toBe(true);
  });

  it("detects an opening that intersects column corners", () => {
    const bad = { ...DEFAULT_CONFIG, shaftOpening: { width: 5.6, length: 5.6 } };
    expect(validateConfig(bad).some((e) => e.message.includes("column corners"))).toBe(true);
  });

  it("detects a stair that does not fit its opening", () => {
    const bad = { ...DEFAULT_CONFIG, stairOpening: { width: 2.5, length: 5.4 } };
    expect(validateConfig(bad).some((e) => e.field === "stair")).toBe(true);
  });

  it("detects a foundation stack that does not reach y = 0", () => {
    const bad = { ...DEFAULT_CONFIG, pedestal: { ...DEFAULT_CONFIG.pedestal, height: 0.8 } };
    expect(validateConfig(bad).some((e) => e.field === "foundationDepth")).toBe(true);
  });
});
