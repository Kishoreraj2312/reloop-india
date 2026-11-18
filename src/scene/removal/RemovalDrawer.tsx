/**
 * Removal planning + simulation drawer (B3). Local to the controls panel: opening it never touches the scene
 * until a plan exists and "Show in 3D" is on. Everything shown comes from the removal engine (analysis), the B1
 * inventory (quantities, filters) or the recovery store (B2); the sequence is the user's and is never reordered
 * unless the user presses an explicit action.
 */

import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, filterRows, FLOOR_LABEL, getModelInventory } from "@/engine/quantities";
import type { ArchCategory } from "@/building/structure";
import { getModelGraph, STATE_LABELS, type EntryAnalysis, type PlanAnalysis, type RemovalState } from "@/engine/removal";
import { PALETTE } from "../inventory/ui";
import { Dot } from "../recovery/AssessmentEditor";
import { EntryDetail } from "./EntryDetail";
import { REMOVAL_COLOURS, REMOVAL_LEGEND } from "./colors";
import { CATEGORY_LAYER, LAYERS, LAYER_LABELS, type LayerKey, type ViewState } from "../viewState";
import { analysisOf, removalStore, useRemoval } from "./removalStore";
import { btn, btnAccent, btnOff, field, heading, LEVEL_COLOUR, linkBtn } from "./ui";

const STATE_COLOUR: Record<RemovalState, string> = { planned: "#0072b2", ready_for_review: "#1f6b43", simulated_removed: PALETTE.muted };
const ROW_LIMIT = 200;

function StateChip({ e }: { e: EntryAnalysis }) {
  return (
    <span data-testid="row-state" data-state={e.state} style={{ display: "inline-block", padding: "0 6px", borderRadius: 8, border: `1px solid ${STATE_COLOUR[e.state]}`, color: STATE_COLOUR[e.state], fontSize: 10, lineHeight: "14px", whiteSpace: "nowrap" }}>
      {STATE_LABELS[e.state]}
    </span>
  );
}

export function RemovalDrawer({ onClose, onSelect, selectedId, view, onViewChange }: { onClose: () => void; onSelect: (id: string | null) => void; selectedId: string | null; view: ViewState; onViewChange: (v: ViewState) => void }) {
  const rs = useRemoval();
  const plan = rs.plans.find((p) => p.id === rs.activeId);
  const graph = useMemo(() => getModelGraph(), []);
  const inv = useMemo(() => getModelInventory(), []);
  const analysis = plan ? analysisOf(plan) : null;
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [limit, setLimit] = useState(ROW_LIMIT);

  // add-components filters (B1 inventory rows)
  const [floor, setFloor] = useState("");
  const [system, setSystem] = useState("");
  const [category, setCategory] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [asAssemblies, setAsAssemblies] = useState(true);
  useEffect(() => {
    const h = setTimeout(() => setQuery(text), 150);
    return () => clearTimeout(h);
  }, [text]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => setConfirm(null), [rs.activeId]);

  const matches = useMemo(() => {
    const active = floor !== "" || system !== "" || category !== "" || query.trim() !== "";
    if (!active) return [];
    return filterRows(inv.rows, { ...(floor !== "" ? { floor: Number(floor) } : {}), ...(system ? { system } : {}), ...(category ? { category: category as (typeof CATEGORIES)[number] } : {}), ...(query.trim() ? { text: query } : {}) });
  }, [inv, floor, system, category, query]);
  const facets = useMemo(
    () => ({ floors: [...inv.breakdowns.floor.keys()].map(Number).sort((a, b) => a - b), systems: [...inv.breakdowns.system.keys()].sort(), categories: CATEGORIES.filter((c) => inv.breakdowns.category.has(c)) }),
    [inv],
  );

  const report = (r: { added: readonly string[]; duplicates: readonly string[]; unknown: readonly string[] }) =>
    setMessage(`Added ${r.added.length}${r.duplicates.length ? `, ${r.duplicates.length} already in the plan` : ""}${r.unknown.length ? `, ${r.unknown.length} unknown` : ""}.`);

  const n = analysis?.entries.length ?? 0;
  const cursor = plan?.cursor ?? 0;
  const atCursor = analysis && cursor < n ? analysis.entries[cursor]! : null;
  const canNext = !!analysis && atCursor !== null && !atCursor.blocked;

  const step = (dir: 1 | -1) => {
    if (!plan || !analysis) return;
    if (dir === 1) {
      if (!canNext) return;
      removalStore.next();
      const upcoming = analysis.entries[cursor + 1];
      if (upcoming) onSelect(upcoming.id);
    } else if (cursor > 0) {
      removalStore.prev();
      onSelect(analysis.entries[cursor - 1]!.id); // the step just restored
    }
  };

  const planBar = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "10px 0 4px" }}>
      <select data-testid="removal-plan-select" style={{ ...field, minWidth: 150 }} value={rs.activeId ?? ""} onChange={(e) => removalStore.selectPlan(e.target.value)} disabled={rs.plans.length === 0}>
        {rs.plans.length === 0 && <option value="">no plan yet</option>}
        {rs.plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.entries.length})
          </option>
        ))}
      </select>
      <button type="button" data-testid="plan-new" style={btn} onClick={() => removalStore.createPlan()}>
        New
      </button>
      {plan && (
        <>
          <button type="button" data-testid="plan-rename" style={btn} onClick={() => setRenaming(renaming === null ? plan.name : null)}>
            Rename
          </button>
          <button type="button" data-testid="plan-duplicate" style={btn} onClick={() => removalStore.duplicate()}>
            Duplicate
          </button>
          <button type="button" data-testid="plan-reset" style={plan.entries.length || plan.userEdges.length ? btn : btnOff} disabled={!plan.entries.length && !plan.userEdges.length} onClick={() => setConfirm("reset")} title="Remove every step, note and user dependency from this plan">
            Reset plan
          </button>
          <button type="button" data-testid="plan-delete" style={btn} onClick={() => setConfirm("delete")}>
            Delete
          </button>
        </>
      )}
    </div>
  );

  return (
    <div data-testid="removal-drawer" style={{ flex: "1 1 auto", minHeight: 0, width: "100%", display: "flex", flexDirection: "column", background: PALETTE.panel, color: PALETTE.text, font: "12.5px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif", fontVariantNumeric: "tabular-nums" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${PALETTE.line}`, background: "#fff" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Removal simulation</div>
          <div style={{ fontSize: 11, color: PALETTE.muted }}>A conceptual planning aid on explicit model relationships. It does not establish structural stability, safety or a certified removal order.</div>
        </div>
        <button type="button" data-testid="removal-close" onClick={onClose} title="Close (Esc): shows the normal model again" style={{ font: "inherit", fontSize: 16, border: "none", background: "none", cursor: "pointer", color: PALETTE.muted }}>
          ✕
        </button>
      </div>

      <div data-testid="removal-body" style={{ flex: 1, overflowY: "auto", padding: "0 14px 24px" }}>
        {planBar}
        {renaming !== null && (
          <form
            style={{ display: "flex", gap: 6, marginBottom: 4 }}
            onSubmit={(e) => {
              e.preventDefault();
              removalStore.rename(renaming);
              setRenaming(null);
            }}
          >
            <input data-testid="plan-name-input" autoFocus style={{ ...field, flex: 1 }} value={renaming} onChange={(e) => setRenaming(e.target.value)} />
            <button type="submit" style={btn}>
              Save
            </button>
            <button type="button" style={btn} onClick={() => setRenaming(null)}>
              Cancel
            </button>
          </form>
        )}
        {confirm && plan && (
          <div data-testid="plan-confirm" style={{ margin: "4px 0", color: PALETTE.warn }}>
            {confirm === "reset" ? `Remove all ${plan.entries.length} steps, notes and user dependencies from “${plan.name}”?` : `Delete the plan “${plan.name}”?`}{" "}
            <button
              type="button"
              data-testid="plan-confirm-yes"
              style={{ font: "inherit", fontSize: 12, color: PALETTE.warn }}
              onClick={() => {
                if (confirm === "reset") removalStore.reset();
                else removalStore.delete();
                setConfirm(null);
              }}
            >
              Yes
            </button>{" "}
            <button type="button" style={{ font: "inherit", fontSize: 12 }} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        )}

        {!plan ? (
          <div data-testid="removal-hint" style={{ color: PALETTE.muted, margin: "8px 0" }}>
            Create a plan, then add components from the 3D model (click one, then “Add to plan”) or from the filters below.
          </div>
        ) : (
          <>
            <div style={heading}>SIMULATION</div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
              <button type="button" data-testid="removal-reset-sim" style={cursor > 0 ? btn : btnOff} disabled={cursor === 0} onClick={() => removalStore.resetSimulation()} title="Back to the start: every component shown again">
                ⏮ Start
              </button>
              <button type="button" data-testid="removal-prev" style={cursor > 0 ? btn : btnOff} disabled={cursor === 0} onClick={() => step(-1)}>
                ◀ Previous
              </button>
              <button type="button" data-testid="removal-next" style={canNext ? btnAccent : btnOff} disabled={!canNext} onClick={() => step(1)} title={canNext ? "Simulate this step as removed" : atCursor ? "This step is blocked" : "No more steps"}>
                Next ▶
              </button>
              <select data-testid="removal-step-select" style={field} value={cursor} onChange={(e) => removalStore.goTo(Number(e.target.value))} aria-label="Go to step">
                <option value={0}>start (nothing removed)</option>
                {analysis!.entries.map((_, i) => (
                  <option key={i} value={i + 1}>
                    after step {i + 1}
                  </option>
                ))}
              </select>
              <label style={{ display: "flex", gap: 5, alignItems: "center", cursor: "pointer", marginLeft: "auto" }}>
                <input type="checkbox" data-testid="removal-overlay" checked={rs.overlay} onChange={(e) => removalStore.setOverlay(e.target.checked)} />
                Show in 3D
              </label>
            </div>
            <div data-testid="removal-status" style={{ margin: "6px 0 2px" }}>
              <b data-testid="removal-cursor">{cursor}</b> of {n} steps simulated as removed.{" "}
              {n === 0 ? (
                <span style={{ color: PALETTE.muted }}>The plan is empty.</span>
              ) : atCursor === null ? (
                <span>Simulation complete.</span>
              ) : atCursor.blocked ? (
                <span style={{ color: LEVEL_COLOUR.error }}>
                  Step {cursor + 1} ({atCursor.id}) is blocked.{" "}
                  {analysis!.nextAvailable !== null ? (
                    <>
                      Next available: step {analysis!.nextAvailable + 1} ({analysis!.entries[analysis!.nextAvailable]!.id}){" "}
                      <button type="button" data-testid="move-available-up" style={{ ...linkBtn, fontSize: 12 }} onClick={() => removalStore.moveEntry(analysis!.nextAvailable!, cursor)}>
                        move it to step {cursor + 1}
                      </button>
                    </>
                  ) : (
                    "No step is available: resolve the blockers below."
                  )}
                </span>
              ) : (
                <span>
                  Next: step {cursor + 1} ({atCursor.id}) is ready for review.{" "}
                  <button type="button" data-testid="inspect-step" style={{ ...linkBtn, fontSize: 12 }} onClick={() => onSelect(atCursor.id)}>
                    inspect
                  </button>
                </span>
              )}
            </div>
            {atCursor?.blocked && (
              <div data-testid="removal-blockers" style={{ fontSize: 11.5, margin: "2px 0 4px" }}>
                {atCursor.findings
                  .filter((f) => f.level === "error")
                  .slice(0, 3)
                  .map((f, i) => (
                    <div key={i} style={{ borderLeft: `3px solid ${LEVEL_COLOUR.error}`, paddingLeft: 7, margin: "2px 0" }}>
                      {f.message}
                    </div>
                  ))}
              </div>
            )}
            <div data-testid="removal-counts" style={{ fontSize: 11.5, color: PALETTE.muted }}>
              {n} step{n === 1 ? "" : "s"} · <span style={{ color: analysis!.blockedCount ? LEVEL_COLOUR.error : undefined }}>{analysis!.blockedCount} blocked</span> · {analysis!.warningCount} advisory warning{analysis!.warningCount === 1 ? "" : "s"} · {analysis!.reviewCount} to review
              {analysis!.cycles.length > 0 && <span style={{ color: LEVEL_COLOUR.error }}> · {analysis!.cycles.length} circular</span>}
            </div>
            <SuggestOrder />
            <PlanLayers analysis={analysis!} view={view} onViewChange={onViewChange} />
            <div data-testid="removal-legend" style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", fontSize: 11, color: PALETTE.muted, marginTop: 6 }}>
              {REMOVAL_LEGEND.map((l) => (
                <span key={l.key} title={l.hint} data-legend={l.key} style={{ display: "flex", alignItems: "center" }}>
                  {l.key === "removed" ? <span style={{ display: "inline-block", width: 9, height: 9, marginRight: 5, border: "1px dashed #8a949c", borderRadius: 5 }} /> : <Dot colour={REMOVAL_COLOURS[l.key]} />}
                  {l.label}
                </span>
              ))}
            </div>

            <div style={heading}>SEQUENCE</div>
            {n === 0 ? (
              <div style={{ color: PALETTE.muted }}>No steps yet.</div>
            ) : (
              <div data-testid="removal-sequence" style={{ border: `1px solid ${PALETTE.line}`, background: "#fff" }}>
                {analysis!.entries.slice(0, limit).map((e) => {
                  const sel = selectedId !== null && analysis!.owner.get(selectedId) === e.index;
                  const warn = e.findings.filter((f) => f.level === "warning").reduce((s, f) => s + f.count, 0);
                  const node = graph.node(e.id);
                  return (
                    <div key={e.index}>
                      {e.index === cursor && <div data-testid="cursor-marker" style={{ height: 0, borderTop: `2px solid ${PALETTE.accent}` }} />}
                      <div
                        data-testid="removal-row"
                        data-index={e.index}
                        data-id={e.id}
                        data-state={e.state}
                        data-blocked={e.blocked}
                        onClick={() => onSelect(e.id)}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 6px", cursor: "pointer", background: sel ? "#fdeee6" : undefined, borderTop: e.index ? `1px solid ${PALETTE.line}` : undefined, opacity: e.state === "simulated_removed" ? 0.55 : 1 }}
                      >
                        <span style={{ width: 28, textAlign: "right", color: PALETTE.muted }}>{e.index + 1}</span>
                        <StateChip e={e} />
                        {e.blocked && <span style={{ color: LEVEL_COLOUR.error, fontSize: 10.5, fontWeight: 600 }}>BLOCKED</span>}
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: e.state === "simulated_removed" ? "line-through" : undefined }} title={node?.name ?? e.id}>
                          {e.id}
                          {node?.group ? <span style={{ color: PALETTE.muted }}> · {e.leafCount} parts</span> : null}
                          {!e.exists && <span style={{ color: LEVEL_COLOUR.error }}> · missing</span>}
                        </span>
                        {warn > 0 && (
                          <span title="advisory warnings" style={{ color: LEVEL_COLOUR.warning, fontSize: 10.5 }}>
                            ⚠ {warn}
                          </span>
                        )}
                        <span style={{ display: "flex", gap: 2 }} onClick={(ev) => ev.stopPropagation()}>
                          <button type="button" data-testid="row-up" aria-label="move earlier" disabled={e.index === 0} style={{ ...btn, padding: "0 5px" }} onClick={() => removalStore.moveEntry(e.index, e.index - 1)}>
                            ▲
                          </button>
                          <button type="button" data-testid="row-down" aria-label="move later" disabled={e.index === n - 1} style={{ ...btn, padding: "0 5px" }} onClick={() => removalStore.moveEntry(e.index, e.index + 1)}>
                            ▼
                          </button>
                          <button type="button" data-testid="row-remove" aria-label="remove from plan" style={{ ...btn, padding: "0 5px" }} onClick={() => removalStore.removeEntry(e.index)}>
                            ✕
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
                {cursor === n && n > 0 && limit >= n && <div style={{ height: 0, borderTop: `2px solid ${PALETTE.accent}` }} />}
              </div>
            )}
            {n > limit && (
              <button type="button" data-testid="show-more" style={{ ...linkBtn, marginTop: 4 }} onClick={() => setLimit(limit + 500)}>
                show {Math.min(500, n - limit)} more of {n - limit} hidden steps
              </button>
            )}

            <div style={heading}>SELECTED COMPONENT</div>
            <EntryDetail plan={plan} analysis={analysis!} selectedId={selectedId} onSelect={onSelect} />
          </>
        )}

        <div style={heading}>ADD COMPONENTS</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <button type="button" data-testid="add-selected" style={selectedId ? btn : btnOff} disabled={!selectedId} onClick={() => selectedId && report(removalStore.addEntries([selectedId]))}>
            Add selected component
          </button>
          <span style={{ color: PALETTE.muted, fontSize: 11 }}>{selectedId ?? "click one in the model"}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <select data-testid="removal-filter-floor" style={field} value={floor} onChange={(e) => setFloor(e.target.value)}>
            <option value="">All floors</option>
            {facets.floors.map((f) => (
              <option key={f} value={f}>
                {FLOOR_LABEL[f] ?? f}
              </option>
            ))}
          </select>
          <select data-testid="removal-filter-system" style={field} value={system} onChange={(e) => setSystem(e.target.value)}>
            <option value="">All systems</option>
            {facets.systems.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select data-testid="removal-filter-category" style={field} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {facets.categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <input data-testid="removal-search" type="search" placeholder="Search id or name" value={text} onChange={(e) => setText(e.target.value)} style={{ ...field, flex: 1, minWidth: 120 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span data-testid="removal-match-count" data-count={matches.length}>
            <b>{matches.length.toLocaleString("en-US")}</b> matching components
          </span>
          <label style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }} title="Add each matching component's containing assembly once, instead of every part">
            <input type="checkbox" checked={asAssemblies} onChange={(e) => setAsAssemblies(e.target.checked)} />
            as whole assemblies
          </label>
          <button
            type="button"
            data-testid="add-matching"
            style={matches.length ? btn : btnOff}
            disabled={matches.length === 0}
            onClick={() => {
              const ids = matches.map((r) => r.rec.id);
              report(removalStore.addEntries(asAssemblies ? [...new Set(ids.map((id) => graph.containerOf(id) ?? id))] : ids));
            }}
          >
            Add matching
          </button>
        </div>
        {message && (
          <div data-testid="removal-message" role="status" style={{ marginTop: 6, color: PALETTE.muted }}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

/** The layer each drawn record belongs to (the controls panel's layer keys). */
function layerOf(sys: string, assembly: string): LayerKey {
  if (sys === "plumbing" || sys === "electrical") return sys;
  return sys === "architecture" ? CATEGORY_LAYER[assembly as ArchCategory] : "structure";
}

/**
 * Structure is enclosed by the facade, so a plan is easiest to read with the other layers off. This only sets the
 * existing layer toggles (floors, X-ray and sections are untouched); "All layers" turns every layer back on.
 */
function PlanLayers({ analysis, view, onViewChange }: { analysis: PlanAnalysis; view: ViewState; onViewChange: (v: ViewState) => void }) {
  const inv = useMemo(() => getModelInventory(), []);
  const graph = useMemo(() => getModelGraph(), []);
  const used = useMemo(() => {
    const s = new Set<LayerKey>();
    for (const e of analysis.entries) {
      if (!e.exists) continue;
      for (const id of graph.leaves(e.id)) {
        const rec = inv.recordById.get(id);
        if (rec) s.add(layerOf(rec.system, rec.assembly));
      }
    }
    return s;
  }, [analysis, inv, graph]);
  if (used.size === 0) return null;
  const only = LAYERS.every((l) => (view.layers[l] !== false) === used.has(l));
  const allOn = LAYERS.every((l) => view.layers[l] !== false);
  return (
    <div data-testid="plan-layers" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 6, fontSize: 11.5 }}>
      <span style={{ color: PALETTE.muted }}>Plan uses: {[...used].map((l) => LAYER_LABELS[l]).join(", ")}</span>
      <button type="button" data-testid="layers-plan-only" style={only ? btnOff : btn} disabled={only} onClick={() => onViewChange({ ...view, layers: Object.fromEntries(LAYERS.map((l) => [l, used.has(l)])) as ViewState["layers"] })} title="Hide every layer the plan does not touch (the layer toggles in the controls panel)">
        Show plan layers only
      </button>
      <button type="button" data-testid="layers-all" style={allOn ? btnOff : btn} disabled={allOn} onClick={() => onViewChange({ ...view, layers: Object.fromEntries(LAYERS.map((l) => [l, true])) as ViewState["layers"] })}>
        All layers
      </button>
    </div>
  );
}

/** Explicit, previewed re-ordering: the plan is changed only when the user accepts the suggestion. */
function SuggestOrder() {
  const rs = useRemoval();
  const plan = rs.plans.find((p) => p.id === rs.activeId);
  const [open, setOpen] = useState(false);
  const s = plan ? removalStore.suggestedOrder() : null;
  if (!plan || !s || !s.changed) return null;
  return (
    <div data-testid="suggest-order" style={{ margin: "4px 0", fontSize: 11.5 }}>
      <button type="button" data-testid="suggest-toggle" style={linkBtn} onClick={() => setOpen(!open)}>
        A valid order exists for the blocking relationships
      </button>
      {open && (
        <div style={{ marginTop: 2 }}>
          <div style={{ color: PALETTE.muted }}>
            Preview ({s.order.length} steps, first 8): {s.order.slice(0, 8).join(" → ")}
            {s.order.length > 8 ? " …" : ""}
            {s.stuck.length ? ` · ${s.stuck.length} on a cycle stay as they are` : ""}
          </div>
          <button type="button" data-testid="suggest-apply" style={btn} onClick={() => (removalStore.applySuggestedOrder(), setOpen(false))}>
            Apply this order
          </button>
        </div>
      )}
    </div>
  );
}
