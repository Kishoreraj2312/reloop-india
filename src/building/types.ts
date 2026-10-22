/**
 * ReLoop India — Shared Building Component Types
 *
 * Every meaningful building element uses this data model.
 * Baseline records are readonly; scenario state lives separately.
 */

// ── Enumerations ─────────────────────────────────────────────────────────────

export type BuildingSystem = "structure" | "architecture" | "plumbing" | "electrical";

export type RecoveryRoute = "reuse" | "recycle" | "disposal" | "inspect";

export type EstimationConfidence = "assumed" | "estimated" | "measured";

export type ComponentCondition = "good" | "damaged" | "inspect";

// ── Component dimensions ─────────────────────────────────────────────────────

export interface ComponentDimensions {
  length?: number;     // m
  width?: number;      // m
  height?: number;     // m
  diameter?: number;   // m (pipes, conduits)
  thickness?: number;  // m (slabs, walls)
}

// ── Material reference ───────────────────────────────────────────────────────

export interface MaterialRef {
  id: string;           // e.g. "concrete_m30"
  name: string;         // e.g. "M30 Reinforced Concrete"
  densityKgM3: number;  // kg/m³
}

// ── Building component (baseline, readonly at runtime) ───────────────────────

export interface BuildingComponent {
  readonly id: string;
  readonly name: string;
  readonly system: BuildingSystem;
  readonly componentType: string;          // "column", "beam", "slab", "wall", etc.
  readonly floor: number;                  // 0 = Ground, 4 = L4, -1 = foundation
  readonly materialId: string;

  readonly dimensions: ComponentDimensions;
  readonly quantity: number;               // computed volume/area/length/count
  readonly unit: "m" | "m2" | "m3" | "pcs" | "nr" | "kg";

  readonly condition: ComponentCondition;
  readonly recoveryRoute: RecoveryRoute;
  readonly confidence: EstimationConfidence;

  readonly parentId?: string;
  readonly dependencies: readonly string[];

  // Architecture (A2): assembly family and plan location, where relevant
  readonly assemblyType?: string;          // e.g. "window", "wall", "kitchen"
  readonly apartmentId?: string;           // "A1".."A6", "CM" for common areas
  readonly roomId?: string;                // e.g. "A3-LIV", "CM-COR"

  readonly originalPosition: readonly [number, number, number];
  readonly originalRotation: readonly [number, number, number];

  // MEP (A3): network membership and explicit connectivity, where relevant
  readonly networkId?: string;             // e.g. "PLB-NET-CW-F01-A1", "ELC-NET-CIR-F01-A1-L1"
  /** Other networks this component carries (conduits/trays: the circuits whose cables run in them). */
  readonly carries?: readonly string[];
  /** Components this one physically joins (both directions; may include A2 endpoints). */
  readonly connectedTo?: readonly string[];
  readonly nominalSize?: string;           // "DN25", "110 mm", "2.5 sq mm", "300 x 75"
  /** Fall of a drainage run (1/60 = 1 in 60), downstream from `flowFrom` to `flowTo`. */
  readonly gradient?: number;
  readonly flowFrom?: readonly [number, number, number];
  readonly flowTo?: readonly [number, number, number];

  // Reserved for B-phase (material passport)
  readonly densityKgM3?: number;
  readonly estimatedMassKg?: number;
  readonly assumptions?: string;
  readonly source?: string;
}

// ── Scenario overlay (mutable, keyed by component ID) ────────────────────────

export interface ScenarioComponentState {
  removed: boolean;
  removalPhase?: number;
  notes?: string;
}

export type ScenarioOverlay = Map<string, ScenarioComponentState>;
