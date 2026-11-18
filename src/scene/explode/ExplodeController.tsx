/**
 * 3D side of the exploded view (A4). Lives inside the Canvas and renders nothing.
 *
 * Every frame in which something changed (a store change, or playback) it recomputes the offsets FROM SCRATCH from the
 * canonical model and the current parameters (ExplodeSolver, allocation-free) and applies them imperatively:
 *   floors / systems   translations of the existing Floor_* and <floor>_<system> groups (GroupDriver; only dirty groups)
 *   assemblies         translation elements of the instance matrices (InstanceExplosion; only dirty meshes)
 * No React state is touched per frame. Camera movement is never implied: fit / focus run only on request (explodeBridge).
 * While displaced, the shadow frustum follows the displaced bounds and the frozen shadow map is refreshed with each change.
 * Closing the panel (or parameter 0) restores exactly the canonical transforms and the original light.
 */

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { DirectionalLight, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three/examples/jsm/controls/OrbitControls.js";
import { registry } from "@/building/registry";
import { displayedBounds, displayedBoundsOf, emptyBox, ExplodeSolver, isEmptyBox, type Box, type Cell, type ExplodeModel, type ExplodeParams } from "@/engine/explode";
import { frameBoxInto } from "../framing";
import { explodeBridge, type FrameOptions, type FramePose } from "./bridge";
import { explodeStore, useExplodeOpen } from "./explodeStore";
import { GroupDriver } from "./groups";
import { instanceExplosion } from "./instances";
import { getExplodeModel } from "./model";
import { placeGroundStage } from "../SiteGround";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface LightState {
  readonly light: DirectionalLight;
  readonly pos0: Vector3;
  readonly target0: Vector3;
  readonly cam0: { l: number; r: number; t: number; b: number; n: number; f: number };
  /** Radius of the assembled displayed bounds (the light was sized for it). */
  readonly r0: number;
}

interface Runtime {
  readonly model: ExplodeModel;
  readonly solver: ExplodeSolver;
  readonly groups: GroupDriver;
  readonly params: Mutable<ExplodeParams>;
  readonly box: Box;
  light: LightState | null;
  maxDistance0: number;
  /** The assembly factors last written to the instance meshes (nothing is rewritten when they are unchanged). */
  readonly appliedFactors: Float64Array;
  assemblyApplied: boolean;
  displaced: boolean;
}

/** The solver of the running controller (null while nothing is bound); read by the trace lines. */
export const explodeRuntime: { solver: ExplodeSolver | null } = { solver: null };

/** Update-cost measurements (dev): milliseconds spent in the last / the average of the last updates. */
export const explodeStats = { updates: 0, lastMs: 0, avgMs: 0, groupsWritten: 0, meshesWritten: 0, maxMs: 0 };

declare global {
  interface Window {
    /** Dev only: canonical vs displayed positions for the browser verification. */
    __explode?: {
      store: typeof explodeStore;
      model: () => ExplodeModel;
      solver: () => ExplodeSolver | null;
      stats: typeof explodeStats;
      instances: typeof instanceExplosion;
      /** Canonical (record) and displayed (read from the scene graph and instance matrices) world centres. */
      positions: (ids: readonly string[]) => { id: string; canonical: number[]; displayed: number[] | null; offset: number[] | null }[];
      fit: (opts?: FrameOptions) => boolean;
      focus: (id: string, opts?: FrameOptions) => boolean;
      /** Displayed bounds of everything (engine) for the current parameters. */
      bounds: () => Box;
      /** Position of every Floor_* and <floor>_<system> group, read from the scene graph. */
      groups: () => { name: string; position: number[] }[];
    };
  }
}

export function ExplodeController() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const open = useExplodeOpen();
  const rt = useRef<Runtime | null>(null);
  const dirty = useRef(false);

  // any store change asks for a frame; the frame does the work
  useEffect(() => {
    const unsubscribe = explodeStore.subscribe(() => {
      dirty.current = true;
      invalidate();
    });
    return () => void unsubscribe();
  }, [invalidate]);

  /** Build the runtime on first use (opening the panel): the model, the solver and the bound groups. */
  const ensure = (): Runtime | null => {
    if (rt.current) return rt.current;
    const root = scene.getObjectByName("Building_G4");
    if (!root) return null;
    const model = getExplodeModel();
    const groups = new GroupDriver();
    groups.bind(root, model);
    instanceExplosion.attachModel(model);
    const solver = new ExplodeSolver(model);
    const box = emptyBox();
    const light = findLight(scene, model, solver, box);
    rt.current = { model, solver, groups, params: { ...explodeStore.get().params }, box, light, maxDistance0: controls?.maxDistance ?? 180, appliedFactors: new Float64Array(model.assemblies.length), assemblyApplied: false, displaced: false };
    explodeRuntime.solver = solver;
    return rt.current;
  };

  const release = () => {
    const r = rt.current;
    if (!r) return;
    r.groups.unbind();
    instanceExplosion.attachModel(null);
    restoreLight(r);
    if (controls) controls.maxDistance = r.maxDistance0;
    gl.shadowMap.needsUpdate = true;
    rt.current = null;
    explodeRuntime.solver = null;
    invalidate();
  };

  useFrame((state, delta) => {
    const s = explodeStore.get();
    if (s.playing) explodeStore.advance(Math.min(delta, 0.05)); // a long idle gap must not make playback jump
    if (s.gliding) explodeStore.tick(Math.min(delta, 0.05));
    if (!dirty.current && !s.playing && !s.gliding) return;
    dirty.current = false;
    const r = rt.current ?? (s.open ? ensure() : null);
    if (!r) return;

    const t0 = performance.now();
    const p = r.params;
    const sp = explodeStore.get().params;
    p.mode = sp.mode;
    p.t = explodeStore.liveT();
    p.floorGap = sp.floorGap;
    p.systemGap = sp.systemGap;
    p.assemblyGap = sp.assemblyGap;
    p.layout = sp.layout;
    p.systems = sp.systems;
    p.focus = sp.focus;
    r.solver.solve(p);
    const g = r.groups.apply(r.solver);
    let m = 0;
    if (r.solver.assemblyActive || r.assemblyApplied) {
      const f = r.solver.assemblyFactor;
      let same = true;
      for (let i = 0; i < f.length; i++) {
        if (f[i] !== r.appliedFactors[i]) {
          same = false;
          break;
        }
      }
      if (!same) {
        m = instanceExplosion.apply(f);
        r.appliedFactors.set(f);
      }
      r.assemblyApplied = r.solver.assemblyActive;
    }
    const displaced = r.solver.eFloor > 0 || r.solver.eSystem > 0 || r.solver.assemblyActive;
    if (g || m || displaced !== r.displaced) {
      updateLight(r, displaced);
      placeGroundStage(scene, displaced ? displayedBounds(r.model, r.solver, undefined, r.box).min[1] - 0.06 : null); // the site plane becomes the stage under the displaced model
      if (controls && displaced !== r.displaced) controls.maxDistance = displaced ? Math.max(r.maxDistance0, 320) : r.maxDistance0;
      r.displaced = displaced;
      gl.shadowMap.needsUpdate = true; // the shadow map is frozen between changes
    }
    const ms = performance.now() - t0;
    explodeStats.updates++;
    explodeStats.lastMs = ms;
    explodeStats.avgMs += (ms - explodeStats.avgMs) / Math.min(explodeStats.updates, 30);
    explodeStats.maxMs = Math.max(explodeStats.maxMs, ms);
    explodeStats.groupsWritten = g;
    explodeStats.meshesWritten = m;

    if (!s.open && !displaced) release(); // closed and back to canonical: drop everything
    if (s.playing || s.gliding) state.invalidate(); // keep frames coming while playing or gliding
  });

  // panel closed with something still displaced: the store already reset the parameters; one more frame restores
  useEffect(() => {
    if (!open && rt.current) {
      dirty.current = true;
      invalidate();
    }
  }, [open, invalidate]);

  // camera actions on request
  useEffect(() => {
    const solverNow = (params?: ExplodeParams): { model: ExplodeModel; solver: ExplodeSolver } => {
      const model = getExplodeModel();
      if (params) return { model, solver: new ExplodeSolver(model).solve({ ...params }) };
      const solver = rt.current?.solver ?? new ExplodeSolver(model).solve({ ...explodeStore.get().params, t: explodeStore.liveT() });
      return { model, solver };
    };
    /** Frame `box` into the free part of the canvas (framing.ts: frameBoxInto). */
    const poseFor = (box: Box, margin: number, opts?: FrameOptions): FramePose | null => {
      if (isEmptyBox(box)) return null;
      const dir = opts?.direction ? new Vector3(...opts.direction) : camera.position.clone().sub(controls?.target ?? new Vector3());
      if (dir.lengthSq() < 1e-9) dir.set(0.7, 0.5, 0.7);
      const vfov = (camera as { fov?: number }).fov ?? 40;
      const p = frameBoxInto(box, [dir.x, dir.y, dir.z], vfov, size.width, size.height, { bottom: opts?.bottomInset ?? 0, right: opts?.rightInset ?? 0, left: opts?.leftInset ?? 0, top: opts?.topInset ?? 0 }, margin);
      return { position: p.position, target: p.target, maxDistance: p.distance * 1.25 };
    };
    const frame = (box: Box, margin: number, opts?: FrameOptions): boolean => {
      const pose = poseFor(box, margin, opts);
      if (!controls || !pose) return false;
      controls.maxDistance = Math.max(controls.maxDistance, pose.maxDistance);
      camera.position.set(...pose.position);
      controls.target.set(...pose.target);
      camera.lookAt(controls.target);
      controls.update();
      invalidate();
      return true;
    };
    explodeBridge.fit = (visible?: (c: Cell) => boolean, opts?: FrameOptions) => {
      const { model, solver } = solverNow();
      return frame(displayedBounds(model, solver, visible), 1.12, opts);
    };
    explodeBridge.fitPose = (opts?: FrameOptions, params?: ExplodeParams) => {
      const { model, solver } = solverNow(params);
      return poseFor(displayedBounds(model, solver), 1.12, opts);
    };
    explodeBridge.focus = (id: string, opts?: FrameOptions) => {
      const { model, solver } = solverNow();
      const b = displayedBoundsOf(model, solver, id);
      return b ? frame(b, 2, opts) : false;
    };
    return () => {
      explodeBridge.fit = null;
      explodeBridge.focus = null;
      explodeBridge.fitPose = null;
    };
  }, [camera, controls, invalidate, size.width, size.height]);

  // dev / test only (excluded from production builds)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__explode = {
      store: explodeStore,
      model: getExplodeModel,
      solver: () => rt.current?.solver ?? null,
      stats: explodeStats,
      instances: instanceExplosion,
      positions: (ids) => {
        const model = getExplodeModel();
        const solver = rt.current?.solver ?? null;
        scene.updateMatrixWorld(true);
        const byUuid = new Map<string, import("three").InstancedMesh>();
        scene.traverse((o) => {
          const im = o as import("three").InstancedMesh;
          if (im.isInstancedMesh && Array.isArray(im.userData.componentIds)) byUuid.set(im.uuid, im);
        });
        const out: ReturnType<NonNullable<Window["__explode"]>["positions"]> = [];
        const v = camera.position.clone();
        for (const id of ids) {
          const rec = model.byId.get(id);
          if (!rec) continue;
          const canonical = [...rec.originalPosition];
          let displayed: number[] | null = null;
          const inst = registry.getInstance(id);
          if (inst) {
            const im = byUuid.get(inst.meshUuid);
            if (im) {
              const a = im.instanceMatrix.array;
              v.set(a[inst.index * 16 + 12]!, a[inst.index * 16 + 13]!, a[inst.index * 16 + 14]!).applyMatrix4(im.matrixWorld);
              displayed = v.toArray();
            }
          } else {
            const mesh = scene.getObjectByName(id);
            if (mesh) displayed = mesh.getWorldPosition(v).toArray();
          }
          let offset: number[] | null = null;
          if (solver) {
            offset = [0, 0, 0];
            solver.offsetOf(id, offset);
          }
          out.push({ id, canonical, displayed, offset });
        }
        return out;
      },
      bounds: () => {
        const model = getExplodeModel();
        const solver = rt.current?.solver ?? new ExplodeSolver(model).solve({ ...explodeStore.get().params, t: explodeStore.liveT() });
        return displayedBounds(model, solver);
      },
      groups: () => {
        const out: { name: string; position: number[] }[] = [];
        scene.traverse((o) => {
          if (/^Floor_/.test(o.name) || /^(FDN|L[0-4]|ROOF)_(structure|architecture|plumbing|electrical)$/.test(o.name)) out.push({ name: o.name, position: o.position.toArray() });
        });
        return out;
      },
      fit: (opts?: FrameOptions) => explodeBridge.fit?.(undefined, opts) ?? false,
      focus: (id: string, opts?: FrameOptions) => explodeBridge.focus?.(id, opts) ?? false,
    };
    return () => {
      delete window.__explode;
    };
  }, [scene, camera]);

  // unmount: leave nothing displaced
  useEffect(() => () => release(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ── shadow frustum ────────────────────────────────────────────────────────────

function findLight(scene: import("three").Object3D, model: ExplodeModel, solver: ExplodeSolver, box: Box): LightState | null {
  const light = scene.getObjectByName("KeyLight");
  if (!(light instanceof DirectionalLight)) return null;
  solver.solve({ ...explodeStore.get().params, mode: "assembled", t: 0 });
  displayedBounds(model, solver, undefined, box);
  const r0 = 0.5 * Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  const sh = light.shadow.camera;
  return { light, pos0: light.position.clone(), target0: light.target.position.clone(), cam0: { l: sh.left, r: sh.right, t: sh.top, b: sh.bottom, n: sh.near, f: sh.far }, r0 };
}

function updateLight(r: Runtime, displaced: boolean): void {
  const L = r.light;
  if (!L) return;
  if (!displaced) {
    restoreLight(r);
    return;
  }
  const b = displayedBounds(r.model, r.solver, undefined, r.box);
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const rad = 0.5 * Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) * 1.05;
  const s = rad / L.r0;
  L.light.position.set(cx + L.pos0.x * s, cy + L.pos0.y * s, cz + L.pos0.z * s);
  L.light.target.position.set(cx, cy, cz);
  L.light.target.updateMatrixWorld();
  const sh = L.light.shadow.camera;
  sh.left = -rad;
  sh.right = rad;
  sh.top = rad;
  sh.bottom = -rad;
  sh.near = L.cam0.n;
  sh.far = L.cam0.f * s;
  sh.updateProjectionMatrix();
}

function restoreLight(r: Runtime): void {
  const L = r.light;
  if (!L) return;
  L.light.position.copy(L.pos0);
  L.light.target.position.copy(L.target0);
  L.light.target.updateMatrixWorld();
  const sh = L.light.shadow.camera;
  sh.left = L.cam0.l;
  sh.right = L.cam0.r;
  sh.top = L.cam0.t;
  sh.bottom = L.cam0.b;
  sh.near = L.cam0.n;
  sh.far = L.cam0.f;
  sh.updateProjectionMatrix();
}
