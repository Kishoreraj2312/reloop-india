/**
 * The source component (C2): the real component behind a candidate, with where each fact comes from. Everything is read from the
 * existing modules (model record, B1 quantity, B2 assessment, C1 passport, B3 plan, B5 carbon via the composed passport); the only
 * writes are the user's own B2 assessment and C1 observed condition, made through those modules' own editors.
 */

import { useMemo } from "react";
import { CATEGORY_LABELS, FLOOR_LABEL } from "@/engine/quantities";
import { CLASSIFICATION_LABELS, PREPARATION_LABELS, substanceOf } from "@/engine/recovery";
import { OBSERVED_CONDITIONS, OBSERVED_LABELS, fieldOf, type ObservedCondition } from "@/engine/passport";
import { allocatedByComponent, axisValue, fmtMm, fmtQtyU, materialName, opportunities, substanceLabel, supplyOf, type Requirement } from "@/engine/reuse";
import { fmtCarbon } from "../carbon/format";
import { LeafEditor } from "../recovery/AssessmentEditor";
import { usePassport } from "../passport/usePassport";
import { passportStore, usePassports } from "../passport/passportStore";
import { useRecovery } from "../recovery/recoveryStore";
import { leafRow, useWorkspace } from "./hooks";
import { reuseStore, useReuse } from "./reuseStore";
import { Chip, Mono, Section, TierChip } from "./ui";

/** Where a passport field's value comes from, as a short chip. */
const STATUS_TONE = { recorded: "neutral", calculated: "strong", estimated: "cond", assumed: "cond", user: "alloc", missing: "neutral" } as const;

export function SourceFacts({ id }: { id: string }) {
  const rs = useReuse();
  const row = leafRow(id);
  const { assessments } = useRecovery();
  const { meta } = usePassports();
  const passport = usePassport(row ? id : null);
  if (!row) {
    return (
      <Section title="Source component">
        <div className="rx-note" data-testid="source-assembly">
          {id} is an assembly. Reuse is planned on its parts: select a drawn component (a tile, a door leaf, a fixture) in the model or the list.
        </div>
      </Section>
    );
  }
  const { rec, q } = row;
  const a = assessments.get(id);
  const supply = supplyOf(row, a);
  const observed = meta.get(id)?.observedCondition ?? null;
  const taken = allocatedByComponent(rs.allocations).get(id) ?? 0;
  const mine = rs.allocations.filter((x) => x.componentId === id);
  const sizes = (["length", "width", "thickness"] as const).map((k) => axisValue(rec, k));
  const sizeText = sizes.every((s) => s === null) ? "not recorded" : sizes.map((s) => (s === null ? "—" : fmtMm(s))).join(" × ");
  const removal = passport?.found ? fieldOf(passport, "removal", "step") : undefined;
  const removalState = passport?.found ? fieldOf(passport, "removal", "state") : undefined;
  const carbon = passport?.found ? fieldOf(passport, "sustainability", "carbon") : undefined;
  const scenarios = passport?.found ? (passport.sections.find((x) => x.key === "sustainability")?.fields ?? []).filter((f) => f.key.startsWith("scenario.")) : [];
  const loc = [FLOOR_LABEL[rec.floor] ? `Floor ${FLOOR_LABEL[rec.floor]}` : `Floor ${rec.floor}`, rec.apartmentId, rec.roomId].filter(Boolean).join(" · ");

  return (
    <Section title="Source component" aside={<span>read from the model, B1, B2 and the C1 passport</span>} testid="source-facts">
      <dl className="rx-kv">
        <dt>Component</dt>
        <dd>
          <Mono>{rec.id}</Mono>
          <div className="rx-note">{rec.name}</div>
        </dd>
        <dt>Material</dt>
        <dd>
          {substanceLabel(substanceOf(rec.materialId))} · {materialName(rec.materialId)} <Chip title="the model's material library (A2 / A3), design assumptions">model</Chip>
        </dd>
        <dt>Form</dt>
        <dd>{CATEGORY_LABELS[q.category]}{rec.system === "structure" && <> <Chip tone="cond" title="structural reuse needs a qualified assessment">structural element</Chip></>}</dd>
        <dt>Location</dt>
        <dd>{loc}</dd>
        <dt>Size (recorded)</dt>
        <dd data-testid="source-size">
          {sizeText} <span className="rx-note">longest × middle × shortest · generated model values, not site measurements</span>
        </dd>
        <dt>Quantity (B1)</dt>
        <dd>
          {fmtQtyU(q.primary.value, q.primary.unit)} <Chip tone={q.primary.status === "calculated" ? "strong" : "cond"} title={q.primary.method}>{q.primary.status}</Chip>
        </dd>
        <dt>Available for reuse</dt>
        <dd data-testid="source-supply">
          <b>{fmtQtyU(supply.value, supply.unit)}</b>{" "}
          <Chip tone={supply.basis === "recoverable" ? "strong" : "cond"} title={supply.note}>{supply.basis === "recoverable" ? "B2 estimate" : supply.basis === "upper_bound" ? "upper bound" : "none"}</Chip>
          <div className="rx-note">{supply.note}</div>
        </dd>
        <dt>Recovery (B2)</dt>
        <dd data-testid="source-recovery">
          {a?.classification ? CLASSIFICATION_LABELS[a.classification] : <span className="rx-note">not assessed</span>}
          {a?.recoveryPct != null && <> · {a.recoveryPct} % recovery</>}
          {a?.preparation && <> · preparation: {PREPARATION_LABELS[a.preparation].toLowerCase()}</>}
        </dd>
        <dt>Condition (C1)</dt>
        <dd data-testid="source-condition">
          {observed ? OBSERVED_LABELS[observed] : <span className="rx-note">no observation recorded</span>}{" "}
          <select className="rx-select" style={{ height: 22, marginLeft: 4 }} data-testid="source-observed" value={observed ?? ""} onChange={(e) => passportStore.edit(id, { observedCondition: (e.target.value || null) as ObservedCondition | null })} aria-label="Observed condition">
            <option value="">Not recorded</option>
            {OBSERVED_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {OBSERVED_LABELS[c]}
              </option>
            ))}
          </select>
          <div className="rx-note">The model's own "{rec.condition}" is a generated default, not an inspection. Your observation is saved in the passport.</div>
        </dd>
        <dt>Removal (B3)</dt>
        <dd data-testid="source-removal">
          {removal && removal.value !== null ? (
            <>
              step {String(removal.value)} {removalState?.value ? <>· {String(removalState.value)}</> : null} <span className="rx-note">a plan entry, not evidence of removal</span>
            </>
          ) : (
            <span className="rx-note">{removal?.note ?? "not in a removal plan"}</span>
          )}
        </dd>
        <dt>Carbon (B5)</dt>
        <dd data-testid="source-carbon">
          {carbon && carbon.value !== null ? (
            <>
              {fmtCarbon(Number(carbon.value))} <Chip tone={STATUS_TONE[carbon.status]} title={carbon.note}>{carbon.status}</Chip>
              <div className="rx-note">Embodied carbon of the existing component as B5 assesses it. It is not a saving: avoided impact needs B5's replacement assumptions.</div>
            </>
          ) : (
            <span className="rx-note">not assessed in B5{carbon?.note ? `: ${carbon.note}` : ""}</span>
          )}
        </dd>
        <dt>Scenarios (B4)</dt>
        <dd data-testid="source-scenarios">
          {scenarios.length === 0 ? (
            <span className="rx-note">no scenario is being compared</span>
          ) : (
            scenarios.map((f) => (
              <div key={f.key}>
                {f.label.replace(/^Scenario: /, "")}: {f.value === null ? <span className="rx-note">{f.note ?? "no quantity"}</span> : <>{String(f.value)}{f.unit ? ` ${f.unit}` : ""} <Chip tone="cond" title={f.note}>{f.status}</Chip></>}
              </div>
            ))
          )}
        </dd>
        <dt>Allocated</dt>
        <dd data-testid="source-allocated">
          {mine.length === 0 ? (
            <span className="rx-note">not allocated</span>
          ) : (
            <>
              {fmtQtyU(taken, supply.unit)} of {fmtQtyU(supply.value, supply.unit)}
              {mine.map((m) => (
                <div key={m.id} className="rx-note">
                  → {rs.requirements.find((r) => r.id === m.requirementId)?.name ?? m.requirementId}: {fmtQtyU(m.quantity, m.unit)}
                </div>
              ))}
            </>
          )}
        </dd>
      </dl>
      <details className="rx-details" style={{ marginTop: 8 }} data-testid="source-assess">
        <summary>Edit the recovery assessment (B2) for this component</summary>
        <div style={{ marginTop: 6 }}>
          <LeafEditor row={row} />
        </div>
      </details>
    </Section>
  );
}

/** How this component fares against each requirement: a way in from "I have this component" to "where could it go?". */
export function Opportunities({ id }: { id: string }) {
  const { ctx, active } = useWorkspace();
  const rs = useReuse();
  const row = leafRow(id);
  const list = useMemo(() => (row ? opportunities(ctx, rs.requirements, row) : []), [ctx, rs.requirements, row]);
  if (!row) return null;
  return (
    <Section title="Reuse opportunities" aside={<span>this component against each requirement</span>} testid="opportunities">
      {rs.requirements.length === 0 ? (
        <div className="rx-note">No requirements yet: create one to see where this component could be used.</div>
      ) : (
        <div className="rx-card">
          {list.map(({ requirement, candidate }) => (
            <OpportunityRow key={requirement.id} requirement={requirement} candidate={candidate} current={requirement.id === active?.id} />
          ))}
        </div>
      )}
    </Section>
  );
}

function OpportunityRow({ requirement, candidate, current }: { requirement: Requirement; candidate: ReturnType<typeof opportunities>[number]["candidate"]; current: boolean }) {
  const why = candidate.blockers[0] ?? candidate.conditions[0] ?? candidate.missing[0];
  return (
    <div className="rx-arow" style={{ gridTemplateColumns: "92px minmax(0,1fr) 44px auto", padding: "6px 10px" }} data-testid="opportunity" data-requirement={requirement.id} data-tier={candidate.tier}>
      <TierChip tier={candidate.tier} compact />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{requirement.name}</div>
        <div className="rx-note" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={why?.text}>
          {why ? why.text : "Meets every stated criterion"}
        </div>
      </div>
      <div className="rx-right"><b>{candidate.score === null ? "—" : candidate.score.toFixed(0)}</b></div>
      <button type="button" className="rx-btn sm" data-testid="opportunity-compare" onClick={() => (reuseStore.select(requirement.id), reuseStore.setTab("matches"))}>
        {current ? "Compare" : "Open"}
      </button>
    </div>
  );
}
