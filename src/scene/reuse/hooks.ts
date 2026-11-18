/** Derived data of the reuse workspace (C2): the matching context from the live stores, the active ranking and the ledger review. All memoised per input object. */

import { createContext, useContext, useMemo } from "react";
import { CATEGORY_LABELS, getModelInventory, type InventoryRow } from "@/engine/quantities";
import {
  AXES,
  AXIS_SHORT,
  demandRows,
  fmtMm,
  isSpecified,
  materialName,
  matchRequirement,
  MIN_CONDITION_LABELS,
  reconcile,
  reviewAllocations,
  substanceLabel,
  typeLabel,
  ACCEPTANCE_LABELS,
  type DemandRow,
  type MatchContext,
  type MatchResult,
  type Requirement,
  type Review,
} from "@/engine/reuse";
import { useRecovery } from "../recovery/recoveryStore";
import { usePassports } from "../passport/passportStore";
import { useReuse } from "./reuseStore";

export function useMatchCtx(): MatchContext {
  const { assessments } = useRecovery();
  const { meta } = usePassports();
  const { config } = useReuse();
  return useMemo(() => ({ inv: getModelInventory(), assessments, meta, config }), [assessments, meta, config]);
}

export interface Ledger {
  readonly reviews: readonly Review[];
  /** Allocation id -> review flags. */
  readonly flags: ReadonlyMap<string, Review["flags"]>;
  readonly demand: readonly DemandRow[];
  /** Broken invariants (empty when the books balance). */
  readonly problems: readonly string[];
}

export function useLedger(ctx: MatchContext): Ledger {
  const { requirements, allocations } = useReuse();
  return useMemo(() => {
    const reviews = reviewAllocations(ctx, requirements, allocations);
    return { reviews, flags: new Map(reviews.map((r) => [r.allocationId, r.flags])), demand: demandRows(requirements, allocations, reviews), problems: reconcile(ctx, requirements, allocations) };
  }, [ctx, requirements, allocations]);
}

export function useActiveResult(ctx: MatchContext, active: Requirement | undefined): MatchResult | null {
  return useMemo(() => (active ? matchRequirement(ctx, active) : null), [ctx, active]);
}

/** The workspace's shared inputs, so the views do not pass them down by hand. */
export interface Workspace {
  readonly ctx: MatchContext;
  readonly active: Requirement | undefined;
  readonly result: MatchResult | null;
  readonly ledger: Ledger;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly drawerWidth: number;
}
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace(): Workspace {
  const w = useContext(WorkspaceContext);
  if (!w) throw new Error("useWorkspace outside the reuse workspace");
  return w;
}

/** The leaf row of an id, or undefined for assemblies and unknown ids. */
export function leafRow(id: string | null): InventoryRow | undefined {
  if (!id) return undefined;
  const inv = getModelInventory();
  const rec = inv.recordById.get(id);
  const q = inv.byId.get(id);
  return rec && q && rec.geometry.kind !== "group" ? { rec, q } : undefined;
}

/** The requirement as short labelled facts, for the summary strip and the collapsed card. */
export function specChips(r: Requirement): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = [{ k: "Material", v: substanceLabel(r.substance) }];
  if (r.form) out.push({ k: "Form", v: CATEGORY_LABELS[r.form] });
  if (r.componentType) out.push({ k: "Type", v: typeLabel(r.componentType) });
  if (r.materialId) out.push({ k: "Variant", v: materialName(r.materialId) });
  for (const a of AXES) {
    const d = r.dims[a];
    if (!isSpecified(d)) continue;
    const range = d.min !== null && d.max !== null ? (d.min === d.max ? fmtMm(d.min) : `${fmtMm(d.min)} – ${fmtMm(d.max)}`) : d.min !== null ? `≥ ${fmtMm(d.min)}` : `≤ ${fmtMm(d.max!)}`;
    out.push({ k: AXIS_SHORT[a], v: range });
  }
  if (r.minCondition !== "any") out.push({ k: "Condition", v: MIN_CONDITION_LABELS[r.minCondition] });
  const accepted = (Object.keys(ACCEPTANCE_LABELS) as (keyof typeof ACCEPTANCE_LABELS)[]).filter((k) => r.accept[k]);
  if (accepted.length < 4) out.push({ k: "Accepts", v: accepted.length ? accepted.map((k) => ACCEPTANCE_LABELS[k].toLowerCase()).join(", ") : "no processing" });
  if (r.includeStructural) out.push({ k: "Structural", v: "considered" });
  if (!r.includeUnassessed) out.push({ k: "Source", v: "assessed for reuse only" });
  for (const s of r.extraSpecs) out.push({ k: s.label, v: s.value || "stated" });
  return out;
}
