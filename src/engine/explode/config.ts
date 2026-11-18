import type { ExplodeConfig, ExplodeParams } from "./types";

/**
 * Defaults. floorGap 6 m: adjacent floor groups overlap by up to 3.6 m in the assembled model (services reach into the
 * next storey), so 6 m leaves a clear 2.4 m between them at full explosion. The 2 × 2 grid keeps the exploded building
 * roughly cubic (a single row of four systems would be ~180 m wide). Values were tuned on the running application and
 * are documented in docs/EXPLODED_VIEW.md.
 */
export const DEFAULT_EXPLODE_CONFIG: ExplodeConfig = {
  floorGap: 6,
  floorAnchor: 0,
  systemGap: 6,
  systemLayout: "grid",
  systemOrder: ["structure", "architecture", "plumbing", "electrical"],
  assembly: { gap: 0.3, maxSpan: 1.5, radialFactor: 2, layerTolerance: 0.01, minLayers: 2, radialMinDistance: 0.05 },
  phases: { floors: [0, 0.4], systems: [0.35, 0.75], assemblies: [0.7, 1] },
  durations: { cinematic: 9, other: 4 },
};

export const defaultParams = (cfg: ExplodeConfig = DEFAULT_EXPLODE_CONFIG): ExplodeParams => ({
  mode: "assembled",
  t: 0,
  floorGap: cfg.floorGap,
  systemGap: cfg.systemGap,
  assemblyGap: cfg.assembly.gap,
  layout: cfg.systemLayout,
  systems: cfg.systemOrder,
  focus: null,
});
