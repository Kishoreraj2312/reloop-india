/**
 * Reuse plan export (C2): the requirements, the confirmed allocations and what the review says about them, as JSON (structured) and
 * CSV (one row per allocation). Pure; the timestamp is injected. The `outcome` of every allocation is "planned" with the recovered
 * and reused quantities null ("not recorded"): this is the hand-off to C3 Recovery Tracking, which records what was actually
 * recovered and reused against the allocation id. Nothing here is an assertion that any material was recovered or reused.
 */

import { csvField, UNIT_LABEL, type Inventory } from "@/engine/quantities";
import { substanceOf } from "@/engine/recovery";
import { demandRows } from "./ledger";
import { materialName } from "./source";
import { REVIEW_LABELS, type Allocation, type Requirement, type Review } from "./types";

export const SCHEMA = "rematter.reuse-plan/1";
const DISCLAIMER = "Preliminary reuse plan from the RE:MATTER model and the user's assessments. A match compares recorded data with a stated requirement; it is not an assessment of structural suitability, code compliance, certification or fitness for purpose. Quantities are planning estimates.";

const exact = (v: number): number => Number(v.toPrecision(12));

export interface PlanInput {
  readonly requirements: readonly Requirement[];
  readonly allocations: readonly Allocation[];
  readonly reviews: readonly Review[];
  readonly inventory: Inventory;
}

export function planToJson(p: PlanInput, exportedAt: string): string {
  const flags = new Map(p.reviews.map((r) => [r.allocationId, r.flags]));
  const demand = demandRows(p.requirements, p.allocations, p.reviews);
  return JSON.stringify(
    {
      schema: SCHEMA,
      tool: "RE:MATTER",
      exportedAt,
      disclaimer: DISCLAIMER,
      requirements: demand.map((d) => ({
        id: d.requirement.id,
        name: d.requirement.name,
        application: d.requirement.application,
        materialCategory: d.requirement.substance,
        componentForm: d.requirement.form,
        materialId: d.requirement.materialId,
        unit: d.requirement.unit,
        required: exact(d.required),
        allocated: exact(d.allocated),
        remaining: exact(d.remaining),
        status: d.status,
        dimensionsM: d.requirement.dims,
        toleranceMm: d.requirement.toleranceMm,
        minimumObservedCondition: d.requirement.minCondition,
        otherSpecifications: d.requirement.extraSpecs,
      })),
      allocations: p.allocations.map((a) => {
        const rec = p.inventory.recordById.get(a.componentId);
        return {
          id: a.id,
          requirementId: a.requirementId,
          componentId: a.componentId,
          componentName: rec?.name ?? null,
          materialId: rec?.materialId ?? null,
          quantity: exact(a.quantity),
          unit: a.unit,
          matchAtConfirmation: a.basis,
          reviewFlags: (flags.get(a.id) ?? []).map((f) => ({ code: f.code, text: f.text })),
          confirmedAt: a.createdAt,
          updatedAt: a.updatedAt,
          outcome: { status: "planned", recoveredQuantity: null, reusedQuantity: null, note: "not recorded: filled by C3 Recovery Tracking" },
        };
      }),
    },
    null,
    2,
  );
}

export const CSV_HEADER = ["requirement", "application", "component_id", "component_name", "material_category", "material", "quantity", "unit", "tier_at_confirmation", "score", "supply_basis", "conditions", "review_flags", "confirmed_at"] as const;

export function planToCsv(p: PlanInput): string {
  const req = new Map(p.requirements.map((r) => [r.id, r]));
  const flags = new Map(p.reviews.map((r) => [r.allocationId, r.flags]));
  const rows: string[] = [CSV_HEADER.join(",")];
  for (const a of p.allocations) {
    const r = req.get(a.requirementId);
    const rec = p.inventory.recordById.get(a.componentId);
    rows.push(
      [
        r?.name ?? a.requirementId,
        r?.application ?? "",
        a.componentId,
        rec?.name ?? "",
        rec ? substanceOf(rec.materialId) : "",
        rec ? materialName(rec.materialId) : "",
        String(exact(a.quantity)),
        UNIT_LABEL[a.unit],
        a.basis.tier,
        a.basis.score === null ? "" : String(a.basis.score),
        a.basis.supplyBasis,
        a.basis.conditions.join(" | "),
        (flags.get(a.id) ?? []).map((f) => REVIEW_LABELS[f.code]).join(" | "),
        a.createdAt,
      ]
        .map(csvField)
        .join(","),
    );
  }
  return rows.join("\r\n") + "\r\n";
}

export const planFileName = (ext: "json" | "csv"): string => `reuse-plan.${ext}`;
