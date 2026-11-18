/**
 * Removal simulation (B3) — data model.
 *
 * A dependency edge always reads: the PREREQUISITE must be addressed before the DEPENDENT can be removed.
 * The model's own `dependencies` / `parentId` / `connectedTo` fields do NOT share that direction (see
 * docs/REMOVAL_SIMULATION.md), so every source goes through its own adapter in graph.ts.
 *
 * This is a conceptual planning aid. Nothing here establishes structural stability, load paths, service
 * isolation or a certified removal order.
 */

/** blocking: the dependent cannot be advanced while it is unresolved. advisory: warns only. unknown: a relationship exists but implies no order. */
export type Severity = "blocking" | "advisory" | "unknown";

/** model: stated by a model field (direction read by a documented adapter). rule: derived by a documented rule. user: entered by the user. */
export type EdgeSource = "model" | "rule" | "user";

export type Relationship =
  | "bears_on" // A1: a supported element goes before the member it bears on
  | "hosted_in" // A2: an opening goes before the wall/lintel that hosts it
  | "fed_from" // A3 supply: the feeding (upstream) element is addressed first
  | "drains_into" // A3 drainage: the discharging element goes before the one it drains into
  | "unordered_flow" // A3 dependency whose direction cannot be read for removal order
  | "connected_to" // A3 physical joint: symmetric, no order
  | "user"; // user-defined

export const RELATIONSHIP_LABELS: Readonly<Record<Relationship, string>> = {
  bears_on: "bears on",
  hosted_in: "hosted in",
  fed_from: "fed from",
  drains_into: "drains into",
  unordered_flow: "flow dependency (direction unknown)",
  connected_to: "connected to",
  user: "user-defined",
};

export interface DependencyEdge {
  /** Stable, unique per (source, relationship, ends). */
  readonly id: string;
  readonly prerequisiteId: string;
  readonly dependentId: string;
  readonly relationship: Relationship;
  readonly severity: Severity;
  /** false: the relationship implies no removal order (the two ends are a sorted pair). */
  readonly directed: boolean;
  readonly source: EdgeSource;
  /** Where the relationship was read from, e.g. "STR-BM-F01-X-A1-B1.dependencies". */
  readonly via: string;
  /** Concise, human-readable explanation. */
  readonly reason: string;
}

/** The minimal view of a model record the graph needs. */
export interface GraphNode {
  readonly id: string;
  readonly name: string;
  readonly system: string;
  readonly componentType: string;
  readonly floor: number;
  /** A1: the member beneath. A2/A3: the containing assembly (only meaningful as containment when that parent is a group). */
  readonly parentId?: string;
  readonly dependencies: readonly string[];
  readonly connectedTo?: readonly string[];
  readonly networkId?: string;
  /** Assembly record (not drawn): its children are parts removed together with it. */
  readonly group: boolean;
}

// ── Plans ──────────────────────────────────────────────────────────────────

export interface UserEdge {
  readonly id: string;
  readonly prerequisiteId: string;
  readonly dependentId: string;
  readonly severity: "blocking" | "advisory";
  /** Mandatory: why the user believes this prerequisite exists. */
  readonly reason: string;
}

/** Plan data lives apart from the model and from B1/B2 data and references components by ID only. */
export interface RemovalPlan {
  readonly id: string;
  readonly name: string;
  /** Ordered record ids. An assembly id stands for all of its parts. */
  readonly entries: readonly string[];
  readonly notes: Readonly<Record<string, string>>;
  readonly userEdges: readonly UserEdge[];
  /** Simulation position: entries [0, cursor) are simulated as removed. Not persisted. */
  readonly cursor: number;
}

export type RemovalState = "planned" | "ready_for_review" | "simulated_removed";
export const STATE_LABELS: Readonly<Record<RemovalState | "not_planned", string>> = {
  not_planned: "Not planned",
  planned: "Planned",
  ready_for_review: "Ready for review",
  simulated_removed: "Simulated as removed",
};

export type FindingCode =
  | "MISSING_REF"
  | "DUPLICATE_ENTRY"
  | "OVERLAP_ENTRY"
  | "PREREQ_NOT_IN_PLAN"
  | "ORDER_VIOLATION"
  | "CYCLE"
  | "ADVISORY_NOT_IN_PLAN"
  | "ADVISORY_ORDER"
  | "UNKNOWN_LINK"
  | "USER_EDGE_INACTIVE"
  | "ISOLATION_UNCONFIRMED";

/** error = hard blocker; warning = advisory; review = unknown relationship needing review; info = context only. */
export type FindingLevel = "error" | "warning" | "review" | "info";

export interface Finding {
  readonly code: FindingCode;
  readonly level: FindingLevel;
  /** Sequence position the finding is attached to (-1 for plan-level findings). */
  readonly entryIndex: number;
  readonly entryId: string;
  /** How many underlying relationships were folded into this finding. */
  readonly count: number;
  readonly message: string;
  /** A bounded sample of the relationships behind the finding. */
  readonly edges: readonly DependencyEdge[];
  readonly source: EdgeSource;
}

export interface EntryAnalysis {
  readonly index: number;
  readonly id: string;
  readonly exists: boolean;
  /** Every record id this entry stands for (itself, plus an assembly's parts); empty when missing or duplicate. */
  readonly coverage: readonly string[];
  readonly leafCount: number;
  /** Latest sequence position of an in-plan blocking prerequisite (-1 when none). Cursor-independent. */
  readonly blockingPrereq: number;
  /** Calculated condition: at least one hard error is attached to the entry. */
  readonly blocked: boolean;
  readonly state: RemovalState;
  readonly findings: readonly Finding[];
}

export interface PlanAnalysis {
  readonly entries: readonly EntryAnalysis[];
  readonly findings: readonly Finding[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly reviewCount: number;
  /** Entries with at least one hard error (cannot be advanced). */
  readonly blockedCount: number;
  /** First entry at or after the cursor that is ready for review (null when none). The cursor itself means "Next" is available. */
  readonly nextAvailable: number | null;
  /** Cycles among sequence entries (blocking relationships), each as a list of entry ids closed on its first. */
  readonly cycles: readonly (readonly string[])[];
  /** Blocking relationships between distinct entries, as [prerequisite index, dependent index]. */
  readonly entryEdges: readonly (readonly [number, number])[];
  /** Record id -> index of the entry that stands for it. */
  readonly owner: ReadonlyMap<string, number>;
}
