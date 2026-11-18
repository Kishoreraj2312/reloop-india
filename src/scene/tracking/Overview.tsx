/**
 * The recovery progress overview (C3): how far the tracked population is, in stages and in quantity. Quantities are shown for ONE unit at
 * a time (units are never added together); a record whose recovery was never recorded is counted as "not recorded", not as zero recovered.
 */

import { useMemo } from "react";
import { UNIT_LABEL, type Unit } from "@/engine/quantities";
import { fmtQty, fmtQtyU } from "@/engine/reuse";
import { statusCounts, totals } from "@/engine/tracking";
import { Seg, n0 } from "../reuse/ui";
import { useWorkspace } from "./hooks";
import { trackingStore, useTracking } from "./trackingStore";
import { RollupBar, StageBar } from "./Viz";

export function Overview() {
  const ws = useWorkspace();
  const ts = useTracking();
  const counts = useMemo(() => statusCounts(ws.rows), [ws.rows]);
  const tot = useMemo(() => totals(ws.rows), [ws.rows]);
  const unit: Unit | null = ts.unit && tot.some((t) => t.unit === ts.unit) ? ts.unit : (tot[0]?.unit ?? null);
  const t = tot.find((x) => x.unit === unit);
  const cov = ws.coverage;
  const flagged = ws.rows.filter((r) => r.summary.flags.some((f) => f.level !== "info")).length;
  const scale = t ? Math.max(t.available, t.planned, t.recovered, 1e-9) : 1;
  if (!ts.overview) {
    return (
      <div className="tk-overview compact" data-testid="overview" data-compact="true">
        <div className="tk-oneline">
          <span className="rx-cap">Progress · {n0(ws.rows.length)} tracked</span>
          <div className="tk-stack" style={{ flex: 1 }} aria-hidden="true">
            {(Object.keys(counts) as (keyof typeof counts)[]).filter((k) => counts[k] > 0).map((k) => <i key={k} className={`st-${k}`} style={{ width: `${(counts[k] / Math.max(1, ws.rows.length)) * 100}%` }} />)}
          </div>
          {t && <span>planned <b>{fmtQtyU(t.planned, t.unit)}</b> · recovered <b>{t.recoveredRecords === 0 ? "not recorded" : fmtQtyU(t.recovered, t.unit)}</b>{t.completion !== null && ` (${(t.completion * 100).toFixed(0)} %)`} · unaccounted <b>{fmtQtyU(t.unaccounted, t.unit)}</b></span>}
          <button type="button" className="rx-link" data-testid="overview-toggle" onClick={() => trackingStore.setOverview(true)}>show overview</button>
        </div>
      </div>
    );
  }
  return (
    <div className="tk-overview" data-testid="overview">
      <div className="tk-ov-left">
        <div className="rx-inline" style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span className="rx-cap">Recovery progress · {n0(ws.rows.length)} tracked</span>
          <button type="button" className="rx-link" data-testid="overview-toggle" onClick={() => trackingStore.setOverview(false)} title="Fold the overview to give the register more room">hide overview</button>
        </div>
        <StageBar counts={counts} active={ts.filters.status} onPick={(s) => trackingStore.setFilters({ status: ts.filters.status === s ? "" : s, scope: ts.filters.scope === "untracked" ? "tracked" : ts.filters.scope })} />
        <div className="rx-note" style={{ marginTop: 4 }} data-testid="coverage">
          {cov.scope === 0 ? (
            "Nothing is planned for recovery yet (assess components in Recovery, plan a removal, or allocate in Reuse)."
          ) : (
            <>
              <b>{n0(cov.trackedInScope)}</b> of {n0(cov.scope)} planned components tracked
              {cov.untracked > 0 && (
                <>
                  {" · "}
                  <button type="button" className="rx-link" data-testid="show-untracked" onClick={() => trackingStore.setFilters({ scope: "untracked", status: "" })}>{n0(cov.untracked)} not started</button>
                  {cov.untrackedPlanned.length > 0 && <span> ({cov.untrackedPlanned.filter((u) => u.planned > 0).map((u) => fmtQtyU(u.planned, u.unit)).join(" + ") || "no quantity planned"})</span>}
                  {" · "}
                  <button type="button" className="rx-btn sm" data-testid="track-planned" onClick={() => trackingStore.start([...ws.scope.keys()])}>Track all planned</button>
                </>
              )}
              {cov.trackedOutside > 0 && <span> · {n0(cov.trackedOutside)} unplanned</span>}
            </>
          )}
        </div>
      </div>
      <div className="tk-ov-right">
        {t ? (
          <>
            <div className="rx-inline" style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span className="rx-cap">Quantities</span>
              <Seg<Unit> value={t.unit} onChange={(u) => trackingStore.setUnit(u as TrackingUnit)} testid="unit-tabs" label="Unit" options={tot.map((x) => ({ value: x.unit, label: UNIT_LABEL[x.unit], testid: `unit-${x.unit}` }))} />
            </div>
            <div className="tk-figs" data-testid="figures" data-unit={t.unit}>
              <Fig k="Planned" v={fmtQty(t.planned, t.unit)} sub={`${t.plannedRecords} of ${t.records} have a plan`} testid="fig-planned" />
              <Fig k="Recovered" v={fmtQty(t.recovered, t.unit)} sub={t.completion === null ? "no completion yet" : `${(t.completion * 100).toFixed(0)} % of planned`} testid="fig-recovered" />
              <Fig k="Reused" v={fmtQty(t.reused, t.unit)} cls="reused" testid="fig-reused" />
              <Fig k="Recycled" v={fmtQty(t.recycled, t.unit)} cls="recycled" testid="fig-recycled" />
              <Fig k="Disposed" v={fmtQty(t.disposed, t.unit)} cls="disposed" testid="fig-disposed" />
              <Fig k="Unaccounted" v={fmtQty(t.unaccounted, t.unit)} sub={t.notRecorded ? `${t.notRecorded} not recorded` : undefined} testid="fig-unaccounted" strong />
            </div>
            <RollupBar r={t} scale={scale} />
            <div className="rx-note" style={{ marginTop: 3 }}>
              {flagged > 0 ? <span className="rx-warn" data-testid="flagged-count">{n0(flagged)} record{flagged === 1 ? " needs" : "s need"} attention</span> : "No record needs attention"}
              {" · "}planned = B2 estimates (or stated); actual = recorded quantities only
            </div>
          </>
        ) : (
          <div className="rx-note" style={{ paddingTop: 8 }}>No quantities yet: start tracking components to compare planned and actual recovery.</div>
        )}
      </div>
    </div>
  );
}

type TrackingUnit = "m2" | "m3" | "m" | "nr";

function Fig({ k, v, sub, cls, testid, strong }: { k: string; v: string; sub?: string | undefined; cls?: string; testid: string; strong?: boolean }) {
  return (
    <div className="tk-fig">
      <div className="k">{cls && <i className={`sw ${cls}`} />}{k}</div>
      <div className={`v${strong ? " strong" : ""}`} data-testid={testid}>{v}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}
