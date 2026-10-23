# ReLoop India — Execution Roadmap

## Phase Sequence

### Part A — Digital Twin
| Phase | Goal | Status |
|-------|------|--------|
| A0 | Project foundation, config, types, registry, stub viewer | ✅ Done |
| A1 | Parametric structural building (foundations through roof) | ✅ Done |
| A2 | Architecture & interiors (walls, doors, windows, rooms) | ✅ Done |
| A3 | Plumbing & electrical systems | ✅ Done (conceptual; see MEP_LAYOUT.md) |
| A4 | Interactions & cinematic exploded assembly | Planned |
| A5 | Visual refinement & performance optimization | Planned |

### Part B — Engineering & Circularity
| Phase | Goal |
|-------|------|
| B1 | Quantity engine & material inventory from geometry — ✅ Done (see B1 Results) |
| B2 | Material passports & recovery assessment |
| B3 | Removal simulation with dependency logic |
| B4 | Demolition vs deconstruction scenarios |
| B5 | Environmental & economic estimates |

### Part C — Integration & Presentation
| Phase | Goal |
|-------|------|
| C1 | Main application interface |
| C2 | Dashboard with metrics & charts |
| C3 | Optional reporting & bounded AI assistance |
| C4 | End-to-end testing & expo readiness |

---

## B1 Results — Quantity Takeoff & Material Inventory
Method, rules, identities and the density table: `QUANTITY_ENGINE.md`. Audit (counts, code-vs-brief differences,
componentType table): `B1_AUDIT.md`. Screenshots: `docs/screenshots/b1/`.

**Delivered.** `src/engine/quantities/` (pure engine) + the inspector's takeoff block + the Inventory drawer
(`src/scene/inventory/`, opened from the controls panel). One engine: the UI only filters, sorts and renders the
memoised `getModelInventory()`.

**Scope note.** The brief described A1 + A2 (51,494 records); the code also contains A3 MEP, so the app registers
**87,380 records** (84,365 leaves). The engine covers all of them; the identities are tested on STR + ARC and on the full
model.

**Building totals (default config, full model, leaves only)**
| Category | Quantity | Status |
|---|---|---|
| Concrete (A1 1,490.873 + A2 119.805 + 0.225 MEP plinth) | 1,610.902 m3 (lintels 14.386 inside) | calculated; reinforcement not modelled |
| Masonry (net, as built) | 1,332.235 m3 (wall gross 1,451.058 = net 1,282.049 in walls + lintel 14.355 + 439 voids 154.655) | calculated |
| Floor tile / screed | 5,093.01 / 4,939.47 m2 (rooms only: 4,886.29 tile ≤ 4,939.47 screed ≤ 5,041.24 clear) | calculated |
| Ceilings / wall tiles / skirting / glazing | 5,041.78 m2 / 1,447.74 m2 / 2,929.77 m / 235.44 m2 | calculated |
| Pipes / cables (route length) | 3,861.24 m / 12,013.01 m | calculated |
| Estimated mass | 6,934.82 t, covers 92.5 % of the modelled solid volume (concrete 3,866 t, masonry 2,398 t, finishes the rest) | estimated; 46,057 components have no mass |
| Products | 264 doors (+5 cased openings), 171 windows, 29 kitchens, 79 WC, 79 basins, 63 shower trays, 29 washers, 24 balconies, 15 stair balustrades, 1,186 light fittings; 1,713 balusters and 168 posts as segments | calculated |

**Unavailable / not modelled:** reinforcement, structural steel, MEP pipe wall and conductor size, plaster/paint, mortar,
formwork (listed in the drawer, never 0). Mass is `unavailable` (documented, `info` issue) for hollow/assembled items drawn
as solid boxes: sanitaryware, cabinets, appliances, light fittings, aluminium frames, flush doors, railings, pipes, cables,
MEP parts. **Issues:** 0 record mismatches over 84,365 leaves, 0 unclassified types, 1 warning (the roof-access door is
hosted by the roof enclosure, not a wall: `UNLINKED_OPENING`, no total affected).

**Verification actually run**
- `npm run typecheck` clean; `npm test` 305 tests / 16 files pass (new: 61 tests in 2 files: 35 unit + 26 on the real model incl. the 6
  reconciliation identities); `npm run build` passes (bundle 1,446 kB, 422 kB gzipped; chunk-size warning only). No lint
  tool exists (none added).
- Engine build 0.37 s for the 87,380 records in Vitest (< 1.5 s required); a full A1 + A2 build 0.21 s.
- Browser (`npm run verify:browser:b1`, headless Chrome, Apple M3 Pro): the drawer opens by a real click; **draw calls 1,556
  and 9,007,734 triangles before and after opening it** (unchanged); filters (floor F02 + concrete = 362 rows, all
  match), sort, search ("STR-COL" = 210), card drill-down (lintels = 440 rows), row click → same id in the inspector's ID
  line, parent select, CSV export (362 data rows = filtered count, RFC 4180 parse OK) and a clean console. UI cross-checks:
  945 STR members, 210 columns 153.090 m3, 42 footings 100.800, 42 pedestals 13.608, 426 beams 353.047, 210 slab panels
  863.291. A1, A2 and A3 browser scripts still pass.
- Test change: `vitest.config.ts` now has `testTimeout: 30000`: A3's regeneration-determinism test takes ~6.5 s on this
  machine and failed the 5 s default at HEAD, before any B1 code.

**Known limitations.** Densities are typical values not verified against the standards; the table's "assumed" rows say
so. Wall face area is volume / thickness. Table sort on Quantity ignores units (filter by category first). The drawer
overlays the right 560 px of the 3D view. The first selection after load may wait for the idle-time inventory build
(~0.4 s). The Products and Estimated-mass cards do not drill down (assemblies are not table rows; there is no "has mass"
filter).

**First task for B2:** create `src/engine/passports/passport.ts`, a pure function
`buildPassports(inventory: Inventory): Map<string, MaterialPassport>` that, for every leaf row, joins the engine's
`ComponentQuantities` (primary quantity, mass and status, `sourceIds`) with its `materialId` and `MATERIAL_PROPS` entry
into one passport record (`componentId`, `materialId`, `quantity`, `massKg | null`, `confidence` mapped from status and
basis, `assumptions`, `issues`), with tests written first: one passport per leaf, passports for the 46,057 mass-less
leaves keep `massKg: null` (never 0), and Σ passport mass = the inventory's mass total. No UI and no recovery rules yet.

---

## A2 Results — Architectural Digital Twin
Layout: `ARCHITECTURE_LAYOUT.md` (plans in `docs/plans/`, generated from the model). IDs/data model:
`COMPONENT_DATA_MODEL.md` (A2 section). Decisions, assumptions, limitations: `DECISIONS_AND_ASSUMPTIONS.md`.
Screenshots: `docs/screenshots/a2/`.

**Layout.** 6 apartments per typical floor (3 south 2BHK 12 × 10.2 m; 3 north: 2BHK + study and a 3BHK corner unit
with band annexes) on an E–W corridor just south of gridline 3, which is where the A1 stair arrives. Ground floor:
entrance lobby (axial with the stair), security, meter room, staff toilet, society office instead of A2; living-room
sliders become windows; steps and canopy. Top floor: the stair continues to a roof-access enclosure; roof canopies cap
the balcony stacks.

**Structural change:** `stair.roofAccess` default → `true` (one flag; 939 → 945 members; documented and tested).

**Components (default config):** 51,494 records = 945 A1 members + 2,737 A2 assemblies + 47,812 A2 components.
| Prefix | Assemblies | Components | | Prefix | Assemblies | Components |
|---|---|---|---|---|---|---|
| ARC-WALL | 359 | 1,535 | | ARC-TILE | 79 | 24,457 |
| ARC-PART | 543 | 1,209 | | ARC-SKT | – | 2,198 |
| ARC-WIN | 171 | 3,032 | | ARC-CEIL | 365 | 3,891 |
| ARC-DOOR | 269 | 3,204 | | ARC-FIX | 394 | 1,293 |
| ARC-BAL | 30 | 1,908 | | ARC-KIT | 29 | 1,640 |
| ARC-FAC | 25 | 637 | | ARC-BATH | 79 | 1,247 |
| ARC-ROOF | 8 | 123 | | ARC-STAIRFIN | 15 | 485 |
| ARC-ENT | 1 | 6 | | ARC-FLR | 370 | 947 |
All 47,812 architecture components are instanced (244 InstancedMeshes); the 945 structural members keep one mesh each.
`npx vite-node scripts/plans/inventory.ts` prints this table.

**Verification actually run**
- `npm run typecheck` clean; `npm test` 213 tests / 11 files pass (≈3.3 s); `npm run build` passes (bundle warning
  only). No lint tool is configured (none added).
- Automated validations: IDs valid/unique/deterministic with the record's floor; parent/child integrity, children
  inside parent envelopes, child IDs extending the parent's; rooms tile the floor and each apartment envelope; door
  connectivity (rooms → entrance → corridor → stair; outside → lobby → stair at G); minimum clear dimensions incl.
  corridors at columns; door swings inside rooms, clear of columns and each other; openings fit walls, clear of
  columns/junctions, heads below ceilings; no wall gaps (5 cm sampling); zero positive-volume overlaps architecture vs
  structure and architecture vs architecture (allow-list empty; sloping members checked exactly); zero coplanar
  same-facing faces; quantities consistent with units/dimensions/geometry; stair finish arithmetic (all 24 finished
  risers = 0.15, bottom FFL, top next FFL); fixtures inside rooms and clear of door swings; WC/basin/shower 0.6 m zones
  free. Mutation tests confirm the plan validators, the overlap/coplanar checkers and the exact sloped check catch planted
  faults.
- Browser (headless Chrome, ANGLE Metal, Apple M3 Pro; `npm run verify:browser:a2`): 20 captures (exterior from two
  angles, four facades, entrance and canopy, balcony, roof, ground and typical plan views with ceilings hidden, two
  kitchens, two bathrooms, stair core, ceilings on, section through a window, assembly selection, layer off). Real mouse
  clicks resolved instanced components (wall pier, glazing pane, fin) to their IDs; the inspector's parent link selected
  the assembly; the layer checkbox hid its group and a click passed through; isolate + ceilings toggle + reset worked;
  every drawn component resolves to exactly one record (48,757 = 945 meshes + 47,812 instances; 0 unresolved, 0
  undrawn, 0 duplicates); console clean. The A1 structural browser check (`npm run verify:browser`, architecture hidden)
  still passes.
- `renderer.info`, 1600 × 1000, dpr 1: full exterior **1,191 draw calls, 657,134 triangles** per steady frame
  (2,370 / 1.31 M on the single shadow-refresh frame); isolated floor F01 197 calls / 111 k triangles. 34 geometries,
  3 textures (environment), 10–12 programs. Budgets (≤ ~1,500 calls, ≤ ~3 M triangles) met.

**Known limitations** (details in DECISIONS_AND_ASSUMPTIONS.md): interior column faces show the structural material;
doors modelled closed; fixtures are simple geometry with rule-based layouts; plain roof; no plumbing/electrical network
(connection points only); no lint configuration; no code splitting.

**First task for A3:** create `src/building/mep/plumbing.ts`, a pure generator that takes the A2 connection-point
records (`componentType === "connection_point"`, with `roomId`, position and water/drain role from the ID suffix) and
the A1 shaft opening, and emits conceptual `PLB-PIPE-{floor}-{apt}-{n}` supply and drain runs from every connection
point to the services shaft (axis-aligned segments in the floor/ceiling void and the shaft), with tests written first:
every connection point connected exactly once, runs reach the shaft on every storey, and `findOverlaps` reports no
clash with A1 or A2 records except a documented allow-list for wall penetrations.

---

## A1 Results — Parametric Structural Building (G+4)
Spec: `BUILDING_SPECIFICATION.md`. IDs/data model: `COMPONENT_DATA_MODEL.md`. Screenshots: `docs/screenshots/a1/`.

**Counts (default config):** 42 footings, 42 pedestals, 210 column segments, 426 beams (71 × 6 levels), 207 slab panels,
8 stair flights, 4 landings = **939 components**.

**Verification actually run**
- `npm run typecheck`, `npm test` (84 tests, 6 files), `npm run build` — all pass. No lint tool is configured in the repo
  and none was added (no new dependencies).
- Generator tests cover the counts, datum, column/beam/slab junctions, beam ends on joint faces, slab-area identity per
  bay, opening clearance, stair arithmetic/fit, ID uniqueness/determinism, and a generic overlap test across all 939
  members (empty allow-list; stacked/abutting members touch on faces only). Tests were mutation-checked: shrinking slab
  notches, lengthening beams 1 cm, and shifting the stair 0.1 m each made the intended tests fail.
- Browser (headless Chrome, real GPU WebGL2 on Apple M3 Pro, via `npm run verify:browser`): full, top, stair-core and
  section views plus junction close-ups; real mouse clicks on a column, footing, roof slab and roof beam resolved to the
  right IDs in the dev inspector; clicking empty space clears; all 939 meshes carry `userData.componentId` matching their
  record; console clean.
- `renderer.info` (full view, 1600×1000, dpr 1): **940 draw calls, 17,700 triangles** per steady frame; 1,879 calls /
  35,400 triangles on the single frame where the shadow map is refreshed. 19 geometries, 3 programs.

**Known limitations**
- Section/stair views are uncapped cuts (cut members show their hollow interior); back-face shadow noise is visible on
  cut beams.
- Stair landing has no explicit support member (conceptual; walls/supports come with A2). Stair headroom is not checked.
- `roofAccess` and `includePlinthBeams: false` / column-override variants are covered by unit and overlap tests but were
  not inspected visually.
- No roof-edge upstand beam (parapet belongs with A2). No lint configuration.
- The production bundle is ~1.1 MB (317 kB gzipped); no code splitting yet.

**First task for A2:** create `src/building/architecture/walls.ts`, a pure generator `config -> ComponentRecord[]` for
`ARC` perimeter wall panels (one per bay per floor, L0→ROOF, `assembly: "walls"` added to `ASSEMBLY_NAMES`, IDs
`ARC-WALL-{floor tag}-{X|Z}-{nodeA}-{nodeB}`), sized from the structural junction rule — clear width = span − joint size,
height = storey height − beam depth, thickness ≤ beam width — with no rendering yet. Write its tests first, reusing
`recordSolids()` for a generic overlap test of all walls against the 939 structural members, and leave the stair/shaft
core enclosure and door/window openings as the following step.

---

## A1 Plan (original, for reference — the column/beam junction rule was later revised, see BUILDING_SPECIFICATION.md)

### Generation sequence
1. **Grid**: Derive X and Z positions from config. Use as basis for all placement.
2. **Foundations**: One footing + pedestal at each grid intersection (7 × 6 = 42).
   Footing bottom at y = -1.5, top at y = -0.9. Pedestal top at y = 0.
3. **Columns**: Segments between each level. Column runs from top-of-slab-below
   (or pedestal top) to underside-of-beam-above (level elevation − beam depth).
   42 columns × 5 storeys = 210 segments.
4. **Beams**: X-direction beams along each grid row (6 spans × 6 rows = 36 per floor);
   Z-direction beams along each grid column (5 spans × 7 cols = 35 per floor).
   71 beams × 6 levels (L0 through ROOF) = 426 beams. Span between column faces.
5. **Slabs**: Per-bay rectangular panels between beam inner faces. 30 bays per level
   minus stair/shaft openings. Panels are simple boxes (no CSG).
6. **Stair flights & landings**: Dog-legged stair with mid-landing per storey.
   Two flights of 12 risers each. Landing at mid-height.

### ID assignment
Each generator yields `BuildingComponent` records with deterministic IDs from
`buildComponentId()`. Generators output both the component data and the geometry
parameters needed to render the mesh.

### Performance plan
- Shared `BoxGeometry` for standard member sizes (one geometry instance per unique
  dimension set).
- Shared `MeshStandardMaterial` per material type.
- Individual meshes (not InstancedMesh initially) to preserve per-component raycasting.
  If >2000 objects cause frame drops, wrap with instancing behind an adapter that
  preserves `userData.componentId` lookups.
- Frustum culling enabled by default.

### Validation plan
- Count assertions: 42 footings, 42 pedestals, 210 column segments, ~426 beams,
  ~140 slab panels, ~10 stair elements.
- Alignment: column centres match grid intersections; beam ends meet column faces.
- No z-fighting: verify member clearances at junctions.
- Registry size equals rendered mesh count.
