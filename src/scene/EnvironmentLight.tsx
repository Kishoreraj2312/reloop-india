/**
 * Procedural environment lighting (three's RoomEnvironment through PMREM): soft image-based
 * light and reflections for glass and metals. No external HDRI is downloaded.
 */

import { useEffect } from "react";
import { PMREMGenerator } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useThree } from "@react-three/fiber";

export function EnvironmentLight({ intensity = 0.5 }: { intensity?: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = intensity;
    invalidate();
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
      room.dispose();
    };
  }, [gl, scene, intensity, invalidate]);

  return null;
}
