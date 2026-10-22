/**
 * Dev-only: exposes window.__reloop for console inspection and for the browser
 * verification script (renderer stats, programmatic selection).
 */

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type { Camera, Scene, WebGLRenderer } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three/examples/jsm/controls/OrbitControls.js";
import type { ComponentRecord } from "@/building/structure";

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  lines: number;
  points: number;
  geometries: number;
  textures: number;
  programs: number;
  meshes: number;
}

export interface ReloopDebug {
  records: readonly ComponentRecord[];
  gl: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  select(id: string | null): void;
  /** Move the camera (and orbit target) and render; for close-up inspection. */
  setView(position: readonly [number, number, number], target: readonly [number, number, number]): void;
  /** Force one render and report renderer.info; with shadow = true the frame includes the shadow pass. */
  stats(shadow: boolean): RenderStats;
}

declare global {
  interface Window {
    __reloop?: ReloopDebug;
  }
}

interface DevHooksProps {
  records: readonly ComponentRecord[];
  onSelect: (id: string | null) => void;
}

export function DevHooks({ records, onSelect }: DevHooksProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;

  useEffect(() => {
    const setView: ReloopDebug["setView"] = (position, target) => {
      camera.position.set(...position);
      controls?.target.set(...target);
      camera.lookAt(...target);
      controls?.update();
      invalidate();
    };
    const stats = (shadow: boolean): RenderStats => {
      // Manual reset so the numbers describe exactly this one render() call.
      const auto = gl.info.autoReset;
      gl.info.autoReset = false;
      gl.info.reset();
      gl.shadowMap.needsUpdate = shadow;
      gl.render(scene, camera);
      gl.info.autoReset = auto;
      const { render, memory, programs } = gl.info;
      let meshes = 0;
      scene.traverse((o) => {
        if ((o as { isMesh?: boolean }).isMesh) meshes++;
      });
      return {
        drawCalls: render.calls,
        triangles: render.triangles,
        lines: render.lines,
        points: render.points,
        geometries: memory.geometries,
        textures: memory.textures,
        programs: programs?.length ?? 0,
        meshes,
      };
    };
    window.__reloop = { records, gl, scene, camera, select: onSelect, stats, setView };
    return () => {
      delete window.__reloop;
    };
  }, [gl, scene, camera, controls, invalidate, records, onSelect]);

  return null;
}
