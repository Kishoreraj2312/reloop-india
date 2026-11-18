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
    mep/            — A3 pure generators: A1+A2 records -> PLB/ELC records (conceptual MEP)
      config.ts       every MEP assumption (zones, sizes, falls, devices)
      context.ts      shared state: spatial indexes, networks, A2 endpoint ledger, unresolved list
      net.ts router.ts walls.ts space.ts geom.ts parts.ts record.ts   graph builder, plan router,
                      wall chases, spatial index, part catalogue, drafts -> frozen records
      drainage.ts rainwater.ts water.ts devices.ts electrical.ts      the systems
      validate.ts     IDs, quantities, connectivity, falls, clashes (documented allow-list)
      generate.ts     generateMep / memoised getMep
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
scripts/browser/    — dependency-free Chrome/CDP verification (verify.mjs A1, verifyA2.mjs A2, verifyA3.mjs A3, verifyB1..B5.mjs, verifyC1/C2/C3.mjs, verifyA4/A5.mjs, shots.mjs)
scripts/plans/      — drawPlans.ts (npm run plans -> docs/plans/*.svg), schedule.ts, inventory.ts
docs/               — Project documentation; docs/screenshots/a1, docs/screenshots/a2, docs/plans
```

Look and presentation (A5): `scene/look` (palette, procedural sky), `scene/surface` (noise texture, per-substance finishes, shader
patch), `scene/presentation` (pure presets and guided scenes, camera flights, presenter side effects, the overlay UI), `src/ui/theme.css`
(tokens). See PRESENTATION_AND_VISUALS.md.

Part B and A4 modules: `engine/quantities` (B1), `engine/recovery` + `scene/recovery` (B2), `engine/removal` + `scene/removal` (B3),
`engine/scenarios` + `scene/scenarios` (B4: demolition vs deconstruction scenarios, see SCENARIO_PLANNING.md),
`engine/carbon` + `scene/carbon` (B5, see CARBON_ASSESSMENT.md), `engine/passport` + `scene/passport` (C1, see MATERIAL_PASSPORTS.md),
`engine/reuse` + `scene/reuse` (C2: reuse requirements, explainable matching, allocation ledger; see MATERIAL_REUSE_MATCHING.md),
`engine/tracking` + `scene/tracking` (C3: append-only recovery histories, planned-versus-actual reports; see RECOVERY_TRACKING.md),
`engine/explode` + `scene/explode` (A4: pure solver and rules in the engine; group/instance drivers, controller and panel in the
scene). Each engine is pure and reads the same records the viewer renders.

MEP rendering (A3): plumbing and electrical records go through the same instanced batches; catalogue
parts use vertex-coloured unit meshes (`scene/mep/partGeometry.ts`). Controls add system and category
toggles and an X-ray mode (A1/A2 materials ghosted); the inspector shows network, size, fall and
connections and traces a network over `connectedTo` (highlighted by `SelectionOutline`). Light
fittings stay visible when ceilings are hidden. See MEP_LAYOUT.md.

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

Each mesh carries `userData.componentId` and `name = component ID`. The exploded view (A4) applies floor and system
offsets as translations of the `Floor_*` and `<floor>_<system>` groups and assembly offsets as translation elements of the
instance matrices; canonical local transforms and `originalPosition` are never written (see EXPLODED_VIEW.md).

## Rendering notes
- Architecture: one InstancedMesh per floor × category × material × unit shape over a shared 1 m box / unit cylinder;
  instance matrix = translate × rotate × scale from the record. Layer/floor toggles set `group.visible` (no React
  re-render). Glass is plain transparency (opacity 0.3) over a procedural RoomEnvironment; no textures, no HDRI.
- Structure: one mesh per component behind `ComponentMesh`; geometries are shared by dimension key (19 geometries for 939 meshes),
  one material per member type. Instancing can replace the wrapper without changing identity.
- `frameloop="demand"`; the shadow map is rendered once and frozen (`shadowMap.autoUpdate = false`) because the model
  is static. While A4 displaces anything, the key light (named `KeyLight`) and its shadow frustum are refitted to the displaced
  bounds and `needsUpdate` is set with each change; the exact original values are restored at parameter 0. Cut views use
  per-material clip planes with `clipShadows` (world-space: they cut the displayed geometry).
- Instance matrix ownership: translation (elements 12–14) belongs to the A4 explosion, the linear part (0–11, 15) to B3's removal
  overlay (zero scale = removed), so the two compose; overlays that copy instances (B3 tints, selection outlines) register as
  followers of `scene/explode/instances.ts` and move with their source.
- Prisms (slab panels, stair flights) use `prismGeometry.ts`, **not** `ExtrudeGeometry`: in three r175 it emits no caps
  when `bevelEnabled: false`. `geometryPool.test.ts` guards this (closed, outward-wound meshes).

## Scenario Isolation
`ScenarioOverlay = Map<componentId, { removed, removalPhase }>` — kept outside
baseline `BuildingComponent` records. Multiple scenarios can coexist without mutating
the baseline registry.
