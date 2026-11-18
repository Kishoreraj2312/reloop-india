/**
 * Embodied-carbon assessment (B5) — data model.
 *
 * Nothing here is a measured result about the real building. A factor is the USER's (or an explicitly labelled illustrative)
 * emission factor for one material category; an assumption is a scenario-independent input the user supplies. Source values
 * (factors) are kept apart from assumptions, and both are kept apart from B1 quantities, B2 assessments, B3 plans and B4
 * scenarios, which are only read. A value that is not available is `null` ("not assessed"), never 0.
 */

import type { Unit } from "@/engine/quantities";

export const CARBON_UNIT = "kgCO₂e";

/** How a factor value came about. "illustrative" values are demonstration placeholders with no source. */
export const ORIGINS = ["measured", "sourced", "estimated", "assumed", "illustrative"] as const;
export type Origin = (typeof ORIGINS)[number];
export const ORIGIN_LABELS: Readonly<Record<Origin, string>> = { measured: "measured", sourced: "sourced", estimated: "estimated", assumed: "assumed", illustrative: "ILLUSTRATIVE (no source)" };

export const QUALITIES = ["high", "medium", "low", "unrated"] as const;
export type Quality = (typeof QUALITIES)[number];

/** kgCO₂e per ONE `basis` unit of the material (per kg, per m³, per m², per m or per item). */
export interface EmissionFactor {
  /** Material category (B2: the material's substance) or a slot key such as `reinforcing_steel`. */
  readonly category: string;
  readonly basis: Unit;
  /** null = not set: the category is "not assessed". */
  readonly value: number | null;
  readonly sourceName: string;
  /** URL or document reference. */
  readonly reference: string;
  readonly geography: string;
  /** Assessment boundary / lifecycle modules the value covers, for example "A1–A3". Free text, shown with every result. */
  readonly boundary: string;
  readonly quality: Quality;
  readonly origin: Origin;
  readonly note: string;
}

export type FactorLibrary = ReadonlyMap<string, EmissionFactor>;

/** The pathways of a recovered quantity that have a carbon term. */
export type RecoveryKey = "direct" | "refurbish" | "recycling";
export const RECOVERY_KEYS: readonly RecoveryKey[] = ["direct", "refurbish", "recycling"];
export const RECOVERY_KEY_LABELS: Readonly<Record<RecoveryKey, string>> = { direct: "Direct reuse", refurbish: "Reuse after refurbishment", recycling: "Recycling (substitutes virgin material)" };

export type Rates = Readonly<Partial<Record<RecoveryKey, number | null>>>;

/** User inputs of the scenario calculation. Every field starts unset (null / absent): nothing is assumed. */
export interface Assumptions {
  /**
   * Share (0–100 %) of the RECOVERED quantity that actually displaces new material, net of quality limits and mismatch.
   * Not every recovered item replaces an equivalent new item, so there is no default.
   */
  readonly replacement: Readonly<Record<RecoveryKey, number | null>>;
  /** Per material category overrides of `replacement`. */
  readonly replacementByCategory: Readonly<Record<string, Rates>>;
  /** kgCO₂e per basis unit of quantity that is refurbished (category -> value). */
  readonly refurbishFactor: Readonly<Record<string, number>>;
  /** kgCO₂e per basis unit of quantity that is recycled (crushing, melting, sorting …). */
  readonly processingFactor: Readonly<Record<string, number>>;
  /** Density override (kg/m³) used to derive mass from a modelled m³ volume; otherwise B1's own mass is used. */
  readonly densityKgM3: Readonly<Record<string, number>>;
  readonly transport: {
    /** Haul distance (km) of recovered material to its reuse / recycling destination. 0 is a valid, explicit value. */
    readonly recoveredKm: number | null;
    /** Haul distance (km) of disposed material. */
    readonly disposalKm: number | null;
    /** kgCO₂e per tonne-kilometre. */
    readonly factorKgPerTonneKm: number | null;
  };
}

export const EMPTY_ASSUMPTIONS: Assumptions = Object.freeze({
  replacement: Object.freeze({ direct: null, refurbish: null, recycling: null }),
  replacementByCategory: Object.freeze({}),
  refurbishFactor: Object.freeze({}),
  processingFactor: Object.freeze({}),
  densityKgM3: Object.freeze({}),
  transport: Object.freeze({ recoveredKm: null, disposalKm: null, factorKgPerTonneKm: null }),
});

/** Why a component is not part of an assessed quantity. */
export type Reason = "no_factor" | "no_quantity" | "invalid";
export const REASON_LABELS: Readonly<Record<Reason, string>> = {
  no_factor: "no emission factor set for its material category",
  no_quantity: "no quantity in the factor's unit (for example no mass)",
  invalid: "quantity is not a valid number ≥ 0",
};

export const usesIllustrativeValue = (f: EmissionFactor | undefined | null): boolean => f !== undefined && f !== null && f.origin === "illustrative" && f.value !== null;
