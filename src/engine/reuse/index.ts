/** Material reuse matching (C2) — public API. */
export * from "./types";
export { EPS, axisValue, fmtMm, fmtQty, fmtQtyU, materialName, sizeLabel, supplyOf, typeLabel } from "./source";
export {
  EMPTY_DRAFT,
  createRequirement,
  draftFromComponent,
  draftOf,
  isDefaultConfig,
  updateRequirement,
  validateConfig,
  validateDraft,
  withWeight,
  type RequirementDraft,
  type RequirementEdit,
} from "./requirement";
export { evaluate, explain, matchRequirement, opportunities, ranked, rowsOfSubstance, scopeInfo, substanceIndex, substanceLabel, type MatchContext, type MatchResult, type ScopeInfo, type SubstanceInfo } from "./match";
export {
  allocate,
  allocateBatch,
  allocatedByComponent,
  allocatedByRequirement,
  demandRows,
  demandStatus,
  freeOf,
  reconcile,
  removeAllocation,
  removeForComponent,
  removeForRequirement,
  reviewAllocations,
  statusCounts,
  totalsByUnit,
  type AllocateInput,
  type AllocateResult,
  type DemandRow,
  type UnitTotal,
} from "./ledger";
export { MAX_PROPOSAL, potentialSupply, proposeFill, type Proposal, type ProposalItem } from "./suggest";
export { EMPTY_REUSE, parseReuse, serializeReuse, PERSIST_VERSION, type ParsedReuse, type PersistedReuse } from "./persist";
export { CSV_HEADER, planFileName, planToCsv, planToJson, SCHEMA, type PlanInput } from "./export";
