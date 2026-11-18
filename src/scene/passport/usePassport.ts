/** Composes the passport of a component from the live stores (C1): B2 assessments, B3 plan, B4 scenarios, B5 carbon and the user's entries. */

import { useMemo } from "react";
import { buildPassport, type MissingPassport, type Passport, type RemovalStatus, type ScenarioOutcome } from "@/engine/passport";
import { componentCarbon } from "@/engine/carbon";
import { getModelInventory } from "@/engine/quantities";
import { evaluateLeaf, makeContext, MISSING_LABELS, type Scenario } from "@/engine/scenarios";
import { STATE_LABELS } from "@/engine/removal";
import { STATUS_LABELS as STAGE_LABELS } from "@/engine/tracking";
import { useCarbon } from "../carbon/carbonStore";
import { useRecovery } from "../recovery/recoveryStore";
import { analysisOf, useRemoval } from "../removal/removalStore";
import { useScenarios } from "../scenarios/scenarioStore";
import { useReuse } from "../reuse/reuseStore";
import { liveFn, summarize } from "@/engine/tracking";
import { trackingContext, useTracking } from "../tracking/trackingStore";
import { usePassports } from "./passportStore";

export function usePassport(id: string | null): Passport | MissingPassport | null {
  const recovery = useRecovery();
  const rm = useRemoval();
  const sc = useScenarios();
  const carbon = useCarbon();
  const ps = usePassports();
  const trk = useTracking();
  const reuse = useReuse();
  const plan = rm.plans.find((p) => p.id === rm.activeId);
  return useMemo(() => {
    if (!id) return null;
    const inv = getModelInventory();
    const rec = inv.recordById.get(id);
    const q = inv.byId.get(id);
    const isLeaf = !!rec && !!q && rec.geometry.kind !== "group";
    const row = isLeaf ? { rec: rec!, q: q! } : null;

    let removal: RemovalStatus | null = null;
    if (plan) {
      const a = analysisOf(plan);
      const idx = a.owner.get(id);
      const e = idx !== undefined ? a.entries[idx] : undefined;
      removal = { planName: plan.name, step: e ? e.index + 1 : null, steps: a.entries.length, state: e ? STATE_LABELS[e.state] : null, blocked: !!e?.blocked, viaAssembly: e && e.id !== id ? e.id : null };
    }
    const scenarios: ScenarioOutcome[] = [];
    if (row) {
      const compared = sc.compareIds.map((c) => sc.scenarios.find((s) => s.id === c)).filter((s): s is Scenario => s !== undefined);
      for (const s of compared) {
        const o = evaluateLeaf(makeContext(inv, recovery.assessments, s), row, "quantity");
        scenarios.push({ scenario: s.name, unit: o.unit, quantity: o.allocation?.quantity ?? null, outcome: o.allocation?.outcome ?? null, missing: o.decision.effective.missing ? MISSING_LABELS[o.decision.effective.missing] : null });
      }
    }
    // C3 recovery tracking and C2 reuse allocations of the component (read-only inputs)
    let tracking = null;
    let allocations: { requirement: string; quantity: number; unit: string; reused: number }[] = [];
    const record = trk.records[id];
    if (row) {
      const live = liveFn(trackingContext())(id);
      allocations = live.allocations.map((a) => ({ requirement: a.requirementName, quantity: a.quantity, unit: row.q.primary.unit, reused: 0 }));
      if (record) {
        const s = summarize(record, live);
        allocations = live.allocations.map((a) => ({ requirement: a.requirementName, quantity: a.quantity, unit: s.unit, reused: s.fulfilled.get(a.id) ?? 0 }));
        tracking = { stage: STAGE_LABELS[s.status], stageAt: s.statusAt, unit: s.unit, planned: s.planned, plannedBasis: s.plannedBasis, recovered: s.recovered, reused: s.reused, recycled: s.recycled, disposed: s.disposed, unrecovered: s.unrecovered, inHand: s.inHand, unaccounted: s.unaccounted, quality: s.quality, flags: s.flags.filter((f) => f.level !== "info").map((f) => f.text), events: s.events, lastRecordedAt: s.lastRecordedAt };
      }
    }
    return buildPassport({ id, inventory: inv, assessments: recovery.assessments, meta: ps.meta.get(id), removal, carbon: row ? componentCarbon(row, carbon.factors, carbon.assumptions) : null, scenarios, basis: recovery.basis, tracking, allocations });
  }, [id, recovery.assessments, recovery.basis, plan, rm.version, sc.compareIds, sc.scenarios, carbon.factors, carbon.assumptions, ps.meta, trk.records, reuse.allocations, reuse.requirements]);
}
