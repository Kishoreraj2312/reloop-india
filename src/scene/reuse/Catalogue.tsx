/**
 * The catalogue of recovered materials (C2): every leaf component of the model with what it can supply for reuse, searchable and
 * filterable. Rows are the real components (same ids as B1, B2, C1 and the 3D model); clicking one selects it in the building.
 */

import { memo, useMemo, useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, FLOOR_LABEL, type Category, type InventoryRow } from "@/engine/quantities";
import { CLASSIFICATION_SHORT, substanceOf, type Classification, type RecoveryAssessment } from "@/engine/recovery";
import { allocatedByComponent, draftFromComponent, fmtQty, fmtQtyU, materialName, rowsOfSubstance, sizeLabel, substanceIndex, substanceLabel, supplyOf } from "@/engine/reuse";
import { leafRow, useWorkspace } from "./hooks";
import { locateInModel } from "./locate";
import { Opportunities, SourceFacts } from "./Source";
import { reuseStore, useReuse } from "./reuseStore";
import { Chip, Seg, VList, n0, useDebounced } from "./ui";

type Elig = "all" | "reuse" | "review" | "none" | "recycling";
const ELIG_LABEL: Readonly<Record<Elig, string>> = { all: "All", reuse: "Assessed for reuse", review: "Needs assessment", none: "Not assessed", recycling: "For recycling" };
const eligOf = (c: Classification | null | undefined): Exclude<Elig, "all"> => (c === "direct_reuse" || c === "refurbish_reuse" ? "reuse" : c === "further_assessment" || c === "insufficient_information" ? "review" : c === "recycling" ? "recycling" : "none");
const READY_RANK: Readonly<Record<Exclude<Elig, "all">, number>> = { reuse: 0, review: 1, none: 2, recycling: 3 };
const ROW = 44;
const COLS = "minmax(0, 1fr) 118px 92px 70px";

const Row = memo(function Row({ row, selected, a, taken, onSelect }: { row: InventoryRow; selected: boolean; a: RecoveryAssessment | undefined; taken: number; onSelect: (id: string) => void }) {
  const { rec } = row;
  const supply = supplyOf(row, a);
  const tone = eligOf(a?.classification) === "reuse" ? "strong" : eligOf(a?.classification) === "recycling" ? "bad" : eligOf(a?.classification) === "review" ? "cond" : "neutral";
  return (
    <div className="rx-row" style={{ gridTemplateColumns: COLS }} aria-selected={selected} data-testid="catalogue-row" data-id={rec.id} onClick={() => onSelect(rec.id)}>
      <div className="rx-cell-main">
        <div className="l1">
          <span className="rx-mono" title={rec.name}>{rec.id}</span>
        </div>
        <div className="l2" title={`${rec.name} · ${materialName(rec.materialId)}`}>
          {sizeLabel(rec)} · {materialName(rec.materialId)} · {FLOOR_LABEL[rec.floor] ?? rec.floor}{rec.apartmentId ? ` · ${rec.apartmentId}` : ""}
        </div>
      </div>
      <div>
        <Chip tone={tone}>{CLASSIFICATION_SHORT[a?.classification ?? "unassessed"]}</Chip>
        {a?.recoveryPct != null && <span className="rx-note"> {a.recoveryPct}%</span>}
      </div>
      <div className="rx-right" title={supply.note}>
        <span className="rx-qty">{fmtQtyU(supply.value, supply.unit)}</span>
        <div className="rx-note" style={{ fontSize: 10 }}>{supply.basis === "recoverable" ? "B2 estimate" : supply.basis === "upper_bound" ? "upper bound" : ""}</div>
      </div>
      <div className="rx-right">{taken > 0 ? <Chip tone="alloc" title={`${fmtQtyU(taken, supply.unit)} allocated to requirements`}>{fmtQty(taken, supply.unit)}</Chip> : <span className="rx-note">—</span>}</div>
    </div>
  );
});

export function Catalogue() {
  const { ctx, selectedId, onSelect } = useWorkspace();
  const rs = useReuse();
  const { inv, assessments } = ctx;
  const [text, setText] = useState("");
  const q = useDebounced(text, 200).trim().toLowerCase();
  const [substance, setSubstance] = useState("");
  const [form, setForm] = useState<Category | "">("");
  const [floor, setFloor] = useState<number | "">("");
  const [elig, setElig] = useState<Elig>("all");
  const [sort, setSort] = useState<"ready" | "id" | "supply">("ready");

  const substances = useMemo(() => substanceIndex(inv), [inv]);
  const reuseBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, a] of assessments) {
      if (eligOf(a.classification) !== "reuse") continue;
      const rec = inv.recordById.get(id);
      if (rec) m.set(substanceOf(rec.materialId), (m.get(substanceOf(rec.materialId)) ?? 0) + 1);
    }
    return m;
  }, [inv, assessments]);
  const readyCats = useMemo(() => [...reuseBy].sort((a, b) => b[1] - a[1]), [reuseBy]);
  const taken = useMemo(() => allocatedByComponent(rs.allocations), [rs.allocations]);

  const rows = useMemo(() => {
    const base = substance ? rowsOfSubstance(inv, substance) : inv.rows;
    const out = base.filter((r) => {
      if (form && r.q.category !== form) return false;
      if (floor !== "" && r.rec.floor !== floor) return false;
      if (elig !== "all" && eligOf(assessments.get(r.rec.id)?.classification) !== elig) return false;
      if (q && !r.rec.id.toLowerCase().includes(q) && !r.rec.name.toLowerCase().includes(q) && !materialName(r.rec.materialId).toLowerCase().includes(q)) return false;
      return true;
    });
    if (sort === "supply") {
      const key = new Map(out.map((r) => [r.rec.id, supplyOf(r, assessments.get(r.rec.id)).value ?? -1]));
      return [...out].sort((a, b) => key.get(b.rec.id)! - key.get(a.rec.id)! || (a.rec.id < b.rec.id ? -1 : 1));
    }
    if (sort === "ready") {
      // components assessed for reuse first, then those that need an assessment, then the rest; ids keep each group in a stable order
      const rank = (r: InventoryRow) => READY_RANK[eligOf(assessments.get(r.rec.id)?.classification)];
      const key = new Map(out.map((r) => [r.rec.id, rank(r)]));
      return [...out].sort((a, b) => key.get(a.rec.id)! - key.get(b.rec.id)! || (a.rec.id < b.rec.id ? -1 : 1));
    }
    return out;
  }, [inv, assessments, substance, form, floor, elig, q, sort]);

  const forms = useMemo<readonly Category[]>(() => (substance ? [...new Set(rowsOfSubstance(inv, substance).map((r) => r.q.category))] : CATEGORIES.filter((c) => inv.breakdowns.category.has(c))), [inv, substance]);
  const floors = useMemo(() => [...inv.breakdowns.floor.keys()].map(Number).sort((a, b) => a - b), [inv]);
  const filtered = !!(substance || form || floor !== "" || elig !== "all" || q);
  const row = leafRow(selectedId);
  const step = (to: "prev" | "next" | "first" | "last") => {
    if (rows.length === 0) return;
    const i = rows.findIndex((r) => r.rec.id === selectedId);
    const next = to === "first" ? 0 : to === "last" ? rows.length - 1 : to === "next" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    onSelect(rows[next]!.rec.id);
  };

  return (
    <div className="rx-pane" data-testid="catalogue">
      <div className="rx-summary" style={{ padding: "9px 14px 8px" }} data-testid="category-strip">
        {readyCats.length > 0 ? (
          <div className="rx-chips" style={{ marginTop: 0, alignItems: "center" }}>
            <span className="rx-cap" style={{ marginRight: 2 }}>Assessed for reuse</span>
            {readyCats.map(([sub, n]) => (
              <button key={sub} type="button" className="rx-tierbtn" style={{ height: 22, fontSize: 11 }} aria-pressed={substance === sub} data-substance={sub} onClick={() => (setSubstance(substance === sub ? "" : sub), setForm(""))} title="Show only this material category">
                {substanceLabel(sub)} <b>{n0(n)}</b>
              </button>
            ))}
          </div>
        ) : (
          <div className="rx-note" data-testid="no-reuse-hint">
            No component is assessed for reuse yet. Unassessed material still matches, but only as <b>conditional</b> and with its modelled quantity as an upper bound; assess components in <b>Recovery</b> (or from the detail below) to make matches strong.
          </div>
        )}
      </div>
      <div className="rx-toolbar">
        <input className="rx-field" style={{ width: 138 }} placeholder="Search id, name, material" data-testid="catalogue-search" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search components" />
        <select className="rx-select" style={{ width: 120 }} data-testid="catalogue-substance" value={substance} onChange={(e) => (setSubstance(e.target.value), setForm(""))} aria-label="Material category">
          <option value="">Any material</option>
          {substances.map((s) => <option key={s.substance} value={s.substance}>{s.label} ({n0(s.count)})</option>)}
        </select>
        <select className="rx-select" style={{ width: 106 }} data-testid="catalogue-form" value={form} onChange={(e) => setForm(e.target.value as Category | "")} aria-label="Component form">
          <option value="">Any form</option>
          {forms.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
        <select className="rx-select" style={{ width: 88 }} data-testid="catalogue-floor" value={floor} onChange={(e) => setFloor(e.target.value === "" ? "" : Number(e.target.value))} aria-label="Floor">
          <option value="">Any floor</option>
          {floors.map((f) => <option key={f} value={f}>{FLOOR_LABEL[f] ?? f}</option>)}
        </select>
        <select className="rx-select" style={{ width: 122 }} data-testid="catalogue-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="ready">Reuse-ready first</option>
          <option value="id">By id</option>
          <option value="supply">Largest supply</option>
        </select>
      </div>
      <div className="rx-toolbar" style={{ paddingTop: 0 }}>
        <Seg value={elig} onChange={setElig} testid="catalogue-elig" label="Recovery assessment" options={(Object.keys(ELIG_LABEL) as Elig[]).map((e) => ({ value: e, label: ELIG_LABEL[e], testid: `elig-${e}` }))} />
        <span style={{ marginLeft: "auto" }} className="rx-note" data-testid="catalogue-count">
          {n0(rows.length)} of {n0(inv.rows.length)} components
          {filtered && <> · <button type="button" className="rx-link" onClick={() => (setText(""), setSubstance(""), setForm(""), setFloor(""), setElig("all"))}>clear filters</button></>}
        </span>
      </div>
      <div className="rx-listhead" style={{ gridTemplateColumns: COLS, gap: 8 }}>
        <span>Component · material · size · location</span>
        <span>Recovery (B2)</span>
        <span className="rx-right">Available</span>
        <span className="rx-right">Allocated</span>
      </div>
      <VList
        testid="catalogue-list"
        items={rows}
        rowHeight={ROW}
        keyOf={(r) => r.rec.id}
        scrollToKey={selectedId}
        onStep={step}
        style={{ flex: "0 0 clamp(190px, 32vh, 320px)" }}
        empty={<div className="rx-empty"><h4>No component matches these filters</h4>Loosen a filter or clear the search.</div>}
        renderRow={(r) => <Row row={r} selected={r.rec.id === selectedId} a={assessments.get(r.rec.id)} taken={taken.get(r.rec.id) ?? 0} onSelect={onSelect} />}
      />
      <div className="rx-detail" data-testid="catalogue-detail">
        {!selectedId ? (
          <div className="rx-empty">
            <h4>Select a component</h4>
            Choose a row, or click a component in the 3D model, to see what it can supply, how reliable that is, and where it could be reused.
          </div>
        ) : (
          <>
            <div className="rx-verdict" style={{ alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3>{selectedId}</h3>
                <div className="sub">{row ? `${CATEGORY_LABELS[row.q.category]} · ${substanceLabel(substanceOf(row.rec.materialId))}` : "assembly"}</div>
              </div>
              {row && (
                <>
                  <button type="button" className="rx-btn" data-testid="catalogue-locate" onClick={() => locateInModel(selectedId, onSelect)} title="Select it, fold the workspace and frame the camera on it">
                    Locate in 3D
                  </button>
                  <button type="button" className="rx-btn accent" data-testid="requirement-from-component" onClick={() => reuseStore.beginNew(draftFromComponent(row, assessments.get(selectedId)))} title="Start a requirement for this kind of material (its category, form and unit)">
                    New requirement like this
                  </button>
                </>
              )}
            </div>
            <SourceFacts id={selectedId} />
            <Opportunities id={selectedId} />
          </>
        )}
      </div>
    </div>
  );
}
