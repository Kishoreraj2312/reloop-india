/**
 * (De)serialisation of requirements, allocations and the matching configuration (C2). Pure: the storage glue lives in the scene
 * layer. Malformed or outdated data yields nothing and never throws; an invalid entry is dropped and counted, a valid one is
 * never repaired. Allocations for components that are not in the current model are KEPT (the model may be regenerated) and
 * surfaced by the review, so a user's plan is never silently lost.
 */

import { CATEGORIES, type Category } from "@/engine/quantities";
import { CLASSIFICATIONS, type Classification } from "@/engine/recovery";
import { validateConfig, validateDraft, type RequirementDraft } from "./requirement";
import {
  AXES,
  CRITERIA,
  DEFAULT_ACCEPTANCE,
  DEFAULT_CONFIG,
  MAX_NOTE,
  MIN_CONDITIONS,
  NO_RANGE,
  REQUIREMENT_UNITS,
  type Acceptance,
  type Allocation,
  type AllocationBasis,
  type DimRanges,
  type MatchConfig,
  type Range,
  type Requirement,
  type SupplyBasis,
} from "./types";

export const PERSIST_VERSION = 1;

export interface PersistedReuse {
  readonly requirements: readonly Requirement[];
  readonly allocations: readonly Allocation[];
  readonly config: MatchConfig;
  readonly activeId: string | null;
}

export const EMPTY_REUSE: PersistedReuse = Object.freeze({ requirements: Object.freeze([]), allocations: Object.freeze([]), config: DEFAULT_CONFIG, activeId: null });

export const serializeReuse = (s: PersistedReuse): string => JSON.stringify({ version: PERSIST_VERSION, requirements: s.requirements, allocations: s.allocations, config: s.config, activeId: s.activeId });

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function cleanRange(raw: unknown): Range {
  const r = obj(raw);
  if (!r) return NO_RANGE;
  return { min: num(r.min), max: num(r.max) };
}

function cleanRequirement(raw: unknown): Requirement | null {
  const r = obj(raw);
  if (!r) return null;
  const id = str(r.id, 80);
  if (!id) return null;
  const dimsRaw = obj(r.dims) ?? {};
  const dims = Object.fromEntries(AXES.map((a) => [a, cleanRange(dimsRaw[a])])) as unknown as DimRanges;
  const accRaw = obj(r.accept) ?? {};
  const accept = Object.fromEntries((Object.keys(DEFAULT_ACCEPTANCE) as (keyof Acceptance)[]).map((k) => [k, typeof accRaw[k] === "boolean" ? accRaw[k] : DEFAULT_ACCEPTANCE[k]])) as unknown as Acceptance;
  const form = r.form === null || r.form === undefined ? null : oneOf(CATEGORIES, r.form);
  const unit = oneOf(REQUIREMENT_UNITS, r.unit);
  const minCondition = oneOf(MIN_CONDITIONS, r.minCondition);
  const quantity = num(r.quantity);
  if (!unit || !minCondition || quantity === null || (r.form !== null && r.form !== undefined && form === null)) return null;
  const draft: RequirementDraft = {
    name: str(r.name, 200),
    application: str(r.application, 400),
    substance: str(r.substance, 80),
    form: form as Category | null,
    componentType: typeof r.componentType === "string" && r.componentType ? r.componentType.slice(0, 60) : null,
    materialId: typeof r.materialId === "string" && r.materialId ? r.materialId : null,
    quantity,
    unit,
    dims,
    toleranceMm: num(r.toleranceMm) ?? 0,
    minCondition,
    accept,
    includeStructural: r.includeStructural === true,
    includeUnassessed: r.includeUnassessed !== false,
    extraSpecs: (Array.isArray(r.extraSpecs) ? r.extraSpecs : []).flatMap((s) => {
      const o = obj(s);
      return o && typeof o.label === "string" && o.label.trim() !== "" ? [{ label: o.label.slice(0, 60), value: str(o.value, 160) }] : [];
    }),
    note: str(r.note, MAX_NOTE),
  };
  if (validateDraft(draft) !== null) return null;
  const epoch = new Date(0).toISOString();
  return Object.freeze({ ...draft, id, createdAt: str(r.createdAt, 40) || epoch, updatedAt: str(r.updatedAt, 40) || epoch });
}

function cleanBasis(raw: unknown): AllocationBasis {
  const b = obj(raw) ?? {};
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20).map((x) => x.slice(0, 400)) : []);
  return {
    tier: b.tier === "strong" ? "strong" : "conditional",
    score: num(b.score),
    supply: num(b.supply),
    supplyBasis: (oneOf<SupplyBasis>(["recoverable", "upper_bound", "none"], b.supplyBasis) ?? "none") as SupplyBasis,
    classification: oneOf<Classification>(CLASSIFICATIONS, b.classification),
    conditions: strings(b.conditions),
    missing: strings(b.missing),
  };
}

function cleanAllocation(raw: unknown): Allocation | null {
  const a = obj(raw);
  if (!a) return null;
  const id = str(a.id, 80);
  const requirementId = str(a.requirementId, 80);
  const componentId = str(a.componentId, 200);
  const quantity = num(a.quantity);
  const unit = oneOf(REQUIREMENT_UNITS, a.unit);
  if (!id || !requirementId || !componentId || quantity === null || quantity <= 0 || !unit) return null;
  const now = new Date(0).toISOString();
  return { id, requirementId, componentId, quantity, unit, note: str(a.note, MAX_NOTE), basis: cleanBasis(a.basis), createdAt: str(a.createdAt, 40) || now, updatedAt: str(a.updatedAt, 40) || now };
}

function cleanConfig(raw: unknown): MatchConfig {
  const c = obj(raw);
  if (!c) return DEFAULT_CONFIG;
  const w = obj(c.weights) ?? {};
  const weights = Object.fromEntries(CRITERIA.map((k) => [k, num(w[k]) ?? DEFAULT_CONFIG.weights[k]])) as unknown as MatchConfig["weights"];
  const cfg: MatchConfig = { weights, partialCredit: num(c.partialCredit) ?? DEFAULT_CONFIG.partialCredit, unknownCredit: num(c.unknownCredit) ?? DEFAULT_CONFIG.unknownCredit };
  return validateConfig(cfg) === null ? cfg : DEFAULT_CONFIG;
}

export interface ParsedReuse extends PersistedReuse {
  readonly dropped: { readonly requirements: number; readonly allocations: number };
}

export function parseReuse(text: string | null): ParsedReuse {
  const empty: ParsedReuse = { ...EMPTY_REUSE, dropped: { requirements: 0, allocations: 0 } };
  if (!text) return empty;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return empty;
  }
  const d = obj(data);
  if (!d || d.version !== PERSIST_VERSION) return empty;
  const requirements: Requirement[] = [];
  let droppedReq = 0;
  const seenReq = new Set<string>();
  for (const raw of Array.isArray(d.requirements) ? d.requirements : []) {
    const r = cleanRequirement(raw);
    if (!r || seenReq.has(r.id)) droppedReq++;
    else (requirements.push(r), seenReq.add(r.id));
  }
  const allocations: Allocation[] = [];
  let droppedAlloc = 0;
  const seenPair = new Set<string>();
  const seenId = new Set<string>();
  for (const raw of Array.isArray(d.allocations) ? d.allocations : []) {
    const a = cleanAllocation(raw);
    const pair = a ? `${a.requirementId}|${a.componentId}` : "";
    if (!a || !seenReq.has(a.requirementId) || seenPair.has(pair) || seenId.has(a.id)) droppedAlloc++;
    else (allocations.push(a), seenPair.add(pair), seenId.add(a.id));
  }
  const activeId = typeof d.activeId === "string" && seenReq.has(d.activeId) ? d.activeId : (requirements[0]?.id ?? null);
  return { requirements, allocations, config: cleanConfig(d.config), activeId, dropped: { requirements: droppedReq, allocations: droppedAlloc } };
}
