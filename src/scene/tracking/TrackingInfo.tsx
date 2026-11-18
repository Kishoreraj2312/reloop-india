/** Inspector line (C3): the selected component's recovery stage, recovered against planned, and a way into the tracking workspace. */

import { getModelInventory, leafDescendants } from "@/engine/quantities";
import { fmtQtyU } from "@/engine/reuse";
import { liveFn, summarize } from "@/engine/tracking";
import { linkBtn } from "../removal/ui";
import { StageChip } from "./RecordPanel";
import { trackingStore, trackingContext, useTracking } from "./trackingStore";

export function TrackingInfo({ id }: { id: string }) {
  const ts = useTracking();
  const inv = getModelInventory();
  const rec = inv.recordById.get(id);
  if (!rec) return null;
  const open = (
    <button data-testid="open-tracking" onClick={() => (trackingStore.setFilters({ scope: ts.records[id] ? "tracked" : "planned" }), trackingStore.setOpen(true))} style={linkBtn}>
      recovery tracking
    </button>
  );
  if (rec.geometry.kind === "group") {
    const parts = leafDescendants(inv, id);
    const n = parts.filter((p) => ts.records[p.rec.id]).length;
    return (
      <div data-testid="tracking-info" style={{ marginTop: 4 }}>
        <span style={{ opacity: 0.55 }}>tracking: </span>
        {n} of {parts.length} parts tracked · {open}
      </div>
    );
  }
  const record = ts.records[id];
  if (!record) {
    return (
      <div data-testid="tracking-info" style={{ marginTop: 4 }}>
        <span style={{ opacity: 0.55 }}>tracking: </span>
        <span data-testid="tracking-info-value" style={{ opacity: 0.8 }}>not tracked</span> · {open}
      </div>
    );
  }
  const s = summarize(record, liveFn(trackingContext())(id));
  return (
    <div data-testid="tracking-info" style={{ marginTop: 4 }}>
      <span style={{ opacity: 0.55 }}>tracking: </span>
      <span data-testid="tracking-info-value">
        <StageChip status={s.status} />{" "}
        <span style={{ fontSize: 11 }}>{s.recovered === null ? "no recovery recorded" : `recovered ${fmtQtyU(s.recovered, s.unit)}`}{s.planned !== null ? ` of ${fmtQtyU(s.planned, s.unit)} planned` : ""}</span>
      </span>{" "}
      · {open}
    </div>
  );
}
