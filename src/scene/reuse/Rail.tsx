/** The requirement rail (C2): every requirement with how much of it is allocated, and the ranking configuration. */

import { useState } from "react";
import { CRITERIA, CRITERION_HELP, CRITERION_LABELS, DEFAULT_CONFIG, DEMAND_LABELS, fmtQty, fmtQtyU, isDefaultConfig, substanceLabel, totalsByUnit } from "@/engine/reuse";
import { CATEGORY_LABELS, UNIT_LABEL } from "@/engine/quantities";
import { reuseStore, useReuse } from "./reuseStore";
import { useWorkspace } from "./hooks";
import { Bar } from "./ui";

function Weights() {
  const { config } = useReuse();
  const [err, setErr] = useState<string | null>(null);
  const total = CRITERIA.reduce((s, k) => s + config.weights[k], 0);
  return (
    <details className="rx-details" data-testid="weights">
      <summary>Ranking criteria &amp; weights</summary>
      <p className="rx-note" style={{ margin: "4px 0 6px" }}>
        Score = Σ weight × points ÷ Σ weight, over the criteria a requirement uses. It only orders candidates: strong, conditional and incompatible are decided by rules, never by the score.
      </p>
      <div className="rx-weights">
        {CRITERIA.map((k) => (
          <WeightRow key={k} label={CRITERION_LABELS[k]} help={CRITERION_HELP[k]} value={config.weights[k]} share={total > 0 ? (config.weights[k] / total) * 100 : 0} onChange={(v) => setErr(reuseStore.setWeight(k, v))} testid={`weight-${k}`} />
        ))}
        <WeightRow label="Partial" help="Share of a criterion's weight earned when it is only achievable with a condition (refurbishment, cutting, testing …)" value={Math.round(config.partialCredit * 100)} unit="%" onChange={(v) => setErr(reuseStore.setCredit("partialCredit", v / 100))} testid="credit-partial" />
        <WeightRow label="Unknown" help="Share earned when project data is missing. 0 % means missing data earns nothing" value={Math.round(config.unknownCredit * 100)} unit="%" onChange={(v) => setErr(reuseStore.setCredit("unknownCredit", v / 100))} testid="credit-unknown" />
      </div>
      {err && <div className="rx-error">{err}</div>}
      <div style={{ marginTop: 6 }}>
        <button type="button" className="rx-link" disabled={isDefaultConfig(config)} onClick={() => (setErr(null), reuseStore.resetConfig())} data-testid="weights-reset">
          reset to defaults ({CRITERIA.map((k) => DEFAULT_CONFIG.weights[k]).join(" / ")})
        </button>
      </div>
    </details>
  );
}

function WeightRow({ label, help, value, share, unit, onChange, testid }: { label: string; help: string; value: number; share?: number; unit?: string; onChange: (v: number) => void; testid: string }) {
  return (
    <>
      <span title={help} style={{ cursor: "help" }}>
        {label}
      </span>
      <input type="range" min={0} max={100} step={1} value={value} data-testid={testid} onChange={(e) => onChange(Number(e.target.value))} aria-label={`${label} weight`} />
      <span className="v" title={share !== undefined ? `${share.toFixed(0)} % of the total weight` : undefined}>
        {value}
        {unit ?? ""}
      </span>
    </>
  );
}

export function Rail() {
  const rs = useReuse();
  const { ledger } = useWorkspace();
  const totals = totalsByUnit(ledger.demand);
  return (
    <aside className="rx-rail" data-testid="reuse-rail">
      <div className="rx-rail-head">
        <span className="rx-cap">Requirements</span>
        <button type="button" className="rx-btn sm primary" data-testid="new-requirement" onClick={() => reuseStore.beginNew()}>
          + New
        </button>
      </div>
      <div className="rx-rail-list" data-testid="requirement-list">
        {rs.requirements.length === 0 && (
          <div className="rx-empty-rail">
            No requirements yet. A requirement states what a new project needs (a material, a quantity, sizes). Create one, or start from a component in the catalogue.
          </div>
        )}
        {ledger.demand.map((d) => {
          const r = d.requirement;
          const current = r.id === rs.activeId;
          return (
            <button key={r.id} type="button" className="rx-req" aria-current={current} data-testid="requirement-item" data-requirement={r.id} data-status={d.status} onClick={() => (reuseStore.select(r.id), rs.tab === "catalogue" && reuseStore.setTab("matches"))}>
              <div className="rx-req-name" title={r.name}>
                {r.name}
              </div>
              <div className="rx-req-meta" title={r.application}>
                {substanceLabel(r.substance)}
                {r.form ? ` · ${CATEGORY_LABELS[r.form]}` : ""}
              </div>
              <div className="rx-req-qty">
                <span>
                  <b>{fmtQty(d.allocated, r.unit)}</b> / {fmtQtyU(d.required, r.unit)}
                </span>
                <span className={`rx-req-status ${d.status}`}>{DEMAND_LABELS[d.status]}</span>
              </div>
              <Bar total={d.required} parts={[{ value: Math.min(d.allocated, d.required), kind: "alloc" }, { value: Math.max(0, d.allocated - d.required), kind: "over" }]} />
              {d.conditional > 1e-9 && <div className="rx-req-status partial" style={{ marginTop: 3 }}>{fmtQtyU(d.conditional, r.unit)} conditional</div>}
              {d.flagged > 0 && <div className="rx-flag">{d.flagged} allocation{d.flagged === 1 ? "" : "s"} to review</div>}
            </button>
          );
        })}
      </div>
      <div className="rx-rail-foot">
        {totals.length > 0 && (
          <div style={{ marginBottom: 8 }} data-testid="rail-totals">
            <div className="rx-cap" style={{ marginBottom: 2 }}>Demand by unit</div>
            {totals.map((t) => (
              <div key={t.unit} className="rx-req-qty" style={{ margin: "1px 0" }} data-unit={t.unit}>
                <span>{UNIT_LABEL[t.unit]}</span>
                <span>
                  <b>{fmtQty(t.allocated, t.unit)}</b> of {fmtQty(t.required, t.unit)}
                </span>
              </div>
            ))}
          </div>
        )}
        <Weights />
      </div>
    </aside>
  );
}
