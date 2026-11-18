/**
 * Exploded view (A4) — types.
 *
 * The explosion is a DERIVED display transform: displayed = canonical + offset(params). Nothing here is ever written
 * back to records, registry, B1 quantities, B2 assessments or B3 plans. An offset is a pure translation, so the
 * per-component effective offset is the (order-independent) sum floorOffset + systemOffset + assemblyOffset.
 */

import type { LevelName } from "@/building/config";
import type { BuildingSystem } from "@/building/types";

export type Vec3 = readonly [number, number, number];

/** Floor group key; identical to the scene hierarchy's FloorKey (asserted by a test). */
export type FloorKey = "FDN" | LevelName;

export const EXPLODE_MODES = ["assembled", "floors", "systems", "assembly", "cinematic"] as const;
export type ExplodeMode = (typeof EXPLODE_MODES)[number];

export const MODE_LABELS: Readonly<Record<ExplodeMode, string>> = {
  assembled: "Assembled",
  floors: "Floors",
  systems: "Systems",
  assembly: "Assembly focus",
  cinematic: "Cinematic",
};

/** How the system layers are arranged: a row along X or Z, or a 2 × 2 grid. */
export type SystemLayout = "grid" | "row-x" | "row-z";
export const SYSTEM_LAYOUTS: readonly SystemLayout[] = ["grid", "row-x", "row-z"];
export const LAYOUT_LABELS: Readonly<Record<SystemLayout, string>> = { grid: "2 × 2 grid", "row-x": "Row along X", "row-z": "Row along Z" };

export type Window = readonly [number, number];

export interface ExplodeConfig {
  /** Metres between consecutive floor groups at full explosion. */
  readonly floorGap: number;
  /** Floor index (record.floor) that stays in place; groups below move down, groups above move up. */
  readonly floorAnchor: number;
  /** Clear metres between system footprints at full explosion. */
  readonly systemGap: number;
  readonly systemLayout: SystemLayout;
  readonly systemOrder: readonly BuildingSystem[];
  readonly assembly: {
    /** Metres between adjacent layers of a decomposed assembly. */
    readonly gap: number;
    /** Cap on the total spread of one assembly (metres). */
    readonly maxSpan: number;
    /** Radial members move `radialFactor × gap` metres away from the assembly centre. */
    readonly radialFactor: number;
    /** Members whose centres differ by at most this (metres) along the axis share a layer. */
    readonly layerTolerance: number;
    readonly minLayers: number;
    /** A member closer than this to the assembly centre (plan, metres) has no radial direction. */
    readonly radialMinDistance: number;
  };
  /** Master-progress windows of the cinematic sequence (floors, then systems, then assemblies). */
  readonly phases: { readonly floors: Window; readonly systems: Window; readonly assemblies: Window };
  /** Playback length in seconds. */
  readonly durations: { readonly cinematic: number; readonly other: number };
}

/** The parameters the user controls. */
export interface ExplodeParams {
  readonly mode: ExplodeMode;
  /** Master progress, 0 (assembled) to 1 (fully exploded). */
  readonly t: number;
  readonly floorGap: number;
  readonly systemGap: number;
  readonly assemblyGap: number;
  readonly layout: SystemLayout;
  /** Systems that take part in the system explosion (the others stay where they are). */
  readonly systems: readonly BuildingSystem[];
  /** Assembly record id decomposed in "assembly" mode (null: none chosen). */
  readonly focus: string | null;
}

export type Box = { min: [number, number, number]; max: [number, number, number] };
