/**
 * Edit the assumptions of one scenario (B4): the residual destination, the baseline, the selected material categories
 * (selective deconstruction), category-level rules and the component-level overrides. Every change goes through the engine's
 * validating edit operations; nothing here computes a quantity.
 */

import { useMemo } from "react";
import { getModelInventory } from "@/engine/quantities";
import { categoryLabel, materialCategoryOf, RESIDUAL_LABELS, RESIDUALS, describeRule, TEMPLATE_INFO, treatmentOf, type Residual, type Scenario } from "@/engine/scenarios";
import { PALETTE } from "../inventory/ui";
import { btn, field, heading, linkBtn } from "../removal/ui";
import { RuleControls } from "./RuleControls";
import { scenarioStore } from "./scenarioStore";
import { useRecovery } from "../recovery/recoveryStore";
import { substanceCountsOf } from "./summaryData";

const th = { textAlign: "left" as const, padding: "2px 6px", fontWeight: 600, fontSize: 10.5 };
const td = { padding: "2px 6px", fontSize: 11.5, verticalAlign: "top" as const };

export function ScenarioEditor({ s, assessedCats, onSelect }: { s: Scenario; assessedCats: readonly string[]; onSelect: (id: string | null) => void }) {
  const inv = useMemo(() => getModelInventory(), []);
  const { assessments } = useRecovery();
  const cats = useMemo(() => substanceCountsOf(inv, assessments), [inv, assessments]);
  const info = TEMPLATE_INFO[s.template];
  const usesBaseline = s.template !== "reuse_first";
  const selective = s.template === "selective";
  const compIds = Object.keys(s.componentRules).sort();

  return (
    <div data-testid="scenario-editor" data-id={s.id}>
      <div style={heading}>EDIT ASSUMPTIONS · {s.name.toUpperCase()}</div>
      <div style={{ marginBottom: 6 }}>
        <b>{info.label}.</b> <span style={{ color: PALETTE.muted }}>{info.summary}</span>
        <ul style={{ margin: "3px 0 0", paddingLeft: 16, color: PALETTE.muted, fontSize: 11 }} data-testid="template-assumptions">
          {info.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: "6px 10px", alignItems: "start" }}>
        <label htmlFor="sc-residual" style={{ color: PALETTE.muted, paddingTop: 3 }}>
          Unrecovered share goes to
        </label>
        <div>
          <select id="sc-residual" data-testid="scenario-residual" style={field} value={s.residual} onChange={(e) => scenarioStore.setResidual(e.target.value as Residual, s.id)}>
            {RESIDUALS.map((r) => (
              <option key={r} value={r}>
                {RESIDUAL_LABELS[r]}
              </option>
            ))}
          </select>
          <span style={{ color: PALETTE.muted, fontSize: 11, marginLeft: 6 }}>the part of a recovery pathway that is not recovered (100 − recovery %)</span>
        </div>
        {usesBaseline && (
          <>
            <div style={{ color: PALETTE.muted, paddingTop: 3 }}>{selective ? "Baseline outside the selection" : "Baseline for every component"}</div>
            <RuleControls testid="scenario-baseline" rule={s.baseline} allowAssessment={false} onChange={(r) => (r ? scenarioStore.setBaseline(r, s.id) : null)} />
          </>
        )}
      </div>

      <div style={heading}>MATERIAL CATEGORIES</div>
      <div style={{ fontSize: 10.5, color: PALETTE.muted, marginBottom: 3 }}>
        {selective ? "Tick the categories to deconstruct: their components follow their B2 assessments. " : ""}A category rule overrides the template for every component of that material; a component override (below) overrides the category rule.
        Leave “template” to keep the template's treatment.
      </div>
      <div style={{ maxHeight: 340, overflowY: "auto", border: `1px solid ${PALETTE.line}`, background: "#fff" }}>
        <table data-testid="category-rules" style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead style={{ position: "sticky", top: 0, background: "#eceff1", zIndex: 1 }}>
            <tr>
              <th style={th}>Material category</th>
              {selective && (
                <th style={{ ...th, width: 62 }} title="Apply the B2 assessments of this category's components">
                  Deconstruct
                </th>
              )}
              <th style={th}>Template gives</th>
              <th style={th}>Category rule</th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.key} data-category={c.key} style={{ borderTop: `1px solid ${PALETTE.line}`, background: s.categoryRules[c.key] ? "#fdf3ed" : "transparent" }}>
                <td style={td}>
                  {categoryLabel(c.key)}
                  <div style={{ color: PALETTE.muted, fontSize: 10 }}>
                    {c.components.toLocaleString("en-US")} components{c.assessed ? ` · ${c.assessed.toLocaleString("en-US")} assessed in B2` : ""}
                  </div>
                </td>
                {selective && (
                  <td style={{ ...td, textAlign: "center" }}>
                    <input
                      type="checkbox"
                      data-testid="scope-check"
                      checked={s.scope?.includes(c.key) ?? false}
                      onChange={(e) => scenarioStore.setScope(e.target.checked ? [...(s.scope ?? []), c.key] : (s.scope ?? []).filter((x) => x !== c.key), s.id)}
                    />
                  </td>
                )}
                <td style={{ ...td, color: PALETTE.muted, fontSize: 10.5 }}>{treatmentOf({ ...s, categoryRules: {} }, c.key)}</td>
                <td style={td}>
                  <RuleControls testid={`cat-${c.key}`} rule={s.categoryRules[c.key] ?? null} followLabel="template" onChange={(r) => scenarioStore.setCategoryRule(c.key, r, s.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selective && (s.scope?.length ?? 0) === 0 && (
        <div data-testid="scope-empty" style={{ color: PALETTE.warn, fontSize: 11, marginTop: 3 }}>
          No category is selected: nothing is deconstructed and every component follows the baseline.
          {assessedCats.length ? "" : " (No component has a B2 assessment yet; assess some in the Recovery drawer first.)"}
        </div>
      )}

      <div style={heading}>COMPONENT OVERRIDES ({compIds.length})</div>
      {compIds.length === 0 ? (
        <div style={{ color: PALETTE.muted, fontSize: 11 }}>None. Select a component in the 3D model (or an assembly) and set its override in “Selected component”.</div>
      ) : (
        <table data-testid="component-rules" style={{ borderCollapse: "collapse", width: "100%", background: "#fff", border: `1px solid ${PALETTE.line}` }}>
          <tbody>
            {compIds.slice(0, 50).map((id) => {
              const rec = inv.recordById.get(id);
              return (
                <tr key={id} data-id={id} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
                  <td style={td}>
                    {rec ? (
                      <button type="button" style={linkBtn} onClick={() => onSelect(id)} title="Select in the model">
                        {id}
                      </button>
                    ) : (
                      <span style={{ color: PALETTE.warn }} title="This id is not a component of the model; the override is kept but applies to nothing">
                        {id} (not in the model)
                      </span>
                    )}
                    {rec && <div style={{ color: PALETTE.muted, fontSize: 10 }}>{rec.name}{rec.geometry.kind === "group" ? " · assembly: applies to its parts" : ` · ${categoryLabel(materialCategoryOf(rec.materialId))}`}</div>}
                  </td>
                  <td style={td}>{describeRule(s.componentRules[id]!, s)}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button type="button" data-testid="component-rule-remove" style={btn} onClick={() => scenarioStore.setComponentRules([id], null, s.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {compIds.length > 50 && <div style={{ color: PALETTE.muted, fontSize: 11 }}>… and {compIds.length - 50} more.</div>}
    </div>
  );
}
