/**
 * Presentation-only site ground at finished grade (not a building component): anchors the building visually and hides the
 * below-grade foundations in exterior views. It fades radially into the backdrop haze, so there is no horizon edge. Hidden when
 * the foundation floor is isolated. While the exploded view displaces members it becomes a stage: the plane drops below the
 * lowest displaced point (set each frame by the explode controller through `placeGroundStage`), so the separated floors and
 * systems stand on it and cast shadows on it instead of cutting through it.
 */

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { CanvasTexture, LinearFilter, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace, type Object3D } from "three";
import type { Box3 } from "@/building/structure";
import { useExplodeActive } from "./explode/explodeStore";
import { ARCH_CONFIG } from "@/building/architecture/config";
import { GROUND } from "./look/palette";
import { applyGround, setGroundStage } from "./surface/groundShader";

const SIZE = GROUND.fadeRadius * 2;
export const GROUND_NAME = "SiteGround";
/** 3 mm below grade so the bottom faces of the entrance steps never share its plane. */
export const GRADE_Y = ARCH_CONFIG.datums.siteGrade - 0.003;

/** Radial alpha: opaque out to `solidRadius`, smoothly transparent at `fadeRadius` (the plane is square; the corners are clear). */
function fadeTexture(): CanvasTexture {
  const n = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  const r = n / 2;
  const a = GROUND.solidRadius / GROUND.fadeRadius;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  const steps = 128; // fine stops: a coarse gradient shows as rings where the lawn fades into the haze
  for (let i = 0; i <= steps; i++) {
    const x = i / steps;
    const u = Math.min(1, Math.max(0, (x - a) / (1 - a)));
    const alpha = 1 - u * u * (3 - 2 * u); // smoothstep
    const v = Math.round(alpha * 255);
    grad.addColorStop(x, `rgb(${v},${v},${v})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; // the alpha map is read from the green channel as-is
  t.magFilter = LinearFilter;
  return t;
}

const CONTACT_MARGIN = 3.2; // metres of soft darkening around the footprint

/**
 * Soft contact shadow: a darkening that is strongest at the building's edge and fades to nothing over a few metres, like the
 * ambient occlusion where a building meets the ground. Luminance is the alpha (alphaMap), accumulated from nested rounded
 * rectangles, so no canvas blur filter is needed. A decal on the ground plane, not geometry.
 */
function contactTexture(w: number, d: number): CanvasTexture {
  const px = 512 / Math.max(w, d);
  const cw = Math.round(w * px);
  const ch = Math.round(d * px);
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, cw, ch);
  const layers = 26;
  const m = CONTACT_MARGIN * px;
  for (let i = 0; i < layers; i++) {
    const inset = m * (1 - Math.pow(1 - i / layers, 2)); // layer 0: full margin; the last ones hug the footprint
    g.fillStyle = "rgba(255,255,255,0.016)";
    g.beginPath();
    g.roundRect(inset, inset, cw - 2 * inset, ch - 2 * inset, Math.max(2, m - inset));
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = LinearFilter;
  return t;
}

/** Move the ground to `y` (the exploded stage) or back to grade (`null`). Called by the explode controller. */
export function placeGroundStage(root: Object3D, y: number | null): void {
  const g = root.getObjectByName(GROUND_NAME);
  if (g) g.position.y = y === null ? GRADE_Y : y;
}

/** `entrance`: [x, z] of the main entrance (the forecourt path starts there); omitted: no path. */
export function SiteGround({ visible, footprint, entrance }: { visible: boolean; footprint?: Box3; entrance?: readonly [number, number] }) {
  const exploded = useExplodeActive();
  const alphaMap = useMemo(fadeTexture, []);
  const contact = useMemo(() => {
    if (!footprint) return null;
    const w = footprint.max[0] - footprint.min[0] + 2 * CONTACT_MARGIN;
    const d = footprint.max[2] - footprint.min[2] + 2 * CONTACT_MARGIN;
    const map = contactTexture(w, d);
    const material = new MeshBasicMaterial({ color: 0x14171a, alphaMap: map, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return { w, d, cx: (footprint.min[0] + footprint.max[0]) / 2, cz: (footprint.min[2] + footprint.max[2]) / 2, map, material };
  }, [footprint]);
  useEffect(
    () => () => {
      contact?.map.dispose();
      contact?.material.dispose();
    },
    [contact],
  );
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ color: GROUND.color, roughness: 1, metalness: 0, alphaMap, transparent: true });
    if (footprint)
      applyGround(m, {
        rect: [footprint.min[0], footprint.min[2], footprint.max[0], footprint.max[2]],
        entrance: entrance ? [entrance[0], footprint.min[2]] : null,
      });
    return m;
  }, [alphaMap, footprint, entrance]);
  const invalidate = useThree((st) => st.invalidate);
  useEffect(() => {
    setGroundStage(material, exploded);
    invalidate();
  }, [material, exploded, invalidate]);
  useEffect(
    () => () => {
      material.dispose();
      alphaMap.dispose();
    },
    [material, alphaMap],
  );
  return (
    <>
      <mesh name={GROUND_NAME} rotation={[-Math.PI / 2, 0, 0]} position={[0, GRADE_Y, 0]} visible={visible} receiveShadow renderOrder={-1000}>
        <planeGeometry args={[SIZE, SIZE]} />
        <primitive object={material} attach="material" />
      </mesh>
      {contact && (
        <mesh name="SiteContactShadow" rotation={[-Math.PI / 2, 0, 0]} position={[contact.cx, GRADE_Y + 0.004, contact.cz]} visible={visible && !exploded} renderOrder={-999} raycast={() => undefined}>
          <planeGeometry args={[contact.w, contact.d]} />
          <primitive object={contact.material} attach="material" />
        </mesh>
      )}
    </>
  );
}
