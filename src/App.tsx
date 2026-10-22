/**
 * ReLoop India — Main application.
 *
 * A1: parametric G+4 structural frame. The dev ID inspector (click a member to see and
 * outline its ID) is compiled out of production builds.
 *
 * URL params (all optional): ?view=full|top|stair|section  ?select=<component id>
 */

import { useCallback, useMemo, useState } from "react";
import { DEFAULT_CONFIG } from "@/building/config";
import { registry } from "@/building/registry";
import { getStructure } from "@/building/structure";
import { Viewer } from "@/scene/Viewer";
import { IdInspector } from "@/scene/IdInspector";
import type { ViewName } from "@/scene/framing";

const VIEWS: readonly ViewName[] = ["full", "top", "stair", "section"];

// Generate once (memoised per config object) and register once; the viewer renders
// these same records, so registry and meshes cannot diverge.
const records = getStructure(DEFAULT_CONFIG);
registry.clear();
registry.registerAll(records);

function readParams(): { view: ViewName; select: string | null } {
  const q = new URLSearchParams(window.location.search);
  const v = q.get("view") as ViewName | null;
  const sel = q.get("select");
  return {
    view: v && VIEWS.includes(v) ? v : "full",
    select: sel && registry.getById(sel) ? sel : null,
  };
}

export default function App() {
  const params = useMemo(readParams, []);
  const [selectedId, setSelectedId] = useState<string | null>(params.select);
  const handleSelect = useCallback((id: string | null) => setSelectedId(id), []);
  const dev = import.meta.env.DEV;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <Viewer
        records={records}
        view={params.view}
        onSelect={dev ? handleSelect : undefined}
        selectedId={dev ? selectedId : null}
      />
      {dev && <IdInspector selectedId={selectedId} />}
    </div>
  );
}
