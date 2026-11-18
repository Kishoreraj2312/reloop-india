/**
 * Compose a passport (C1). Pure: every number comes from an existing module that is passed in; nothing is calculated here except
 * counts of field statuses. Missing data stays missing, estimated data is labelled estimated, and the model's own placeholders
 * (`condition`, `recoveryRoute`, `confidence`) are shown as what they are: generated defaults, not observations.
 */

import { hasMaterial, materialById } from "@/building/materialLibrary";
import { STRUCTURAL_MATERIAL } from "@/building/structure";
import { assemblyRollup, CATEGORY_LABELS, FLOOR_LABEL, UNIT_LABEL, type Inventory, type QuantityResult, type Status } from "@/engine/quantities";
import { CLASSIFICATION_LABELS, DESTINATION_LABELS, evaluateRow, PREPARATION_LABELS, substanceOf, targetLeafIds, type Assessments, type Basis } from "@/engine/recovery";
import { categoryLabel } from "@/engine/scenarios";
import { REASON_LABELS, factorUnitLabel, type ComponentCarbon } from "@/engine/carbon";
import { INSPECTION_LABELS, OBSERVED_LABELS, SECTION_KEYS, type Field, type FieldStatus, type MissingPassport, type Passport, type PassportMeta, type RemovalStatus, type ReuseAllocationView, type ScenarioOutcome, type Section, type SectionKey, type SourceTag, type TrackingStatus } from "./types";

export interface PassportInput {
  readonly id: string;
  readonly inventory: Inventory;
  readonly assessments: Assessments;
  readonly meta: PassportMeta | undefined;
  /** B3: where the component stands in the active removal plan; null = there is no removal plan at all. */
  readonly removal: RemovalStatus | null;
  /** B5: the component's baseline carbon; null for assemblies. */
  readonly carbon: ComponentCarbon | null;
  /** B4: the component's outcome in each compared scenario. */
  readonly scenarios: readonly ScenarioOutcome[];
  /** C3: the component's recovery-tracking record; null / absent = not tracked. */
  readonly tracking?: TrackingStatus | null;
  /** C2: the component's reuse allocations. */
  readonly allocations?: readonly ReuseAllocationView[];
  readonly basis?: Basis;
}

const field = (key: string, label: string, value: Field["value"], status: FieldStatus, source: SourceTag, extra: { unit?: string; note?: string } = {}): Field => ({
  key,
  label,
  value,
  status: value === null ? "missing" : status,
  source,
  ...(extra.unit !== undefined ? { unit: extra.unit } : {}),
  ...(extra.note !== undefined ? { note: extra.note } : {}),
});
const missing = (key: string, label: string, source: SourceTag, note: string): Field => ({ key, label, value: null, status: "missing", source, note });

const b1Status = (s: Status): FieldStatus => (s === "calculated" ? "calculated" : s === "estimated" ? "estimated" : "missing");

function b1Field(key: string, label: string, r: QuantityResult): Field {
  if (r.value === null) return missing(key, label, "B1", r.issues[0]?.message ?? "not available");
  return field(key, label, r.value, b1Status(r.status), "B1", { unit: UNIT_LABEL[r.unit], note: r.method });
}

const materialName = (id: string): string | null => (hasMaterial(id) ? materialById(id).name : id === STRUCTURAL_MATERIAL.id ? STRUCTURAL_MATERIAL.name : null);

export function buildPassport(input: PassportInput): Passport | MissingPassport {
  const { id, inventory: inv } = input;
  const rec = inv.recordById.get(id);
  const q = inv.byId.get(id);
  if (!rec || !q) return { found: false, id, reason: "not a component of this model" };
  const isAssembly = rec.geometry.kind === "group";
  const basis = input.basis ?? "quantity";
  const cautions: string[] = ["Model values come from the generated A1–A3 model and are design assumptions, not site measurements."];
  const sections: Record<SectionKey, Field[]> = { identity: [], material: [], quantity: [], condition: [], recovery: [], removal: [], sustainability: [], provenance: [], tracking: [] };
  const conf = rec.confidence;

  // identity
  const I = sections.identity;
  I.push(field("name", "Name", rec.name, "recorded", "model"));
  I.push(field("id", "Component ID", rec.id, "recorded", "model"));
  I.push(field("type", "Type", `${rec.componentType}${rec.assemblyType ? ` (${rec.assemblyType})` : ""}`, "recorded", "model"));
  I.push(field("system", "System", rec.system, "recorded", "model"));
  I.push(field("floor", "Floor", FLOOR_LABEL[rec.floor] ?? String(rec.floor), "recorded", "model"));
  I.push(rec.apartmentId || rec.roomId ? field("location", "Location", [rec.apartmentId, rec.roomId].filter(Boolean).join(" · "), "recorded", "model") : missing("location", "Location (apartment / room)", "model", "the model records no apartment or room for this component"));
  if (rec.parentId) I.push(field("parent", isAssembly ? "Containing record" : "Parent", rec.parentId, "recorded", "model"));
  if (rec.networkId) I.push(field("network", "Network", rec.networkId, "recorded", "model"));
  if (rec.nominalSize) I.push(field("nominalSize", "Nominal size", rec.nominalSize, "recorded", "model"));

  // material
  const M = sections.material;
  const mn = materialName(rec.materialId);
  M.push(field("materialId", "Material ID", rec.materialId, "recorded", "model"));
  M.push(mn !== null ? field("materialName", "Material", mn, "recorded", "model", { note: `model confidence: ${conf}` }) : missing("materialName", "Material", "model", "the material id is not in the material library"));
  M.push(field("materialCategory", "Material category (B2)", categoryLabel(substanceOf(rec.materialId)), "recorded", "B2", { note: "the material's substance" }));
  M.push(field("componentCategory", "Component category (B1)", CATEGORY_LABELS[q.category], "calculated", "B1"));
  M.push(field("densityKgM3", "Density used for mass", q.mass.assumptions.find((a) => a.startsWith("density"))?.replace(/^density /, "") ?? null, "assumed", "B1", { note: "B1 density table (assumed values), applied to the modelled solid volume" }));

  // quantity
  const Q = sections.quantity;
  for (const [k, v] of Object.entries(rec.dimensions)) if (typeof v === "number") Q.push(field(`dim.${k}`, `Dimension: ${k}`, v, "recorded", "model", { unit: "m", note: `model confidence: ${conf}` }));
  if (isAssembly) {
    const roll = assemblyRollup(inv, id);
    Q.push(field("parts", "Parts", roll.leafCount, "calculated", "B1", { note: "drawn components this assembly stands for; each is counted once" }));
    for (const [unit, t] of Object.entries(roll.totals.totals)) {
      if (!t) continue;
      Q.push(t.value === null ? missing(`rollup.${unit}`, `Σ parts (${UNIT_LABEL[unit as keyof typeof UNIT_LABEL]})`, "B1", "no part has this measure") : field(`rollup.${unit}`, `Σ parts (${UNIT_LABEL[unit as keyof typeof UNIT_LABEL]})`, t.value, b1Status(t.status), "B1", { unit: UNIT_LABEL[unit as keyof typeof UNIT_LABEL], note: t.incompleteCount ? `${t.incompleteCount} parts have no value for this unit` : "sum of the parts only" }));
    }
  } else {
    Q.push(field("recordedQuantity", "Recorded quantity", rec.quantity, "recorded", "model", { unit: UNIT_LABEL[(rec.unit === "pcs" ? "nr" : rec.unit) as keyof typeof UNIT_LABEL] ?? rec.unit, note: "generator's own figure; B1 below is the source of truth" }));
    Q.push(b1Field("primary", "Quantity (B1)", q.primary));
    for (const s of q.secondary) Q.push(b1Field(`secondary.${s.unit}`, `Derived ${s.kind} (B1)`, s));
    Q.push(b1Field("mass", "Estimated mass (B1)", q.mass));
  }

  // condition & inspection
  const C = sections.condition;
  C.push(field("modelCondition", "Model condition", rec.condition, "assumed", "model", { note: "a default generated with the model, not an inspection" }));
  C.push(field("modelRoute", "Model recovery route", rec.recoveryRoute, "assumed", "model", { note: "a placeholder generated with the model; the recovery assessment (B2) is below" }));
  const m = input.meta;
  C.push(m?.inspectionStatus ? field("inspectionStatus", "Inspection status", INSPECTION_LABELS[m.inspectionStatus], "user", "user") : missing("inspectionStatus", "Inspection status", "user", "no inspection status recorded"));
  C.push(m?.observedCondition ? field("observedCondition", "Observed condition", OBSERVED_LABELS[m.observedCondition], "user", "user") : missing("observedCondition", "Observed condition", "user", "no condition has been observed and recorded"));
  C.push(m?.inspectedOn ? field("inspectedOn", "Inspected on", m.inspectedOn, "user", "user") : missing("inspectedOn", "Inspected on", "user", "no inspection date"));
  C.push(m?.inspectedBy ? field("inspectedBy", "Inspected by", m.inspectedBy, "user", "user") : missing("inspectedBy", "Inspected by", "user", "not recorded"));
  C.push(m?.conditionNote ? field("conditionNote", "Condition note", m.conditionNote, "user", "user") : missing("conditionNote", "Condition note", "user", "no note"));

  // recovery (B2)
  const R = sections.recovery;
  if (isAssembly) {
    const parts = targetLeafIds(inv, id);
    const done = parts.filter((p) => input.assessments.get(p)?.classification).length;
    R.push(field("assessedParts", "Parts assessed (B2)", `${done} of ${parts.length}`, "user", "B2", { note: "assessments are made on parts, not assemblies" }));
  } else {
    const a = input.assessments.get(id);
    const ev = evaluateRow({ rec, q }, a, basis);
    R.push(a?.classification ? field("classification", "Recovery assessment", CLASSIFICATION_LABELS[a.classification], "user", "B2", { note: "a planning category, not a judgement of condition, safety or suitability" }) : missing("classification", "Recovery assessment", "B2", "not assessed"));
    R.push(a?.recoveryPct != null ? field("recoveryPct", "Estimated recovery", a.recoveryPct, "estimated", "B2", { unit: "%", note: "the user's estimate, net of expected loss" }) : missing("recoveryPct", "Estimated recovery", "B2", a?.classification ? ev.notes[0] ?? "recovery % not set" : "not assessed"));
    R.push(ev.recoverable !== null ? field("recoverable", "Estimated recoverable quantity", ev.recoverable, "estimated", "B2", { unit: UNIT_LABEL[ev.available.unit], note: ev.formula }) : missing("recoverable", "Estimated recoverable quantity", "B2", ev.notes[0] ?? "not available"));
    R.push(a?.preparation ? field("preparation", "Preparation", PREPARATION_LABELS[a.preparation], "user", "B2") : missing("preparation", "Preparation", "B2", "not stated"));
    R.push(a?.destination ? field("destination", "Intended destination", DESTINATION_LABELS[a.destination], "user", "B2") : missing("destination", "Intended destination", "B2", "not decided"));
    if (a?.lossNote) R.push(field("lossNote", "Expected loss or damage (note)", a.lossNote, "user", "B2", { note: "informational: not applied to any quantity" }));
    if (a?.note) R.push(field("b2note", "Assessment note", a.note, "user", "B2"));
  }

  // removal (B3)
  const V = sections.removal;
  const rm = input.removal;
  if (!rm) V.push(missing("plan", "Removal plan", "B3", "there is no removal plan"));
  else if (rm.step === null) V.push(field("plan", "Removal plan", rm.planName, "recorded", "B3", { note: "this component is not an entry of the plan" }), missing("step", "Step", "B3", "not planned"));
  else {
    V.push(field("plan", "Removal plan", rm.planName, "recorded", "B3"));
    V.push(field("step", "Step", `${rm.step} of ${rm.steps}${rm.viaAssembly ? ` (via assembly ${rm.viaAssembly})` : ""}`, "recorded", "B3"));
    V.push(field("state", "Planning state", rm.state, "calculated", "B3", { note: "a planned or simulated state: it does not show that anything has been removed" }));
    V.push(field("blocked", "Blocked", rm.blocked ? "yes: a hard error is attached to the step" : "no", "calculated", "B3"));
  }

  // sustainability (B4 outcomes, B5 carbon)
  const S = sections.sustainability;
  if (!isAssembly) {
    const c = input.carbon;
    if (!c) S.push(missing("carbon", "Embodied carbon (baseline)", "B5", "not evaluated"));
    else if (c.kgCO2e !== null) S.push(field("carbon", "Embodied carbon (baseline)", c.kgCO2e, "estimated", "B5", { unit: "kgCO₂e", note: `${c.qty} ${UNIT_LABEL[c.basis!]} × ${c.factor!.value} ${factorUnitLabel(c.basis!)} · ${c.factor!.origin === "illustrative" ? "ILLUSTRATIVE factor, not data" : `${c.factor!.origin} factor`}${c.factor!.boundary ? ` · ${c.factor!.boundary}` : ""}` }));
    else S.push(missing("carbon", "Embodied carbon (baseline)", "B5", `not assessed: ${c.reason ? REASON_LABELS[c.reason] : "unknown"}`));
    if (c?.factor?.origin === "illustrative" && c.kgCO2e !== null) cautions.push("The carbon figure uses an ILLUSTRATIVE placeholder factor: it demonstrates the method and is not data.");
    for (const s of input.scenarios) {
      const label = `Scenario: ${s.scenario}`;
      if (!s.outcome || s.quantity === null) {
        S.push(missing(`scenario.${s.scenario}`, label, "B4", "no quantity to allocate"));
        continue;
      }
      const parts = (["direct_reuse", "refurbish_reuse", "recycling", "disposal", "unknown"] as const).filter((p) => s.outcome![p] > 0).map((p) => `${p.replace("_", " ")} ${Number(s.outcome![p].toPrecision(6))}`);
      S.push(field(`scenario.${s.scenario}`, label, parts.join(" · ") || "nothing allocated", "estimated", "B4", { unit: UNIT_LABEL[s.unit], note: s.missing ?? "B4 allocation of the B1 quantity under the scenario's rules" }));
    }
  } else S.push(missing("carbon", "Embodied carbon (baseline)", "B5", "assessed per part"));

  // provenance
  const P = sections.provenance;
  P.push(m?.provenanceNote ? field("provenanceNote", "Provenance note", m.provenanceNote, "user", "user") : missing("provenanceNote", "Provenance note", "user", "no provenance recorded (origin, supplier, installation, documents)"));
  P.push(field("confidence", "Model confidence", conf, "assumed", "model", { note: "how the model's values were derived" }));
  P.push(m?.updatedAt ? field("updatedAt", "Passport last edited", m.updatedAt, "user", "user") : missing("updatedAt", "Passport last edited", "user", "no user entries"));

  // recovery tracking (C3) and reuse allocation (C2): read-only here; recorded in the tracking and reuse workspaces
  const T = sections.tracking;
  const trk = input.tracking ?? null;
  const allocs = input.allocations ?? [];
  if (isAssembly) T.push(missing("tracking", "Recovery tracking", "C3", "tracked per part"));
  else {
    if (allocs.length === 0) T.push(missing("allocation", "Reuse allocation", "C2", "no C2 allocation"));
    else for (const [i, a] of allocs.entries()) T.push(field(`allocation.${i}`, `Reuse allocation: ${a.requirement}`, a.quantity, "recorded", "C2", { unit: a.unit, note: `reused against it (C3): ${a.reused} ${a.unit}` }));
    if (!trk) T.push(missing("stage", "Recovery stage", "C3", "not tracked: nothing has been recorded about its recovery"));
    else {
      const q = (v: number | null, key: string, label: string, kind: "actual" | "plan") => {
        if (v === null) return missing(key, label, "C3", kind === "plan" ? "no planned quantity" : "not recorded (unknown, not zero)");
        const status: FieldStatus = kind === "plan" ? (trk.plannedBasis === "user" ? "user" : "estimated") : trk.quality === "measured" || trk.quality === null ? "user" : trk.quality;
        return field(key, label, v, status, kind === "plan" && trk.plannedBasis === "b2_estimate" ? "B2" : "C3", { unit: trk.unit, note: kind === "plan" ? (trk.plannedBasis === "b2_estimate" ? "B2 estimate at the start of tracking" : "stated by the user") : `source: ${trk.quality ?? "n/a"}` });
      };
      T.push(field("stage", "Recovery stage", trk.stage, "user", "C3", { note: `since ${trk.stageAt.slice(0, 10)} · ${trk.events} history entries · last recorded ${trk.lastRecordedAt.slice(0, 10)}` }));
      T.push(q(trk.planned, "planned", "Planned recovery", "plan"));
      T.push(q(trk.recovered, "recovered", "Recovered (actual)", "actual"));
      T.push(q(trk.reused, "reused", "Reused (actual)", "actual"));
      T.push(q(trk.recycled, "recycled", "Recycled (actual)", "actual"));
      T.push(q(trk.disposed, "disposed", "Disposed (actual)", "actual"));
      T.push(q(trk.unrecovered, "unrecovered", "Not recovered (actual)", "actual"));
      T.push(trk.unaccounted === null ? missing("unaccounted", "Unaccounted", "C3", "not available") : field("unaccounted", "Unaccounted", trk.unaccounted, "calculated", "C3", { unit: trk.unit, note: "available quantity minus outcomes and write-offs" }));
      if (trk.flags.length) T.push(field("attention", "Needs attention", trk.flags.join(" · "), "calculated", "C3"));
    }
  }

  const titles: Record<SectionKey, string> = { identity: "Identity & location", material: "Material", quantity: "Dimensions & quantity", condition: "Condition & inspection", recovery: "Recovery potential (B2)", removal: "Removal status (B3)", sustainability: "Sustainability (B4, B5)", provenance: "Provenance", tracking: "Recovery tracking (C3)" };
  const out: Section[] = SECTION_KEYS.map((k) => ({ key: k, title: titles[k], fields: sections[k] }));
  const counts: Record<FieldStatus, number> = { recorded: 0, calculated: 0, estimated: 0, assumed: 0, user: 0, missing: 0 };
  for (const s of out) for (const f of s.fields) counts[f.status]++;
  return { found: true, id, kind: isAssembly ? "assembly" : "component", name: rec.name, sections: out, counts, cautions };
}

export const fieldOf = (p: Passport, section: SectionKey, key: string): Field | undefined => p.sections.find((s) => s.key === section)?.fields.find((f) => f.key === key);
