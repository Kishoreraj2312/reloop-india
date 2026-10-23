/**
 * Recovery & reuse assessment drawer (B2). Local to the controls panel: opening it never touches the
 * scene. Quantities are B1's (memoised inventory); recoverable quantities come from the recovery engine;
 * assessments live in the recovery store. Row click uses the app's existing select handler.
 */

import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, filterRows, FLOOR_LABEL, formatValue, getModelInventory, UNIT_LABEL, type InventoryRow } from "@/engine/quantities";
import {
  CLASSIFICATIONS,
  CLASSIFICATION_SHORT,
  GROUP_BYS,
  GROUP_BY_LABELS,
  groupKey,
  substanceOf,
  summarize,
  targetLeafIds,
  type Basis,
  type GroupBy,
  type RecoveryRow,
} from "@/engine/recovery";
import { DRAWER_WIDTH } from "../inventory/InventoryDrawer";
import { PALETTE } from "../inventory/ui";
import { BulkForm, Dot, LeafEditor } from "./AssessmentEditor";
import { STATUS_COLOURS } from "./colors";
import { recoveryStore, useRecovery } from "./recoveryStore";
import { RecoveryTable } from "./RecoveryTable";

const heading = { fontSize: 10, letterSpacing: 0.5, color: PALETTE.muted, margin: "14px 0 6px", fontWeight: 600 } as const;
const select = { font: "inherit", fontSize: 12, padding: "2px 4px", border: `1px solid ${PALETTE.line}`, borderRadius: 3, background: "#fff", color: PALETTE.text, minWidth: 0 } as const;
const th = { textAlign: "right" as const, padding: "2px 4px", fontWeight: 600, fontSize: 10.5, lineHeight: 1.25, verticalAlign: "bottom" as const };
const td = { textAlign: "right" as const, padding: "1px 4px", fontVariantNumeric: "tabular-nums" as const, fontSize: 11.5, whiteSpace: "nowrap" as const };
const table = { borderCollapse: "collapse" as const, width: "100%", background: "#fff", border: `1px solid ${PALETTE.line}` };

const val = (v: number | null, r: RecoveryRow, field: "available" | "recoverable" | "requiresAssessment") => (v === null ? <span style={{ color: PALETTE.muted }} title="Not available">–</span> : <span data-field={field}>{formatValue(v, r.unit)}</span>);

function SummaryTable({ rows, groupLabel, onPick, testid }: { rows: readonly RecoveryRow[]; groupLabel: string; onPick?: (r: RecoveryRow) => void; testid: string }) {
  return (
    <table data-testid={testid} style={table}>
      <thead>
        <tr style={{ background: "#eceff1" }}>
          <th style={{ ...th, textAlign: "left" }}>{groupLabel}</th>
          <th style={{ ...th, textAlign: "left" }}>Unit</th>
          <th style={th}>Parts</th>
          <th style={th}>Available</th>
          <th style={th} title="Σ available × recovery % over components that have a recoverable estimate">Est. recoverable</th>
          <th style={th} title="recoverable ÷ available of the whole group">%</th>
          <th style={th} title="Available quantity of components classified 'requires further assessment', 'insufficient information' or not yet assessed">To assess</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.key}|${r.unit}`} data-group={r.key} data-unit={r.unit} onClick={onPick ? () => onPick(r) : undefined} style={{ borderTop: `1px solid ${PALETTE.line}`, cursor: onPick ? "pointer" : "default" }} title={r.unquantified ? `${r.unquantified} parts have no value for this basis` : undefined}>
            <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>{r.label}</td>
            <td style={{ ...td, textAlign: "left", color: PALETTE.muted }}>{UNIT_LABEL[r.unit]}</td>
            <td style={td}>{r.components.toLocaleString("en-US")}</td>
            <td style={td}>{val(r.available, r, "available")}</td>
            <td style={{ ...td, fontWeight: 600 }}>{val(r.recoverable, r, "recoverable")}</td>
            <td style={td}>{r.pct === null ? <span style={{ color: PALETTE.muted }}>–</span> : `${r.pct.toFixed(1)}`}</td>
            <td style={td}>{val(r.requiresAssessment, r, "requiresAssessment")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface ListFilter {
  floor?: number;
  system?: string;
  category?: string;
  substance?: string;
  status?: string;
  group?: { by: GroupBy; key: string; label: string };
}

export function RecoveryDrawer({ onClose, onSelect, selectedId }: { onClose: () => void; onSelect: (id: string | null) => void; selectedId: string | null }) {
  const inv = useMemo(() => getModelInventory(), []);
  const { assessments, basis, colour } = useRecovery();
  const [groupBy, setGroupBy] = useState<GroupBy>("materialCategory");
  const [filter, setFilter] = useState<ListFilter>({});
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [tableHeight, setTableHeight] = useState(() => Math.max(300, window.innerHeight - 260));

  useEffect(() => {
    const h = setTimeout(() => setQuery(text), 150);
    return () => clearTimeout(h);
  }, [text]);
  useEffect(() => {
    const onResize = () => setTableHeight(Math.max(300, window.innerHeight - 260));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLInputElement) && onClose();
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const summary = useMemo(() => summarize(inv, assessments, { basis, groupBy }), [inv, assessments, basis, groupBy]);
  const overall = useMemo(() => summarize(inv, assessments, { basis, groupBy: "status" }), [inv, assessments, basis]);

  const filtered = useMemo<readonly InventoryRow[]>(() => {
    let rows = filterRows(inv.rows, { ...(filter.floor !== undefined ? { floor: filter.floor } : {}), ...(filter.system ? { system: filter.system } : {}), ...(filter.category ? { category: filter.category as (typeof CATEGORIES)[number] } : {}), ...(query.trim() ? { text: query } : {}) });
    if (filter.substance) rows = rows.filter((r) => substanceOf(r.rec.materialId) === filter.substance);
    if (filter.status) rows = rows.filter((r) => (assessments.get(r.rec.id)?.classification ?? "unassessed") === filter.status);
    if (filter.group) {
      const g = filter.group;
      rows = rows.filter((r) => groupKey(r, assessments, g.by).key === g.key);
    }
    return rows;
  }, [inv, filter, query, assessments]);
  const filtersActive = Object.keys(filter).length > 0 || query.trim() !== "";

  // Colour the 3D model only for the filtered components (others pale) while filters are active.
  useEffect(() => {
    recoveryStore.setFocus(filtersActive ? new Set(filtered.map((r) => r.rec.id)) : null);
  }, [filtered, filtersActive]);
  useEffect(() => () => recoveryStore.setFocus(null), []);

  const facets = useMemo(
    () => ({
      floors: [...inv.breakdowns.floor.keys()].map(Number).sort((a, b) => a - b),
      systems: [...inv.breakdowns.system.keys()].sort(),
      categories: CATEGORIES.filter((c) => inv.breakdowns.category.has(c)),
      substances: [...new Set(inv.rows.map((r) => substanceOf(r.rec.materialId)))].sort(),
    }),
    [inv],
  );
  const set = (patch: Partial<ListFilter>) =>
    setFilter((f) => {
      const next: Record<string, unknown> = { ...f, ...patch };
      for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === "") delete next[k];
      return next as ListFilter;
    });

  const selRec = selectedId ? inv.recordById.get(selectedId) : undefined;
  const selRow = selectedId && selRec && selRec.geometry.kind !== "group" ? { rec: selRec, q: inv.byId.get(selectedId)! } : undefined;
  const selParts = useMemo(() => (selRec?.geometry.kind === "group" ? targetLeafIds(inv, selRec.id) : []), [inv, selRec]);
  const partsAssessed = selParts.filter((id) => assessments.get(id)?.classification).length;

  const t = overall.totals;
  return (
    <div data-testid="recovery-drawer" style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: DRAWER_WIDTH, zIndex: 30, display: "flex", flexDirection: "column", background: PALETTE.panel, color: PALETTE.text, borderLeft: `1px solid ${PALETTE.line}`, boxShadow: "-4px 0 14px rgba(0,0,0,0.12)", font: "12.5px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif", fontVariantNumeric: "tabular-nums" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${PALETTE.line}`, background: "#fff" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Recovery & reuse assessment</div>
          <div style={{ fontSize: 11, color: PALETTE.muted }}>Planning classifications built on the B1 inventory. Not a certified judgement of condition, safety or suitability.</div>
        </div>
        <button type="button" data-testid="recovery-close" onClick={onClose} title="Close (Esc)" style={{ font: "inherit", fontSize: 16, border: "none", background: "none", cursor: "pointer", color: PALETTE.muted }}>
          ✕
        </button>
      </div>

      <div data-testid="recovery-body" style={{ flex: 1, overflowY: "auto", padding: "0 14px 24px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", margin: "10px 0 4px" }}>
          <label style={{ display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" data-testid="recovery-colour" checked={colour} onChange={(e) => recoveryStore.setColour(e.target.checked)} />
            Colour the 3D model by assessment
          </label>
          <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
            Quantify by
            <select data-testid="recovery-basis" style={select} value={basis} onChange={(e) => recoveryStore.setBasis(e.target.value as Basis)}>
              <option value="quantity">B1 quantity (own units)</option>
              <option value="mass">Estimated mass (kg)</option>
            </select>
          </label>
        </div>
        <div data-testid="recovery-legend" style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", fontSize: 11, color: PALETTE.muted }}>
          {[...CLASSIFICATIONS, "unassessed" as const].map((c) => (
            <span key={c} style={{ display: "flex", alignItems: "center" }}>
              <Dot colour={STATUS_COLOURS[c]} />
              {CLASSIFICATION_SHORT[c]}
            </span>
          ))}
        </div>

        <div style={heading}>SUMMARY</div>
        <div data-testid="recovery-counts" style={{ marginBottom: 4 }}>
          <b>{overall.assessedCount.toLocaleString("en-US")}</b> of {overall.leafCount.toLocaleString("en-US")} components assessed ·{" "}
          <b>{t.reduce((n, r) => n + r.recoverableComponents, 0).toLocaleString("en-US")}</b> with a recoverable estimate
        </div>
        <SummaryTable rows={t} groupLabel="All components" testid="recovery-totals" />
        <div style={{ fontSize: 10.5, color: PALETTE.muted, marginTop: 3 }}>
          One row per unit: m³, m², m, nr and kg are never added together. Recoverable = available × your recovery %. Assessments are saved in this browser only.
        </div>

        <div style={heading}>SELECTED COMPONENT</div>
        {selRow ? (
          <LeafEditor key={selRow.rec.id} row={selRow} />
        ) : selRec ? (
          <div data-testid="recovery-assembly">
            <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{selRec.id}</div>
            <div style={{ color: PALETTE.muted }}>{selRec.name}</div>
            <div style={{ margin: "4px 0" }}>
              Assembly of {selParts.length} parts · {partsAssessed} assessed. Assessments are made on parts; this form applies to all of them.
            </div>
            <BulkForm key={selRec.id} ids={[selRec.id]} what="parts of this assembly" testid="assembly-bulk" />
          </div>
        ) : (
          <div style={{ color: PALETTE.muted }} data-testid="recovery-hint">
            Click a component in the 3D model or a row below to assess it.
          </div>
        )}

        <div style={heading}>RECOVERY INVENTORY</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ color: PALETTE.muted }}>Group by</span>
          <select data-testid="recovery-groupby" style={select} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            {GROUP_BYS.map((g) => (
              <option key={g} value={g}>
                {GROUP_BY_LABELS[g]}
              </option>
            ))}
          </select>
          <span style={{ color: PALETTE.muted, fontSize: 11 }}>click a row to list its components</span>
        </div>
        <SummaryTable rows={summary.rows} groupLabel={GROUP_BY_LABELS[groupBy]} testid="recovery-groups" onPick={(r) => set({ group: { by: groupBy, key: r.key, label: `${GROUP_BY_LABELS[groupBy]}: ${r.label}` } })} />

        <div style={heading}>COMPONENTS</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <select data-testid="recovery-filter-floor" style={select} value={filter.floor ?? ""} onChange={(e) => set({ floor: e.target.value === "" ? undefined : Number(e.target.value) })}>
            <option value="">All floors</option>
            {facets.floors.map((f) => (
              <option key={f} value={f}>
                {FLOOR_LABEL[f] ?? f}
              </option>
            ))}
          </select>
          <select data-testid="recovery-filter-system" style={select} value={filter.system ?? ""} onChange={(e) => set({ system: e.target.value })}>
            <option value="">All systems</option>
            {facets.systems.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select data-testid="recovery-filter-material" style={select} value={filter.substance ?? ""} onChange={(e) => set({ substance: e.target.value })}>
            <option value="">All material categories</option>
            {facets.substances.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <select data-testid="recovery-filter-category" style={select} value={filter.category ?? ""} onChange={(e) => set({ category: e.target.value })}>
            <option value="">All component categories</option>
            {facets.categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <select data-testid="recovery-filter-status" style={select} value={filter.status ?? ""} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any assessment</option>
            {[...CLASSIFICATIONS, "unassessed" as const].map((c) => (
              <option key={c} value={c}>
                {CLASSIFICATION_SHORT[c]}
              </option>
            ))}
          </select>
          <input data-testid="recovery-search" type="search" placeholder="Search id or name" value={text} onChange={(e) => setText(e.target.value)} style={{ ...select, flex: 1, minWidth: 120 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, minHeight: 20 }}>
          {filter.group && (
            <span data-testid="recovery-group-chip" style={{ background: "#fdeee6", border: `1px solid ${PALETTE.accent}`, borderRadius: 10, padding: "0 8px", fontSize: 11 }}>
              {filter.group.label}
            </span>
          )}
          {filtersActive && (
            <button type="button" data-testid="recovery-clear-filters" onClick={() => { setFilter({}); setText(""); setQuery(""); }} style={{ font: "inherit", fontSize: 11, color: PALETTE.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
              clear filters
            </button>
          )}
          <span style={{ flex: 1 }} />
          <span data-testid="recovery-count" data-count={filtered.length}>
            <b>{filtered.length.toLocaleString("en-US")}</b> of {inv.rows.length.toLocaleString("en-US")}
          </span>
        </div>
        <RecoveryTable rows={filtered} height={tableHeight} selectedId={selectedId} assessments={assessments} basis={basis} onSelect={onSelect} />

        <div style={heading}>PLAN THE FILTERED COMPONENTS</div>
        <BulkForm ids={useMemo(() => filtered.map((r) => r.rec.id), [filtered])} what="filtered components" testid="filtered-bulk" />
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" data-testid="recovery-clear-filtered" style={{ font: "inherit", fontSize: 12, padding: "2px 10px", border: `1px solid ${PALETTE.line}`, borderRadius: 3, background: "#fff", cursor: "pointer" }} onClick={() => recoveryStore.clear(filtered.map((r) => r.rec.id))}>
            Remove assessments of the filtered components
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          {confirmReset ? (
            <span>
              Remove all {assessments.size.toLocaleString("en-US")} assessments?{" "}
              <button type="button" data-testid="recovery-reset-confirm" onClick={() => { recoveryStore.clearAll(); setConfirmReset(false); }} style={{ font: "inherit", fontSize: 12, color: PALETTE.warn }}>
                Yes, remove
              </button>{" "}
              <button type="button" onClick={() => setConfirmReset(false)} style={{ font: "inherit", fontSize: 12 }}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" data-testid="recovery-reset" disabled={assessments.size === 0} onClick={() => setConfirmReset(true)} style={{ font: "inherit", fontSize: 11, color: PALETTE.muted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
              Reset all assessments
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
