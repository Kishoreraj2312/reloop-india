/**
 * Demo project (pure): the illustrative inputs that fill every data-entry module for a presentation, derived from the REAL model's
 * inventory (ids, categories, B1 units and quantities). Nothing here is an assessment of a real building: every value is a planning
 * figure chosen to show the workflow, every free-text field says "Demo project (illustrative)", and the demo store keeps a backup of
 * the user's own data and puts it back on exit. The modules' own rules still apply: these inputs go through the same store actions
 * and validation as typed-in data, and every result is derived by the engines as usual.
 */

import type { Inventory, InventoryRow } from "@/engine/quantities";
import { starterGroups, type StarterGroup } from "@/engine/recovery";
import type { MetaPatch } from "@/engine/passport";

export const DEMO_NOTE = "Demo project (illustrative values, not an assessment)";
/** Short form for per-component B2 notes (thousands of entries share the localStorage budget). */
export const DEMO_TAG = "Demo (illustrative)";

export type AssessmentGroup = StarterGroup;

/** B2: the starter sample's rules (src/engine/recovery/starter.ts), one group per rule in a stable order, noted as demo data. */
export const demoAssessments = (inv: Inventory): AssessmentGroup[] => starterGroups(inv, DEMO_TAG);

/** B3: the top storey's doors, windows and balcony assemblies, stripped before the frame (the plan's suggested order is applied after). */
export function demoRemovalEntries(inv: Inventory): string[] {
  const want = new Set(["door_assembly", "window_assembly", "balcony_assembly"]);
  return inv.records.filter((r) => r.floor === 4 && want.has(r.componentType)).map((r) => r.id);
}

/** B3: two smaller plans beside the main one, so the plan selector shows a project with several plans (they are created first, so the main plan stays the active one). */
export function demoExtraRemovalPlans(inv: Inventory): { name: string; ids: string[] }[] {
  const of = (floors: readonly number[], type: string) => inv.records.filter((r) => floors.includes(r.floor) && r.componentType === type).map((r) => r.id);
  return [
    { name: "Demo: F03 balcony refurbishment", ids: of([3], "balcony_assembly") },
    { name: "Demo: ground and F01 door reuse", ids: of([0, 1], "door_assembly") },
  ].filter((p) => p.ids.length > 0);
}

/** C1: inspection notes on a handful of components across the storeys (a door, a window, a railing, a column, a basin). The handrail
 *  (first south-facing one on F01) is the one the demo tour opens. */
export function demoPassports(inv: Inventory): { id: string; meta: MetaPatch }[] {
  // prefer the south (entrance, z < 0) side, which the presentation camera faces
  const pick = (type: string, floor: number) => {
    const of = inv.rows.filter((r) => r.rec.componentType === type && r.rec.floor === floor);
    return (of.find((r) => r.rec.originalPosition[2] < 0) ?? of[0])?.rec.id;
  };
  const out: { id: string; meta: MetaPatch }[] = [];
  const add = (id: string | undefined, meta: MetaPatch) => id && out.push({ id, meta });
  const common = { inspectionStatus: "inspected" as const, inspectedOn: "2026-10-20", inspectedBy: "Demo surveyor", provenanceNote: DEMO_NOTE };
  add(pick("balcony_handrail", 1), { ...common, observedCondition: "fair", conditionNote: "Surface rust at the fixings; needs blasting and recoating." });
  add(pick("door_leaf", 2), { ...common, observedCondition: "good", conditionNote: "Leaf straight, hinges sound; light scuffing on the lock side." });
  add(pick("window_frame", 3), { ...common, observedCondition: "fair", conditionNote: "Frame intact; gaskets perished, to be replaced before reuse." });
  add(pick("column", 0), { inspectionStatus: "scheduled", observedCondition: null, inspectedOn: "", inspectedBy: "", provenanceNote: DEMO_NOTE, conditionNote: "Structural survey to be booked." });
  add(pick("basin", 2), { ...common, observedCondition: "damaged", conditionNote: "Hairline crack at the overflow; not suitable for reuse." });
  add(pick("door_leaf", 4), { ...common, observedCondition: "good", conditionNote: "Solid timber leaf, original ironmongery present; ready to be unhung." });
  add(pick("window_sill", 1), { ...common, observedCondition: "fair", conditionNote: "Weathered face with algae staining; sound after cleaning." });
  add(pick("glazing", 3), { ...common, observedCondition: "good", conditionNote: "Clear panes, no edge chips; seals to be replaced." });
  add(pick("door_frame", 2), { ...common, observedCondition: "fair", conditionNote: "Minor paint damage; one hinge mortice enlarged." });
  add(pick("balcony_handrail", 4), { ...common, observedCondition: "good", conditionNote: "Coating intact; fixings accessible for unbolting." });
  add(pick("window_frame", 1), { ...common, observedCondition: "damaged", conditionNote: "Corner joint failed; recycle as metal." });
  add(pick("beam", 3), { inspectionStatus: "scheduled", observedCondition: null, inspectedOn: "", inspectedBy: "", provenanceNote: DEMO_NOTE, conditionNote: "Core sample requested before any structural decision." });
  return out;
}

export interface DemoRequirement {
  readonly name: string;
  readonly application: string;
  readonly componentType: string;
  readonly materialId: string;
  /** Share of the available B1 quantity of that type the receiving project needs (above what is left after the earlier needs: only part of it can be supplied). */
  readonly share: number;
  /** False: the requirement stays open, with matches listed but nothing allocated yet. */
  readonly confirm?: boolean;
}

/** C2: what a (hypothetical) receiving project needs; quantities are set from the model's own B1 totals at load time. */
export const DEMO_REQUIREMENTS: readonly DemoRequirement[] = [
  { name: "Internal doors, community hall", application: "Community hall refit (demo)", componentType: "door_leaf", materialId: "timber_door_light", share: 0.35 },
  { name: "Balcony handrails, school annex", application: "School annex (demo)", componentType: "balcony_handrail", materialId: "metal_railing", share: 0.5 },
  { name: "Window sills, housing block", application: "Housing block (demo)", componentType: "window_sill", materialId: "stone_coping", share: 0.3 },
  // a later need for the same doors and rails can only be partly supplied (what the first needs left), and one need is still open
  { name: "Timber doors, clinic refit", application: "Clinic refit (demo)", componentType: "door_leaf", materialId: "timber_door_light", share: 0.8 },
  { name: "Balcony handrails, community centre", application: "Community centre (demo)", componentType: "balcony_handrail", materialId: "metal_railing", share: 0.9 },
  { name: "Wet-area doors, canteen", application: "Canteen (demo)", componentType: "door_leaf", materialId: "laminate_door_wet", share: 0.5, confirm: false },
];

/** Rows of one component type and material (leaves). */
export const rowsOf = (inv: Inventory, componentType: string, materialId: string): InventoryRow[] =>
  inv.rows.filter((r) => r.rec.componentType === componentType && r.rec.materialId === materialId);

export interface DemoTracked {
  /** Recovered and reused (F04 doors and handrails). */
  reused: string[];
  /** Recovered and recycled (F04 and F02 glazing). */
  recycled: string[];
  /** Work under way, about half recovered (F03 handrails). */
  inProgress: string[];
  /** Recovered, waiting for inspection or just inspected (F03 doors). */
  inspected: string[];
  /** Recovered; allocated to a C2 requirement where it has an allocation, else inspected (F02 doors and handrails, F01 doors). */
  allocatable: string[];
  /** Tracked but not started (F01 handrails and glazing, ground-floor doors). */
  planned: string[];
  /** Paused, waiting for a check (twelve F03 panes). */
  onHold: string[];
}

/** C3: components tracked in the demo, by stage: the project is about two-thirds of the way through its recovery. */
export function demoTracked(inv: Inventory): DemoTracked {
  const of = (floor: number, ...types: string[]) => inv.rows.filter((r) => r.rec.floor === floor && types.includes(r.rec.componentType)).map((r) => r.rec.id);
  return {
    reused: of(4, "door_leaf", "balcony_handrail"),
    recycled: [...of(4, "glazing"), ...of(2, "glazing")],
    // handrails are measured in metres, so a partly recovered quantity is meaningful (frames are counted items)
    inProgress: of(3, "balcony_handrail"),
    inspected: of(3, "door_leaf"),
    allocatable: [...of(2, "door_leaf", "balcony_handrail"), ...of(1, "door_leaf")],
    planned: [...of(1, "balcony_handrail", "glazing"), ...of(0, "door_leaf")],
    onHold: of(3, "glazing").slice(0, 12),
  };
}
