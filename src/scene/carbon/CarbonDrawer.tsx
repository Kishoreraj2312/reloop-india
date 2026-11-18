/**
 * Embodied-carbon workspace (B5). A decision-support estimate, NOT a certified whole-life carbon assessment. Quantities are B1's,
 * recovery allocation is B4's (from B2 assessments), factors and assumptions are the user's. The workspace shows what could be
 * assessed, what could not and why; a missing input is "Not assessed", never 0. Selecting a category marks its real components
 * in the existing 3D model (the B4 tint highlight).
 */

import { useEffect, useMemo } from "react";
import { CARBON_UNIT, REASON_LABELS } from "@/engine/carbon";
import { PALETTE } from "../inventory/ui";
import { btn, heading } from "../removal/ui";
import { scenarioStore, useScenarios } from "../scenarios/scenarioStore";
import { AssumptionsPanel } from "./AssumptionsPanel";
import { baselineNow, carbonStore, CARBON_COLOURS, useCarbon } from "./carbonStore";
import { FactorTable } from "./FactorTable";
import { fmtCarbon, fmtPct } from "./format";
import { ScenarioCarbonView } from "./ScenarioCarbonView";
import { useRecovery } from "../recovery/recoveryStore";
import { StarterNotice } from "../recovery/StarterNotice";

const MUTED = { color: PALETTE.muted } as const;

export function CarbonDrawer({ onClose }: { onClose: () => void }) {
  const cs = useCarbon();
  const sc = useScenarios();
  const { assessments } = useRecovery();
  const base = useMemo(() => baselineNow(), [cs.factors, cs.assumptions, assessments]);
  const ranked = base.rows.filter((r) => r.kgCO2e !== null);
  const unassessed = base.rows.filter((r) => r.status !== "assessed");
  const max = Math.max(1, ...ranked.map((r) => r.kgCO2e!));
  const hl = sc.highlight;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (cs.collapsed) {
    return (
      <div data-testid="carbon-collapsed" className="rm-panel" style={{ position: "fixed", left: "calc(var(--sh-left, 0px) + 12px)", bottom: 12, zIndex: 30, padding: "8px 10px", maxWidth: 420, display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="rm-heading" style={{ margin: 0 }}>Carbon · 3D highlight</div>
        {hl ? <div style={{ fontWeight: 600 }}>{hl.label}</div> : <div style={MUTED}>nothing highlighted</div>}
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" data-testid="carbon-expand" className="rm-btn accent" style={{ width: "auto", padding: "0 12px" }} onClick={() => carbonStore.setCollapsed(false)}>
            Show workspace
          </button>
          {hl && (
            <button type="button" className="rm-btn" style={{ width: "auto", padding: "0 12px" }} onClick={() => scenarioStore.setHighlight(null)}>
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

  const warnings: string[] = [];
  if (cs.factors.size === 0 || ranked.length === 0) warnings.push("No emission factor is set, so nothing is assessed. Enter factors with their sources below (or load the labelled illustrative demo set).");
  if (base.usesIllustrative) warnings.push("ILLUSTRATIVE placeholder factors contribute to these figures: they demonstrate the method and are not data.");
  if (base.mixedBoundaries) warnings.push(`Factors use different assessment boundaries (${[...base.byBoundary.keys()].join(" · ")}): totals are shown per boundary and must not be read as one lifecycle figure.`);
  if (ranked.length > 0) warnings.push("Reinforcing steel and structural steel are not modelled in B1: concrete is plain volume, so concrete carbon excludes reinforcement. Pipes, cables, fixtures and other components without a factor or a mass are outside the total.");

  return (
    <div data-testid="carbon-drawer" style={{ flex: "1 1 auto", minHeight: 0, width: "100%", display: "flex", flexDirection: "column", background: PALETTE.panel, color: PALETTE.text, font: "12.5px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif", fontVariantNumeric: "tabular-nums" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${PALETTE.line}`, background: "#fff" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Embodied carbon & environmental impact</div>
          <div style={{ fontSize: 11, color: PALETTE.muted }}>
            Decision-support prototype, not a certified whole-life carbon assessment. Results are only as good as the factors and assumptions you enter, cover the lifecycle modules those factors state, and cannot reconstruct the building's historical emissions.
          </div>
        </div>
        <button type="button" data-testid="carbon-collapse" onClick={() => carbonStore.setCollapsed(true)} title="Fold the workspace to see the whole model (the highlight stays on)" style={{ font: "inherit", fontSize: 12, padding: "2px 9px", border: `1px solid ${PALETTE.line}`, borderRadius: 6, background: "#fff", cursor: "pointer" }}>
          View model
        </button>
        <button type="button" data-testid="carbon-close" onClick={onClose} title="Close (Esc)" style={{ font: "inherit", fontSize: 16, border: "none", background: "none", cursor: "pointer", color: PALETTE.muted }}>
          ✕
        </button>
      </div>
      <div data-testid="carbon-body" style={{ flex: 1, overflowY: "auto", padding: "0 14px 28px" }}>
        <StarterNotice />
        {base.usesIllustrative && (
          <div data-testid="illustrative-banner" style={{ background: "#fdf6e3", border: "1px solid #e0c97a", borderRadius: 6, padding: "4px 8px", margin: "10px 0 0", fontWeight: 600 }}>
            ILLUSTRATIVE PLACEHOLDER FACTORS IN USE — not sourced data; for demonstration only.
          </div>
        )}

        {/* overview */}
        <div style={heading}>BASELINE · EMBODIED CARBON OF THE EXISTING MATERIAL</div>
        <div data-testid="carbon-overview" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 8 }}>
          <div style={{ padding: "6px 8px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }}>
            <div style={MUTED}>Assessed embodied carbon</div>
            {ranked.length > 0 ? (
              <>
                <div data-testid="carbon-total" data-kg={base.totalKg} style={{ fontSize: 22, fontWeight: 650 }}>
                  {fmtCarbon(base.totalKg)}
                </div>
                <div style={{ fontSize: 10.5, ...MUTED }}>
                  boundary: {[...base.byBoundary.entries()].map(([b, v]) => `${b} (${fmtCarbon(v)})`).join(" · ")}. Product-stage figures are not a whole-life result.
                </div>
              </>
            ) : (
              <div data-testid="carbon-total" data-kg="" style={{ fontSize: 16, fontWeight: 600, color: PALETTE.muted }}>
                Not assessed
              </div>
            )}
          </div>
          <div style={{ padding: "6px 8px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }}>
            <div style={MUTED}>Data coverage</div>
            <div data-testid="carbon-coverage" style={{ fontWeight: 600 }}>
              {base.coverage.assessed.toLocaleString("en-US")} of {base.coverage.components.toLocaleString("en-US")} components ({fmtPct(base.coverage.componentPct)})
            </div>
            <div style={{ fontSize: 10.5, ...MUTED }}>estimated mass assessed: {fmtPct(base.coverage.massPct)} of the mass of components that have one</div>
          </div>
          <div style={{ padding: "6px 8px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }}>
            <div style={MUTED}>Largest contributors</div>
            {ranked.slice(0, 3).map((r) => (
              <div key={r.category} style={{ fontSize: 11.5 }}>
                {r.label} <b>{fmtPct(r.share)}</b>
              </div>
            ))}
            {ranked.length === 0 && <div style={MUTED}>none assessed</div>}
          </div>
        </div>
        <ul data-testid="carbon-warnings" style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 11, color: PALETTE.warn }}>
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>

        <FactorTable />

        {/* breakdown */}
        <div style={heading}>MATERIAL BREAKDOWN · {CARBON_UNIT} (ASSESSED ONLY)</div>
        {ranked.length === 0 ? (
          <div style={MUTED}>Nothing assessed yet.</div>
        ) : (
          <div data-testid="carbon-breakdown">
            {ranked.map((r) => {
              const ill = r.factor?.origin === "illustrative";
              return (
                <div key={r.category} data-testid="carbon-bar-row" data-category={r.category} data-kg={r.kgCO2e!} onClick={() => carbonStore.highlightCategory(r.category, `${r.label} · assessed (${fmtCarbon(r.kgCO2e)})`, true)} title="Mark this category's assessed components in the 3D model" style={{ display: "grid", gridTemplateColumns: "150px 1fr 130px", gap: 8, alignItems: "center", margin: "2px 0", cursor: "pointer" }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.label}
                    {r.status === "partial" && <span title="Some components of this category could not be assessed" style={{ color: PALETTE.warn }}> ◐</span>}
                  </div>
                  <div style={{ height: 14, display: "flex" }}>
                    <div style={{ width: `${(r.kgCO2e! / max) * 100}%`, minWidth: 2, background: ill ? "repeating-linear-gradient(135deg,#1b7f8c 0 3px,#bfe0e4 3px 6px)" : "#1b7f8c", borderRadius: 4 }} />
                  </div>
                  <div style={{ fontSize: 11 }}>
                    <b>{fmtCarbon(r.kgCO2e)}</b> <span style={MUTED}>{fmtPct(r.share)}</span>
                  </div>
                </div>
              );
            })}
            <div style={{ ...MUTED, fontSize: 10.5, marginTop: 3 }}>Solid bars: user-entered factors. Hatched bars: illustrative placeholder factors. ◐ = only part of the category's components could be assessed. Bars are shares of kgCO₂e, not of mass.</div>
          </div>
        )}

        <div style={heading}>NOT ASSESSED</div>
        <div data-testid="carbon-unassessed">
          <div style={{ marginBottom: 3 }}>
            <button type="button" data-testid="highlight-unassessed" style={btn} onClick={() => carbonStore.highlightUnassessed("All components not assessed")}>
              Mark every unassessed component in 3D
            </button>{" "}
            <span style={{ ...MUTED, fontSize: 11 }}>{(base.coverage.components - base.coverage.assessed).toLocaleString("en-US")} components</span>
          </div>
          {unassessed.slice(0, 40).map((r) => {
            const n = r.components - r.assessed;
            const reasons = (Object.keys(r.unassessed) as (keyof typeof r.unassessed)[]).filter((k) => r.unassessed[k] > 0).map((k) => `${r.unassessed[k].toLocaleString("en-US")} ${REASON_LABELS[k]}`);
            return (
              <div key={r.category} data-testid="unassessed-row" data-category={r.category} style={{ fontSize: 11.5, cursor: "pointer", padding: "1px 0" }} title="Mark these components in the 3D model (grey)" onClick={() => carbonStore.highlightCategory(r.category, `${r.label} · not assessed`, false)}>
                <span style={{ display: "inline-block", width: 9, height: 9, background: `#${CARBON_COLOURS.unassessed.toString(16)}`, borderRadius: 2, marginRight: 6 }} />
                {r.label}: {n.toLocaleString("en-US")} components — <span style={MUTED}>{reasons.join("; ")}</span>
              </div>
            );
          })}
        </div>

        <ScenarioCarbonView />
        <AssumptionsPanel />

        {hl && (
          <div data-testid="carbon-highlight" style={{ marginTop: 10, padding: "4px 8px", background: "#eef1f3", borderRadius: 6, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={MUTED}>3D highlight</span> <b>{hl.label}</b> <span style={MUTED}>{(hl.matches?.length ?? 0).toLocaleString("en-US")} components</span>
            <button type="button" data-testid="carbon-highlight-clear" style={btn} onClick={() => scenarioStore.setHighlight(null)}>
              Clear
            </button>
          </div>
        )}
        <div style={{ marginTop: 14, fontSize: 10.5, ...MUTED }}>
          Method: carbon = quantity × emission factor, for components that have a quantity in the factor's unit; mass is B1's density × solid volume (or your density override). Factors, assumptions and units are shown with every result; nothing here is produced by AI. Saved in this browser only. B1 quantities, B2 assessments, B3 plans and B4 scenarios are read, never changed.
        </div>
      </div>
    </div>
  );
}
