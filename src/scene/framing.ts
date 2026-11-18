/**
 * Camera framing — pure functions (no Three.js objects) so they can be unit-tested.
 *
 * `frameBox` finds the nearest camera distance, along a view direction, at which all
 * eight corners of a box project inside the viewport (with a margin). Bounds come from
 * the generated records, so framing follows the config.
 */

import { recordBounds, type Box3, type ComponentRecord } from "@/building/structure";
import { ARCH_CONFIG } from "@/building/architecture/config";

export type V3 = readonly [number, number, number];

/** Vertical field of view (degrees) of the viewer camera; presentation framing uses the same value. */
export const VIEWER_FOV = 40;

export type ViewName = "full" | "hero" | "top" | "stair" | "section";

export interface CameraPose {
  readonly position: V3;
  readonly target: V3;
}

export function unionBounds(records: readonly ComponentRecord[]): Box3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const r of records) {
    const b = recordBounds(r);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, b.min[i]!);
      max[i] = Math.max(max[i]!, b.max[i]!);
    }
  }
  return { min, max };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function boxCorners(b: Box3): V3[] {
  const out: V3[] = [];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]])
      for (const z of [b.min[2], b.max[2]]) out.push([x, y, z]);
  return out;
}

export function centreOf(b: Box3): V3 {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

/** Camera basis for a pose looking at `target` from direction `dir` (world up = +Y). */
function basis(dir: V3) {
  const up: V3 = [0, 1, 0];
  const right = norm(cross(up, dir));
  const upv = cross(dir, right);
  return { right, upv };
}

/**
 * Distance along `dir` from `target` at which every corner of `box` is inside the
 * viewport shrunk by `margin` (>1 leaves empty border).
 */
export function fitDistance(
  box: Box3,
  target: V3,
  dir: V3,
  vfovDeg: number,
  aspect: number,
  margin = 1.1,
): number {
  const d = norm(dir);
  const { right, upv } = basis(d);
  const tanV = Math.tan((vfovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  let dist = 0;
  for (const c of boxCorners(box)) {
    const rel = sub(c, target);
    const along = dot(rel, d); // toward the camera
    dist = Math.max(
      dist,
      along + (Math.abs(dot(rel, right)) * margin) / tanH,
      along + (Math.abs(dot(rel, upv)) * margin) / tanV,
    );
  }
  return dist;
}

export function frameBox(
  box: Box3,
  dir: V3,
  vfovDeg: number,
  aspect: number,
  margin?: number,
  target: V3 = centreOf(box),
): CameraPose {
  const d = norm(dir);
  const dist = fitDistance(box, target, d, vfovDeg, aspect, margin);
  return {
    target,
    position: [target[0] + d[0] * dist, target[1] + d[1] * dist, target[2] + d[2] * dist],
  };
}

/** Direction (from the building toward the camera) of the hero view: south-east, about 18 degrees above the horizon, so the
 *  facades (not the roof) carry the silhouette and the horizon sits in the frame. */
export const HERO_DIR: V3 = [0.78, 0.42, -1.0];

/** The part of `box` above finished site grade: exterior views frame what is visible, not the buried foundations. */
export function aboveGrade(box: Box3): Box3 {
  const g = ARCH_CONFIG.datums.siteGrade;
  return { min: [box.min[0], Math.min(Math.max(box.min[1], g), box.max[1]), box.min[2]], max: box.max };
}

/** Pixels of the canvas covered by UI on each side. */
export interface Insets {
  readonly top?: number;
  readonly right?: number;
  readonly bottom?: number;
  readonly left?: number;
}

const clampInset = (v: number | undefined, max: number) => Math.min(Math.max(v ?? 0, 0), max);

/**
 * `frameBox` into the part of the canvas that UI leaves free: the field of view is shrunk to the free rectangle (so every corner of
 * the box lands inside it with `margin`), then camera and target slide together so the box centre sits in the middle of that
 * rectangle. `dir` points from the box toward the camera. Pure; world up is +Y.
 */
export function frameBoxInto(box: Box3, dir: V3, vfovDeg: number, width: number, height: number, insets: Insets = {}, margin = 1.1): CameraPose & { readonly distance: number } {
  const d = norm(dir);
  const ti = clampInset(insets.top, height * 0.45);
  const bi = clampInset(insets.bottom, height * 0.7);
  const li = clampInset(insets.left, width * 0.4);
  const ri = clampInset(insets.right, width * 0.6);
  const Hf = height - bi - ti;
  const Wf = width - ri - li;
  const tanHalf = Math.tan((vfovDeg * Math.PI) / 360);
  const vfovEff = (2 * Math.atan((tanHalf * Hf) / height) * 180) / Math.PI;
  const pose = frameBox(box, d, vfovEff, Wf / Hf, margin);
  const dist = Math.hypot(pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2]);
  const { right, upv } = basis(d);
  const slideY = ((bi - ti) / height) * dist * tanHalf; // camera and target down: the model rises on screen
  const slideX = ((ri - li) / width) * dist * tanHalf * (width / height); // camera and target right: the model moves left
  const shift = (p: V3): V3 => [p[0] - upv[0] * slideY + right[0] * slideX, p[1] - upv[1] * slideY + right[1] * slideX, p[2] - upv[2] * slideY + right[2] * slideX];
  return { position: shift(pose.position), target: shift(pose.target), distance: dist };
}

/** Clip plane for a view: keep everything with coordinate <= value along `axis`. */
export interface ClipSpec {
  readonly axis: "x" | "y" | "z";
  readonly value: number;
}

export interface ViewSpec {
  readonly pose: CameraPose;
}

export interface StairFocus {
  /** Plan centre of the stair opening; halfX / halfZ are its half extents. */
  readonly centre: V3;
  readonly halfX: number;
  readonly halfZ: number;
}

export interface ViewContext {
  readonly stair: StairFocus;
  /** Section plane for the "section" view: z of a column gridline. */
  readonly sectionZ: number;
  /** Cut height for the "stair" view: hides everything above so the core is visible. */
  readonly stairCutY: number;
}

/** Clip plane that goes with a view, if any. */
export function clipFor(name: ViewName, ctx: Pick<ViewContext, "sectionZ" | "stairCutY">): ClipSpec | undefined {
  if (name === "section") return { axis: "z", value: ctx.sectionZ };
  if (name === "stair") return { axis: "y", value: ctx.stairCutY };
  return undefined;
}

/**
 * Camera for a named view.
 *  full    — oblique view of the whole building (from the north-east)
 *  hero    — presentation axonometric from the south-east: the entrance facade, the south balconies and the east facade
 *  top     — straight down
 *  stair   — oblique view down into the stair core (building cut above `stairCutY`)
 *  section — view toward -Z of the model cut at a column line (`sectionZ`)
 */
export function viewSpec(
  name: ViewName,
  box: Box3,
  vfovDeg: number,
  aspect: number,
  ctx: ViewContext,
): ViewSpec {
  switch (name) {
    case "full":
      return { pose: frameBox(box, [0.85, 0.62, 1.0], vfovDeg, aspect) };
    case "hero":
      return { pose: frameBox(aboveGrade(box), HERO_DIR, vfovDeg, aspect, 1.08) };
    case "top":
      return { pose: frameBox(box, [0, 1, 0.0005], vfovDeg, aspect, 1.06) };
    case "stair": {
      const { centre, halfX, halfZ } = ctx.stair;
      const focus: Box3 = {
        min: [centre[0] - halfX - 0.6, 0, centre[2] - halfZ - 0.6],
        max: [centre[0] + halfX + 0.6, ctx.stairCutY, centre[2] + halfZ + 0.6],
      };
      return { pose: frameBox(focus, [-0.45, 0.85, 0.75], vfovDeg, aspect, 1.12) };
    }
    case "section": {
      const cut: Box3 = {
        min: [box.min[0], box.min[1], box.min[2]],
        max: [box.max[0], box.max[1], ctx.sectionZ],
      };
      return { pose: frameBox(cut, [0.22, 0.2, 1.0], vfovDeg, aspect, 1.08) };
    }
  }
}
