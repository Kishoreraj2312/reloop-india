/**
 * One small tileable noise texture (256 x 256 RGBA, generated at start-up, deterministic) shared by every procedural surface.
 *   R  broad blotches            G  medium mottling / grain
 *   B  fine grain (bump height)  A  sparse speckle (pores, mineral flecks)
 * Each channel is stretched to the full 0..1 range, so shader amplitudes mean what they say. No image asset, no dependency.
 */

import { DataTexture, LinearMipmapLinearFilter, LinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from "three";

export const NOISE_SIZE = 256;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise with `period` lattice cells across the texture, smooth (quintic) interpolation. */
function valueNoise(size: number, period: number, rnd: () => number): Float32Array {
  const lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(size * size);
  const q = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * period;
    const y0 = Math.floor(fy);
    const ty = q(fy - y0);
    const ya = y0 % period;
    const yb = (y0 + 1) % period;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period;
      const x0 = Math.floor(fx);
      const tx = q(fx - x0);
      const xa = x0 % period;
      const xb = (x0 + 1) % period;
      const a = lat[ya * period + xa]! + (lat[ya * period + xb]! - lat[ya * period + xa]!) * tx;
      const b = lat[yb * period + xa]! + (lat[yb * period + xb]! - lat[yb * period + xa]!) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}

function fbm(size: number, basePeriod: number, octaves: number, rnd: () => number, gain = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, basePeriod * 2 ** o, rnd);
    for (let i = 0; i < out.length; i++) out[i]! += n[i]! * amp;
    norm += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i]! /= norm;
  return out;
}

/** Stretch to 0..1 between the 2nd and 98th percentile (clamped), so the channel uses the whole range. */
function stretch(a: Float32Array): Float32Array {
  const sorted = Float32Array.from(a).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)]!;
  const hi = sorted[Math.floor(sorted.length * 0.98)]!;
  const k = hi > lo ? 1 / (hi - lo) : 1;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.min(1, Math.max(0, (a[i]! - lo) * k));
  return out;
}

export function noiseData(size = NOISE_SIZE, seed = 0xa5): Uint8Array {
  const rnd = mulberry32(seed);
  const r = stretch(fbm(size, 3, 4, rnd, 0.55));
  const g = stretch(fbm(size, 8, 4, rnd, 0.5));
  const b = stretch(fbm(size, 32, 3, rnd, 0.6));
  // speckle: mostly low with occasional bright flecks
  const sp = valueNoise(size, 96, rnd);
  const a = new Float32Array(sp.length);
  for (let i = 0; i < sp.length; i++) a[i] = sp[i]! ** 3;
  const as = stretch(a);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(r[i]! * 255);
    data[i * 4 + 1] = Math.round(g[i]! * 255);
    data[i * 4 + 2] = Math.round(b[i]! * 255);
    data[i * 4 + 3] = Math.round(as[i]! * 255);
  }
  return data;
}

let shared: DataTexture | null = null;

/** The shared texture (created on first use; it lives for the whole session, so no owner disposes it). */
export function surfaceNoise(): DataTexture {
  if (shared) return shared;
  const t = new DataTexture(noiseData(), NOISE_SIZE, NOISE_SIZE, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = NoColorSpace; // data, not colour
  t.needsUpdate = true;
  shared = t;
  return t;
}
