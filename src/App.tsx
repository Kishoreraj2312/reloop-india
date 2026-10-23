/**
 * ReLoop India — Main application.
 *
 * A1 structural frame + A2 architecture + A3 MEP, generated once from the building config and
 * registered once; the viewer renders these same records, so registry and meshes cannot
 * diverge. Click any component to inspect it; the controls panel toggles layers and floors.
 *
 * URL params (all optional): ?view=full|top|stair|section  ?select=<component id>
 *   ?isolate=L0..L4|ROOF|FDN  ?ceilings=1  ?hide=<layer>,<layer>  ?clip=x|y|z:<value> (section)
 */

import { useCallback, useMemo, useState } from "react";
import { DEFAULT_CONFIG } from "@/building/config";
import { registry } from "@/building/registry";
import { getStructure } from "@/building/structure";
import { getArchitecture } from "@/building/architecture/generate";
import { getMep } from "@/building/mep/generate";
import { Viewer } from "@/scene/Viewer";
import { ComponentInspector } from "@/scene/ComponentInspector";
import { ControlsPanel } from "@/scene/ControlsPanel";
import type { ClipSpec, ViewName } from "@/scene/framing";
import type { FloorKey } from "@/scene/SceneHierarchy";
import { FLOOR_ORDER } from "@/scene/sceneTree";
import { DEFAULT_VIEW, LAYERS, type LayerKey, type ViewState } from "@/scene/viewState";

const VIEWS: readonly ViewName[] = ["full", "top", "stair", "section"];

const records = [...getStructure(DEFAULT_CONFIG), ...getArchitecture(DEFAULT_CONFIG).records, ...getMep(DEFAULT_CONFIG).records];
registry.clear();
registry.registerAll(records);

function readParams(): { view: ViewName; select: string | null; state: ViewState; clip?: ClipSpec } {
  const q = new URLSearchParams(window.location.search);
  const v = q.get("view") as ViewName | null;
  const sel = q.get("select");
  const iso = q.get("isolate") as FloorKey | null;
  const hide = (q.get("hide") ?? "").split(",").filter((x): x is LayerKey => (LAYERS as readonly string[]).includes(x));
  const state: ViewState =
    iso || hide.length || q.get("ceilings")
      ? {
          ...DEFAULT_VIEW,
          isolate: iso && FLOOR_ORDER.includes(iso) ? iso : null,
          ceilingsInIsolation: q.get("ceilings") === "1",
          layers: { ...DEFAULT_VIEW.layers, ...Object.fromEntries(hide.map((h) => [h, false])) },
        }
      : DEFAULT_VIEW;
  const cm = /^([xyz]):(-?[\d.]+)$/.exec(q.get("clip") ?? "");
  return {
    view: v && VIEWS.includes(v) ? v : "full",
    select: sel && registry.getById(sel) ? sel : null,
    state,
    ...(cm ? { clip: { axis: cm[1] as ClipSpec["axis"], value: Number(cm[2]) } } : {}),
  };
}

export default function App() {
  const params = useMemo(readParams, []);
  const [selectedId, setSelectedId] = useState<string | null>(params.select);
  const [viewState, setViewState] = useState<ViewState>(params.state);
  const [trace, setTrace] = useState<string[]>([]);
  const handleSelect = useCallback((id: string | null) => setSelectedId(id), []);
  const reset = useCallback(() => {
    setViewState(DEFAULT_VIEW);
    setSelectedId(null);
    setTrace([]);
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <Viewer records={records} view={params.view} viewState={viewState} onSelect={handleSelect} selectedId={selectedId} onViewState={setViewState} clipOverride={params.clip} traceIds={trace} />
      <ComponentInspector selectedId={selectedId} onSelect={handleSelect} onTrace={setTrace} traced={trace.length} />
      <ControlsPanel view={viewState} onChange={setViewState} onReset={reset} onSelect={handleSelect} selectedId={selectedId} />
    </div>
  );
}
