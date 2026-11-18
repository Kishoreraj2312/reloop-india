import type { Matrix4 } from "three";

/** The matrix that hides an instance without moving it: rotation and scale zeroed, translation kept (so it can be restored exactly). */
export function hiddenMatrix(m: Matrix4, out: Matrix4 = m): Matrix4 {
  const e = m.elements;
  return out.set(0, 0, 0, e[12]!, 0, 0, 0, e[13]!, 0, 0, 0, e[14]!, 0, 0, 0, 1);
}

/**
 * Element-wise hiding of instance `index` in an instanceMatrix array. B3 owns the linear part of the matrix (elements 0..11
 * and 15: zero scale = simulated as removed); the translation (12..14) belongs to the A4 explosion, so hiding and restoring
 * never read, write or restore it. Returns the saved original so it can be handed back to `restoreInstance`.
 */
export function hideInstance(array: Float32Array, index: number): Float32Array {
  const o = index * 16;
  const saved = Float32Array.from(array.subarray(o, o + 16));
  for (let j = 0; j < 12; j++) array[o + j] = 0;
  array[o + 15] = 1;
  return saved;
}

/** Undo `hideInstance`: restores the linear part only, leaving whatever translation the explosion has written. */
export function restoreInstance(array: Float32Array, index: number, saved: Float32Array): void {
  const o = index * 16;
  for (let j = 0; j < 12; j++) array[o + j] = saved[j]!;
  array[o + 15] = saved[15]!;
}
