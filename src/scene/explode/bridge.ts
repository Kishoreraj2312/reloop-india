import type { Cell } from "@/engine/explode";

/**
 * Camera actions the panel asks the 3D side to perform (the panel lives outside the Canvas, the camera inside).
 * The explosion never moves the camera by itself: these run only on a user request.
 */
export interface FrameOptions {
  /** Pixels at the bottom of the canvas covered by UI: the model is framed in the free area above them. */
  bottomInset?: number;
  /** Pixels at the right edge covered by UI (layer panel, drawers): the model is framed in the free area to their left. */
  rightInset?: number;
  /** Pixels at the top edge covered by UI. */
  topInset?: number;
  /** Pixels at the left edge covered by UI (a tall inspector): the model is framed in the free area to its right. */
  leftInset?: number;
  /** View direction (from the model toward the camera) to frame along; defaults to the camera's current direction. */
  direction?: readonly [number, number, number];
}

/** A camera pose computed for a framing request, not applied. */
export interface FramePose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  /** Orbit-controls max distance needed to hold the pose. */
  readonly maxDistance: number;
}

export interface ExplodeBridge {
  /** Frame the displayed bounds of the cells accepted by `visible`, keeping the current view direction. False when nothing is visible. */
  fit: ((visible?: (c: Cell) => boolean, opts?: FrameOptions) => boolean) | null;
  /** Frame one component, or all members of an assembly record, where they are displayed now. False when it is unknown. */
  focus: ((id: string, opts?: FrameOptions) => boolean) | null;
  /**
   * The pose `fit` would apply, computed for the displayed bounds at `params` (default: the current parameters) and NOT applied,
   * so a caller can fly the camera there while the explosion glides. Null when nothing is visible.
   */
  fitPose: ((opts?: FrameOptions, params?: import("@/engine/explode").ExplodeParams) => FramePose | null) | null;
}

export const explodeBridge: ExplodeBridge = { fit: null, focus: null, fitPose: null };
