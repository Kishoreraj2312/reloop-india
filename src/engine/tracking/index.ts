/** Recovery tracking (C3) — public API. */
export * from "./types";
export { fold, isTerminal, summarize, type Fold, type PlanView, type Summary } from "./summary";
export { apply, availableError, moveError, moves, parseAt, quantityError, start, structuralError, syncAllocations, type Op, type OpContext, type OpResult, type StartInput } from "./ops";
export { EMPTY_PLAN, liveFn, planNow, planScope, snapshotOf, type AllocationInput, type ScopeEvidence, type TrackingContext } from "./plan";
export {
  FLOOR_NAMES,
  buildRows,
  byCategory,
  byFloor,
  byStatus,
  coverage,
  discrepancies,
  isClosed,
  reconcileRows,
  rollup,
  statusCounts,
  totals,
  unresolved,
  type Coverage,
  type Discrepancy,
  type Rollup,
  type Row,
  type Unresolved,
} from "./report";
export { createBatch, deleteBatch, leafIdsOf, renameBatch, type BatchEdit } from "./batches";
export { EMPTY_TRACKING, PERSIST_VERSION, parseTracking, serializeTracking, type ParsedTracking, type PersistedTracking } from "./persist";
export { CSV_HEADER, SCHEMA, trackingFileName, trackingToCsv, trackingToJson } from "./export";
