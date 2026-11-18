/**
 * Compact component card for presentation mode: just enough to name what was clicked, with the model's own honesty markers
 * (every A1-A3 record is an ASSUMED component and its quantity says whether it was calculated or estimated). Everything shown
 * is read from the registry and the B1 inventory; nothing is computed or edited here. "Details" opens the full inspector.
 */

import { registry } from "@/building/registry";
import { hasMaterial, materialById } from "@/building/materialLibrary";
import { STRUCTURAL_MATERIAL } from "@/building/structure";
import { CATEGORY_LABELS, formatValue, getModelInventory, UNIT_LABEL } from "@/engine/quantities";
import { StatusChip } from "../inventory/ui";

const FLOOR_NAMES: Record<number, string> = { [-1]: "Foundation", 0: "Ground", 1: "F01", 2: "F02", 3: "F03", 4: "F04", 5: "Roof" };

export function ComponentCard({ id, style, onDetails, onClose, detailsOpen }: { id: string; style: React.CSSProperties; onDetails: () => void; onClose: () => void; detailsOpen: boolean }) {
  const c = registry.getById(id);
  if (!c) return null;
  const material = hasMaterial(c.materialId) ? materialById(c.materialId).name : c.materialId === STRUCTURAL_MATERIAL.id ? STRUCTURAL_MATERIAL.name : c.materialId;
  const cq = getModelInventory().byId.get(id);
  const primary = cq && cq.primary.value !== null ? `${formatValue(cq.primary.value, cq.primary.unit)} ${UNIT_LABEL[cq.primary.unit]}` : null;
  return (
    <div data-testid="pm-component" className="pm-panel pm-comp" style={style}>
      <h4>{c.name}</h4>
      <div className="id">{c.id}</div>
      <div className="row">
        <span>{c.system}</span>
        <b>
          {c.componentType.replace(/_/g, " ")} · {FLOOR_NAMES[c.floor] ?? c.floor}
        </b>
      </div>
      <div className="row">
        <span>material</span>
        <b>
          {material} <span className={c.confidence === "measured" ? "pm-tag ok" : "pm-tag"}>{c.confidence}</span>
        </b>
      </div>
      {cq && primary && (
        <div className="row">
          <span>{CATEGORY_LABELS[cq.category].toLowerCase()}</span>
          <b>
            {primary} <StatusChip status={cq.primary.status} />
          </b>
        </div>
      )}
      <div className="actions">
        <button type="button" className="pm-btn outline" data-testid="pm-details" aria-pressed={detailsOpen} onClick={onDetails}>
          Details
        </button>
        <button type="button" className="pm-btn outline" data-testid="pm-clear" onClick={onClose}>
          Clear
        </button>
      </div>
    </div>
  );
}
