/** Summary cards, the "not modelled" list and the issue list. Values come from the engine's buildSummary. */

import { NOT_MODELLED, unitLabel, type Inventory, type RowFilter, type Summary, type SummaryCard } from "@/engine/quantities";
import { PALETTE, StatusChip } from "./ui";

const sameFilter = (a: RowFilter | null, b: RowFilter | null) => a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);

function Card({ card, active, onPick }: { card: SummaryCard; active: boolean; onPick: (c: SummaryCard) => void }) {
  const unavailable = card.value === null;
  const partial = card.incompleteCount > 0 && card.key !== "mass";
  return (
    <button
      type="button"
      data-testid={`inv-card-${card.key}`}
      disabled={card.filter === null}
      onClick={() => onPick(card)}
      title={unavailable ? `Not available: ${card.reason ?? "no value"}` : card.note}
      style={{
        textAlign: "left",
        font: "inherit",
        padding: "8px 10px",
        background: active ? "#fdeee6" : "#fff",
        border: `1px solid ${active ? PALETTE.accent : PALETTE.line}`,
        borderRadius: 5,
        cursor: card.filter === null ? "default" : "pointer",
        color: PALETTE.text,
        minWidth: 0,
      }}
    >
      <div style={{ color: PALETTE.muted, fontSize: 11 }}>{card.label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
        <span data-testid="inv-card-value" style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: unavailable ? PALETTE.muted : PALETTE.text }}>
          {card.display}
        </span>
        {!unavailable && <span style={{ color: PALETTE.muted }}>{unitLabel(card.unit)}</span>}
        <StatusChip status={card.status} />
        {partial && <span style={{ fontSize: 10, color: PALETTE.warn }} title={`${card.incompleteCount} components have no value`}>partial</span>}
      </div>
      {card.lines && (
        <div style={{ marginTop: 3, fontSize: 11 }}>
          {card.lines.map((l) => (
            <div key={l.label} style={{ display: "flex", justifyContent: "space-between", fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: PALETTE.muted }}>{l.label}</span>
              <span>{l.value}</span>
            </div>
          ))}
        </div>
      )}
      {card.note && <div style={{ marginTop: 3, fontSize: 10.5, color: PALETTE.muted }}>{card.note}</div>}
    </button>
  );
}

export function SummarySection({ inv, summary, filter, onPick, onSelect }: { inv: Inventory; summary: Summary; filter: RowFilter; onPick: (c: SummaryCard) => void; onSelect: (id: string) => void }) {
  const warnings = inv.issues.filter((i) => i.severity === "warning");
  return (
    <>
      <div data-testid="inv-cards" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {summary.cards.map((c) => (
          <Card key={c.key} card={c} active={sameFilter(c.filter, filter)} onPick={onPick} />
        ))}
      </div>
      <div style={{ marginTop: 10, color: PALETTE.muted, fontSize: 11 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Not modelled (never shown as 0)</div>
        <ul style={{ margin: 0, paddingLeft: 16 }} data-testid="inv-not-modelled">
          {NOT_MODELLED.map((n) => (
            <li key={n.key} title={n.reason}>
              {n.label} — {n.reason}
            </li>
          ))}
        </ul>
      </div>
      <div style={{ marginTop: 8, fontSize: 11 }}>
        <div style={{ fontWeight: 600, color: PALETTE.muted }}>Issues ({warnings.length})</div>
        {warnings.length === 0 && <div style={{ color: PALETTE.muted }}>None.</div>}
        {warnings.map((w, k) => (
          <div key={k} style={{ color: PALETTE.warn }}>
            {w.code}: {w.message}{" "}
            {w.componentId && (
              <button type="button" onClick={() => onSelect(w.componentId!)} style={{ font: "inherit", color: PALETTE.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                select
              </button>
            )}
          </div>
        ))}
        <div style={{ color: PALETTE.muted, marginTop: 2 }}>
          {(inv.issueCounts.NO_DENSITY ?? 0).toLocaleString()} components have no mass (hollow, assembled or schematic items: a solid box is not the product volume); see each row's Status.
        </div>
      </div>
    </>
  );
}
