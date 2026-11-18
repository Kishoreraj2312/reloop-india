/**
 * Classification of the building's materials into procedural surface treatments (pure; no GPU objects).
 *
 * The treatment follows the material's recorded `substance` and id, i.e. what the model ASSUMES the surface is made of; it is an
 * appearance, not a verified specification, and never changes a component's dimensions, quantities or material record.
 * `tone` / `rough` / `bump` are small, deliberately restrained amplitudes.
 */

import type { Substance } from "@/building/architecture/materials";

export type SurfacePattern = "none" | "plaster" | "concrete" | "granite" | "ashlar" | "tile" | "timber" | "brushed" | "ground" | "glass";

export interface SurfaceSpec {
  readonly pattern: SurfacePattern;
  /** Albedo variation (fraction of the base colour). */
  readonly tone: number;
  /** Roughness variation (absolute, 0..1). */
  readonly rough: number;
  /** Normal perturbation strength (0 = none). */
  readonly bump: number;
  /** Tile / block / course size in metres [along, across] for the patterns that have joints. */
  readonly cell?: readonly [number, number];
  /** Half joint width in metres. */
  readonly joint?: number;
  /** Per-piece tone variation (each instance gets its own random tone). */
  readonly piece?: number;
  /** Running-bond offset of alternate courses (ashlar). */
  readonly stagger?: boolean;
}

const NONE: SurfaceSpec = { pattern: "none", tone: 0, rough: 0, bump: 0 };

const spec = (pattern: SurfacePattern, tone: number, rough: number, bump: number, extra: Partial<SurfaceSpec> = {}): SurfaceSpec => ({ pattern, tone, rough, bump, ...extra });

/** Per-material overrides (by material id). */
const BY_ID: Readonly<Record<string, SurfaceSpec>> = {
  // Plaster and paint
  masonry_paint_ext: spec("plaster", 0.075, 0.05, 0.5),
  masonry_paint_int: spec("plaster", 0.035, 0.04, 0.3),
  masonry_paint_core: spec("plaster", 0.05, 0.04, 0.35),
  lintel_rcc_ext: spec("plaster", 0.07, 0.05, 0.5),
  lintel_rcc_int: spec("plaster", 0.035, 0.04, 0.3),
  concrete_balcony: spec("plaster", 0.07, 0.05, 0.5),
  concrete_band: spec("plaster", 0.09, 0.06, 0.7),
  plaster_soffit: spec("plaster", 0.05, 0.04, 0.3),
  ceiling_gypsum: spec("plaster", 0.02, 0.03, 0.15),
  // Concrete
  concrete_fin: spec("concrete", 0.12, 0.08, 0.8),
  concrete_precast: spec("concrete", 0.1, 0.07, 0.7),
  cement_screed: spec("concrete", 0.1, 0.06, 0.5),
  // Stone
  stone_cladding: spec("ashlar", 0.1, 0.07, 0.8, { cell: [0.6, 0.3], joint: 0.004, piece: 0.09, stagger: true }),
  stone_coping: spec("granite", 0.12, 0.08, 0.2),
  stone_tread: spec("granite", 0.1, 0.06, 0.15),
  countertop_granite: spec("granite", 0.28, 0.06, 0.1),
  // Tiles (each tile is its own instance, so the per-piece tone follows the real tile boundaries)
  tile_porcelain_floor: spec("tile", 0.025, 0.05, 0, { piece: 0.035 }),
  tile_antiskid: spec("tile", 0.05, 0.08, 0.25, { piece: 0.05 }),
  tile_wall_ceramic: spec("tile", 0.01, 0.03, 0, { piece: 0.02 }),
  tile_backsplash: spec("tile", 0.012, 0.03, 0, { piece: 0.03 }),
  tile_balcony: spec("tile", 0.08, 0.08, 0.35, { piece: 0.07 }),
  roof_finish: spec("ashlar", 0.05, 0.07, 0.2, { cell: [0.6, 0.6], joint: 0.003, piece: 0.035, stagger: false }),
  // Timber and laminates
  timber_door_teak: spec("timber", 0.2, 0.12, 0.25, { piece: 0.06 }),
  timber_door_light: spec("timber", 0.17, 0.12, 0.25, { piece: 0.06 }),
  timber_frame: spec("timber", 0.17, 0.1, 0.2, { piece: 0.05 }),
  cabinet_laminate: spec("timber", 0.05, 0.05, 0, { piece: 0.03 }),
  // Metals
  metal_hardware: spec("brushed", 0.04, 0.1, 0),
  stainless_steel: spec("brushed", 0.04, 0.1, 0),
  metal_frame: spec("brushed", 0.03, 0.06, 0),
  metal_railing: spec("brushed", 0.03, 0.06, 0),
  tray_gi: spec("brushed", 0.05, 0.08, 0),
  // Glass
  glass_clear: spec("glass", 0, 0, 0),
};

/**
 * Reflectivity adjustments (appearance only). Glossy floor tiles and sanitaryware mirror the whole sky at grazing angles, which in
 * a cut-away interior reads as a blue wash; keep their gloss but limit what they reflect. Library values are left untouched.
 */
const REFLECTION: Partial<Record<Substance, { roughnessMin?: number; envMapIntensity: number }>> = {
  porcelain_tile: { roughnessMin: 0.55, envMapIntensity: 0.3 },
  ceramic_tile: { roughnessMin: 0.5, envMapIntensity: 0.3 },
  sanitary_ceramic: { roughnessMin: 0.25, envMapIntensity: 0.6 },
  laminate_board: { envMapIntensity: 0.5 },
  stone: { envMapIntensity: 0.5 },
  gypsum_board: { envMapIntensity: 0.5 },
  brick_masonry: { envMapIntensity: 0.6 },
  concrete: { envMapIntensity: 0.6 },
};

export function reflectionFor(substance: Substance, roughness: number, envMapIntensity: number | undefined): { roughness: number; envMapIntensity: number } {
  const r = REFLECTION[substance];
  if (!r) return { roughness, envMapIntensity: envMapIntensity ?? 1 };
  return { roughness: Math.max(roughness, r.roughnessMin ?? 0), envMapIntensity: Math.min(envMapIntensity ?? 1, r.envMapIntensity) };
}

/** Fallback by substance for a material without an explicit entry. */
const BY_SUBSTANCE: Partial<Record<Substance, SurfaceSpec>> = {
  brick_masonry: spec("plaster", 0.05, 0.04, 0.35),
  concrete: spec("concrete", 0.1, 0.07, 0.6),
  cement_screed: spec("concrete", 0.08, 0.05, 0.4),
  stone: spec("granite", 0.1, 0.06, 0.2),
  timber: spec("timber", 0.16, 0.1, 0.2, { piece: 0.05 }),
  glass: spec("glass", 0, 0, 0),
};

export function surfaceSpecFor(materialId: string, substance?: Substance): SurfaceSpec {
  return BY_ID[materialId] ?? (substance ? BY_SUBSTANCE[substance] : undefined) ?? NONE;
}

/** Structural members (A1 has one RCC material; the member kinds differ only in tone, kept for readability). */
export const STRUCTURE_SPEC: SurfaceSpec = spec("concrete", 0.1, 0.07, 0.6);
export const GROUND_SPEC: SurfaceSpec = spec("ground", 0.03, 0.03, 0);

/** Every pattern that needs the noise texture and a shader patch. */
export const isTextured = (s: SurfaceSpec): boolean => s.pattern !== "none";
