/**
 * Exploded-view state (A4). A tiny external store (no library), like the B2/B3 stores: the panel, the inspector line
 * and the 3D controller subscribe, so none of them needs App state.
 *
 * Nothing here is canonical data and nothing is persisted: the explosion is a view setting. Closing the panel resets it
 * to assembled.
 *
 * Playback advances a LIVE progress value imperatively (no React state per frame); the committed state, which the panel
 * renders, is refreshed at most ~12 times a second while playing and whenever playback stops.
 */

import { useSyncExternalStore } from "react";
import { DEFAULT_EXPLODE_CONFIG, defaultParams, type ExplodeConfig, type ExplodeMode, type ExplodeParams, type SystemLayout } from "@/engine/explode";
import type { BuildingSystem } from "@/building/types";

export interface ExplodeState {
  readonly open: boolean;
  /** `params.t` is the last committed progress; use `explodeStore.liveT()` for the exact current value. */
  readonly params: ExplodeParams;
  readonly playing: boolean;
  readonly loop: boolean;
  /** Draw a trace line from each decomposed member back to its assembled position (default off). */
  readonly connectors: boolean;
  /** True while the progress glides to a target (a smooth preset change); the 3D controller ticks it once per frame. */
  readonly gliding: boolean;
  /** True while anything is displaced (panel open, mode not assembled, progress above 0). */
  readonly active: boolean;
  readonly version: number;
}

export type Preset = "assembled" | "partial" | "full";
export const PRESET_T: Readonly<Record<Preset, number>> = { assembled: 0, partial: 0.5, full: 1 };
const COMMIT_MS = 80;

const cfg: ExplodeConfig = DEFAULT_EXPLODE_CONFIG;
const clamp01 = (x: number) => (x <= 0 || Number.isNaN(x) ? 0 : x >= 1 ? 1 : x);
const isActive = (open: boolean, p: ExplodeParams, t: number) => open && p.mode !== "assembled" && t > 0;

const initial = (): ExplodeState => ({ open: false, params: defaultParams(cfg), playing: false, loop: false, connectors: false, gliding: false, active: false, version: 0 });
let state: ExplodeState = initial();
const live = { t: 0, dir: 1 as 1 | -1, lastCommit: 0, glide: null as { from: number; to: number; elapsed: number; dur: number; assembledAtEnd: boolean } | null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function set(patch: Partial<Omit<ExplodeState, "version" | "active">> & { params?: ExplodeParams }) {
  const next = { ...state, ...patch };
  state = { ...next, active: isActive(next.open, next.params, live.t), version: state.version + 1 };
  emit();
}
const withParams = (patch: Partial<ExplodeParams>): ExplodeParams => ({ ...state.params, ...patch });
const num = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** Everything needed to put the exploded view back exactly as it was (used when presentation mode exits). */
export interface ExplodeSnapshot {
  readonly open: boolean;
  readonly params: ExplodeParams;
  readonly t: number;
  readonly loop: boolean;
  readonly connectors: boolean;
}

export const explodeStore = {
  get: (): ExplodeState => state,
  snapshot: (): ExplodeSnapshot => ({ open: state.open, params: { ...state.params }, t: live.t, loop: state.loop, connectors: state.connectors }),
  /** Restore a snapshot: a closed panel goes back to the pristine assembled state; an open one to its exact parameters (not playing). */
  restore(snap: ExplodeSnapshot) {
    if (!snap.open) {
      explodeStore.setOpen(false);
      return;
    }
    live.t = clamp01(snap.t);
    live.dir = 1;
    live.glide = null;
    set({ open: true, params: { ...snap.params, t: live.t }, playing: false, gliding: false, loop: snap.loop, connectors: snap.connectors });
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** The exact current progress (the committed `params.t` can lag by one commit while playing). */
  liveT: (): number => live.t,
  config: cfg,

  setOpen(open: boolean) {
    if (open === state.open) return;
    if (!open) {
      live.t = 0;
      live.dir = 1;
      live.glide = null;
      state = initial();
      state = { ...state, version: state.version + 1 };
      emit();
      return;
    }
    set({ open: true });
  },

  setMode(mode: ExplodeMode) {
    if (mode === "assembled") live.t = 0;
    live.glide = null;
    set({ params: withParams({ mode, t: mode === "assembled" ? 0 : live.t }), gliding: false, ...(mode === "assembled" ? { playing: false } : {}) });
  },

  /** Scrub: sets the progress and pauses playback. In assembled mode it switches to the cinematic sequence. */
  setT(t: number) {
    live.t = clamp01(t);
    live.glide = null;
    const mode = state.params.mode === "assembled" && live.t > 0 ? "cinematic" : state.params.mode;
    set({ params: withParams({ t: live.t, mode }), playing: false, gliding: false });
  },

  preset(p: Preset) {
    live.t = PRESET_T[p];
    live.glide = null;
    const mode: ExplodeMode = p === "assembled" ? "assembled" : state.params.mode === "assembled" ? "cinematic" : state.params.mode;
    set({ params: withParams({ t: live.t, mode }), playing: false, gliding: false });
  },

  /**
   * Move to a preset's progress over `seconds`, linearly in time: the solver already eases every offset (smoothstep), so the
   * motion is a controlled S-curve without overshoot. Like `preset`, but animated; the 3D controller calls `tick` each frame.
   * Any direct change (setT, setMode, preset, play, reset, closing the panel) cancels it where it is.
   */
  glidePreset(p: Preset, seconds = 1.4) {
    const to = PRESET_T[p];
    if (seconds <= 0 || Math.abs(to - live.t) < 1e-9) return explodeStore.preset(p);
    const mode: ExplodeMode = p === "assembled" ? state.params.mode : state.params.mode === "assembled" ? "cinematic" : state.params.mode;
    live.glide = { from: live.t, to, elapsed: 0, dur: seconds, assembledAtEnd: p === "assembled" };
    live.lastCommit = 0;
    set({ playing: false, gliding: true, params: withParams({ mode, t: live.t }) });
  },
  /** Advance a running glide by `dt` seconds (once per rendered frame). `now` is injectable for tests. */
  tick(dt: number, now: number = performance.now()) {
    const g = live.glide;
    if (!g) return;
    g.elapsed += dt;
    const k = Math.min(1, g.elapsed / g.dur);
    live.t = k >= 1 ? g.to : g.from + (g.to - g.from) * k;
    if (k >= 1) {
      live.glide = null;
      set({ gliding: false, params: withParams({ t: live.t, mode: g.assembledAtEnd ? "assembled" : state.params.mode }) });
    } else if (now - live.lastCommit >= COMMIT_MS) {
      live.lastCommit = now;
      set({ params: withParams({ t: live.t }) });
    }
  },

  play() {
    live.glide = null;
    const mode: ExplodeMode = state.params.mode === "assembled" ? "cinematic" : state.params.mode;
    if (live.t >= 1) live.dir = -1;
    else if (live.t <= 0) live.dir = 1;
    live.lastCommit = 0;
    set({ playing: true, gliding: false, params: withParams({ mode, t: live.t }) });
  },
  pause() {
    if (state.playing) set({ playing: false, params: withParams({ t: live.t }) });
  },
  togglePlay() {
    if (state.playing) explodeStore.pause();
    else explodeStore.play();
  },
  setLoop(loop: boolean) {
    set({ loop });
  },

  /**
   * Advance playback by `dt` seconds (called once per rendered frame while playing). Updates the live progress; commits
   * to React-visible state at most every COMMIT_MS and when playback ends. `now` is injectable for tests.
   */
  advance(dt: number, now: number = performance.now()) {
    if (!state.playing) return;
    const dur = state.params.mode === "cinematic" ? cfg.durations.cinematic : cfg.durations.other;
    let t = live.t + (live.dir * dt) / dur;
    let ended = false;
    if (t >= 1 || t <= 0) {
      if (state.loop) {
        t = t >= 1 ? 1 : 0;
        live.dir = t >= 1 ? -1 : 1;
      } else {
        t = clamp01(t);
        ended = true;
      }
    }
    live.t = t;
    if (ended) set({ playing: false, params: withParams({ t }) });
    else if (now - live.lastCommit >= COMMIT_MS) {
      live.lastCommit = now;
      set({ params: withParams({ t }) });
    }
  },

  setFloorGap(v: number) {
    set({ params: withParams({ floorGap: num(v, 0, 20) }) });
  },
  setSystemGap(v: number) {
    set({ params: withParams({ systemGap: num(v, 0, 40) }) });
  },
  setAssemblyGap(v: number) {
    set({ params: withParams({ assemblyGap: num(v, 0, 1.5) }) });
  },
  setLayout(layout: SystemLayout) {
    set({ params: withParams({ layout }) });
  },
  toggleSystem(sys: BuildingSystem) {
    const has = state.params.systems.includes(sys);
    set({ params: withParams({ systems: has ? state.params.systems.filter((s) => s !== sys) : cfg.systemOrder.filter((s) => s === sys || state.params.systems.includes(s)) }) });
  },
  /** Choose the assembly decomposed in "assembly" mode (an assembly record id), or null. */
  setFocus(id: string | null) {
    set({ params: withParams({ focus: id }) });
  },
  setConnectors(connectors: boolean) {
    set({ connectors });
  },

  /** Back to assembled with default distances; the panel stays open. */
  reset() {
    live.t = 0;
    live.dir = 1;
    live.glide = null;
    set({ params: defaultParams(cfg), playing: false, gliding: false });
  },
};

export function useExplode(): ExplodeState {
  return useSyncExternalStore(explodeStore.subscribe, explodeStore.get);
}
/** True while anything is displaced; flips only when that changes, so subscribers do not re-render per frame. */
export function useExplodeActive(): boolean {
  return useSyncExternalStore(explodeStore.subscribe, () => state.active);
}
/** True while the panel is open. */
export function useExplodeOpen(): boolean {
  return useSyncExternalStore(explodeStore.subscribe, () => state.open);
}
