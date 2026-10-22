# ReLoop India — Decisions & Assumptions

## Key Decisions
1. **1BHK Retired**: The old prototype is not extended, copied, or rendered.
   New G+4 implementation built from scratch.
2. **No external BIM/IFC**: Geometry is procedurally generated from config parameters.
3. **Deterministic calculations only**: All quantities derive from geometry parameters
   via TypeScript arithmetic. No AI-generated numbers.
4. **Planning tool disclaimer**: The model is conceptual. No claims of structural
   adequacy, safe reuse, or regulatory compliance.

## Assumptions (all labelled "assumed" in component records)
- M30 concrete density: 2400 kg/m³
- Brick masonry density: 1800 kg/m³
- Steel density: 7850 kg/m³
- Member sizes are conceptual defaults for visualization, not engineered sections.
- Recovery routes are initial assumptions pending site inspection.
- Cost estimates (future) will use placeholder Indian market rates, clearly labelled.

## A1 Decisions (structural frame)
1. **Junction rule deviates from the brief** (documented in BUILDING_SPECIFICATION.md): columns run level-to-level and
   end flush with the beam/slab top instead of at the beam underside, because the literal rule leaves a 0.45×0.45×0.5 m void
   at every joint. Beams still end on column faces (pedestal faces at L0).
2. **Slab panels are notched rectilinear polygons**, not plain boxes: columns/pedestals are wider than beams, so a plain
   box inset to the beam faces would interpenetrate them. Built without CSG.
3. **Floor tags**: storey members use the tag of the level at their base (`G`, `F01`..`F04`), level members the level's
   own tag (`G`..`F04`, `RF`). The brief's "F01 = storey 1" examples differ; see COMPONENT_DATA_MODEL.md.
4. Column ID has no extra `C-` segment (`STR-COL-F01-B2`, as A0 defined), and the material is carried by A0's `materialId`.
5. A0's stub viewer was removed; `registry` gained `unlinkMesh`; config gained `columnOverrides`, `includePlinthBeams`,
   `stairOpening`, `shaftOpening` and stair layout fields (all with validation).

## Known Limitations
- Browser visual verification not performed in A0 (Playwright unavailable in env).
  Build + typecheck confirm code correctness; manual browser check recommended.
- Three.js bundle ~1.1 MB gzipped 311 KB — acceptable for desktop expo demo.
  Code-splitting can be added if needed.
- No lint tool is configured (none added in A1 to avoid new dependencies). A1 browser verification was done — see
  EXECUTION_ROADMAP.md (A1 Results); the A0 note above no longer applies.

## A2 Decisions (architecture)
1. **Structural change (the only one): `stair.roofAccess` default `false` → `true`.** A2 requires a roof-access
   enclosure and door; without a stair to the roof it would enclose nothing. A1 already parameterised and tested this
   variant (overlap test included), so the change is one config flag. Effect: +1 flight pair and landing
   (`STR-STAIR-F04-FL1/FL2/LND`) and the roof stair bay is split around the opening (`STR-SLAB-RF-P16` →
   `STR-SLAB-RF-P16-W/E/S/N`); 939 → 945 members. No other structural geometry or ID changed. Tests now assert both
   variants explicitly.
2. **Corridor position follows the A1 stair.** The stair arrives at the south edge of its well, so the common corridor
   runs E–W just south of gridline 3 (z −4.8…−3); see ARCHITECTURE_LAYOUT.md.
