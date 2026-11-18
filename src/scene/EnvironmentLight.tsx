/**
 * Atmosphere: procedural sky environment (image-based light and reflections, prefiltered once by PMREM), the backdrop
 * gradient and the renderer's tone mapping. No external HDRI is downloaded. See look/skyEnvironment.ts.
 */

import { useEffect } from "react";
import { NeutralToneMapping, PMREMGenerator } from "three";
import { useThree } from "@react-three/fiber";
import { LIGHT } from "./look/palette";
import { backdropTexture, buildSkyScene } from "./look/skyEnvironment";

export function EnvironmentLight({ intensity = LIGHT.environmentIntensity }: { intensity?: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const sky = buildSkyScene();
    const env = pmrem.fromScene(sky, 0.02).texture;
    const backdrop = backdropTexture();
    const tm = gl.toneMapping;
    const exposure = gl.toneMappingExposure;
    // Khronos PBR Neutral: keeps plaster, timber and paint close to their authored colours while still rolling off highlights
    gl.toneMapping = NeutralToneMapping;
    gl.toneMappingExposure = LIGHT.exposure;
    scene.environment = env;
    scene.environmentIntensity = intensity;
    scene.background = backdrop;
    invalidate();
    return () => {
      gl.toneMapping = tm;
      gl.toneMappingExposure = exposure;
      scene.environment = null;
      scene.background = null;
      env.dispose();
      backdrop.dispose();
      pmrem.dispose();
      sky.traverse((o) => {
        const m = o as { geometry?: { dispose(): void }; material?: { dispose(): void } };
        m.geometry?.dispose();
        m.material?.dispose();
      });
    };
  }, [gl, scene, intensity, invalidate]);

  return null;
}
