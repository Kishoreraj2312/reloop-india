/**
 * Site ground finish (A*, presentation only: there is no site survey). A shader patch on the ground plane's MeshStandardMaterial
 * that paints, in world XZ: a paved apron around the building footprint with a kerb line, a paved forecourt path from the
 * entrance steps southwards, and muted planted ground beyond, with broad tonal variation so the plane never reads as a flat void.
 * Joints fade out with distance (fwidth), so the far field does not alias. No geometry, no texture asset.
 */

import { Color, Vector4, type IUniform, type MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from "three";
import { surfaceNoise } from "./noiseTexture";
import { SITE } from "../look/palette";

const lin = (hex: number) => new Color(hex); // Color() converts sRGB hex to the working (linear) space

export interface GroundLayout {
  /** Footprint rectangle [minX, minZ, maxX, maxZ] (m). */
  readonly rect: readonly [number, number, number, number];
  /** Entrance x and the z of the footprint edge it opens onto (south, -z); null for no path. */
  readonly entrance: readonly [number, number] | null;
}

const DECL = /* glsl */ `
uniform sampler2D grNoise;
uniform vec4 grRect;      // minX, minZ, maxX, maxZ
uniform vec4 grEnt;       // x, edge z, half width, enabled
uniform vec4 grDims;      // apron width, paver u, paver v, stage (1: exploded view, a calm zone-free stage)
uniform vec3 grPaver; uniform vec3 grPaverAlt; uniform vec3 grKerb; uniform vec3 grLawn; uniform vec3 grSoil;
varying vec3 vGrW;
float grHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const COLOUR = /* glsl */ `
{
  vec2 p = vGrW.xz;
  // distance outside the footprint rectangle (0 inside)
  vec2 c = 0.5 * (grRect.xy + grRect.zw);
  vec2 h = 0.5 * (grRect.zw - grRect.xy);
  vec2 q = abs(p - c) - h;
  float dOut = length(max(q, 0.0));
  float apron = grDims.x;
  // forecourt path: from the entrance edge southwards
  float inPath = grEnt.w * step(abs(p.x - grEnt.x), grEnt.z) * step(p.y, grEnt.y + 0.01) * step(grEnt.y - 18.0, p.y);
  float paved = max(step(dOut, apron), inPath);
  // pavers: running bond, per-paver tone, joints that fade with distance
  vec2 cell = grDims.yz;
  float row = floor(p.y / cell.y);
  float u = p.x / cell.x + 0.5 * mod(row, 2.0);
  vec2 id = vec2(floor(u), row);
  float fx = fract(u) * cell.x;
  float fy = fract(p.y / cell.y) * cell.y;
  float d = min(min(fx, cell.x - fx), min(fy, cell.y - fy));
  float aa = max(fwidth(d), 1e-5);
  float joint = (1.0 - smoothstep(0.004 - aa, 0.004 + aa, d)) * (1.0 - smoothstep(0.02, 0.06, aa));
  float pv = grHash(id);
  vec4 n1 = texture2D(grNoise, p * 0.035);
  vec4 n2 = texture2D(grNoise, p * 0.21 + 0.37);
  vec4 n3 = texture2D(grNoise, p * 1.7);
  vec3 paver = mix(grPaver, grPaverAlt, smoothstep(0.25, 0.95, pv)) * (0.94 + 0.12 * n2.g) * mix(1.0, 0.72, joint);
  // kerb: a darker 15 cm band at the apron's edge (not along the path, which continues the paving)
  float kerb = (1.0 - inPath) * step(apron - 0.15, dOut) * step(dOut, apron);
  paver = mix(paver, grKerb * (0.95 + 0.1 * n3.b), kerb);
  // planted ground: lawn with drier patches; two octaves at rotated, unrelated scales so no tiling period shows
  vec2 pr = mat2(0.8, -0.6, 0.6, 0.8) * p;
  float b1 = texture2D(grNoise, pr * 0.013 + 0.21).r;
  float b2 = texture2D(grNoise, p * 0.047 + 0.63).g;
  float dry = smoothstep(0.55, 0.85, b1 * 0.6 + b2 * 0.4);
  vec3 ground = mix(grLawn, grSoil, dry * 0.45) * (0.93 + 0.1 * (b2 - 0.5) + 0.08 * (n2.g - 0.5) + 0.05 * (n3.b - 0.5));
  // a narrow worn verge next to the paving
  ground = mix(grSoil * 0.97, ground, smoothstep(0.0, 0.8, dOut - apron));
  // aerial perspective: the far field settles toward a pale, desaturated tone (the backdrop haze takes over from there)
  float far = smoothstep(25.0, 110.0, dOut);
  ground = mix(ground, vec3(dot(ground, vec3(0.3, 0.59, 0.11))) * 1.12, far * 0.55);
  vec3 site = mix(ground, paver, paved);
  // exploded view: displaced floors and systems stand on a plain light stage, not on site zones they no longer line up with
  vec3 stage = grPaver * (0.97 + 0.06 * (b2 - 0.5) + 0.03 * (n2.g - 0.5));
  diffuseColor.rgb *= mix(site, stage, grDims.w);
  grRough = mix(mix(0.97, 0.86 + 0.1 * n2.b + joint * 0.1, paved), 0.92, grDims.w);
}
`;

/** Switch a ground material between the site zones and the plain exploded-view stage. */
export function setGroundStage(material: MeshStandardMaterial, stage: boolean): void {
  const dims = (material.userData.groundDims as Vector4 | undefined);
  if (dims) dims.w = stage ? 1 : 0;
}

export function applyGround(material: MeshStandardMaterial, layout: GroundLayout): void {
  const [x0, z0, x1, z1] = layout.rect;
  const ent = layout.entrance;
  const uniforms: Record<string, IUniform> = {
    grNoise: { value: surfaceNoise() },
    grRect: { value: new Vector4(x0, z0, x1, z1) },
    grEnt: { value: new Vector4(ent?.[0] ?? 0, ent?.[1] ?? 0, SITE.path, ent ? 1 : 0) },
    grDims: { value: new Vector4(SITE.apron, SITE.paverSize[0], SITE.paverSize[1], 0) },
    grPaver: { value: lin(SITE.paver) },
    grPaverAlt: { value: lin(SITE.paverAlt) },
    grKerb: { value: lin(SITE.kerb) },
    grLawn: { value: lin(SITE.lawn) },
    grSoil: { value: lin(SITE.soil) },
  };
  material.userData.groundDims = uniforms.grDims!.value;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGrW;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvGrW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${DECL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\nfloat grRough = 1.0;\n${COLOUR}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = grRough;");
  };
  material.customProgramCacheKey = () => "site-ground";
  material.needsUpdate = true;
}
