/**
 * 3D marks of the tracking workspace (C3). It reuses the B4 / B5 / C2 tint highlight (translucent tints on the EXISTING meshes and instanced
 * batches: no second viewer, no geometry, nothing written to a record, material or visibility). The marks follow the register: the listed
 * components, coloured by stage (sky blue planned, orange in progress, yellow recovered / inspected / allocated, green reused, blue recycled,
 * vermillion disposed, grey on hold; pale for planned but not tracked) or, in "flags" mode, only those with a warning or an error. The selected
 * component is marked by the normal selection outline. The marks exist only while the workspace is open (folded or not).
 */

import { useEffect } from "react";
import type { Match } from "@/engine/scenarios";
import { scenarioStore } from "../scenarios/scenarioStore";
import { FLAG_TINT, STAGE_TINT, UNTRACKED_TINT } from "./colors";
import { useWorkspace } from "./hooks";
import type { RegisterModel } from "./registerModel";
import { useTracking } from "./trackingStore";

export function HighlightSync({ model }: { model: RegisterModel }) {
  const ws = useWorkspace();
  const { open, show3d } = useTracking();

  useEffect(() => {
    const release = () => {
      if (scenarioStore.get().highlight?.owner === "tracking") scenarioStore.setHighlight(null);
    };
    if (!open || show3d === "off") return release();
    const marks: Match[] = [];
    let tracked = 0;
    let planned = 0;
    for (const it of model.items) {
      const row = ws.rowById.get(it.id);
      if (row) {
        tracked++;
        if (show3d === "status") marks.push({ id: it.id, outcome: "unknown", colour: STAGE_TINT[row.summary.status] });
        else {
          const level = row.summary.flags.some((f) => f.level === "error") ? "error" : row.summary.flags.some((f) => f.level === "warning") ? "warning" : null;
          if (level) marks.push({ id: it.id, outcome: "unknown", colour: FLAG_TINT[level] });
        }
      } else if (show3d === "status" && ws.scope.has(it.id)) {
        planned++;
        marks.push({ id: it.id, outcome: "unknown", colour: UNTRACKED_TINT });
      }
    }
    if (marks.length === 0) return release();
    const label = show3d === "status" ? `Recovery stage: ${tracked.toLocaleString("en-US")} tracked${planned ? ` · ${planned.toLocaleString("en-US")} planned, not started` : ""}` : `Records needing attention: ${marks.length.toLocaleString("en-US")}`;
    scenarioStore.setHighlight({ scenarioId: "", selector: {}, label, owner: "tracking", matches: marks });
  }, [open, show3d, model.items, ws.rowById, ws.scope]);

  useEffect(
    () => () => {
      if (scenarioStore.get().highlight?.owner === "tracking") scenarioStore.setHighlight(null);
    },
    [],
  );
  return null;
}
