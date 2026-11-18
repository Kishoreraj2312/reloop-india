/**
 * Emission-factor library (B5).
 *
 * The repository holds NO documented emission factors, so the library starts EMPTY: every category is "not assessed" until the
 * user enters a factor (with its source) or explicitly loads the illustrative demonstration set. The illustrative values are
 * order-of-magnitude placeholders with no source: they are labelled as such in every table and result that uses them and
 * must not be used for reporting.
 */

import { NOT_MODELLED, UNIT_LABEL, type Inventory, type Unit } from "@/engine/quantities";
import { CARBON_UNIT, ORIGINS, QUALITIES, type EmissionFactor, type FactorLibrary, type Origin, type Quality } from "./types";
import { materialCategoryOf } from "@/engine/scenarios";

export const UNITS: readonly Unit[] = ["kg", "m3", "m2", "m", "nr"];
export const factorUnitLabel = (basis: Unit): string => `${CARBON_UNIT}/${UNIT_LABEL[basis]}`;

/** Material the model does not contain (B1 "not modelled"): a factor can be stored but no quantity can ever be assessed. */
export const NOT_IN_MODEL_SLOTS: readonly { key: string; label: string; reason: string }[] = [
  { key: "reinforcing_steel", label: "Reinforcing steel", reason: NOT_MODELLED.find((n) => n.key === "reinforcement")?.reason ?? "not modelled" },
  { key: "structural_steel", label: "Structural steel", reason: NOT_MODELLED.find((n) => n.key === "structural_steel")?.reason ?? "not modelled" },
];

export function emptyFactor(category: string, basis: Unit = "kg"): EmissionFactor {
  return { category, basis, value: null, sourceName: "", reference: "", geography: "", boundary: "", quality: "unrated", origin: "assumed", note: "" };
}

/** Error text for an invalid factor, or null. A sourced or measured value needs its source named. */
export function validateFactor(f: EmissionFactor): string | null {
  if (!f.category) return "A factor needs a material category";
  if (!(UNITS as readonly string[]).includes(f.basis)) return `Unknown unit "${String(f.basis)}"`;
  if (f.value !== null && (typeof f.value !== "number" || !Number.isFinite(f.value))) return "The emission factor must be a number";
  if (f.value !== null && f.value < 0) return "The emission factor cannot be negative";
  if (!(ORIGINS as readonly string[]).includes(f.origin)) return `Unknown origin "${String(f.origin)}"`;
  if (!(QUALITIES as readonly string[]).includes(f.quality)) return `Unknown quality "${String(f.quality)}"`;
  if (f.value !== null && (f.origin === "sourced" || f.origin === "measured") && !f.sourceName.trim()) return `A ${f.origin} factor needs a source name`;
  return null;
}

/** Parse user text for a non-negative number: "" = not set (null); anything else invalid is an error. */
export function parseNonNegative(text: string, opts: { max?: number; positive?: boolean } = {}): { value: number | null; error: string | null } {
  const t = text.trim();
  if (t === "") return { value: null, error: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { value: null, error: "Enter a number" };
  if (n < 0) return { value: null, error: "Cannot be negative" };
  if (opts.positive && n === 0) return { value: null, error: "Must be greater than 0" };
  if (opts.max !== undefined && n > opts.max) return { value: null, error: `Cannot exceed ${opts.max}` };
  return { value: n, error: null };
}

export interface FactorEdit {
  readonly library: FactorLibrary;
  readonly error: string | null;
}

/** Replace one factor. An invalid factor returns the SAME library and an error. */
export function setFactor(lib: FactorLibrary, f: EmissionFactor): FactorEdit {
  const error = validateFactor(f);
  if (error) return { library: lib, error };
  const next = new Map(lib);
  next.set(f.category, { ...f });
  return { library: next, error: null };
}

export function removeFactor(lib: FactorLibrary, category: string): FactorLibrary {
  if (!lib.has(category)) return lib;
  const next = new Map(lib);
  next.delete(category);
  return next;
}

const ILLUSTRATIVE_NOTE = "Order-of-magnitude placeholder for demonstration only. Not from any database; replace it with a sourced factor before any use.";
const illustrative = (category: string, value: number): EmissionFactor => ({
  category,
  basis: "kg",
  value,
  sourceName: "ILLUSTRATIVE PLACEHOLDER — no source",
  reference: "",
  geography: "unspecified",
  boundary: "unspecified product stage",
  quality: "unrated",
  origin: "illustrative",
  note: ILLUSTRATIVE_NOTE,
});

/**
 * A small demonstration set, kgCO₂e per kg, only for categories that have an estimated mass in B1. Everything else stays
 * unassessed. These are NOT verified data (and not Indian data).
 */
export function illustrativeFactors(): FactorLibrary {
  const v: [string, number][] = [
    ["concrete", 0.13],
    ["brick_masonry", 0.22],
    ["cement_screed", 0.12],
    ["ceramic_tile", 0.75],
    ["porcelain_tile", 0.8],
    ["stone", 0.08],
    ["glass", 1.2],
    ["gypsum_board", 0.35],
    ["timber", 0.4],
  ];
  return new Map(v.map(([c, x]) => [c, illustrative(c, x)]));
}

export interface CategoryBases {
  readonly category: string;
  readonly components: number;
  /** Units in which at least one component of the category has a B1 measure, with how many. */
  readonly units: ReadonlyMap<Unit, number>;
  /** The suggested basis: kg when any component has a mass, else the most common unit. */
  readonly suggested: Unit;
}

/** For every material category of the model: the units its B1 measures exist in. */
export function categoryBases(inv: Inventory): CategoryBases[] {
  const m = new Map<string, { n: number; units: Map<Unit, number> }>();
  for (const row of inv.rows) {
    const c = materialCategoryOf(row.rec.materialId);
    let e = m.get(c);
    if (!e) m.set(c, (e = { n: 0, units: new Map() }));
    e.n++;
    const us = new Set<Unit>([row.q.primary.unit, ...row.q.secondary.map((s) => s.unit)]);
    if (row.q.mass.value !== null) us.add("kg");
    for (const u of us) e.units.set(u, (e.units.get(u) ?? 0) + 1);
  }
  return [...m]
    .map(([category, e]) => {
      const kg = e.units.get("kg") ?? 0;
      const best = [...e.units].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "kg";
      return { category, components: e.n, units: e.units, suggested: (kg > 0 && kg >= e.n * 0.5 ? "kg" : best) as Unit };
    })
    .sort((a, b) => (a.category < b.category ? -1 : 1));
}

export type { Origin, Quality };
