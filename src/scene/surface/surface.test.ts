import { describe, expect, it } from "vitest";
import { MeshStandardMaterial, ShaderLib } from "three";
import { ALL_MATERIALS } from "@/building/materialLibrary";
import { NOISE_SIZE, noiseData } from "./noiseTexture";
import { applySurface } from "./surfaceShader";
import { GROUND_SPEC, STRUCTURE_SPEC, reflectionFor, surfaceSpecFor, type SurfacePattern } from "./surfaceSpecs";

const PATTERNS: readonly SurfacePattern[] = ["none", "plaster", "concrete", "granite", "ashlar", "tile", "timber", "brushed", "ground", "glass"];

describe("noise texture", () => {
  const a = noiseData();
  it("is deterministic", () => {
    const b = noiseData();
    expect(a.length).toBe(NOISE_SIZE * NOISE_SIZE * 4);
    expect(a.every((v, i) => v === b[i])).toBe(true);
  });
  it("uses the whole range of every channel (so shader amplitudes mean what they say)", () => {
    for (let c = 0; c < 4; c++) {
      let lo = 255;
      let hi = 0;
      let sum = 0;
      for (let i = c; i < a.length; i += 4) {
        lo = Math.min(lo, a[i]!);
        hi = Math.max(hi, a[i]!);
        sum += a[i]!;
      }
      expect(lo).toBeLessThan(8);
      expect(hi).toBeGreaterThan(247);
      const mean = sum / (a.length / 4) / 255;
      if (c < 3) {
        expect(mean).toBeGreaterThan(0.3);
        expect(mean).toBeLessThan(0.7);
      } else expect(mean).toBeLessThan(0.45); // the speckle channel is mostly dark with sparse bright flecks
    }
  });
  it("tiles: the seam is no rougher than the texture's own neighbouring pixels", () => {
    const px = (x: number, y: number, c: number) => a[((y * NOISE_SIZE + x) * 4) + c]!;
    for (let c = 0; c < 3; c++) {
      let seam = 0;
      let inner = 0;
      for (let y = 0; y < NOISE_SIZE; y++) {
        seam += Math.abs(px(0, y, c) - px(NOISE_SIZE - 1, y, c));
        inner += Math.abs(px(NOISE_SIZE / 2, y, c) - px(NOISE_SIZE / 2 - 1, y, c));
      }
      expect(seam).toBeLessThan(inner * 1.6 + 40);
    }
  });
});

describe("surface classification", () => {
  it("every library material gets a valid, bounded treatment", () => {
    for (const m of ALL_MATERIALS) {
      const s = surfaceSpecFor(m.id, m.substance);
      expect(PATTERNS).toContain(s.pattern);
      expect(s.tone).toBeGreaterThanOrEqual(0);
      expect(s.tone).toBeLessThanOrEqual(0.3); // restrained: at most ±30 % on the darkest granite, normally far less
      expect(s.rough).toBeLessThanOrEqual(0.15);
      expect(s.bump).toBeLessThanOrEqual(1);
      if (s.pattern === "ashlar") expect(s.cell && s.cell[0] > 0 && s.cell[1] > 0).toBe(true);
    }
  });
  it("applies the treatment by what the model ASSUMES the material is", () => {
    const by = (id: string) => surfaceSpecFor(id, ALL_MATERIALS.find((m) => m.id === id)!.substance).pattern;
    expect(by("masonry_paint_ext")).toBe("plaster");
    expect(by("concrete_fin")).toBe("concrete");
    expect(by("stone_cladding")).toBe("ashlar");
    expect(by("countertop_granite")).toBe("granite");
    expect(by("tile_porcelain_floor")).toBe("tile");
    expect(by("timber_door_teak")).toBe("timber");
    expect(by("metal_hardware")).toBe("brushed");
    expect(by("glass_clear")).toBe("glass");
    // MEP and appliance materials keep their plain PBR look (distinct by colour, roughness and metalness)
    for (const id of ["cpvc_cold", "upvc_swr", "brass_valve", "cable_power", "conduit_power", "hdpe_tank", "device_white"]) expect(by(id)).toBe("none");
  });
  it("an unknown id falls back to its substance, then to none", () => {
    expect(surfaceSpecFor("not-in-the-library", "timber").pattern).toBe("timber");
    expect(surfaceSpecFor("not-in-the-library").pattern).toBe("none");
  });
  it("structure and ground have their own finishes", () => {
    expect(STRUCTURE_SPEC.pattern).toBe("concrete");
    expect(GROUND_SPEC).toMatchObject({ pattern: "ground", bump: 0 });
  });
  it("glossy floor tiles keep their gloss class but reflect less of the sky; other materials are untouched", () => {
    const t = reflectionFor("porcelain_tile", 0.35, undefined);
    expect(t.roughness).toBeGreaterThanOrEqual(0.5);
    expect(t.envMapIntensity).toBeLessThanOrEqual(0.3);
    expect(reflectionFor("mild_steel", 0.5, undefined)).toEqual({ roughness: 0.5, envMapIntensity: 1 });
    expect(reflectionFor("glass", 0.05, 1.2)).toEqual({ roughness: 0.05, envMapIntensity: 1.2 });
  });
});

describe("shader patch", () => {
  /** The injection points are string replacements on three's own shader source: a three upgrade that renames a chunk would silently turn them into no-ops. */
  for (const pattern of PATTERNS.filter((p) => p !== "none")) {
    it(`${pattern}: every injection point exists in three's standard material and lands in the shader`, () => {
      const m = new MeshStandardMaterial();
      applySurface(m, { pattern, tone: 0.1, rough: 0.05, bump: 0.5, cell: [0.6, 0.3], joint: 0.004, piece: 0.05, stagger: true });
      const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, unknown> };
      (m.onBeforeCompile as (s: typeof shader, r: unknown) => void)(shader, null);
      expect(shader.vertexShader).toContain("vSfP = ");
      expect(shader.vertexShader).toContain("gl_InstanceID");
      expect(shader.fragmentShader).toContain("uniform sampler2D sfNoise");
      expect(shader.fragmentShader).toContain("diffuseColor.rgb *= clamp(sfK");
      expect(shader.fragmentShader).toContain("roughnessFactor = clamp(roughnessFactor + sfR");
      expect(shader.fragmentShader).toContain(pattern === "glass" ? "diffuseColor.a = mix" : "sfPerturb(-vViewPosition");
      expect(Object.keys(shader.uniforms).sort()).toEqual(["sfA", "sfB", "sfNoise"]);
      expect(m.customProgramCacheKey()).toBe(`surface:${pattern}`);
      m.dispose();
    });
  }
  it("a material cloned for an overlay does not inherit the patch (status colours stay flat and exact)", () => {
    const m = new MeshStandardMaterial();
    applySurface(m, STRUCTURE_SPEC);
    const c = m.clone();
    expect(c.onBeforeCompile).not.toBe(m.onBeforeCompile);
    const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} };
    (c.onBeforeCompile as (s: typeof shader, r: unknown) => void)(shader, null);
    expect(shader.fragmentShader).toBe(ShaderLib.standard.fragmentShader);
  });
  it("'none' leaves the material untouched", () => {
    const m = new MeshStandardMaterial();
    const before = m.onBeforeCompile;
    applySurface(m, { pattern: "none", tone: 0, rough: 0, bump: 0 });
    expect(m.onBeforeCompile).toBe(before);
  });
});
