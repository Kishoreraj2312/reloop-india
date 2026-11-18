/**
 * The starter sample (B2) feeds the modules built on the recovery assessments (scenarios, carbon), so they say so wherever it is in use: one
 * muted line, nothing when no entry carries the starter note. The Recovery drawer has the full explanation and the controls.
 */

import { useMemo } from "react";
import { STARTER_NOTE } from "@/engine/recovery";
import { PALETTE } from "../inventory/ui";
import { recoveryStore, useRecovery } from "./recoveryStore";

/** How many components still carry the starter sample's note. */
export function useStarterCount(): number {
  const { assessments } = useRecovery();
  return useMemo(() => {
    let n = 0;
    for (const a of assessments.values()) if (a.note === STARTER_NOTE) n++;
    return n;
  }, [assessments]);
}

export function StarterNotice() {
  const n = useStarterCount();
  if (n === 0) return null;
  return (
    <div data-testid="starter-notice" data-count={n} style={{ margin: "10px 0 0", padding: "4px 8px", background: "#fff7e6", border: "1px solid #f0d49a", borderRadius: 6, fontSize: 11, color: PALETTE.muted }}>
      <b style={{ color: PALETTE.text }}>Starter sample in use.</b> The recovery assessments of {n.toLocaleString("en-US")} components are the illustrative starter sample, not an assessment of this building.{" "}
      <button type="button" data-testid="starter-notice-open" onClick={() => recoveryStore.setOpen(true)} style={{ font: "inherit", fontSize: 11, color: PALETTE.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
        Review or reset
      </button>
    </div>
  );
}
