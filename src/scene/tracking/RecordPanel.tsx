/**
 * The tracking panel of one component (C3): its stage, planned versus actual, what is wrong or missing, the links to the other modules
 * (the C2 allocation it is meant for, the B3 removal order, the B2 plan, the C1 passport and its place in the 3D building), the forms
 * that record what actually happened, and its history. A component nobody tracks yet shows what is planned for it and a way to start.
 */

import { useState } from "react";
import { CATEGORY_LABELS, FLOOR_LABEL } from "@/engine/quantities";
import { CLASSIFICATION_LABELS, substanceOf } from "@/engine/recovery";
import { fieldOf } from "@/engine/passport";
import { fmtQtyU, materialName, sizeLabel, substanceLabel } from "@/engine/reuse";
import { EXPECTED_LABELS, FLAG_LEVELS, moves, STATUS_LABELS, STATUS_SHORT, STATUSES, type Status, type Summary, type TrackingEvent } from "@/engine/tracking";
import { leafDescendants } from "@/engine/quantities";
import { fmtCarbon } from "../carbon/format";
import { passportStore } from "../passport/passportStore";
import { usePassport } from "../passport/usePassport";
import { locateInModel } from "../reuse/locate";
import { reuseStore } from "../reuse/reuseStore";
import { Chip, Section } from "../reuse/ui";
import { RecordForms } from "./Forms";
import { History } from "./History";
import { useWorkspace } from "./hooks";
import { liveFn } from "@/engine/tracking";
import { trackingStore, useTracking } from "./trackingStore";
import { PlanBars } from "./Viz";

export function StageChip({ status, title }: { status: Status | "not_tracked"; title?: string }) {
  return status === "not_tracked" ? (
    <span className="tk-stage st-none" title={title ?? "Nobody has started tracking this component"} data-stage="not_tracked">
      <i />
      Not tracked
    </span>
  ) : (
    <span className={`tk-stage st-${status}`} title={title ?? STATUS_LABELS[status]} data-stage={status}>
      <i />
      {STATUS_SHORT[status]}
    </span>
  );
}

/** What the next useful step is, in words, from the record's accounting. */
function hint(s: Summary): string {
  const unit = s.unit;
  if (s.status === "hold") return "On hold: record what the outcome is waiting for, then resume when it is known.";
  if (s.status === "planned") return "Next: start deconstruction, then record what is actually recovered (a recorded zero counts).";
  if (s.recovered === null) return "Next: record the first recovered quantity (a recorded zero counts; not recording stays unknown).";
  if ((s.inHand ?? 0) > 1e-9) {
    const open = s.allocations.find((a) => (s.fulfilled.get(a.id) ?? 0) < a.quantity - 1e-9);
    return open ? `${fmtQtyU(s.inHand, unit)} is in hand. It is allocated in C2 to "${open.requirementName}": record the reuse when it happens, or record another outcome.` : `${fmtQtyU(s.inHand, unit)} is in hand: inspect it, then record where it went (reused, recycled or disposed).`;
  }
  if ((s.notYetRecovered ?? 0) > 1e-9) return `${fmtQtyU(s.notYetRecovered, unit)} is neither recovered nor written off: record more recovery, or record it as not recovered.`;
  return "Everything is accounted for.";
}

export function RecordPanel({ id }: { id: string }) {
  const ws = useWorkspace();
  const ts = useTracking();
  const record = ts.records[id];
  const row = ws.rowById.get(id);
  const rec = ws.ctx.inv.recordById.get(id);
  const q = ws.ctx.inv.byId.get(id);
  if (!rec || !q) {
    return (
      <div className="rx-detail" data-testid="record-panel" data-id={id}>
        <div className="rx-empty">
          <h4>Not a component of the model</h4>
          {record ? "This record belongs to a component that is not in the current model: its history is kept." : "Nothing to track."}
        </div>
        {record && row && <TrackedBody id={id} summaryRow={row.summary} />}
      </div>
    );
  }
  return record && row ? (
    <div className="rx-detail tk-record" data-testid="record-panel" data-id={id} data-tracked="true">
      <TrackedBody id={id} summaryRow={row.summary} />
    </div>
  ) : (
    <UntrackedBody id={id} />
  );
}

// ── a component that is not tracked yet ──────────────────────────────────────

function UntrackedBody({ id }: { id: string }) {
  const ws = useWorkspace();
  const ts = useTracking();
  const rec = ws.ctx.inv.recordById.get(id)!;
  const q = ws.ctx.inv.byId.get(id)!;
  const isAssembly = rec.geometry.kind === "group";
  const parts = isAssembly ? leafDescendants(ws.ctx.inv, id) : [];
  const tracked = parts.filter((p) => ts.records[p.rec.id]).length;
  const live = liveFn(ws.ctx)(id);
  const ev = ws.scope.get(id);
  const [msg, setMsg] = useState<string | null>(null);
  const go = () => {
    const r = trackingStore.start([id]);
    setMsg(r.error ?? `${r.started} component${r.started === 1 ? "" : "s"} now tracked${r.alreadyTracked ? ` (${r.alreadyTracked} already were)` : ""}`);
  };
  return (
    <div className="rx-detail tk-record" data-testid="record-panel" data-id={id} data-tracked="false">
      <div className="rx-verdict">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{id}</h3>
          <div className="sub">{rec.name}</div>
        </div>
        <StageChip status="not_tracked" />
        {!isAssembly && (
          <button type="button" className="rx-btn" data-testid="locate" onClick={() => locateInModel(id, ws.onSelect, () => trackingStore.setCollapsed(true))}>
            Locate in 3D
          </button>
        )}
      </div>
      <Section title="Planned for recovery" aside={<span>read from B2, B3 and C2</span>} testid="untracked-plan">
        <dl className="rx-kv">
          <dt>Component</dt>
          <dd>
            {isAssembly ? `Assembly of ${parts.length} parts (tracked through its parts: ${tracked} already are)` : `${CATEGORY_LABELS[q.category]} · ${substanceLabel(substanceOf(rec.materialId))} · ${materialName(rec.materialId)}`}
          </dd>
          {!isAssembly && (
            <>
              <dt>Size · location</dt>
              <dd>
                {sizeLabel(rec)} · {FLOOR_LABEL[rec.floor] ?? rec.floor}
                {rec.apartmentId ? ` · ${rec.apartmentId}` : ""}
              </dd>
              <dt>Quantity (B1)</dt>
              <dd>{fmtQtyU(q.primary.value, q.primary.unit)}</dd>
              <dt>Planned recovery</dt>
              <dd data-testid="untracked-planned">
                {live.plan.quantity !== null ? (
                  <>
                    <b>{fmtQtyU(live.plan.quantity, q.primary.unit)}</b> <Chip tone="cond">B2 estimate</Chip>{" "}
                    <span className="rx-note">
                      {live.plan.classification ? CLASSIFICATION_LABELS[live.plan.classification] : ""} · {live.plan.pct} % recovery
                    </span>
                  </>
                ) : (
                  <span className="rx-note">{live.plan.classification ? `${CLASSIFICATION_LABELS[live.plan.classification]}: B2 gives no recovery estimate` : "not assessed in B2: nothing is planned"}</span>
                )}
              </dd>
              <dt>C2 allocation</dt>
              <dd>{live.allocations.length ? live.allocations.map((a) => `${fmtQtyU(a.quantity, q.primary.unit)} → ${a.requirementName}`).join(", ") : <span className="rx-note">none</span>}</dd>
              <dt>Removal order (B3)</dt>
              <dd>{live.removal ? `step ${live.removal.step} of ${live.removal.steps} in "${live.removal.planName}"` : <span className="rx-note">not in the active removal plan</span>}</dd>
            </>
          )}
        </dl>
        {!isAssembly && !ev && <div className="rx-note" style={{ marginTop: 4 }}>Nothing plans to recover this component. You can still track it: it will be an unplanned recovery with no planned quantity.</div>}
      </Section>
      <div className="rx-actions" style={{ marginTop: 10 }}>
        <button type="button" className="rx-btn primary" data-testid="start-tracking" onClick={go}>
          {isAssembly ? `Start tracking its ${parts.length} parts` : "Start tracking"}
        </button>
        {msg && <span className="rx-note" data-testid="start-msg">{msg}</span>}
      </div>
      <div className="rx-note" style={{ marginTop: 8 }}>Starting tracking records the plan as it stands now. Nothing is recovered, reused, recycled or disposed until you record it.</div>
    </div>
  );
}

// ── a tracked component ──────────────────────────────────────────────────────

function Stepper({ id, s }: { id: string; s: Summary }) {
  const ws = useWorkspace();
  const record = trackingStore.record(id)!;
  const m = new Map(moves(record, liveFn(ws.ctx)(id)).map((x) => [x.status, x.error]));
  const [holding, setHolding] = useState(false);
  const [why, setWhy] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const go = (status: Status, note = "") => {
    const e = trackingStore.apply(id, { type: "status", status, note });
    setMsg(e);
    if (!e) (setHolding(false), setWhy(""));
  };
  const groups: Status[][] = [["planned", "in_progress", "recovered", "inspected", "allocated"], ["reused", "recycled", "disposed"], ["hold"]];
  return (
    <div data-testid="stepper">
      <div className="tk-steps">
        {groups.map((g, gi) => (
          <div key={gi} className="tk-stepgroup">
            {g.map((st) => {
              const cur = s.status === st;
              const err = cur ? null : (m.get(st) ?? null);
              return (
                <button key={st} type="button" className={`tk-step st-${st}${cur ? " cur" : ""}`} aria-pressed={cur} disabled={cur || err !== null} data-stage={st} data-testid={`stage-${st}`} title={cur ? `Current: ${STATUS_LABELS[st]}` : err ?? `Move to: ${STATUS_LABELS[st]}`} onClick={() => (st === "hold" ? setHolding(!holding) : go(st))}>
                  <i />
                  {STATUS_SHORT[st]}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {holding && (
        <div className="tk-void" data-testid="hold-form" style={{ marginTop: 6 }}>
          <input className="rx-field" data-testid="hold-reason" placeholder="What is the outcome waiting for? (required)" value={why} maxLength={160} onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go("hold", why)} />
          <button type="button" className="rx-btn sm primary" data-testid="hold-confirm" onClick={() => go("hold", why)}>
            Put on hold
          </button>
        </div>
      )}
      {msg && <div className="rx-error" data-testid="stage-error" role="alert">{msg}</div>}
      <div className="rx-note" style={{ marginTop: 4 }} data-testid="hint">{hint(s)}</div>
    </div>
  );
}

function TrackedBody({ id, summaryRow: s }: { id: string; summaryRow: Summary }) {
  const ws = useWorkspace();
  const ts = useTracking();
  const record = ts.records[id]!;
  const rec = ws.ctx.inv.recordById.get(id);
  const passport = usePassport(rec ? id : null);
  const carbon = passport?.found ? fieldOf(passport, "sustainability", "carbon") : undefined;
  const live = liveFn(ws.ctx)(id);
  const [formKey, setFormKey] = useState(0);
  const [initial, setInitial] = useState<"recover" | "outcome" | "unrecovered" | undefined>(undefined);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const flags = s.flags;
  const openForm = (k: "recover" | "outcome" | "unrecovered") => {
    setInitial(k);
    setFormKey((n) => n + 1);
  };
  // allocations whose latest logged change is "cancelled" (the history keeps them; the record's remembered allocations no longer do)
  const lastChange = new Map<string, TrackingEvent>();
  for (const e of record.events) if (e.kind === "allocation") lastChange.set(e.allocationId, e);
  const seenCancelled = [...lastChange.entries()].filter(([aid, e]) => e.kind === "allocation" && e.change === "cancelled" && !live.allocations.some((a) => a.id === aid)).map(([aid, e]) => [aid, { requirementName: e.kind === "allocation" ? e.requirementName : "", quantity: e.kind === "allocation" ? e.quantity : 0 }] as const);
  return (
    <>
      <div className="rx-verdict">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{id}</h3>
          <div className="sub">{rec?.name ?? "not in the current model"}</div>
        </div>
        <StageChip status={s.status} />
        <button type="button" className="rx-btn" data-testid="open-passport" title="Show this component's material passport (C1) in the left column" onClick={() => (passportStore.setCollapsed(false), ws.onSelect(id), requestAnimationFrame(() => document.querySelector("[data-testid=passport-panel]")?.scrollIntoView({ block: "nearest" })))}>
          Passport
        </button>
        {rec && (
          <button type="button" className="rx-btn" data-testid="locate" title="Select it, fold the workspace and frame the camera on it" onClick={() => locateInModel(id, ws.onSelect, () => trackingStore.setCollapsed(true))}>
            Locate in 3D
          </button>
        )}
      </div>

      <Section title="Stage" aside={<span>quick update: only the stages the recorded quantities allow are enabled</span>} testid="stage-section">
        <Stepper id={id} s={s} />
        <div className="rx-inline" style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button type="button" className="rx-btn sm" data-testid="quick-recover" onClick={() => openForm("recover")}>Record recovery…</button>
          <button type="button" className="rx-btn sm" data-testid="quick-outcome" onClick={() => openForm("outcome")} disabled={s.recovered === null}>Record outcome…</button>
          <button type="button" className="rx-btn sm" data-testid="quick-unrecovered" onClick={() => openForm("unrecovered")} disabled={s.recovered === null}>Record remainder as not recovered…</button>
        </div>
      </Section>

      <Section title="Planned versus actual" aside={<span>{s.unit === "m2" ? "m²" : s.unit === "m3" ? "m³" : s.unit}</span>} testid="pva-section">
        <PlanBars s={s} />
      </Section>

      {flags.length > 0 && (
        <Section title={`Attention (${flags.length})`} testid="flags-section">
          <ul className="rx-list" data-testid="flag-list">
            {flags.map((f, i) => (
              <li key={i} data-code={f.code} data-level={f.level}>
                <span className={`tk-flag ${FLAG_LEVELS[f.code]}`} aria-hidden="true">{f.level === "error" ? "!" : f.level === "warning" ? "▲" : "i"}</span>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Linked records" aside={<span>read from B2, B3, C2 and B5</span>} testid="links-section">
        <dl className="rx-kv">
          <dt>Plan (B2)</dt>
          <dd data-testid="link-plan">
            {s.classification ? CLASSIFICATION_LABELS[s.classification] : <span className="rx-note">not assessed</span>}
            {s.pct !== null && <> · {s.pct} % recovery</>}
            {s.expected && <> · expected pathway: {EXPECTED_LABELS[s.expected]}</>}
            {s.plannedBasis === "none" && <div className="rx-note">no planned quantity: state one under Record → Plan, or assess it in Recovery (B2)</div>}
          </dd>
          <dt>Removal order (B3)</dt>
          <dd data-testid="link-removal">{live.removal ? `step ${live.removal.step} of ${live.removal.steps} in "${live.removal.planName}" (a planned order, not evidence of removal)` : <span className="rx-note">not in the active removal plan</span>}</dd>
          <dt>Reuse (C2)</dt>
          <dd data-testid="link-c2">
            {live.allocations.length === 0 && seenCancelled.length === 0 && <span className="rx-note">no allocation</span>}
            {live.allocations.map((a) => {
              const done = s.fulfilled.get(a.id) ?? 0;
              return (
                <div key={a.id} data-allocation={a.id} className="tk-alloc">
                  <b>{a.requirementName}</b>: allocated {fmtQtyU(a.quantity, s.unit)} · <span data-testid="alloc-fulfilled">reused against it {fmtQtyU(done, s.unit)}</span>
                  <Chip tone={done >= a.quantity - 1e-9 ? "strong" : done > 0 ? "cond" : "neutral"}>{done >= a.quantity - 1e-9 ? "fulfilled" : done > 0 ? "partly fulfilled" : "not yet reused"}</Chip>
                </div>
              );
            })}
            {seenCancelled.map(([aid, a]) => (
              <div key={aid} className="rx-note">
                <s>{a.requirementName}: {fmtQtyU(a.quantity, s.unit)}</s> · no longer in C2 (logged in the history)
              </div>
            ))}
            <button type="button" className="rx-link" onClick={() => reuseStore.setOpen(true)}>
              open reuse matching
            </button>
          </dd>
          <dt>Carbon (B5)</dt>
          <dd data-testid="link-carbon">
            {carbon && carbon.value !== null ? (
              <>
                {fmtCarbon(Number(carbon.value))} <Chip tone="cond" title={carbon.note}>{carbon.status}</Chip>
                <div className="rx-note">B5's baseline for the existing component, shown as context. No saving is claimed: that needs B5's replacement assumptions and measured data.</div>
              </>
            ) : (
              <span className="rx-note">not assessed in B5</span>
            )}
          </dd>
        </dl>
      </Section>

      <Section title="Record what happened" aside={<span>planned figures above are never changed by what you record</span>} testid="forms-section">
        <RecordForms key={formKey} id={id} s={s} {...(initial ? { initial } : {})} />
      </Section>

      <Section title={`History (${record.events.length})`} aside={<span>append-only: mistakes are voided, never edited</span>} testid="history-section">
        <History record={record} />
      </Section>

      <div className="rx-actions" style={{ marginTop: 12 }}>
        {!confirmDiscard ? (
          <button type="button" className="rx-btn sm danger" data-testid="discard" onClick={() => setConfirmDiscard(true)}>
            Stop tracking…
          </button>
        ) : (
          <>
            <span className="rx-note">This deletes the whole history of this record.</span>
            <button type="button" className="rx-btn sm danger" data-testid="discard-confirm" onClick={() => (trackingStore.discard([id]), setConfirmDiscard(false))}>
              Delete the record
            </button>
            <button type="button" className="rx-btn sm" onClick={() => setConfirmDiscard(false)}>
              Keep
            </button>
          </>
        )}
      </div>
    </>
  );
}

export { STATUSES };
