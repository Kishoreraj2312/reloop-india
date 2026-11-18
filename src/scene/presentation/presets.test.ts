import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/building/config";
import { getStructure } from "@/building/structure";
import { getArchitecture } from "@/building/architecture/generate";
import { getMep } from "@/building/mep/generate";
import { boxCorners, centreOf, HERO_DIR, type V3 } from "../framing";
import { makeViewContext } from "../viewContext";
import { DEFAULT_VIEW, LAYERS } from "../viewState";
import { FLOOR_ORDER } from "../sceneTree";
import { GUIDED_STEPS, PRESETS, floorBoundsOf, modelFacts, planContextFor, presetById, type PlanContext } from "./presets";

const records = [...getStructure(DEFAULT_CONFIG), ...getArchitecture(DEFAULT_CONFIG).records, ...getMep(DEFAULT_CONFIG).records];
const W = 1600;
const H = 1000;
const FOV = 40;
const INSETS = { bottom: 96, right: 0, left: 0, top: 0 };
const ctx: PlanContext = planContextFor(records, makeViewContext(DEFAULT_CONFIG), FOV, W, H, INSETS);

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Pixel position (y down) of a world point seen from a look-at pose. */
function pixel(p: V3, pos: V3, target: V3): { x: number; y: number; depth: number } {
  const f = norm(sub(target, pos));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const rel = sub(p, pos);
  const depth = dot(rel, f);
  const t = Math.tan((FOV * Math.PI) / 360);
  return { x: W / 2 + (dot(rel, r) / (depth * t * (W / H))) * (W / 2), y: H / 2 - (dot(rel, u) / (depth * t)) * (H / 2), depth };
}

describe("floor bounds", () => {
  const fb = floorBoundsOf(records);
  it("every floor group has real, finite bounds inside the building's", () => {
    for (const f of FLOOR_ORDER) {
      const b = fb(f);
      expect(b.min.every(Number.isFinite) && b.max.every(Number.isFinite)).toBe(true);
      expect(b.max[1]).toBeGreaterThan(b.min[1]);
      for (let i = 0; i < 3; i++) {
        expect(b.min[i]!).toBeGreaterThanOrEqual(ctx.bounds.min[i]! - 1e-6);
        expect(b.max[i]!).toBeLessThanOrEqual(ctx.bounds.max[i]! + 1e-6);
      }
    }
  });
  it("floors stack upward", () => {
    expect(fb("L1").min[1]).toBeGreaterThan(fb("L0").min[1]);
    expect(fb("L4").min[1]).toBeGreaterThan(fb("L3").min[1]);
  });
});

describe("camera presets", () => {
  it("offers the seven presets with distinct ids", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["hero", "front", "plan", "floor", "exploded", "mep", "section"]);
  });

  for (const def of PRESETS.filter((p) => p.id !== "exploded")) {
    it(`${def.id}: the framed box lies inside the free part of the canvas`, () => {
      const plan = def.plan(ctx);
      expect(plan.pose).toBeDefined();
      const { position, target } = plan.pose!;
      expect([...position, ...target].every(Number.isFinite)).toBe(true);
      // the box that was framed: recompute from the plan's own view
      const box = def.id === "plan" ? ctx.floorBounds("L4") : def.id === "floor" ? ctx.floorBounds("L2") : def.id === "mep" ? ctx.floorBounds("L1") : def.id === "section" ? { min: ctx.bounds.min, max: [ctx.bounds.max[0], ctx.bounds.max[1], ctx.view.sectionZ] as V3 } : ctx.bounds;
      for (const c of boxCorners(box)) {
        const px = pixel(c, position, target);
        expect(px.depth).toBeGreaterThan(0);
        expect(px.x).toBeGreaterThanOrEqual(-0.5);
        expect(px.x).toBeLessThanOrEqual(W + 0.5);
        expect(px.y).toBeGreaterThanOrEqual(-0.5);
        expect(px.y).toBeLessThanOrEqual(H - INSETS.bottom + 0.5); // clear of the toolbar strip
      }
    });
  }

  it("hero looks along the declared direction at the building centre area", () => {
    const { position, target } = presetById("hero").plan(ctx).pose!;
    const dir = norm(sub(position, target));
    const want = norm(HERO_DIR);
    expect(dir[0]).toBeCloseTo(want[0], 6);
    expect(dir[1]).toBeCloseTo(want[1], 6);
    expect(dir[2]).toBeCloseTo(want[2], 6);
    // the entrance (south, z < 0) faces the hero camera
    expect(position[2]).toBeLessThan(centreOf(ctx.bounds)[2]);
  });

  it("scales with the real model: doubling the bounds moves the hero camera twice as far", () => {
    const big = { ...ctx, bounds: { min: ctx.bounds.min.map((v) => v * 2) as unknown as V3, max: ctx.bounds.max.map((v) => v * 2) as unknown as V3 } };
    const a = presetById("hero").plan(ctx).pose!;
    const b = presetById("hero").plan(big).pose!;
    const dA = Math.hypot(...sub(a.position, a.target));
    const dB = Math.hypot(...sub(b.position, b.target));
    expect(dB / dA).toBeGreaterThan(1.8);
    expect(dB / dA).toBeLessThan(2.2);
  });

  it("every plan is a complete ViewState and leaves DEFAULT_VIEW untouched", () => {
    const before = JSON.stringify(DEFAULT_VIEW);
    for (const def of PRESETS) {
      const v = def.plan(ctx).view;
      expect(Object.keys(v.layers).sort()).toEqual([...LAYERS].sort());
      for (const f of FLOOR_ORDER) expect(typeof v.floors[f]).toBe("boolean");
    }
    expect(JSON.stringify(DEFAULT_VIEW)).toBe(before);
  });

  it("hero shows everything; the plan removes the roof, ceilings and services; floor / MEP isolate a storey; section sets the clip plane", () => {
    expect(presetById("hero").plan(ctx).view).toEqual(DEFAULT_VIEW);
    const plan = presetById("plan").plan(ctx).view;
    expect(plan.floors.ROOF).toBe(false);
    expect(plan.isolate).toBeNull();
    expect(plan.layers.ceilings).toBe(false); // a plan looks into the rooms
    expect(plan.layers.plumbing).toBe(false);
    expect(plan.layers.electrical).toBe(false);
    expect(plan.layers.interiorWalls).toBe(true);
    expect(presetById("floor").plan(ctx).view.isolate).toBe("L2");
    const mep = presetById("mep").plan(ctx).view;
    expect(mep).toMatchObject({ isolate: "L1", xray: true });
    expect(presetById("section").plan(ctx).clip).toEqual({ axis: "z", value: ctx.view.sectionZ });
    expect(presetById("hero").plan(ctx).clip).toBeNull();
  });

  it("exploded asks the 3D side to frame (no fixed pose) and drives the A4 floors mode", () => {
    const p = presetById("exploded").plan(ctx);
    expect(p.pose).toBeUndefined();
    expect(p.explode).toEqual({ mode: "floors", preset: "full" });
    expect(p.explodeDirection).toEqual(HERO_DIR);
  });
});

describe("guided demonstration", () => {
  const facts = modelFacts(records, ctx.bounds);

  it("facts come from the real records", () => {
    expect(facts.total).toBe(records.length);
    expect(facts.bySystem.structure + facts.bySystem.architecture + facts.bySystem.plumbing + facts.bySystem.electrical).toBe(records.length);
    expect(facts.storeys).toBe(5);
    expect(facts.byType.get("column")).toBe(records.filter((r) => r.componentType === "column").length);
    expect(facts.size[0]).toBeCloseTo(ctx.bounds.max[0] - ctx.bounds.min[0], 9);
  });

  it("has the five available steps; sustainability (B5) is not offered because B5 does not exist", () => {
    expect(GUIDED_STEPS.map((s) => s.id)).toEqual(["overview", "structure", "exploded", "mep", "recovery"]);
    expect(GUIDED_STEPS.some((s) => /sustainab|carbon/i.test(s.title))).toBe(false);
  });

  for (const step of GUIDED_STEPS) {
    for (const scene of step.scenes) {
      it(`${step.id} / ${scene.label}: plan and caption are complete`, () => {
        const plan = scene.plan(ctx);
        expect(plan.view.layers).toBeDefined();
        if (plan.explode === null) expect(plan.pose).toBeDefined();
        const caption = scene.caption(facts);
        expect(caption.length).toBeGreaterThan(20);
        expect(caption).not.toMatch(/NaN|undefined|Infinity/);
      });
    }
  }

  it("captions quote the model's own counts", () => {
    const structural = GUIDED_STEPS[1]!.scenes[0]!.caption(facts);
    expect(structural).toContain(`${facts.byType.get("column")} columns`);
    expect(structural).toContain(`${facts.byType.get("beam")} beams`);
    const mep = GUIDED_STEPS[3]!.scenes[0]!.caption(facts);
    expect(mep).toContain(facts.bySystem.plumbing.toLocaleString("en-US"));
  });

  it("recovery colouring is only requested on the recovery scene, and no scene edits engineering data", () => {
    const flagged = GUIDED_STEPS.flatMap((s) => s.scenes).filter((sc) => sc.plan(ctx).recoveryColour);
    expect(flagged.map((s) => s.label)).toEqual(["Recovery assessment"]);
    // a plan is plain data: view state, clip, pose, explode request, drawer, colour flag
    for (const sc of GUIDED_STEPS.flatMap((s) => s.scenes)) {
      expect(Object.keys(sc.plan(ctx)).every((k) => ["view", "clip", "pose", "explodeDirection", "explode", "drawer", "recoveryColour"].includes(k))).toBe(true);
    }
  });
});
