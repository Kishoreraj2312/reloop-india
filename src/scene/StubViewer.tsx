/**
 * ReLoop India — A0 Stub Viewer
 *
 * Renders grid lines and thin placeholder slab planes through the scene
 * hierarchy to prove: hierarchy → click → mesh userData → registry lookup.
 *
 * THIS IS A STUB. Real structural geometry starts in A1.
 */

import { useRef, useMemo, useCallback } from "react";
import { Mesh, BufferGeometry, LineBasicMaterial, Float32BufferAttribute } from "three";
import { useThree } from "@react-three/fiber";
import {
  DEFAULT_CONFIG,
  gridPositions,
  levelElevations,
  LEVEL_NAMES,
  validateConfig,
} from "@/building/config";
import { buildComponentId } from "@/building/ids";
import { registry } from "@/building/registry";
import type { BuildingComponent } from "@/building/types";
import type { LevelName } from "@/building/config";
import { BuildingGroup, FloorGroup, SystemGroup } from "./SceneHierarchy";

// ── Register placeholder slab components ────────────────────────────────────
const cfg = DEFAULT_CONFIG;
const validationErrors = validateConfig(cfg);
if (validationErrors.length > 0) {
  console.error("Building config validation failed:", validationErrors);
}

const elevs = levelElevations(cfg);
const xPos = gridPositions(cfg.footprintX, cfg.gridSpacingX, cfg.gridCountX);
const zPos = gridPositions(cfg.footprintZ, cfg.gridSpacingZ, cfg.gridCountZ);

// Create one placeholder slab component per level
const stubComponents: BuildingComponent[] = LEVEL_NAMES.slice(0, 5).map((level, i) => {
  const id = buildComponentId({
    system: "structure",
    type: "SLAB",
    floor: i,
    location: "STUB",
  });
  return {
    id,
    name: `Placeholder Slab ${level}`,
    system: "structure" as const,
    componentType: "slab",
    floor: i,
    materialId: "concrete_m30",
    dimensions: {
      length: cfg.footprintX,
      width: cfg.footprintZ,
      thickness: cfg.slab.thickness,
    },
    quantity: cfg.footprintX * cfg.footprintZ * cfg.slab.thickness,
    unit: "m3" as const,
    condition: "good" as const,
    recoveryRoute: "recycle" as const,
    confidence: "assumed" as const,
    dependencies: [],
    originalPosition: [0, elevs[level]!, 0] as const,
    originalRotation: [0, 0, 0] as const,
  };
});

// Register stubs (idempotent guard)
registry.clear();
for (const c of stubComponents) {
  registry.register(c);
}

// ── Grid lines geometry ─────────────────────────────────────────────────────

function GridLines() {
  const geo = useMemo(() => {
    const verts: number[] = [];
    const yLine = -0.01; // just below ground datum
    // X lines (along Z)
    for (const x of xPos) {
      verts.push(x, yLine, zPos[0]!, x, yLine, zPos[zPos.length - 1]!);
    }
    // Z lines (along X)
    for (const z of zPos) {
      verts.push(xPos[0]!, yLine, z, xPos[xPos.length - 1]!, yLine, z);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(verts, 3));
    return g;
  }, []);

  const mat = useMemo(() => new LineBasicMaterial({ color: 0x4a5568, opacity: 0.6, transparent: true }), []);

  return <lineSegments geometry={geo} material={mat} />;
}

// ── Placeholder slabs ───────────────────────────────────────────────────────

interface SlabPlaneProps {
  component: BuildingComponent;
  onClick: (id: string) => void;
}

function SlabPlane({ component, onClick }: SlabPlaneProps) {
  const meshRef = useRef<Mesh>(null);
  const [px, py, pz] = component.originalPosition;

  // Link mesh to registry on mount
  const onMeshReady = useCallback(
    (mesh: Mesh | null) => {
      if (mesh) {
        mesh.userData.componentId = component.id;
        registry.linkMesh(mesh.uuid, component.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (meshRef as any).current = mesh;
      }
    },
    [component.id],
  );

  return (
    <mesh
      ref={onMeshReady}
      position={[px, py, pz]}
      onClick={(e) => {
        e.stopPropagation();
        onClick(component.id);
      }}
    >
      <boxGeometry args={[cfg.footprintX - 0.5, cfg.slab.thickness, cfg.footprintZ - 0.5]} />
      <meshStandardMaterial
        color={0x718096}
        transparent
        opacity={0.35}
        roughness={0.8}
      />
    </mesh>
  );
}

// ── Main stub building component ────────────────────────────────────────────

interface StubBuildingProps {
  onSelect: (id: string | null) => void;
}

export function StubBuilding({ onSelect }: StubBuildingProps) {
  useThree(); // ensure we are inside Canvas context

  const handleClick = useCallback(
    (id: string) => {
      const comp = registry.getById(id);
      if (comp) {
        onSelect(id);
      }
    },
    [onSelect],
  );

  return (
    <BuildingGroup>
      <GridLines />
      {LEVEL_NAMES.slice(0, 5).map((level, i) => {
        const comp = stubComponents[i]!;
        return (
          <FloorGroup key={level} level={level as LevelName}>
            <SystemGroup system="structure" level={level as LevelName}>
              <SlabPlane component={comp} onClick={handleClick} />
            </SystemGroup>
          </FloorGroup>
        );
      })}
    </BuildingGroup>
  );
}
