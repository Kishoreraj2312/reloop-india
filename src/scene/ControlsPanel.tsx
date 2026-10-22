/**
 * Minimal layer / floor controls: layer toggles, per-floor visibility, isolate floor,
 * ceilings toggle for cutaway, and one "Reset view" action.
 */

import type { FloorKey } from "./SceneHierarchy";
import { FLOOR_ORDER } from "./sceneTree";
import { DEFAULT_VIEW, LAYERS, LAYER_LABELS, type ViewState } from "./viewState";

const FLOOR_LABELS: Record<FloorKey, string> = { FDN: "Foundation", L0: "Ground", L1: "F01", L2: "F02", L3: "F03", L4: "F04", ROOF: "Roof" };

export function ControlsPanel({ view, onChange, onReset }: { view: ViewState; onChange: (v: ViewState) => void; onReset: () => void }) {
  return (
    <div data-testid="controls" style={panel}>
      <div style={{ opacity: 0.55, fontSize: 10, letterSpacing: 0.4, marginBottom: 4 }}>LAYERS</div>
      {LAYERS.map((l) => (
        <label key={l} style={row}>
          <input type="checkbox" data-layer={l} checked={view.layers[l]} onChange={(e) => onChange({ ...view, layers: { ...view.layers, [l]: e.target.checked } })} />
          {LAYER_LABELS[l]}
        </label>
      ))}
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
    </div>
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
