/** Embodied-carbon assessment (B5) — public API. */
export * from "./types";
export { collect, collectCached, massOf, measureIn, volumeM3, type CategoryAgg, type Collected } from "./collect";
export {
  categoryBases,
  emptyFactor,
  factorUnitLabel,
  illustrativeFactors,
  NOT_IN_MODEL_SLOTS,
  parseNonNegative,
  removeFactor,
  setFactor,
  UNITS,
  validateFactor,
  type CategoryBases,
  type FactorEdit,
} from "./factors";
export { setCategoryValue, setReplacement, setTransport, type AssumptionEdit } from "./assumptions";
export { priceBaseline, priceScenario, type Baseline, type BaselineRow, type MissingInput, type NetStatus, type RowStatus, type ScenarioCarbon, type ScenarioCategory } from "./price";
export { sensitivity, type Sensitivity, type SensitivityRow } from "./sensitivity";
export { parseCarbon, serializeCarbon, PERSIST_VERSION, type PersistedCarbon } from "./persist";
export { categoryLeafIds, componentCarbon, unassessedLeafIds, type ComponentCarbon } from "./component";
