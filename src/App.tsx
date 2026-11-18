/**
 * ReLoop India — Main application.
 *
 * A1 structural frame + A2 architecture + A3 MEP, generated once from the building config and
 * registered once; the viewer renders these same records, so registry and meshes cannot
 * diverge. Click any component to inspect it. The interface is a dashboard shell (src/ui/shell): top bar with one tab per
 * workspace, a scene sidebar (layers, floors, exploded view, selection), the 3D viewport and a dock for the open workspace.
 *
 * URL params (all optional): ?view=hero|full|top|stair|section  ?select=<component id>
 *   ?isolate=L0..L4|ROOF|FDN  ?ceilings=1  ?hide=<layer>,<layer>  ?clip=x|y|z:<value> (section)
 */

import { useCallback, useMemo, useState } from "react";
import { DEFAULT_CONFIG } from "@/building/config";
import { registry } from "@/building/registry";
import { getStructure } from "@/building/structure";
import { getArchitecture } from "@/building/architecture/generate";
import { getMep } from "@/building/mep/generate";
import { Viewer } from "@/scene/Viewer";
import { PresentationMode } from "@/scene/presentation/PresentationMode";
import { Shell } from "@/ui/shell/Shell";
import { TopBar } from "@/ui/shell/TopBar";
import { SceneSidebar } from "@/ui/shell/SceneSidebar";
import { WorkspaceView } from "@/ui/shell/WorkspaceView";
import type { ClipSpec, ViewName } from "@/scene/framing";
import type { FloorKey } from "@/scene/SceneHierarchy";
import { FLOOR_ORDER } from "@/scene/sceneTree";
import { DEFAULT_VIEW, LAYERS, type LayerKey, type ViewState } from "@/scene/viewState";

const VIEWS: readonly ViewName[] = ["full", "hero", "top", "stair", "section"];

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
    view: v && VIEWS.includes(v) ? v : "hero", // no ?view= : the presentation hero view (?view=full keeps the original north-east oblique)
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
  // The section plane is app state so presentation mode can set and restore it; undefined = the view's own (?view=section|stair).
  const [clip, setClip] = useState<ClipSpec | null | undefined>(params.clip);
  const [presenting, setPresenting] = useState(false);
  const handleSelect = useCallback((id: string | null) => setSelectedId(id), []);
  const reset = useCallback(() => {
    setViewState(DEFAULT_VIEW);
    setSelectedId(null);
    setTrace([]);
  }, []);

  return (
    <Shell
      presenting={presenting}
      top={<TopBar componentCount={registry.size} onReset={reset} resetDisabled={viewState === DEFAULT_VIEW} onPresent={() => setPresenting(true)} />}
      sidebar={(folded) => <SceneSidebar view={viewState} onChange={setViewState} selectedId={selectedId} onSelect={handleSelect} onTrace={setTrace} traced={trace.length} folded={folded} />}
      workspace={(id) => <WorkspaceView id={id} selectedId={selectedId} onSelect={handleSelect} view={viewState} onViewChange={setViewState} />}
    >
      <Viewer records={records} view={params.view} viewState={viewState} onSelect={handleSelect} selectedId={selectedId} onViewState={setViewState} clipOverride={clip} traceIds={trace} />
      {presenting && (
        <PresentationMode
          records={records}
          viewState={viewState}
          onViewState={setViewState}
          clip={clip}
          onClip={setClip}
          selectedId={selectedId}
          onSelect={handleSelect}
          onTrace={setTrace}
          traced={trace.length}
          onExit={() => setPresenting(false)}
        />
      )}
    </Shell>
  );
}
