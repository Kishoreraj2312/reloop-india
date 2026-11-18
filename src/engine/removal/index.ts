/** Removal simulation (B3) — public API. */
export * from "./types";
export { RelationshipGraph, dependencyEdge, nodeOf, type NodeSource } from "./graph";
export { analysePlan, removedIds, userEdgeToEdge, withCursor } from "./validate";
export { requiredBefore, suggestOrder, type OrderSuggestion, type RequiredResult } from "./sequence";
export * from "./plan";
export { parsePlans, serializePlans, PERSIST_VERSION, type PersistedPlans } from "./persist";
export { getModelGraph } from "./model";
export { highlightSets, ADVISORY_CAP, type HighlightSets } from "./highlight";
