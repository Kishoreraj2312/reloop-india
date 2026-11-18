/**
 * Recording what actually happened to one component (C3): recovery, outcome, material not recovered, a stated plan, a documented variance
 * and notes. Every quantity is in the component's own B1 unit, needs a source (measured / estimated / assumed, chosen explicitly: there is
 * no default, so nothing is called measured by accident) and goes through the engine's validation; a refusal is shown with its reason.
 */

import { useEffect, useState } from "react";
import { UNIT_LABEL } from "@/engine/quantities";
import { fmtQtyU } from "@/engine/reuse";
import { OUTCOME_LABELS, OUTCOMES, SOURCES, SOURCE_LABELS, type Outcome, type Op, type Source, type Summary } from "@/engine/tracking";
import { qtyInput, Seg } from "../reuse/ui";
import { trackingStore } from "./trackingStore";

type FormKind = "recover" | "outcome" | "unrecovered" | "plan" | "variance" | "note";
const KINDS: readonly { value: FormKind; label: string; title: string }[] = [
  { value: "recover", label: "Recovery", title: "Record material actually recovered" },
  { value: "outcome", label: "Outcome", title: "Record where recovered material went: reused, recycled or disposed" },
  { value: "unrecovered", label: "Not recovered", title: "Write off material that was not recovered (lost, broken, sent to waste)" },
  { value: "plan", label: "Plan", title: "State the planned quantity yourself" },
  { value: "variance", label: "Variance", title: "Document that the real quantity differs from B1's modelled one" },
  { value: "note", label: "Note", title: "Add a note to the history" },
];

const today = () => new Date().toISOString().slice(0, 10);

export function RecordForms({ id, s, initial }: { id: string; s: Summary; initial?: FormKind }) {
  const [kind, setKind] = useState<FormKind>(initial ?? "recover");
  const [qty, setQty] = useState("");
  const [source, setSource] = useState<Source | "">("");
  const [method, setMethod] = useState("");
  const [at, setAt] = useState(today());
  const [note, setNote] = useState("");
  const [complete, setComplete] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("reused");
  const [destination, setDestination] = useState("");
  const [allocationId, setAllocationId] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const unit = UNIT_LABEL[s.unit];

  // a different component starts a clean form
  useEffect(() => {
    setQty("");
    setNote("");
    setReason("");
    setMsg(null);
    setComplete(false);
    setAllocationId("");
  }, [id]);
  useEffect(() => {
    if (initial) setKind(initial);
  }, [initial]);

  const unfulfilled = s.allocations.map((a) => ({ a, left: Math.max(0, a.quantity - (s.fulfilled.get(a.id) ?? 0)) })).filter((x) => x.left > 1e-9);

  const submit = () => {
    const n = Number(qty);
    const common = { at, note, ...(method.trim() ? { method } : {}) };
    let op: Op | null = null;
    if (kind === "note") op = { type: "note", note, at };
    else if (kind === "plan") {
      if (source === "") return setMsg({ ok: false, text: "Say whether the planned quantity is measured, estimated or assumed" });
      op = { type: "plan", quantity: qty.trim() === "" ? null : n, source, ...common };
    } else {
      if (qty.trim() === "" || !Number.isFinite(n)) return setMsg({ ok: false, text: "Enter a quantity" });
      if (source === "") return setMsg({ ok: false, text: "Say whether the quantity is measured, estimated or assumed" });
      if (kind === "recover") op = { type: "recover", quantity: n, source, complete, ...common };
      else if (kind === "outcome") op = { type: "outcome", outcome, quantity: n, source, destination, allocationId: outcome === "reused" && allocationId ? allocationId : null, ...common };
      else if (kind === "unrecovered") op = { type: "unrecovered", quantity: n, source, reason, ...common };
      else op = { type: "variance", quantity: n, source, reason, ...common };
    }
    const err = trackingStore.apply(id, op);
    if (err) return setMsg({ ok: false, text: err });
    setMsg({ ok: true, text: kind === "recover" ? "Recovery recorded" : kind === "outcome" ? `${OUTCOME_LABELS[outcome]} recorded` : kind === "note" ? "Note added" : "Recorded" });
    setQty("");
    setNote("");
    setReason("");
    setComplete(false);
  };

  const fill = (v: number | null, label: string) =>
    v === null || v <= 0 ? null : (
      <button type="button" className="rx-btn sm" data-testid="qty-fill" onClick={() => setQty(qtyInput(v))} title={label}>
        {label}
      </button>
    );

  return (
    <div className="tk-forms" data-testid="record-forms">
      <Seg<FormKind> value={kind} onChange={(k) => (setKind(k), setMsg(null))} testid="form-kind" label="What to record" options={KINDS.map((k) => ({ value: k.value, label: k.label, title: k.title, testid: `form-${k.value}` }))} />
      <div className="tk-formbody">
        {kind === "outcome" && (
          <label className="rx-lab">
            <span>Outcome</span>
            <Seg<Outcome> value={outcome} onChange={setOutcome} testid="outcome-kind" label="Outcome" options={OUTCOMES.map((o) => ({ value: o, label: OUTCOME_LABELS[o], testid: `outcome-${o}` }))} />
          </label>
        )}
        {kind !== "note" && (
          <div className="tk-qrow">
            <label className="rx-lab">
              <span>
                {kind === "variance" ? "Difference (+ or −)" : kind === "plan" ? "Planned quantity (empty = none)" : "Quantity"} ({unit})
              </span>
              <input className="rx-field num" data-testid="rec-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} aria-label={`Quantity in ${unit}`} />
            </label>
            <div className="tk-fills">
              {kind === "recover" && fill(s.planned, "= planned")}
              {kind === "recover" && fill(s.notYetRecovered, "= not yet recovered")}
              {kind === "outcome" && fill(s.inHand, "all in hand")}
              {kind === "unrecovered" && fill(s.notYetRecovered, "the remainder")}
            </div>
          </div>
        )}
        {kind !== "note" && (
          <div className="rx-lab">
            <span>Source of this quantity (choose one)</span>
            <Seg<Source | ""> value={source} onChange={setSource} testid="rec-source" label="Source" options={SOURCES.map((x) => ({ value: x, label: SOURCE_LABELS[x], testid: `source-${x}`, title: x === "measured" ? "weighed, counted or measured on site" : x === "estimated" ? "judged from observation or documents" : "taken from the plan without checking" }))} />
          </div>
        )}
        {kind === "outcome" && outcome === "reused" && (
          <label className="rx-lab">
            <span>Fulfils a C2 allocation (optional)</span>
            <select className="rx-select" data-testid="rec-allocation" value={allocationId} onChange={(e) => setAllocationId(e.target.value)}>
              <option value="">Not tied to a C2 allocation</option>
              {unfulfilled.map(({ a, left }) => (
                <option key={a.id} value={a.id}>
                  {a.requirementName}: {fmtQtyU(left, s.unit)} still to fulfil
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "outcome" && (
          <label className="rx-lab">
            <span>{outcome === "reused" ? "Reused in / for" : outcome === "recycled" ? "Recycler / process" : "Disposal site"} (optional)</span>
            <input className="rx-field" data-testid="rec-destination" value={destination} maxLength={160} onChange={(e) => setDestination(e.target.value)} />
          </label>
        )}
        {(kind === "unrecovered" || kind === "variance") && (
          <label className="rx-lab">
            <span>{kind === "variance" ? "Why the real quantity differs from the modelled one (required)" : "Why it was not recovered (required)"}</span>
            <input className="rx-field" data-testid="rec-reason" value={reason} maxLength={160} onChange={(e) => setReason(e.target.value)} />
          </label>
        )}
        {kind !== "note" && (
          <div className="tk-qrow">
            <label className="rx-lab" style={{ flex: 1 }}>
              <span>How it was determined (optional)</span>
              <input className="rx-field" data-testid="rec-method" value={method} maxLength={160} placeholder="weighed, counted, photo …" onChange={(e) => setMethod(e.target.value)} />
            </label>
            <label className="rx-lab">
              <span>Date</span>
              <input className="rx-field" data-testid="rec-date" type="date" value={at} max={today()} onChange={(e) => setAt(e.target.value)} />
            </label>
          </div>
        )}
        {kind === "recover" && (
          <label className="rx-check">
            <input type="checkbox" data-testid="rec-complete" checked={complete} onChange={(e) => setComplete(e.target.checked)} />
            Recovery of this component is complete (moves it to Recovered)
          </label>
        )}
        <label className="rx-lab">
          <span>{kind === "note" ? "Note" : "Note (optional)"}</span>
          <textarea className="rx-area" rows={2} data-testid="rec-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="rx-actions" style={{ marginTop: 4 }}>
          <button type="button" className="rx-btn primary" data-testid="rec-submit" onClick={submit}>
            Record
          </button>
          {msg && (
            <span className={msg.ok ? "rx-ok" : "rx-error"} style={{ margin: 0 }} data-testid="rec-msg" role="status">
              {msg.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
