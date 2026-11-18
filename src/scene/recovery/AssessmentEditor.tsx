/**
 * Assessment editing (B2): LeafEditor for one component (edits apply immediately) and BulkForm for an
 * assembly's parts or a filtered list (edits apply on "Apply"). Nothing is computed here: results come
 * from the recovery engine, quantities from B1.
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { getModelInventory, type InventoryRow } from "@/engine/quantities";
import {
  CLASSIFICATIONS,
  CLASSIFICATION_LABELS,
  DESTINATIONS,
  DESTINATION_LABELS,
  evaluateRow,
  isRecoverableClass,
  parsePct,
  PREPARATIONS,
  PREPARATION_LABELS,
  suggestFor,
  targetLeafIds,
  type AssessmentPatch,
  type Classification,
  type Destination,
  type Preparation,
} from "@/engine/recovery";
import { PALETTE, StatusChip } from "../inventory/ui";
import { STATUS_COLOURS, hex } from "./colors";
import { recoveryStore, useRecovery } from "./recoveryStore";

const field: CSSProperties = { font: "inherit", fontSize: 12, padding: "2px 4px", border: `1px solid ${PALETTE.line}`, borderRadius: 6, background: "#fff", color: PALETTE.text, minWidth: 0 };
const label: CSSProperties = { color: PALETTE.muted, fontSize: 11, marginTop: 6 };
const button: CSSProperties = { font: "inherit", fontSize: 12, padding: "2px 10px", border: `1px solid ${PALETTE.line}`, borderRadius: 6, background: "#fff", cursor: "pointer", color: PALETTE.text };

export const Dot = ({ colour }: { colour: number }) => <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 5, background: hex(colour), marginRight: 5, flex: "none", border: "1px solid rgba(0,0,0,0.25)" }} />;

function Select<T extends string>({ value, onChange, options, none, testid }: { value: T | ""; onChange: (v: T | "") => void; options: readonly { value: T; label: string }[]; none: string; testid: string }) {
  return (
    <select data-testid={testid} style={{ ...field, width: "100%" }} value={value} onChange={(e) => onChange(e.target.value as T | "")}>
      <option value="">{none}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
const CLASS_OPTIONS = CLASSIFICATIONS.map((c) => ({ value: c, label: CLASSIFICATION_LABELS[c] }));
const DEST_OPTIONS = DESTINATIONS.map((d) => ({ value: d, label: DESTINATION_LABELS[d] }));
const PREP_OPTIONS = PREPARATIONS.map((p) => ({ value: p, label: PREPARATION_LABELS[p] }));

function PctInput({ value, disabled, onCommit, testid }: { value: number | null; disabled: boolean; onCommit: (v: number | null) => void; testid: string }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(value === null ? "" : String(value));
    setError(null);
  }, [value]);
  const commit = () => {
    const p = parsePct(text);
    setError(p.error);
    if (!p.error && p.value !== value) onCommit(p.value);
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          data-testid={testid}
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={text}
          placeholder={disabled ? "n/a" : "0–100"}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          style={{ ...field, width: 70, textAlign: "right", borderColor: error ? PALETTE.warn : PALETTE.line }}
        />
        <span style={{ color: PALETTE.muted }}>%</span>
      </div>
      {error && (
        <div data-testid={`${testid}-error`} style={{ color: PALETTE.warn, fontSize: 11 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function LeafEditor({ row }: { row: InventoryRow }) {
  const { assessments, basis } = useRecovery();
  const id = row.rec.id;
  const a = assessments.get(id);
  const ev = evaluateRow(row, a, basis);
  const sg = suggestFor(row.rec, row.q.category);
  const recoverable = isRecoverableClass(a?.classification ?? null);
  const assess = (patch: AssessmentPatch) => recoveryStore.assess([id], patch);
  const [loss, setLoss] = useState(a?.lossNote ?? "");
  const [note, setNote] = useState(a?.note ?? "");
  useEffect(() => {
    setLoss(a?.lossNote ?? "");
    setNote(a?.note ?? "");
  }, [id, a?.lossNote, a?.note]);

  return (
    <div data-testid="assessment-editor">
      <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{id}</div>
      <div style={{ color: PALETTE.muted }}>{row.rec.name}</div>
      <div style={{ marginTop: 4 }}>
        <span style={{ color: PALETTE.muted }}>Available (B1, {basis === "mass" ? "estimated mass" : "quantity"}): </span>
        <b data-testid="rec-available">{ev.available.value === null ? "Not available" : `${fmt(ev.available.value)} ${unitText(ev.available.unit)}`}</b> <StatusChip status={ev.available.status} title={ev.available.method} />
      </div>

      <div style={{ marginTop: 6, padding: "4px 6px", background: "#eef1f3", borderRadius: 6, fontSize: 11 }} data-testid="rec-suggestion">
        <div>
          <b>Generic suggestion</b> (a rule of thumb for this kind of material, not an assessment of this component): {CLASSIFICATION_LABELS[sg.classification].toLowerCase()}.
        </div>
        <div style={{ color: PALETTE.muted }}>
          Method: {sg.method}. Pathway: {sg.pathway}. {sg.rationale}.
        </div>
        <button type="button" data-testid="rec-use-suggestion" style={{ ...button, marginTop: 3, fontSize: 11 }} onClick={() => assess({ classification: sg.classification })} disabled={a?.classification === sg.classification}>
          Use suggested classification
        </button>
      </div>

      <div style={label}>Assessment</div>
      <Select<Classification> testid="rec-classification" value={a?.classification ?? ""} none="— Not assessed —" options={CLASS_OPTIONS} onChange={(v) => assess({ classification: v || null })} />
      <div style={label}>Estimated recovery (net of expected loss or damage)</div>
      <PctInput testid="rec-pct" value={a?.recoveryPct ?? null} disabled={!recoverable} onCommit={(v) => assess({ recoveryPct: v })} />
      <div style={label}>Preparation / refurbishment needed</div>
      <Select<Preparation> testid="rec-preparation" value={a?.preparation ?? ""} none="— not stated —" options={PREP_OPTIONS} onChange={(v) => assess({ preparation: v || null })} />
      <div style={label}>Intended destination</div>
      <Select<Destination> testid="rec-destination" value={a?.destination ?? ""} none="— not decided —" options={DEST_OPTIONS} onChange={(v) => assess({ destination: v || null })} />
      <div style={label}>Expected loss or damage (note only: not applied to any quantity)</div>
      <input data-testid="rec-loss" style={{ ...field, width: "100%", boxSizing: "border-box" }} value={loss} onChange={(e) => setLoss(e.target.value)} onBlur={() => assess({ lossNote: loss })} />
      <div style={label}>Note</div>
      <input data-testid="rec-note" style={{ ...field, width: "100%", boxSizing: "border-box" }} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => assess({ note })} />

      <div style={{ marginTop: 8, padding: "6px 8px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }} data-testid="rec-result">
        <div style={{ color: PALETTE.muted, fontSize: 11 }}>Estimated recoverable quantity = available quantity × recovery %</div>
        {ev.recoverable !== null ? (
          <div data-testid="rec-formula" style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {ev.formula} <StatusChip status="estimated" title="a user estimate applied to a B1 quantity" />
          </div>
        ) : (
          <div data-testid="rec-formula" style={{ color: PALETTE.muted }}>
            Not available{ev.notes.length ? `: ${ev.notes[0]}` : a?.classification ? "" : ": not assessed"}
          </div>
        )}
        {ev.notes.slice(ev.recoverable === null ? 1 : 0).map((n, i) => (
          <div key={i} style={{ color: PALETTE.warn, fontSize: 11 }}>
            ⚠ {n}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6, fontSize: 10.5, color: PALETTE.muted }} data-testid="rec-assumptions">
        <div style={{ fontWeight: 600 }}>Assumptions behind this estimate</div>
        <ul style={{ margin: 0, paddingLeft: 14 }}>
          <li>Quantity: {ev.available.method}.</li>
          <li>The recovery % is your estimate, not an established rate; it is already net of loss or damage (the loss note is not applied again).</li>
          <li>The classification is a planning category: it is not a judgement of condition, structural safety, compliance or suitability for reuse.</li>
          {row.rec.system === "structure" && <li>Structural reuse needs drawings, testing and a qualified engineer.</li>}
        </ul>
      </div>
      <div style={{ marginTop: 6 }}>
        <button type="button" data-testid="rec-clear" style={button} onClick={() => recoveryStore.clear([id])} disabled={!a}>
          Clear this assessment
        </button>
      </div>
    </div>
  );
}

const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toLocaleString("en-US", { maximumFractionDigits: 3 }));
const unitText = (u: string) => ({ m3: "m³", m2: "m²", m: "m", nr: "nr", kg: "kg" })[u] ?? u;

/** Apply the same fields to many components: an assembly's parts or the filtered list. */
export function BulkForm({ ids, what, testid = "bulk" }: { ids: readonly string[]; what: string; testid?: string }) {
  const inv = getModelInventory();
  const count = useMemo(() => new Set(ids.flatMap((id) => targetLeafIds(inv, id))).size, [ids, inv]);
  const [cls, setCls] = useState<Classification | "" | "clear">("");
  const [pct, setPct] = useState("");
  const [dest, setDest] = useState<Destination | "">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const recoverable = cls !== "clear" && cls !== "" ? isRecoverableClass(cls) : true;
  const apply = () => {
    const p = parsePct(pct);
    if (p.error) return setMsg({ ok: false, text: p.error });
    const patch: { -readonly [K in keyof AssessmentPatch]: AssessmentPatch[K] } = {};
    if (cls === "clear") patch.classification = null;
    else if (cls) patch.classification = cls;
    if (p.value !== null && recoverable) patch.recoveryPct = p.value;
    if (dest) patch.destination = dest;
    if (Object.keys(patch).length === 0) return setMsg({ ok: false, text: "Nothing chosen to apply" });
    const r = recoveryStore.assess(ids, patch);
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: `${r.applied} of ${count} components changed` });
  };
  return (
    <div data-testid={testid} style={{ padding: "6px 8px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }}>
      <div style={{ fontWeight: 600 }}>
        Apply to {count.toLocaleString("en-US")} {what}
      </div>
      <div style={{ color: PALETTE.muted, fontSize: 11 }}>Only the fields you choose are changed; each component is assessed once.</div>
      <div style={label}>Assessment</div>
      <select data-testid={`${testid}-class`} style={{ ...field, width: "100%" }} value={cls} onChange={(e) => setCls(e.target.value as Classification | "" | "clear")}>
        <option value="">— keep —</option>
        <option value="clear">Remove assessment</option>
        {CLASS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div>
          <div style={label}>Recovery % (net of loss)</div>
          <input data-testid={`${testid}-pct`} style={{ ...field, width: 70, textAlign: "right" }} value={pct} disabled={!recoverable} placeholder="keep" onChange={(e) => setPct(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={label}>Destination</div>
          <Select<Destination> testid={`${testid}-dest`} value={dest} none="— keep —" options={DEST_OPTIONS} onChange={setDest} />
        </div>
      </div>
      <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" data-testid={`${testid}-apply`} style={button} onClick={apply} disabled={count === 0}>
          Apply to {count.toLocaleString("en-US")}
        </button>
        {msg && (
          <span data-testid={`${testid}-msg`} style={{ fontSize: 11, color: msg.ok ? PALETTE.muted : PALETTE.warn }}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}

export const statusColourOf = (c: Classification | null) => STATUS_COLOURS[c ?? "unassessed"];
