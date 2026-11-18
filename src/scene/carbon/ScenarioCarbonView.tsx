/**
 * Scenario comparison (B5): for the scenarios compared in B4, the potential net carbon benefit of the recovery pathways, term by
 * term, with what is missing. Quantities come from B4's allocation of B1 quantities (reused as is). A category whose inputs are
 * incomplete is shown "Not assessed" with the missing inputs; it is never counted as 0. Estimates are potential benefits under
 * the user's assumptions, not verified savings.
 */

import { useMemo, useState } from "react";
import { formatValue, UNIT_LABEL } from "@/engine/quantities";
import type { ScenarioCategory } from "@/engine/carbon";
import { PATHWAY_LABELS, OUTCOME_ORDER } from "@/engine/scenarios";
import { PALETTE } from "../inventory/ui";
import { useRecovery } from "../recovery/recoveryStore";
import { heading, linkBtn } from "../removal/ui";
import { Legend, StackedBar } from "../scenarios/Charts";
import { resultOf, scenarioStore, useScenarios } from "../scenarios/scenarioStore";
import { carbonStore, scenarioCarbon, sensitivityOf, useCarbon } from "./carbonStore";
import { fmtCarbon } from "./format";

const th = { textAlign: "right" as const, padding: "2px 5px", fontWeight: 600, fontSize: 10.5, verticalAlign: "bottom" as const };
const td = { textAlign: "right" as const, padding: "1px 5px", fontVariantNumeric: "tabular-nums" as const, fontSize: 11.5 };
const table = { borderCollapse: "collapse" as const, width: "100%", background: "#fff", border: `1px solid ${PALETTE.line}` };
const MUTED = { color: PALETTE.muted } as const;

const tonnes = (kg: number) => (kg / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 });
const recoveredOf = (c: ScenarioCategory) => c.recovered.direct + c.recovered.refurbish + c.recovered.recycling;

export function ScenarioCarbonView() {
  const sc = useScenarios();
  const { factors, assumptions } = useCarbon();
  const { assessments } = useRecovery();
  const scenarios = useMemo(() => sc.compareIds.map((id) => sc.scenarios.find((s) => s.id === id)).filter((s) => s !== undefined), [sc.compareIds, sc.scenarios]);
  const results = useMemo(() => scenarios.map((s) => scenarioCarbon(s)), [scenarios, factors, assumptions, assessments]);
  const [sensIdx, setSensIdx] = useState(0);

  if (scenarios.length === 0) {
    return (
      <div data-testid="carbon-scenarios-empty">
        <div style={heading}>SCENARIO COMPARISON</div>
        <div style={MUTED}>
          No scenarios are compared. Create and select scenarios in the Scenarios workspace (B4); this section then prices their pathways.{" "}
          <button type="button" style={linkBtn} onClick={() => scenarioStore.setOpen(true)}>
            open scenarios
          </button>
        </div>
      </div>
    );
  }
  const anyIllustrative = results.some((r) => r.usesIllustrative);
  const maxAbs = Math.max(1, ...results.map((r) => Math.abs(r.netKg)));
  // categories where any scenario recovers material
  const catKeys = [...new Set(results.flatMap((r) => r.categories.filter((c) => c.status !== "none_recovered").map((c) => c.category)))];
  const rows = catKeys
    .map((k) => ({ key: k, label: results[0]!.categories.find((c) => c.category === k)!.label, cells: results.map((r) => r.categories.find((c) => c.category === k)!) }))
    .sort((a, b) => (a.label < b.label ? -1 : 1));
  const sIdx = Math.min(sensIdx, scenarios.length - 1);
  const sens = sensitivityOf(scenarios[sIdx]!);
  const label = (n: string, what: string) => `${n}: ${what}`;

  return (
    <div data-testid="carbon-scenarios">
      <div style={heading}>SCENARIO COMPARISON · POTENTIAL NET CARBON BENEFIT</div>
      <div style={{ ...MUTED, fontSize: 11, marginBottom: 4 }}>
        Potential net benefit = avoided replacement − processing − transport of recovered material, in kgCO₂e, under your assumptions. Recovered quantities are B4's allocation of the B1 quantities. These are potential benefits, not verified savings.
      </div>
      {anyIllustrative && (
        <div data-testid="illustrative-warning" style={{ background: "#fdf6e3", border: "1px solid #e0c97a", borderRadius: 6, padding: "3px 8px", marginBottom: 4, fontSize: 11 }}>
          Illustrative placeholder factors contribute to these figures: they demonstrate the method only.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${scenarios.length}, minmax(0, 1fr))`, gap: 8 }}>
        {scenarios.map((s, i) => {
          const r = results[i]!;
          const partial = r.notAssessedCategories > 0;
          return (
            <div key={s.id} data-testid="carbon-card" data-assessed={r.assessedCategories} data-not-assessed={r.notAssessedCategories} style={{ padding: "6px 8px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }}>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              {r.assessedCategories > 0 ? (
                <div data-testid="carbon-net" style={{ fontSize: 18, fontWeight: 650 }}>
                  {fmtCarbon(r.netKg)}
                </div>
              ) : (
                <div data-testid="carbon-net" style={{ fontSize: 14, fontWeight: 600, color: PALETTE.muted }}>
                  {r.noneRecovered > 0 && r.notAssessedCategories === 0 ? "No material recovered" : "Not assessed"}
                </div>
              )}
              <div style={{ height: 8, display: "flex", margin: "3px 0" }} aria-hidden>
                <div style={{ width: `${(Math.abs(r.netKg) / maxAbs) * 100}%`, background: partial || r.usesIllustrative ? "repeating-linear-gradient(135deg,#1b7f8c 0 3px,#bfe0e4 3px 6px)" : "#1b7f8c", borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 10.5, ...MUTED }}>
                {r.assessedCategories} categories assessed
                {partial ? (r.assessedCategories > 0 ? ` · ${r.notAssessedCategories} not assessed (inputs missing): the figure is PARTIAL` : ` · ${r.notAssessedCategories} not assessed (inputs missing)`) : ""}
                {r.noneRecovered > 0 ? ` · ${r.noneRecovered} recover nothing` : ""}
              </div>
              {r.assessedCategories > 0 && (
                <div style={{ fontSize: 10.5 }}>
                  avoided {fmtCarbon(r.avoidedKg)} − processing & transport {fmtCarbon(r.costsKg)}
                </div>
              )}
              <div style={{ fontSize: 10.5, ...MUTED }}>haul to disposal (not netted): {fmtCarbon(r.disposalTransportKg)}</div>
            </div>
          );
        })}
      </div>

      <div style={{ fontWeight: 600, margin: "8px 0 3px" }}>By material category</div>
      {rows.length === 0 ? (
        <div style={MUTED}>No compared scenario recovers any material: nothing to price. (Recycling and disposal carry no automatic credit.)</div>
      ) : (
        <table data-testid="carbon-category-table" style={table}>
          <thead>
            <tr style={{ background: "#eceff1" }}>
              <th style={{ ...th, textAlign: "left" }}>Material category</th>
              {scenarios.map((s) => (
                <th key={s.id} style={{ ...th, textAlign: "left", borderLeft: `1px solid ${PALETTE.line}` }} colSpan={3}>
                  {s.name}
                  <div style={{ fontWeight: 400, ...MUTED }}>recovered · avoided · net</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-testid="carbon-category-row" data-category={r.key} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
                <td style={{ ...td, textAlign: "left" }}>
                  <button type="button" style={linkBtn} title="Mark this category in the 3D model" onClick={() => carbonStore.highlightCategory(r.key, `${r.label} · all components`, "all")}>
                    {r.label}
                  </button>
                </td>
                {r.cells.map((c, i) => (
                  <ScenarioCells key={scenarios[i]!.id} c={c} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ fontWeight: 600, margin: "8px 0 3px" }}>Missing inputs</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${scenarios.length}, minmax(0, 1fr))`, gap: 8 }}>
        {scenarios.map((s, i) => (
          <div key={s.id} data-testid="carbon-missing" style={{ padding: "4px 8px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }}>
            <div style={{ fontWeight: 600 }}>{s.name}</div>
            {results[i]!.missing.size === 0 ? (
              <div style={MUTED}>None for the categories that recover material.</div>
            ) : (
              <ul style={{ margin: "2px 0 0", paddingLeft: 14 }}>
                {[...results[i]!.missing].map(([m, n]) => (
                  <li key={m}>
                    {m} <span style={MUTED}>— blocks {n} {n === 1 ? "category" : "categories"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div style={heading}>MATERIAL PATHWAYS (ESTIMATED MASS, B4)</div>
      <div style={{ ...MUTED, fontSize: 10.5, marginBottom: 3 }}>Where the estimated mass of the components that have one ends up, from B4. Recovered mass is not avoided carbon.</div>
      <Legend />
      {scenarios.map((s) => {
        const t = resultOf(s).mass.totals.find((x) => x.unit === "kg");
        if (!t) return null;
        return (
          <div key={s.id} data-testid="pathway-row" style={{ display: "grid", gridTemplateColumns: "150px 1fr 280px", gap: 8, alignItems: "center", margin: "4px 0" }}>
            <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
            <StackedBar outcome={t.outcome} available={t.available} unit="kg" height={14} />
            <div style={{ fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>
              {OUTCOME_ORDER.filter((p) => t.outcome[p] > 0).map((p) => `${PATHWAY_LABELS[p]} ${tonnes(t.outcome[p])} t`).join(" · ") || "nothing allocated"}
              <div style={MUTED}>of {tonnes(t.available)} t · {UNIT_LABEL.kg} basis</div>
            </div>
          </div>
        );
      })}

      <div style={heading}>SENSITIVITY (±{Math.round(sens.scale * 100)} % ON EACH INPUT THAT IS SET)</div>
      {scenarios.length > 1 && (
        <select data-testid="sens-scenario" style={{ font: "inherit", fontSize: 12, marginBottom: 4 }} value={sIdx} onChange={(e) => setSensIdx(Number(e.target.value))}>
          {scenarios.map((s, i) => (
            <option key={s.id} value={i}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      {sens.rows.length === 0 ? (
        <div data-testid="sens-empty" style={MUTED}>
          Nothing to vary: {results[sIdx]!.assessedCategories === 0 ? "no category of this scenario has a complete net benefit yet. Provide the missing inputs above." : "no input is set."} Inputs that are not set are never perturbed.
        </div>
      ) : (
        <table data-testid="sens-table" style={table}>
          <thead>
            <tr style={{ background: "#eceff1" }}>
              <th style={{ ...th, textAlign: "left" }}>Input</th>
              <th style={th}>Value</th>
              <th style={th}>Net at −{Math.round(sens.scale * 100)} %</th>
              <th style={th}>Net at +{Math.round(sens.scale * 100)} %</th>
            </tr>
          </thead>
          <tbody>
            {sens.rows.slice(0, 12).map((r) => (
              <tr key={r.key} data-key={r.key} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
                <td style={{ ...td, textAlign: "left" }}>
                  {r.label} <span style={{ ...MUTED, fontSize: 10 }}>{r.kind === "factor" ? "factor" : "assumption"}</span>
                </td>
                <td style={td}>{r.value}</td>
                <td style={td}>{fmtCarbon(r.lowKg)}</td>
                <td style={td}>{fmtCarbon(r.highKg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ ...MUTED, fontSize: 10.5, marginTop: 3 }}>{label("Base", results[sIdx]!.assessedCategories > 0 ? fmtCarbon(sens.baseNetKg) : "Not assessed")} (assessed categories). This shows how the figure moves with your own inputs; it is not an uncertainty range.</div>
    </div>
  );
}

function ScenarioCells({ c }: { c: ScenarioCategory }) {
  const b = { ...td, borderLeft: `1px solid ${PALETTE.line}` };
  if (c.status === "none_recovered") {
    return (
      <>
        <td style={b}>–</td>
        <td style={td}>–</td>
        <td style={td}>–</td>
      </>
    );
  }
  const unit = c.basis ? UNIT_LABEL[c.basis] : "";
  return (
    <>
      <td style={b}>{c.basis ? `${formatValue(recoveredOf(c), c.basis)} ${unit}` : "–"}</td>
      <td style={td} data-field="avoided">
        {fmtCarbon(c.avoided)}
      </td>
      <td style={{ ...td, fontWeight: 600 }} data-field="net" data-status={c.status} title={c.missing.length ? `Missing: ${c.missing.join("; ")}` : undefined}>
        {c.status === "assessed" ? fmtCarbon(c.net) : <span style={{ color: PALETTE.warn }}>Not assessed</span>}
      </td>
    </>
  );
}
