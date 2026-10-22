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
  scene/
    SceneHierarchy.tsx — Building > Floor > System > Assembly groups
    sceneTree.ts       — pure grouping of records into that hierarchy
    StructuralModel.tsx, ComponentMesh.tsx — records -> meshes (identity lives in ComponentMesh)
    geometryPool.ts, prismGeometry.ts, materials.ts — shared geometry/material, disposal
    Viewer.tsx, Lighting.tsx, CameraRig.tsx, framing.ts — Canvas, light, camera framing/views
    IdInspector.tsx, SelectionOutline.tsx, DevHooks.tsx — dev-only (ID inspector, outline, window.__reloop)
  App.tsx           — generate once, register once, render
scripts/browser/    — dependency-free Chrome/CDP verification (npm run verify:browser)
docs/               — Project documentation; docs/screenshots/a1 — A1 browser captures
```

## Data Flow
```
BuildingConfig -> generateStructure (pure) -> ComponentRecord[] --+--> registry.registerAll
                                                                   +--> StructuralModel -> ComponentMesh
Canvas <- SceneHierarchy <- meshes (userData.componentId, name = ID) --> registry.getById()
```
Records and meshes come from the same `getStructure(cfg)` output, so they cannot diverge.

## Scene Hierarchy
`Building_G4 > Floor_{FDN,L0..L4,ROOF} > {floor}_structure > {floor}_structure_{assembly} > mesh`

Each mesh carries `userData.componentId` and `name = component ID`. Exploded-view offsets will be applied as
group-level transforms (reading `originalPosition`, never overwriting).

## Rendering notes
- One mesh per component behind `ComponentMesh`; geometries are shared by dimension key (19 geometries for 939 meshes),
  one material per member type. Instancing can replace the wrapper without changing identity.
- `frameloop="demand"`; the shadow map is rendered once and frozen (`shadowMap.autoUpdate = false`) because the model
  is static — set `needsUpdate` when members move (A4). Cut views use per-material clip planes with `clipShadows`.
- Prisms (slab panels, stair flights) use `prismGeometry.ts`, **not** `ExtrudeGeometry`: in three r175 it emits no caps
  when `bevelEnabled: false`. `geometryPool.test.ts` guards this (closed, outward-wound meshes).

## Scenario Isolation
`ScenarioOverlay = Map<componentId, { removed, removalPhase }>` — kept outside
baseline `BuildingComponent` records. Multiple scenarios can coexist without mutating
the baseline registry.
