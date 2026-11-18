/**
 * Assumptions (B5): every input here is the user's, starts unset, and is enabled only where the calculation method and its units
 * are defined (see the method line under each group). Source values (the factor library) are kept apart from these.
 */

import { useMemo } from "react";
import { RECOVERY_KEYS, RECOVERY_KEY_LABELS, factorUnitLabel, type RecoveryKey } from "@/engine/carbon";
import { UNIT_LABEL } from "@/engine/quantities";
import { categoryLabel } from "@/engine/scenarios";
import { PALETTE } from "../inventory/ui";
import { btn, heading } from "../removal/ui";
import { carbonStore, useCarbon } from "./carbonStore";
import { NumField } from "./NumField";

const th = { textAlign: "left" as const, padding: "2px 5px", fontWeight: 600, fontSize: 10.5 };
const td = { padding: "2px 5px", fontSize: 11.5, verticalAlign: "top" as const };
const note = { color: PALETTE.muted, fontSize: 10.5, marginTop: 2 } as const;

export function AssumptionsPanel() {
  const { factors, assumptions: a } = useCarbon();
  const cats = useMemo(() => [...factors.values()].filter((f) => f.value !== null).sort((x, y) => (x.category < y.category ? -1 : 1)), [factors]);
  return (
    <div data-testid="assumptions-panel">
      <div style={heading}>ASSUMPTIONS (USER-PROVIDED, NOT SOURCED)</div>
      <div style={{ color: PALETTE.muted, fontSize: 11, marginBottom: 6 }}>
        All of these start unset. A missing input makes the affected term <b>not assessed</b>; it is never read as 0. Enter 0 explicitly when a term really is zero (for example a 0 km haul).
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 3 }}>Replacement / substitution rate (% of the recovered quantity)</div>
          {RECOVERY_KEYS.map((k) => (
            <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 3 }}>
              <span style={{ width: 230 }}>{RECOVERY_KEY_LABELS[k]}</span>
              <NumField testid={`rate-${k}`} value={a.replacement[k]} width={60} max={100} onCommit={(v) => carbonStore.setReplacement(k, v)} />
              <span style={{ color: PALETTE.muted }}>%</span>
            </div>
          ))}
          <div style={note}>Share of recovered material that actually displaces new material, net of quality limits and mismatch. Avoided = recovered × rate × the category's emission factor (a like-for-like replacement is assumed). Recycling earns a credit only through its own rate; disposal earns none.</div>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 3 }}>Transport</div>
          {([
            ["recoveredKm", "Haul of recovered material (km)"],
            ["disposalKm", "Haul of disposed material (km)"],
            ["factorKgPerTonneKm", "Transport factor (kgCO₂e per tonne-km)"],
          ] as const).map(([f, label]) => (
            <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 3 }}>
              <span style={{ width: 230 }}>{label}</span>
              <NumField testid={`transport-${f}`} value={a.transport[f]} width={70} onCommit={(v) => carbonStore.setTransport(f, v)} />
            </div>
          ))}
          <div style={note}>Transport = moved mass [t] × distance × factor, on components that have a mass. The haul of disposed material is reported apart and not netted.</div>
        </div>
      </div>

      <div style={{ fontWeight: 600, margin: "8px 0 3px" }}>Per material category (only categories that have an emission factor)</div>
      {cats.length === 0 ? (
        <div style={{ color: PALETTE.muted }}>Enter an emission factor first.</div>
      ) : (
        <div style={{ maxHeight: 300, overflowY: "auto", border: `1px solid ${PALETTE.line}`, background: "#fff" }}>
          <table data-testid="category-assumptions" style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead style={{ position: "sticky", top: 0, background: "#eceff1" }}>
              <tr>
                <th style={th}>Category</th>
                <th style={th} title="kgCO₂e per unit of refurbished quantity">Refurbishment impact</th>
                <th style={th} title="kgCO₂e per unit of recycled quantity">Processing impact</th>
                <th style={th} title="Replaces B1's density when deriving mass from a modelled m³ volume">Density (kg/m³)</th>
                <th style={th}>Rates for this category (%)</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((f) => {
                const c = f.category;
                const ov = a.replacementByCategory[c] ?? {};
                return (
                  <tr key={c} data-category={c} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
                    <td style={td}>
                      {categoryLabel(c)}
                      <div style={{ color: PALETTE.muted, fontSize: 10 }}>per {UNIT_LABEL[f.basis]}</div>
                    </td>
                    <td style={td}>
                      <NumField testid={`refurb-${c}`} value={a.refurbishFactor[c] ?? null} width={66} onCommit={(v) => carbonStore.setCategoryValue("refurbishFactor", c, v)} title={factorUnitLabel(f.basis)} />
                    </td>
                    <td style={td}>
                      <NumField testid={`process-${c}`} value={a.processingFactor[c] ?? null} width={66} onCommit={(v) => carbonStore.setCategoryValue("processingFactor", c, v)} title={factorUnitLabel(f.basis)} />
                    </td>
                    <td style={td}>
                      <NumField testid={`density-${c}`} value={a.densityKgM3[c] ?? null} width={66} positive placeholder="B1" onCommit={(v) => carbonStore.setCategoryValue("densityKgM3", c, v)} title="Empty = B1's own density" />
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {(["direct", "refurbish", "recycling"] as RecoveryKey[]).map((k) => (
                        <span key={k} style={{ marginRight: 4 }} title={`${RECOVERY_KEY_LABELS[k]}: overrides the global rate`}>
                          <NumField testid={`rate-${c}-${k}`} value={ov[k] ?? null} width={44} max={100} placeholder={k === "direct" ? "reuse" : k === "refurbish" ? "refurb" : "recycl"} onCommit={(v) => carbonStore.setReplacement(k, v, c)} />
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" data-testid="assumptions-reset" style={{ ...btn, marginTop: 6 }} onClick={() => carbonStore.resetAssumptions()}>
        Clear all assumptions
      </button>
    </div>
  );
}
