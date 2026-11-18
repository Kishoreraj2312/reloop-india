/**
 * Ranked matches for the active requirement (C2): the requirement and how much of it is allocated, the strong / conditional /
 * incompatible candidates with a compact compatibility strip, a suggested allocation (derived, never stored) and the comparison of
 * the selected candidate. Rows are the real components; selecting one selects it in the building.
 */

import { memo, useMemo, useState } from "react";
import { FLOOR_LABEL } from "@/engine/quantities";
import {
  allocatedByComponent,
  fmtQty,
  fmtQtyU,
  freeOf,
  materialName,
  potentialSupply,
  proposeFill,
  ranked,
  sizeLabel,
  substanceLabel,
  TIERS,
  TIER_HELP,
  type Candidate,
  type Tier,
} from "@/engine/reuse";
import { UNIT_LABEL } from "@/engine/quantities";
import { Comparison } from "./Comparison";
import { specChips, useWorkspace } from "./hooks";
import { reuseStore, useReuse, type Show3d } from "./reuseStore";
import { Bar, Chip, PipHeads, Pips, Section, Seg, TierChip, VList, n0, useDebounced } from "./ui";

const ROW = 48;
const COLS = "92px minmax(0, 1fr) 112px 54px 96px";

const Row = memo(function Row({ c, selected, own, free, line, floor, onSelect }: { c: Candidate; selected: boolean; own: number; free: number; line: string; floor: string; onSelect: (id: string) => void }) {
  const dim = c.tier === "incompatible";
  return (
    <div className={`rx-row${dim ? " dim" : ""}`} style={{ gridTemplateColumns: COLS }} aria-selected={selected} data-testid="candidate" data-id={c.id} data-tier={c.tier} data-score={c.score ?? ""} onClick={() => onSelect(c.id)}>
      <TierChip tier={c.tier} compact />
      <div className="rx-cell-main">
        <div className="l1">
          <span className="rx-mono" title={c.id}>{c.id}</span>
          {own > 0 && <Chip tone="alloc" title="Confirmed allocation to this requirement">allocated {fmtQty(own, c.supply.unit)}</Chip>}
        </div>
        <div className="l2" title={line}>{dim ? c.blockers[0]!.text : `${line} · ${floor}`}</div>
      </div>
      <Pips states={c.states} />
      <div className="rx-right">
        {c.score === null ? <span className="rx-note">—</span> : (
          <span className="rx-score"><b>{c.score.toFixed(0)}</b></span>
        )}
      </div>
      <div className="rx-right" title={c.supply.note}>
        {dim ? <span className="rx-note">—</span> : (
          <>
            <span className="rx-qty">{fmtQtyU(c.supply.value, c.supply.unit)}</span>
            <div className="rx-note" style={{ fontSize: 10 }}>{free < (c.supply.value ?? 0) - 1e-9 ? (free <= 1e-9 ? "fully allocated" : `${fmtQty(free, c.supply.unit)} free`) : c.supply.basis === "upper_bound" ? "upper bound" : "B2 estimate"}</div>
          </>
        )}
      </div>
    </div>
  );
});

export function Matches() {
  const ws = useWorkspace();
  const rs = useReuse();
  const { active, result, ctx, ledger, selectedId, onSelect } = ws;
  const [text, setText] = useState("");
  const q = useDebounced(text, 200).trim().toLowerCase();
  const [floor, setFloor] = useState<number | "">("");
  const [hideTaken, setHideTaken] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const byComp = useMemo(() => allocatedByComponent(rs.allocations), [rs.allocations]);
  const own = useMemo(() => new Map(rs.allocations.filter((a) => a.requirementId === active?.id).map((a) => [a.componentId, a.quantity])), [rs.allocations, active?.id]);

  const proposal = useMemo(() => (active && result && rs.proposing ? proposeFill(active, result, rs.allocations, { includeConditional: rs.proposeConditional }) : null), [active, result, rs.allocations, rs.proposing, rs.proposeConditional]);
  const potential = useMemo(() => (active && result ? potentialSupply(result, rs.allocations, active.id) : null), [active, result, rs.allocations]);

  const list = useMemo(() => {
    if (!result) return [];
    const base = rs.tierFilter === "all" ? ranked(result) : [...result[rs.tierFilter]];
    const inv = ctx.inv;
    return base.filter((c) => {
      const rec = inv.recordById.get(c.id)!;
      if (floor !== "" && rec.floor !== floor) return false;
      if (hideTaken && c.tier !== "incompatible" && freeOf(c.supply.value, c.id, byComp, own.get(c.id) ?? 0) <= 1e-9 && !own.has(c.id)) return false;
      if (q && !rec.id.toLowerCase().includes(q) && !rec.name.toLowerCase().includes(q) && !materialName(rec.materialId).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [result, rs.tierFilter, floor, hideTaken, q, ctx.inv, byComp, own]);

  const floors = useMemo(() => [...ctx.inv.breakdowns.floor.keys()].map(Number).sort((a, b) => a - b), [ctx.inv]);
  const step = (to: "prev" | "next" | "first" | "last") => {
    if (list.length === 0) return;
    const i = list.findIndex((c) => c.id === selectedId);
    const next = to === "first" ? 0 : to === "last" ? list.length - 1 : to === "next" ? Math.min(list.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    onSelect(list[next]!.id);
  };

  if (!active || !result) {
    return (
      <div className="rx-pane" data-testid="matches-empty">
        <div className="rx-empty" style={{ marginTop: 30 }}>
          <h4>{rs.requirements.length ? "Choose a requirement" : "Create a requirement to find matches"}</h4>
          {rs.requirements.length ? "Pick one from the list on the left." : "A requirement states what a new project needs: a material, a quantity and the sizes. The model's components are then compared with it, criterion by criterion."}
          <div style={{ marginTop: 12 }}>
            <button type="button" className="rx-btn primary" data-testid="matches-new" onClick={() => reuseStore.beginNew()}>+ New requirement</button>
          </div>
        </div>
      </div>
    );
  }

  const d = ledger.demand.find((x) => x.requirement.id === active.id)!;
  const counts: Record<Tier, number> = { strong: result.strong.length, conditional: result.conditional.length, incompatible: result.incompatible.length };
  const unit = UNIT_LABEL[active.unit];
  const lineOf = (id: string) => {
    const rec = ctx.inv.recordById.get(id)!;
    return `${sizeLabel(rec)} · ${materialName(rec.materialId)}`;
  };
  const floorOf = (id: string) => {
    const rec = ctx.inv.recordById.get(id)!;
    return `${FLOOR_LABEL[rec.floor] ?? rec.floor}${rec.apartmentId ? ` · ${rec.apartmentId}` : ""}${rec.roomId ? ` · ${rec.roomId.replace(/^.*-/, "")}` : ""}`;
  };
  const topBlockers = [...result.blockerCounts].sort((a, b) => b[1].count - a[1].count).slice(0, 3);
  const detailId = selectedId && ctx.inv.recordById.get(selectedId)?.geometry.kind !== "group" && ctx.inv.recordById.has(selectedId) ? selectedId : null;

  return (
    <div className="rx-pane" data-testid="matches">
      <div className="rx-summary" data-testid="requirement-summary" data-requirement={active.id}>
        <div className="rx-summary-top">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 data-testid="active-name">{active.name}</h3>
            <div className="rx-note">{active.application ? `${active.application} · ` : "No application stated · "}{fmtQtyU(active.quantity, active.unit)} required</div>
          </div>
          <button type="button" className="rx-btn sm" data-testid="req-edit" onClick={() => reuseStore.beginEdit(active.id)}>Edit</button>
          <button type="button" className="rx-btn sm" data-testid="req-duplicate" onClick={() => reuseStore.duplicate(active.id)}>Duplicate</button>
          <DeleteButton id={active.id} count={d.components} />
        </div>
        <div className="rx-chips" data-testid="spec-chips">
          {specChips(active).map((s, i) => (
            <span key={i} className="rx-spec"><b>{s.k}</b>{s.v}</span>
          ))}
        </div>
        <div className="rx-demand" data-testid="demand">
          <Stat k="Required" v={fmtQty(d.required, active.unit)} unit={unit} />
          <Stat k="Allocated (confirmed)" v={fmtQty(d.allocated, active.unit)} unit={unit} testid="demand-allocated" />
          <Stat k="Remaining" v={fmtQty(d.remaining, active.unit)} unit={unit} testid="demand-remaining" />
          <Stat k="Could still be supplied" v={potential ? fmtQty(potential.strong + potential.conditional, active.unit) : "—"} unit={unit} title={potential ? `${fmtQtyU(potential.strong, active.unit)} from strong and ${fmtQtyU(potential.conditional, active.unit)} from conditional candidates, net of what other requirements have taken` : undefined} />
          <div>
            <Bar total={d.required} height={8} testid="demand-bar" parts={[{ value: Math.min(d.allocated, d.required), kind: "alloc", title: "Confirmed allocations" }, { value: proposal ? Math.min(proposal.quantity, d.remaining) : 0, kind: "proposed", title: "Suggested (not confirmed)" }]} />
            <div className="rx-note" style={{ marginTop: 3 }} data-testid="demand-status" data-status={d.status}>
              {d.status === "matched" ? "Matched: the requirement is fully allocated" : d.status === "partial" ? `Partially matched: ${fmtQtyU(d.remaining, active.unit)} still unmet` : d.status === "over" ? "Over-allocated" : "Unmet: nothing allocated yet"}
              {d.conditional > 1e-9 && <span className="rx-warn" style={{ color: "var(--rx-cond)" }} data-testid="demand-conditional"> · {fmtQtyU(d.conditional, active.unit)} of it conditional: conditions still open</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="rx-toolbar">
        {TIERS.map((t) => (
          <button key={t} type="button" className="rx-tierbtn" aria-pressed={rs.tierFilter === t} title={TIER_HELP[t]} data-testid={`tier-${t}`} onClick={() => reuseStore.setTierFilter(rs.tierFilter === t ? "all" : t)}>
            <TierChip tier={t} compact /> <b data-testid={`tier-count-${t}`}>{n0(counts[t])}</b>
          </button>
        ))}
        <input className="rx-field" style={{ width: 150 }} placeholder="Search" data-testid="match-search" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search candidates" />
        <select className="rx-select" data-testid="match-floor" value={floor} onChange={(e) => setFloor(e.target.value === "" ? "" : Number(e.target.value))} aria-label="Floor">
          <option value="">Any floor</option>
          {floors.map((f) => <option key={f} value={f}>{FLOOR_LABEL[f] ?? f}</option>)}
        </select>
        <label className="rx-check" title="Hide candidates whose whole supply is already allocated"><input type="checkbox" data-testid="match-hide-taken" checked={hideTaken} onChange={(e) => setHideTaken(e.target.checked)} /> hide fully allocated</label>
        <span style={{ marginLeft: "auto" }} className="rx-inline">
          <span className="rx-note">In 3D</span>
          <Seg<Show3d> value={rs.show3d} onChange={reuseStore.setShow3d} testid="show3d" label="Mark in the 3D model" options={[{ value: "candidates", label: "Candidates", title: "Strong (green) and conditional (amber) candidates, and the allocations (blue)", testid: "show3d-candidates" }, { value: "allocated", label: "Allocated", title: "Every confirmed allocation of every requirement", testid: "show3d-allocated" }, { value: "off", label: "Off", testid: "show3d-off" }]} />
        </span>
      </div>

      <div className="rx-toolbar" style={{ paddingTop: 0 }}>
        <button type="button" className="rx-btn accent" data-testid="suggest" disabled={d.remaining <= 1e-9 || counts.strong + counts.conditional === 0} onClick={() => reuseStore.setProposing(!rs.proposing)} aria-pressed={rs.proposing} title="Fill the requirement from the ranking. Nothing is allocated until you confirm.">
          {rs.proposing ? "Hide suggestion" : "Suggest allocation"}
        </button>
        <div className="rx-legend" style={{ marginLeft: 4 }}>
          <span>strip:</span><PipHeads />
          <span title="Material · Dimensions · Quantity · Condition · Recovery · Processing · Other specs">hover a mark for the criterion</span>
        </div>
        {topBlockers.length > 0 && rs.tierFilter !== "incompatible" && counts.incompatible > 0 && (
          <span className="rx-note" style={{ marginLeft: "auto" }} data-testid="why-not">
            {n0(counts.incompatible)} incompatible, mostly:{" "}
            {topBlockers.map(([code, b], i) => <span key={code}>{i > 0 ? "; " : ""}<button type="button" className="rx-link" onClick={() => reuseStore.setTierFilter("incompatible")} title={b.sample}>{n0(b.count)} × {code.replace(/_/g, " ")}</button></span>)}
          </span>
        )}
      </div>

      {proposal && (
        <div className="rx-banner info" style={{ margin: "0 14px 8px" }} data-testid="proposal">
          <div className="rx-inline" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <b>Suggested allocation — not confirmed</b>
            <span data-testid="proposal-summary">
              {proposal.items.length} component{proposal.items.length === 1 ? "" : "s"} · {fmtQtyU(proposal.quantity, active.unit)} of the {fmtQtyU(d.remaining, active.unit)} still needed
              {proposal.remainingAfter > 1e-9 ? ` · ${fmtQtyU(proposal.remainingAfter, active.unit)} stays unmet` : " · covers the requirement"}
              {proposal.conditionalCount > 0 ? ` · ${proposal.conditionalCount} conditional` : ""}
              {proposal.items.some((i) => i.partialPiece) ? " · last piece would be cut" : ""}
            </span>
            <label className="rx-check"><input type="checkbox" data-testid="proposal-conditional" checked={rs.proposeConditional} onChange={(e) => reuseStore.setProposing(true, e.target.checked)} /> include conditional</label>
            <span style={{ marginLeft: "auto" }} className="rx-inline">
              <button type="button" className="rx-btn sm primary" data-testid="proposal-confirm" disabled={proposal.items.length === 0} onClick={() => {
                const r = reuseStore.confirmProposal(active.id, rs.proposeConditional);
                setConfirmMsg(r.errors.length ? `${r.applied} confirmed, ${r.errors.length} refused: ${r.errors[0]}` : null);
              }}>Confirm {proposal.items.length}</button>
              <button type="button" className="rx-btn sm" onClick={() => reuseStore.setProposing(false)}>Discard</button>
            </span>
          </div>
          <div className="rx-note" style={{ marginTop: 3 }}>
            Filled in ranking order, larger supply first so fewer pieces are needed; what other requirements have taken is respected. {proposal.items.slice(0, 4).map((i) => `${i.componentId} ${fmtQty(i.quantity, active.unit)}`).join(" · ")}{proposal.items.length > 4 ? ` · +${proposal.items.length - 4} more` : ""}
          </div>
        </div>
      )}

      {confirmMsg && <div className="rx-error" style={{ margin: "0 14px 6px" }} data-testid="proposal-error" role="alert">{confirmMsg}</div>}
      <div className="rx-listhead" style={{ gridTemplateColumns: COLS, gap: 8 }}>
        <span>Match</span>
        <span>Component · material · size · location</span>
        <span>Criteria</span>
        <span className="rx-right" title="Weighted score (ranking only)">Score</span>
        <span className="rx-right">Can supply</span>
      </div>
      <VList
        testid="candidate-list"
        items={list}
        rowHeight={ROW}
        keyOf={(c) => c.id}
        scrollToKey={selectedId}
        onStep={step}
        style={{ flex: detailId ? "0 0 clamp(170px, 26vh, 280px)" : "1 1 auto" }}
        empty={<div className="rx-empty"><h4>No candidates in this view</h4>{result.evaluated === 0 ? `No component of the model is ${substanceLabel(active.substance).toLowerCase()}.` : "Change the tier, search or floor filter."} {result.excluded > 0 && `${n0(result.excluded)} components of other materials were not evaluated.`}</div>}
        renderRow={(c) => <Row c={c} selected={c.id === selectedId} own={own.get(c.id) ?? 0} free={freeOf(c.supply.value, c.id, byComp, own.get(c.id) ?? 0)} line={lineOf(c.id)} floor={floorOf(c.id)} onSelect={onSelect} />}
      />
      {detailId ? (
        <Comparison id={detailId} />
      ) : (
        <div className="rx-detail" style={{ flex: "0 0 auto", maxHeight: 130 }}>
          <Section title="Compare" testid="matches-hint">
            <div className="rx-note">Select a candidate (a row, or a component in the model) to compare it with the requirement criterion by criterion, see what is missing, and allocate a quantity.
              {" "}{n0(result.evaluated)} components of {substanceLabel(active.substance).toLowerCase()} were evaluated; {n0(result.excluded)} of other materials were not.</div>
          </Section>
        </div>
      )}
    </div>
  );
}

function Stat({ k, v, unit, testid, title }: { k: string; v: string; unit: string; testid?: string; title?: string }) {
  return (
    <div className="rx-stat" title={title}>
      <div className="k">{k}</div>
      <div className="v" data-testid={testid}>{v}<small>{unit}</small></div>
    </div>
  );
}

function DeleteButton({ id, count }: { id: string; count: number }) {
  const [ask, setAsk] = useState(false);
  if (!ask) return <button type="button" className="rx-btn sm danger" data-testid="req-delete" onClick={() => setAsk(true)}>Delete</button>;
  return (
    <span className="rx-inline">
      <button type="button" className="rx-btn sm danger" data-testid="req-delete-confirm" onClick={() => (reuseStore.remove(id), setAsk(false))} title={count ? `Also releases its ${count} allocation${count === 1 ? "" : "s"}` : undefined}>Delete{count ? ` + ${count} alloc.` : ""}?</button>
      <button type="button" className="rx-btn sm" onClick={() => setAsk(false)}>Keep</button>
    </span>
  );
}
