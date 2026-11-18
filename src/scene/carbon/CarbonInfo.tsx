/** Inspector line (B5): the selected component's baseline embodied carbon (or why it is not assessed), and a way into the workspace. */

import { componentCarbon, factorUnitLabel, REASON_LABELS } from "@/engine/carbon";
import { formatValue, getModelInventory, UNIT_LABEL } from "@/engine/quantities";
import { PALETTE } from "../inventory/ui";
import { linkBtn } from "../removal/ui";
import { carbonStore, useCarbon } from "./carbonStore";
import { fmtCarbon } from "./format";

export function CarbonInfo({ id }: { id: string }) {
  const cs = useCarbon();
  const inv = getModelInventory();
  const rec = inv.recordById.get(id);
  if (!rec) return null;
  const link = (
    <button data-testid="open-carbon" onClick={() => carbonStore.setOpen(true)} style={linkBtn}>
      carbon
    </button>
  );
  if (rec.geometry.kind === "group") {
    return (
      <div data-testid="carbon-info" style={{ marginTop: 4 }}>
        <span style={{ opacity: 0.55 }}>carbon: </span>assessed per part · {link}
      </div>
    );
  }
  const c = componentCarbon({ rec, q: inv.byId.get(id)! }, cs.factors, cs.assumptions);
  return (
    <div data-testid="carbon-info" style={{ marginTop: 4 }}>
      <span style={{ opacity: 0.55 }}>carbon: </span>
      {c.kgCO2e !== null ? (
        <span data-testid="carbon-info-value">
          {fmtCarbon(c.kgCO2e)}
          <div style={{ fontSize: 11, opacity: 0.8 }}>
            {formatValue(c.qty, c.basis!)} {UNIT_LABEL[c.basis!]} × {c.factor!.value} {factorUnitLabel(c.basis!)} · {c.factor!.origin === "illustrative" ? "ILLUSTRATIVE factor" : `${c.factor!.origin} factor`}
            {c.factor!.boundary ? ` · ${c.factor!.boundary}` : ""}
          </div>
        </span>
      ) : (
        <span data-testid="carbon-info-value" style={{ color: PALETTE.muted }}>
          not assessed: {REASON_LABELS[c.reason!]}
        </span>
      )}{" "}
      · {link}
    </div>
  );
}
