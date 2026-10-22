# ReLoop India — Component Data Model

## ID convention
Format: `SYSTEM-TYPE-FLOOR-LOCATION`, built/parsed by `buildComponentId()` / `parseComponentId()`
(`src/building/ids.ts`). IDs are deterministic: the same config always yields the same IDs in the same order.

| Segment | Values | Notes |
|---------|--------|-------|
| SYSTEM | `STR`, `ARC`, `PLB`, `ELC` | A1 uses `STR` only |
| TYPE | `FTG`, `PED`, `COL`, `BM`, `SLAB`, `STAIR`, … | stair flights and landings share `STAIR` |
| FLOOR | `G`, `F01`–`F04`, `RF` | see "Floor tag" below |
| LOCATION | grid nodes / panel tag / stair part | see per-type table |

### Grid labels
Letters run along **X** (A–G = x −18 … 18), numbers along **Z** (1–6 = z −15 … 15). Node `B2` = x −12, z −9.
`GRID_LABELS_X` / `GRID_LABELS_Z` in `config.ts`; `nodeLabel(ix, iz)` in `structure/grid.ts`.

### Floor tag (A0 `floor` field)
`floor` is a level index: **−1 foundation, 0 ground … 4, 5 roof** → tags `G`, `G`, `F01`…`F04`, `RF`
(foundation and ground both render as `G`; the TYPE segment keeps them distinct).
- Level members (beams, slabs) use the index of the level they sit on (beam at the L2 level → `F02`; ROOF → `RF`).
- Storey members (columns, stairs) use the index of the level at their **base**, i.e. the storey they serve:
  ground-storey columns/stairs (L0→L1) are `G`, L1→L2 are `F01`, … L4→ROOF are `F04`.
  *(The brief's examples read "F01 = storey 1"; here F01 is the first floor above ground, matching Indian
  G+4 usage and keeping `RF` unambiguous.)*

### Per-type IDs
| Type | Pattern | Examples |
|------|---------|----------|
| Footing | `STR-FTG-G-{node}` | `STR-FTG-G-B2` |
| Pedestal | `STR-PED-G-{node}` | `STR-PED-G-B2` |
| Column segment | `STR-COL-{storey tag}-{node}` | `STR-COL-G-B2`, `STR-COL-F01-B2` |
| Beam | `STR-BM-{level tag}-{X\|Z}-{nodeA}-{nodeB}` | `STR-BM-F01-X-B2-C2`, `STR-BM-G-Z-A1-A2`, `STR-BM-RF-X-A1-B1` |
| Slab panel | `STR-SLAB-{level tag}-P{nn}` or `…-P{nn}-{W\|E\|S\|N}` | `STR-SLAB-F02-P03`, `STR-SLAB-F01-P16-W` |
| Stair flight | `STR-STAIR-{storey tag}-FL1` / `-FL2` | `STR-STAIR-G-FL1` |
| Stair landing | `STR-STAIR-{storey tag}-LND` | `STR-STAIR-F02-LND` |

Beam direction `X` runs along the X axis (letters change A→B); `Z` along Z (numbers change 1→2).
Slab panel `P{nn}`: `nn = bayZ × 6 + bayX + 1`, row-major with X fastest (`P01` = bay A1–B2, `P16` = stair bay).
Suffix letters: `W` low-x side, `E` high-x side, `S` low-z strip, `N` high-z strip of an opened bay.

## BuildingComponent (`src/building/types.ts`)
`id, name, system, componentType, floor, materialId, dimensions, quantity, unit, condition, recoveryRoute,
confidence, parentId?, dependencies[], originalPosition, originalRotation` (+ reserved B-phase fields).

### A1 usage
- `materialId = "rcc_conceptual"` → `STRUCTURAL_MATERIAL` (`name: "reinforced concrete (conceptual)"`, 2400 kg/m³).
  The A0 field is `materialId`; the brief's "material" resolves through it. No steel quantities.
- `quantity` = concrete volume in `m3`, computed from the geometry descriptor (not rounded).
- `condition: "good"`, `recoveryRoute: "inspect"`, `confidence: "assumed"` — placeholders until B-phase.
- `dimensions`: `length` = extent along the member's long axis (beams) or X extent (compact members, slabs),
  `width` = transverse plan extent (Z for compact members), `height` = vertical, `thickness` for slabs/landings.
  Beam `length` is the **clear** length between joint faces.
- `parentId` = the member directly beneath (pedestal → footing, ground column → pedestal, column → column below).
- `dependencies` = members this one bears on / frames into (beam → its two joint members; slab panel → its four
  bay beams; flight → landing). Conceptual in A1; refined by the dependency logic in B3.
- `originalPosition` = local origin of the geometry (box centre; for prisms see below). `originalRotation` = `[0,0,0]`
  for all A1 members (orientation is baked into the geometry). Records and their arrays are `Object.freeze`d; the
  presentation layer copies the transform onto the mesh and never writes back.

## ComponentRecord (`src/building/structure/geometry.ts`)
`ComponentRecord = BuildingComponent & { assembly, geometry }` — the output of the generators and the only thing the
renderer consumes. `assembly ∈ footings | columns | beams | slabs | stairs | roof`.

`geometry` descriptors:
- `{ kind: "box", size: [x, y, z] }` — centred on `originalPosition`.
- `{ kind: "prism", plane: "xz" | "zy", profile: [[u, v], …], extent }` — 2D profile extruded symmetrically about the
  origin. `xz`: (x, z) profile extruded along Y (slab panels, with corner notches). `zy`: (z, y) profile extruded along X
  (stair flights; y relative to the storey level). Profile coordinates are relative to `originalPosition`.

## Scene hierarchy
`Building_G4 > Floor_{FDN|L0..L4|ROOF} > {floor}_structure > {floor}_structure_{assembly} > <mesh name = component ID>`
Each mesh has `userData.componentId` and is linked in the registry (`registry.linkMesh`, removed on unmount).
ROOF beams and roof slab panels live in the `roof` assembly; all other beams/slabs in `beams` / `slabs`.

## Scenario state
Scenario overlays (`ScenarioOverlay`) are separate Maps keyed by component ID. They hold `removed`, `removalPhase`
and `notes` without mutating baseline records.
