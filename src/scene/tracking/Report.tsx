/**
 * The planned-versus-actual report (C3): the tracked population broken down by material category, floor and stage (one unit at a time),
 * the differences between expected and actual outcomes, the unresolved and incomplete records, and the export. Every component is counted
 * once, units are never added, and what was never recorded is shown as not recorded. No environmental saving is claimed here.
 */

import { useMemo } from "react";
import { UNIT_LABEL, type Unit } from "@/engine/quantities";
import { fmtQty, fmtQtyU, substanceLabel } from "@/engine/reuse";
import { byCategory, byFloor, byStatus, discrepancies, FLAG_LABELS, FLOOR_NAMES, reconcileRows, STATUSES, STATUS_SHORT, trackingFileName, trackingToCsv, trackingToJson, totals, unresolved, type Rollup, type Status } from "@/engine/tracking";
import { downloadText } from "../passport/download";
import { Section, Seg, n0 } from "../reuse/ui";
import { useWorkspace } from "./hooks";
import { trackingStore, useTracking } from "./trackingStore";
import { RollupBar } from "./Viz";

const pctText = (c: number | null): string => (c === null ? "—" : `${(c * 100).toFixed(0)} %`);

function Table({ title, rows, label, scale, onPick, testid }: { title: string; rows: readonly Rollup[]; label: (key: string) => string; scale: number; onPick?: (key: string) => void; testid: string }) {
  return (
    <Section title={title} testid={testid}>
      <table className="rx-table tk-table">
        <thead>
          <tr>
            <th>{title.replace(/^By /, "")}</th>
            <th className="n">Records</th>
            <th className="n">Planned</th>
            <th className="n">Recovered</th>
            <th className="n" title="Σ recovered ÷ Σ planned over records where both are known">%</th>
            <th className="n">Reused</th>
            <th className="n">Recycled</th>
            <th className="n">Disposed</th>
            <th className="n" title="Not explained by an outcome or a write-off (includes records with no recovery recorded)">Unaccounted</th>
            <th style={{ width: 84 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-key={r.key} onClick={onPick ? () => onPick(r.key) : undefined} style={{ cursor: onPick ? "pointer" : "default" }}>
              <td className="crit">{label(r.key)}</td>
              <td className="n">{n0(r.records)}</td>
              <td className="n">{fmtQty(r.planned, r.unit)}</td>
              <td className="n">
                <b>{r.recoveredRecords === 0 ? "—" : fmtQty(r.recovered, r.unit)}</b>
                {r.notRecorded > 0 && <span className="rx-note" title={`${r.notRecorded} record(s) with no recovered quantity recorded: unknown, not zero`}> ({r.notRecorded}?)</span>}
              </td>
              <td className="n">{pctText(r.completion)}</td>
              <td className="n">{fmtQty(r.reused, r.unit)}</td>
              <td className="n">{fmtQty(r.recycled, r.unit)}</td>
              <td className="n">{fmtQty(r.disposed, r.unit)}</td>
              <td className="n">{fmtQty(r.unaccounted, r.unit)}</td>
              <td><RollupBar r={r} scale={scale} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

export function Report() {
  const ws = useWorkspace();
  const ts = useTracking();
  const all = useMemo(() => totals(ws.rows), [ws.rows]);
  const unit: Unit | null = ts.unit && all.some((t) => t.unit === ts.unit) ? ts.unit : (all[0]?.unit ?? null);
  const rows = useMemo(() => ws.rows.filter((r) => r.summary.unit === unit), [ws.rows, unit]);
  const tot = all.find((t) => t.unit === unit);
  const cats = useMemo(() => byCategory(rows), [rows]);
  const floors = useMemo(() => byFloor(rows), [rows]);
  const stages = useMemo(() => [...byStatus(rows)].sort((a, b) => STATUSES.indexOf(a.key as Status) - STATUSES.indexOf(b.key as Status)), [rows]);
  const diffs = useMemo(() => discrepancies(ws.rows), [ws.rows]);
  const open = useMemo(() => unresolved(ws.rows), [ws.rows]);
  const problems = useMemo(() => reconcileRows(ws.rows), [ws.rows]);
  const scale = Math.max(1e-9, ...[...cats, ...floors, ...stages].map((r) => Math.max(r.planned, r.recovered, r.available)));

  const go = (id: string) => (trackingStore.setTab("register"), ws.onSelect(id));
  const download = (ext: "json" | "csv") => {
    const now = new Date().toISOString();
    if (ext === "json") downloadText(trackingFileName("json"), "application/json", trackingToJson(ts.records, ws.rows, now));
    else downloadText(trackingFileName("csv"), "text/csv;charset=utf-8", trackingToCsv(ws.rows));
  };

  if (ws.rows.length === 0) {
    return (
      <div className="rx-pane" data-testid="report-empty">
        <div className="rx-empty" style={{ marginTop: 30 }}>
          <h4>Nothing to report yet</h4>
          Start tracking components in the register: the report then compares what was planned with what was actually recovered, reused, recycled and disposed.
        </div>
      </div>
    );
  }

  return (
    <div className="rx-pane" data-testid="report">
      <div className="rx-scroll">
        <div className="rx-inline" style={{ display: "flex", justifyContent: "space-between", margin: "12px 0 0" }}>
          <div>
            {unit && <Seg<Unit> value={unit} onChange={(u) => trackingStore.setUnit(u as "m2" | "m3" | "m" | "nr")} testid="report-units" label="Unit" options={all.map((x) => ({ value: x.unit, label: UNIT_LABEL[x.unit], testid: `report-unit-${x.unit}` }))} />}
            <span className="rx-note" style={{ marginLeft: 8 }}>different units are never added together</span>
          </div>
          <span className="rx-inline">
            <button type="button" className="rx-btn" data-testid="export-json" onClick={() => download("json")}>Download JSON</button>
            <button type="button" className="rx-btn" data-testid="export-csv" onClick={() => download("csv")}>Download CSV</button>
          </span>
        </div>

        {tot && (
          <div className="rx-banner info" style={{ marginTop: 10 }} data-testid="report-summary">
            <b>{n0(tot.records)}</b> tracked component{tot.records === 1 ? "" : "s"} · planned <b>{fmtQtyU(tot.planned, tot.unit)}</b> · recovered <b>{tot.recoveredRecords === 0 ? "not recorded" : fmtQtyU(tot.recovered, tot.unit)}</b>
            {tot.completion !== null && <> ({pctText(tot.completion)} of the plan, over {tot.pairedRecords} records with both)</>} · reused {fmtQtyU(tot.reused, tot.unit)} · recycled {fmtQtyU(tot.recycled, tot.unit)} · disposed {fmtQtyU(tot.disposed, tot.unit)} · unaccounted <b>{fmtQtyU(tot.unaccounted, tot.unit)}</b>
            {tot.notRecorded > 0 && <> · {tot.notRecorded} record{tot.notRecorded === 1 ? " has" : "s have"} no recovered quantity recorded (unknown, not zero)</>}
          </div>
        )}
        <div style={{ marginTop: 6 }} data-testid="report-integrity">
          {problems.length === 0 ? (
            <div className="rx-note">Every component is counted once and every breakdown adds up to the total. B1 inventory quantities are untouched.</div>
          ) : (
            <div className="rx-banner warn">{problems.slice(0, 3).join(" · ")}</div>
          )}
        </div>

        <Table title="By material category" rows={cats} label={substanceLabel} scale={scale} onPick={(k) => (trackingStore.setFilters({ substance: k, scope: "tracked", status: "" }), trackingStore.setTab("register"))} testid="by-category" />
        <Table title="By floor" rows={floors} label={(k) => FLOOR_NAMES[Number(k)] ?? k} scale={scale} onPick={(k) => (trackingStore.setFilters({ floor: Number(k), scope: "tracked", status: "" }), trackingStore.setTab("register"))} testid="by-floor" />
        <Table title="By stage" rows={stages} label={(k) => STATUS_SHORT[k as Status]} scale={scale} onPick={(k) => (trackingStore.setFilters({ status: k as Status, scope: "tracked" }), trackingStore.setTab("register"))} testid="by-stage" />

        <Section title={`Differences between plan and actual (${diffs.length})`} aside={<span>records with a warning or an error</span>} testid="differences">
          {diffs.length === 0 ? (
            <div className="rx-note">No record differs from its plan.</div>
          ) : (
            <div className="rx-card">
              {diffs.slice(0, 60).map((d) => (
                <div key={d.row.id} className="tk-diff" data-testid="difference" data-id={d.row.id}>
                  <button type="button" className="rx-link rx-mono" style={{ textDecoration: "none", fontWeight: 550 }} onClick={() => go(d.row.id)}>{d.row.id}</button>
                  <ul className="rx-list">
                    {d.flags.map((f) => (
                      <li key={f.code + f.text}>
                        <span className={`tk-flag ${f.level}`} aria-hidden="true">{f.level === "error" ? "!" : "▲"}</span>
                        <span>{f.text.startsWith(FLAG_LABELS[f.code]) ? f.text : FLAG_LABELS[f.code]}{d.row.summary.difference !== null && (f.code === "below_plan" || f.code === "above_plan") ? ` (${d.row.summary.difference > 0 ? "+" : "−"}${fmtQtyU(Math.abs(d.row.summary.difference), d.row.summary.unit)} against the plan)` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {diffs.length > 60 && <div className="rx-note" style={{ padding: 8 }}>… and {diffs.length - 60} more (filter the register to “flagged only”).</div>}
            </div>
          )}
        </Section>

        <Section title={`Unresolved and incomplete records (${open.length})`} aside={<span>not yet closed: a final outcome and nothing unaccounted</span>} testid="unresolved">
          {open.length === 0 ? (
            <div className="rx-note">Every tracked record is closed.</div>
          ) : (
            <div className="rx-card">
              {open.slice(0, 60).map((u) => (
                <div key={u.row.id} className="tk-diff" data-testid="unresolved-row" data-id={u.row.id}>
                  <button type="button" className="rx-link rx-mono" style={{ textDecoration: "none", fontWeight: 550 }} onClick={() => go(u.row.id)}>{u.row.id}</button>
                  <span className="rx-note">{u.reason}{u.row.summary.unaccounted !== null && u.row.summary.unaccounted > 1e-9 ? ` · ${fmtQtyU(u.row.summary.unaccounted, u.row.summary.unit)} unaccounted` : ""}</span>
                </div>
              ))}
              {open.length > 60 && <div className="rx-note" style={{ padding: 8 }}>… and {open.length - 60} more.</div>}
            </div>
          )}
        </Section>

        <div className="rx-note" style={{ marginTop: 14 }}>
          Planned figures are B2 estimates (or quantities you stated) taken when tracking started; actual figures exist only where an entry records them, each with its source. This report asserts no environmental saving: carbon is shown per component from B5 where factors exist, and a saving would need B5's replacement assumptions and measured data.
        </div>
      </div>
    </div>
  );
}
