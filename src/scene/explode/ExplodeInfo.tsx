/** Inspector line (A4): where the selected component sits in the exploded view. Shown only while the panel is open. */

import { useMemo } from "react";
import { ASSEMBLY_RULES, ExplodeSolver, floorKeyOf } from "@/engine/explode";
import { PALETTE } from "../inventory/ui";
import { explodeStore, useExplode } from "./explodeStore";
import { getExplodeModel } from "./model";

export function ExplodeInfo({ id }: { id: string }) {
  const s = useExplode();
  const model = useMemo(() => (s.open ? getExplodeModel() : null), [s.open]);
  const solver = useMemo(() => (model ? new ExplodeSolver(model) : null), [model]);
  if (!s.open || !model || !solver) return null;
  const rec = model.byId.get(id);
  if (!rec) return null;
  solver.solve({ ...s.params, t: explodeStore.liveT() });
  const off = [0, 0, 0];
  solver.offsetOf(id, off);
  const asmIdx = model.assemblyIndex.get(rec.geometry.kind === "group" ? rec.id : (rec.parentId ?? ""));
  const asm = asmIdx !== undefined ? model.assemblies[asmIdx]! : null;
  const moved = off.some((v) => v !== 0);
  return (
    <div data-testid="explode-info" style={{ marginTop: 4 }}>
      <span style={{ opacity: 0.55 }}>exploded view: </span>
      floor {floorKeyOf(rec.floor)} · {rec.system}
      {asm ? ` · ${asm.type.replace(/_/g, " ")} (${ASSEMBLY_RULES[asm.type]?.kind === "radial" ? "radial" : `${asm.layerCount} layers`})` : ""}
      {" · "}
      <span data-testid="explode-info-offset" style={{ color: moved ? PALETTE.accent : PALETTE.muted }}>
        {moved ? `Δ (${off.map((v) => (v >= 0 ? "+" : "") + v.toFixed(2)).join(", ")}) m` : "at its assembled position"}
      </span>
    </div>
  );
}
