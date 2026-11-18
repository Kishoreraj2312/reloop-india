/**
 * Layer and floor controls (the content of the sidebar's Layers and Floors tabs). The same inputs, test ids and data attributes the
 * old controls panel had: layer checkboxes (data-layer), MEP category checkboxes (data-mep), X-ray, the floor isolation select,
 * per-floor checkboxes (data-floor) and the ceilings toggle. They only edit the view state; nothing here touches the model.
 */

import type { FloorKey } from "@/scene/SceneHierarchy";
import { FLOOR_ORDER } from "@/scene/sceneTree";
import { LAYERS, LAYER_LABELS, MEP_CATEGORY_LABELS, type LayerKey, type ViewState } from "@/scene/viewState";
import { ELECTRICAL_CATEGORIES, PLUMBING_CATEGORIES } from "@/building/structure";

export const FLOOR_LABELS: Record<FloorKey, string> = { FDN: "Foundation", L0: "Ground", L1: "F01", L2: "F02", L3: "F03", L4: "F04", ROOF: "Roof" };
const FLOOR_LEVEL: Record<FloorKey, string> = { FDN: "FDN", L0: "L0", L1: "L1", L2: "L2", L3: "L3", L4: "L4", ROOF: "ROOF" };

const SERVICES: readonly LayerKey[] = ["plumbing", "electrical"];
const BUILDING = LAYERS.filter((l) => !SERVICES.includes(l));

interface Props {
  view: ViewState;
  onChange: (v: ViewState) => void;
}

export function LayersPanel({ view, onChange }: Props) {
  const row = (l: LayerKey) => (
    <label key={l} className="sh-row">
      <input type="checkbox" data-layer={l} checked={view.layers[l] !== false} onChange={(e) => onChange({ ...view, layers: { ...view.layers, [l]: e.target.checked } })} />
      <span className="grow">{LAYER_LABELS[l]}</span>
    </label>
  );
  return (
    <>
      <section className="sh-card">
        <div className="rm-heading">Building</div>
        {BUILDING.map(row)}
      </section>
      <section className="sh-card">
        <div className="rm-heading">Services</div>
        {(["plumbing", "electrical"] as const).map((sys) => {
          const cats = sys === "plumbing" ? PLUMBING_CATEGORIES : ELECTRICAL_CATEGORIES;
          return (
            <div key={sys}>
              {row(sys)}
              {view.layers[sys] && (
                <div className="sh-chips">
                  {cats.map((c) => (
                    <label key={c} className="sh-chip">
                      <input type="checkbox" data-mep={c} checked={!view.mepOff?.[c]} onChange={(e) => onChange({ ...view, mepOff: { ...view.mepOff, [c]: !e.target.checked } })} />
                      {MEP_CATEGORY_LABELS[c]}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
      <section className="sh-card">
        <div className="rm-heading">Display</div>
        <label className="sh-row" title="Ghost the building so the services read through it">
          <input type="checkbox" data-testid="xray" checked={!!view.xray} onChange={(e) => onChange({ ...view, xray: e.target.checked })} />
          <span className="grow">MEP X-ray (ghost building)</span>
        </label>
      </section>
    </>
  );
}

export function FloorsPanel({ view, onChange }: Props) {
  const floors = [...FLOOR_ORDER].reverse(); // the roof on top, as in a section
  return (
    <>
      <section className="sh-card">
        <div className="rm-heading">Isolate</div>
        <label className="sh-field">
          <span>isolate</span>
          <select data-testid="isolate" className="rm-select" value={view.isolate ?? ""} onChange={(e) => onChange({ ...view, isolate: (e.target.value || null) as FloorKey | null })}>
            <option value="">— whole building —</option>
            {FLOOR_ORDER.map((f) => (
              <option key={f} value={f}>
                {FLOOR_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
        {view.isolate ? (
          <>
            <div className="sh-card-note">Showing {FLOOR_LABELS[view.isolate]} only. Choose “whole building” to see every floor again.</div>
            <label className="sh-row">
              <input type="checkbox" data-testid="ceilings" checked={view.ceilingsInIsolation} onChange={(e) => onChange({ ...view, ceilingsInIsolation: e.target.checked })} />
              <span className="grow">show ceilings</span>
            </label>
          </>
        ) : (
          <div className="sh-card-note">Show a single floor as a cutaway, or leave the whole building and switch floors on and off below.</div>
        )}
      </section>
      {!view.isolate && (
        <section className="sh-card">
          <div className="rm-heading">Floors</div>
          <div className="sh-floorlist">
            {floors.map((f) => (
              <label key={f} className="sh-floor">
                <input type="checkbox" data-floor={f} checked={view.floors[f]} onChange={(e) => onChange({ ...view, floors: { ...view.floors, [f]: e.target.checked } })} />
                {FLOOR_LABELS[f]}
                <span className="lvl">{FLOOR_LEVEL[f]}</span>
              </label>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
