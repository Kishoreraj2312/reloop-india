/**
 * Recovery tracking workspace (C3): follow a component from planned recovery to its actual final outcome, compare planned and measured
 * quantities, inspect its history and find it in the 3D building. Local to the controls panel; opening it never touches the scene until marks
 * are drawn. Quantities are B1's, the plan is B2's (a snapshot taken when tracking starts), the removal order is B3's, the reuse intent is C2's,
 * the passport is C1's; the engine derives status, balances and reports from the user's append-only records, which live in the tracking store.
 *
 * Folding the workspace ("View model") keeps it mounted but hidden, so the register's filters, the selection and scroll positions are exactly
 * where they were when it is shown again.
 */

import { useEffect, useMemo, useState } from "react";
import { fmtQtyU } from "@/engine/reuse";
import { useDockWidth } from "@/ui/shell/useDockWidth";
import { n0 } from "../reuse/ui";
import { HighlightSync } from "./HighlightSync";
import { Overview } from "./Overview";
import { Rail } from "./Rail";
import { Register } from "./Register";
import { Report } from "./Report";
import { StageChip } from "./RecordPanel";
import { useRegister } from "./registerModel";
import { useTrackingCtx, useTrackingData, useWorkspace, WorkspaceContext, type TrackingWorkspace } from "./hooks";
import { trackingStore, useTracking, type Show3d, type Tab } from "./trackingStore";
import { Seg } from "../reuse/ui";
import "../reuse/reuse.css";
import "./tracking.css";

export function TrackingDrawer({ onClose, onSelect, selectedId }: { onClose: () => void; onSelect: (id: string | null) => void; selectedId: string | null }) {
  const ts = useTracking();
  const ctx = useTrackingCtx();
  const data = useTrackingData(ctx);
  const width = useDockWidth();
  const ws = useMemo<TrackingWorkspace>(() => ({ ctx, ...data, selectedId, onSelect, drawerWidth: width }), [ctx, data, selectedId, onSelect, width]);
  const model = useRegister(ws, ts.filters);

  // a pane is mounted the first time it is shown and then kept (hidden), so its scroll position and local state survive tab changes
  const [seen, setSeen] = useState<ReadonlySet<Tab>>(() => new Set<Tab>([ts.tab]));
  useEffect(() => setSeen((s) => (s.has(ts.tab) ? s : new Set(s).add(ts.tab))), [ts.tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || ts.collapsed) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, ts.collapsed]);

  return (
    <WorkspaceContext.Provider value={ws}>
      <HighlightSync model={model} />
      {ts.collapsed && <CollapsedCard onClose={onClose} />}
      <div className="rx tk" style={{ display: ts.collapsed ? "none" : "flex" }} data-testid="tracking-drawer">
        <div className="rx-head">
          <div className="rx-head-title">
            <h3>Recovery tracking</h3>
            <p>Planned against actual recovery, per component. Planned figures are B2 estimates; actual figures exist only where you record them, each with its source. Being recovered or allocated never makes material reused: that is an outcome you record.</p>
          </div>
          <Seg<Show3d> value={ts.show3d} onChange={trackingStore.setShow3d} testid="show3d" label="Mark in the 3D model" options={[{ value: "status", label: "Stage", title: "Colour the listed components by recovery stage", testid: "show3d-status" }, { value: "flags", label: "Flags", title: "Mark only the records that need attention", testid: "show3d-flags" }, { value: "off", label: "Off", testid: "show3d-off" }]} />
          <button type="button" className="rx-btn" data-testid="tracking-collapse" onClick={() => trackingStore.setCollapsed(true)} title="Fold the workspace to see the whole model (the marks and your place stay)">
            View model
          </button>
          <button type="button" className="rx-x" data-testid="tracking-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="rx-body">
          <Rail model={model} />
          <div className="rx-main">
            <Overview />
            <div className="rx-tabs" role="tablist">
              {(["register", "report"] as const).map((t) => (
                <button key={t} type="button" role="tab" className="rx-tab" aria-selected={ts.tab === t} data-testid={`tab-${t}`} onClick={() => trackingStore.setTab(t)}>
                  {t === "register" ? "Register" : "Report"}
                  {t === "register" && <span className="rx-count">{n0(model.items.length)}</span>}
                </button>
              ))}
            </div>
            {(["register", "report"] as const).map((t) => (
              <div key={t} style={{ display: ts.tab === t ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }} data-pane={t}>
                {seen.has(t) && (t === "register" ? <Register model={model} /> : <Report />)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}

/** The folded workspace: where the user is, and a way back. The 3D marks stay on. */
function CollapsedCard({ onClose }: { onClose: () => void }) {
  const ts = useTracking();
  const ws = useWorkspace();
  const row = ws.selectedId ? ws.rowById.get(ws.selectedId) : undefined;
  return (
    <div className="rx-card-collapsed" data-testid="tracking-collapsed">
      <div className="rx-cap">Recovery tracking · 3D marks</div>
      <div className="rx-note">
        {n0(ws.rows.length)} tracked · {ws.coverage.untracked > 0 ? `${n0(ws.coverage.untracked)} planned, not started` : "all planned components tracked"}
      </div>
      {ws.selectedId && (
        <div className="rx-inline" style={{ display: "flex", gap: 6, alignItems: "center" }} data-testid="collapsed-component">
          <StageChip status={row?.summary.status ?? "not_tracked"} />
          <span className="rx-mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{ws.selectedId}</span>
          {row && <span className="rx-note">{row.summary.recovered === null ? "no recovery recorded" : fmtQtyU(row.summary.recovered, row.summary.unit)}</span>}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        <button type="button" className="rx-btn primary" data-testid="tracking-expand" onClick={() => trackingStore.setCollapsed(false)}>
          Show workspace
        </button>
        <button type="button" className="rx-btn" onClick={() => trackingStore.setShow3d(ts.show3d === "off" ? "status" : "off")}>
          {ts.show3d === "off" ? "Show marks" : "Clear marks"}
        </button>
        <button type="button" className="rx-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
