/** Compact breakdown tables (concrete, masonry, finishes, counts). All numbers come from the engine. */

import { categoryCounts, concreteTable, finishesTable, formatValue, masonryTable, UNIT_LABEL, type BreakdownTable, type Inventory } from "@/engine/quantities";
import { PALETTE } from "./ui";

const th = { textAlign: "right" as const, padding: "2px 3px", fontWeight: 600, color: PALETTE.text, fontSize: 10.5, lineHeight: 1.25, verticalAlign: "bottom" as const, overflowWrap: "anywhere" as const };
const td = { textAlign: "right" as const, padding: "1px 3px", fontVariantNumeric: "tabular-nums" as const, fontSize: 11, whiteSpace: "nowrap" as const };
const fixed = { borderCollapse: "collapse" as const, width: "100%", tableLayout: "fixed" as const, background: "#fff", border: `1px solid ${PALETTE.line}` };

function Table({ t, testid }: { t: BreakdownTable; testid: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 3 }}>{t.title}</div>
      <table data-testid={testid} style={fixed}>
        <thead>
          <tr style={{ background: "#eceff1" }}>
            <th style={{ ...th, textAlign: "left", width: 38 }}>Floor</th>
            {t.columns.map((c) => (
              <th key={c.key} style={th}>
                {c.label} {c.unit && <span style={{ color: PALETTE.muted, fontWeight: 400 }}>{UNIT_LABEL[c.unit]}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r) => (
            <tr key={r.label} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
              <td style={{ ...td, textAlign: "left" }}>{r.label}</td>
              {r.values.map((v, i) => (
                <td key={i} style={td} title={v === null ? "Not available / none" : undefined}>
                  {v === null ? <span style={{ color: PALETTE.muted }}>–</span> : formatValue(v, t.columns[i]?.unit ?? "m3")}
                </td>
              ))}
            </tr>
          ))}
          <tr style={{ borderTop: `2px solid ${PALETTE.text}`, fontWeight: 700 }} data-testid={`${testid}-total`}>
            <td style={{ ...td, textAlign: "left" }}>Total</td>
            {t.totals.map((v, i) => (
              <td key={i} style={td}>
                {v === null ? <span style={{ color: PALETTE.muted }}>–</span> : formatValue(v, t.columns[i]?.unit ?? "m3")}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function BreakdownSection({ inv }: { inv: Inventory }) {
  const cc = categoryCounts(inv);
  return (
    <>
      <Table t={concreteTable(inv)} testid="inv-bd-concrete" />
      <div style={{ margin: "-8px 0 12px", fontSize: 10.5, color: PALETTE.muted }}>*Other = lintels, balcony slabs and kerbs, fins, bands, canopies, shaft caps and MEP plinths.</div>
      <Table t={masonryTable(inv)} testid="inv-bd-masonry" />
      <Table t={finishesTable(inv)} testid="inv-bd-finishes" />
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 3 }}>Counts by category (leaf components)</div>
        <table data-testid="inv-bd-categories" style={fixed}>
          <thead>
            <tr style={{ background: "#eceff1" }}>
              <th style={{ ...th, textAlign: "left" }}>Category</th>
              <th style={th}>Components</th>
              <th style={th}>With issues</th>
            </tr>
          </thead>
          <tbody>
            {cc.rows.map((r) => (
              <tr key={r.category} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
                <td style={{ ...td, textAlign: "left" }}>{r.label}</td>
                <td style={td}>{r.components.toLocaleString("en-US")}</td>
                <td style={td}>{r.warnings ? r.warnings : <span style={{ color: PALETTE.muted }}>–</span>}</td>
              </tr>
            ))}
            <tr style={{ borderTop: `2px solid ${PALETTE.text}`, fontWeight: 700 }} data-testid="inv-bd-categories-total">
              <td style={{ ...td, textAlign: "left" }}>Total</td>
              <td style={td}>{cc.total.toLocaleString("en-US")}</td>
              <td style={td} />
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 3 }}>Products and segments (counted by assembly, not by part)</div>
        <table data-testid="inv-bd-products" style={fixed}>
          <tbody>
            {inv.counts.map((c) => (
              <tr key={c.key} style={{ borderTop: `1px solid ${PALETTE.line}` }} title={c.result.method}>
                <td style={{ ...td, textAlign: "left" }}>{c.label}</td>
                <td style={td}>{(c.result.value ?? 0).toLocaleString("en-US")}</td>
                <td style={{ ...td, textAlign: "left", color: PALETTE.muted, fontSize: 11 }}>{c.segments ? "segments" : "nr"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
