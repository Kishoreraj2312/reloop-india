/**
 * Material inventory drawer (B1). Local state only: opening it never touches the scene. The
 * inventory is the engine's memoised object; this component filters, sorts and renders it.
 * Row click calls the app's existing select handler (same selection, outline and inspector).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSummary,
  CATEGORIES,
  CATEGORY_LABELS,
  filterRows,
  FLOOR_LABEL,
  formatValue,
  getModelInventory,
  rowsToCsv,
  sortRows,
  totalOf,
  UNIT_LABEL,
  type Category,
  type RowFilter,
  type SortColumn,
  type Status,
  type SummaryCard,
  type Unit,
} from "@/engine/quantities";
import { BreakdownSection } from "./BreakdownSection";
import { SummarySection } from "./SummarySection";
import { VirtualTable } from "./VirtualTable";
import { PALETTE } from "./ui";

export const DRAWER_WIDTH = 560;
const STATUSES: readonly Status[] = ["calculated", "estimated", "unavailable"];
const FOOTER_UNITS: readonly Unit[] = ["m3", "m2", "m", "nr", "kg"];

const heading = { fontSize: 10, letterSpacing: 0.5, color: PALETTE.muted, margin: "14px 0 6px", fontWeight: 600 } as const;
const select = { font: "inherit", fontSize: 12, padding: "2px 4px", border: `1px solid ${PALETTE.line}`, borderRadius: 3, background: "#fff", color: PALETTE.text, minWidth: 0 } as const;

export function InventoryDrawer({ onClose, onSelect, selectedId }: { onClose: () => void; onSelect: (id: string | null) => void; selectedId: string | null }) {
  const inv = useMemo(() => getModelInventory(), []);
  const summary = useMemo(() => buildSummary(inv), [inv]);

  const [filter, setFilter] = useState<RowFilter>({});
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ column: SortColumn; dir: "asc" | "desc" }>({ column: "id", dir: "asc" });
  const [cardLabel, setCardLabel] = useState<string | null>(null);
  const [tableHeight, setTableHeight] = useState(() => Math.max(320, window.innerHeight - 190));
  const tableTop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = setTimeout(() => setQuery(text), 150);
    return () => clearTimeout(h);
  }, [text]);
  useEffect(() => {
    const onResize = () => setTableHeight(Math.max(320, window.innerHeight - 190));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const effective = useMemo<RowFilter>(() => (query.trim() ? { ...filter, text: query } : filter), [filter, query]);
  const filtered = useMemo(() => filterRows(inv.rows, effective), [inv, effective]);
  const rows = useMemo(() => sortRows(filtered, sort.column, sort.dir), [filtered, sort]);
  const totals = useMemo(() => totalOf(filtered, "filtered"), [filtered]);

  const facets = useMemo(
    () => ({
      floors: [...inv.breakdowns.floor.keys()].map(Number).sort((a, b) => a - b),
      systems: [...inv.breakdowns.system.keys()].sort(),
      categories: CATEGORIES.filter((c) => inv.breakdowns.category.has(c)),
      materials: [...inv.breakdowns.material.keys()].sort(),
    }),
    [inv],
  );

  const set = useCallback((patch: Partial<RowFilter>) => {
    setCardLabel(null);
    setFilter((f) => {
      const next: Record<string, unknown> = { ...f, ...patch };
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      return next as RowFilter;
    });
  }, []);
  const onSort = useCallback((column: SortColumn) => setSort((s) => (s.column === column ? { column, dir: s.dir === "asc" ? "desc" : "asc" } : { column, dir: "asc" })), []);
  const pickCard = useCallback((c: SummaryCard) => {
    if (!c.filter) return;
    setFilter(c.filter);
    setText("");
    setQuery("");
    setCardLabel(c.label);
    tableTop.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, []);
  const clear = () => {
    setFilter({});
    setText("");
    setQuery("");
    setCardLabel(null);
  };

  const exportCsv = () => {
    const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reloop-inventory.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const filtersActive = Object.keys(filter).length > 0 || text !== "";
  const cardFilterActive = filter.componentTypes !== undefined || filter.hasIssues === true;

  return (
    <div
      data-testid="inventory-drawer"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: DRAWER_WIDTH,
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
        background: PALETTE.panel,
        color: PALETTE.text,
        borderLeft: `1px solid ${PALETTE.line}`,
        boxShadow: "-4px 0 14px rgba(0,0,0,0.12)",
        font: "12.5px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${PALETTE.line}`, background: "#fff" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Material inventory</div>
          <div style={{ fontSize: 11, color: PALETTE.muted }}>
            Quantity takeoff · {inv.rows.length.toLocaleString("en-US")} components · {inv.assemblyCount.toLocaleString("en-US")} assemblies · conceptual model
          </div>
        </div>
        <button type="button" data-testid="inventory-close" onClick={onClose} title="Close (Esc)" style={{ font: "inherit", fontSize: 16, border: "none", background: "none", cursor: "pointer", color: PALETTE.muted }}>
          ✕
        </button>
      </div>

      <div data-testid="inventory-body" style={{ flex: 1, overflowY: "auto", padding: "0 14px 24px" }}>
        <div style={heading}>SUMMARY</div>
        <SummarySection inv={inv} summary={summary} filter={filter} onPick={pickCard} onSelect={onSelect} />

        <div style={heading}>BREAKDOWNS</div>
        <BreakdownSection inv={inv} />

        <div ref={tableTop} style={heading}>
          COMPONENTS
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <select data-testid="inv-filter-floor" style={select} value={filter.floor ?? ""} onChange={(e) => set({ floor: e.target.value === "" ? undefined : Number(e.target.value) })}>
            <option value="">All floors</option>
            {facets.floors.map((f) => (
              <option key={f} value={f}>
                {FLOOR_LABEL[f] ?? f}
              </option>
            ))}
          </select>
          <select data-testid="inv-filter-system" style={select} value={filter.system ?? ""} onChange={(e) => set({ system: e.target.value || undefined })}>
            <option value="">All systems</option>
            {facets.systems.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select data-testid="inv-filter-category" style={select} value={filter.category ?? ""} onChange={(e) => set({ category: (e.target.value || undefined) as Category | undefined })}>
            <option value="">All categories</option>
            {facets.categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <select data-testid="inv-filter-material" style={{ ...select, maxWidth: 150 }} value={filter.material ?? ""} onChange={(e) => set({ material: e.target.value || undefined })}>
            <option value="">All materials</option>
            {facets.materials.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select data-testid="inv-filter-status" style={select} value={filter.status ?? ""} onChange={(e) => set({ status: (e.target.value || undefined) as Status | undefined })}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input data-testid="inv-search" type="search" placeholder="Search id or name" value={text} onChange={(e) => setText(e.target.value)} style={{ ...select, flex: 1, minWidth: 120 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, minHeight: 20 }}>
          {cardFilterActive && (
            <span data-testid="inv-card-chip" style={{ background: "#fdeee6", border: `1px solid ${PALETTE.accent}`, borderRadius: 10, padding: "0 8px", fontSize: 11 }}>
              {cardLabel ?? "card filter"}
            </span>
          )}
          {filtersActive && (
            <button type="button" data-testid="inv-clear" onClick={clear} style={{ font: "inherit", fontSize: 11, color: PALETTE.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
              clear filters
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" data-testid="inv-export" onClick={exportCsv} disabled={rows.length === 0} style={{ font: "inherit", fontSize: 12, padding: "2px 10px", border: `1px solid ${PALETTE.line}`, borderRadius: 3, background: "#fff", cursor: "pointer", color: PALETTE.text }}>
            Export CSV
          </button>
        </div>

        <VirtualTable rows={rows} height={tableHeight} selectedId={selectedId} sort={sort} onSort={onSort} onSelect={onSelect} />

        <div data-testid="inv-footer" style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: "2px 14px", fontSize: 12 }}>
          <span data-testid="inv-count" data-count={rows.length}>
            <b>{rows.length.toLocaleString("en-US")}</b> of {inv.rows.length.toLocaleString("en-US")} rows
          </span>
          {FOOTER_UNITS.map((u) => {
            const t = totals.totals[u];
            if (!t) return null;
            return (
              <span key={u} data-testid={`inv-total-${u}`} title={t.incompleteCount ? `${t.incompleteCount} rows have no value for this unit (partial total)` : undefined}>
                Σ <b>{formatValue(t.value, u)}</b> <span style={{ color: PALETTE.muted }}>{UNIT_LABEL[u]}</span>
                {t.incompleteCount > 0 && <span style={{ color: PALETTE.warn }}> (partial)</span>}
              </span>
            );
          })}
        </div>
        <div style={{ marginTop: 3, fontSize: 10.5, color: PALETTE.muted }}>
          Totals sum every measure of the filtered rows (primary quantity, derived volumes and estimated mass), once per unit. Assemblies are never summed.
        </div>
      </div>
    </div>
  );
}
