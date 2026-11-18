/**
 * Procedural sky for image-based lighting and glass / metal reflections (no HDRI download, no dependency).
 * A gradient dome (sky, bright horizon band, darker ground) with a soft sun glow and two large soft-boxes, prefiltered by
 * PMREM once. Replaces the RoomEnvironment, whose indoor light panels showed up as reflections in exterior glass.
 */

import {
  BackSide,
  CanvasTexture,
  Color,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Texture,
} from "three";
import { SKY, SUN_DIR } from "./palette";

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */ `
uniform vec3 zenith; uniform vec3 horizon; uniform vec3 below;
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 c = h > 0.0 ? mix(horizon, zenith, pow(h, 0.5)) : mix(horizon, below, pow(-h, 0.45));
  gl_FragColor = vec4(c, 1.0);
}`;

export function buildSkyScene(): Scene {
  const scene = new Scene();
  const dome = new Mesh(
    new SphereGeometry(60, 48, 24),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { zenith: { value: new Color(SKY.envZenith) }, horizon: { value: new Color(SKY.envHorizon) }, below: { value: new Color(SKY.below) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
    }),
  );
  scene.add(dome);
  const sun = new Vector3(...SUN_DIR).multiplyScalar(45);
  const glow = new Mesh(new SphereGeometry(7, 16, 12), new MeshBasicMaterial({ color: new Color(1.0, 0.93, 0.8).multiplyScalar(5), toneMapped: false }));
  glow.position.copy(sun);
  scene.add(glow);
  // two soft-boxes: broad, even highlights on glass and metal instead of a single hot spot
  const box = (x: number, y: number, z: number, w: number, h: number, k: number) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(1, 1, 1).multiplyScalar(k), toneMapped: false }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  box(-30, 26, 22, 34, 18, 2.2);
  box(34, 18, 16, 26, 14, 1.4);
  return scene;
}

/** Vertical backdrop gradient (screen space): cool at the top, settling into the haze colour by mid-height. */
export function backdropTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 512;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");
  grad.addColorStop(0, hex(SKY.zenith));
  grad.addColorStop(0.55, hex(SKY.horizon));
  grad.addColorStop(1, hex(SKY.haze));
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}
