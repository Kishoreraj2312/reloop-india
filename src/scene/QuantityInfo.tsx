/**
 * Takeoff block of the component inspector (B1). Everything shown comes from the quantity engine's
 * memoised inventory; nothing is computed here.
 */

import { useEffect, useMemo } from "react";
import {
  assemblyRollup,
  CATEGORY_LABELS,
  formatValue,
  getModelInventory,
  UNIT_LABEL,
  type QuantityResult,
  type Unit,
} from "@/engine/quantities";
import { PALETTE, StatusChip } from "./inventory/ui";

const KIND_NAME: Record<QuantityResult["kind"], string> = { volume: "volume", area: "area", length: "length", count: "count", mass: "mass" };
const UNIT_ORDER: readonly Unit[] = ["m3", "m2", "m", "nr", "kg"];

const q = (r: QuantityResult) => `${formatValue(r.value, r.unit)} ${r.value === null ? "" : UNIT_LABEL[r.unit]}`.trim();
const muted = { opacity: 0.6, fontSize: 11 } as const;

/** Builds the (memoised) inventory when the browser is idle, so the first selection does not pay for it. */
export function usePrewarmInventory(): void {
  useEffect(() => {
    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const h = idle ? idle(() => void getModelInventory(), { timeout: 4000 }) : window.setTimeout(() => void getModelInventory(), 2000);
    return () => (idle ? (window as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback?.(h) : window.clearTimeout(h));
  }, []);
}

export function QuantityInfo({ id }: { id: string }) {
  const inv = getModelInventory();
  const cq = inv.byId.get(id);
  const rec = inv.recordById.get(id);
  const roll = useMemo(() => (rec?.geometry.kind === "group" ? assemblyRollup(inv, id) : undefined), [inv, id, rec]);
  if (!cq || !rec) return null;

  const issues = [...cq.primary.issues, ...cq.secondary.flatMap((s) => s.issues), ...cq.mass.issues].filter((i) => i.severity === "warning");

  if (roll) {
    const products = roll.counts.filter((c) => !c.segments && (c.result.value ?? 0) > 0);
    const w = roll.wall;
    return (
      <div data-testid="quantity-info" style={{ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${PALETTE.line}` }}>
        <div>
          <span style={{ opacity: 0.55 }}>takeoff: </span>assembly · {roll.leafCount} parts counted
        </div>
        {UNIT_ORDER.map((u) => {
          const t = roll.totals.totals[u];
          if (!t) return null;
          return (
            <div key={u} data-testid={`rollup-${u}`}>
              <span style={{ opacity: 0.55 }}>{u === "kg" ? "mass" : u === "nr" ? "items (nr)" : `Σ ${UNIT_LABEL[u]}`}: </span>
              {t.value === null ? "Not available" : `${formatValue(t.value, u)} ${UNIT_LABEL[u]}`} <StatusChip status={t.status} />
              {t.incompleteCount > 0 && <span style={muted}> partial: {t.incompleteCount} parts have no value</span>}
            </div>
          );
        })}
        {products.length > 0 && (
          <div>
            <span style={{ opacity: 0.55 }}>products: </span>
            {products.map((c) => `${c.label.toLowerCase()} ${c.result.value}`).join(", ")}
          </div>
        )}
        {w && (
          <div data-testid="wall-takeoff">
            <div>
              <span style={{ opacity: 0.55 }}>wall net / gross: </span>
              {q(w.net)} / {q(w.gross)} <StatusChip status={w.gross.status} />
            </div>
            <div style={muted}>
              lintel {q(w.lintel)} · openings {w.openings.length} ({q(w.voids)}) · face {q(w.grossFaceArea)}
            </div>
            <div style={muted}>{w.gross.method}</div>
          </div>
        )}
        <div style={muted}>{cq.primary.method}</div>
        {issues.map((i, k) => (
          <div key={k} style={{ color: PALETTE.warn }}>
            ⚠ {i.code}: {i.message}
          </div>
        ))}
      </div>
    );
  }

  const noMass = cq.mass.value === null ? cq.mass.issues[0]?.message : undefined;
  return (
    <div data-testid="quantity-info" style={{ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${PALETTE.line}` }}>
      <div>
        <span style={{ opacity: 0.55 }}>category: </span>
        {CATEGORY_LABELS[cq.category]}
      </div>
      <div data-testid="takeoff-primary">
        <span style={{ opacity: 0.55 }}>takeoff {KIND_NAME[cq.primary.kind]}: </span>
        {q(cq.primary)} <StatusChip status={cq.primary.status} />
      </div>
      {cq.secondary.map((s) => (
        <div key={s.unit}>
          <span style={{ opacity: 0.55 }}>also {KIND_NAME[s.kind]}: </span>
          {q(s)} <StatusChip status={s.status} />
        </div>
      ))}
      <div data-testid="takeoff-mass">
        <span style={{ opacity: 0.55 }}>mass: </span>
        {cq.mass.value === null ? "Not available" : q(cq.mass)} <StatusChip status={cq.mass.status} />
        {noMass && <div style={muted}>{noMass}</div>}
      </div>
      <div style={muted}>method: {cq.primary.method}</div>
      {cq.mass.value !== null && <div style={muted}>mass method: {cq.mass.method}</div>}
      {cq.mass.value !== null && cq.mass.assumptions.map((a, k) => (
        <div key={k} style={muted}>
          · {a}
        </div>
      ))}
      {cq.primary.assumptions.map((a, k) => (
        <div key={`p${k}`} style={muted}>
          · {a}
        </div>
      ))}
      {issues.map((i, k) => (
        <div key={k} style={{ color: PALETTE.warn }}>
          ⚠ {i.code}: {i.message}
        </div>
      ))}
    </div>
  );
}
