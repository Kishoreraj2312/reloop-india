/**
 * Starter sample (B2, pure): the illustrative classifications the app starts with, so the 3D colouring and the downstream modules
 * have something to show before anyone has assessed a component. One rule per B1 material category (structure has its own). It is
 * NOT an assessment of this building: every recovery % is a planning figure chosen to show the workflow, every entry carries the
 * note STARTER_NOTE, and the store keeps it in memory until the user edits something (and never brings it back after a reset).
 * The rules go through the same applyPatch validation as typed-in data.
 */

import type { Category, Inventory } from "@/engine/quantities";
import { applyPatch } from "./assess";
import { cleanAssessment, PERSIST_VERSION } from "./persist";
import type { AssessmentPatch, Assessments, Classification, RecoveryAssessment } from "./types";

export const STARTER_NOTE = "Starter sample (illustrative)";

export interface StarterGroup {
  readonly label: string;
  readonly ids: readonly string[];
  readonly patch: AssessmentPatch;
}

const rule = (classification: Classification, recoveryPct: number | null, preparation: AssessmentPatch["preparation"], destination: AssessmentPatch["destination"]): AssessmentPatch => ({
  classification,
  recoveryPct,
  preparation,
  destination,
});

/**
 * B2 rule per B1 category. Categories not listed are left unassessed, as a real survey would; the high-count, low-mass groups
 * (conduit, pipe runs, ceiling boards, small hardware) are left out so the sample stays well inside the browser's storage budget
 * while covering more than 90 % of the modelled mass (B4 shows whole-building indicators from 90 %).
 */
const BY_CATEGORY: Partial<Record<Category, AssessmentPatch>> = {
  concrete: rule("recycling", 85, "reprocessing", "material_recycling"),
  masonry: rule("recycling", 75, "reprocessing", "material_recycling"),
  screed: rule("recycling", 80, "reprocessing", "material_recycling"),
  plaster: rule("recycling", 60, "reprocessing", "material_recycling"),
  stone: rule("refurbish_reuse", 70, "cleaning", "reuse_other_project"),
  timber: rule("direct_reuse", 100, "none", "reuse_other_project"), // doors re-hung as they are: strong C2 matches
  board: rule("refurbish_reuse", 100, "refurbishment", "refurbish_and_reuse"),
  metal: rule("refurbish_reuse", 90, "refurbishment", "reuse_other_project"),
  glazing: rule("recycling", 85, "reprocessing", "material_recycling"),
  glass_fixture: rule("recycling", 80, "reprocessing", "material_recycling"),
  sanitary: rule("further_assessment", null, null, "further_inspection"),
  roof_finish: rule("recycling", 40, "reprocessing", "material_recycling"),
  kitchen_unit: rule("refurbish_reuse", 80, "refurbishment", "refurbish_and_reuse"), // carcasses can be reused if undamaged
  appliance: rule("further_assessment", null, null, "further_inspection"), // function and age are unknown
};
/** Finer rules by material, ahead of the category rules: they split what one category would paint in a single colour where a surveyor plausibly would too. */
const BY_MATERIAL: Readonly<Record<string, AssessmentPatch>> = {
  masonry_paint_int: rule("refurbish_reuse", 50, "cleaning", "reuse_other_project"), // partitions sit in softer mortar and out of the weather: bricks cleaned and reclaimed
  concrete_balcony: rule("further_assessment", null, null, "further_inspection"), // cantilevered slabs: inspect corrosion and cracking before deciding
};
/** Metal parts worth a reuse story: window frames and railings. */
const METAL_ITEMS: ReadonlySet<string> = new Set(["metal_frame", "metal_railing"]);
const STRUCTURE = rule("recycling", 90, "reprocessing", "material_recycling");

/** One group per rule, in a stable order, each patch carrying `note`. */
export function starterGroups(inv: Inventory, note: string = STARTER_NOTE): StarterGroup[] {
  const groups = new Map<string, { label: string; ids: string[]; patch: AssessmentPatch }>();
  for (const row of inv.rows) {
    const structural = row.rec.system === "structure";
    const byMaterial = structural ? undefined : BY_MATERIAL[row.rec.materialId];
    const p = byMaterial ?? (structural ? STRUCTURE : BY_CATEGORY[row.q.category]);
    if (!p) continue;
    if (row.q.category === "metal" && (!METAL_ITEMS.has(row.rec.materialId) || row.rec.componentType.endsWith("baluster"))) continue; // frames, rails and posts; not hinges, handles or the 1,700 single balusters
    const key = structural ? "structure" : byMaterial ? row.rec.materialId : row.q.category;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { label: key, ids: [], patch: { ...p, note } }));
    g.ids.push(row.rec.id);
  }
  return [...groups.values()];
}

/** The starter sample as an assessments map. */
export function starterAssessments(inv: Inventory): Assessments {
  let map: Assessments = new Map();
  for (const g of starterGroups(inv)) map = applyPatch(inv, map, g.ids, g.patch).map;
  return map;
}

/** Add the starter sample to components that have no entry at all; anything already entered is left exactly as it is. */
export function fillWithStarter(inv: Inventory, current: Assessments): { map: Assessments; filled: number } {
  const next = new Map(current);
  let filled = 0;
  for (const [id, a] of starterAssessments(inv)) {
    if (next.has(id)) continue;
    next.set(id, a);
    filled++;
  }
  return { map: next, filled };
}

// ── saving what differs from the sample ─────────────────────────────────────────────────────────────────────────────────────────
// Saved in full, the sample would take about half of the browser's storage on the first edit, so assessments that start from it are
// saved as the changes only: entries that differ from (or are not in) the sample, and the ids of sample entries that were removed.

const BASE_MARK = '"base":"starter"';
const sameAssessment = (a: RecoveryAssessment, b: RecoveryAssessment): boolean => JSON.stringify(a) === JSON.stringify(b);

/** True when `text` was written by serializeOverStarter. The mark sits at the very start, so no parsing is needed to tell. */
export const isOverStarter = (text: string): boolean => text.slice(0, 64).includes(BASE_MARK);

export function serializeOverStarter(current: Assessments, starter: Assessments): string {
  const entries = [...current].filter(([id, a]) => {
    const s = starter.get(id);
    return !s || !sameAssessment(a, s);
  });
  const removed = [...starter.keys()].filter((id) => !current.has(id));
  const byId = (x: string, y: string) => (x < y ? -1 : 1);
  return `{"version":${PERSIST_VERSION},${BASE_MARK},"entries":${JSON.stringify(entries.sort((x, y) => byId(x[0], y[0])))},"removed":${JSON.stringify(removed.sort(byId))}}`;
}

/** The sample with the saved changes applied; null when `text` is not a valid save of that kind. */
export function parseOverStarter(text: string, starter: Assessments): Assessments | null {
  let data: { version?: unknown; base?: unknown; entries?: unknown; removed?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data?.version !== PERSIST_VERSION || data.base !== "starter" || !Array.isArray(data.entries) || !Array.isArray(data.removed)) return null;
  const map = new Map(starter);
  for (const id of data.removed) if (typeof id === "string") map.delete(id);
  for (const e of data.entries) {
    const a = Array.isArray(e) ? cleanAssessment(e[1]) : null;
    if (typeof e?.[0] === "string" && a) map.set(e[0], a);
  }
  return map;
}
