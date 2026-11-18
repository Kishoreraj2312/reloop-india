/**
 * Procedural surface detail for MeshStandardMaterial, added as a small shader patch (no new material class, no extra pass, no
 * geometry): subtle albedo / roughness variation, restrained bump, joints for stone and tiles, grain for timber, a Fresnel
 * response for glass.
 *
 * Why it is safe next to the rest of the app:
 *  - Coordinates are CANONICAL: instanced meshes use `instanceMatrix * position` and never `modelMatrix`, so the A4 floor / system
 *    translations (which live in the group matrices) do not make a pattern swim over its surface. Joint / grain patterns use the
 *    instance's own LOCAL frame, so they travel with a piece that A4 decomposes.
 *  - Per-piece variation uses `gl_InstanceID` (stable); it does not read matrices, so it cannot change when A4 or B3 rewrite them.
 *  - B2's recovery overlay swaps materials for `clone()`s. A clone does not inherit this patch, so status colours stay exact and flat.
 *  - It touches only the albedo multiplier, roughness, the shading normal and (glass) alpha: clipping planes, X-ray opacity,
 *    shadows and picking are untouched.
 */

import type { IUniform, MeshStandardMaterial, WebGLProgramParametersWithUniforms } from "three";
import { Vector4 } from "three";
import { surfaceNoise } from "./noiseTexture";
import type { SurfaceSpec } from "./surfaceSpecs";

const VERT_DECL = /* glsl */ `
varying vec3 vSfP;      // canonical position (metres): instance matrix applied, group / model matrix NOT
varying vec3 vSfN;      // canonical normal
varying vec3 vSfL;      // position in the piece's own frame, from its minimum corner (metres)
varying vec3 vSfNl;     // normal in the piece's own frame
varying vec3 vSfS;      // the piece's size (metres)
varying vec3 vSfAxis;   // one-hot: the piece's longest axis (timber grain direction)
varying float vSfId;    // stable per-piece random 0..1
`;

const VERT_BODY = /* glsl */ `
{
  vec3 sfSize = vec3(1.0);
  vSfId = 0.5;
  #ifdef USE_INSTANCING
    sfSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vSfP = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    vSfN = normalize(mat3(instanceMatrix) * objectNormal);
    vSfL = (transformed + 0.5) * sfSize;
    vSfId = fract(sin(float(gl_InstanceID) * 12.9898 + 4.1414) * 43758.5453);
  #else
    vSfP = transformed + vec3(17.3, 5.1, 9.7);
    vSfN = objectNormal;
    vSfL = transformed + vec3(20.0);
  #endif
  vSfNl = objectNormal;
  vSfS = sfSize;
  vSfAxis = sfSize.x >= sfSize.y && sfSize.x >= sfSize.z ? vec3(1.0, 0.0, 0.0) : (sfSize.y >= sfSize.z ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
}
`;

const FRAG_DECL = /* glsl */ `
uniform sampler2D sfNoise;
uniform vec4 sfA;   // x tone, y rough, z bump, w piece tone
uniform vec4 sfB;   // x cell u, y cell v, z half joint width, w stagger (0/1)
varying vec3 vSfP; varying vec3 vSfN; varying vec3 vSfL; varying vec3 vSfNl; varying vec3 vSfS; varying vec3 vSfAxis; varying float vSfId;

float sfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// the two in-plane coordinates of the face's dominant axis
vec2 sfPlane(vec3 p, vec3 n) {
  vec3 a = abs(n);
  return a.y > max(a.x, a.z) ? p.xz : (a.x > a.z ? p.zy : p.xy);
}
vec3 sfDominant(vec3 n) {
  vec3 a = abs(n);
  return a.y > max(a.x, a.z) ? vec3(0.0, 1.0, 0.0) : (a.x > a.z ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0));
}
vec3 sfPerturb(vec3 pos, vec3 N, vec2 dH, float faceDirection) {
  vec3 sx = normalize(dFdx(pos));
  vec3 sy = normalize(dFdy(pos));
  vec3 r1 = cross(sy, N);
  vec3 r2 = cross(N, sx);
  float det = dot(sx, r1) * faceDirection;
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * N - grad);
}
`;

/** Pattern bodies. Inputs: lo, mid, hi (noise samples), uvN (canonical plane). Outputs: sfK (albedo multiplier), sfR (roughness add), sfH (bump height). */
const PATTERN: Record<string, string> = {
  plaster: /* glsl */ `
    float sfBl = (lo.r - 0.5) * 0.9 + (mid.g - 0.5) * 0.7;
    sfK = 1.0 + sfA.x * (sfBl * 1.5 + (hi.b - 0.5) * 0.9);
    // faint vertical weathering: broad streaks, strongest where a wall face is vertical
    float sfStreak = texture2D(sfNoise, vec2(uvN.x * 0.45, uvN.y * 0.04)).g - 0.5;
    sfK *= 1.0 + sfA.x * 0.5 * sfStreak * (1.0 - abs(vSfN.y));
    sfR = (mid.r - 0.5) * sfA.y * 2.0;
    sfH = hi.b * 0.7 + hi.g * 0.3;`,
  concrete: /* glsl */ `
    float sfBl = (lo.r - 0.5) * 0.9 + (mid.g - 0.5) * 0.8;
    float sfPore = smoothstep(0.84, 0.98, hi.a);
    sfK = (1.0 + sfA.x * (sfBl * 1.6 + (hi.b - 0.5) * 1.1)) * (1.0 - 0.2 * sfPore);
    sfR = (mid.r - 0.5) * sfA.y * 2.0 + sfPore * 0.06;
    sfH = hi.b * 0.6 + hi.g * 0.3 - sfPore * 0.5;`,
  granite: /* glsl */ `
    float sfFleck = texture2D(sfNoise, uvN * 23.0).a;
    float sfXtal = texture2D(sfNoise, uvN * 11.0 + 0.5).b - 0.5;
    sfK = 1.0 + sfA.x * ((sfFleck - 0.35) * 1.6 + sfXtal * 1.2 + (lo.r - 0.5) * 0.4);
    sfR = (mid.g - 0.5) * sfA.y * 2.0;
    sfH = hi.b;`,
  ashlar: /* glsl */ `
    vec2 q = sfPlane(vSfL, vSfNl);
    vec2 cell = sfB.xy;
    float row = floor(q.y / cell.y);
    float shift = sfB.w * sfHash(vec2(row, vSfId * 7.0)) * cell.x;
    float colf = (q.x + shift) / cell.x;
    float col = floor(colf);
    float blk = sfHash(vec2(col, row) + vSfId * 17.0);
    float fx = (colf - col) * cell.x;
    float fy = (q.y / cell.y - row) * cell.y;
    float d = min(min(fx, cell.x - fx), min(fy, cell.y - fy));
    float aa = max(fwidth(d), 1e-5);
    float jm = 1.0 - smoothstep(sfB.z - aa, sfB.z + aa, d);
    float sfBl = (lo.r - 0.5) * 0.7 + (mid.g - 0.5) * 0.9;
    sfK = (1.0 + sfA.x * ((blk - 0.5) * 1.8 + sfBl * 0.8 + (hi.b - 0.5) * 0.6) + sfA.w * (vSfId - 0.5) * 2.0) * mix(1.0, 0.62, jm);
    sfR = (mid.r - 0.5) * sfA.y * 2.0 + jm * 0.15;
    sfH = hi.b * 0.5 - jm * 1.6;`,
  tile: /* glsl */ `
    // per-tile tone follows the tile's own instance; a hairline darker rim reads as the grout joint
    vec3 dn = sfDominant(vSfNl);
    vec2 q = sfPlane(vSfL, vSfNl);
    vec2 sz = sfPlane(vSfS, vSfNl);
    float d = min(min(q.x, sz.x - q.x), min(q.y, sz.y - q.y));
    float aa = max(fwidth(d), 1e-5);
    float rim = 1.0 - smoothstep(0.0015 - aa, 0.0035 + aa, d);
    float sfBl = (lo.r - 0.5) * 0.8 + (mid.g - 0.5) * 0.8;
    sfK = (1.0 + sfA.x * (sfBl * 1.4 + (hi.b - 0.5) * 0.8) + sfA.w * (vSfId - 0.5) * 2.0) * mix(1.0, 0.84, rim);
    sfR = (mid.r - 0.5) * sfA.y * 2.0 + rim * 0.2;
    sfH = hi.b * 0.5 - rim * 0.6;`,
  timber: /* glsl */ `
    vec3 dn = sfDominant(vSfNl);
    float along = dot(vSfL, vSfAxis);
    float across = dot(vSfL, max(vec3(1.0) - dn - vSfAxis, vec3(0.0))) + vSfId * 9.0;
    vec2 gu = vec2(across * 9.0, along * 0.8);
    float ring = texture2D(sfNoise, gu).g - 0.5;
    float pore = texture2D(sfNoise, vec2(across * 38.0, along * 2.2)).b - 0.5;
    sfK = 1.0 + sfA.x * (ring * 1.6 + pore * 0.7 + (lo.r - 0.5) * 0.4) + sfA.w * (vSfId - 0.5) * 2.0;
    sfR = ring * sfA.y * 1.5;
    sfH = 0.5 + pore * 0.8;`,
  brushed: /* glsl */ `
    vec3 dn = sfDominant(vSfNl);
    float along = dot(vSfL, vSfAxis);
    float across = dot(vSfL, max(vec3(1.0) - dn - vSfAxis, vec3(0.0)));
    float st = texture2D(sfNoise, vec2(across * 55.0, along * 1.5)).b - 0.5;
    sfK = 1.0 + sfA.x * st * 1.5;
    sfR = st * sfA.y * 2.0;
    sfH = 0.5;`,
  ground: /* glsl */ `
    float sfBl = (lo.r - 0.5) * 0.9 + (mid.g - 0.5) * 0.9;
    sfK = 1.0 + sfA.x * (sfBl * 1.8 + (hi.b - 0.5) * 1.2);
    sfR = (mid.r - 0.5) * sfA.y * 2.0;
    sfH = hi.b;`,
  glass: /* glsl */ `
    sfK = 1.0; sfR = 0.0; sfH = 0.5;`,
};

function fragmentColour(pattern: string): string {
  return /* glsl */ `
  float sfK = 1.0; float sfR = 0.0; float sfH = 0.5;
  {
    vec2 uvN = sfPlane(vSfP, vSfN);
    vec4 lo = texture2D(sfNoise, uvN * 0.22);
    vec4 mid = texture2D(sfNoise, uvN * 1.3 + 0.31);
    vec4 hi = texture2D(sfNoise, uvN * 7.0 + vec2(0.17, 0.43));
    ${PATTERN[pattern] ?? PATTERN.glass}
  }
  diffuseColor.rgb *= clamp(sfK, 0.4, 1.6);
  `;
}

const FRAG_ROUGH = /* glsl */ `
  roughnessFactor = clamp(roughnessFactor + sfR, 0.04, 1.0);
`;

function fragmentNormal(pattern: string): string {
  if (pattern === "glass") {
    // more mirror-like at grazing angles; near-clear when looking straight through (the interior stays readable)
    return /* glsl */ `
    {
      float sfF = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
      diffuseColor.a = mix(diffuseColor.a, 0.92, sfF * 0.85);
    }`;
  }
  return /* glsl */ `
  {
    vec2 sfD = vec2(dFdx(sfH), dFdy(sfH)) * sfA.z;
    normal = sfPerturb(-vViewPosition, normal, sfD, faceDirection);
  }`;
}

/** Add the procedural surface to `material` (idempotent per material). Clones of the material do NOT inherit it. */
export function applySurface(material: MeshStandardMaterial, spec: SurfaceSpec): void {
  if (spec.pattern === "none") return;
  const [cu, cv] = spec.cell ?? [1, 1];
  const uniforms: Record<string, IUniform> = {
    sfNoise: { value: surfaceNoise() },
    sfA: { value: new Vector4(spec.tone, spec.rough, spec.bump, spec.piece ?? 0) },
    sfB: { value: new Vector4(cu, cv, spec.joint ?? 0.004, spec.stagger ? 1 : 0) },
  };
  const pattern = spec.pattern;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_DECL}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_DECL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${fragmentColour(pattern)}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${fragmentNormal(pattern)}`);
  };
  material.customProgramCacheKey = () => `surface:${pattern}`;
  material.userData.surface = spec;
  material.needsUpdate = true;
}
