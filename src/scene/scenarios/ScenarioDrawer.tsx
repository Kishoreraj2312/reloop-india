/**
 * Demolition vs deconstruction scenario workspace (B4). Local to the controls panel: opening it never touches the scene until
 * a highlight is chosen. Quantities are B1's (memoised inventory), recovery assumptions start from B2's assessments, results
 * come from the scenario engine, and the scenarios themselves (assumptions only) live in the scenario store. Selection uses the
 * app's existing select handler, so the inspector and the B2 assessment open as everywhere else.
 */

import { useEffect, useMemo } from "react";
import { getModelInventory } from "@/engine/quantities";
import { assessedCategories } from "@/engine/scenarios";
import { PALETTE } from "../inventory/ui";
import { useRecovery } from "../recovery/recoveryStore";
import { StarterNotice } from "../recovery/StarterNotice";
import { CompareSection } from "./CompareSection";
import { ScenarioEditor } from "./ScenarioEditor";
import { ScenarioList } from "./ScenarioList";
import { scenarioStore, useScenarios } from "./scenarioStore";
import { SelectedComponent } from "./SelectedComponent";

export function ScenarioDrawer({ onClose, onSelect, selectedId }: { onClose: () => void; onSelect: (id: string | null) => void; selectedId: string | null }) {
  const sc = useScenarios();
  const { assessments } = useRecovery();
  const inv = useMemo(() => getModelInventory(), []);
  const assessed = useMemo(() => assessedCategories(inv, assessments), [inv, assessments]);
  const active = sc.scenarios.find((s) => s.id === sc.activeId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (sc.collapsed) {
    return (
      <div data-testid="scenario-collapsed" className="rm-panel" style={{ position: "fixed", left: "calc(var(--sh-left, 0px) + 12px)", bottom: 12, zIndex: 30, padding: "8px 10px", maxWidth: 420, display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="rm-heading" style={{ margin: 0 }}>Scenarios · 3D highlight</div>
        {sc.highlight ? (
          <div data-testid="collapsed-label" style={{ fontWeight: 600 }}>{sc.highlight.label}</div>
        ) : (
          <div style={{ color: PALETTE.muted }}>nothing highlighted</div>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" data-testid="scenario-expand" className="rm-btn accent" style={{ width: "auto", padding: "0 12px" }} onClick={() => scenarioStore.setCollapsed(false)}>
            Show workspace
          </button>
          {sc.highlight && (
            <button type="button" data-testid="collapsed-clear" className="rm-btn" style={{ width: "auto", padding: "0 12px" }} onClick={() => scenarioStore.setHighlight(null)}>
              Clear highlight
            </button>
          )}
          <button type="button" className="rm-btn" style={{ width: "auto", padding: "0 12px" }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="scenario-drawer" style={{ flex: "1 1 auto", minHeight: 0, width: "100%", display: "flex", flexDirection: "column", background: PALETTE.panel, color: PALETTE.text, font: "12.5px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif", fontVariantNumeric: "tabular-nums" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${PALETTE.line}`, background: "#fff" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Demolition vs deconstruction scenarios</div>
          <div style={{ fontSize: 11, color: PALETTE.muted }}>
            Planning comparison of end-of-life pathways on the B1 quantities and your B2 assessments. Estimates are only as good as the assumptions you enter; this is not a certified waste or recovery plan. No carbon, cost or landfill-impact figures (B5).
          </div>
        </div>
        <button type="button" data-testid="scenario-collapse" onClick={() => scenarioStore.setCollapsed(true)} title="Fold the workspace to see the whole model (the highlight stays on)" style={{ font: "inherit", fontSize: 12, padding: "2px 9px", border: `1px solid ${PALETTE.line}`, borderRadius: 6, background: "#fff", cursor: "pointer", color: PALETTE.text }}>
          View model
        </button>
        <button type="button" data-testid="scenario-close" onClick={onClose} title="Close (Esc)" style={{ font: "inherit", fontSize: 16, border: "none", background: "none", cursor: "pointer", color: PALETTE.muted }}>
          ✕
        </button>
      </div>
      <div data-testid="scenario-body" style={{ flex: 1, overflowY: "auto", padding: "0 14px 28px" }}>
        <StarterNotice />
        <ScenarioList />
        <CompareSection />
        <SelectedComponent selectedId={selectedId} />
        {active && <ScenarioEditor s={active} assessedCats={assessed} onSelect={onSelect} />}
        <div style={{ marginTop: 14, fontSize: 10.5, color: PALETTE.muted }}>
          Scenarios are saved in this browser only (they hold assumptions, never quantities or results). Editing a scenario never changes B1 quantities, B2 assessments or B3 plans.{" "}
          {sc.scenarios.length > 0 && (
            <button type="button" data-testid="scenario-clear-highlight" style={{ font: "inherit", fontSize: 10.5, background: "none", border: "none", color: PALETTE.accent, textDecoration: "underline", cursor: "pointer", padding: 0 }} onClick={() => scenarioStore.setHighlight(null)} disabled={!sc.highlight}>
              clear 3D highlight
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
