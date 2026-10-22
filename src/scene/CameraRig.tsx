/**
 * Places the camera for a named view (framed from the generated bounds). Re-frames on
 * window resize only until the user first moves the camera.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import type { PerspectiveCamera } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three/examples/jsm/controls/OrbitControls.js";
import { useThree } from "@react-three/fiber";
import type { Box3 } from "@/building/structure";
import { viewSpec, type ViewContext, type ViewName } from "./framing";

interface CameraRigProps {
  view: ViewName;
  bounds: Box3;
  ctx: ViewContext;
}

export function CameraRig({ view, bounds, ctx }: CameraRigProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const userMoved = useRef(false);
  const lastView = useRef<ViewName | null>(null);

  useEffect(() => {
    if (!controls) return;
    const onStart = () => {
      userMoved.current = true;
    };
    controls.addEventListener("start", onStart);
    return () => controls.removeEventListener("start", onStart);
  }, [controls]);

  useLayoutEffect(() => {
    if (!controls || size.width === 0 || size.height === 0) return;
    const viewChanged = lastView.current !== view;
    if (!viewChanged && userMoved.current) return;
    lastView.current = view;
    userMoved.current = false;

    const spec = viewSpec(view, bounds, camera.fov, size.width / size.height, ctx);
    camera.position.set(...spec.pose.position);
    controls.target.set(...spec.pose.target);
    camera.lookAt(controls.target);
    controls.update();
    invalidate();
  }, [view, bounds, ctx, controls, size.width, size.height, camera, invalidate]);

  return null;
}
