/** Recovery & reuse assessment (B2) — public API. */
export * from "./types";
export { suggestFor, type Suggestion } from "./suggestions";
export { applyPatch, evaluateRow, parsePct, targetLeafIds, validatePct, type ComponentRecovery, type PatchResult } from "./assess";
export { GROUP_BYS, GROUP_BY_LABELS, groupKey, substanceOf, summarize, type GroupBy, type RecoveryRow, type RecoverySummary } from "./summary";
export { parseAssessments, serializeAssessments, PERSIST_VERSION } from "./persist";
export { fillWithStarter, isOverStarter, parseOverStarter, serializeOverStarter, starterAssessments, starterGroups, STARTER_NOTE, type StarterGroup } from "./starter";
