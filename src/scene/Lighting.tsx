/**
 * Soft hemisphere fill + one shadow-casting directional light, sized from the
 * building bounds. The model is static, so the shadow map is rendered once and then
 * frozen (re-enable with gl.shadowMap.needsUpdate = true when members move, e.g. A4).
 */

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import type { Box3 } from "@/building/structure";

const SKY = 0xffffff;
const GROUND = 0x8b9299;

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
    return { radius: r, centre: c, offset: [0.55 * r, 1.25 * r, 0.8 * r] as const };
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
      <hemisphereLight args={[SKY, GROUND, 0.55]} />
      <directionalLight
        position={offset}
        intensity={2.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        shadow-camera-near={0.5}
        shadow-camera-far={4 * radius}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
    </>
  );
}
