/**
 * The side-by-side comparison (B4): whole-building indicator when the mass data allows it, material flow per unit, a totals
 * table, a material-category table with a detail panel, what differs, missing assumptions and the B3 plan context. Every number
 * comes from the scenario engine (B1 quantities x B2 assessments x the scenario's assumptions); units are never added together;
 * clicking an outcome or a category highlights the real components in the 3D model.
 */

import { useMemo, useState, type ReactNode } from "react";
import { formatTonnes, formatValue, getModelInventory, UNIT_LABEL, type Unit } from "@/engine/quantities";
import {
  categoryLabel,
  compareRows,
  describeDifferences,
  nearlyEqual,
  MIN_MASS_VOLUME_COVERAGE_PCT,
  MISSING_LABELS,
  OUTCOME_ORDER,
  PATHWAY_LABELS,
  PATHWAY_SHORT,
  removalContext,
  resultFor,
  selectorKey,
  totalOfUnit,
  unitsOf,
  type CategoryRow,
  type MissingAssumption,
  type Pathway,
  type Scenario,
  type ScenarioResult,
  type Selector,
} from "@/engine/scenarios";
import { PALETTE } from "../inventory/ui";
import { useRecovery } from "../recovery/recoveryStore";
import { useRemoval } from "../removal/removalStore";
import { btn, heading, linkBtn } from "../removal/ui";
import { Legend, StackedBar } from "./Charts";
import { outcomeCss } from "./colors";
import { highlightMatches, resultOf, scenarioStore, useScenarios } from "./scenarioStore";

const th = { textAlign: "right" as const, padding: "2px 5px", fontWeight: 600, fontSize: 10.5, lineHeight: 1.25, verticalAlign: "bottom" as const };
const td = { textAlign: "right" as const, padding: "1px 5px", fontVariantNumeric: "tabular-nums" as const, fontSize: 11.5, whiteSpace: "nowrap" as const };
const table = { borderCollapse: "collapse" as const, width: "100%", background: "#fff", border: `1px solid ${PALETTE.line}` };
const MUTED = { color: PALETTE.muted } as const;

const pct = (v: number | null) => (v === null ? "–" : `${v.toFixed(1)}%`);
const signed = (v: number, unit: Unit) => `${v >= 0 ? "+" : "−"}${formatValue(Math.abs(v), unit)}`;

export function CompareSection() {
  const sc = useScenarios();
  const { assessments } = useRecovery();
  const rm = useRemoval();
  const inv = useMemo(() => getModelInventory(), []);
  const [focus, setFocus] = useState(0);
  const [catKey, setCatKey] = useState<string | null>(null);

  const scenarios = useMemo(() => sc.compareIds.map((id) => sc.scenarios.find((s) => s.id === id)).filter((s): s is Scenario => s !== undefined), [sc.compareIds, sc.scenarios]);
  const results = useMemo<ScenarioResult[]>(() => scenarios.map(resultOf), [scenarios, assessments]);
  const basis = sc.basis;
  const units = unitsOf(results, basis);
  const unit: Unit | undefined = sc.unit && units.includes(sc.unit) ? sc.unit : units[0];
  const focusIdx = Math.min(focus, Math.max(0, scenarios.length - 1));

  const rows = useMemo(() => {
    if (!unit) return [];
    const r = compareRows(results, basis, unit);
    return r.sort((a, b) => (b.cells[0]?.available ?? 0) - (a.cells[0]?.available ?? 0) || (a.label < b.label ? -1 : 1));
  }, [results, basis, unit]);
  const differences = useMemo(() => describeDifferences(scenarios, results, basis), [scenarios, results, basis]);
  const plan = rm.plans.find((p) => p.id === rm.activeId);
  const contexts = useMemo(() => (plan ? scenarios.map((s) => removalContext(inv, assessments, s, basis, plan.entries)) : []), [plan, scenarios, inv, assessments, basis]);

  const isPickedOutcome = (i: number): Pathway | null => {
    const h = sc.highlight;
    return h && h.scenarioId === scenarios[i]?.id && h.selector.outcome && h.selector.category === undefined ? h.selector.outcome : null;
  };

  if (scenarios.length === 0) {
    return (
      <div data-testid="compare-hint" style={{ ...MUTED, marginTop: 10 }}>
        Tick “Compare” on two or three scenarios above to see them side by side.
      </div>
    );
  }

  const label = (i: number, sel: Selector) => `${scenarios[i]!.name}: ${[sel.category && categoryLabel(sel.category), sel.outcome && PATHWAY_SHORT[sel.outcome], sel.missing && MISSING_LABELS[sel.missing], sel.unit && UNIT_LABEL[sel.unit]].filter(Boolean).join(" · ") || "all components"}`;
  const pick = (i: number, sel: Selector) => {
    const s = scenarios[i]!;
    const cur = sc.highlight;
    if (cur && cur.scenarioId === s.id && selectorKey(cur.selector) === selectorKey(sel)) return scenarioStore.setHighlight(null);
    scenarioStore.setHighlight({ scenarioId: s.id, selector: sel, label: label(i, sel) });
  };
  const detail = catKey ? rows.find((r) => r.key === catKey) : undefined;
  const hl = sc.highlight;
  const hlKey = hl ? `${hl.scenarioId}|${selectorKey(hl.selector)}` : "";
  const isPicked = (i: number, sel: Selector) => hlKey === `${scenarios[i]!.id}|${selectorKey(sel)}`;

  return (
    <div data-testid="compare-section">
      <div style={heading}>COMPARE</div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", marginBottom: 6 }}>
        <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
          Quantify by
          <select data-testid="scenario-basis" style={{ font: "inherit", fontSize: 12, padding: "2px 4px", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }} value={basis} onChange={(e) => scenarioStore.setBasis(e.target.value as "quantity" | "mass")}>
            <option value="quantity">B1 quantity (own units)</option>
            <option value="mass">Estimated mass (kg)</option>
          </select>
        </label>
        <span style={{ ...MUTED, fontSize: 11 }}>
          Diversion % = (direct reuse + refurbished reuse + recycling) ÷ available × 100. One table per unit: m³, m², m, nr and kg are never added together.
        </span>
      </div>
      {scenarios.length < 2 && <div style={{ ...MUTED, marginBottom: 4 }}>One scenario is selected; tick a second to compare.</div>}

      {/* highlight bar */}
      <div data-testid="highlight-bar" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 8px", background: "#eef1f3", borderRadius: 6, marginBottom: 6, minHeight: 28 }}>
        <span style={MUTED}>3D highlight</span>
        {hl ? (
          <>
            <b data-testid="highlight-label" style={{ fontWeight: 600 }}>{hl.label}</b>
            <span data-testid="highlight-count" style={MUTED}>
              {highlightMatches(hl, basis).length.toLocaleString("en-US")} components
            </span>
            <button type="button" data-testid="highlight-clear" style={btn} onClick={() => scenarioStore.setHighlight(null)}>
              Clear
            </button>
          </>
        ) : (
          <span style={MUTED}>click an outcome bar, a category or a missing assumption to mark the real components in the model</span>
        )}
        <span style={{ flex: 1 }} />
        {scenarios.length > 1 && (
          <label style={{ display: "flex", gap: 4, alignItems: "center", ...MUTED }}>
            categories follow
            <select data-testid="highlight-scenario" style={{ font: "inherit", fontSize: 11, padding: "1px 3px", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }} value={focusIdx} onChange={(e) => setFocus(Number(e.target.value))}>
              {scenarios.map((s, i) => (
                <option key={s.id} value={i}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <Legend />

      {/* whole-building indicator */}
      <div style={heading}>WHOLE-BUILDING INDICATOR (ESTIMATED MASS)</div>
      <div data-testid="wb-cards" style={{ display: "grid", gridTemplateColumns: `repeat(${scenarios.length}, minmax(0, 1fr))`, gap: 8 }}>
        {scenarios.map((s, i) => {
          const w = results[i]!.wholeBuilding;
          return (
            <div key={s.id} data-testid="wb-card" data-reliable={w.reliable} style={{ padding: "6px 8px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }}>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              {w.reliable ? (
                <>
                  <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginTop: 2 }}>
                    <span>
                      <span data-testid="wb-diversion" style={{ fontSize: 20, fontWeight: 650 }}>{pct(w.diversionPct)}</span> <span style={MUTED}>diverted</span>
                    </span>
                    <span>
                      <b data-testid="wb-unknown">{pct(w.unknownPct)}</b> <span style={MUTED}>unknown</span>
                    </span>
                    <span>
                      <b data-testid="wb-disposal">{pct(w.disposalPct)}</b> <span style={MUTED}>disposal</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, ...MUTED, marginTop: 2 }}>
                    of {formatTonnes(w.availableKg)} t estimated mass. Mass is estimated for {w.coverage.quantified.toLocaleString("en-US")} of {w.coverage.components.toLocaleString("en-US")} components ({w.coverage.componentPct.toFixed(0)}%), covering {w.coverage.volumePct?.toFixed(1)}% of the modelled solid volume; the rest have no density (pipes, cables, fixtures …) and are not in this figure.
                  </div>
                </>
              ) : (
                <div data-testid="wb-unavailable" style={{ ...MUTED, fontSize: 11, marginTop: 2 }}>
                  Not shown: {w.reason}. Category results below. (Shown only when estimated mass covers at least {MIN_MASS_VOLUME_COVERAGE_PCT}% of the modelled solid volume.)
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* material flow */}
      <div style={heading}>MATERIAL FLOW{unit ? ` · ${UNIT_LABEL[unit]}` : ""}</div>
      {units.length > 1 && (
        <div role="tablist" style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {units.map((u) => (
            <button key={u} type="button" role="tab" aria-selected={u === unit} data-testid="unit-tab" data-unit={u} style={{ ...btn, fontWeight: u === unit ? 600 : 400, background: u === unit ? "#fdf3ed" : "#fff", borderColor: u === unit ? PALETTE.accent : PALETTE.line }} onClick={() => scenarioStore.setUnit(u)}>
              {UNIT_LABEL[u]}
            </button>
          ))}
        </div>
      )}
      {unit &&
        scenarios.map((s, i) => {
          const t = totalOfUnit(resultFor(results[i]!, basis), unit);
          if (!t) return null;
          return (
            <div key={s.id} data-testid="flow-row" style={{ display: "grid", gridTemplateColumns: "150px 1fr 230px", gap: 8, alignItems: "center", marginBottom: 5 }}>
              <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.name}>
                {s.name}
              </div>
              <StackedBar testid="flow-bar" outcome={t.outcome} available={t.available} unit={unit} height={16} selected={isPickedOutcome(i)} onPick={(p) => pick(i, { outcome: p, unit })} />
              <div style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                <b>{pct(t.diversionPct)}</b> diverted · {pct(t.disposalPct)} disposal · {pct(t.unknownPct)} unknown
                <div style={MUTED}>of {formatValue(t.available, unit)} {UNIT_LABEL[unit]}</div>
              </div>
            </div>
          );
        })}
      {unit && (
        <>
          <div style={{ ...MUTED, fontSize: 10.5, margin: "6px 0 3px" }}>Allocated = quantity assigned to the pathway; outcome = where it ends up (recovered share for the three recovery pathways; disposal and unknown include any unrecovered share).</div>
          <PathwayTable testid="totals-table" cells={scenarios.map((_, i) => totalOfUnit(resultFor(results[i]!, basis), unit) ?? null)} names={scenarios.map((s) => s.name)} unit={unit} onPick={(i, p) => pick(i, { outcome: p, unit })} isPicked={(i, p) => isPicked(i, { outcome: p, unit })} />
        </>
      )}

      {/* by material category */}
      {unit && (
        <>
          <div style={heading}>BY MATERIAL CATEGORY · {UNIT_LABEL[unit]}</div>
          <table data-testid="category-table" style={table}>
            <thead>
              <tr style={{ background: "#eceff1" }}>
                <th style={{ ...th, textAlign: "left" }}>Material category</th>
                <th style={th}>Available</th>
                {scenarios.map((s) => (
                  <th key={s.id} style={{ ...th, textAlign: "left", borderLeft: `1px solid ${PALETTE.line}` }} colSpan={3} title={s.name}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{s.name}</div>
                    <div style={{ fontWeight: 400, ...MUTED }}>outcome · diverted % · unknown %</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid="category-row" data-category={r.key} onClick={() => (setCatKey(r.key === catKey ? null : r.key), pick(focusIdx, { category: r.key, unit }))} style={{ borderTop: `1px solid ${PALETTE.line}`, cursor: "pointer", background: r.key === catKey ? "#fdf3ed" : "transparent" }}>
                  <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>{r.label}</td>
                  <td style={td}>{r.cells[0] ? formatValue(r.cells[0].available, unit) : "–"}</td>
                  {r.cells.map((c, i) => (
                    <CategoryCells key={scenarios[i]!.id} c={c} i={i} ref0={r.cells[0] ?? null} unit={unit} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {detail && (
            <div data-testid="category-detail" data-category={detail.key} style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, margin: "2px 0 4px" }}>
                {detail.label} · {UNIT_LABEL[unit]}
              </div>
              <PathwayTable testid="detail-table" cells={detail.cells} names={scenarios.map((s) => s.name)} unit={unit} onPick={(i, p) => pick(i, { category: detail.key, outcome: p, unit })} isPicked={(i, p) => isPicked(i, { category: detail.key, outcome: p, unit })} />
            </div>
          )}
        </>
      )}

      {/* what differs */}
      <div style={heading}>WHAT DIFFERS</div>
      <div data-testid="differences">
        {scenarios.length < 2 ? (
          <div style={MUTED}>Select a second scenario to see what differs.</div>
        ) : (
          differences.map((g) => {
            const s = scenarios.find((x) => x.id === g.scenarioId)!;
            const a = scenarios.find((x) => x.id === g.againstId)!;
            return (
              <div key={g.scenarioId} data-testid="difference-group" style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 600 }}>
                  {s.name} <span style={{ ...MUTED, fontWeight: 400 }}>vs</span> {a.name}
                </div>
                {g.items.length === 0 ? (
                  <div style={MUTED}>No difference in assumptions or calculated quantities.</div>
                ) : (
                  <ul style={{ margin: "2px 0 0", paddingLeft: 16 }}>
                    {g.items.map((it, k) => (
                      <li key={k} data-kind={it.kind} style={{ marginBottom: 1 }}>
                        <span style={{ ...MUTED, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>{it.kind === "assumption" ? "assumption" : "result"} </span>
                        {it.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* missing assumptions */}
      <div style={heading}>MISSING ASSUMPTIONS</div>
      <div data-testid="missing-list" style={{ display: "grid", gridTemplateColumns: `repeat(${scenarios.length}, minmax(0, 1fr))`, gap: 8 }}>
        {scenarios.map((s, i) => (
          <div key={s.id} data-testid="missing-card" style={{ padding: "6px 8px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }}>
            <div style={{ fontWeight: 600 }}>{s.name}</div>
            {results[i]!.missing.length === 0 ? (
              <div style={MUTED}>None: every quantity has a stated pathway.</div>
            ) : (
              <ul style={{ margin: "2px 0 0", paddingLeft: 14 }}>
                {results[i]!.missing.map((m) => (
                  <MissingItem key={m.code} m={m} onPick={m.code === "stale_override" ? undefined : () => pick(i, { missing: m.code as Exclude<MissingAssumption["code"], "stale_override"> })} picked={m.code !== "stale_override" && isPicked(i, { missing: m.code })} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* B3 plan context */}
      {plan && contexts.length === scenarios.length && (
        <>
          <div style={heading}>REMOVAL-PLAN CONTEXT (B3)</div>
          <div data-testid="removal-context" style={{ fontSize: 11.5 }}>
            Active plan “{plan.name}” ({plan.entries.length} entries).
            <ul style={{ margin: "2px 0", paddingLeft: 16 }}>
              {scenarios.map((s, i) => (
                <li key={s.id}>
                  {s.name}: {contexts[i]!.recoveryComponents.toLocaleString("en-US")} components with a recovered quantity; {contexts[i]!.inPlan.toLocaleString("en-US")} are covered by the plan, {contexts[i]!.notInPlan.toLocaleString("en-US")} are not
                  {contexts[i]!.unknownEntries ? ` (${contexts[i]!.unknownEntries} plan entries are not components of this model)` : ""}.
                </li>
              ))}
            </ul>
            <span style={MUTED}>A plan lists an intended order. It does not show that anything has been removed, that removal is possible, or that a pathway is feasible.</span>
          </div>
        </>
      )}
    </div>
  );
}

function MissingItem({ m, onPick, picked }: { m: MissingAssumption; onPick?: () => void; picked: boolean }) {
  const cats = m.categories.slice(0, 4).map(categoryLabel).join(", ") + (m.categories.length > 4 ? ` +${m.categories.length - 4}` : "");
  return (
    <li data-testid="missing-item" data-code={m.code} style={{ marginBottom: 2 }}>
      {onPick ? (
        <button type="button" style={{ ...linkBtn, fontWeight: picked ? 600 : 400 }} onClick={onPick} title="Mark these components in the 3D model">
          {m.message}
        </button>
      ) : (
        m.message
      )}{" "}
      <span style={MUTED}>
        — {m.components.toLocaleString("en-US")} {m.code === "stale_override" ? "overrides" : "components"}
        {cats ? ` (${cats})` : ""}
      </span>
    </li>
  );
}

function CategoryCells({ c, i, ref0, unit }: { c: CategoryRow | null; i: number; ref0: CategoryRow | null; unit: Unit }) {
  const first = { ...td, borderLeft: `1px solid ${PALETTE.line}`, textAlign: "left" as const, width: 120 };
  if (!c) {
    return (
      <>
        <td style={first}>–</td>
        <td style={td}>–</td>
        <td style={td}>–</td>
      </>
    );
  }
  const d = i > 0 && ref0 && c.diversionPct !== null && ref0.diversionPct !== null ? c.diversionPct - ref0.diversionPct : null;
  return (
    <>
      <td style={first}>
        <StackedBar outcome={c.outcome} available={c.available} unit={unit} height={10} width={110} testid="category-bar" />
      </td>
      <td style={td} data-field="diversion">
        {pct(c.diversionPct)}
        {d !== null && Math.abs(d) >= 0.05 && <div style={{ ...MUTED, fontSize: 10 }}>{d >= 0 ? "+" : "−"}{Math.abs(d).toFixed(1)} pts</div>}
      </td>
      <td style={td} data-field="unknown">
        {pct(c.unknownPct)}
      </td>
    </>
  );
}

/** Rows: pathways; columns: for each scenario its allocated quantity and its outcome. */
function PathwayTable({ cells, names, unit, onPick, isPicked, testid }: { cells: readonly (CategoryRow | null)[]; names: readonly string[]; unit: Unit; onPick: (i: number, p: Pathway) => void; isPicked: (i: number, p: Pathway) => boolean; testid: string }) {
  const num = (v: number) => (v === 0 ? <span style={MUTED}>0</span> : formatValue(v, unit));
  const delta = (i: number, p: Pathway) => {
    const a = cells[0];
    const b = cells[i];
    if (i === 0 || !a || !b) return null;
    const d = b.outcome[p] - a.outcome[p];
    return nearlyEqual(d, 0) ? null : <div style={{ ...MUTED, fontSize: 10 }}>{signed(d, unit)}</div>;
  };
  return (
    <table data-testid={testid} style={table}>
      <thead>
        <tr style={{ background: "#eceff1" }}>
          <th style={{ ...th, textAlign: "left" }} rowSpan={2}>
            {UNIT_LABEL[unit]}
          </th>
          {names.map((n, i) => (
            <th key={i} colSpan={2} style={{ ...th, textAlign: "center", borderLeft: `1px solid ${PALETTE.line}` }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180, margin: "0 auto" }} title={n}>
                {n}
              </div>
            </th>
          ))}
        </tr>
        <tr style={{ background: "#eceff1" }}>
          {names.map((_, i) => (
            <FragmentHeads key={i} />
          ))}
        </tr>
      </thead>
      <tbody>
        <tr style={{ borderTop: `1px solid ${PALETTE.line}`, fontWeight: 600 }}>
          <td style={{ ...td, textAlign: "left" }} title="Σ B1 quantity of the components that have a value on this basis">Available (B1)</td>
          {cells.map((c, i) => (
            <td key={i} colSpan={2} data-field="available" style={{ ...td, textAlign: "center", borderLeft: `1px solid ${PALETTE.line}` }}>
              {c ? formatValue(c.available, unit) : "–"}
            </td>
          ))}
        </tr>
        {OUTCOME_ORDER.map((p) => (
          <tr key={p} data-pathway={p} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
            <td style={{ ...td, textAlign: "left" }}>
              <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: p === "unknown" ? "repeating-linear-gradient(135deg,#8c96a0 0 2px,#dfe3e6 2px 4px)" : outcomeCss(p), marginRight: 6 }} />
              {PATHWAY_LABELS[p]}
            </td>
            {cells.map((c, i) => (
              <PathwayCells key={i} c={c} p={p} i={i} num={num} extra={delta(i, p)} picked={isPicked(i, p)} onPick={() => onPick(i, p)} unit={unit} />
            ))}
          </tr>
        ))}
        <tr style={{ borderTop: `1px solid ${PALETTE.line}`, ...MUTED }}>
          <td style={{ ...td, textAlign: "left" }} title="The part of a recovery pathway that is not recovered; it is included in disposal or unknown">Unrecovered residual</td>
          {cells.map((c, i) => (
            <td key={i} colSpan={2} data-field="residual" style={{ ...td, textAlign: "center", borderLeft: `1px solid ${PALETTE.line}` }}>
              {c ? num(c.residual) : "–"}
            </td>
          ))}
        </tr>
        <tr style={{ ...MUTED }}>
          <td style={{ ...td, textAlign: "left" }} title="Allocated to a recovery pathway that has no usable recovery %: carried as unknown">No recovery % set</td>
          {cells.map((c, i) => (
            <td key={i} colSpan={2} data-field="unconfigured" style={{ ...td, textAlign: "center", borderLeft: `1px solid ${PALETTE.line}`, color: c && c.unconfigured > 0 ? PALETTE.warn : PALETTE.muted }}>
              {c ? num(c.unconfigured) : "–"}
            </td>
          ))}
        </tr>
        <tr style={{ ...MUTED }}>
          <td style={{ ...td, textAlign: "left" }} title="direct reuse + refurbished reuse + recycling + disposal + unknown = available">Outcomes reconcile</td>
          {cells.map((c, i) => (
            <td key={i} colSpan={2} data-field="reconciled" data-ok={c?.reconciled ?? ""} style={{ ...td, textAlign: "center", borderLeft: `1px solid ${PALETTE.line}`, color: c && !c.reconciled ? PALETTE.warn : PALETTE.muted }}>
              {c ? (c.reconciled ? "✓ sum = available" : `✗ off by ${formatValue(c.discrepancy, unit)}`) : "–"}
            </td>
          ))}
        </tr>
        <tr style={{ ...MUTED }}>
          <td style={{ ...td, textAlign: "left" }} title="Components without a B1 value on this basis are not part of the quantities">Components with a value</td>
          {cells.map((c, i) => (
            <td key={i} colSpan={2} style={{ ...td, textAlign: "center", borderLeft: `1px solid ${PALETTE.line}` }}>
              {c ? `${c.quantified.toLocaleString("en-US")} of ${c.components.toLocaleString("en-US")}` : "–"}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function FragmentHeads() {
  return (
    <>
      <th style={{ ...th, fontWeight: 500, borderLeft: `1px solid ${PALETTE.line}` }}>Allocated</th>
      <th style={{ ...th, fontWeight: 500 }}>Outcome</th>
    </>
  );
}

function PathwayCells({ c, p, i, num, extra, picked, onPick, unit }: { c: CategoryRow | null; p: Pathway; i: number; num: (v: number) => ReactNode; extra: ReactNode; picked: boolean; onPick: () => void; unit: Unit }) {
  const border = `1px solid ${PALETTE.line}`;
  if (!c) {
    return (
      <>
        <td style={{ ...td, borderLeft: border }}>–</td>
        <td style={td}>–</td>
      </>
    );
  }
  const recovers = p === "direct_reuse" || p === "refurbish_reuse" || p === "recycling";
  return (
    <>
      <td data-field="allocated" data-scenario={i} style={{ ...td, borderLeft: border }}>
        {num(c.allocated[p])}
      </td>
      <td data-field="outcome" data-scenario={i} onClick={onPick} title="Mark these components in the 3D model" style={{ ...td, fontWeight: 600, cursor: "pointer", background: picked ? "#fdf3ed" : "transparent" }}>
        {recovers && c.unconfiguredBy[p] > 0 && nearlyEqual(c.unconfiguredBy[p], c.allocated[p]) ? (
          <span data-testid="recovered-unavailable" title="Recovered quantity unavailable: no recovery % is set, so the whole allocation is carried as unknown" style={{ color: PALETTE.warn }}>
            n/a
          </span>
        ) : (
          <>
            {num(c.outcome[p])}
            {recovers && c.unconfiguredBy[p] > 0 && (
              <span data-testid="recovered-partly-unavailable" title={`Recovery % is not set for ${formatValue(c.unconfiguredBy[p], unit)} ${UNIT_LABEL[unit]} allocated here: its recovered quantity is unavailable and carried as unknown`} style={{ color: PALETTE.warn }}>
                {" "}
                + n/a
              </span>
            )}
          </>
        )}
        {extra}
      </td>
    </>
  );
}
