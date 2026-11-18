/** Inspector line (B4): where the selected component ends up in each compared scenario, and a way into the workspace. */

import { formatValue, getModelInventory, UNIT_LABEL } from "@/engine/quantities";
import { evaluateLeaf, makeContext, OUTCOME_ORDER, PATHWAY_SHORT, type Scenario } from "@/engine/scenarios";
import { PALETTE } from "../inventory/ui";
import { useRecovery } from "../recovery/recoveryStore";
import { linkBtn } from "../removal/ui";
import { carbonStore } from "../carbon/carbonStore";
import { scenarioStore, useScenarios } from "./scenarioStore";

export function ScenarioInfo({ id }: { id: string }) {
  const sc = useScenarios();
  const { assessments } = useRecovery();
  const inv = getModelInventory();
  const rec = inv.recordById.get(id);
  if (!rec) return null;
  const compared = sc.compareIds.map((c) => sc.scenarios.find((s) => s.id === c)).filter((s): s is Scenario => s !== undefined);
  const open = (
    <button data-testid="open-scenarios" onClick={() => (carbonStore.setOpen(false), scenarioStore.setOpen(true))} style={linkBtn}>
      {sc.scenarios.length ? "compare scenarios" : "create scenarios"}
    </button>
  );
  // Only while the workspace is open, so the inspector costs nothing otherwise.
  const row = rec.geometry.kind === "group" ? undefined : { rec, q: inv.byId.get(id)! };
  return (
    <div data-testid="scenario-info" style={{ marginTop: 4 }}>
      <span style={{ opacity: 0.55 }}>scenarios: </span>
      {sc.open && row && compared.length > 0 ? (
        <div style={{ fontSize: 11 }}>
          {compared.map((s) => {
            const o = evaluateLeaf(makeContext(inv, assessments, s), row, sc.basis);
            const a = o.allocation;
            return (
              <div key={s.id} data-scenario={s.id}>
                {s.name}:{" "}
                {a ? (
                  OUTCOME_ORDER.filter((p) => a.outcome[p] > 0)
                    .map((p) => `${PATHWAY_SHORT[p].toLowerCase()} ${formatValue(a.outcome[p], o.unit)} ${UNIT_LABEL[o.unit]}`)
                    .join(", ") || "nothing to allocate"
                ) : (
                  <span style={{ color: PALETTE.muted }}>no quantity</span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      {open}
    </div>
  );
}
