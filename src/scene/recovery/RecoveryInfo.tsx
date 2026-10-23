/** Inspector block (B2): the selected component's recovery assessment at a glance, and a way into the drawer. */

import { getModelInventory } from "@/engine/quantities";
import { CLASSIFICATION_SHORT, evaluateRow, targetLeafIds } from "@/engine/recovery";
import { PALETTE } from "../inventory/ui";
import { Dot } from "./AssessmentEditor";
import { STATUS_COLOURS } from "./colors";
import { recoveryStore, useRecovery } from "./recoveryStore";

const link = { font: "inherit", color: PALETTE.accent, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" } as const;

export function RecoveryInfo({ id }: { id: string }) {
  const { assessments, basis } = useRecovery();
  const inv = getModelInventory();
  const rec = inv.recordById.get(id);
  if (!rec) return null;
  const open = (
    <button data-testid="open-recovery" onClick={() => recoveryStore.setOpen(true)} style={link}>
      {assessments.size ? "assess / edit" : "assess recovery"}
    </button>
  );
  if (rec.geometry.kind === "group") {
    const parts = targetLeafIds(inv, id);
    const done = parts.filter((p) => assessments.get(p)?.classification).length;
    return (
      <div data-testid="recovery-info" style={{ marginTop: 4 }}>
        <span style={{ opacity: 0.55 }}>recovery: </span>
        {done} of {parts.length} parts assessed · {open}
      </div>
    );
  }
  const row = { rec, q: inv.byId.get(id)! };
  const ev = evaluateRow(row, assessments.get(id), basis);
  return (
    <div data-testid="recovery-info" style={{ marginTop: 4 }}>
      <div>
        <span style={{ opacity: 0.55 }}>recovery: </span>
        <Dot colour={STATUS_COLOURS[ev.status]} />
        <span data-testid="recovery-info-status">{CLASSIFICATION_SHORT[ev.status]}</span> · {open}
      </div>
      {ev.recoverable !== null && (
        <div data-testid="recovery-info-formula" style={{ opacity: 0.8, fontSize: 11 }}>
          {ev.formula}
        </div>
      )}
    </div>
  );
}
