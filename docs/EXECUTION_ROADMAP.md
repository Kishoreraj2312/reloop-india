# ReLoop India — Execution Roadmap

## Phase Sequence

### Part A — Digital Twin
| Phase | Goal | Status |
|-------|------|--------|
| A0 | Project foundation, config, types, registry, stub viewer | ✅ Done |
| A1 | Parametric structural building (foundations through roof) | 🔜 Next |
| A2 | Architecture & interiors (walls, doors, windows, rooms) | Planned |
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

## A1 Plan — Parametric Structural Building

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
