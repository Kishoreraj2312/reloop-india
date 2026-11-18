/** (De)serialisation of the carbon inputs (B5): the factor library and the assumptions. Pure; invalid parts are dropped, never repaired to a guess. */

import { validatePct } from "@/engine/recovery";
import { UNITS, validateFactor } from "./factors";
import { EMPTY_ASSUMPTIONS, ORIGINS, QUALITIES, RECOVERY_KEYS, type Assumptions, type EmissionFactor, type FactorLibrary, type RecoveryKey } from "./types";

export const PERSIST_VERSION = 1;

export interface PersistedCarbon {
  readonly factors: FactorLibrary;
  readonly assumptions: Assumptions;
}

export function serializeCarbon(s: PersistedCarbon): string {
  return JSON.stringify({ version: PERSIST_VERSION, factors: [...s.factors.values()].sort((a, b) => (a.category < b.category ? -1 : 1)), assumptions: s.assumptions });
}

const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nn = (v: unknown): number | null => (num(v) && v >= 0 ? v : null);
const one = <T extends string>(list: readonly T[], v: unknown, d: T): T => (str(v) && (list as readonly string[]).includes(v) ? (v as T) : d);
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function cleanFactor(raw: unknown): EmissionFactor | null {
  const r = rec(raw);
  if (!str(r.category) || !r.category) return null;
  const f: EmissionFactor = {
    category: r.category,
    basis: one(UNITS, r.basis, "kg"),
    value: nn(r.value),
    sourceName: str(r.sourceName) ? r.sourceName : "",
    reference: str(r.reference) ? r.reference : "",
    geography: str(r.geography) ? r.geography : "",
    boundary: str(r.boundary) ? r.boundary : "",
    quality: one(QUALITIES, r.quality, "unrated"),
    origin: one(ORIGINS, r.origin, "assumed"),
    note: str(r.note) ? r.note : "",
  };
  // A sourced / measured value that lost its source is downgraded to "assumed", never kept as sourced.
  return validateFactor(f) === null ? f : validateFactor({ ...f, origin: "assumed" }) === null ? { ...f, origin: "assumed" } : null;
}

function cleanNumbers(raw: unknown, positive = false): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(raw))) if (k && num(v) && v >= 0 && (!positive || v > 0)) out[k] = v;
  return out;
}

export function parseCarbon(text: string | null): PersistedCarbon & { dropped: number } {
  const empty = { factors: new Map<string, EmissionFactor>(), assumptions: EMPTY_ASSUMPTIONS, dropped: 0 };
  if (!text) return empty;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return empty;
  }
  const d = rec(data);
  if (d.version !== PERSIST_VERSION) return empty;
  const factors = new Map<string, EmissionFactor>();
  let dropped = 0;
  for (const raw of Array.isArray(d.factors) ? d.factors : []) {
    const f = cleanFactor(raw);
    if (f) factors.set(f.category, f);
    else dropped++;
  }
  const a = rec(d.assumptions);
  const rep = rec(a.replacement);
  const pct = (v: unknown): number | null => (num(v) && validatePct(v) === null ? v : null);
  const byCat: Record<string, Partial<Record<RecoveryKey, number | null>>> = {};
  for (const [cat, rr] of Object.entries(rec(a.replacementByCategory))) {
    const o: Partial<Record<RecoveryKey, number | null>> = {};
    for (const k of RECOVERY_KEYS) {
      const v = pct(rec(rr)[k]);
      if (v !== null) o[k] = v;
    }
    if (Object.keys(o).length) byCat[cat] = o;
  }
  const t = rec(a.transport);
  const assumptions: Assumptions = {
    replacement: { direct: pct(rep.direct), refurbish: pct(rep.refurbish), recycling: pct(rep.recycling) },
    replacementByCategory: byCat,
    refurbishFactor: cleanNumbers(a.refurbishFactor),
    processingFactor: cleanNumbers(a.processingFactor),
    densityKgM3: cleanNumbers(a.densityKgM3, true),
    transport: { recoveredKm: nn(t.recoveredKm), disposalKm: nn(t.disposalKm), factorKgPerTonneKm: nn(t.factorKgPerTonneKm) },
  };
  return { factors, assumptions, dropped };
}
