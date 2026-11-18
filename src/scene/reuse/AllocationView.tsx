/**
 * The allocation summary (C2): matched, partially matched and unmet demand, every confirmed allocation with its quantity and the
 * state of the match when it was confirmed, the review of allocations the current data no longer supports, totals per unit
 * (units are never added together), and the plan export that C3 Recovery Tracking will read. Original inventory and passport
 * quantities are never changed by anything here.
 */

import { useEffect, useMemo, useState } from "react";
import { componentCarbon } from "@/engine/carbon";
import { CATEGORY_LABELS } from "@/engine/quantities";
import { DEMAND_LABELS, fmtQty, fmtQtyU, materialName, planFileName, planToCsv, planToJson, REVIEW_LABELS, statusCounts, substanceLabel, totalsByUnit, type Allocation, type DemandRow } from "@/engine/reuse";
import { fmtCarbon } from "../carbon/format";
import { useCarbon } from "../carbon/carbonStore";
import { downloadText } from "../passport/download";
import { fold as foldRecord } from "@/engine/tracking";
import { useTracking } from "../tracking/trackingStore";
import { useWorkspace } from "./hooks";
import { locateInModel } from "./locate";
import { reuseStore, useReuse } from "./reuseStore";
import { Bar, Chip, qtyInput, Section, StateIcon, TierChip } from "./ui";

export function AllocationView() {
  const { ctx, ledger, onSelect } = useWorkspace();
  const rs = useReuse();
  const cs = useCarbon();
  const [open, setOpen] = useState<string | null>(null);
  const counts = statusCounts(ledger.demand);
  const totals = totalsByUnit(ledger.demand);
  const flagged = ledger.reviews.length;
  const unmet = ledger.demand.filter((d) => d.remaining > 1e-9);

  const carbon = useMemo(() => {
    if (cs.factors.size === 0 || rs.allocations.length === 0) return null;
    const ids = [...new Set(rs.allocations.map((a) => a.componentId))];
    let kg = 0;
    let assessed = 0;
    for (const id of ids) {
      const rec = ctx.inv.recordById.get(id);
      const q = ctx.inv.byId.get(id);
      if (!rec || !q) continue;
      const c = componentCarbon({ rec, q }, cs.factors, cs.assumptions);
      if (c.kgCO2e !== null) (kg += c.kgCO2e), assessed++;
    }
    return { kg, assessed, total: ids.length, illustrative: [...cs.factors.values()].some((f) => f.origin === "illustrative" && f.value !== null) };
  }, [cs.factors, cs.assumptions, rs.allocations, ctx.inv]);

  const download = (ext: "json" | "csv") => {
    const input = { requirements: rs.requirements, allocations: rs.allocations, reviews: ledger.reviews, inventory: ctx.inv };
    if (ext === "json") downloadText(planFileName("json"), "application/json", planToJson(input, new Date().toISOString()));
    else downloadText(planFileName("csv"), "text/csv;charset=utf-8", planToCsv(input));
  };

  if (rs.requirements.length === 0) {
    return (
      <div className="rx-pane" data-testid="allocation-empty">
        <div className="rx-empty" style={{ marginTop: 30 }}>
          <h4>Nothing to allocate yet</h4>
          Create a requirement, review its matches and confirm allocations: this page then shows what is matched, partially matched and unmet.
          <div style={{ marginTop: 12 }}><button type="button" className="rx-btn primary" onClick={() => reuseStore.beginNew()}>+ New requirement</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="rx-pane" data-testid="allocation">
      <div className="rx-scroll">
        <div className="rx-tiles" data-testid="allocation-tiles">
          <div className="rx-tile matched"><div className="n" data-testid="count-matched">{counts.matched}</div><div className="t">Matched · fully allocated</div></div>
          <div className="rx-tile partial"><div className="n" data-testid="count-partial">{counts.partial + counts.over}</div><div className="t">Partially matched</div></div>
          <div className="rx-tile"><div className="n" data-testid="count-unmet">{counts.unmet}</div><div className="t">Unmet · nothing allocated</div></div>
        </div>

        <div style={{ marginTop: 10 }} data-testid="integrity">
          {rs.allocations.length === 0 ? (
            <div className="rx-banner info">No allocations yet. Open a requirement's matches, compare a candidate and confirm a quantity (or confirm a suggested allocation).</div>
          ) : flagged === 0 && ledger.problems.length === 0 ? (
            <div className="rx-banner ok">
              <b>The books balance.</b> No component is allocated beyond what it can supply, no requirement beyond what it asks for, and every allocation is in the requirement's own unit. Inventory and passport quantities are untouched.
            </div>
          ) : (
            <div className="rx-banner warn" data-testid="integrity-warn">
              <b>{flagged} allocation{flagged === 1 ? "" : "s"} need{flagged === 1 ? "s" : ""} review.</b> The data under them has changed since they were confirmed (open the requirement below). Allocations are never changed automatically.
              {ledger.problems.slice(0, 3).map((p, i) => <div key={i} className="rx-note">{p}</div>)}
            </div>
          )}
        </div>

        <Section title="Demand by requirement" aside={<span>click a requirement for its allocations</span>} testid="demand-list">
          {ledger.demand.map((d) => (
            <DemandBlock key={d.requirement.id} d={d} open={open === d.requirement.id} onToggle={() => setOpen(open === d.requirement.id ? null : d.requirement.id)} allocations={rs.allocations.filter((a) => a.requirementId === d.requirement.id)} onLocate={(id) => locateInModel(id, onSelect)} />
          ))}
        </Section>

        <Section title="Totals by unit" aside={<span>different units are never added together</span>} testid="unit-totals">
          <table className="rx-table">
            <thead><tr><th>Unit</th><th style={{ textAlign: "right" }}>Requirements</th><th style={{ textAlign: "right" }}>Required</th><th style={{ textAlign: "right" }}>Allocated</th><th style={{ textAlign: "right" }}>Remaining</th></tr></thead>
            <tbody>
              {totals.map((t) => (
                <tr key={t.unit} data-unit={t.unit}>
                  <td className="crit">{t.unit === "m2" ? "m²" : t.unit === "m3" ? "m³" : t.unit}</td>
                  <td className="pts">{t.requirements}</td>
                  <td className="pts">{fmtQty(t.required, t.unit)}</td>
                  <td className="pts"><b>{fmtQty(t.allocated, t.unit)}</b></td>
                  <td className="pts">{fmtQty(t.remaining, t.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {unmet.length > 0 && (
          <Section title="Unmet demand" testid="unmet-list">
            <ul className="rx-list">
              {unmet.map((d) => (
                <li key={d.requirement.id}>
                  <StateIcon state={d.status === "unmet" ? "unmet" : "partial"} />
                  <span><b>{d.requirement.name}</b>: {fmtQtyU(d.remaining, d.requirement.unit)} of {fmtQtyU(d.required, d.requirement.unit)} still needs a source <button type="button" className="rx-link" onClick={() => (reuseStore.select(d.requirement.id), reuseStore.setTab("matches"))}>find matches</button></span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {carbon && (
          <Section title="Environmental context (B5)" testid="carbon-context">
            <div className="rx-banner info">
              Embodied carbon of the {carbon.total} source component{carbon.total === 1 ? "" : "s"} as B5 assesses them (whole components): <b data-testid="carbon-sum">{carbon.assessed > 0 ? fmtCarbon(carbon.kg) : "not assessed"}</b>
              {carbon.assessed > 0 && ` · ${carbon.assessed} of ${carbon.total} assessed`}
              {carbon.illustrative && " · uses ILLUSTRATIVE placeholder factors"}.
              <div className="rx-note">This is B5's baseline for the existing material, shown as context. It is not a saving: avoided impact depends on B5's replacement assumptions, which are not applied here.</div>
            </div>
          </Section>
        )}

        <Section title="Plan export" aside={<span>for C3 Recovery Tracking and for your records</span>}>
          <div className="rx-inline" style={{ display: "flex" }}>
            <button type="button" className="rx-btn" data-testid="export-json" onClick={() => download("json")} disabled={rs.allocations.length === 0}>Download JSON</button>
            <button type="button" className="rx-btn" data-testid="export-csv" onClick={() => download("csv")} disabled={rs.allocations.length === 0}>Download CSV</button>
            <span className="rx-note">Each allocation is exported as "planned": recovered and reused quantities stay empty until C3 records them.</span>
          </div>
        </Section>
        <div className="rx-note" style={{ marginTop: 14 }}>
          Saved in this browser only. Allocations plan quantities of existing components for new requirements; they do not change B1 quantities, B2 assessments or C1 passports, and are not a record that anything was recovered or reused.
          {" "}<button type="button" className="rx-link" data-testid="clear-all" onClick={() => { if (window.confirm("Delete every requirement and allocation, and reset the ranking weights?")) reuseStore.clearAll(); }}>Clear all reuse data</button>
        </div>
      </div>
    </div>
  );
}

function DemandBlock({ d, open, onToggle, allocations, onLocate }: { d: DemandRow; open: boolean; onToggle: () => void; allocations: readonly Allocation[]; onLocate: (id: string) => void }) {
  const r = d.requirement;
  const { ledger } = useWorkspace();
  return (
    <div className="rx-dem" data-testid="demand-block" data-requirement={r.id} data-status={d.status}>
      <button type="button" className="rx-dem-head" aria-expanded={open} onClick={onToggle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
          <div className="rx-note" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{substanceLabel(r.substance)}{r.form ? ` · ${CATEGORY_LABELS[r.form]}` : ""}{r.application ? ` · ${r.application}` : ""}</div>
        </div>
        <div><div className="rx-note">Required</div><b>{fmtQtyU(d.required, r.unit)}</b></div>
        <div><div className="rx-note">Allocated</div><b data-testid="dem-allocated">{fmtQtyU(d.allocated, r.unit)}</b></div>
        <div><div className="rx-note">Remaining</div><b data-testid="dem-remaining">{fmtQtyU(d.remaining, r.unit)}</b></div>
        <div>
          <Bar total={d.required} parts={[{ value: Math.min(d.allocated, d.required), kind: "alloc" }]} height={7} />
          <div className="rx-inline" style={{ marginTop: 3, display: "flex", justifyContent: "space-between" }}>
            <Chip tone={d.status === "matched" ? "strong" : d.status === "partial" ? "cond" : d.status === "over" ? "bad" : "neutral"}>{DEMAND_LABELS[d.status]}</Chip>
            <span className="rx-note">{d.components} component{d.components === 1 ? "" : "s"}{d.flagged ? ` · ${d.flagged} to review` : ""}</span>
          </div>
          <div className="rx-note" style={{ color: "var(--rx-cond)" }} data-testid="dem-conditional">
            {d.conditional > 1e-9 ? `${fmtQtyU(d.conditional, r.unit)} conditional: conditions open` : ""}
          </div>
        </div>
      </button>
      {open && (
        <div className="rx-dem-body">
          {allocations.length === 0 ? (
            <div className="rx-note" style={{ padding: "6px 0" }}>No allocations. <button type="button" className="rx-link" onClick={() => (reuseStore.select(r.id), reuseStore.setTab("matches"))}>Find matches</button></div>
          ) : (
            allocations.map((a) => <AllocationRow key={a.id} a={a} flags={ledger.flags.get(a.id)} onLocate={onLocate} />)
          )}
          <div className="rx-inline" style={{ display: "flex", marginTop: 8 }}>
            <button type="button" className="rx-btn sm" onClick={() => (reuseStore.select(r.id), reuseStore.setTab("matches"))}>Open matches</button>
            {allocations.length > 0 && <button type="button" className="rx-btn sm danger" data-testid="clear-requirement-allocations" onClick={() => reuseStore.clearAllocations(r.id)}>Remove all {allocations.length} allocation{allocations.length === 1 ? "" : "s"}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** C3: how much of this allocation has actually been recorded as reused (null: the component is not tracked). */
function useFulfilled(a: Allocation): number | null {
  const { records } = useTracking();
  const r = records[a.componentId];
  return r ? (foldRecord(r).fulfilled.get(a.id) ?? 0) : null;
}

function AllocationRow({ a, flags, onLocate }: { a: Allocation; flags: ReturnType<ReturnType<typeof useWorkspace>["ledger"]["flags"]["get"]>; onLocate: (id: string) => void }) {
  const { ctx } = useWorkspace();
  const rec = ctx.inv.recordById.get(a.componentId);
  const fulfilled = useFulfilled(a);
  const [text, setText] = useState(qtyInput(a.quantity));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setText(qtyInput(a.quantity)), [a.quantity]); // trimmed or revised elsewhere
  const commit = () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n) || text === qtyInput(a.quantity)) return setText(qtyInput(a.quantity));
    const e = reuseStore.setQuantity(a.id, n);
    setErr(e);
    if (e) setText(qtyInput(a.quantity));
  };
  return (
    <div data-testid="allocation-row" data-id={a.componentId}>
      <div className="rx-arow">
        <div style={{ minWidth: 0 }}>
          <div className="rx-inline" style={{ display: "flex", gap: 6, minWidth: 0 }}>
            <button type="button" className="rx-link rx-mono" style={{ textDecoration: "none", fontWeight: 550, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title="Select in the model and frame the camera on it" onClick={() => onLocate(a.componentId)} data-testid="allocation-locate">{a.componentId}</button>
            <TierChip tier={a.basis.tier} compact />
          </div>
          <div className="rx-note" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec ? materialName(rec.materialId) : "not in the current model"} · confirmed as {a.basis.tier}{a.basis.conditions.length ? ` with ${a.basis.conditions.length} condition${a.basis.conditions.length === 1 ? "" : "s"}` : ""}
            {fulfilled !== null && <> · <span data-testid="allocation-fulfilled" title="Recorded in recovery tracking (C3): an allocation is only fulfilled by a recorded reused outcome">C3: reused {fmtQty(fulfilled, a.unit)} of {fmtQty(a.quantity, a.unit)}</span></>}</div>
        </div>
        <input className={`rx-field num${err ? " bad" : ""}`} data-testid="allocation-qty" value={text} inputMode="decimal" onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} aria-label="Allocated quantity" />
        <span className="rx-note">{a.unit === "m2" ? "m²" : a.unit === "m3" ? "m³" : a.unit}</span>
        <button type="button" className="rx-btn sm" data-testid="allocation-remove" onClick={() => reuseStore.removeAllocation(a.id)}>Remove</button>
      </div>
      {err && <div className="rx-error">{err}</div>}
      {flags?.map((f, i) => (
        <div key={i} className="rx-flag" data-testid="allocation-flag" data-code={f.code}>
          ⚠ {REVIEW_LABELS[f.code]}: {f.text}
          {f.code === "over_supply" && f.fits !== undefined && f.fits > 0 && <> <button type="button" className="rx-link" onClick={() => reuseStore.setQuantity(a.id, f.fits!)}>trim to {fmtQty(f.fits, a.unit)}</button></>}
        </div>
      ))}
    </div>
  );
}
