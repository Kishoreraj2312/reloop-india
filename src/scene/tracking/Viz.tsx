/**
 * The planned-versus-actual visualisations of the tracking workspace (C3). Plain bars and numbers: no chart library, nothing decorative.
 * One colour keeps one meaning (reused green, recycled blue, disposed vermillion, in hand orange, not recovered grey) and every segment has a
 * label and an exact value in its tooltip and legend. Material that was never recorded is drawn hatched, never as an empty bar of "zero".
 */

import { fmtQty, fmtQtyU } from "@/engine/reuse";
import { STATUSES, STATUS_SHORT, type Rollup, type Status, type Summary } from "@/engine/tracking";
import type { Unit } from "@/engine/quantities";

const EPS = 1e-9;
const pct = (x: number, max: number): string => `${Math.max(0, Math.min(100, (x / (max > EPS ? max : 1)) * 100))}%`;

interface Seg {
  key: string;
  label: string;
  value: number;
  className: string;
}

/** The accounting of one component as stacked segments of its effective quantity. */
export function segmentsOf(s: Pick<Summary, "reused" | "recycled" | "disposed" | "inHand" | "unrecovered" | "notYetRecovered" | "recovered">): Seg[] {
  return [
    { key: "reused", label: "Reused", value: s.reused ?? 0, className: "reused" },
    { key: "recycled", label: "Recycled", value: s.recycled ?? 0, className: "recycled" },
    { key: "disposed", label: "Disposed", value: s.disposed ?? 0, className: "disposed" },
    { key: "inHand", label: "Recovered, outcome pending (in hand)", value: s.inHand ?? 0, className: "hand" },
    { key: "unrecovered", label: "Not recovered (written off)", value: s.unrecovered ?? 0, className: "lost" },
    { key: "notYet", label: "Not yet recovered", value: s.notYetRecovered ?? 0, className: "open" },
  ];
}

/** Available · planned · actual of ONE record, on one scale, with the exact figures underneath. */
export function PlanBars({ s }: { s: Summary }) {
  const unit = s.unit;
  const R = s.recovered;
  const scale = Math.max(s.effective ?? 0, s.planned ?? 0, (R ?? 0) + (s.unrecovered ?? 0), EPS);
  const segs = segmentsOf(s).filter((x) => x.value > EPS);
  const u = (v: number | null) => (v === null ? "not recorded" : fmtQtyU(v, unit));
  return (
    <div className="tk-viz" data-testid="plan-bars">
      <div className="tk-vrow">
        <span className="tk-vlab">Available (B1)</span>
        <div className="tk-vbar" title={s.effective === null ? "component not in the model" : `${fmtQtyU(s.available, unit)} modelled${s.variance ? ` ${s.variance > 0 ? "+" : "−"} ${fmtQtyU(Math.abs(s.variance), unit)} documented variance` : ""}`}>
          {s.effective !== null && <i className="avail" style={{ width: pct(s.effective, scale) }} />}
        </div>
        <span className="tk-vval" data-testid="viz-available">
          {s.effective === null ? "—" : fmtQtyU(s.effective, unit)}
          {s.variance !== 0 && <span className="rx-note"> ({s.variance > 0 ? "+" : "−"}{fmtQty(Math.abs(s.variance), unit)} variance)</span>}
        </span>
      </div>
      <div className="tk-vrow">
        <span className="tk-vlab">Planned (B2)</span>
        <div className="tk-vbar" title={s.planned === null ? "no planned quantity" : `planned ${fmtQtyU(s.planned, unit)}`}>
          {s.planned === null ? <i className="none" style={{ width: "100%" }} /> : <i className="plan" style={{ width: pct(s.planned, scale) }} />}
        </div>
        <span className="tk-vval" data-testid="viz-planned">
          {s.planned === null ? <span className="rx-note">no planned quantity</span> : fmtQtyU(s.planned, unit)}
          {s.plannedBasis === "user" && <span className="rx-note"> ({s.plannedSource ?? "stated"})</span>}
        </span>
      </div>
      <div className="tk-vrow">
        <span className="tk-vlab">Actual</span>
        <div className="tk-vbar actual" data-testid="viz-actual">
          {R === null ? (
            <i className="none" style={{ width: pct(s.effective ?? 0, scale) }} title="no recovered quantity recorded: unknown, not zero" />
          ) : (
            segs.map((x) => <i key={x.key} className={x.className} style={{ width: pct(x.value, scale) }} title={`${x.label}: ${fmtQtyU(x.value, unit)}`} data-seg={x.key} />)
          )}
          {s.planned !== null && s.planned > EPS && <b className="tick" style={{ left: pct(s.planned, scale) }} title={`planned ${fmtQtyU(s.planned, unit)}`} />}
        </div>
        <span className="tk-vval" data-testid="viz-recovered">
          {R === null ? <span className="rx-note">not recorded</span> : <>recovered <b>{fmtQtyU(R, unit)}</b></>}
        </span>
      </div>
      <dl className="tk-legend" data-testid="viz-legend">
        <Key cls="recovered" k="Recovered" v={u(R)} extra={s.completion === null ? undefined : `${(s.completion * 100).toFixed(0)} % of planned`} />
        <Key cls="reused" k="Reused" v={u(s.reused)} />
        <Key cls="recycled" k="Recycled" v={u(s.recycled)} />
        <Key cls="disposed" k="Disposed" v={u(s.disposed)} />
        <Key cls="hand" k="In hand" v={s.inHand === null ? "—" : fmtQtyU(s.inHand, unit)} />
        <Key cls="lost" k="Not recovered" v={u(s.unrecovered)} />
        <Key cls="open" k="Not yet recovered" v={s.notYetRecovered === null ? "—" : fmtQtyU(s.notYetRecovered, unit)} />
        <Key cls="unacc" k="Unaccounted" v={s.unaccounted === null ? "—" : fmtQtyU(s.unaccounted, unit)} strong />
      </dl>
      {s.difference !== null && (
        <div className="rx-note" data-testid="viz-difference" style={{ marginTop: 3 }}>
          Actual − planned: <b>{s.difference > 0 ? "+" : s.difference < 0 ? "−" : ""}{fmtQtyU(Math.abs(s.difference), unit)}</b>. Unknown (not recorded) is shown as "not recorded", never as 0.
        </div>
      )}
    </div>
  );
}

function Key({ cls, k, v, extra, strong }: { cls: string; k: string; v: string; extra?: string | undefined; strong?: boolean }) {
  return (
    <div className="tk-key">
      <i className={`sw ${cls}`} />
      <dt>{k}</dt>
      <dd className={strong ? "strong" : undefined}>
        {v}
        {extra && <span className="rx-note"> · {extra}</span>}
      </dd>
    </div>
  );
}

/** One aggregate (a category, a floor, a status): planned behind, actual stacked, on a scale shared by all rows of the table. */
export function RollupBar({ r, scale }: { r: Rollup; scale: number }) {
  const segs = segmentsOf({ reused: r.reused, recycled: r.recycled, disposed: r.disposed, inHand: r.inHand, unrecovered: r.unrecovered, notYetRecovered: null, recovered: r.recovered }).filter((x) => x.value > EPS && x.key !== "notYet");
  return (
    <div className="tk-rbar" title={`planned ${fmtQtyU(r.planned, r.unit)} · recovered ${fmtQtyU(r.recovered, r.unit)}`}>
      <i className="plan" style={{ width: pct(r.planned, scale) }} />
      <div className="actual">
        {segs.map((x) => (
          <i key={x.key} className={x.className} style={{ width: pct(x.value, scale) }} title={`${x.label}: ${fmtQtyU(x.value, r.unit)}`} />
        ))}
      </div>
    </div>
  );
}

/** A tiny bar for a register row: the accounting of the component relative to its effective quantity, the plan as a tick. */
export function MiniBar({ s }: { s: Summary }) {
  const scale = Math.max(s.effective ?? 0, s.planned ?? 0, EPS);
  if (s.recovered === null) return <span className="tk-mini none" title="no recovered quantity recorded" />;
  return (
    <span className="tk-mini" title={`recovered ${fmtQtyU(s.recovered, s.unit)} of planned ${s.planned === null ? "—" : fmtQtyU(s.planned, s.unit)}`}>
      {segmentsOf(s)
        .filter((x) => x.value > EPS && x.key !== "notYet")
        .map((x) => (
          <i key={x.key} className={x.className} style={{ width: pct(x.value, scale) }} />
        ))}
      {s.planned !== null && s.planned > EPS && <b className="tick" style={{ left: pct(s.planned, scale) }} />}
    </span>
  );
}

/** The distribution of tracked records over the stages, as one stacked bar and a legend that filters the register. */
export function StageBar({ counts, onPick, active }: { counts: Readonly<Record<Status, number>>; onPick?: (s: Status) => void; active?: Status | "" | "not_tracked" }) {
  const total = STATUSES.reduce((s, k) => s + counts[k], 0);
  return (
    <div data-testid="stage-bar">
      <div className="tk-stack" role="img" aria-label="Tracked records by stage">
        {STATUSES.filter((s) => counts[s] > 0).map((s) => (
          <i key={s} className={`st-${s}`} style={{ width: pct(counts[s], total) }} title={`${STATUS_SHORT[s]}: ${counts[s]}`} />
        ))}
      </div>
      <div className="tk-stagelegend">
        {STATUSES.map((s) => (
          <button key={s} type="button" className={`tk-lg st-${s}`} aria-pressed={active === s} disabled={counts[s] === 0 && active !== s} onClick={() => onPick?.(s)} data-stage={s} title={`${STATUS_SHORT[s]}: ${counts[s]} record${counts[s] === 1 ? "" : "s"}`}>
            <i />
            {STATUS_SHORT[s]} <b>{counts[s]}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

export type { Unit };
