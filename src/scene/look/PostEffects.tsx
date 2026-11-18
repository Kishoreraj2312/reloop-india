/**
 * Post-processing (A*): multisampled HDR render, ground-truth ambient occlusion (three's GTAOPass) and the output pass (tone
 * mapping + sRGB). Appearance only. AO darkens where surfaces meet (wall / slab junctions, balcony soffits, window reveals, the
 * building's foot on the ground), which the image-based sky light alone cannot do.
 *
 * Kept safe next to the rest of the app:
 *  - AO reads the depth the main render wrote, so it sees exactly what is drawn: the section plane's cut, hidden layers and
 *    floors, removal-hidden members. Glass, X-ray ghosts, decals and the overlays (selection, traces, B3 / B4 highlights) write no
 *    depth, so X-ray mode keeps AO on the opaque services only and overlays never shade the model.
 *  - The renderer, frame loop ("demand") and every scene object are untouched: this only replaces the final draw call. `?ao=0`
 *    turns AO off (for comparison and for slow GPUs); the MSAA output path stays.
 */

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Box3, DepthTexture, HalfFloatType, Vector3, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from "three";
import type { Box3 as ModelBox } from "@/building/structure";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { AO } from "./palette";

/**
 * GTAOPass fed by the main render's own (MSAA-resolved) depth: normals are reconstructed from depth, exact for this box-built model,
 * so the pass never re-renders the scene. That keeps AO at about the cost of two full-screen passes, also while A4 animates.
 */
class SceneAOPass extends GTAOPass {
  /** AO buffer size relative to the drawing buffer. */
  scale: number;

  constructor(scene: Scene, camera: Camera, width: number, height: number, scale: number) {
    super(scene, camera, width * scale, height * scale);
    this.scale = scale;
  }

  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
  }

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    const depth = readBuffer.depthTexture;
    if (depth && depth !== this.depthTexture) {
      const first = this.gtaoMaterial.defines.NORMAL_VECTOR_TYPE !== 0;
      this.setGBuffer(depth); // the composer ping-pongs two targets: bind whichever holds this frame's scene
      if (first) this.gtaoMaterial.needsUpdate = this.pdMaterial.needsUpdate = true;
    }
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

const aoEnabled = () => typeof location === "undefined" || new URLSearchParams(location.search).get("ao") !== "0";

/**
 * `bounds`: the building (structure + architecture). AO is computed only inside a generous box around it (room for the exploded
 * floors above and the stage below): the far ground, seen at grazing angles, would otherwise show depth-precision striping.
 */
export function PostEffects({ bounds }: { bounds: ModelBox }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const invalidate = useThree((s) => s.invalidate);

  const { composer, ao } = useMemo(() => {
    // the depth texture is resolved from the multisampled buffer and read by the AO pass (EffectComposer clones it for its 2nd target)
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4, depthTexture: new DepthTexture(1, 1) });
    const composer = new EffectComposer(gl, target);
    composer.addPass(new RenderPass(scene, camera));
    let ao: SceneAOPass | null = null;
    if (aoEnabled()) {
      ao = new SceneAOPass(scene, camera, 1, 1, AO.resolution);
      ao.blendIntensity = AO.intensity;
      ao.updateGtaoMaterial({ radius: AO.radius, distanceExponent: 1.4, thickness: AO.thickness, scale: AO.power, samples: AO.samples, distanceFallOff: 1, screenSpaceRadius: false });
      ao.updatePdMaterial({ lumaPhi: 6, depthPhi: 1.5, normalPhi: 2, radius: 12, radiusExponent: 2, rings: 3, samples: AO.samples });
      if (new URLSearchParams(location.search).get("ao") === "debug") ao.output = GTAOPass.OUTPUT.Denoise; // the AO term alone
      composer.addPass(ao);
    }
    composer.addPass(new OutputPass());
    if (import.meta.env.DEV) (window as unknown as { __post?: unknown }).__post = { composer, ao }; // frame-cost measurement in the browser checks
    return { composer, ao };
  }, [gl, scene, camera]);

  useEffect(() => {
    if (ao) ao.scale = AO.resolution / Math.max(1, dpr); // AO at CSS-pixel resolution: a retina buffer adds cost, not visible detail
    composer.setPixelRatio(dpr);
    composer.setSize(size.width, size.height);
    invalidate();
  }, [composer, ao, size.width, size.height, dpr, invalidate]);

  useEffect(() => {
    if (!ao) return;
    const m = AO.clipMargin;
    ao.setSceneClipBox(
      new Box3(
        new Vector3(bounds.min[0] - m[0], bounds.min[1] - m[1], bounds.min[2] - m[0]),
        new Vector3(bounds.max[0] + m[0], bounds.max[1] + m[2], bounds.max[2] + m[0]),
      ),
    );
    invalidate();
  }, [ao, bounds, invalidate]);

  useEffect(
    () => () => {
      ao?.dispose();
      composer.dispose();
    },
    [composer, ao],
  );

  // priority 1: R3F hands the final draw over to the composer (the frame loop stays "demand")
  useFrame(() => composer.render(), 1);
  return null;
}
