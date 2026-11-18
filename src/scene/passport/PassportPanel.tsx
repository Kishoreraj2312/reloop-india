/**
 * Digital material passport panel (C1). Opens for the selected component (the app's existing selection) in the left column,
 * under the inspector, so the model stays in view; it folds to its header. Every field shows its status (recorded, calculated,
 * estimated, assumed, user entry, missing) and its source module. Only the user's own entries (inspection, observed
 * condition, notes, provenance) are editable here; B1 quantities and B2 / B4 / B5 results are read-only, with a link to the
 * place where they are edited. Export is one passport as JSON or CSV.
 */

import { useMemo, useState, type CSSProperties } from "react";
import { INSPECTION_LABELS, INSPECTION_STATUSES, MAX_NOTE, MAX_SHORT, OBSERVED_CONDITIONS, OBSERVED_LABELS, passportFileName, passportToCsv, passportToJson, STATUS_LABELS, type Field, type FieldStatus, type InspectionStatus, type ObservedCondition, type Passport } from "@/engine/passport";
import { getModelInventory } from "@/engine/quantities";
import { PALETTE } from "../inventory/ui";
import { carbonStore } from "../carbon/carbonStore";
import { recoveryStore } from "../recovery/recoveryStore";
import { scenarioStore } from "../scenarios/scenarioStore";
import { trackingStore } from "../tracking/trackingStore";
import { btn, field as inputStyle, linkBtn } from "../removal/ui";
import { downloadText } from "./download";
import { passportStore, usePassports } from "./passportStore";
import { usePassport } from "./usePassport";

const CHIP: Record<FieldStatus, { bg: string; fg: string }> = {
  recorded: { bg: "#e8ecf0", fg: "#3e4c59" },
  calculated: { bg: "#e3f1e8", fg: "#1f6b43" },
  estimated: { bg: "#fbefd2", fg: "#7a4d00" },
  assumed: { bg: "#ece8f4", fg: "#5a4a82" },
  user: { bg: "#e1edf7", fg: "#1f5a8a" },
  missing: { bg: "#fff", fg: "#9a3412" },
};

function Chip({ status }: { status: FieldStatus }) {
  const c = CHIP[status];
  const style: CSSProperties = { display: "inline-block", padding: "0 6px", borderRadius: 8, background: c.bg, color: c.fg, border: status === "missing" ? "1px solid #e3b7a0" : "1px solid transparent", fontSize: 9.5, lineHeight: "14px", letterSpacing: 0.2, whiteSpace: "nowrap" };
  return (
    <span style={style} data-status={status}>
      {STATUS_LABELS[status]}
    </span>
  );
}

const fmt = (v: Field["value"]): string => (typeof v === "number" ? Number(v.toPrecision(7)).toLocaleString("en-US", { maximumFractionDigits: 7 }) : v === null ? "–" : String(v));
const area: CSSProperties = { ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 38, fontSize: 11.5 };

/** Fields the user owns: shown as controls instead of values. */
const EDITABLE = new Set(["inspectionStatus", "observedCondition", "inspectedOn", "inspectedBy", "conditionNote", "provenanceNote"]);

function Editor({ id, f, raw }: { id: string; f: Field; raw: string }) {
  const [text, setText] = useState(raw);
  const [err, setErr] = useState<string | null>(null);
  const commit = (patch: Record<string, string | null>) => setErr(passportStore.edit(id, patch));
  const t = `passport-${f.key}`;
  let control;
  if (f.key === "inspectionStatus")
    control = (
      <select data-testid={t} style={inputStyle} value={raw} onChange={(e) => commit({ inspectionStatus: e.target.value || null })}>
        <option value="">— not recorded —</option>
        {INSPECTION_STATUSES.map((s: InspectionStatus) => (
          <option key={s} value={s}>
            {INSPECTION_LABELS[s]}
          </option>
        ))}
      </select>
    );
  else if (f.key === "observedCondition")
    control = (
      <select data-testid={t} style={inputStyle} value={raw} onChange={(e) => commit({ observedCondition: e.target.value || null })}>
        <option value="">— not recorded —</option>
        {OBSERVED_CONDITIONS.map((s: ObservedCondition) => (
          <option key={s} value={s}>
            {OBSERVED_LABELS[s]}
          </option>
        ))}
      </select>
    );
  else if (f.key === "inspectedOn")
    control = <input data-testid={t} type="date" style={inputStyle} value={raw} onChange={(e) => commit({ inspectedOn: e.target.value })} />;
  else if (f.key === "inspectedBy")
    control = <input data-testid={t} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} maxLength={MAX_SHORT} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== raw && commit({ inspectedBy: text })} />;
  else
    control = <textarea data-testid={t} style={area} maxLength={MAX_NOTE} value={text} placeholder={f.key === "conditionNote" ? "What was observed" : "Origin, supplier, installation, documents"} onChange={(e) => setText(e.target.value)} onBlur={() => text !== raw && commit({ [f.key]: text })} />;
  return (
    <div>
      {control}
      {err && (
        <div data-testid={`${t}-error`} style={{ color: PALETTE.warn, fontSize: 10.5 }}>
          {err}
        </div>
      )}
    </div>
  );
}

export function PassportPanel({ selectedId, onSelect, className }: { selectedId: string | null; onSelect: (id: string | null) => void; className?: string }) {
  const p = usePassport(selectedId);
  const ps = usePassports();
  const inv = useMemo(() => getModelInventory(), []);
  if (!selectedId || !p) return null;
  const orphans = [...ps.meta.keys()].filter((id) => !inv.recordById.has(id));

  const header = (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="rm-heading" style={{ marginBottom: 1 }}>Material passport</div>
        <div data-testid="passport-name" style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: p.found && !ps.collapsed ? "normal" : "nowrap" }}>
          {p.found ? p.name : "Unknown component"}
        </div>
        <div style={{ fontFamily: "var(--rm-mono)", fontSize: 10.5, color: PALETTE.muted, wordBreak: "break-all" }}>{selectedId}</div>
      </div>
      {p.found && !ps.collapsed && (
        <>
          <button type="button" data-testid="passport-json" className="rm-btn" style={{ width: "auto", height: 24, padding: "0 8px", fontSize: 11 }} title="Download this passport as JSON" onClick={() => downloadText(passportFileName(p.id, "json"), "application/json", passportToJson(p, new Date().toISOString()))}>
            JSON
          </button>
          <button type="button" data-testid="passport-csv" className="rm-btn" style={{ width: "auto", height: 24, padding: "0 8px", fontSize: 11 }} title="Download this passport as CSV (one row per field)" onClick={() => downloadText(passportFileName(p.id, "csv"), "text/csv;charset=utf-8", passportToCsv(p))}>
            CSV
          </button>
        </>
      )}
      <button type="button" data-testid="passport-toggle" className="rm-btn" aria-label={ps.collapsed ? "Expand the passport" : "Collapse the passport"} title={ps.collapsed ? "Expand" : "Collapse (the selection and the model stay as they are)"} style={{ width: 24, height: 24, padding: 0 }} onClick={() => passportStore.setCollapsed(!ps.collapsed)}>
        {ps.collapsed ? "+" : "–"}
      </button>
    </div>
  );

  return (
    <div data-testid="passport-panel" data-id={selectedId} data-collapsed={ps.collapsed} className={className ? `rm-panel ${className}` : "rm-panel"} style={{ padding: "8px 10px", width: "100%", boxSizing: "border-box" }}>
      {header}
      {!ps.collapsed && !p.found && (
        <div data-testid="passport-missing" style={{ marginTop: 6, color: PALETTE.warn }}>
          This id is not a component of the model ({p.reason}). Nothing was changed.
        </div>
      )}
      {!ps.collapsed && p.found && <Body p={p} onSelect={onSelect} orphans={orphans} />}
    </div>
  );
}

function Body({ p, onSelect, orphans }: { p: Passport; onSelect: (id: string | null) => void; orphans: string[] }) {
  const order: FieldStatus[] = ["recorded", "calculated", "estimated", "assumed", "user", "missing"];
  return (
    <div data-testid="passport-body" style={{ marginTop: 6, fontSize: 11.5 }}>
      <div data-testid="passport-quality" style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
        {order.filter((s) => p.counts[s] > 0).map((s) => (
          <span key={s} title={`${p.counts[s]} fields are ${STATUS_LABELS[s]}`} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <Chip status={s} />
            <span data-count={s}>{p.counts[s]}</span>
          </span>
        ))}
      </div>
      <div style={{ color: PALETTE.muted, fontSize: 10.5, marginBottom: 4 }}>{p.cautions[0]}</div>
      {p.cautions.slice(1).map((c) => (
        <div key={c} style={{ color: PALETTE.warn, fontSize: 10.5, marginBottom: 3 }}>
          {c}
        </div>
      ))}
      {p.sections.map((s) => (
        <div key={s.key} data-testid="passport-section" data-section={s.key}>
          <div className="rm-heading" style={{ margin: "8px 0 2px" }}>
            {s.title}
          </div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {s.fields.map((f) => {
                const edit = EDITABLE.has(f.key);
                const raw = edit ? (f.key === "inspectionStatus" ? (rawOf(p, "inspectionStatus", INSPECTION_LABELS)) : f.key === "observedCondition" ? rawOf(p, "observedCondition", OBSERVED_LABELS) : f.value === null ? "" : String(f.value)) : "";
                return (
                  <tr key={f.key} data-field={f.key} data-status={f.status} style={{ borderTop: `1px solid ${PALETTE.line}`, verticalAlign: "top" }} title={f.note}>
                    <td style={{ padding: "2px 6px 2px 0", color: PALETTE.muted, width: "38%" }}>{f.label}</td>
                    <td style={{ padding: "2px 0" }}>
                      {edit ? (
                        <Editor key={`${p.id}|${f.key}|${raw}`} id={p.id} f={f} raw={raw} />
                      ) : (
                        <>
                          {f.value === null ? (
                            <span style={{ color: PALETTE.muted }}>not available</span>
                          ) : f.key === "parent" ? (
                            <button type="button" style={linkBtn} onClick={() => onSelect(String(f.value))}>
                              {String(f.value)}
                            </button>
                          ) : (
                            <span data-testid="passport-value" style={{ wordBreak: "break-word" }}>
                              {fmt(f.value)}
                              {f.unit ? ` ${f.unit}` : ""}
                            </span>
                          )}
                          {f.note && (f.status === "missing" || f.status === "estimated" || f.status === "assumed") && <div style={{ color: PALETTE.muted, fontSize: 10, lineHeight: 1.3 }}>{f.note}</div>}
                        </>
                      )}
                    </td>
                    <td style={{ padding: "2px 0 2px 6px", whiteSpace: "nowrap", textAlign: "right" }}>
                      <Chip status={f.status} />
                      <span style={{ color: PALETTE.muted, fontSize: 9.5, marginLeft: 4 }}>{f.source}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <div style={{ marginTop: 8, fontSize: 10.5, color: PALETTE.muted }}>
        Read-only here: model values, B1 quantities and the B2 / B3 / B4 / B5 results. Edit the assessment in{" "}
        <button type="button" data-testid="passport-open-b2" style={linkBtn} onClick={() => (scenarioStore.setOpen(false), carbonStore.setOpen(false), recoveryStore.setOpen(true))}>
          Recovery (B2)
        </button>
        ; record actual recovery in{" "}
        <button type="button" data-testid="passport-open-tracking" style={linkBtn} onClick={() => trackingStore.setOpen(true)}>
          Tracking (C3)
        </button>
        . Your entries are saved in this browser only.
        {orphans.length > 0 && (
          <div data-testid="passport-orphans" style={{ marginTop: 4, color: PALETTE.warn }}>
            {orphans.length} saved {orphans.length === 1 ? "entry refers" : "entries refer"} to components that are not in this model ({orphans.slice(0, 3).join(", ")}
            {orphans.length > 3 ? " …" : ""}).{" "}
            <button type="button" data-testid="passport-orphans-remove" style={btn} onClick={() => passportStore.removeAll(orphans)}>
              Remove them
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The raw enum value behind a label (the passport stores labels for display; the editor needs the key). */
function rawOf<T extends string>(p: Passport, key: string, labels: Readonly<Record<T, string>>): string {
  const f = p.sections.flatMap((s) => s.fields).find((x) => x.key === key);
  if (!f || f.value === null) return "";
  return (Object.keys(labels) as T[]).find((k) => labels[k] === f.value) ?? "";
}
