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
3. **Stairwell lining walls.** The A1 stair stands in a 2.8 × 5.4 m opening with 1.4 m floor strips beside it, so the
   flights' outer edges faced a drop. Instead of guarding dead strips, A2 encloses the well with 0.115 walls standing on
   the slab just outside the opening (W/E/N); the opening itself stays clear. Guards remain only where needed (inner
   flight balustrades, landing north edge).
4. **En-suite deepened (stage 4).** The fixture validators showed shower + WC + basin with 0.6 m clear zones do not fit
   a 1.93 × 1.69 m en-suite. It became 2.1 × 2.25 (boundary); the master bedroom keeps 3.43 × 3.69 m clear plus a small
   door lobby (an L-shaped room of two rectangles).
5. **Walls stop at the beam soffit everywhere (clear height 3.1 m)**, including partitions not under a beam; the 0.35 m
   above off-grid partitions is inside the ceiling void (head detail not modelled). This keeps every wall clear of every
   beam without per-crossing cut-outs.
6. **Junction ownership instead of CSG.** Walls are extended to the far face of the walls they meet; for each overlapping
   pair exactly one keeps the overlap (a wall passing through beats one ending there unless the ending wall has a higher
   rank: exterior > core/party > partition), and columns are subtracted from all. Openings split the host piece into
   piers, reveals, sill panel, lintel and above-lintel infill.
7. **Frame grid on the facade.** Floor bands (beam zone) and thin column cladding project 50 mm and form a frame; fins
   flank the balcony stacks; casement windows get sunshades (chajjas) on the lintel band; sliders and ventilators do not.
8. **Ceiling light fittings ride with the ceilings layer** (they are ceiling-mounted), so cutaway plans show no floating
   lights. The fixtures layer covers kitchens, bathrooms and appliances.
9. **Instanced rendering for all architecture.** One InstancedMesh per floor × category × material × unit shape, with
   an instanceId → componentId map, keeps the full model within the draw-call budget (1,191 calls in the full exterior
   view, of which 945 are A1 member meshes). Nothing is merged: each instance is a component.
10. **Overlap allow-list: empty.** Sloping stair members (A1 flight prisms, rotated handrails and strings) are checked
   exactly (x-extrusions of polygons, clipped area × x-overlap) instead of being allow-listed; everything else is boxes.
11. **Site ground plane** at finished grade (−0.45) is presentation only (not a component); it hides when the foundation
   floor is isolated.

## A2 Assumptions (planning values; all records `confidence: "assumed"`)
- FFL = slab top + 0.05 (0.04 screed + 0.01 tile); ceiling FFL + 2.8; site grade −0.45; 3 entrance risers of 0.167.
- Walls: exterior 0.23 (outer face flush with column outer face), party/corridor/core/shaft 0.23, partitions 0.115.
- Openings: door heads FFL + 2.1 (entrance 2.4), window sill 0.9 / head 2.1, ventilators sill 1.65, lintel 0.15,
  reveal depth 0.115, fit tolerance 5 mm, minimum pier 50 mm.
- Clear room minimums: bedroom 2.8 m, kitchen 2.0 m, bathroom 1.2 × 1.8 m, corridor/passage 1.2 m; fixture clearances
  0.6 m in front of WC, basin, shower entry; door approach 0.75 m (kitchens) / 0.6 m (wet rooms).
- Balconies: 1.5 m projection beyond the wall face, cantilever conceptual (no back-span or reinforcement modelled),
  finish 15 mm below room FFL, railing 1.05 m.
- Internal kitchens and baths are assumed mechanically ventilated to the shaft; no ducts or plumbing are modelled
  (connection points are visual stubs only). No code compliance, fire/egress, structural adequacy or MEP coordination
  is claimed.

## A2 Known Limitations
- Interior column faces show the A1 structural material (not plastered); skirting and wall tiles return around
  protruding columns but column faces are not otherwise finished.
- Doors are modelled closed; swings are data (validated, drawn in the plan SVGs) rather than animated.
- Fixtures are simple box/cylinder geometry; kitchen/bath layouts are rule-based per room, not individually designed.
- The roof is plain (finish, parapet, enclosure, shaft upstand, drains); no water tank or solar equipment.
- No lint tool is configured (none added; no new dependencies). `npm run typecheck` (strict TS with unused checks) is
  the static gate.
- `npm run build` warns that the bundle exceeds 500 kB (three.js); no code splitting yet.
