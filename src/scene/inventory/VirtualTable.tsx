/**
 * Windowed component table: fixed row height, visible rows plus an overscan, sticky header.
 * Only the rows near the viewport are in the DOM, so ~85k rows cost the same as 100.
 */

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CATEGORY_LABELS,
  dimensionsLabel,
  FLOOR_LABEL,
  formatValue,
  hasWarning,
  UNIT_LABEL,
  type InventoryRow,
  type SortColumn,
} from "@/engine/quantities";
import { PALETTE, StatusChip } from "./ui";

export const ROW_HEIGHT = 26;
export const OVERSCAN = 20;
const HEADER_HEIGHT = 28;
const HEADER_BG = "#eceff1";

interface Column {
  readonly key: SortColumn;
  readonly label: string;
  readonly width: number;
  readonly align?: "right";
}

// The drawer is ~560 px wide: ID is pinned left and Quantity / Unit / Status / Issues are pinned right,
// so the numbers stay visible while the descriptive columns in between scroll sideways.
const LEFT: readonly Column[] = [{ key: "id", label: "ID", width: 156 }];
const MIDDLE: readonly Column[] = [
  { key: "name", label: "Name", width: 170 },
  { key: "floor", label: "Floor", width: 44 },
  { key: "system", label: "System", width: 76 },
  { key: "category", label: "Category", width: 110 },
  { key: "material", label: "Material", width: 140 },
  { key: "dimensions", label: "Dimensions", width: 120 },
];
const RIGHT: readonly Column[] = [
  { key: "quantity", label: "Quantity", width: 70, align: "right" },
  { key: "unit", label: "Unit", width: 40 },
  { key: "status", label: "Status", width: 74 },
  { key: "issues", label: "Issues", width: 50, align: "right" },
];
const COLUMNS: readonly Column[] = [...LEFT, ...MIDDLE, ...RIGHT];
const TOTAL_WIDTH = COLUMNS.reduce((s, c) => s + c.width, 0);
const RIGHT_WIDTH = RIGHT.reduce((s, c) => s + c.width, 0);

const pinLeft = (bg: string) => ({ position: "sticky" as const, left: 0, zIndex: 1, background: bg, borderRight: `1px solid ${PALETTE.line}` });
const pinRight = (bg: string) => ({ position: "sticky" as const, right: 0, zIndex: 1, display: "flex", width: RIGHT_WIDTH, flex: "none" as const, marginLeft: "auto", background: bg, borderLeft: `1px solid ${PALETTE.line}`, alignItems: "center" as const, height: "100%" });

const cell = (c: Column) => ({
  width: c.width,
  flex: "none" as const,
  padding: "0 6px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
  textAlign: c.align ?? ("left" as const),
  boxSizing: "border-box" as const,
});

const Row = memo(function Row({ row, top, selected, onSelect }: { row: InventoryRow; top: number; selected: boolean; onSelect: (id: string) => void }) {
  const { rec, q } = row;
  const issues = [...q.primary.issues, ...q.mass.issues].filter((i) => i.severity === "warning");
  const text = (c: Column): ReactNode => {
    switch (c.key) {
      case "id":
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }} title={rec.id}>
              {rec.id}
            </span>
            {rec.parentId && (
              <button
                type="button"
                title={`Select parent ${rec.parentId}`}
                data-testid="select-parent-row"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(rec.parentId!);
                }}
                style={{ flex: "none", border: "none", background: "none", color: PALETTE.accent, cursor: "pointer", padding: 0, font: "inherit", fontSize: 11 }}
              >
                ↑
              </button>
            )}
          </span>
        );
      case "name":
        return rec.name;
      case "floor":
        return FLOOR_LABEL[rec.floor] ?? rec.floor;
      case "system":
        return rec.system;
      case "category":
        return CATEGORY_LABELS[q.category];
      case "material":
        return rec.materialId;
      case "dimensions":
        return dimensionsLabel(rec);
      case "quantity":
        return formatValue(q.primary.value, q.primary.unit);
      case "unit":
        return <span style={{ color: PALETTE.muted }}>{UNIT_LABEL[q.primary.unit]}</span>;
      case "status":
        return <StatusChip status={q.primary.status} title={q.primary.method} />;
      case "issues":
        return issues.length > 0 ? <span style={{ color: PALETTE.warn }}>{issues.length}</span> : <span style={{ color: PALETTE.muted }}>–</span>;
    }
  };
  const titleOf = (c: Column) => (c.key === "issues" && issues.length ? issues.map((i) => `${i.code}: ${i.message}`).join("\n") : c.key === "name" ? rec.name : undefined);
  const bg = selected ? "#fdeee6" : hasWarning(q) ? "#fff7f2" : "#fff";
  const render = (c: Column, extra: object = {}) => (
    <div key={c.key} style={{ ...cell(c), ...extra }} title={titleOf(c)}>
      {text(c)}
    </div>
  );
  return (
    <div
      data-testid="inv-row"
      data-id={rec.id}
      onClick={() => onSelect(rec.id)}
      style={{
        position: "absolute",
        top,
        left: 0,
        width: TOTAL_WIDTH,
        height: ROW_HEIGHT,
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        borderBottom: `1px solid ${PALETTE.line}`,
        background: bg,
        boxSizing: "border-box",
      }}
    >
      {LEFT.map((c) => render(c, pinLeft(bg)))}
      {MIDDLE.map((c) => render(c))}
      <div style={pinRight(bg)}>{RIGHT.map((c) => render(c))}</div>
    </div>
  );
});

export interface VirtualTableProps {
  readonly rows: readonly InventoryRow[];
  readonly height: number;
  readonly selectedId: string | null;
  readonly sort: { column: SortColumn; dir: "asc" | "desc" };
  readonly onSort: (column: SortColumn) => void;
  readonly onSelect: (id: string) => void;
}

export function VirtualTable({ rows, height, selectedId, sort, onSort, onSelect }: VirtualTableProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const raf = useRef(0);
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const t = e.currentTarget.scrollTop;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setTop(t));
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // A new result set starts at the top.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    setTop(0);
  }, [rows]);

  const header = (c: Column, extra: object = {}) => (
    <button
      key={c.key}
      type="button"
      data-testid={`inv-sort-${c.key}`}
      onClick={() => onSort(c.key)}
      style={{ ...cell(c), border: "none", background: "none", ...extra, font: "inherit", fontWeight: 600, cursor: "pointer", color: PALETTE.text, height: "100%" }}
      title={`Sort by ${c.label}`}
    >
      {c.label}
      {sort.column === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
    </button>
  );
  const first = Math.max(0, Math.floor((top - HEADER_HEIGHT) / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN);
  const out: ReactNode[] = [];
  for (let i = first; i < last; i++) {
    const row = rows[i]!;
    out.push(<Row key={row.rec.id} row={row} top={i * ROW_HEIGHT} selected={row.rec.id === selectedId} onSelect={onSelect} />);
  }

  return (
    <div ref={scroller} onScroll={onScroll} data-testid="inv-scroller" style={{ height, overflow: "auto", position: "relative", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 4 }}>
      <div style={{ position: "sticky", top: 0, zIndex: 3, display: "flex", width: TOTAL_WIDTH, height: HEADER_HEIGHT, alignItems: "center", background: HEADER_BG, borderBottom: `1px solid ${PALETTE.line}`, fontWeight: 600 }}>
        {LEFT.map((c) => header(c, pinLeft(HEADER_BG)))}
        {MIDDLE.map((c) => header(c))}
        <div style={pinRight(HEADER_BG)}>{RIGHT.map((c) => header(c))}</div>
      </div>
      <div style={{ position: "relative", width: TOTAL_WIDTH, height: rows.length * ROW_HEIGHT }}>
        {out}
        {rows.length === 0 && <div style={{ padding: 16, color: PALETTE.muted, position: "absolute" }}>No components match these filters.</div>}
      </div>
    </div>
  );
}
