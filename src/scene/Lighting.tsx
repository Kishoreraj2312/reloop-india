/**
 * Key light, soft hemisphere fill, sized from the building bounds. The model is static, so the shadow map is rendered once and
 * then frozen (re-enabled with gl.shadowMap.needsUpdate = true when members move, e.g. A4).
 *
 * The sun comes from the south-south-east (look/palette.ts): the entrance facade is lit, the east facade a step darker, and
 * balconies, sunshades and the canopy cast readable shadows on the walls below them. The image-based environment supplies the
 * sky fill, so shaded faces stay readable without a second shadowless light.
 */

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import type { Box3 } from "@/building/structure";
import { LIGHT, SUN_DIR } from "./look/palette";

interface LightingProps {
  bounds: Box3;
}

export function Lighting({ bounds }: LightingProps) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  const { radius, offset, centre } = useMemo(() => {
    const dx = bounds.max[0] - bounds.min[0];
    const dy = bounds.max[1] - bounds.min[1];
    const dz = bounds.max[2] - bounds.min[2];
    const r = Math.hypot(dx, dy, dz) / 2;
    const c: [number, number, number] = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
    const k = 1.7 * r;
    return { radius: r, centre: c, offset: [SUN_DIR[0] * k, SUN_DIR[1] * k, SUN_DIR[2] * k] as const };
  }, [bounds]);

  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [gl, invalidate]);

  // The light aims at the origin (default target); cover the bounding sphere around the
  // building centre plus its distance from the origin.
  const half = radius + Math.hypot(centre[0], centre[1], centre[2]);

  return (
    <>
      <hemisphereLight args={[LIGHT.hemiSky, LIGHT.hemiGround, LIGHT.hemiIntensity]} />
      <directionalLight
        name="KeyLight" // A4 refits its shadow frustum to the exploded model by this name
        color={LIGHT.sun}
        position={offset}
        intensity={LIGHT.sunIntensity}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        shadow-camera-near={0.5}
        shadow-camera-far={4 * radius}
        shadow-bias={-0.0003}
        shadow-normalBias={0.035}
        shadow-radius={3}
      />
    </>
  );
}
