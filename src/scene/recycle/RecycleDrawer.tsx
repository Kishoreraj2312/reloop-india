/**
 * Recycle workspace: six material groups with short suggestions for how each can be recycled, and what the model holds of each.
 * General guidance for orientation, not an assessment: it enters nothing into the other modules and changes nothing in the model.
 */

import { useMemo, useState } from "react";
import { getModelInventory } from "@/engine/quantities";
import { PALETTE } from "../inventory/ui";
import { RECYCLE_GROUPS, groupTotals } from "./recycleGuide";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function RecycleDrawer({ onClose }: { onClose: () => void }) {
  const totals = useMemo(() => groupTotals(getModelInventory()), []);
  const [openId, setOpenId] = useState<string>(RECYCLE_GROUPS[0]!.id);
  return (
    <div data-testid="recycle-drawer" style={{ flex: "1 1 auto", minHeight: 0, width: "100%", display: "flex", flexDirection: "column", background: PALETTE.panel, color: PALETTE.text, font: "12.5px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif", fontVariantNumeric: "tabular-nums" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${PALETTE.line}`, background: "#fff" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Recycling suggestions</div>
          <div style={{ fontSize: 11, color: PALETTE.muted }}>How the main materials can be recycled. General guidance, not an assessment of this building's material.</div>
        </div>
        <button type="button" data-testid="recycle-close" onClick={onClose} title="Close" style={{ font: "inherit", fontSize: 16, border: "none", background: "none", cursor: "pointer", color: PALETTE.muted }}>
          ✕
        </button>
      </div>
      <div data-testid="recycle-body" style={{ flex: 1, overflowY: "auto", padding: "10px 14px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
        {RECYCLE_GROUPS.map((g) => {
          const t = totals.get(g.id);
          const open = openId === g.id;
          return (
            <section key={g.id} data-testid={`recycle-${g.id}`} data-open={open ? "true" : "false"} style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 8, overflow: "hidden" }}>
              <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? "" : g.id)} style={{ all: "unset", boxSizing: "border-box", display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{g.name}</span>
                  <span style={{ display: "block", fontSize: 12, color: PALETTE.accent }}>{g.route}</span>
                </span>
                {t && t.components > 0 && (
                  <span style={{ fontSize: 11, color: PALETTE.muted, textAlign: "right", whiteSpace: "nowrap" }}>
                    {nf.format(t.components)} components
                    <span style={{ display: "block" }}>{t.massReliable ? `≈ ${nf.format(t.tonnes)} t` : "mass not estimated"}</span>
                  </span>
                )}
                <span aria-hidden="true" style={{ color: PALETTE.muted }}>{open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <div style={{ padding: "0 12px 12px", borderTop: `1px solid ${PALETTE.line}` }}>
                  <div style={{ fontSize: 10, letterSpacing: 0.5, color: PALETTE.muted, margin: "10px 0 4px", fontWeight: 600 }}>HOW IT CAN BE RECYCLED</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {g.ways.map((w) => (
                      <li key={w} style={{ margin: "2px 0" }}>{w}</li>
                    ))}
                  </ul>
                  <div style={{ fontSize: 10, letterSpacing: 0.5, color: PALETTE.muted, margin: "10px 0 4px", fontWeight: 600 }}>WATCH FOR</div>
                  <div style={{ color: PALETTE.warn }}>{g.watch}</div>
                  {t && t.components > 0 && (
                    <div style={{ marginTop: 10, fontSize: 11, color: PALETTE.muted }}>
                      In this model: {nf.format(t.components)} components
                      {t.massReliable
                        ? `, about ${nf.format(t.tonnes)} t (B1 estimate from material density and modelled volume${t.withMass < t.components ? `; ${nf.format(t.withMass)} of them have a mass estimate` : ""}).`
                        : `. B1 has a mass estimate for only ${nf.format(t.withMass)} of them (hollow and catalogue parts have none), so no total is shown.`}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
        <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 4 }}>
          Suggestions are common practice, for orientation only. What is possible depends on the material's condition, local rules and the recycling plants within reach.
        </div>
      </div>
    </div>
  );
}
