/**
 * Camera flight maths (pure, no Three.js objects, unit-tested). A flight orbits around the (moving) target instead of cutting
 * straight through the model: the offset from the target is interpolated in spherical coordinates (azimuth takes the shorter way
 * round, distance in log space), the target linearly, with an ease-in-out cubic that has no overshoot.
 */

export type V3 = readonly [number, number, number];

export interface Pose {
  readonly position: V3;
  readonly target: V3;
}

export const easeInOutCubic = (x: number): number => {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
};

interface Sph {
  readonly r: number;
  readonly theta: number; // azimuth around +y, atan2(x, z)
  readonly phi: number; // polar angle from +y
}

const sph = (o: V3): Sph => {
  const r = Math.hypot(o[0], o[1], o[2]) || 1e-9;
  return { r, theta: Math.atan2(o[0], o[2]), phi: Math.acos(Math.min(1, Math.max(-1, o[1] / r))) };
};

const wrap = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
};

export interface Flight {
  /** Pose at eased progress `e` in [0, 1]; e = 1 is exactly the end pose. */
  at(e: number): Pose;
  /** Suggested duration in milliseconds for this move. */
  readonly ms: number;
}

export function planFlight(from: Pose, to: Pose, ms?: number): Flight {
  const o0 = sph([from.position[0] - from.target[0], from.position[1] - from.target[1], from.position[2] - from.target[2]]);
  const o1 = sph([to.position[0] - to.target[0], to.position[1] - to.target[1], to.position[2] - to.target[2]]);
  const dTheta = wrap(o1.theta - o0.theta);
  const dLog = Math.log(o1.r / o0.r);
  const span = Math.abs(dTheta) / Math.PI;
  const duration = ms ?? Math.min(2200, Math.max(900, 1000 + 500 * span + 260 * Math.abs(dLog)));
  return {
    ms: duration,
    at(e: number): Pose {
      if (e >= 1) return to;
      if (e <= 0) return from;
      const r = o0.r * Math.exp(dLog * e);
      const theta = o0.theta + dTheta * e;
      const phi = o0.phi + (o1.phi - o0.phi) * e;
      const target: V3 = [from.target[0] + (to.target[0] - from.target[0]) * e, from.target[1] + (to.target[1] - from.target[1]) * e, from.target[2] + (to.target[2] - from.target[2]) * e];
      const sp = Math.sin(phi);
      return { target, position: [target[0] + r * sp * Math.sin(theta), target[1] + r * Math.cos(phi), target[2] + r * sp * Math.cos(theta)] };
    },
  };
}
