/** (De)serialisation of scenarios (B4). Pure: the storage glue lives in the scene layer. Only assumptions are stored. */

import { validatePct } from "@/engine/recovery";
import { makeRule, validateRule } from "./rules";
import { RESIDUALS, RULE_KINDS, TEMPLATES, type Residual, type Rule, type RuleKind, type Scenario, type TemplateId } from "./types";

export const PERSIST_VERSION = 1;

export interface PersistedScenarios {
  readonly scenarios: readonly Scenario[];
  /** The scenario being edited. */
  readonly activeId: string | null;
  /** The scenarios shown side by side (2–3), by id. */
  readonly compareIds: readonly string[];
}

export function serializeScenarios(s: PersistedScenarios): string {
  return JSON.stringify({ version: PERSIST_VERSION, activeId: s.activeId, compareIds: s.compareIds, scenarios: s.scenarios });
}

const str = (v: unknown): v is string => typeof v === "string";
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (str(v) && (list as readonly string[]).includes(v) ? (v as T) : null);

function cleanRule(raw: unknown): Rule | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const kind = oneOf<RuleKind>(RULE_KINDS, r.kind);
  if (!kind) return null;
  // An invalid percentage is dropped to "not set" (visible as a missing assumption), never repaired to a guess.
  const pct = typeof r.recoveryPct === "number" && validatePct(r.recoveryPct) === null ? r.recoveryPct : null;
  const rule = makeRule(kind, pct, oneOf<Residual>(RESIDUALS, r.residual));
  return validateRule(rule) === null ? rule : null;
}

function cleanRules(raw: unknown): Record<string, Rule> {
  const out: Record<string, Rule> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [k, v] of Object.entries(raw)) {
    const r = k ? cleanRule(v) : null;
    if (r) out[k] = r;
  }
  return out;
}

function cleanScenario(raw: unknown): Scenario | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const template = oneOf<TemplateId>(TEMPLATES, r.template);
  const baseline = cleanRule(r.baseline);
  if (!str(r.id) || !r.id || !str(r.name) || !template || !baseline || baseline.kind === "assessment") return null;
  const scope = Array.isArray(r.scope) ? [...new Set(r.scope.filter(str))].sort() : null;
  return {
    id: r.id,
    name: r.name.trim() || "Scenario",
    template,
    residual: oneOf<Residual>(RESIDUALS, r.residual) ?? "unknown",
    baseline,
    scope: template === "selective" ? (scope ?? []) : null,
    categoryRules: cleanRules(r.categoryRules),
    componentRules: cleanRules(r.componentRules),
  };
}

/** Parse stored JSON. Malformed or outdated data yields no scenarios (never throws); invalid scenarios are dropped and counted. */
export function parseScenarios(text: string | null): PersistedScenarios & { dropped: number } {
  const empty = { scenarios: [], activeId: null, compareIds: [], dropped: 0 };
  if (!text) return empty;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return empty;
  }
  const d = data as { version?: unknown; scenarios?: unknown; activeId?: unknown; compareIds?: unknown } | null;
  if (!d || d.version !== PERSIST_VERSION || !Array.isArray(d.scenarios)) return empty;
  const scenarios: Scenario[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of d.scenarios) {
    const s = cleanScenario(raw);
    if (!s || seen.has(s.id)) dropped++;
    else {
      seen.add(s.id);
      scenarios.push(s);
    }
  }
  let compareIds = Array.isArray(d.compareIds) ? [...new Set(d.compareIds.filter((x): x is string => str(x) && seen.has(x)))].slice(0, 3) : [];
  if (compareIds.length < 2) compareIds = scenarios.slice(0, Math.min(2, scenarios.length)).map((s) => s.id);
  return { scenarios, activeId: str(d.activeId) && seen.has(d.activeId) ? d.activeId : (scenarios[0]?.id ?? null), compareIds, dropped };
}
