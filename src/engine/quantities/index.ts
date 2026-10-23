/** Quantity engine (B1) — public API. */
export * from "./types";
export * from "./units";
export { classify, TYPE_CATEGORY } from "./classify";
export { computeComponent } from "./component";
export { MATERIAL_PROPS, HOLLOW_TYPES, densityFor, materialProps, type MaterialProps, type DensityBasis } from "./materialProps";
export { COUNT_RULES, countProducts, countOf, type ProductCount, type ProductCounts } from "./counts";
export { wallTakeoffs, type WallTakeoff, type WallTakeoffs, type OpeningVoid } from "./walls";
export { aggregateBy, totalOf, bucketValue, type AggTotal, type Bucket } from "./aggregate";
export {
  assemblyRollup,
  buildInventory,
  dimensionsLabel,
  filterRows,
  hasWarning,
  leafDescendants,
  massCoverage,
  NOT_MODELLED,
  SORT_COLUMNS,
  sortRows,
  type AssemblyRollup,
  type Breakdowns,
  type Inventory,
  type InventoryRow,
  type MassCoverage,
  type NotModelled,
  type RowFilter,
  type SortColumn,
} from "./inventory";
export { getModelInventory, modelRecords } from "./modelInventory";
export {
  buildSummary,
  categoryCounts,
  concreteTable,
  finishesTable,
  masonryTable,
  measureIn,
  sumMeasure,
  FLOOR_LABEL,
  type BreakdownTable,
  type CategoryCountRow,
  type Summary,
  type SummaryCard,
  type SummaryLine,
} from "./summary";
