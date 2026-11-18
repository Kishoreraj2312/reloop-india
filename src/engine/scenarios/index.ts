/** End-of-life scenarios (B4) — public API. */
export * from "./types";
export { allocate, nearlyEqual, outcomeSum, zeroQuantities, type Allocation } from "./allocate";
export {
  ASSESSMENT_RULE,
  DISPOSAL_RULE,
  UNKNOWN_RULE,
  describeRule,
  effectiveOf,
  makeRule,
  resolveRule,
  rulesEqual,
  templateRule,
  validateRule,
  type Effective,
  type Resolved,
  type RuleSource,
} from "./rules";
export { assessedCategories, newScenario, templateDefaults, TEMPLATE_INFO, type TemplateDefaults, type TemplateInfo } from "./templates";
export {
  duplicateScenario,
  isModified,
  parseRecoveryPct,
  renameScenario,
  resetScenario,
  setBaseline,
  setCategoryRule,
  setComponentRule,
  setComponentRules,
  setResidual,
  setScope,
  type EditResult,
} from "./edit";
export {
  assemblyAncestors,
  categoryLabel,
  computeScenario,
  decide,
  diverted,
  evaluateLeaf,
  makeContext,
  materialCategoryOf,
  MIN_MASS_VOLUME_COVERAGE_PCT,
  resultFor,
  staleRules,
  type BasisResult,
  type CategoryRow,
  type EvalContext,
  type LeafDecision,
  type LeafOutcome,
  type MassCoverageInfo,
  type MissingAssumption,
  type ScenarioResult,
  type WholeBuilding,
} from "./compute";
export { compareRows, describeDifferences, OUTCOME_ORDER, totalOfUnit, treatmentOf, unitsOf, type CompareRow, type Difference, type DifferenceGroup } from "./compare";
export { matchLeaves, selectorKey, type Match, type Selector } from "./match";
export { parseScenarios, serializeScenarios, PERSIST_VERSION, type PersistedScenarios } from "./persist";
export { removalContext, type RemovalContext } from "./context";
