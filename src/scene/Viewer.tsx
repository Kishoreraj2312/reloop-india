/**
 * Viewer — Canvas, lighting, controls, camera framing and the building model.
 * frameloop is "demand": nothing renders unless the camera, selection or scene changes.
 */

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { DEFAULT_CONFIG, type BuildingConfig } from "@/building/config";
import { buildGrid, openingOf, type ComponentRecord } from "@/building/structure";
import { CameraRig } from "./CameraRig";
import { DevHooks } from "./DevHooks";
import { clipFor, unionBounds, type ClipSpec, type ViewContext, type ViewName } from "./framing";
import { Lighting } from "./Lighting";
import { EnvironmentLight } from "./EnvironmentLight";
import { SelectionOutline } from "./SelectionOutline";
import { BuildingModel } from "./BuildingModel";
import { SiteGround } from "./SiteGround";
import type { ViewState } from "./viewState";

export const BACKGROUND = "#e9ecef";
const FOV = 40;

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
  /** Explicit section plane (keeps coordinates <= value), overriding the view's own. */
  clipOverride?: ClipSpec;
}

export function Viewer({ records, cfg = DEFAULT_CONFIG, view = "full", viewState, onSelect, selectedId = null, onViewState, clipOverride }: ViewerProps) {
  const bounds = useMemo(() => unionBounds(records), [records]);
  const { ctx, groundY, gridSize } = useMemo(() => {
    const grid = buildGrid(cfg);
    const op = openingOf(grid, "stair");
    const viewCtx: ViewContext = {
      stair: {
        centre: [(op.x0 + op.x1) / 2, 0, (op.z0 + op.z1) / 2],
        halfX: (op.x1 - op.x0) / 2,
        halfZ: (op.z1 - op.z0) / 2,
      },
      sectionZ: grid.zs[2]!, // gridline 3: cuts through a full line of columns and beams
      // Stair view: cut just below the beams of L3, so L1..L3 stair storeys are visible.
      stairCutY: grid.levels[3]!.elevation - cfg.beam.depth - 0.1,
    };
    return {
      ctx: viewCtx,
      groundY: -cfg.foundationDepth - 0.02,
      gridSize: 2 * Math.ceil(Math.max(cfg.footprintX, cfg.footprintZ)),
    };
  }, [cfg]);
  const clip = useMemo(() => clipOverride ?? clipFor(view, ctx), [clipOverride, view, ctx]);

  return (
    <Canvas
      frameloop="demand"
      shadows
      dpr={[1, 2]}
      camera={{ fov: FOV, near: 0.2, far: 400, position: [60, 40, 60] }}
      gl={{ antialias: true }}
      onPointerMissed={onSelect ? () => onSelect(null) : undefined}
    >
      <color attach="background" args={[BACKGROUND]} />
      <EnvironmentLight intensity={0.4} />
      <Lighting bounds={bounds} />
      <BuildingModel records={records} onSelect={onSelect} clip={clip} view={viewState} />
      <SiteGround visible={viewState.isolate !== "FDN"} />
      <gridHelper args={[gridSize, gridSize, 0x9aa1a8, 0xc3c8cd]} position={[0, groundY, 0]} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={1} maxDistance={180} minPolarAngle={0} maxPolarAngle={Math.PI / 2 - 0.03} />
      <CameraRig view={view} bounds={bounds} ctx={ctx} />
      <SelectionOutline selectedId={selectedId} />
      {onSelect && import.meta.env.DEV && <DevHooks records={records} onSelect={onSelect} onViewState={onViewState} />}
    </Canvas>
  );
}
