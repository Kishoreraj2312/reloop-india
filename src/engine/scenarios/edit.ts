/**
 * Scenario editing (B4). Pure and immutable: every operation returns a new scenario, or the SAME scenario plus an error
 * when the input is invalid, so a rejected edit can never corrupt the previous state. Only assumptions are stored.
 */

import { parsePct } from "@/engine/recovery";
import { rulesEqual, validateRule } from "./rules";
import { templateDefaults } from "./templates";
import { RESIDUALS, type Residual, type Rule, type Scenario } from "./types";

export interface EditResult {
  readonly scenario: Scenario;
  /** Null when the edit was applied (or was a no-op). */
  readonly error: string | null;
}

const reject = (scenario: Scenario, error: string): EditResult => ({ scenario, error });
const ok = (scenario: Scenario): EditResult => ({ scenario, error: null });

/** Parse the text of a recovery % field: "" = not set; invalid text or a value outside 0–100 is an error. */
export const parseRecoveryPct = parsePct;

export function renameScenario(s: Scenario, name: string): EditResult {
  const n = name.trim();
  if (!n) return reject(s, "A scenario needs a name");
  return n === s.name ? ok(s) : ok({ ...s, name: n });
}

export function setResidual(s: Scenario, residual: Residual): EditResult {
  if (!(RESIDUALS as readonly string[]).includes(residual)) return reject(s, `Unknown residual destination "${String(residual)}"`);
  return residual === s.residual ? ok(s) : ok({ ...s, residual });
}

export function setBaseline(s: Scenario, rule: Rule): EditResult {
  const e = validateRule(rule, { allowAssessment: false });
  if (e) return reject(s, e);
  return rulesEqual(rule, s.baseline) ? ok(s) : ok({ ...s, baseline: { ...rule } });
}

/** Selective deconstruction: the material categories whose B2 assessments are applied. */
export function setScope(s: Scenario, categories: readonly string[]): EditResult {
  if (s.template !== "selective") return reject(s, "Only the selective deconstruction template has a scope");
  const next = [...new Set(categories)].sort();
  const same = s.scope !== null && s.scope.length === next.length && s.scope.every((c, i) => c === next[i]);
  return same ? ok(s) : ok({ ...s, scope: next });
}

function setRule(s: Scenario, field: "categoryRules" | "componentRules", key: string, rule: Rule | null): EditResult {
  if (!key) return reject(s, "Missing target");
  const cur = s[field];
  if (rule === null) {
    if (!(key in cur)) return ok(s);
    const { [key]: _gone, ...rest } = cur;
    void _gone;
    return ok({ ...s, [field]: rest });
  }
  const e = validateRule(rule);
  if (e) return reject(s, e);
  if (rulesEqual(cur[key], rule)) return ok(s);
  return ok({ ...s, [field]: { ...cur, [key]: { ...rule } } });
}

/** Set (or, with null, remove) the override of a material category. */
export const setCategoryRule = (s: Scenario, category: string, rule: Rule | null): EditResult => setRule(s, "categoryRules", category, rule);
/** Set (or, with null, remove) the override of a component or assembly. */
export const setComponentRule = (s: Scenario, id: string, rule: Rule | null): EditResult => setRule(s, "componentRules", id, rule);

/** Same override on several components at once (all-or-nothing: one invalid rule changes nothing). */
export function setComponentRules(s: Scenario, ids: readonly string[], rule: Rule | null): EditResult {
  let cur = s;
  for (const id of new Set(ids)) {
    const r = setRule(cur, "componentRules", id, rule);
    if (r.error) return reject(s, r.error);
    cur = r.scenario;
  }
  return ok(cur);
}

/** Back to the template's defaults: assumptions and overrides are replaced; id, name and template are kept. */
export function resetScenario(s: Scenario, assessed: readonly string[]): Scenario {
  return { id: s.id, name: s.name, template: s.template, ...templateDefaults(s.template, assessed), categoryRules: {}, componentRules: {} };
}

/** An independent copy: nothing is shared with the original. */
export function duplicateScenario(s: Scenario, id: string, name: string): Scenario {
  const copyRules = (m: Readonly<Record<string, Rule>>): Record<string, Rule> => Object.fromEntries(Object.entries(m).map(([k, r]) => [k, { ...r }]));
  return { id, name: name.trim() || `${s.name} (copy)`, template: s.template, residual: s.residual, baseline: { ...s.baseline }, scope: s.scope === null ? null : [...s.scope], categoryRules: copyRules(s.categoryRules), componentRules: copyRules(s.componentRules) };
}

/** True when the scenario differs from the template defaults (so "Reset" does something). */
export function isModified(s: Scenario, assessed: readonly string[]): boolean {
  const d = templateDefaults(s.template, assessed);
  if (Object.keys(s.categoryRules).length || Object.keys(s.componentRules).length) return true;
  if (s.residual !== d.residual || !rulesEqual(s.baseline, d.baseline)) return true;
  const a = s.scope;
  const b = d.scope;
  return (a === null) !== (b === null) || (a !== null && b !== null && (a.length !== b.length || a.some((c, i) => c !== b[i])));
}
