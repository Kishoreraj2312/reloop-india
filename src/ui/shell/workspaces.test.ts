import { afterEach, describe, expect, it } from "vitest";
import { inventoryUi } from "@/scene/inventory/inventoryStore";
import { recoveryStore } from "@/scene/recovery/recoveryStore";
import { removalStore } from "@/scene/removal/removalStore";
import { scenarioStore } from "@/scene/scenarios/scenarioStore";
import { carbonStore } from "@/scene/carbon/carbonStore";
import { reuseStore } from "@/scene/reuse/reuseStore";
import { trackingStore } from "@/scene/tracking/trackingStore";
import { recycleUi } from "@/scene/recycle/recycleStore";
import { activeWorkspace, foldWorkspace, openWorkspace, toggleWorkspace } from "./workspaces";

afterEach(() => openWorkspace(null));

const openCount = () => [inventoryUi.get(), recoveryStore.get().open, removalStore.get().open, scenarioStore.get().open, carbonStore.get().open, reuseStore.get().open, recycleUi.get(), trackingStore.get().open].filter(Boolean).length;

describe("workspaces: one at a time", () => {
  it("starts with nothing open", () => {
    expect(activeWorkspace()).toEqual({ id: null, folded: false });
  });

  it("opening a workspace replaces the one showing", () => {
    toggleWorkspace("inventory");
    expect(activeWorkspace().id).toBe("inventory");
    toggleWorkspace("recovery");
    expect(activeWorkspace().id).toBe("recovery");
    expect(inventoryUi.get()).toBe(false);
    toggleWorkspace("scenarios");
    toggleWorkspace("reuse");
    expect(activeWorkspace().id).toBe("reuse");
    expect(openCount()).toBe(1);
  });

  it("the recycle guide takes part in the same rule", () => {
    toggleWorkspace("recycle");
    expect(activeWorkspace().id).toBe("recycle");
    expect(recycleUi.get()).toBe(true);
    toggleWorkspace("carbon");
    expect(activeWorkspace().id).toBe("carbon");
    expect(recycleUi.get()).toBe(false);
    expect(openCount()).toBe(1);
  });

  it("the tab that is showing closes it", () => {
    toggleWorkspace("tracking");
    toggleWorkspace("tracking");
    expect(activeWorkspace().id).toBeNull();
    expect(openCount()).toBe(0);
  });

  it("whatever opens a workspace, the one opened last stays (an inspector link, the passport)", () => {
    inventoryUi.set(true);
    recoveryStore.setOpen(true); // as the inspector's "assess recovery" link does
    expect(activeWorkspace().id).toBe("recovery");
    expect(inventoryUi.get()).toBe(false);
    removalStore.setOpen(true); // "plan removal"
    expect(activeWorkspace().id).toBe("removal");
    expect(recoveryStore.get().open).toBe(false);
    carbonStore.setOpen(true);
    expect(activeWorkspace().id).toBe("carbon");
    expect(openCount()).toBe(1);
  });

  it("closing the one showing never brings another back", () => {
    inventoryUi.set(true);
    recoveryStore.setOpen(true);
    recoveryStore.setOpen(false);
    expect(activeWorkspace().id).toBeNull();
  });

  it("a folded workspace is still the active one, and unfolding restores the dock", () => {
    openWorkspace("scenarios");
    foldWorkspace("scenarios", true);
    expect(activeWorkspace()).toEqual({ id: "scenarios", folded: true });
    foldWorkspace("scenarios", false);
    expect(activeWorkspace()).toEqual({ id: "scenarios", folded: false });
  });

  it("the model tab closes every workspace", () => {
    openWorkspace("carbon");
    openWorkspace(null);
    expect(openCount()).toBe(0);
  });
});
