/**
 * Create / edit a reuse requirement (C2). Only real choices are offered: the material categories, forms, variants and units that
 * exist in the model. Sizes are typed in millimetres and stored in metres. Nothing is saved until the form validates.
 */

import { useMemo, useState } from "react";
import { CATEGORY_LABELS, getModelInventory, UNIT_LABEL, type Category, type Unit } from "@/engine/quantities";
import {
  ACCEPTANCE_LABELS,
  AXES,
  AXIS_LABELS,
  EMPTY_DRAFT,
  materialName,
  MAX_EXTRA_SPECS,
  MIN_CONDITIONS,
  MIN_CONDITION_LABELS,
  REQUIREMENT_UNITS,
  rowsOfSubstance,
  scopeInfo,
  substanceIndex,
  typeLabel,
  validateDraft,
  type Acceptance,
  type Axis,
  type DimRanges,
  type ScopeInfo,
  type ExtraSpec,
  type MinCondition,
  type RequirementDraft,
} from "@/engine/reuse";
import { reuseStore, useReuse } from "./reuseStore";
import { n0 } from "./ui";

const UNIT_NAMES = { m2: "Area (m²)", m3: "Volume (m³)", m: "Length (m)", nr: "Count (nr)", kg: "Mass (kg)" } as const;
const APPLICATIONS = ["Flooring", "Wall cladding", "Glazing", "Joinery / doors", "Kitchen / bathroom fit-out", "Paving / landscaping", "Furniture", "Fill / sub-base"];

const mm = (m: number | null): string => (m === null ? "" : String(Number((m * 1000).toFixed(3))));
const parseMm = (t: string): number | null | "bad" => {
  const s = t.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n / 1000 : "bad";
};

type Texts = Record<Axis, { min: string; max: string }>;
const textsOf = (d: DimRanges): Texts => Object.fromEntries(AXES.map((a) => [a, { min: mm(d[a].min), max: mm(d[a].max) }])) as Texts;

export function RequirementForm() {
  const rs = useReuse();
  const editing = rs.editing!;
  const existing = editing.id ? rs.requirements.find((r) => r.id === editing.id) : undefined;
  const start: RequirementDraft = existing ? { ...existing } : (editing.seed ?? EMPTY_DRAFT);
  const inv = useMemo(() => getModelInventory(), []);
  const substances = useMemo(() => substanceIndex(inv), [inv]);

  const [name, setName] = useState(start.name);
  const [application, setApplication] = useState(start.application);
  const [substance, setSubstance] = useState(start.substance);
  const [form, setForm] = useState<Category | null>(start.form);
  const [componentType, setComponentType] = useState<string | null>(start.componentType);
  const [materialId, setMaterialId] = useState<string | null>(start.materialId);
  const [quantity, setQuantity] = useState(String(start.quantity));
  const [unit, setUnit] = useState(start.unit);
  const [dims, setDims] = useState<Texts>(textsOf(start.dims));
  const [tol, setTol] = useState(String(start.toleranceMm));
  const [minCondition, setMinCondition] = useState<MinCondition>(start.minCondition);
  const [accept, setAccept] = useState<Acceptance>(start.accept);
  const [structural, setStructural] = useState(start.includeStructural);
  const [unassessed, setUnassessed] = useState(start.includeUnassessed);
  const [specs, setSpecs] = useState<ExtraSpec[]>([...start.extraSpecs]);
  const [note, setNote] = useState(start.note);
  const [error, setError] = useState<string | null>(null);

  const formScope = useMemo(() => (substance ? scopeInfo(inv, substance, form) : null), [inv, substance, form]);
  // sizes and units follow the narrowest choice made so far (material, form, type)
  const scope = useMemo(() => {
    if (!substance) return null;
    if (!componentType) return formScope;
    const rows = rowsOfSubstance(inv, substance).filter((r) => (!form || r.q.category === form) && r.rec.componentType === componentType);
    const units = new Map<string, number>();
    const mats = new Map<string, number>();
    let hasDiameter = false;
    for (const r of rows) {
      units.set(r.q.primary.unit, (units.get(r.q.primary.unit) ?? 0) + 1);
      mats.set(r.rec.materialId, (mats.get(r.rec.materialId) ?? 0) + 1);
      if (typeof r.rec.dimensions.diameter === "number") hasDiameter = true;
    }
    const desc = <K,>(m: Map<K, number>) => [...m].sort((a, b) => b[1] - a[1]);
    return { count: rows.length, forms: formScope!.forms, types: formScope!.types, materials: desc(mats).map(([id, count]) => ({ id, count })), units: desc(units).map(([unit, count]) => ({ unit: unit as Unit, count })), hasDiameter } satisfies ScopeInfo;
  }, [inv, substance, form, componentType, formScope]);
  const substanceScope = useMemo(() => (substance ? scopeInfo(inv, substance, null) : null), [inv, substance]);
  const unitHint = scope && scope.count > 0 ? scope.units.map((u) => `${UNIT_LABEL[u.unit]} (${n0(u.count)})`).join(", ") : null;
  const unitOk = !scope || scope.count === 0 || scope.units.some((u) => u.unit === unit);
  const lockedUnit = !!existing && rs.allocations.some((a) => a.requirementId === existing.id);

  const chooseSubstance = (s: string) => {
    setSubstance(s);
    setForm(null);
    setComponentType(null);
    setMaterialId(null);
    const info = scopeInfo(inv, s, null);
    const top = info.units.find((u) => (REQUIREMENT_UNITS as readonly string[]).includes(u.unit));
    if (top && !existing) setUnit(top.unit);
  };
  const chooseForm = (f: Category | null) => {
    setForm(f);
    setComponentType(null);
    setMaterialId(null);
    if (substance && !existing) {
      const top = scopeInfo(inv, substance, f).units.find((u) => (REQUIREMENT_UNITS as readonly string[]).includes(u.unit));
      if (top) setUnit(top.unit);
    }
  };
  const chooseType = (t: string | null) => {
    setComponentType(t);
    setMaterialId(null);
    if (substance && t && !existing) {
      const rows = rowsOfSubstance(inv, substance).filter((r) => (!form || r.q.category === form) && r.rec.componentType === t);
      const top = rows[0]?.q.primary.unit;
      if (top && (REQUIREMENT_UNITS as readonly string[]).includes(top)) setUnit(top);
    }
  };

  const build = (): RequirementDraft | string => {
    const ranges = {} as { -readonly [A in Axis]: { min: number | null; max: number | null } };
    for (const a of AXES) {
      const lo = parseMm(dims[a].min);
      const hi = parseMm(dims[a].max);
      if (lo === "bad" || hi === "bad") return `${AXIS_LABELS[a]}: enter a number of millimetres (0 or more), or leave it empty`;
      ranges[a] = { min: lo, max: hi };
    }
    const q = Number(quantity);
    const t = Number(tol);
    if (quantity.trim() === "" || !Number.isFinite(q)) return "Required quantity must be a number";
    if (tol.trim() === "" || !Number.isFinite(t)) return "Tolerance must be a number of millimetres";
    return {
      name,
      application,
      substance,
      form,
      componentType,
      materialId,
      quantity: q,
      unit,
      dims: ranges as DimRanges,
      toleranceMm: t,
      minCondition,
      accept,
      includeStructural: structural,
      includeUnassessed: unassessed,
      extraSpecs: specs.filter((s) => s.label.trim() !== "" || s.value.trim() !== ""),
      note,
    };
  };

  const save = () => {
    const d = build();
    if (typeof d === "string") return setError(d);
    const invalid = validateDraft(d);
    if (invalid) return setError(invalid);
    const r = existing ? reuseStore.edit(existing.id, d) : reuseStore.add(d).error;
    setError(r);
  };

  return (
    <div className="rx-form" data-testid="requirement-form">
      <h3>{existing ? "Edit requirement" : "New reuse requirement"}</h3>
      <p className="rx-note" style={{ marginBottom: 10 }}>
        State what the new project needs. Components are compared with this on the project's recorded data; anything the model does not hold stays unknown.
      </p>

      <div className="rx-grid c2">
        <label className="rx-lab">
          <span>Name</span>
          <input className="rx-field" data-testid="req-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Community hall flooring" autoFocus />
        </label>
        <label className="rx-lab">
          <span>Intended application</span>
          <input className="rx-field" data-testid="req-application" value={application} list="rx-apps" maxLength={160} onChange={(e) => setApplication(e.target.value)} placeholder="Where and how it will be used" />
          <datalist id="rx-apps">{APPLICATIONS.map((a) => <option key={a} value={a} />)}</datalist>
        </label>
      </div>

      <div className="rx-section">
        <header><h4>Material</h4><span className="rx-aside">only categories that exist in the model</span></header>
        <div className="rx-grid c2">
          <label className="rx-lab">
            <span>Material category</span>
            <select className="rx-select" data-testid="req-substance" value={substance} onChange={(e) => chooseSubstance(e.target.value)}>
              <option value="">Choose…</option>
              {substances.map((s) => (
                <option key={s.substance} value={s.substance}>
                  {s.label} ({n0(s.count)})
                </option>
              ))}
            </select>
          </label>
          <label className="rx-lab">
            <span>Component form</span>
            <select className="rx-select" data-testid="req-form" value={form ?? ""} disabled={!substanceScope} onChange={(e) => chooseForm((e.target.value || null) as Category | null)}>
              <option value="">Any form</option>
              {substanceScope?.forms.map((f) => (
                <option key={f.category} value={f.category}>
                  {CATEGORY_LABELS[f.category]} ({n0(f.count)})
                </option>
              ))}
            </select>
          </label>
          <label className="rx-lab">
            <span>Component type (as recorded in the model)</span>
            <select className="rx-select" data-testid="req-type" value={componentType ?? ""} disabled={!formScope} onChange={(e) => chooseType(e.target.value || null)}>
              <option value="">Any type</option>
              {formScope?.types.map((t) => (
                <option key={t.type} value={t.type}>
                  {typeLabel(t.type)} ({n0(t.count)})
                </option>
              ))}
            </select>
          </label>
          <label className="rx-lab">
            <span>Specific material / finish</span>
            <select className="rx-select" data-testid="req-material" value={materialId ?? ""} disabled={!scope} onChange={(e) => setMaterialId(e.target.value || null)}>
              <option value="">Any variant</option>
              {scope?.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {materialName(m.id)} ({n0(m.count)})
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="rx-section">
        <header><h4>Quantity</h4></header>
        <div className="rx-grid c3">
          <label className="rx-lab">
            <span>Required quantity</span>
            <input className="rx-field num" data-testid="req-quantity" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
          <label className="rx-lab">
            <span>Unit</span>
            <select className="rx-select" data-testid="req-unit" value={unit} disabled={lockedUnit} onChange={(e) => setUnit(e.target.value as typeof unit)} title={lockedUnit ? "The unit cannot change while the requirement has allocations" : undefined}>
              {REQUIREMENT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_NAMES[u]}
                </option>
              ))}
            </select>
          </label>
          <div className="rx-lab">
            <span>Measured in (in the model)</span>
            <div className={unitOk ? "rx-note" : "rx-warn"} data-testid="unit-hint" style={{ minHeight: 26, display: "flex", alignItems: "center" }}>
              {unitHint ?? "choose a material"}
              {!unitOk && ` — no component is measured in ${UNIT_LABEL[unit]}: nothing can match (units are never converted)`}
            </div>
          </div>
        </div>
      </div>

      <div className="rx-section">
        <header>
          <h4>Dimensions</h4>
          <span className="rx-aside">mm · empty = no limit · compared longest side first, so orientation does not matter</span>
        </header>
        <div className="rx-dims">
          <span />
          <span className="h">Minimum</span>
          <span className="h">Maximum</span>
          {AXES.filter((a) => a !== "diameter" || scope?.hasDiameter || dims.diameter.min !== "" || dims.diameter.max !== "").map((a) => (
            <DimRow key={a} axis={a} value={dims[a]} onChange={(v) => setDims({ ...dims, [a]: v })} />
          ))}
        </div>
        <div className="rx-inline" style={{ marginTop: 8 }}>
          <label className="rx-inline">
            <span className="rx-note">Tolerance ±</span>
            <input className="rx-field num" style={{ width: 60 }} data-testid="req-tolerance" inputMode="decimal" value={tol} onChange={(e) => setTol(e.target.value)} />
            <span className="rx-note">mm</span>
          </label>
        </div>
      </div>

      <div className="rx-section">
        <header><h4>Condition &amp; processing</h4></header>
        <div className="rx-grid c2">
          <label className="rx-lab">
            <span>Minimum observed condition (recorded in the C1 passport)</span>
            <select className="rx-select" data-testid="req-condition" value={minCondition} onChange={(e) => setMinCondition(e.target.value as MinCondition)}>
              {MIN_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {MIN_CONDITION_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <div className="rx-lab">
            <span>Accept if needed before use</span>
            <div className="rx-checks" style={{ minHeight: 26, alignItems: "center" }}>
              {(Object.keys(ACCEPTANCE_LABELS) as (keyof Acceptance)[]).map((k) => (
                <label key={k} className="rx-check">
                  <input type="checkbox" data-testid={`req-accept-${k}`} checked={accept[k]} onChange={(e) => setAccept({ ...accept, [k]: e.target.checked })} />
                  {ACCEPTANCE_LABELS[k]}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="rx-checks" style={{ marginTop: 8 }}>
          <label className="rx-check" title="Components without a B2 reuse assessment are shown as conditional matches; their quantity is the modelled upper bound">
            <input type="checkbox" data-testid="req-unassessed" checked={unassessed} onChange={(e) => setUnassessed(e.target.checked)} />
            Also consider components not yet assessed for reuse (conditional)
          </label>
          <label className="rx-check" title="Structural reuse needs drawings, testing and an engineer: such components are always conditional">
            <input type="checkbox" data-testid="req-structural" checked={structural} onChange={(e) => setStructural(e.target.checked)} />
            Consider structural elements
          </label>
        </div>
      </div>

      <div className="rx-section">
        <header>
          <h4>Other specifications</h4>
          <span className="rx-aside">grade, fire rating, certification … not in the model: listed, never verified here</span>
        </header>
        {specs.map((s, i) => (
          <div key={i} className="rx-inline" style={{ marginBottom: 5, display: "flex" }}>
            <input className="rx-field" style={{ width: 170 }} data-testid="spec-label" value={s.label} maxLength={60} placeholder="Specification" onChange={(e) => setSpecs(specs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className="rx-field" style={{ flex: 1 }} data-testid="spec-value" value={s.value} maxLength={160} placeholder="Required value" onChange={(e) => setSpecs(specs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <button type="button" className="rx-btn sm" aria-label="Remove specification" onClick={() => setSpecs(specs.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="rx-btn sm" data-testid="spec-add" disabled={specs.length >= MAX_EXTRA_SPECS} onClick={() => setSpecs([...specs, { label: "", value: "" }])}>
          + Add specification
        </button>
      </div>

      <div className="rx-section">
        <header><h4>Note</h4></header>
        <textarea className="rx-area" rows={2} data-testid="req-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </div>

      {error && (
        <div className="rx-error" data-testid="req-error" role="alert">
          {error}
        </div>
      )}
      <div className="rx-actions">
        <button type="button" className="rx-btn primary" data-testid="req-save" onClick={save}>
          {existing ? "Save changes" : "Create requirement"}
        </button>
        <button type="button" className="rx-btn" data-testid="req-cancel" onClick={() => reuseStore.endEdit()}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function DimRow({ axis, value, onChange }: { axis: Axis; value: { min: string; max: string }; onChange: (v: { min: string; max: string }) => void }) {
  return (
    <>
      <span>{AXIS_LABELS[axis]}</span>
      <input className="rx-field num" data-testid={`dim-${axis}-min`} inputMode="decimal" value={value.min} placeholder="no limit" onChange={(e) => onChange({ ...value, min: e.target.value })} />
      <input className="rx-field num" data-testid={`dim-${axis}-max`} inputMode="decimal" value={value.max} placeholder="no limit" onChange={(e) => onChange({ ...value, max: e.target.value })} />
    </>
  );
}
