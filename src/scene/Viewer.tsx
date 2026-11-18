/**
 * Viewer — Canvas, lighting, controls, camera framing and the building model.
 * frameloop is "demand": nothing renders unless the camera, selection or scene changes.
 */

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { DEFAULT_CONFIG, type BuildingConfig } from "@/building/config";
import type { ComponentRecord } from "@/building/structure";
import { CameraRig } from "./CameraRig";
import { DevHooks } from "./DevHooks";
import { clipFor, unionBounds, VIEWER_FOV, type ClipSpec, type ViewName } from "./framing";
import { makeViewContext } from "./viewContext";
import { Lighting } from "./Lighting";
import { EnvironmentLight } from "./EnvironmentLight";
import { SelectionOutline } from "./SelectionOutline";
import { BuildingModel } from "./BuildingModel";
import { RecoveryColoring } from "./recovery/RecoveryColoring";
import { ExplodeController } from "./explode/ExplodeController";
import { ExplodeTraces } from "./explode/ExplodeTraces";
import { RemovalOverlay } from "./removal/RemovalOverlay";
import { removalStore, removedSet, useRemoval } from "./removal/removalStore";
import { ScenarioHighlight } from "./scenarios/ScenarioHighlight";
import { SiteGround } from "./SiteGround";
import { CameraDirector } from "./presentation/CameraDirector";
import { PostEffects } from "./look/PostEffects";
import type { ViewState } from "./viewState";

export const BACKGROUND = "#cfd0c8"; // the haze colour of the backdrop gradient (look/palette.ts)

/** The selection outline of a component that the removal simulation has hidden would float in empty space: skip it. */
function GatedSelectionOutline({ selectedId, traceIds }: { selectedId: string | null; traceIds?: readonly string[] }) {
  const rm = useRemoval();
  const hidden = rm.open && rm.overlay && selectedId !== null && removedSet(removalStore.activePlan()).has(selectedId);
  return <SelectionOutline selectedId={hidden ? null : selectedId} {...(traceIds ? { traceIds } : {})} />;
}

interface ViewerProps {
  records: readonly ComponentRecord[];
  cfg?: BuildingConfig;
  view?: ViewName;
  viewState: ViewState;
  /** When provided, clicking a component selects it (and empty space clears). */
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
  /** Dev hook: lets the browser verification script change the view state. */
  onViewState?: (v: ViewState) => void;
  /** Explicit section plane (keeps coordinates <= value), overriding the view's own; null = explicitly none. */
  clipOverride?: ClipSpec | null;
  /** Components highlighted by a network trace. */
  traceIds?: readonly string[];
}

export function Viewer({ records, cfg = DEFAULT_CONFIG, view = "full", viewState, onSelect, selectedId = null, onViewState, clipOverride, traceIds }: ViewerProps) {
  // Framing and the shadow camera follow the building itself (site MEP items lie outside it).
  const bounds = useMemo(() => unionBounds(records.filter((r) => r.system === "structure" || r.system === "architecture")), [records]);
  const { ctx, groundY, gridSize } = useMemo(
    () => ({ ctx: makeViewContext(cfg), groundY: -cfg.foundationDepth - 0.02, gridSize: 2 * Math.ceil(Math.max(cfg.footprintX, cfg.footprintZ)) }),
    [cfg],
  );
  // the forecourt path of the site ground starts at the main entrance (presentation only)
  const entrance = useMemo(() => {
    const e = records.find((r) => r.id === "ARC-ENT-G-MAIN");
    return e ? ([e.originalPosition[0], e.originalPosition[2]] as const) : undefined;
  }, [records]);
  const clip = useMemo(() => (clipOverride !== undefined ? (clipOverride ?? undefined) : clipFor(view, ctx)), [clipOverride, view, ctx]);

  return (
    <Canvas
      frameloop="demand"
      shadows
      dpr={[1, 2]}
      camera={{ fov: VIEWER_FOV, near: 0.2, far: 400, position: [60, 40, 60] }}
      gl={{ antialias: true }}
      onPointerMissed={onSelect ? () => onSelect(null) : undefined}
    >
      <EnvironmentLight />
      <Lighting bounds={bounds} />
      <BuildingModel records={records} onSelect={onSelect} clip={clip} view={viewState} />
      <SiteGround visible={viewState.isolate !== "FDN"} footprint={bounds} {...(entrance ? { entrance } : {})} />
      {viewState.isolate === "FDN" && <gridHelper args={[gridSize, gridSize, 0xa7adb2, 0xcdd1d4]} position={[0, groundY, 0]} />}
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={1} maxDistance={180} minPolarAngle={0} maxPolarAngle={Math.PI / 2 - 0.03} />
      <CameraRig view={view} bounds={bounds} ctx={ctx} />
      <CameraDirector />
      <RecoveryColoring clipKey={clip ? `${clip.axis}:${clip.value}` : ""} xray={!!viewState.xray} />
      <ExplodeController />
      <ExplodeTraces selectedId={selectedId} />
      <RemovalOverlay selectedId={selectedId} clipKey={clip ? `${clip.axis}:${clip.value}` : ""} xray={!!viewState.xray} />
      <ScenarioHighlight selectedId={selectedId} clipKey={clip ? `${clip.axis}:${clip.value}` : ""} xray={!!viewState.xray} />
      <PostEffects bounds={bounds} />
      <GatedSelectionOutline selectedId={selectedId} {...(traceIds ? { traceIds } : {})} />
      {onSelect && import.meta.env.DEV && <DevHooks records={records} onSelect={onSelect} onViewState={onViewState} />}
    </Canvas>
  );
}
