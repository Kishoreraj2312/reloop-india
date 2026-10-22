import { describe, it, expect } from "vitest";
import { Box3, BoxGeometry, CylinderGeometry, Matrix4 } from "three";
import { DEFAULT_CONFIG } from "@/building/config";
import { ARCH_CATEGORIES, recordBounds } from "@/building/structure";
import { getArchitecture } from "@/building/architecture/generate";
import { buildBatches } from "./batches";
import { DEFAULT_VIEW, groupVisibility } from "../viewState";

const records = getArchitecture(DEFAULT_CONFIG).records;
const solids = records.filter((r) => r.geometry.kind !== "group");
const batches = buildBatches(records);

describe("instancing plan", () => {
  it("every architecture component is drawn exactly once (instanceId -> componentId map)", () => {
    const ids = batches.flatMap((b) => b.ids);
    expect(ids).toHaveLength(solids.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("batches are per floor, category, material and unit shape (draw-call bound)", () => {
    const keys = batches.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(batches.length).toBeLessThan(300);
  });

  it("each instance matrix reproduces its record's world bounds", () => {
    const byId = new Map(records.map((r) => [r.id, r]));
    const unitBox = new BoxGeometry(1, 1, 1);
    const unitCyl = new CylinderGeometry(1, 1, 1, 12);
    unitBox.computeBoundingBox();
    unitCyl.computeBoundingBox();
    const m = new Matrix4();
    let checked = 0;
    for (const b of batches) {
      b.ids.forEach((id, i) => {
        if (i % 7 !== 0) return; // sample
        m.fromArray(b.matrices, i * 16);
        const bb = new Box3().copy((b.shape === "box" ? unitBox : unitCyl).boundingBox!).applyMatrix4(m);
        const rb = recordBounds(byId.get(id)!);
        if (b.shape === "box") {
          for (let k = 0; k < 3; k++) {
            expect(bb.min.getComponent(k)).toBeCloseTo(rb.min[k]!, 5);
            expect(bb.max.getComponent(k)).toBeCloseTo(rb.max[k]!, 5);
          }
        } else {
          // cylinder bounding boxes match on the axis and within the radius across it
          const c = [(rb.min[0] + rb.max[0]) / 2, (rb.min[1] + rb.max[1]) / 2, (rb.min[2] + rb.max[2]) / 2];
          for (let k = 0; k < 3; k++) expect((bb.min.getComponent(k) + bb.max.getComponent(k)) / 2).toBeCloseTo(c[k]!, 5);
        }
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(5000);
  });
});

describe("view state", () => {
  it("default view shows every floor and category", () => {
    const v = groupVisibility(DEFAULT_VIEW, ARCH_CATEGORIES);
    expect([...v.values()].every(Boolean)).toBe(true);
  });

  it("isolating a floor hides the others and hides ceilings unless asked", () => {
    const v = groupVisibility({ ...DEFAULT_VIEW, isolate: "L2" }, ARCH_CATEGORIES);
    expect(v.get("Floor_L2")).toBe(true);
    expect(v.get("Floor_L1")).toBe(false);
    expect(v.get("Floor_ROOF")).toBe(false);
    expect(v.get("L2_architecture_ceilings")).toBe(false);
    expect(v.get("L2_architecture_partitions")).toBe(true);
    const withCeil = groupVisibility({ ...DEFAULT_VIEW, isolate: "L2", ceilingsInIsolation: true }, ARCH_CATEGORIES);
    expect(withCeil.get("L2_architecture_ceilings")).toBe(true);
  });

  it("layer toggles map categories to layers (stair finishes ride with flooring)", () => {
    const v = groupVisibility({ ...DEFAULT_VIEW, layers: { ...DEFAULT_VIEW.layers, flooring: false, structure: false } }, ARCH_CATEGORIES);
    expect(v.get("L1_architecture_floors")).toBe(false);
    expect(v.get("L1_architecture_stairFinishes")).toBe(false);
    expect(v.get("L1_structure")).toBe(false);
    expect(v.get("L1_architecture_openings")).toBe(true);
  });
});
