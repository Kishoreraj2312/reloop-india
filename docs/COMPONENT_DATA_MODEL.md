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

---

## A2 — Architecture components (`system = "architecture"`, prefix `ARC`)

Generators in `src/building/architecture/` produce records through `arcRecord()` / `arcAssembly()` (`record.ts`), from
the same plan model the validators check; the renderer consumes only these records.

### Floor tag
Storey items use the storey index (`G`, `F01`…`F04`) like A1 columns/stairs: a wall, window or ceiling of the storey
between L1 and L2 is `F01`. Items on a level slab (balconies at level s, floor bands at level s) use that level. Roof items
(parapets, roof finish, access enclosure and its door, roof canopies over balcony stacks, roof-level stair lining) are `RF`.

### ID patterns (location segments)
Room ids are `{apartment}-{room}` (`A3-LIV`, `CM-COR`); apartments `A1`…`A6`, common areas `CM`.
Door/window keys are `{room}-{side}-{nn}`: the room the door swings into (windows: their room), the side of that room
the opening is on (N/S/E/W) and an index along that side. Child IDs always extend their parent's location.

| Prefix | Assembly | Components (examples) |
|---|---|---|
| `ARC-WALL` | exterior per bay `ARC-WALL-F01-EXT-S-C1-D1`; party/core per room pair `ARC-WALL-F01-A1-FOY-CM-COR`; stair lining `ARC-WALL-F01-CM-STC-WELL` | piers `-P01`, sill panel `-SL01`, reveals `-RV01/-RV02`, lintel `-LN01`, above-lintel `-AB01` (index = opening along the wall) |
| `ARC-PART` | same-apartment partition `ARC-PART-F02-A3-BED1-PAS` (`-R2` when a pair has two runs) | as walls |
| `ARC-WIN` | `ARC-WIN-F02-A3-LIV-N-01` | frame `-FRM-H/-B/-L/-R`, mullions `-MUL01`, sash members `-SSH01-H/-B/-L/-R`, glazing `-GLZ01`, handles `-HDL01`, stone sill `-SIL`, sunshade `-SHD` |
| `ARC-DOOR` | `ARC-DOOR-F01-A1-BED1-N-01` (roof: `ARC-DOOR-RF-MUM-S-01`) | threshold `-THR`, jambs `-JMB-L/-R`, head `-HED`, leaf `-LEF` (`-LEF01/02` double; glazed: `-STL-L/-R`, `-RAIL-T/-B`, `-GLZ`), hinges `-HNG01`, handles `-HDL-A-PLT`, `-HDL-A-LVR` (A/B = the two faces) |
| `ARC-BAL` | `ARC-BAL-F02-A1-S`; roof canopy `ARC-BAL-RF-A1-S-CAP` | `-SLB`, `-SOF`, `-FIN`, `-KRB-F/-L/-R`, `-HRL-F/-L/-R`, posts `-PST01`, balusters `-BLS001`, spout `-OUT` |
| `ARC-FLR` | per room `ARC-FLR-F01-A1-LIV` | screed `-SCR01` |
| `ARC-TILE` | floor tiles are children of `ARC-FLR`; wall tiling `ARC-TILE-F01-A1-BATH2-WAL` | floor tile modules `ARC-TILE-F01-A1-LIV-R03C05` (row/col on the room grid, `-2` for a cut second piece); wall panels `-WAL-N01`, column returns `-WAL-CE01` |
| `ARC-SKT` | children of `ARC-FLR` | `ARC-SKT-F01-A1-LIV-07` |
| `ARC-CEIL` | per room `ARC-CEIL-F01-A1-LIV` | field boards `-FLD01`, cove band `-COV01`, fascia `-FSC-N` |
| `ARC-FIX` | ceiling fittings `ARC-FIX-F01-A1-LIV`; utility appliances `ARC-FIX-F01-A1-UTL-APP` | lights `-LGT01`; washer `-APP-WSH`, stubs `-APP-CPW/-CPD`, drain `-APP-DRN` |
| `ARC-KIT` | per kitchen `ARC-KIT-F01-A1-KIT` | run `M` (main) / `L` (second): `-M-BAS01` carcass, `-M-BAS01-DW` drawer front, `-M-BAS01-DR` door front, `-M-WAL01(-DR)`, `-M-PLN`, `-M-CTP1`, `-M-BSP1`, `-M-FIL`; `-SNK-B/-1..4`, `-FCT-B/-S`, `-HOB`, `-HOD-C/-F`, `-FRG`, `-CPW`, `-CPD` |
| `ARC-BATH` | per wet room `ARC-BATH-F01-A1-BATH2` | `-SHW-T/-G/-M/-A/-H/-S`, `-DRN`, `-WC-P/-C`, `-BSN`, `-BSN-FCT-B/-S`, `-MIR`, `-TWR(-B1/-B2)`, `-TPH`, `-CP-WC`, `-CP-BSN-W/-D` |
| `ARC-STAIRFIN` | per stair storey `ARC-STAIRFIN-F01-FL1`, `-FL2`, `-LND` | treads `-TRD01`…, riser linings `-RSR01`…, balusters `-BLS01`, sloping handrail `-HRL`, wall string `-STR`; landing `-FIN` |
| `ARC-FAC` | per floor and side `ARC-FAC-F02-S`; plinth `ARC-FAC-G-PLN` | fins `-FIN-D1`, floor bands `-BND-C1-D1(-2)`, column cladding `-CLD-D1-1`, downpipes `-DP1`, rainwater heads `-RWH1`, number panel `-NUM`, lights `-LGT1`; plinth modules `-PLN-S-01`, cap `-PLN-CAP-S` |
| `ARC-ROOF` | `ARC-ROOF-RF-PAR-S`, `-FIN`, `-MUM`, `-SHF`, `-DRN` | parapet `-PAR-A1-B1`, coping `-CPG-A1-B1(-n)`, finish `-P07(-n)`, enclosure walls `-WAL-W`, `-WAL-S-P01/-LN01/-AB01`, slab `-SLB`, floor `-FLR01`, drains `-DRN1` |
| `ARC-ENT` | `ARC-ENT-G-MAIN` | landing `-LND`, steps `-STP01`, canopy `-CNP`, canopy lights `-CLT1` |

### Record fields (A2 additions to `BuildingComponent`)
- `assemblyType` (e.g. `window`, `wall`, `kitchen`, `floor_finish`), `apartmentId`, `roomId` where relevant.
- `materialId` keys into `ARCH_MATERIALS` (`materials.ts`): each entry has a `substance` (brick masonry, concrete,
  porcelain tile, glass, …) for Part B density/cost and render-only PBR parameters.
- `unit` / `quantity` follow the dimensions: `m3` = geometry volume (masonry pieces, lintels, slabs, stone),
  `m2` = length × width (horizontal panels, tiles) or length × height (vertical panels, glazing, leaves; walls as
  assemblies), `m` = length (skirting, rails, downpipes, plinths), `nr` = 1 (fittings, frames, assemblies).
  `dimensions` match the geometry box (tested). `unit` gained `nr` for this.
- `confidence = "assumed"`, `condition = "good"`, `recoveryRoute = "inspect"` (placeholders until Part B).
- `parentId` = the assembly (a real `group` record with an explicit envelope that its children lie inside);
  `dependencies` link openings to their host wall assembly and lintel piece.
- Geometry: `box` (axis-aligned, or rotated about X for sloping stair members), `cylinder` (pipes, rails, fittings),
  `group` (assemblies, not drawn). `originalPosition`/`originalRotation` are frozen; presentation never writes them.

### Rendering identity (instancing)
All architecture components are drawn as instances: one `InstancedMesh` per floor × category × material × unit
shape (`scene/arch/batches.ts`). `mesh.userData.componentIds[i]` and `registry.linkInstances` give the
instanceId → componentId map used for picking; `registry.getInstance(id)` gives the reverse for highlighting.
Structural members keep one mesh per member. Totals (default config): 51,494 records = 2,737 assemblies + 48,757 drawn
components (47,812 instanced, 945 plain meshes).

### Scene hierarchy (A2)
`Building_G4 > Floor_{FDN,L0..L4,ROOF} > {floor}_{structure|architecture} > {floor}_{system}_{category} > meshes/batches`.
Architecture categories: `exteriorWalls, partitions, openings, floors, ceilings, fixtures, stairFinishes, balconies,
facade, roof`. The assembly level is carried by `parentId` (assemblies are records, not scene nodes) so an exploded view
can offset whole categories by group transform and individual assemblies by instance matrix, without touching records.

---

## A3 — Plumbing and electrical components (`PLB`, `ELC`)

IDs: `PLB|ELC-{TYPE}-{floor}-{group}-{code}{nn}`, children of a group assembly
`PLB|ELC-{TYPE}-{floor}-{group}` (e.g. `PLB-DR-F01-A1-P012`, `ELC-CND-F02-A5-J004`).
Plumbing TYPE: `CW` cold water, `HW` hot water, `DR` drainage, `VT` stack vents, `RW` rainwater,
`SEW` external sewer. Electrical TYPE: `INC` supply, `PNL` panels / DBs, `SUB` submains and feeders,
`TRY` trays, `CND` conduits, `CBL` circuit cables, `DEV` devices, `LGT` new light fittings, `EAR`
earthing. Codes: `P` pipe, `C` conduit, `K` cable, `T` tray, `S` strip, `F` fitting, `V` valve,
`M` meter, `R` trap, `J` junction box, `D` device.

Fields added to `BuildingComponent` (optional, A3): `networkId` (network or circuit), `carries`
(circuits in a conduit/tray), `connectedTo` (physical joints, symmetric between MEP records, may
reference A2 endpoints), `nominalSize`, `gradient` with `flowFrom`/`flowTo` (drainage falls).
`dependencies` point upstream for supply and downstream for drainage. Runs are `m` (route length),
discrete items `nr`. Geometry kind `part` = catalogue unit mesh fitted to the record box
(`mep/parts.ts`). Materials: `mep/materials.ts`, looked up with A2's through `materialLibrary.ts`.
Scene categories: plumbing `water, hotWater, drainage, vent, rainwater`; electrical
`distribution, lighting, power, containment, earthing`.

---

## Quantities (B1)

Quantities are not stored on records (beyond the generator's own `quantity` + `unit`); they are derived by the quantity
engine, `src/engine/quantities/`, documented in [QUANTITY_ENGINE.md](QUANTITY_ENGINE.md). For every leaf record the
engine returns a primary quantity in the record's unit (cross-checked against `record.quantity`), derived measures, an
estimated mass where the material has a density, a status (`calculated` / `estimated` / `unavailable`), the method, the
assumptions, structured issues and the source component ids. Assemblies (`geometry.kind === "group"`) are counted as
one item and never summed; their parts carry the physical quantities. The reserved B-phase fields
(`densityKgM3`, `estimatedMassKg`, `assumptions`, `source`) are still unused: the density table lives in
`materialProps.ts` keyed by `materialId`, and passports (B2) will attach to it.

---

## Recovery assessment (B2)

User assessments are not record fields. They are a separate sparse map keyed by leaf component id (`classification`,
`recoveryPct`, `preparation`, `destination`, `lossNote`, `note`), persisted in the browser, and combined with the B1
quantities by `src/engine/recovery/`. The record's own `condition`, `recoveryRoute` and `confidence` placeholders are still
untouched. See [RECOVERY_ASSESSMENT.md](RECOVERY_ASSESSMENT.md).
