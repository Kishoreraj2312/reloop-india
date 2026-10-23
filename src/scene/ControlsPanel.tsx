/**
 * Minimal layer / floor controls: layer toggles, per-floor visibility, isolate floor,
 * ceilings toggle for cutaway, and one "Reset view" action.
 */

import { useState } from "react";
import type { FloorKey } from "./SceneHierarchy";
import { DRAWER_WIDTH, InventoryDrawer } from "./inventory/InventoryDrawer";
import { RecoveryDrawer } from "./recovery/RecoveryDrawer";
import { recoveryStore, useRecovery } from "./recovery/recoveryStore";
import { FLOOR_ORDER } from "./sceneTree";
import { DEFAULT_VIEW, LAYERS, LAYER_LABELS, MEP_CATEGORY_LABELS, type ViewState } from "./viewState";
import { ELECTRICAL_CATEGORIES, PLUMBING_CATEGORIES } from "@/building/structure";

const FLOOR_LABELS: Record<FloorKey, string> = { FDN: "Foundation", L0: "Ground", L1: "F01", L2: "F02", L3: "F03", L4: "F04", ROOF: "Roof" };

export function ControlsPanel({ view, onChange, onReset, onSelect, selectedId }: { view: ViewState; onChange: (v: ViewState) => void; onReset: () => void; onSelect: (id: string | null) => void; selectedId: string | null }) {
  const [inventoryOpen, setInventoryOpen] = useState(false); // local: opening the drawer never touches the scene
  const recoveryOpen = useRecovery().open; // the drawer can also be opened from the inspector
  const drawerOpen = inventoryOpen || recoveryOpen;
  return (
    <>
    <div data-testid="controls" style={drawerOpen ? { ...panel, right: DRAWER_WIDTH + 12 } : panel}>
      <div style={{ opacity: 0.55, fontSize: 10, letterSpacing: 0.4, marginBottom: 4 }}>LAYERS</div>
      {LAYERS.map((l) => (
        <label key={l} style={row}>
          <input type="checkbox" data-layer={l} checked={view.layers[l] !== false} onChange={(e) => onChange({ ...view, layers: { ...view.layers, [l]: e.target.checked } })} />
          {LAYER_LABELS[l]}
        </label>
      ))}
      {([["plumbing", PLUMBING_CATEGORIES], ["electrical", ELECTRICAL_CATEGORIES]] as const).map(([sys, cats]) =>
        view.layers[sys] ? (
          <div key={sys} style={{ display: "flex", flexWrap: "wrap", gap: "0 8px", paddingLeft: 18, fontSize: 11 }}>
            {cats.map((c) => (
              <label key={c} style={row}>
                <input type="checkbox" data-mep={c} checked={!view.mepOff?.[c]} onChange={(e) => onChange({ ...view, mepOff: { ...view.mepOff, [c]: !e.target.checked } })} />
                {MEP_CATEGORY_LABELS[c]}
              </label>
            ))}
          </div>
        ) : null,
      )}
      <label style={row}>
        <input type="checkbox" data-testid="xray" checked={!!view.xray} onChange={(e) => onChange({ ...view, xray: e.target.checked })} />
        MEP X-ray (ghost building)
      </label>
      <div style={{ opacity: 0.55, fontSize: 10, letterSpacing: 0.4, margin: "8px 0 4px" }}>FLOORS</div>
      <label style={row}>
        isolate
        <select data-testid="isolate" value={view.isolate ?? ""} onChange={(e) => onChange({ ...view, isolate: (e.target.value || null) as FloorKey | null })} style={{ font: "inherit" }}>
          <option value="">— whole building —</option>
          {FLOOR_ORDER.map((f) => (
            <option key={f} value={f}>
              {FLOOR_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      {!view.isolate &&
        FLOOR_ORDER.map((f) => (
          <label key={f} style={row}>
            <input type="checkbox" data-floor={f} checked={view.floors[f]} onChange={(e) => onChange({ ...view, floors: { ...view.floors, [f]: e.target.checked } })} />
            {FLOOR_LABELS[f]}
          </label>
        ))}
      {view.isolate && (
        <label style={row}>
          <input type="checkbox" data-testid="ceilings" checked={view.ceilingsInIsolation} onChange={(e) => onChange({ ...view, ceilingsInIsolation: e.target.checked })} />
          show ceilings
        </label>
      )}
      <button data-testid="reset" onClick={onReset} disabled={view === DEFAULT_VIEW} style={{ marginTop: 8, font: "inherit", width: "100%" }}>
        Reset view
      </button>
      <button data-testid="inventory-toggle" onClick={() => { recoveryStore.setOpen(false); setInventoryOpen((o) => !o); }} aria-pressed={inventoryOpen} style={{ marginTop: 4, font: "inherit", width: "100%", fontWeight: inventoryOpen ? 700 : 400 }}>
        Inventory
      </button>
      <button data-testid="recovery-toggle" onClick={() => { setInventoryOpen(false); recoveryStore.setOpen(!recoveryOpen); }} aria-pressed={recoveryOpen} style={{ marginTop: 4, font: "inherit", width: "100%", fontWeight: recoveryOpen ? 700 : 400 }}>
        Recovery
      </button>
    </div>
    {inventoryOpen && !recoveryOpen && <InventoryDrawer onClose={() => setInventoryOpen(false)} onSelect={onSelect} selectedId={selectedId} />}
    {recoveryOpen && <RecoveryDrawer onClose={() => recoveryStore.setOpen(false)} onSelect={onSelect} selectedId={selectedId} />}
    </>
  );
}

const panel = {
  position: "absolute",
  top: 12,
  right: 12,
  padding: "8px 12px",
  font: "12px/1.6 system-ui, sans-serif",
  color: "#1f2933",
  background: "rgba(255,255,255,0.9)",
  border: "1px solid #c3c8cd",
  borderRadius: 6,
  width: 190,
} as const;

const row = { display: "flex", alignItems: "center", gap: 6, cursor: "pointer" } as const;
