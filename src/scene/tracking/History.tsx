/**
 * The history of one tracking record (C3): every event in the order it was recorded, who recorded it (the user or the system), the date it
 * happened, its source, and whether it was voided. History is never edited or removed: a mistake is voided with a reason and stays visible.
 */

import { useState } from "react";
import { UNIT_LABEL, type Unit } from "@/engine/quantities";
import { fmtQtyU } from "@/engine/reuse";
import { fold, OUTCOME_LABELS, STATUS_LABELS, type TrackingEvent, type TrackingRecord } from "@/engine/tracking";
import { Chip } from "../reuse/ui";
import { trackingStore } from "./trackingStore";

const q = (v: number, unit: Unit) => fmtQtyU(v, unit);

/** One line of words for an event. */
export function describe(e: TrackingEvent, unit: Unit): { icon: string; title: string; detail: string } {
  switch (e.kind) {
    case "track":
      return { icon: "▸", title: "Tracking started", detail: e.plan.quantity === null ? "no planned quantity (B2 has no recovery estimate)" : `planned ${q(e.plan.quantity, unit)} (B2 estimate${e.plan.pct !== null ? `, ${e.plan.pct} %` : ""})` };
    case "plan":
      return { icon: "◇", title: e.quantity === null ? "Planned quantity withdrawn" : `Planned quantity stated: ${q(e.quantity, unit)}`, detail: [e.source, e.method].filter(Boolean).join(" · ") };
    case "status":
      return { icon: "●", title: `Stage: ${STATUS_LABELS[e.status]}`, detail: e.from ? `from ${STATUS_LABELS[e.from]}` : "" };
    case "recovered":
      return { icon: "↧", title: `Recovered ${q(e.quantity, unit)}`, detail: [e.source, e.method].filter(Boolean).join(" · ") };
    case "outcome":
      return { icon: "→", title: `${OUTCOME_LABELS[e.outcome]} ${q(e.quantity, unit)}`, detail: [e.source, e.method, e.destination, e.requirementName ? `fulfils C2 allocation to "${e.requirementName}"` : ""].filter(Boolean).join(" · ") };
    case "unrecovered":
      return { icon: "✕", title: `Not recovered ${q(e.quantity, unit)}`, detail: [e.reason, e.source, e.method].filter(Boolean).join(" · ") };
    case "variance":
      return { icon: "±", title: `Documented variance ${e.quantity > 0 ? "+" : "−"}${q(Math.abs(e.quantity), unit)}`, detail: [e.reason, e.source, e.method].filter(Boolean).join(" · ") };
    case "note":
      return { icon: "✎", title: "Note", detail: "" };
    case "allocation": {
      const verb = e.change === "created" ? "created" : e.change === "changed" ? `changed from ${e.previous === null ? "?" : q(e.previous, unit)} to ${q(e.quantity, unit)}` : e.change === "cancelled" ? "cancelled" : "fulfilled";
      return { icon: "⇄", title: `C2 allocation to "${e.requirementName}" ${verb}`, detail: e.change === "created" || e.change === "fulfilled" ? q(e.quantity, unit) : "" };
    }
    case "void":
      return { icon: "⌀", title: "Voided an earlier entry", detail: e.reason };
  }
}

const when = (iso: string): string => iso.slice(0, 10);

export function History({ record }: { record: TrackingRecord }) {
  const f = fold(record);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const events = [...record.events].reverse();
  const byId = new Map(record.events.map((e) => [e.id, e]));

  const confirm = () => {
    if (!voiding) return;
    const e = trackingStore.apply(record.componentId, { type: "void", eventId: voiding, reason });
    setErr(e);
    if (!e) (setVoiding(null), setReason(""));
  };

  return (
    <ol className="tk-history" data-testid="history" aria-label="History">
      {events.map((e) => {
        const d = describe(e, record.unit);
        const isVoid = f.voided.has(e.id);
        const voidable = !isVoid && e.by === "user" && e.kind !== "void" && e.kind !== "track";
        const target = e.kind === "void" ? byId.get(e.voids) : undefined;
        return (
          <li key={e.id} className={`tk-ev k-${e.kind}${isVoid ? " voided" : ""}`} data-testid="history-event" data-kind={e.kind} data-by={e.by} data-voided={isVoid}>
            <span className="ic" aria-hidden="true">{d.icon}</span>
            <div className="body">
              <div className="t">
                <span className="title">{d.title}</span>
                {isVoid && <Chip tone="bad">voided</Chip>}
                {e.by === "system" && <Chip title="Recorded by the system, not typed by a user">system</Chip>}
                {e.kind === "recovered" || e.kind === "outcome" || e.kind === "unrecovered" || e.kind === "variance" || e.kind === "plan" ? (
                  <Chip tone={e.source === "measured" ? "strong" : "cond"} title={`quantity source: ${e.source}`}>{e.source}</Chip>
                ) : null}
              </div>
              {(d.detail || e.note) && <div className="d">{[d.detail, e.note].filter(Boolean).join(" · ")}</div>}
              {target && <div className="d">voids: {describe(target, record.unit).title}</div>}
              <div className="w">
                {when(e.at)}
                {when(e.at) !== when(e.recordedAt) && <span title={`recorded ${e.recordedAt}`}> · recorded {when(e.recordedAt)}</span>}
                {voidable && (
                  <>
                    {" · "}
                    <button type="button" className="rx-link" data-testid="void-open" onClick={() => (setVoiding(voiding === e.id ? null : e.id), setErr(null), setReason(""))}>
                      void
                    </button>
                  </>
                )}
              </div>
              {voiding === e.id && (
                <div className="tk-void" data-testid="void-form">
                  <input className="rx-field" data-testid="void-reason" placeholder="Why is this entry wrong? (required)" value={reason} maxLength={160} onChange={(e2) => setReason(e2.target.value)} onKeyDown={(k) => k.key === "Enter" && confirm()} />
                  <button type="button" className="rx-btn sm danger" data-testid="void-confirm" onClick={confirm}>
                    Void
                  </button>
                  <button type="button" className="rx-btn sm" onClick={() => setVoiding(null)}>
                    Keep
                  </button>
                  {err && <div className="rx-error" data-testid="void-error" role="alert">{err}</div>}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export { UNIT_LABEL };
