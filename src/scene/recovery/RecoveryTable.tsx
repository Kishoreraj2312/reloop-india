/** Windowed component list for the recovery drawer (fixed 26 px rows, 20-row overscan, sticky header). */

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CATEGORY_LABELS, FLOOR_LABEL, formatValue, UNIT_LABEL, type InventoryRow } from "@/engine/quantities";
import { CLASSIFICATION_SHORT, evaluateRow, type Assessments, type Basis } from "@/engine/recovery";
import { PALETTE } from "../inventory/ui";
import { STATUS_COLOURS } from "./colors";
import { Dot } from "./AssessmentEditor";

const ROW_HEIGHT = 26;
const OVERSCAN = 20;
const HEADER_HEIGHT = 28;

const COLUMNS = [
  { key: "id", label: "ID", width: 168 },
  { key: "status", label: "Assessment", width: 126 },
  { key: "available", label: "Available", width: 92, right: true },
  { key: "pct", label: "%", width: 40, right: true },
  { key: "recoverable", label: "Recoverable", width: 92, right: true },
  { key: "floor", label: "Floor", width: 44 },
  { key: "category", label: "Category", width: 110 },
  { key: "name", label: "Name", width: 220 },
] as const;
const TOTAL = COLUMNS.reduce((s, c) => s + c.width, 0);
const cell = (c: (typeof COLUMNS)[number]) => ({ width: c.width, flex: "none" as const, padding: "0 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, textAlign: ("right" in c ? "right" : "left") as "left" | "right", boxSizing: "border-box" as const });

const Row = memo(function Row({ row, top, a, basis, selected, onSelect }: { row: InventoryRow; top: number; a: Assessments; basis: Basis; selected: boolean; onSelect: (id: string) => void }) {
  const ev = evaluateRow(row, a.get(row.rec.id), basis);
  const cellText = (key: (typeof COLUMNS)[number]["key"]): ReactNode => {
    switch (key) {
      case "id":
        return <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }} title={row.rec.id}>{row.rec.id}</span>;
      case "status":
        return (
          <span style={{ display: "flex", alignItems: "center" }} data-status={ev.status}>
            <Dot colour={STATUS_COLOURS[ev.status]} />
            {CLASSIFICATION_SHORT[ev.status]}
          </span>
        );
      case "available":
        return ev.available.value === null ? <span style={{ color: PALETTE.muted }} title={ev.notes[0]}>n/a</span> : `${formatValue(ev.available.value, ev.available.unit)} ${UNIT_LABEL[ev.available.unit]}`;
      case "pct":
        return ev.recoveryPct === null ? <span style={{ color: PALETTE.muted }}>–</span> : ev.recoveryPct;
      case "recoverable":
        return ev.recoverable === null ? <span style={{ color: PALETTE.muted }} title={ev.notes.join("; ") || "not assessed"}>–</span> : <b>{`${formatValue(ev.recoverable, ev.available.unit)} ${UNIT_LABEL[ev.available.unit]}`}</b>;
      case "floor":
        return FLOOR_LABEL[row.rec.floor] ?? row.rec.floor;
      case "category":
        return CATEGORY_LABELS[row.q.category];
      case "name":
        return row.rec.name;
    }
  };
  return (
    <div data-testid="rec-row" data-id={row.rec.id} onClick={() => onSelect(row.rec.id)} style={{ position: "absolute", top, left: 0, width: TOTAL, height: ROW_HEIGHT, display: "flex", alignItems: "center", cursor: "pointer", borderBottom: `1px solid ${PALETTE.line}`, background: selected ? "#fdeee6" : "#fff", boxSizing: "border-box" }}>
      {COLUMNS.map((c) => (
        <div key={c.key} style={cell(c)}>
          {cellText(c.key)}
        </div>
      ))}
    </div>
  );
});

export function RecoveryTable({ rows, height, selectedId, assessments, basis, onSelect }: { rows: readonly InventoryRow[]; height: number; selectedId: string | null; assessments: Assessments; basis: Basis; onSelect: (id: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const raf = useRef(0);
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const t = e.currentTarget.scrollTop;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setTop(t));
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    setTop(0);
  }, [rows]);
  const first = Math.max(0, Math.floor((top - HEADER_HEIGHT) / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN);
  const out: ReactNode[] = [];
  for (let i = first; i < last; i++) out.push(<Row key={rows[i]!.rec.id} row={rows[i]!} top={i * ROW_HEIGHT} a={assessments} basis={basis} selected={rows[i]!.rec.id === selectedId} onSelect={onSelect} />);
  return (
    <div ref={scroller} onScroll={onScroll} data-testid="rec-scroller" style={{ height, overflow: "auto", position: "relative", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }}>
      <div style={{ position: "sticky", top: 0, zIndex: 3, display: "flex", width: TOTAL, height: HEADER_HEIGHT, alignItems: "center", background: "#eceff1", borderBottom: `1px solid ${PALETTE.line}`, fontWeight: 600 }}>
        {COLUMNS.map((c) => (
          <div key={c.key} style={cell(c)}>
            {c.label}
          </div>
        ))}
      </div>
      <div style={{ position: "relative", width: TOTAL, height: rows.length * ROW_HEIGHT }}>
        {out}
        {rows.length === 0 && <div style={{ padding: 16, color: PALETTE.muted, position: "absolute" }}>No components match these filters.</div>}
      </div>
    </div>
  );
}
