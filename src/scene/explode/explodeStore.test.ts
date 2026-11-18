import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_EXPLODE_CONFIG } from "@/engine/explode";
import { explodeStore as S } from "./explodeStore";

afterEach(() => {
  S.setOpen(true);
  S.setOpen(false); // closing resets everything
});

describe("explode store", () => {
  it("starts closed and assembled; closing from any state resets to assembled with default distances", () => {
    expect(S.get()).toMatchObject({ open: false, playing: false, active: false, connectors: false });
    S.setOpen(true);
    S.setMode("floors");
    S.setT(0.7);
    S.setFloorGap(9);
    S.setConnectors(true);
    expect(S.get().active).toBe(true);
    S.setOpen(false);
    expect(S.get()).toMatchObject({ open: false, playing: false, active: false, connectors: false });
    expect(S.get().params).toMatchObject({ mode: "assembled", t: 0, floorGap: DEFAULT_EXPLODE_CONFIG.floorGap });
    expect(S.liveT()).toBe(0);
  });

  it("clamps progress, pauses playback when scrubbed, and scrubbing from assembled starts the cinematic sequence", () => {
    S.setOpen(true);
    S.setT(-4);
    expect(S.liveT()).toBe(0);
    expect(S.get().params.mode).toBe("assembled");
    S.setT(0.4);
    expect(S.get().params).toMatchObject({ mode: "cinematic", t: 0.4 });
    S.setT(7);
    expect(S.liveT()).toBe(1);
    S.setT(Number.NaN);
    expect(S.liveT()).toBe(0);
    S.play();
    expect(S.get().playing).toBe(true);
    S.setT(0.5);
    expect(S.get().playing).toBe(false);
  });

  it("presets set the progress and keep the mode (assembled / partial / full)", () => {
    S.setOpen(true);
    S.setMode("floors");
    S.preset("partial");
    expect(S.get().params).toMatchObject({ mode: "floors", t: 0.5 });
    S.preset("full");
    expect(S.liveT()).toBe(1);
    S.preset("assembled");
    expect(S.get().params).toMatchObject({ mode: "assembled", t: 0 });
    S.preset("full"); // from assembled the full preset needs a mode to show: the cinematic sequence
    expect(S.get().params).toMatchObject({ mode: "cinematic", t: 1 });
  });

  it("switching modes keeps the progress; assembled forces zero and stops playback", () => {
    S.setOpen(true);
    S.setMode("systems");
    S.setT(0.6);
    S.setMode("floors");
    expect(S.get().params).toMatchObject({ mode: "floors", t: 0.6 });
    S.play();
    S.setMode("assembled");
    expect(S.get()).toMatchObject({ playing: false });
    expect(S.liveT()).toBe(0);
  });

  it("plays forward to exactly 1 and stops; playing again from 1 runs backwards to exactly 0", () => {
    S.setOpen(true);
    S.setMode("floors");
    S.play();
    const dur = DEFAULT_EXPLODE_CONFIG.durations.other;
    S.advance(dur / 2, 1000);
    expect(S.liveT()).toBeCloseTo(0.5, 12);
    expect(S.get().playing).toBe(true);
    S.advance(dur, 1100); // overshoot
    expect(S.liveT()).toBe(1);
    expect(S.get()).toMatchObject({ playing: false });
    expect(S.get().params.t).toBe(1);
    S.play();
    S.advance(dur * 3, 1200);
    expect(S.liveT()).toBe(0);
    expect(S.get().playing).toBe(false);
  });

  it("the cinematic sequence takes longer than the single-purpose modes", () => {
    S.setOpen(true);
    S.setMode("cinematic");
    S.play();
    S.advance(DEFAULT_EXPLODE_CONFIG.durations.other, 1000);
    expect(S.liveT()).toBeLessThan(1);
    expect(S.liveT()).toBeCloseTo(DEFAULT_EXPLODE_CONFIG.durations.other / DEFAULT_EXPLODE_CONFIG.durations.cinematic, 12);
  });

  it("loops ping-pong without stopping", () => {
    S.setOpen(true);
    S.setMode("floors");
    S.setLoop(true);
    S.play();
    const dur = DEFAULT_EXPLODE_CONFIG.durations.other;
    S.advance(dur * 1.2, 1000);
    expect(S.liveT()).toBe(1);
    expect(S.get().playing).toBe(true);
    S.advance(dur * 0.25, 2000);
    expect(S.liveT()).toBeCloseTo(0.75, 12);
    S.advance(dur * 2, 3000);
    expect(S.liveT()).toBe(0);
    expect(S.get().playing).toBe(true);
  });

  it("commits to React-visible state at most every ~80 ms while playing, but the live progress is always exact", () => {
    S.setOpen(true);
    S.setMode("floors");
    S.play();
    let emits = 0;
    const un = S.subscribe(() => emits++);
    let now = 10_000;
    for (let i = 0; i < 20; i++) S.advance(0.004, (now += 4)); // 80 ms of frames
    expect(emits).toBeLessThanOrEqual(2);
    expect(S.liveT()).toBeCloseTo((20 * 0.004) / DEFAULT_EXPLODE_CONFIG.durations.other, 12);
    un();
  });

  it("advance does nothing unless playing", () => {
    S.setOpen(true);
    S.setMode("floors");
    S.setT(0.3);
    S.advance(10, 5000);
    expect(S.liveT()).toBe(0.3);
  });

  it("derives `active` only while the panel is open, the mode is not assembled and progress is above 0", () => {
    expect(S.get().active).toBe(false);
    S.setOpen(true);
    expect(S.get().active).toBe(false);
    S.setMode("floors");
    expect(S.get().active).toBe(false); // progress 0
    S.setT(0.01);
    expect(S.get().active).toBe(true);
    S.setMode("assembled");
    expect(S.get().active).toBe(false);
  });

  it("keeps distances in range, systems in canonical order, and a chosen focus", () => {
    S.setOpen(true);
    S.setFloorGap(-3);
    expect(S.get().params.floorGap).toBe(0);
    S.setFloorGap(99);
    expect(S.get().params.floorGap).toBe(20);
    S.setAssemblyGap(Number.NaN);
    expect(S.get().params.assemblyGap).toBe(0);
    S.toggleSystem("architecture");
    expect(S.get().params.systems).toEqual(["structure", "plumbing", "electrical"]);
    S.toggleSystem("architecture");
    expect(S.get().params.systems).toEqual(["structure", "architecture", "plumbing", "electrical"]);
    S.setFocus("ARC-WIN-1");
    expect(S.get().params.focus).toBe("ARC-WIN-1");
    S.setFocus(null);
    expect(S.get().params.focus).toBeNull();
  });

  it("reset returns to assembled with default distances and keeps the panel open", () => {
    S.setOpen(true);
    S.setMode("systems");
    S.setT(0.8);
    S.setSystemGap(20);
    S.setFocus("x");
    S.reset();
    expect(S.get().open).toBe(true);
    expect(S.get().params).toMatchObject({ mode: "assembled", t: 0, systemGap: DEFAULT_EXPLODE_CONFIG.systemGap, focus: null });
    expect(S.liveT()).toBe(0);
  });
});

describe("smooth glide (A5)", () => {
  it("moves the progress linearly in time to exactly the target, keeps the mode, and stops gliding", () => {
    S.setOpen(true);
    S.setMode("floors");
    S.glidePreset("full", 2);
    expect(S.get().gliding).toBe(true);
    expect(S.get().params.mode).toBe("floors");
    S.tick(0.5, 1000);
    expect(S.liveT()).toBeCloseTo(0.25, 12);
    S.tick(0.5, 1100);
    expect(S.liveT()).toBeCloseTo(0.5, 12);
    S.tick(5, 1200); // overshoot lands exactly on the target
    expect(S.liveT()).toBe(1);
    expect(S.get()).toMatchObject({ gliding: false, playing: false });
    expect(S.get().params).toMatchObject({ mode: "floors", t: 1 });
  });

  it("from assembled it starts the cinematic sequence; a glide back to assembled ends in the assembled mode", () => {
    S.setOpen(true);
    S.glidePreset("partial", 1);
    expect(S.get().params.mode).toBe("cinematic");
    S.tick(1, 1000);
    expect(S.liveT()).toBe(0.5);
    S.glidePreset("assembled", 1);
    S.tick(0.5, 1100);
    expect(S.liveT()).toBeCloseTo(0.25, 12);
    S.tick(1, 1200);
    expect(S.liveT()).toBe(0);
    expect(S.get().params).toMatchObject({ mode: "assembled", t: 0 });
    expect(S.get().active).toBe(false);
  });

  it("any direct change takes over where the glide stands (no drift, no late jump)", () => {
    S.setOpen(true);
    S.setMode("systems");
    S.glidePreset("full", 2);
    S.tick(1, 1000);
    S.setT(0.3);
    expect(S.get().gliding).toBe(false);
    S.tick(1, 1100); // a stale tick does nothing
    expect(S.liveT()).toBe(0.3);
    S.glidePreset("full", 2);
    S.play();
    expect(S.get()).toMatchObject({ gliding: false, playing: true });
    S.pause();
    S.glidePreset("assembled", 2);
    S.reset();
    expect(S.get().gliding).toBe(false);
    expect(S.liveT()).toBe(0);
  });

  it("a glide to the progress it is already at is an immediate preset, and closing cancels a running glide", () => {
    S.setOpen(true);
    S.setMode("floors");
    S.glidePreset("assembled", 1);
    expect(S.get().gliding).toBe(false);
    S.setMode("floors");
    S.glidePreset("full", 3);
    S.setOpen(false);
    expect(S.get()).toMatchObject({ gliding: false, open: false });
    expect(S.liveT()).toBe(0);
  });
});

describe("snapshot / restore (presentation mode exit)", () => {
  it("restores an open panel's exact parameters, not playing", () => {
    S.setOpen(true);
    S.setMode("systems");
    S.setT(0.62);
    S.setSystemGap(11);
    S.setConnectors(true);
    const snap = S.snapshot();
    S.setMode("floors");
    S.glidePreset("full", 2);
    S.restore(snap);
    expect(S.get()).toMatchObject({ open: true, gliding: false, playing: false, connectors: true });
    expect(S.get().params).toMatchObject({ mode: "systems", systemGap: 11 });
    expect(S.liveT()).toBe(0.62);
  });

  it("restoring a closed panel gives the pristine assembled state", () => {
    const snap = S.snapshot(); // closed
    S.setOpen(true);
    S.setMode("floors");
    S.setT(1);
    S.restore(snap);
    expect(S.get()).toMatchObject({ open: false, active: false });
    expect(S.get().params).toMatchObject({ mode: "assembled", t: 0, floorGap: DEFAULT_EXPLODE_CONFIG.floorGap });
    expect(S.liveT()).toBe(0);
  });
});
