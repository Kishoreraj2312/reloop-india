# ReLoop India — System Architecture

## Stack
- **Framework:** React 19, TypeScript 5.8
- **3D:** Three.js r175, React Three Fiber 9, Drei 10
- **Bundler:** Vite 6
- **Tests:** Vitest 3

## Source Layout
```
src/
  building/
    config.ts       — Authoritative building parameters + validation (grid, levels, members, openings, stair)
    types.ts        — BuildingComponent, enums, scenario overlay
    ids.ts          — Deterministic ID builder/parser
    registry.ts     — Component store, mesh linking/unlinking, queries
    structure/      — A1 pure generators: config -> ComponentRecord[]
      grid.ts         derived grid, levels, joint (node) sizes, STRUCTURAL_MATERIAL
      geometry.ts     geometry descriptors (box | prism), ComponentRecord, volume helpers
      record.ts       record factory (IDs, defaults, freezing)
      footings.ts  columns.ts  beams.ts  slabs.ts  stairs.ts  openings.ts
      bounds.ts       record bounds + exact solids (used by framing and tests)
      index.ts        generateStructure(cfg), memoised getStructure(cfg)
      structure.test.ts
    architecture/   — A2 pure generators: config -> plan -> ComponentRecord[] (system "architecture")
      config.ts       ARCH_CONFIG: every A2 convention (datums, walls, openings, frames, finishes,
                      balconies, facade, roof, stair finish, kitchen, bathroom) + validateArchConfig
      materials.ts    material library (substance for Part B + PBR render params)
      layout.ts       layout contract: apartment types (S, N, NX, GC), instances per floor, common rooms
      plan.ts         world plan per storey: rooms, doors (swing data), windows, balconies
      boundaries.ts   wall kind per room boundary; footprints; clear rects
      validatePlan.ts tiling, connectivity, clear dims, swings, opening fit (stage 1 checks)
      walls.ts        wall runs, junction ownership, column subtraction, no-CSG opening pieces
      windows.ts doors.ts openings.ts balconies.ts facade.ts entrance.ts roof.ts      (envelope)
      interior.ts floors.ts ceilings.ts tiling.ts stairwell.ts stairFinish.ts          (interiors)
      fixtureSpace.ts kitchen.ts bathroom.ts                                            (fixtures)
      record.ts       arcRecord/arcAssembly, units/quantities, box helpers, floorTag
      validateComponents.ts  IDs, hierarchy, quantities, spatial-hashed overlaps (exact for sloped
                             members), coplanar-face check
      generate.ts     generateArchitectureModel / memoised getArchitecture
      *.test.ts       plan, envelope, interiors, fixtures
  scene/
    SceneHierarchy.tsx — Building > Floor > System > Assembly-category groups
    sceneTree.ts       — pure grouping of records into that hierarchy (per system)
    BuildingModel.tsx  — structure meshes (ComponentMesh) + architecture batches (InstancedBatch);
                         visibility applied imperatively to named groups; clip planes; disposal
    arch/              — batches.ts (instancing plan + instanceId->componentId), InstancedBatch.tsx,
                         archMaterials.ts, unitGeometry.ts
    viewState.ts       — layers, floor isolation, ceilings-in-cutaway (pure) -> group visibility
    ControlsPanel.tsx, ComponentInspector.tsx — minimal panels (layers/floors/reset; selection details)
    geometryPool.ts, prismGeometry.ts, materials.ts — shared structural geometry/material
    Viewer.tsx, Lighting.tsx, EnvironmentLight.tsx (RoomEnvironment), SiteGround.tsx, CameraRig.tsx, framing.ts
    SelectionOutline.tsx (plain meshes, instances, whole assemblies), DevHooks.tsx (window.__reloop, dev only)
  App.tsx           — generate once (structure + architecture), register once, render; URL params
scripts/browser/    — dependency-free Chrome/CDP verification (verify.mjs A1, verifyA2.mjs A2, shots.mjs)
scripts/plans/      — drawPlans.ts (npm run plans -> docs/plans/*.svg), schedule.ts, inventory.ts
docs/               — Project documentation; docs/screenshots/a1, docs/screenshots/a2, docs/plans
```

## Data Flow
```
BuildingConfig ----------------> generateStructure (pure) -> STR records ----------------+
BuildingConfig + ARCH_CONFIG --> layout -> plan -> generateArchitecture -> ARC records --+--> registry.registerAll
                                          |                                              +--> BuildingModel
                                          +--> validatePlan / validateComponents (tests)      |- ComponentMesh (STR)
Canvas <- SceneHierarchy <- meshes + InstancedMeshes (componentId / componentIds[i]) -->  |- InstancedBatch (ARC)
                                                    registry.getById / getIdByMesh(uuid, instanceId)
```
Records, meshes and instances come from the same generator output, so they cannot diverge; the browser check
confirms every drawn component resolves to exactly one record.

## Scene Hierarchy
`Building_G4 > Floor_{FDN,L0..L4,ROOF} > {floor}_{structure|architecture} > {floor}_{system}_{assembly|category} > mesh | InstancedMesh`

Each mesh carries `userData.componentId` and `name = component ID`. Exploded-view offsets will be applied as
group-level transforms (reading `originalPosition`, never overwriting).

## Rendering notes
- Architecture: one InstancedMesh per floor × category × material × unit shape over a shared 1 m box / unit cylinder;
  instance matrix = translate × rotate × scale from the record. Layer/floor toggles set `group.visible` (no React
  re-render). Glass is plain transparency (opacity 0.3) over a procedural RoomEnvironment; no textures, no HDRI.
- Structure: one mesh per component behind `ComponentMesh`; geometries are shared by dimension key (19 geometries for 939 meshes),
  one material per member type. Instancing can replace the wrapper without changing identity.
- `frameloop="demand"`; the shadow map is rendered once and frozen (`shadowMap.autoUpdate = false`) because the model
  is static — set `needsUpdate` when members move (A4). Cut views use per-material clip planes with `clipShadows`.
- Prisms (slab panels, stair flights) use `prismGeometry.ts`, **not** `ExtrudeGeometry`: in three r175 it emits no caps
  when `bevelEnabled: false`. `geometryPool.test.ts` guards this (closed, outward-wound meshes).

## Scenario Isolation
`ScenarioOverlay = Map<componentId, { removed, removalPhase }>` — kept outside
baseline `BuildingComponent` records. Multiple scenarios can coexist without mutating
the baseline registry.
