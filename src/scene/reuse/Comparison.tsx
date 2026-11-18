/**
 * The comparison of one source component with the active requirement (C2): every criterion with what is required, what the
 * component has, the result and the points it earned; what blocks the match, what must happen before reuse and what the project
 * data does not hold; and the allocation controls. A match here is preliminary: it makes no claim about suitability or compliance.
 */

import { useEffect, useMemo, useState } from "react";
import { CRITERION_HELP, CRITERION_LABELS, explain, fmtQty, fmtQtyU, freeOf, allocatedByComponent, TIER_LABELS, type Candidate, type Note } from "@/engine/reuse";
import { UNIT_LABEL } from "@/engine/quantities";
import { leafRow, useWorkspace } from "./hooks";
import { locateInModel } from "./locate";
import { SourceFacts } from "./Source";
import { reuseStore, useReuse } from "./reuseStore";
import { Chip, qtyInput, Section, StateIcon, TierChip } from "./ui";

function headline(c: Candidate): string {
  if (c.tier === "strong") return "Meets every criterion this requirement states, on the project's recorded data, and nothing is outstanding. This is a preliminary match: it is not a check of structural suitability, code compliance or fitness for purpose.";
  if (c.tier === "conditional") {
    const parts = [c.conditions.length ? `${c.conditions.length} condition${c.conditions.length === 1 ? "" : "s"} to meet` : "", c.missing.length ? `${c.missing.length} item${c.missing.length === 1 ? "" : "s"} of missing information` : ""].filter(Boolean);
    return `No criterion fails, but ${parts.join(" and ") || "a criterion is only partly met"} stand${parts.length === 1 && c.conditions.length + c.missing.length === 1 ? "s" : ""} between this component and a verified match. It is not immediately reusable as stated.`;
  }
  return `Cannot meet this requirement as stated: ${c.blockers[0]!.text}.${c.blockers.length > 1 ? ` (${c.blockers.length - 1} more reason${c.blockers.length > 2 ? "s" : ""} below.)` : ""}`;
}

function Notes({ title, items, state, testid }: { title: string; items: readonly Note[]; state: "unmet" | "partial" | "unknown"; testid: string }) {
  if (items.length === 0) return null;
  return (
    <Section title={`${title} (${items.length})`} testid={testid}>
      <ul className="rx-list">
        {items.map((n, i) => (
          <li key={i} data-code={n.code}>
            <StateIcon state={state} />
            <span>{n.text}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function Comparison({ id }: { id: string }) {
  const { ctx, active, ledger, onSelect } = useWorkspace();
  const rs = useReuse();
  const row = leafRow(id);
  const cand = useMemo(() => (row && active ? explain(ctx, active, row) : null), [ctx, active, row]);
  const mine = active ? rs.allocations.find((a) => a.requirementId === active.id && a.componentId === id) : undefined;
  const byComp = useMemo(() => allocatedByComponent(rs.allocations), [rs.allocations]);
  const allocatedToActive = active ? rs.allocations.filter((a) => a.requirementId === active.id).reduce((s, a) => s + a.quantity, 0) : 0;
  const free = cand ? freeOf(cand.supply.value, id, byComp, mine?.quantity ?? 0) : 0;
  const remaining = active ? Math.max(0, active.quantity - (allocatedToActive - (mine?.quantity ?? 0))) : 0;
  const most = Math.min(free, remaining);
  const preset = mine ? mine.quantity : most;
  const [qty, setQty] = useState(qtyInput(preset));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // the field follows what can be allocated (or the current allocation) whenever the component, the requirement or the allocation changes
  useEffect(() => {
    setQty(qtyInput(preset));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a different component / requirement / allocation resets the field
  }, [id, active?.id, mine?.id, mine?.quantity]);
  // the result message belongs to the component and requirement it was made for: it survives the re-render its own action causes
  useEffect(() => setMsg(null), [id, active?.id]);

  if (!row || !active || !cand) return null;
  const flags = mine ? ledger.flags.get(mine.id) : undefined;
  const unit = UNIT_LABEL[active.unit];
  const applicable = (cand.criteria ?? []).filter((c) => c.state !== "na");
  const wSum = applicable.reduce((s, c) => s + c.weight, 0);
  const earned = applicable.reduce((s, c) => s + c.weight * c.points, 0);
  const incompatible = cand.tier === "incompatible";

  const commit = () => {
    const n = Number(qty);
    if (qty.trim() === "" || !Number.isFinite(n)) return setMsg({ ok: false, text: "Enter a quantity" });
    const err = reuseStore.allocate(active.id, id, n);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: mine ? "Allocation updated" : "Allocation confirmed" });
  };

  return (
    <div className="rx-detail" data-testid="comparison" data-component={id} data-tier={cand.tier}>
      <div className="rx-verdict">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{id}</h3>
          <div className="sub">{row.rec.name}</div>
        </div>
        <button type="button" className="rx-btn" data-testid="locate" onClick={() => locateInModel(id, onSelect)} title="Select it, fold the workspace and frame the camera on it">
          Locate in 3D
        </button>
      </div>
      <div className="rx-inline" style={{ gap: 8, margin: "2px 0 0" }}>
        <TierChip tier={cand.tier} />
        {cand.score !== null && (
          <span data-testid="cmp-score" title="Weighted score, see the criteria below. It orders candidates; the tier is set by rules.">
            score <b>{cand.score.toFixed(0)}</b> / 100
          </span>
        )}
        <span className="rx-note" data-testid="cmp-known">{cand.known} of {cand.total} criteria verified on project data</span>
        {mine ? <Chip tone="alloc">Confirmed allocation · {fmtQtyU(mine.quantity, mine.unit)}</Chip> : <Chip title="A suggested match is a candidate, not a decision: nothing is allocated until you confirm it">Suggested match · not allocated</Chip>}
      </div>
      <p className={`rx-headline ${cand.tier}`} data-testid="cmp-headline">{headline(cand)}</p>

      <Section title="Criteria" aside={<span>requirement vs. this component</span>} testid="cmp-criteria">
        <table className="rx-table">
          <thead>
            <tr>
              <th>Criterion</th>
              <th>Requirement</th>
              <th>This component</th>
              <th>Result</th>
              <th style={{ textAlign: "right" }} title="weight × points earned">Points</th>
            </tr>
          </thead>
          <tbody>
            {(cand.criteria ?? []).flatMap((c) => {
              const lines = c.lines.length ? c.lines : [{ label: "", required: "not required", actual: "—", state: "na" as const }];
              return lines.map((l, i) => (
                <tr key={`${c.key}-${i}`} className={`${i === 0 ? "group" : "sub"}${c.state === "na" ? " na" : ""}`} data-criterion={c.key} data-state={l.state}>
                  {i === 0 ? (
                    <td className="crit" rowSpan={lines.length} title={CRITERION_HELP[c.key]}>
                      {CRITERION_LABELS[c.key]}
                    </td>
                  ) : null}
                  <td>
                    {l.label && <span className="rx-note">{l.label}: </span>}
                    {l.required}
                  </td>
                  <td>
                    {l.actual}
                    {l.note && <span className="why">{l.note}</span>}
                  </td>
                  <td className="res">
                    <span>
                      <StateIcon state={l.state} />
                      <span className="rx-note">{l.state === "met" ? "Met" : l.state === "partial" ? "Conditional" : l.state === "unknown" ? "Unknown" : l.state === "unmet" ? "Not met" : "—"}</span>
                    </span>
                  </td>
                  {i === 0 ? (
                    <td className="pts" rowSpan={lines.length} data-testid={`pts-${c.key}`}>
                      {c.state === "na" ? <span className="rx-note">not used</span> : <><b>{(c.weight * c.points).toFixed(1)}</b> <span className="rx-note">/ {c.weight}</span></>}
                    </td>
                  ) : null}
                </tr>
              ));
            })}
          </tbody>
        </table>
        <div className="rx-note" style={{ marginTop: 5 }} data-testid="cmp-formula">
          {incompatible ? "No score: at least one criterion fails." : <>Score = 100 × {earned.toFixed(1)} ÷ {wSum.toFixed(0)} = <b>{cand.score?.toFixed(1)}</b> · criteria the requirement does not use are left out; missing data earns the "unknown" credit set in the ranking weights.</>}
        </div>
      </Section>

      <Notes title="Why it is incompatible" items={cand.blockers} state="unmet" testid="cmp-blockers" />
      <Notes title="Conditions before reuse" items={cand.conditions} state="partial" testid="cmp-conditions" />
      <Notes title="Information the project data does not hold" items={cand.missing} state="unknown" testid="cmp-missing" />
      {cand.notes.length > 0 && (
        <Section title="Notes" testid="cmp-notes">
          <ul className="rx-list">
            {cand.notes.map((n, i) => (
              <li key={i}><StateIcon state="na" /><span className="rx-note">{n.text}</span></li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Allocation" aside={<span>confirm a quantity for this requirement</span>} testid="cmp-allocation">
        {incompatible ? (
          <div className="rx-banner warn" data-testid="cmp-cannot">Cannot be allocated: {cand.blockers[0]!.text}.</div>
        ) : (
          <div className="rx-alloc-box">
            <div>
              <div className="rx-note">Quantity ({unit})</div>
              <input className="rx-field num" data-testid="alloc-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commit()} aria-label={`Quantity to allocate in ${unit}`} />
            </div>
            <button type="button" className="rx-btn" data-testid="alloc-max" onClick={() => setQty(qtyInput(most))} disabled={most <= 0} title="The most that is free and still needed">
              Max {fmtQty(most, active.unit)}
            </button>
            <button type="button" className="rx-btn primary" data-testid="alloc-confirm" onClick={commit} disabled={free <= 0 && !mine}>
              {mine ? "Update allocation" : "Confirm allocation"}
            </button>
            {mine && (
              <button type="button" className="rx-btn danger" data-testid="alloc-remove" onClick={() => (reuseStore.removeAllocation(mine.id), setMsg({ ok: true, text: "Allocation removed" }))}>
                Remove
              </button>
            )}
            <div className="rx-note" style={{ flexBasis: "100%" }} data-testid="alloc-hint">
              This component can supply {fmtQtyU(cand.supply.value, cand.supply.unit)} ({cand.supply.basis === "recoverable" ? "B2 estimate" : "upper bound"}); {fmtQtyU(free, active.unit)} of it is free for this requirement
              {byComp.get(id) !== undefined && (byComp.get(id) ?? 0) - (mine?.quantity ?? 0) > 1e-9 ? ` (${fmtQtyU((byComp.get(id) ?? 0) - (mine?.quantity ?? 0), active.unit)} is allocated to other requirements)` : ""}. The requirement still needs {fmtQtyU(remaining, active.unit)}.
              {cand.tier === "conditional" && " Allocating a conditional match plans the material with its conditions; they stay open."}
            </div>
          </div>
        )}
        {msg && <div className={msg.ok ? "rx-ok" : "rx-error"} data-testid="alloc-msg" role="status">{msg.text}</div>}
        {flags?.map((f, i) => <div key={i} className="rx-flag" data-testid="alloc-flag">⚠ {f.text}</div>)}
      </Section>

      <SourceFacts id={id} />
      <div className="rx-note" style={{ marginTop: 12 }}>
        {TIER_LABELS[cand.tier]} match on recorded data. Inspect the component physically and have a qualified person assess suitability before any reuse.
      </div>
    </div>
  );
}
