/**
 * Scenario templates (B4): three editable starting points. A template only chooses defaults for the scenario's
 * assumptions; it never carries a recovery rate, and the repository has no documented material-category recovery
 * rates, so none is supplied. Every number a result shows comes from B1 quantities, B2 assessments or the user.
 *
 *   Conventional demolition   a disposal baseline: everything is disposed of unless the user adds category or component rules
 *   Selective deconstruction  B2 assessments (classification + recovery %) for the selected material categories; the rest follows the baseline
 *   Reuse-first               B2 assessments for the whole building; no demolition fallback, so anything unassessed stays unknown
 */

import { substanceOf } from "@/engine/recovery";
import type { Inventory } from "@/engine/quantities";
import type { Assessments } from "@/engine/recovery";
import { DISPOSAL_RULE, UNKNOWN_RULE } from "./rules";
import type { Residual, Rule, Scenario, TemplateId } from "./types";

export interface TemplateInfo {
  readonly label: string;
  readonly summary: string;
  /** What the template assumes, in plain words (shown next to the scenario). */
  readonly assumptions: readonly string[];
}

export const TEMPLATE_INFO: Readonly<Record<TemplateId, TemplateInfo>> = {
  conventional: {
    label: "Conventional demolition",
    summary: "A configurable baseline: every component is disposed of unless you add a category or component rule.",
    assumptions: [
      "Baseline: disposal for every component (the repository holds no documented material-category recovery rates, so none is assumed).",
      "Add category rules (for example concrete to recycling at your own %) to model a more realistic demolition.",
    ],
  },
  selective: {
    label: "Selective deconstruction",
    summary: "B2 assessments and recovery % are applied to the selected material categories; everything else follows the baseline.",
    assumptions: [
      "Selected categories: each component follows its own B2 assessment; unassessed or unclear components stay unknown.",
      "Categories outside the selection follow the baseline (disposal unless edited).",
      "The unrecovered share of a recovery pathway goes to disposal unless you change it.",
    ],
  },
  reuse_first: {
    label: "Reuse-first",
    summary: "B2 assessments for the whole building, with no demolition fallback: missing or insufficient information stays unknown.",
    assumptions: [
      "Every component follows its own B2 assessment (reuse and refurbishment first, recycling as assessed).",
      "No component is assumed to be disposed of: unassessed or unclear components stay unknown.",
      "The unrecovered share of a recovery pathway stays unknown until you assign it.",
    ],
  },
};

export interface TemplateDefaults {
  readonly residual: Residual;
  readonly baseline: Rule;
  readonly scope: readonly string[] | null;
}

/** The material categories in which at least one component has a B2 classification. */
export function assessedCategories(inv: Inventory, assessments: Assessments): string[] {
  const out = new Set<string>();
  for (const row of inv.rows) if (assessments.get(row.rec.id)?.classification) out.add(substanceOf(row.rec.materialId));
  return [...out].sort();
}

export function templateDefaults(template: TemplateId, assessed: readonly string[]): TemplateDefaults {
  switch (template) {
    case "conventional":
      return { residual: "disposal", baseline: DISPOSAL_RULE, scope: null };
    case "selective":
      return { residual: "disposal", baseline: DISPOSAL_RULE, scope: [...assessed] };
    case "reuse_first":
      return { residual: "unknown", baseline: UNKNOWN_RULE, scope: null };
  }
}

/** A new scenario with the template's defaults and no overrides. */
export function newScenario(id: string, name: string, template: TemplateId, assessed: readonly string[]): Scenario {
  return { id, name: name.trim() || TEMPLATE_INFO[template].label, template, ...templateDefaults(template, assessed), categoryRules: {}, componentRules: {} };
}
