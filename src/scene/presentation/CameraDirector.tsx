/**
 * Camera director (inside the Canvas, renders nothing). Flies the camera between poses on request (presentation presets and
 * guided steps) with the orbit-style path of cameraPath.ts, then hands control straight back: any pointer, wheel or touch start on
 * the orbit controls ends a flight where it is, so the presenter is never fighting an animation.
 */

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three/examples/jsm/controls/OrbitControls.js";
import { cameraBridge } from "./cameraBridge";
import { easeInOutCubic, planFlight, type Flight, type Pose } from "./cameraPath";

interface Anim {
  readonly flight: Flight;
  elapsed: number;
  readonly done: (arrived: boolean) => void;
}

export function CameraDirector() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);
  const anim = useRef<Anim | null>(null);

  const place = (p: Pose, maxDistance?: number) => {
    if (!controls) return;
    const d = Math.hypot(p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2]);
    controls.maxDistance = Math.max(controls.maxDistance, maxDistance ?? 0, d * 1.25);
    camera.position.set(...p.position);
    controls.target.set(...p.target);
    camera.lookAt(controls.target);
    controls.update();
  };

  useEffect(() => {
    if (!controls) return;
    const pose = (): Pose => ({ position: camera.position.toArray() as [number, number, number], target: controls.target.toArray() as [number, number, number] });
    const cancel = (arrived = false) => {
      const a = anim.current;
      anim.current = null;
      a?.done(arrived);
    };
    cameraBridge.current = pose;
    cameraBridge.jumpTo = (p, maxDistance) => {
      cancel();
      place(p, maxDistance);
      invalidate();
    };
    cameraBridge.flyTo = (p, ms, maxDistance) => {
      cancel();
      const flight = planFlight(pose(), p, ms);
      const d = Math.hypot(p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2]);
      controls.maxDistance = Math.max(controls.maxDistance, maxDistance ?? 0, d * 1.25);
      return new Promise<boolean>((resolve) => {
        anim.current = { flight, elapsed: 0, done: resolve };
        invalidate();
      });
    };
    cameraBridge.flying = () => anim.current !== null;
    const onStart = () => cancel(false); // the user took the camera
    controls.addEventListener("start", onStart);
    return () => {
      controls.removeEventListener("start", onStart);
      cancel(false);
      cameraBridge.current = null;
      cameraBridge.flyTo = null;
      cameraBridge.jumpTo = null;
      cameraBridge.flying = () => false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- place() only reads stable three.js objects
  }, [camera, controls, invalidate]);

  useFrame((_, delta) => {
    const a = anim.current;
    if (!a || !controls) return;
    a.elapsed += Math.min(delta, 0.1) * 1000;
    const k = Math.min(1, a.elapsed / a.flight.ms);
    place(a.flight.at(easeInOutCubic(k)));
    if (k >= 1) {
      anim.current = null;
      a.done(true);
    }
    invalidate();
  });

  return null;
}
