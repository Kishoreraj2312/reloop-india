/**
 * The selected component's outcome in the compared scenarios (B4), its B2 assessment, and its override in the scenario being
 * edited. Selection is the app's existing selection: this card follows it (the existing inspector shows the component's B1
 * quantity and its B2 assessment) and never selects anything itself.
 */

import { useMemo } from "react";
import { formatValue, getModelInventory, UNIT_LABEL } from "@/engine/quantities";
import { CLASSIFICATION_SHORT, targetLeafIds } from "@/engine/recovery";
import { categoryLabel, describeRule, evaluateLeaf, makeContext, materialCategoryOf, MISSING_LABELS, OUTCOME_ORDER, PATHWAY_SHORT, type Scenario } from "@/engine/scenarios";
import { PALETTE } from "../inventory/ui";
import { recoveryStore, useRecovery } from "../recovery/recoveryStore";
import { field, heading, linkBtn } from "../removal/ui";
import { RuleControls } from "./RuleControls";
import { scenarioStore, useScenarios } from "./scenarioStore";

const SOURCE: Record<string, string> = { component: "component override", assembly: "assembly override", category: "category rule", template: "template", none: "no rule" };

export function SelectedComponent({ selectedId }: { selectedId: string | null }) {
  const sc = useScenarios();
  const { assessments } = useRecovery();
  const inv = useMemo(() => getModelInventory(), []);
  const rec = selectedId ? inv.recordById.get(selectedId) : undefined;
  const active = sc.scenarios.find((s) => s.id === sc.activeId);
  const shown = useMemo(() => {
    const list = sc.compareIds.map((id) => sc.scenarios.find((s) => s.id === id)).filter((s): s is Scenario => s !== undefined);
    return active && !list.includes(active) ? [...list, active] : list;
  }, [sc.compareIds, sc.scenarios, active]);

  if (!rec) {
    return (
      <div data-testid="selected-hint" style={{ ...{ color: PALETTE.muted }, marginTop: 8 }}>
        <div style={heading}>SELECTED COMPONENT</div>
        Click a component in the 3D model: its outcome in each compared scenario appears here and the inspector shows its quantity and B2 assessment.
      </div>
    );
  }
  const isGroup = rec.geometry.kind === "group";
  const row = isGroup ? undefined : { rec, q: inv.byId.get(rec.id)! };
  const a = assessments.get(rec.id);
  const parts = isGroup ? targetLeafIds(inv, rec.id).length : 0;

  return (
    <div data-testid="selected-component" data-id={rec.id}>
      <div style={heading}>SELECTED COMPONENT</div>
      <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{rec.id}</div>
      <div style={{ color: PALETTE.muted }}>{rec.name}</div>
      {isGroup ? (
        <div style={{ margin: "4px 0" }}>Assembly of {parts.toLocaleString("en-US")} parts. Its parts are counted individually in every scenario; an override set here applies to every part that has no override of its own.</div>
      ) : (
        <>
          <div style={{ margin: "4px 0" }} data-testid="selected-b2">
            <span style={{ color: PALETTE.muted }}>B2 assessment: </span>
            <b>{CLASSIFICATION_SHORT[a?.classification ?? "unassessed"]}</b>
            {a?.recoveryPct != null ? ` · recovery ${a.recoveryPct}%` : a?.classification === "direct_reuse" || a?.classification === "refurbish_reuse" || a?.classification === "recycling" ? " · no recovery % set" : ""} ·{" "}
            <button type="button" style={linkBtn} onClick={() => (scenarioStore.setOpen(false), recoveryStore.setOpen(true))} data-testid="selected-open-b2">
              assess / edit in B2
            </button>
            <span style={{ color: PALETTE.muted }}> · material category: {categoryLabel(materialCategoryOf(rec.materialId))}</span>
          </div>
          {shown.length > 0 && (
            <table data-testid="selected-outcomes" style={{ borderCollapse: "collapse", width: "100%", background: "#fff", border: `1px solid ${PALETTE.line}` }}>
              <thead>
                <tr style={{ background: "#eceff1", fontSize: 10.5, textAlign: "left" }}>
                  <th style={{ padding: "2px 6px" }}>Scenario</th>
                  <th style={{ padding: "2px 6px" }}>Rule applied</th>
                  <th style={{ padding: "2px 6px" }}>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const o = evaluateLeaf(makeContext(inv, assessments, s), row!, sc.basis);
                  const e = o.decision.effective;
                  const res = o.decision.resolved;
                  return (
                    <tr key={s.id} data-scenario={s.id} style={{ borderTop: `1px solid ${PALETTE.line}`, fontSize: 11.5, verticalAlign: "top" }}>
                      <td style={{ padding: "2px 6px" }}>{s.name}</td>
                      <td style={{ padding: "2px 6px" }}>
                        {SOURCE[res.source]}
                        {res.viaId && res.source === "assembly" ? ` (${res.viaId})` : ""}: {describeRule(res.rule, s)}
                        {e.missing && <div style={{ color: PALETTE.warn, fontSize: 10.5 }}>{MISSING_LABELS[e.missing]}</div>}
                      </td>
                      <td style={{ padding: "2px 6px", fontVariantNumeric: "tabular-nums" }}>
                        {o.allocation ? (
                          <>
                            <div style={{ color: PALETTE.muted }}>
                              {formatValue(o.allocation.quantity, o.unit)} {UNIT_LABEL[o.unit]} →
                            </div>
                            {OUTCOME_ORDER.filter((p) => o.allocation!.outcome[p] > 0).map((p) => (
                              <div key={p} data-outcome={p}>
                                {PATHWAY_SHORT[p]}: {formatValue(o.allocation!.outcome[p], o.unit)} {UNIT_LABEL[o.unit]}
                              </div>
                            ))}
                            {o.allocation.quantity === 0 && <div>nothing to allocate</div>}
                          </>
                        ) : (
                          <span style={{ color: PALETTE.muted }}>no B1 {sc.basis === "mass" ? "mass" : "quantity"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      {active ? (
        <div style={{ marginTop: 8, padding: "6px 8px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }} data-testid="component-override">
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <b>Override {isGroup ? "the parts" : "this component"} in</b>
            <select data-testid="override-scenario" style={field} value={active.id} onChange={(e) => scenarioStore.select(e.target.value)}>
              {sc.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <RuleControls testid="override" rule={active.componentRules[rec.id] ?? null} followLabel="no override (category rule / template)" onChange={(r) => scenarioStore.setComponentRules([rec.id], r, active.id)} />
          <div style={{ color: PALETTE.muted, fontSize: 10.5, marginTop: 3 }}>The override is stored in the scenario only: the B1 quantity and the B2 assessment of the component are not changed.</div>
        </div>
      ) : (
        <div style={{ color: PALETTE.muted, marginTop: 6 }}>Create a scenario to set component overrides.</div>
      )}
    </div>
  );
}
