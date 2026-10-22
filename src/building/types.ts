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
  readonly unit: "m" | "m2" | "m3" | "pcs" | "kg";

  readonly condition: ComponentCondition;
  readonly recoveryRoute: RecoveryRoute;
  readonly confidence: EstimationConfidence;

  readonly parentId?: string;
  readonly dependencies: readonly string[];

  readonly originalPosition: readonly [number, number, number];
  readonly originalRotation: readonly [number, number, number];

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
