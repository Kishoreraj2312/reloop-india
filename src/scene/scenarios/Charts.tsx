/**
 * Small charts for the scenario workspace (B4): plain CSS/HTML, no library. One mark type: a horizontal stacked bar of the
 * five outcomes as shares of the available quantity (so bars of different units are never compared on one axis), thin
 * (≤ 24 px), a 2 px surface gap between segments, a rounded data end, a hatch for unknown, and a tooltip + aria-label on every
 * segment. The numbers are always in the tables next to it.
 */

import type { PathwayQuantities } from "@/engine/scenarios";
import { OUTCOME_ORDER, PATHWAY_LABELS, type Pathway } from "@/engine/scenarios";
import { formatValue, UNIT_LABEL, type Unit } from "@/engine/quantities";
import { PALETTE } from "../inventory/ui";
import { outcomeFill } from "./colors";

export function StackedBar({
  outcome,
  available,
  unit,
  height = 14,
  width,
  selected,
  onPick,
  testid,
}: {
  outcome: PathwayQuantities;
  available: number;
  unit: Unit;
  height?: number;
  width?: number | string;
  selected?: Pathway | null;
  onPick?: (p: Pathway) => void;
  testid?: string;
}) {
  const total = OUTCOME_ORDER.reduce((n, p) => n + outcome[p], 0);
  const label = OUTCOME_ORDER.map((p) => `${PATHWAY_LABELS[p]} ${formatValue(outcome[p], unit)} ${UNIT_LABEL[unit]}`).join(", ");
  return (
    <div data-testid={testid} role="img" aria-label={`Outcome of ${formatValue(available, unit)} ${UNIT_LABEL[unit]}: ${label}`} style={{ display: "flex", gap: 2, width: width ?? "100%", height, background: total > 0 ? "transparent" : "#eceff1", borderRadius: 4, overflow: "hidden" }}>
      {total > 0 &&
        OUTCOME_ORDER.filter((p) => outcome[p] > 0).map((p) => (
          <div
            key={p}
            data-outcome={p}
            title={`${PATHWAY_LABELS[p]}: ${formatValue(outcome[p], unit)} ${UNIT_LABEL[unit]} (${((outcome[p] / total) * 100).toFixed(1)}%)`}
            onClick={onPick ? () => onPick(p) : undefined}
            style={{ flex: `${outcome[p]} 1 0`, minWidth: 2, background: outcomeFill(p), cursor: onPick ? "pointer" : "default", outline: selected === p ? `2px solid ${PALETTE.text}` : "none", outlineOffset: -1 }}
          />
        ))}
    </div>
  );
}

export function Legend({ only }: { only?: readonly Pathway[] }) {
  return (
    <div data-testid="scenario-legend" style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: 11, color: PALETTE.muted }}>
      {OUTCOME_ORDER.filter((p) => !only || only.includes(p)).map((p) => (
        <span key={p} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: outcomeFill(p), display: "inline-block", flex: "none" }} />
          {PATHWAY_LABELS[p]}
        </span>
      ))}
    </div>
  );
}
