/**
 * The emission-factor library (B5): one row per material category of the model (plus slots for material the model does not
 * contain). The library starts empty, so every category reads "not assessed" until a factor is entered. A factor carries its
 * unit, value, origin, quality, source, reference, geography and assessment boundary; a "sourced" or "measured" value must
 * name its source. Edits are validated by the engine.
 */

import { useMemo, useState } from "react";
import { categoryBases, factorUnitLabel, NOT_IN_MODEL_SLOTS, ORIGINS, ORIGIN_LABELS, QUALITIES, UNITS, type EmissionFactor, type Origin, type Quality } from "@/engine/carbon";
import { getModelInventory, UNIT_LABEL, type Unit } from "@/engine/quantities";
import { categoryLabel } from "@/engine/scenarios";
import { PALETTE } from "../inventory/ui";
import { btn, field, heading, linkBtn } from "../removal/ui";
import { baselineNow, carbonStore, useCarbon } from "./carbonStore";
import { NumField } from "./NumField";

const th = { textAlign: "left" as const, padding: "2px 5px", fontWeight: 600, fontSize: 10.5 };
const td = { padding: "2px 5px", fontSize: 11.5, verticalAlign: "top" as const };

function Text({ value, onCommit, width, testid, placeholder }: { value: string; onCommit: (v: string) => string | null; width: number | string; testid: string; placeholder?: string }) {
  const [t, setT] = useState(value);
  const [e, setE] = useState<string | null>(null);
  return (
    <span>
      <input data-testid={testid} style={{ ...field, width, boxSizing: "border-box", borderColor: e ? PALETTE.warn : PALETTE.line }} value={t} placeholder={placeholder} onChange={(x) => setT(x.target.value)} onBlur={() => t !== value && setE(onCommit(t))} onKeyDown={(x) => x.key === "Enter" && t !== value && setE(onCommit(t))} />
      {e && <div style={{ color: PALETTE.warn, fontSize: 10.5 }}>{e}</div>}
    </span>
  );
}

export function FactorTable() {
  const { factors } = useCarbon();
  const inv = useMemo(() => getModelInventory(), []);
  const bases = useMemo(() => categoryBases(inv), [inv]);
  const base = baselineNow();
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const status = new Map(base.rows.map((r) => [r.category, r]));
  const set = (cat: string, patch: Partial<EmissionFactor>) => {
    const e = carbonStore.editFactor(cat, patch);
    setMsg(e);
    return e;
  };

  return (
    <div data-testid="factor-section">
      <div style={heading}>EMISSION FACTORS (YOURS)</div>
      <div style={{ color: PALETTE.muted, fontSize: 11, marginBottom: 4 }}>
        No emission factors ship with the application: every category is <b>not assessed</b> until you enter one with its source and assessment boundary (for example the module range of an EPD or database entry). A value is kgCO₂e per ONE unit of the chosen basis; mass-based factors use B1's estimated mass (density × solid volume).
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
        <button type="button" data-testid="factors-illustrative" style={btn} onClick={() => carbonStore.loadIllustrative()} title="Adds clearly labelled placeholder values for nine categories that have a mass. For demonstration only.">
          Load illustrative demo factors
        </button>
        <button type="button" data-testid="factors-clear" style={btn} disabled={factors.size === 0} onClick={() => carbonStore.clearAllFactors()}>
          Clear all factors
        </button>
        <span style={{ color: PALETTE.muted, fontSize: 11 }}>{[...factors.values()].filter((f) => f.value !== null).length} categories have a factor value.</span>
        {msg && (
          <span data-testid="factor-message" style={{ color: PALETTE.warn, fontSize: 11 }}>
            {msg}
          </span>
        )}
      </div>
      <div style={{ maxHeight: 420, overflowY: "auto", border: `1px solid ${PALETTE.line}`, background: "#fff" }}>
        <table data-testid="factor-table" style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead style={{ position: "sticky", top: 0, background: "#eceff1", zIndex: 1 }}>
            <tr>
              <th style={th}>Material category</th>
              <th style={th}>Per</th>
              <th style={th}>Factor</th>
              <th style={th}>Origin</th>
              <th style={th}>Quality</th>
              <th style={th}>In this model</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {bases.map((c) => {
              const f = factors.get(c.category);
              const r = status.get(c.category);
              const units = UNITS.filter((u) => c.units.has(u) || f?.basis === u);
              return (
                <FactorRows key={c.category} category={c.category} label={categoryLabel(c.category)} sub={`${c.components.toLocaleString("en-US")} components`} f={f} suggested={c.suggested} units={units} unitCount={c.units} status={r ? `${r.assessed.toLocaleString("en-US")} of ${r.components.toLocaleString("en-US")} assessed` : ""} assessed={r?.assessed ?? 0} open={open === c.category} onOpen={() => setOpen(open === c.category ? null : c.category)} set={set} />
              );
            })}
            {NOT_IN_MODEL_SLOTS.map((s) => (
              <FactorRows key={s.key} category={s.key} label={s.label} sub={`not in the model: ${s.reason}`} f={factors.get(s.key)} suggested="kg" units={["kg"]} unitCount={new Map()} status="no quantity in B1" assessed={0} open={open === s.key} onOpen={() => setOpen(open === s.key ? null : s.key)} set={set} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FactorRows({ category, label, sub, f, suggested, units, unitCount, status, assessed, open, onOpen, set }: { category: string; label: string; sub: string; f: EmissionFactor | undefined; suggested: Unit; units: readonly Unit[]; unitCount: ReadonlyMap<Unit, number>; status: string; assessed: number; open: boolean; onOpen: () => void; set: (cat: string, p: Partial<EmissionFactor>) => string | null }) {
  const basis = f?.basis ?? suggested;
  const illustrative = f?.origin === "illustrative" && f.value !== null;
  return (
    <>
      <tr data-testid="factor-row" data-category={category} data-assessed={assessed} style={{ borderTop: `1px solid ${PALETTE.line}`, background: illustrative ? "#fdf6e3" : "transparent" }}>
        <td style={td}>
          {label}
          <div style={{ color: PALETTE.muted, fontSize: 10 }}>{sub}</div>
        </td>
        <td style={td}>
          <select data-testid="factor-basis" style={{ ...field, width: 84 }} value={basis} onChange={(e) => set(category, { basis: e.target.value as Unit })} title="The unit the factor is per. Only units in which the model has a quantity can assess components.">
            {units.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u]}
                {unitCount.get(u) ? ` (${unitCount.get(u)})` : ""}
              </option>
            ))}
          </select>
        </td>
        <td style={td}>
          <NumField testid="factor-value" value={f?.value ?? null} width={78} onCommit={(v) => set(category, { value: v })} title={`kgCO₂e per ${UNIT_LABEL[basis]}`} />
          <span style={{ color: PALETTE.muted, fontSize: 10, marginLeft: 3 }}>{factorUnitLabel(basis)}</span>
        </td>
        <td style={td}>
          <select data-testid="factor-origin" style={{ ...field, width: 112 }} value={f?.origin ?? "assumed"} disabled={!f || f.value === null} onChange={(e) => set(category, { origin: e.target.value as Origin })}>
            {ORIGINS.filter((o) => o !== "illustrative" || f?.origin === "illustrative").map((o) => (
              <option key={o} value={o}>
                {ORIGIN_LABELS[o]}
              </option>
            ))}
          </select>
        </td>
        <td style={td}>
          <select data-testid="factor-quality" style={{ ...field, width: 78 }} value={f?.quality ?? "unrated"} disabled={!f} onChange={(e) => set(category, { quality: e.target.value as Quality })}>
            {QUALITIES.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </td>
        <td style={{ ...td, fontSize: 10.5, color: f?.value == null ? PALETTE.warn : assessed ? PALETTE.text : PALETTE.muted }}>{f?.value == null ? "not assessed: no factor" : status}</td>
        <td style={{ ...td, whiteSpace: "nowrap" }}>
          <button type="button" style={linkBtn} onClick={onOpen}>
            {open ? "hide" : "source"}
          </button>
          {f && (
            <>
              {" · "}
              <button type="button" data-testid="factor-clear" style={linkBtn} onClick={() => carbonStore.clearFactor(category)}>
                clear
              </button>
            </>
          )}
        </td>
      </tr>
      {open && (
        <tr data-testid="factor-detail" style={{ background: "#f7f8f9" }}>
          <td colSpan={7} style={{ ...td, paddingBottom: 6 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "4px 10px" }}>
              <label>
                <div style={{ color: PALETTE.muted, fontSize: 10.5 }}>Source name (required for sourced / measured)</div>
                <Text testid="factor-source" width="100%" value={f?.sourceName ?? ""} onCommit={(v) => set(category, { sourceName: v })} />
              </label>
              <label>
                <div style={{ color: PALETTE.muted, fontSize: 10.5 }}>Reference (URL or document)</div>
                <Text testid="factor-reference" width="100%" value={f?.reference ?? ""} onCommit={(v) => set(category, { reference: v })} />
              </label>
              <label>
                <div style={{ color: PALETTE.muted, fontSize: 10.5 }}>Geographic applicability</div>
                <Text testid="factor-geography" width="100%" value={f?.geography ?? ""} onCommit={(v) => set(category, { geography: v })} />
              </label>
              <label>
                <div style={{ color: PALETTE.muted, fontSize: 10.5 }}>Assessment boundary / lifecycle modules (for example A1–A3)</div>
                <Text testid="factor-boundary" width="100%" value={f?.boundary ?? ""} onCommit={(v) => set(category, { boundary: v })} />
              </label>
            </div>
            {f?.note && <div style={{ color: PALETTE.warn, fontSize: 10.5, marginTop: 3 }}>{f.note}</div>}
          </td>
        </tr>
      )}
    </>
  );
}
