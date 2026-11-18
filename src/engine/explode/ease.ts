import type { Window } from "./types";

export const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** Smoothstep. Exactly 0 at 0 and exactly 1 at 1; monotonic. */
export const ease = (x: number): number => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/** Progress inside a window of the master parameter: 0 before it, 1 after it. */
export const windowed = (t: number, w: Window): number => (w[1] <= w[0] ? (t >= w[1] ? 1 : 0) : clamp01((t - w[0]) / (w[1] - w[0])));

/** `x + 0` turns -0 into +0, so "no offset" is bit-identical to the canonical transform. */
export const norm0 = (x: number): number => x + 0;
