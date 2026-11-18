/** Inspector line (B3): where the selected component stands in the active removal plan, and a way into the drawer. */

import { useEffect } from "react";
import { getModelGraph, STATE_LABELS } from "@/engine/removal";
import { PALETTE } from "../inventory/ui";
import { recoveryStore } from "../recovery/recoveryStore";
import { carbonStore } from "../carbon/carbonStore";
import { scenarioStore } from "../scenarios/scenarioStore";
import { analysisOf, removalStore, useRemoval } from "./removalStore";
import { linkBtn } from "./ui";

/** Builds the relationship graph when the browser is idle, so opening the removal drawer does not pay for it. */
export function usePrewarmRemoval(): void {
  useEffect(() => {
    const w = window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (n: number) => void };
    const h = w.requestIdleCallback ? w.requestIdleCallback(() => void getModelGraph(), { timeout: 6000 }) : window.setTimeout(() => void getModelGraph(), 3000);
    return () => (w.requestIdleCallback ? w.cancelIdleCallback?.(h) : window.clearTimeout(h));
  }, []);
}

export function RemovalInfo({ id }: { id: string }) {
  const rs = useRemoval();
  const plan = rs.plans.find((p) => p.id === rs.activeId);
  const a = plan && rs.open ? analysisOf(plan) : null; // analysed only while the drawer is open
  const idx = a?.owner.get(id);
  const entry = a && idx !== undefined ? a.entries[idx] : undefined;
  return (
    <div data-testid="removal-info" style={{ marginTop: 4 }}>
      <span style={{ opacity: 0.55 }}>removal: </span>
      {entry && plan ? (
        <>
          <span data-testid="removal-info-state">
            step {entry.index + 1} of {a!.entries.length} · {STATE_LABELS[entry.state]}
            {entry.blocked ? " · blocked" : ""}
          </span>{" "}
        </>
      ) : (
        <span style={{ color: PALETTE.muted }}>{plan && rs.open ? "not planned" : "removal plan"}</span>
      )}{" "}
      ·{" "}
      <button data-testid="open-removal" onClick={() => (recoveryStore.setOpen(false), scenarioStore.setOpen(false), carbonStore.setOpen(false), removalStore.setOpen(true))} style={linkBtn}>
        {plan ? "plan / simulate" : "plan removal"}
      </button>
    </div>
  );
}
