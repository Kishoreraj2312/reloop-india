# ReLoop India — Execution Roadmap

## Phase Sequence

### Part A — Digital Twin
| Phase | Goal | Status |
|-------|------|--------|
| A0 | Project foundation, config, types, registry, stub viewer | ✅ Done |
| A1 | Parametric structural building (foundations through roof) | ✅ Done |
| A2 | Architecture & interiors (walls, doors, windows, rooms) | 🔜 Next |
| A3 | Plumbing & electrical systems | Planned |
| A4 | Interactions & cinematic exploded assembly | Planned |
| A5 | Visual refinement & performance optimization | Planned |

### Part B — Engineering & Circularity
| Phase | Goal |
|-------|------|
| B1 | Quantity engine & material inventory from geometry |
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
