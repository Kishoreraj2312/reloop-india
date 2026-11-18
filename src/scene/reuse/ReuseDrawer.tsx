/**
 * Material reuse matching workspace (C2): from a real recoverable component to an explainable match, an allocation that cannot
 * double-count, and the component's place in the 3D building. Local to the controls panel; opening it never touches the scene
 * until marks are drawn. Quantities are B1's, recovery data is B2's, condition is C1's, matches and the ledger come from the
 * reuse engine, and the user's requirements and allocations live in the reuse store. Selection uses the app's own select handler,
 * so the inspector, the passport and the outline work as everywhere else.
 *
 * Folding the workspace ("View model") keeps it mounted but hidden, so filters, scroll positions and the selected requirement are
 * exactly where they were when it is shown again.
 */

import { useEffect, useMemo, useState } from "react";
import { fmtQtyU, evaluate, TIER_LABELS } from "@/engine/reuse";
import { useDockWidth } from "@/ui/shell/useDockWidth";
import { AllocationView } from "./AllocationView";
import { Catalogue } from "./Catalogue";
import { HighlightSync } from "./HighlightSync";
import { Matches } from "./Matches";
import { Rail } from "./Rail";
import { RequirementForm } from "./RequirementForm";
import { leafRow, useActiveResult, useLedger, useMatchCtx, useWorkspace, WorkspaceContext, type Workspace } from "./hooks";
import { reuseStore, useReuse, type Tab } from "./reuseStore";
import { TierChip, n0 } from "./ui";
import "./reuse.css";

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "catalogue", label: "Catalogue" },
  { id: "matches", label: "Matches" },
  { id: "allocation", label: "Allocation" },
];

export function ReuseDrawer({ onClose, onSelect, selectedId }: { onClose: () => void; onSelect: (id: string | null) => void; selectedId: string | null }) {
  const rs = useReuse();
  const ctx = useMatchCtx();
  const width = useDockWidth();
  const active = rs.requirements.find((r) => r.id === rs.activeId);
  const result = useActiveResult(ctx, active);
  const ledger = useLedger(ctx);
  const ws = useMemo<Workspace>(() => ({ ctx, active, result, ledger, selectedId, onSelect, drawerWidth: width }), [ctx, active, result, ledger, selectedId, onSelect, width]);

  // a pane is mounted the first time it is shown and then kept (hidden), so its filters and scroll position survive tab changes
  const [seen, setSeen] = useState<ReadonlySet<Tab>>(() => new Set<Tab>([rs.tab]));
  useEffect(() => setSeen((s) => (s.has(rs.tab) ? s : new Set(s).add(rs.tab))), [rs.tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || rs.collapsed) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (rs.editing) reuseStore.endEdit();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, rs.editing, rs.collapsed]);

  const counts = result ? { strong: result.strong.length, conditional: result.conditional.length } : null;
  const formKey = rs.editing ? `${rs.editing.id ?? "new"}:${rs.editing.nonce}` : "";

  return (
    <WorkspaceContext.Provider value={ws}>
      <HighlightSync />
      {rs.collapsed && <CollapsedCard onClose={onClose} />}
      <div className="rx" style={{ display: rs.collapsed ? "none" : "flex" }} data-testid="reuse-drawer">
        <div className="rx-head">
          <div className="rx-head-title">
            <h3>Material reuse matching</h3>
            <p>Preliminary matching of recovered components to the needs of new projects. A match compares recorded data with a stated requirement: it is not an assessment of structural suitability, code compliance or fitness for purpose.</p>
          </div>
          <button type="button" className="rx-btn" data-testid="reuse-collapse" onClick={() => reuseStore.setCollapsed(true)} title="Fold the workspace to see the whole model (the marks and your place stay)">
            View model
          </button>
          <button type="button" className="rx-x" data-testid="reuse-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="rx-body">
          <Rail />
          <div className="rx-main">
            <div className="rx-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" className="rx-tab" aria-selected={!rs.editing && rs.tab === t.id} data-testid={`tab-${t.id}`} onClick={() => reuseStore.setTab(t.id)}>
                  {t.label}
                  {t.id === "matches" && counts && <span className="rx-count" data-testid="tab-matches-count">{n0(counts.strong)} · {n0(counts.conditional)}</span>}
                  {t.id === "allocation" && rs.allocations.length > 0 && <span className="rx-count">{n0(rs.allocations.length)}</span>}
                </button>
              ))}
              <div className="rx-tab-tools">
                <button type="button" className="rx-btn sm" data-testid="tab-new" onClick={() => reuseStore.beginNew()}>+ New requirement</button>
              </div>
            </div>
            {rs.editing && (
              <div className="rx-scroll" style={{ padding: 0 }}>
                <RequirementForm key={formKey} />
              </div>
            )}
            {TABS.map((t) => (
              <div key={t.id} style={{ display: !rs.editing && rs.tab === t.id ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }} data-pane={t.id}>
                {seen.has(t.id) && (t.id === "catalogue" ? <Catalogue /> : t.id === "matches" ? <Matches /> : <AllocationView />)}
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
  const rs = useReuse();
  const { ctx, active, result, ledger, selectedId } = useWorkspace();
  const row = leafRow(selectedId);
  const cand = active && row ? evaluate(ctx, active, row) : null;
  const d = active ? ledger.demand.find((x) => x.requirement.id === active.id) : undefined;
  return (
    <div className="rx-card-collapsed" data-testid="reuse-collapsed">
      <div className="rx-cap">Reuse matching · 3D marks</div>
      {active ? (
        <>
          <div style={{ fontWeight: 650 }} data-testid="collapsed-requirement">{active.name}</div>
          <div className="rx-note">
            {result ? `${n0(result.strong.length)} strong · ${n0(result.conditional.length)} conditional` : ""}
            {d ? ` · ${fmtQtyU(d.allocated, active.unit)} of ${fmtQtyU(d.required, active.unit)} allocated` : ""}
          </div>
        </>
      ) : (
        <div className="rx-note">no requirement selected</div>
      )}
      {cand && selectedId && (
        <div className="rx-inline" style={{ display: "flex", gap: 6 }} data-testid="collapsed-component">
          <TierChip tier={cand.tier} compact />
          <span className="rx-mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{selectedId}</span>
          <span className="rx-note">{TIER_LABELS[cand.tier]}{cand.score !== null ? ` · ${cand.score.toFixed(0)}` : ""}</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        <button type="button" className="rx-btn primary" data-testid="reuse-expand" onClick={() => reuseStore.setCollapsed(false)}>
          Show workspace
        </button>
        <button type="button" className="rx-btn" onClick={() => reuseStore.setShow3d(rs.show3d === "off" ? "candidates" : "off")}>
          {rs.show3d === "off" ? "Show marks" : "Clear marks"}
        </button>
        <button type="button" className="rx-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
