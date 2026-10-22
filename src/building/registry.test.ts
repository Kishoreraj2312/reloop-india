import { describe, it, expect, beforeEach } from "vitest";
import { ComponentRegistry } from "./registry";
import type { BuildingComponent } from "./types";

function makeComponent(id: string, overrides?: Partial<BuildingComponent>): BuildingComponent {
  return {
    id,
    name: `Test ${id}`,
    system: "structure",
    componentType: "column",
    floor: 0,
    materialId: "concrete_m30",
    dimensions: { width: 0.45, height: 3.0, length: 0.45 },
    quantity: 0.608,
    unit: "m3",
    condition: "good",
    recoveryRoute: "recycle",
    confidence: "assumed",
    dependencies: [],
    originalPosition: [0, 0, 0],
    originalRotation: [0, 0, 0],
    ...overrides,
  };
}

describe("ComponentRegistry", () => {
  let reg: ComponentRegistry;

  beforeEach(() => {
    reg = new ComponentRegistry();
  });

  it("registers and retrieves a component", () => {
    const c = makeComponent("STR-COL-G-A1");
    reg.register(c);
    expect(reg.getById("STR-COL-G-A1")).toBe(c);
    expect(reg.size).toBe(1);
  });

  it("rejects duplicate IDs", () => {
    reg.register(makeComponent("STR-COL-G-A1"));
    expect(() => reg.register(makeComponent("STR-COL-G-A1"))).toThrow("Duplicate");
  });

  it("queries by floor and system", () => {
    reg.registerAll([
      makeComponent("STR-COL-G-A1", { floor: 0, system: "structure" }),
      makeComponent("STR-COL-F01-A1", { floor: 1, system: "structure" }),
      makeComponent("ARC-WALL-G-A1", { floor: 0, system: "architecture", componentType: "wall" }),
    ]);

    expect(reg.query({ floor: 0 })).toHaveLength(2);
    expect(reg.query({ system: "structure" })).toHaveLength(2);
    expect(reg.query({ floor: 0, system: "structure" })).toHaveLength(1);
  });

  it("links mesh UUID to component", () => {
    reg.register(makeComponent("STR-COL-G-A1"));
    reg.linkMesh("mesh-uuid-123", "STR-COL-G-A1");
    expect(reg.getIdByMesh("mesh-uuid-123")).toBe("STR-COL-G-A1");
  });

  it("rejects mesh link for unknown component", () => {
    expect(() => reg.linkMesh("uuid", "NONEXISTENT")).toThrow("unknown component");
  });

  it("returns children and parent", () => {
    reg.registerAll([
      makeComponent("STR-COL-G-A1"),
      makeComponent("STR-BM-F01-X-A1", { parentId: "STR-COL-G-A1" }),
    ]);
    expect(reg.getChildren("STR-COL-G-A1")).toHaveLength(1);
    expect(reg.getParent("STR-BM-F01-X-A1")?.id).toBe("STR-COL-G-A1");
  });

  it("unlinks a mesh", () => {
    reg.register(makeComponent("STR-COL-G-A1"));
    reg.linkMesh("m1", "STR-COL-G-A1");
    reg.unlinkMesh("m1");
    expect(reg.getIdByMesh("m1")).toBeUndefined();
  });
});
