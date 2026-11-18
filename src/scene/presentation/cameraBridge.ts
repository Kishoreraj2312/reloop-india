import type { Pose } from "./cameraPath";

/**
 * Camera actions the presentation layer (outside the Canvas) asks the 3D side (CameraDirector, inside it) to perform. Like the
 * explode bridge, the camera never moves by itself: every flight is a user request (a preset, a guided step, Exit).
 */
export interface CameraBridge {
  /** The camera's current pose, or null before the viewer is ready. */
  current: (() => Pose) | null;
  /** Fly to a pose; resolves true when it arrived, false when the user took the camera (or another flight replaced it). */
  flyTo: ((pose: Pose, ms?: number, maxDistance?: number) => Promise<boolean>) | null;
  /** Place the camera without animation. */
  jumpTo: ((pose: Pose, maxDistance?: number) => void) | null;
  /** True while a flight runs. */
  flying: () => boolean;
}

export const cameraBridge: CameraBridge = { current: null, flyTo: null, jumpTo: null, flying: () => false };
