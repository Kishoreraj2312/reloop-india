/**
 * The register (C3): every component in the chosen scope with its stage, planned and recovered quantity, a small planned-versus-actual
 * bar and its flags. Rows are the real components (the same ids as B1, B2, B3, C1 and C2); clicking one selects it in the building and
 * opens its tracking panel. Several rows can be selected to start tracking, change a stage or save them as a batch together.
 */

import { memo, useEffect, useMemo, useState } from "react";
import { FLOOR_LABEL } from "@/engine/quantities";
import { fmtQtyU, materialName, sizeLabel } from "@/engine/reuse";
import { STATUSES, STATUS_SHORT, type Status } from "@/engine/tracking";
import { Chip, Seg, VList, n0, useDebounced } from "../reuse/ui";
import { useWorkspace, type TrackingWorkspace } from "./hooks";
import type { RegisterModel } from "./registerModel";
import { StageChip } from "./RecordPanel";
import { RecordPanel } from "./RecordPanel";
import { trackingStore, useTracking, type Scope } from "./trackingStore";
import { MiniBar } from "./Viz";

const ROW = 46;
const COLS = "22px minmax(0, 1fr) 112px 70px 70px 84px 34px";

const Row = memo(function Row({ id, ws, selected, checked, onCheck }: { id: string; ws: TrackingWorkspace; selected: boolean; checked: boolean; onCheck: (id: string, on: boolean) => void }) {
  const rec = ws.ctx.inv.recordById.get(id);
  const q = ws.ctx.inv.byId.get(id);
  const row = ws.rowById.get(id);
  const s = row?.summary;
  const ev = ws.scope.get(id);
  const unit = s?.unit ?? q?.primary.unit ?? "nr";
  const worst = s?.flags.some((f) => f.level === "error") ? "error" : s?.flags.some((f) => f.level === "warning") ? "warning" : null;
  const planned = s ? s.planned : (ev?.planned ?? null);
  return (
    <div className="rx-row tk-row" style={{ gridTemplateColumns: COLS }} aria-selected={selected} data-testid="register-row" data-id={id} data-stage={s?.status ?? "not_tracked"} data-flag={worst ?? ""} onClick={() => ws.onSelect(id)}>
      <input type="checkbox" aria-label={`Select ${id}`} checked={checked} onClick={(e) => e.stopPropagation()} onChange={(e) => onCheck(id, e.target.checked)} />
      <div className="rx-cell-main">
        <div className="l1">
          <span className="rx-mono" title={rec?.name ?? id}>{id}</span>
          {ev?.c2 && <Chip tone="alloc" title="Has a C2 allocation">C2</Chip>}
          {ev?.b3 && <Chip title={`Step ${ev.b3.step} of ${ev.b3.steps} in the removal plan`}>B3 #{ev.b3.step}</Chip>}
        </div>
        <div className="l2" title={rec?.name}>
          {rec ? `${sizeLabel(rec)} · ${materialName(rec.materialId)} · ${FLOOR_LABEL[rec.floor] ?? rec.floor}${rec.apartmentId ? ` · ${rec.apartmentId}` : ""}` : "not in the current model"}
        </div>
      </div>
      <div><StageChip status={s?.status ?? "not_tracked"} /></div>
      <div className="rx-right" title="Planned recovery (B2 estimate or stated)">
        {planned === null ? <span className="rx-note">—</span> : <span>{fmtQtyU(planned, unit).replace(/ [^ ]+$/, "")}</span>}
        <div className="rx-note" style={{ fontSize: 10 }}>{unit === "m2" ? "m²" : unit === "m3" ? "m³" : unit}</div>
      </div>
      <div className="rx-right" title={s?.recovered === null ? "No recovered quantity recorded: unknown, not zero" : "Recovered (recorded)"}>
        {!s || s.recovered === null ? <span className="rx-note">{s ? "not recorded" : "—"}</span> : <b>{fmtQtyU(s.recovered, unit).replace(/ [^ ]+$/, "")}</b>}
      </div>
      <div>{s ? <MiniBar s={s} /> : null}</div>
      <div className="rx-right">
        {worst && (
          <span className={`tk-flag ${worst}`} title={s!.flags.filter((f) => f.level !== "info").map((f) => f.text).join("\n")} data-testid="row-flag">
            {worst === "error" ? "!" : "▲"}
            <small>{s!.flags.filter((f) => f.level !== "info").length}</small>
          </span>
        )}
      </div>
    </div>
  );
});

const SCOPES: readonly { value: Scope; label: string; title: string }[] = [
  { value: "tracked", label: "Tracked", title: "Components you started tracking" },
  { value: "planned", label: "Planned", title: "Tracked components plus those B2 / B3 / C2 plan to recover" },
  { value: "untracked", label: "Not started", title: "Planned for recovery but not tracked yet" },
  { value: "all", label: "All components", title: "Every leaf component of the model" },
];

export function Register({ model }: { model: RegisterModel }) {
  const ws = useWorkspace();
  const ts = useTracking();
  const f = ts.filters;
  const [text, setText] = useState(f.text);
  const debounced = useDebounced(text, 200);
  useEffect(() => {
    if (debounced !== f.text) trackingStore.setFilters({ text: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a settled search text is applied
  }, [debounced]);
  useEffect(() => setText(f.text), [f.text]);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkStage, setBulkStage] = useState<Status>("in_progress");
  const [batchName, setBatchName] = useState("");
  const [naming, setNaming] = useState(false);
  const { items } = model;
  const sel = ws.selectedId;
  const filtered = f.status !== "" || f.substance !== "" || f.floor !== "" || f.batchId !== "" || f.flaggedOnly || f.text !== "";

  const onCheck = (id: string, on: boolean) =>
    setChecked((c) => {
      const n = new Set(c);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const checkedIds = useMemo(() => [...checked], [checked]);
  const checkedTracked = checkedIds.filter((id) => ws.rowById.has(id));
  const step = (to: "prev" | "next" | "first" | "last") => {
    if (items.length === 0) return;
    const i = items.findIndex((x) => x.id === sel);
    const next = to === "first" ? 0 : to === "last" ? items.length - 1 : to === "next" ? Math.min(items.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    ws.onSelect(items[next]!.id);
  };
  const allChecked = items.length > 0 && items.length <= 20000 && items.every((i) => checked.has(i.id));

  const bulkStart = () => {
    const r = trackingStore.start(checkedIds);
    setBulkMsg(r.error ?? `${r.started} started${r.alreadyTracked ? `, ${r.alreadyTracked} were already tracked` : ""}${r.ignored ? `, ${r.ignored} ignored` : ""}`);
  };
  const bulkSet = () => {
    const r = trackingStore.bulkStatus(checkedTracked, bulkStage);
    setBulkMsg(`${r.changed} moved to ${STATUS_SHORT[bulkStage]}${r.refused ? `, ${r.refused} refused: ${r.firstError}` : ""}`);
  };
  const saveBatch = () => {
    const r = trackingStore.createBatch(batchName, checkedIds);
    setBulkMsg(r.error ?? `Batch saved (${checkedIds.length - r.ignored} components)`);
    if (!r.error) (setNaming(false), setBatchName(""));
  };

  return (
    <div className="rx-pane" data-testid="register">
      <div className="rx-toolbar">
        <Seg<Scope> value={f.scope} onChange={(scope) => trackingStore.setFilters({ scope, status: scope === "untracked" ? "" : f.status })} testid="scope" label="Scope" options={SCOPES.map((s) => ({ value: s.value, label: s.label, title: s.title, testid: `scope-${s.value}` }))} />
        <input className="rx-field" style={{ width: 160 }} placeholder="Search id, name, material" data-testid="register-search" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search components" />
        <select className="rx-select" data-testid="register-sort" value={f.sort} onChange={(e) => trackingStore.setFilters({ sort: e.target.value as typeof f.sort })} aria-label="Sort">
          <option value="id">By id</option>
          <option value="attention">Needs attention first</option>
          <option value="stage">By stage</option>
        </select>
        <label className="rx-check" title="Only records with a warning or an error flag"><input type="checkbox" data-testid="flagged-only" checked={f.flaggedOnly} onChange={(e) => trackingStore.setFilters({ flaggedOnly: e.target.checked })} /> flagged only</label>
        <span className="rx-note" style={{ marginLeft: "auto" }} data-testid="register-count">
          {n0(items.length)} of {n0(model.base.length)} components
          {filtered && <> · <button type="button" className="rx-link" onClick={() => trackingStore.setFilters({ status: "", substance: "", floor: "", batchId: "", flaggedOnly: false, text: "" })}>clear filters</button></>}
        </span>
      </div>
      {checked.size > 0 && (
        <div className="tk-bulk" data-testid="bulk-bar">
          <b>{checked.size.toLocaleString("en-US")} selected</b>
          <button type="button" className="rx-btn sm" data-testid="bulk-start" onClick={bulkStart}>Start tracking</button>
          <span className="rx-inline">
            <select className="rx-select" style={{ height: 22 }} data-testid="bulk-stage" value={bulkStage} onChange={(e) => setBulkStage(e.target.value as Status)} aria-label="Stage for the selected records">
              {STATUSES.filter((s) => s !== "hold").map((s) => <option key={s} value={s}>{STATUS_SHORT[s]}</option>)}
            </select>
            <button type="button" className="rx-btn sm" data-testid="bulk-apply" disabled={checkedTracked.length === 0} onClick={bulkSet} title="Applies where the recorded quantities allow it">Set stage ({checkedTracked.length})</button>
          </span>
          {naming ? (
            <span className="rx-inline">
              <input className="rx-field" style={{ height: 22, width: 130 }} data-testid="batch-name" placeholder="Batch name" value={batchName} maxLength={60} onChange={(e) => setBatchName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveBatch()} />
              <button type="button" className="rx-btn sm primary" data-testid="batch-save" onClick={saveBatch}>Save</button>
            </span>
          ) : (
            <button type="button" className="rx-btn sm" data-testid="batch-new" onClick={() => setNaming(true)}>Save as batch…</button>
          )}
          <button type="button" className="rx-link" onClick={() => (setChecked(new Set()), setBulkMsg(null))}>clear</button>
          {bulkMsg && <span className="rx-note" data-testid="bulk-msg">{bulkMsg}</span>}
        </div>
      )}
      <div className="rx-listhead" style={{ gridTemplateColumns: COLS, gap: 8 }}>
        <input type="checkbox" aria-label="Select all listed" checked={allChecked} disabled={items.length === 0 || items.length > 20000} title={items.length > 20000 ? "Filter to fewer than 20,000 components to select them all" : "Select every listed component"} onChange={(e) => setChecked(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} />
        <span className="nw">Component · size · material · location</span>
        <span>Stage</span>
        <span className="rx-right">Planned</span>
        <span className="rx-right">Recovered</span>
        <span title="Reused · recycled · disposed · in hand, against the plan (tick)">Outcomes</span>
        <span className="rx-right" />
      </div>
      <VList
        testid="register-list"
        items={items}
        rowHeight={ROW}
        keyOf={(i) => i.id}
        scrollToKey={sel}
        onStep={step}
        style={{ flex: sel ? "0 0 clamp(170px, 26vh, 280px)" : "1 1 auto" }}
        empty={
          <div className="rx-empty">
            <h4>{f.scope === "tracked" && model.base.length === 0 ? "Nothing is tracked yet" : "No component matches these filters"}</h4>
            {f.scope === "tracked" && model.base.length === 0 ? (
              <>
                Switch to <button type="button" className="rx-link" onClick={() => trackingStore.setFilters({ scope: "planned" })}>Planned</button> to see what B2, B3 and C2 plan to recover, select components and start tracking, or select a component in the model.
              </>
            ) : (
              "Loosen a filter or clear the search."
            )}
          </div>
        }
        renderRow={(i) => <Row id={i.id} ws={ws} selected={i.id === sel} checked={checked.has(i.id)} onCheck={onCheck} />}
      />
      {sel ? <RecordPanel id={sel} /> : (
        <div className="rx-detail" style={{ flex: "0 0 auto", maxHeight: 120 }}>
          <div className="rx-empty" style={{ padding: "14px 10px" }}>
            <h4>Select a component</h4>
            Choose a row, or click a component in the model, to see its plan, record what was recovered and follow it to its outcome.
          </div>
        </div>
      )}
    </div>
  );
}
