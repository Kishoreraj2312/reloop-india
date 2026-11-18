/** Inspector line (C2): what is allocated from the selected component to reuse requirements, and a way into the reuse workspace. */

import { getModelInventory, leafDescendants } from "@/engine/quantities";
import { fmtQtyU } from "@/engine/reuse";
import { linkBtn } from "../removal/ui";
import { reuseStore, useReuse } from "./reuseStore";

export function ReuseInfo({ id }: { id: string }) {
  const rs = useReuse();
  const inv = getModelInventory();
  const rec = inv.recordById.get(id);
  if (!rec) return null;
  const open = (
    <button data-testid="open-reuse" onClick={() => (reuseStore.setTab(rs.tab === "allocation" ? "catalogue" : rs.tab), reuseStore.setOpen(true))} style={linkBtn}>
      {rs.requirements.length ? "reuse matching" : "match for reuse"}
    </button>
  );
  const parts = rec.geometry.kind === "group" ? new Set(leafDescendants(inv, id).map((r) => r.rec.id)) : new Set([id]);
  const mine = rs.allocations.filter((a) => parts.has(a.componentId));
  return (
    <div data-testid="reuse-info" style={{ marginTop: 4 }}>
      <span style={{ opacity: 0.55 }}>reuse: </span>
      {mine.length === 0 ? (
        <span data-testid="reuse-info-value" style={{ opacity: 0.8 }}>{rec.geometry.kind === "group" ? "planned per part" : "not allocated"}</span>
      ) : (
        <span data-testid="reuse-info-value">
          {rec.geometry.kind === "group" ? `${mine.length} allocation${mine.length === 1 ? "" : "s"} among its parts` : mine.map((a) => `${fmtQtyU(a.quantity, a.unit)} → ${rs.requirements.find((r) => r.id === a.requirementId)?.name ?? a.requirementId}`).join(", ")}
        </span>
      )}{" "}
      · {open}
    </div>
  );
}
