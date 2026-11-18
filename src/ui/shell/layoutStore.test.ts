import { describe, expect, it } from "vitest";
import { LEFT_WIDTH, MIN_DOCK, MIN_VIEWPORT, NARROW_DOCK, RAIL_WIDTH, WIDE_DOCK, shellGeometry } from "./layoutStore";

describe("shellGeometry", () => {
  it("gives the model everything the sidebar leaves when no workspace is open", () => {
    const g = shellGeometry(1600, "auto", null, null);
    expect(g).toEqual({ leftFolded: false, leftWidth: LEFT_WIDTH, dockWidth: 0, viewportWidth: 1600 - LEFT_WIDTH });
  });

  it("docks a narrow workspace beside the open sidebar", () => {
    const g = shellGeometry(1600, "auto", NARROW_DOCK, null);
    expect(g.leftFolded).toBe(false);
    expect(g.dockWidth).toBe(NARROW_DOCK);
    expect(g.viewportWidth).toBe(1600 - LEFT_WIDTH - NARROW_DOCK);
  });

  it("folds the sidebar to its rail, not the dock, when a wide workspace would squeeze the model", () => {
    const g = shellGeometry(1600, "auto", WIDE_DOCK, null);
    expect(g.leftFolded).toBe(true);
    expect(g.leftWidth).toBe(RAIL_WIDTH);
    expect(g.dockWidth).toBe(WIDE_DOCK);
    expect(g.viewportWidth).toBe(1600 - RAIL_WIDTH - WIDE_DOCK);
  });

  it("keeps the sidebar when the wide workspace fits beside it", () => {
    const g = shellGeometry(1920, "auto", WIDE_DOCK, null);
    expect(g.leftFolded).toBe(false);
    expect(g.viewportWidth).toBe(1920 - LEFT_WIDTH - WIDE_DOCK);
  });

  it("respects the user's choice of mode", () => {
    expect(shellGeometry(1920, "closed", null, null).leftWidth).toBe(RAIL_WIDTH);
    // pinned open: the dock narrows instead (never below MIN_DOCK)
    const g = shellGeometry(1280, "open", WIDE_DOCK, null);
    expect(g.leftFolded).toBe(false);
    expect(g.dockWidth).toBe(MIN_DOCK);
  });

  it("the user's dock width wins over the default, within the room", () => {
    expect(shellGeometry(1920, "auto", NARROW_DOCK, 700).dockWidth).toBe(700);
    expect(shellGeometry(1920, "auto", NARROW_DOCK, 3000).dockWidth).toBe(1920 - LEFT_WIDTH - MIN_VIEWPORT);
    expect(shellGeometry(1920, "auto", NARROW_DOCK, 300).dockWidth).toBe(MIN_DOCK);
  });

  it("has no sidebar while presenting; a docked workspace still fits", () => {
    const none = shellGeometry(1600, "auto", null, null, false);
    expect(none).toMatchObject({ leftWidth: 0, dockWidth: 0, viewportWidth: 1600 });
    const docked = shellGeometry(1600, "auto", NARROW_DOCK, null, false);
    expect(docked).toMatchObject({ leftWidth: 0, dockWidth: NARROW_DOCK, viewportWidth: 1600 - NARROW_DOCK });
  });

  it("the three columns always add up to the window, and the model keeps its room whenever that is possible", () => {
    for (let w = 1100; w <= 2560; w += 37) {
      for (const mode of ["auto", "open", "closed"] as const) {
        for (const dock of [null, NARROW_DOCK, WIDE_DOCK]) {
          for (const user of [null, 640, 1100]) {
            const g = shellGeometry(w, mode, dock, user);
            expect(g.leftWidth + g.dockWidth + g.viewportWidth).toBe(w);
            expect(g.dockWidth >= 0 && g.viewportWidth > 0).toBe(true);
            if (dock !== null && w - g.leftWidth - MIN_DOCK >= MIN_VIEWPORT) expect(g.viewportWidth).toBeGreaterThanOrEqual(MIN_VIEWPORT);
          }
        }
      }
    }
  });
});
