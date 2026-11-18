/**
 * 3D marks of the reuse workspace (C2). It reuses the B4 / B5 tint highlight (translucent tints on the EXISTING meshes and instanced
 * batches: no second viewer, no duplicate geometry, nothing written to a record, a material or a visibility), so floor isolation,
 * layers, X-ray, sections and the exploded view keep working. Marks: strong candidates green, conditional amber, confirmed
 * allocations blue. The selected component is marked by the normal selection outline. The marks exist only while the workspace is
 * open (folded or not) and are removed when it closes.
 */

import { useEffect } from "react";
import type { Match } from "@/engine/scenarios";
import { scenarioStore } from "../scenarios/scenarioStore";
import { useWorkspace } from "./hooks";
import { useReuse } from "./reuseStore";
import { TINT } from "./ui";

export function HighlightSync() {
  const { active, result } = useWorkspace();
  const { allocations, show3d, open } = useReuse();

  useEffect(() => {
    if (!open || show3d === "off") {
      if (scenarioStore.get().highlight?.owner === "reuse") scenarioStore.setHighlight(null);
      return;
    }
    const marks = new Map<string, Match>();
    let label = "";
    if (show3d === "candidates" && active && result) {
      for (const c of result.conditional) marks.set(c.id, { id: c.id, outcome: "refurbish_reuse", colour: TINT.conditional });
      for (const c of result.strong) marks.set(c.id, { id: c.id, outcome: "direct_reuse", colour: TINT.strong });
      label = `${active.name}: ${result.strong.length.toLocaleString("en-US")} strong · ${result.conditional.length.toLocaleString("en-US")} conditional candidates`;
    }
    const mine = show3d === "candidates" ? allocations.filter((a) => a.requirementId === active?.id) : allocations;
    for (const a of mine) marks.set(a.componentId, { id: a.componentId, outcome: "recycling", colour: TINT.allocated });
    if (show3d === "allocated") label = `All confirmed allocations: ${new Set(mine.map((a) => a.componentId)).size} components`;
    else if (mine.length) label += ` · ${mine.length} allocated`;
    if (marks.size === 0) {
      if (scenarioStore.get().highlight?.owner === "reuse") scenarioStore.setHighlight(null);
      return;
    }
    scenarioStore.setHighlight({ scenarioId: "", selector: {}, label, owner: "reuse", matches: [...marks.values()] });
  }, [open, show3d, active, result, allocations]);

  // leaving the workspace removes the marks
  useEffect(
    () => () => {
      if (scenarioStore.get().highlight?.owner === "reuse") scenarioStore.setHighlight(null);
    },
    [],
  );
  return null;
}
