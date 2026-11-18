/** Exploded view (A4) — public API of the pure engine. */
export * from "./types";
export { DEFAULT_EXPLODE_CONFIG, defaultParams } from "./config";
export { clamp01, ease, norm0, windowed } from "./ease";
export { ASSEMBLY_RULES, STRUCTURE_REASON, UNKNOWN_RULE, clusterLayers, planAssembly, type AssemblyPlan, type AssemblyRule, type DecompositionKind, type UnsupportedAssembly } from "./assemblies";
export { buildExplodeModel, floorIndexOf, floorKeyOf, type Cell, type ExplodeModel } from "./model";
export { ExplodeSolver, solveOffsets } from "./offsets";
export { displayedBounds, displayedBoundsOf, emptyBox, isEmptyBox } from "./bounds";
