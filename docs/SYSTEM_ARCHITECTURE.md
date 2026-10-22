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
    config.ts       — Authoritative building parameters + validation
    types.ts        — BuildingComponent, enums, scenario overlay
    ids.ts          — Deterministic ID builder/parser
    registry.ts     — Component store, mesh linking, queries
    index.ts        — Barrel export
    *.test.ts       — Unit tests
  scene/
    SceneHierarchy.tsx — Building > Floor > System group components
    StubViewer.tsx     — A0 placeholder (grid + slab planes)
    index.ts
  App.tsx           — Main entry, Canvas + overlay
  main.tsx          — DOM mount
docs/               — Project documentation
```

## Data Flow
```
BuildingConfig → Generators (A1+) → BuildingComponent[] → Registry
                                                             ↓
Canvas ← SceneHierarchy ← Meshes (userData.componentId) → Registry.getById()
                                                             ↓
                                                       Info Panel / Dashboard
```

## Scene Hierarchy
Building_G4 > Floor_{L0..ROOF} > {structure,architecture,plumbing,electrical} > Meshes

Each mesh carries `userData.componentId`. Registry maps mesh UUID → component ID for
raycasting lookups. Exploded-view offsets will be applied as group-level transforms
(reading `originalPosition`, never overwriting).

## Scenario Isolation
`ScenarioOverlay = Map<componentId, { removed, removalPhase }>` — kept outside
baseline `BuildingComponent` records. Multiple scenarios can coexist without mutating
the baseline registry.
