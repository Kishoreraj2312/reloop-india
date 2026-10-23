# ReLoop India — Quantity Engine (B1)

`src/engine/quantities/` turns the component records (A1 structure, A2 architecture, A3 MEP) into quantities that are
deterministic, traceable to source component ids, unit-correct and honestly labelled. Pure TypeScript: no React, no
Three.js, no DOM, no `Date`/random. The UI (inspector, inventory drawer) only reads the engine's memoised result.

```
getModelInventory()  ->  buildInventory(records, architectureModel)  ->  Inventory
  rows (leaf records) · byId (every record) · breakdowns {floor, system, category, material, componentType, assembly}
  totals · walls (masonry takeoff) · counts (products) · issues · massCoverage
buildSummary(inv) -> cards;  concreteTable / masonryTable / finishesTable / categoryCounts -> breakdown tables
filterRows / sortRows / totalOf (table) · rowsToCsv (export) · assemblyRollup (inspector)
```

| File | Responsibility |
|---|---|
| `types.ts` | `QuantityResult`, `QuantityIssue`, `Status`, `Kind`, `Unit`, `Category` |
| `units.ts` | base units only, fixed decimals per unit, `Qty<U>` (adding m2 to m3 does not compile), display helpers |
| `geometry.ts` | per-record measures from the descriptor, input validation |
| `materialProps.ts` | density table (below) and hollow-type overrides |
| `classify.ts` | `componentType` (+ material substance) → `Category` |
| `component.ts` | `computeComponent(record)`: primary, secondary, mass |
| `counts.ts` | product counts by assembly |
| `walls.ts` | masonry takeoff per wall assembly |
| `aggregate.ts`, `inventory.ts`, `summary.ts`, `csv.ts`, `modelInventory.ts` | aggregation, queries, cards/tables, export, the default building |

## Status definitions

| Status | Meaning |
|---|---|
| `calculated` | derived from geometry alone (volume, area, length, count, wall gross when every opening is linked) |
| `estimated` | needs an assumption: any mass (density × volume), a catalogue part's volume (fill fraction), a wall gross with an unlinked opening |
| `unavailable` | cannot be derived: `value: null` plus a structured issue. **Never 0.** |

A total takes the **worst** status of the members that contributed a value and carries `incompleteCount`, the members
that should have contributed but have no value (a partial total). A unit with no valid member is `null` /
`unavailable`. Issues have a severity: `warning` (look at this: invalid input, mismatch, unlinked opening) or `info`
(a documented limitation, e.g. a hollow product has no mass). Only warnings count as "Components with issues".

## Method per record

Each leaf (non-group) record gets a **primary** quantity in its own unit, optional **secondary** measures (distinct
units) and a **mass**. Every input is validated (finite and > 0); otherwise value null + `INVALID_VALUE`.

| Unit | Primary | Rule |
|---|---|---|
| m3 | volume | box: `sx·sy·sz` of the **local** size (rotation ignored: sloping stair rails/strings are rotated about X, their world bounding box is larger than the member); prism: `polygonArea × extent` (shoelace, exact, never the bounding box); cylinder: `π r² h` |
| m2 | area | box panel: the two largest sides (horizontal panel = length × width in plan, vertical = length × height); xz prism: polygon area |
| m | length | cylinder: its height; box: the side equal to `dimensions.length`, else the longest side (a 0.07 m skirting return is shorter than its 0.10 m height) |
| nr | count | 1 |

Every primary is cross-checked against `record.quantity` (relative 1e-9): a difference is a `RECORD_MISMATCH` issue.
Result on the default building: **84,365 leaves, 0 mismatches.**

Secondary: an m3 slab panel also reports its plan area (polygon); a non-volume item reports its modelled **volume**
only when it is a real solid (it has a density): tiles, boards, glass, stone, concrete bands. Never for sanitaryware,
appliances, cabinets, fittings or catalogue parts.

**Mass** = modelled solid volume × density, status `estimated`; concrete adds the assumption "reinforcement not
modelled and not included". Thin panels (glass, tiles, boards) use area × thickness × density through the box volume.
No density (hollow, assembled, mixed, catalogue part) → mass `unavailable` with `NO_DENSITY` (info) and the reason
"…solid box is not the product volume".

### Categories (`classify.ts`, 0 unclassified types in the model)

concrete, masonry, stone, tile_floor, tile_wall, screed, plaster, ceiling_board, skirting, glazing, glass_fixture
(mirrors, shower screens), timber, board (laminate/WPC doors), metal, sanitary, kitchen_unit, appliance, fitting, pipe,
cable, containment (conduit, trays), mep_equipment, mep_stub, roof_finish, assembly (groups), other (+ `UNCLASSIFIED`).
Lintels (`wall_lintel`, RCC) are **concrete**, not masonry. The full componentType → category table is in
`B1_AUDIT.md`. The brief's list had no cable/containment/plaster/roof/glass-fixture categories because it predates
the A3 model; they were added so that nothing falls into "other".

## Product counts (`counts.ts`)

Products are counted by assembly (or by the single part that is the product), never by parts.

| Product | Rule | Default building |
|---|---|---|
| Doors | `door` assemblies (cased openings separate) | 264 (+5 cased openings) |
| Windows | `window` assemblies | 171 |
| Kitchens | `kitchen` assemblies | 29 |
| WC pans / basins / shower trays / washers | `wc_pan`, `basin`, `shower_tray`, `appliance_washer` parts | 79 / 79 / 63 / 29 |
| Balconies with railing | `balcony` assemblies (canopies excluded) | 24 |
| Stair balustrades | `stair_handrail` parts | 15 |
| Light fittings | parts whose type starts `light_` | 1,186 (1,181 A2 + 5 A3 bulkheads) |
| Balusters, railing posts | **segments**, labelled separately | 1,713 / 168 |

## Wall takeoff (`walls.ts`)

A2 builds walls without CSG: the openings are absent from the wall pieces. Per `wall_assembly`:

- **net masonry** = Σ volume of pieces `wall_pier`, `wall_sill`, `wall_reveal`, `wall_above` (what is built)
- **lintel** = Σ `wall_lintel` volumes (RCC; reported under concrete)
- **void** per hosted opening: door `(o1 − o0)(head − bottom)·t` with bottom = slab top; window
  `(o1 − o0)(head − bottom + stoneSill)·t`, stone sill 0.03 m from `ARCH_CONFIG.openings.stoneSill.thickness` (the stone
  sill is part of the window assembly and sits in the gap below the sill panel). Reveals are real pieces: not deducted.
- **gross** = net + lintel + Σ voids (the solid wall band). Face areas: gross / t and net / t (t from the assembly, or the
  common piece thickness for the stairwell linings; checked, else status `estimated`).

Openings come from `getArchitecture().storeys[s].walls[i].openings` (extents). Each door/window/cased-opening assembly
lists `dependencies: [host wall id, lintel piece id]`; the key `host|lintel` links it to exactly one hosted opening, each
key is used once, and an opening without a unique link gives `UNLINKED_OPENING` and an `estimated` gross. Without the
architecture model the gross is `unavailable` (net is still calculated). On the default building 439 openings are
deducted exactly once; one is reported: the roof-access door `ARC-DOOR-RF-MUM-S-01` is hosted by the roof enclosure,
which is not a wall assembly with hosted openings (the enclosure masonry is still counted as leaves).

Wall figures are a view over the same leaves: they are **never added** to the building totals.

## Aggregation (`aggregate.ts`)

Group leaves by floor (`record.floor`: −1 FDN, 0 G, 1–4, 5 RF), system, category, material, componentType, assembly
(`parentId`) and building. Rules: leaves only (assemblies contribute counts, never physical quantities); every leaf
contributes at most one value per unit (primary, secondary and mass all have different units); a duplicate id gives
`DUPLICATE_ID` and the second copy is excluded; statuses as above. The table footer and the summary cards sum the same
way, so they agree. Sorting numerically on "Quantity" ignores the unit: filter by category first.

## Reconciliation identities (`model.test.ts`, run on the real model)

| # | Identity | Result |
|---|---|---|
| 1 | Σ by floor = Σ by category = Σ by material (= by system, by componentType) = building, per unit, to 1e-9 | pass, A1+A2 and full model |
| 2 | recomputed leaf quantity = `record.quantity` (1e-9) | 84,365 leaves, **0 mismatches** |
| 3 | concrete = Σ `descriptorVolume` of the 945 STR members + Σ ARC leaves whose material substance is concrete | 1,490.873 + 119.805 = 1,610.677 m3 (A1+A2) |
| 4 | per wall: net + lintel + voids = gross = the solid band computed independently from the generator's piece boxes cell by cell | all 896 hosted walls pass (and 25 sampled walls with openings) |
| 5 | Σ tile ≤ Σ screed ≤ Σ room clear area; tile/screed ≥ 0.97 per room | 4,886.29 ≤ 4,939.47 ≤ 5,041.24 m2; tile/screed 98.92 %, worst room 97.94 % |
| 6 | two builds are identical | pass |

Hand-checkable anchors (all asserted): column 0.45×0.45×3.6 = 0.729 m3 → 210 = 153.090 m3; footing 2.4 → 42 = 100.800;
pedestal 0.324 → 42 = 13.608; beam clear 5.55×0.30×0.50 = 0.8325 m3 (5.40 at L0); notched slab panel 32.40 m2 × 0.15 =
4.860 m3 < its 4.8735 bounding box; stair flight below its bounding box; 0.729 m3 × 2400 = 1,749.6 kg (estimated).
Wall with one door and one window by hand: net 12.08·t, lintel 0.30·t, voids 3.12·t, gross 15.50·t = 5.0 × 3.1 × t.

## Density table (`materialProps.ts`)

`reference` = a published unit weight / the value the repository already assumes; `assumed` = a typical handbook or
manufacturer value chosen here. **These are order-of-magnitude values for an exhibition-grade estimate. They were not
checked against the standard texts (none is bundled with the repository); verify before any design use.** A null
density means the model draws a hollow, assembled or mixed product as a solid box or cylinder, so a mass would be
wrong. Regenerate with `npx vite-node scripts/b1/report.ts --density`.

| materialId | density kg/m3 | basis | source | note |
|---|---:|---|---|---|
| `rcc_conceptual` | 2400 | reference | A1 STRUCTURAL_MATERIAL 2400 kg/m3 (plain concrete ≈ 24 kN/m3, IS 875 (Part 1)) | plaster/paint layer not included |
| `concrete_balcony` | 2400 | assumed | same convention as rcc_conceptual | plaster/paint layer not included |
| `concrete_band` | 2400 | assumed | same convention as rcc_conceptual | GRC/textured finish treated as concrete |
| `concrete_fin` | 2400 | assumed | same convention as rcc_conceptual | precast fin; GRC finish treated as concrete |
| `lintel_rcc_ext` | 2400 | assumed | same convention as rcc_conceptual | plaster/paint layer not included |
| `lintel_rcc_int` | 2400 | assumed | same convention as rcc_conceptual | plaster/paint layer not included |
| `masonry_paint_ext` | 1800 | reference | DECISIONS_AND_ASSUMPTIONS.md (A0): brick masonry 1800 kg/m3; IS 875 (Part 1) brickwork ≈ 1800–1920 | plaster and paint not counted separately |
| `masonry_paint_int` | 1800 | reference | DECISIONS_AND_ASSUMPTIONS.md (A0): brick masonry 1800 kg/m3; IS 875 (Part 1) brickwork ≈ 1800–1920 | plaster and paint not counted separately |
| `masonry_paint_core` | 1800 | reference | DECISIONS_AND_ASSUMPTIONS.md (A0): brick masonry 1800 kg/m3; IS 875 (Part 1) brickwork ≈ 1800–1920 | plaster and paint not counted separately |
| `cement_screed` | 2000 | assumed | cement mortar 1900–2100 kg/m3 (typical; IS 875 (Part 1)) |  |
| `plaster_soffit` | 2000 | assumed | cement mortar 1900–2100 kg/m3 (typical; IS 875 (Part 1)) | soffit plaster modelled as a thin board |
| `stone_cladding` | 2300 | assumed | sandstone 2200–2500 kg/m3 (typical) |  |
| `stone_coping` | 2700 | assumed | granite 2600–2800 kg/m3 (typical; IS 875 (Part 1) stone table) |  |
| `stone_tread` | 2700 | assumed | granite 2600–2800 kg/m3 (typical; IS 875 (Part 1) stone table) |  |
| `countertop_granite` | 2700 | assumed | granite 2600–2800 kg/m3 (typical; IS 875 (Part 1) stone table) |  |
| `tile_porcelain_floor` | 2400 | assumed | vitrified/porcelain tile body ≈ 2300–2500 kg/m3 (manufacturer range) |  |
| `tile_antiskid` | 2200 | assumed | ceramic tile body 2000–2400 kg/m3 (manufacturer range) |  |
| `tile_wall_ceramic` | 2200 | assumed | ceramic tile body 2000–2400 kg/m3 (manufacturer range) |  |
| `tile_backsplash` | 2200 | assumed | ceramic tile body 2000–2400 kg/m3 (manufacturer range) |  |
| `tile_balcony` | 2000 | assumed | ceramic tile body 2000–2400 kg/m3 (manufacturer range) | terracotta / stoneware tile, lower end of the range |
| `roof_finish` | null | assumed | composite | waterproofing + screed + tile layers are modelled as one board; no single density |
| `ceiling_gypsum` | 750 | assumed | 12.5 mm gypsum board ≈ 9–10 kg/m2 (manufacturer range) |  |
| `timber_frame` | 700 | assumed | teak / hardwood 630–720 kg/m3 (IS 875 (Part 1) timber table range) | solid hardwood section |
| `timber_door_teak` | null | assumed | composite | flush door leaf: solid box is not the product volume (real leaf has a core) |
| `timber_door_light` | null | assumed | composite | flush door leaf: solid box is not the product volume (real leaf has a core) |
| `laminate_door_wet` | null | assumed | composite | WPC/laminate door leaf: solid box is not the product volume |
| `cabinet_laminate` | null | assumed | composite | kitchen carcass/shutters: solid box is not the product volume |
| `cabinet_front_light` | null | assumed | composite | kitchen shutters: solid box is not the product volume |
| `metal_frame` | null | assumed | aluminium extrusion | hollow extruded sections drawn as solid boxes: solid box is not the product volume |
| `metal_railing` | null | assumed | mild steel | railing section (solid bar vs hollow tube) not specified: solid box is not the product volume |
| `metal_hardware` | null | assumed | stainless | hardware drawn as solid boxes: solid box is not the product volume |
| `metal_panel` | 2700 | assumed | aluminium 2700 kg/m3 | anodised plate drawn at its real thickness |
| `stainless_steel` | null | assumed | stainless | sinks, hoods, faucets drawn as solid boxes/cylinders: solid box is not the product volume |
| `pvc_pipe` | null | assumed | PVC | pipes drawn as solid cylinders; wall thickness not modelled: solid box is not the product volume |
| `glass_clear` | 2500 | assumed | soda-lime float glass ≈ 2500 kg/m3 |  |
| `glass_mirror` | 2500 | assumed | soda-lime float glass ≈ 2500 kg/m3 |  |
| `sanitary_ceramic` | null | assumed | vitreous china | sanitaryware drawn as solid boxes: solid box is not the product volume |
| `appliance_white` | null | assumed | assembled product | appliances drawn as solid boxes: solid box is not the product volume |
| `appliance_black` | null | assumed | assembled product | appliances drawn as solid boxes: solid box is not the product volume |
| `fixture_light` | null | assumed | assembled product | light fittings: solid box is not the product volume |
| `cpvc_cold` | null | assumed | CPVC | pipe drawn as a solid cylinder, wall thickness not modelled: solid box is not the product volume |
| `cpvc_hot` | null | assumed | CPVC | pipe drawn as a solid cylinder, wall thickness not modelled: solid box is not the product volume |
| `gi_pipe` | null | assumed | galvanised steel | pipe drawn as a solid cylinder, wall thickness not modelled: solid box is not the product volume |
| `upvc_swr` | null | assumed | uPVC | pipe drawn as a solid cylinder, wall thickness not modelled: solid box is not the product volume |
| `upvc_drain` | null | assumed | uPVC | pipe drawn as a solid cylinder, wall thickness not modelled: solid box is not the product volume |
| `upvc_vent` | null | assumed | uPVC | pipe drawn as a solid cylinder, wall thickness not modelled: solid box is not the product volume |
| `brass_valve` | null | assumed | brass | valve/meter body: solid box is not the product volume |
| `cast_iron_cover` | null | assumed | cast iron | catalogue part: solid box is not the product volume |
| `hdpe_tank` | null | assumed | HDPE | tank is hollow: solid box is not the product volume |
| `pump_body` | null | assumed | assembled product | pump set: solid box is not the product volume |
| `concrete_precast` | 2400 | assumed | same convention as rcc_conceptual | solid precast elements only (hollow chambers/tanks are excluded by type) |
| `steel_stand` | null | assumed | mild steel | frame drawn as a solid box: solid box is not the product volume |
| `enclosure_steel` | null | assumed | sheet steel | enclosure is hollow: solid box is not the product volume |
| `device_white` | null | assumed | assembled product | wiring device: solid box is not the product volume |
| `conduit_lighting` | null | assumed | rigid PVC | conduit drawn as a solid cylinder: solid box is not the product volume |
| `conduit_power` | null | assumed | rigid PVC | conduit drawn as a solid cylinder: solid box is not the product volume |
| `cable_lighting` | null | assumed | copper/PVC | cable drawn as a solid cylinder; conductor area not modelled |
| `cable_power` | null | assumed | copper/PVC | cable drawn as a solid cylinder; conductor area not modelled |
| `cable_armoured` | null | assumed | copper/XLPE/steel | cable drawn as a solid cylinder; conductor area not modelled |
| `tray_gi` | null | assumed | galvanised steel | tray drawn as an envelope; sheet thickness not modelled |
| `earth_gi` | null | assumed | galvanised steel | earthing conductor: solid box is not the product volume |

| componentType | density override |
|---|---|
| `sump_tank` | null: water tank is hollow: solid box is not the product volume |
| `earth_pit` | null: pit is hollow: solid box is not the product volume |
| `inspection_chamber` | null: chamber is hollow: solid box is not the product volume |
| `manhole` | null: manhole is hollow: solid box is not the product volume |
| `recharge_pit` | null: pit is hollow: solid box is not the product volume |

Catalogue parts (`geometry.kind === "part"`) never get a mass: their `size × fill` volume is a drawing aid.

## What is not modelled, and why

| Item | Why it is not in the totals |
|---|---|
| Reinforcement steel | bars/stirrups are not in the model; concrete is plain volume (mass assumption says so) |
| Structural steel | the structure is RCC only |
| MEP pipe wall thickness, conductor size | pipes/conduits/cables are solid cylinders: lengths and counts are reported, mass is not |
| Plaster and paint | material properties of the wall (`materialId`), not geometry |
| Mortar, adhesive, grout | joints are gaps (floor tile area < screed area on purpose) |
| Formwork | temporary works |

They appear in the drawer under "Not modelled" and are never shown as 0.

## Limitations

- Mass is a conceptual estimate (above); 92.5 % of the modelled solid volume has a density, the rest is hollow or
  assembled items.
- Wall face area is `volume / thickness`, not a measured face (exact because every piece has the run thickness).
- Tile and screed areas are separate quantities; neither is the room area.
- Door leaf, frame and glazing volumes are the model's solid boxes, not manufacturer data.
- Engine build ≈ 0.37 s for the 87,380 records (84,365 leaves); the first call after load builds, later calls are free.
