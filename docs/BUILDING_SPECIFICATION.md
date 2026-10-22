# ReLoop India — Building Specification (A1: structural frame)

Conceptual model for visualisation and planning. Member sizes are **not engineered** and
nothing here implies structural adequacy, safe reuse or code compliance.

Source of truth: `src/building/config.ts` (`DEFAULT_CONFIG`). Every coordinate, elevation and
node size used by the generators is derived from it; there are no literals in the generators.

## Coordinate system and datum
- Units: metres, 1 scene unit = 1 m, no scale factors. Y up.
- X = 36 m axis (East), Z = 30 m axis (North). Plan origin at building centre.
- Ground datum y = 0 is the top of the L0 slab (slab-on-grade).

## Grid
| Axis | Labels | Positions (m) | Lines | Spans |
|------|--------|---------------|-------|-------|
| X | A–G | -18, -12, -6, 0, 6, 12, 18 | 7 | 6 × 6.0 |
| Z | 1–6 | -15, -9, -3, 3, 9, 15 | 6 | 5 × 6.0 |

Derived: `positions[i] = -footprint/2 + i × spacing`. 42 grid nodes, 30 bays.

## Levels (top of slab)
| Level | Elevation (m) | Group | Notes |
|-------|--------------|-------|-------|
| FDN | -1.5 … 0 | `Floor_FDN` | footings + pedestals |
| L0 | 0.0 | `Floor_L0` | slab-on-grade, plinth/tie beams, ground-storey columns |
| L1 | 3.6 | `Floor_L1` | |
| L2 | 7.2 | `Floor_L2` | |
| L3 | 10.8 | `Floor_L3` | |
| L4 | 14.4 | `Floor_L4` | |
| ROOF | 18.0 | `Floor_ROOF` | roof slab + roof beams |

Storey *s* (0 = ground … 4) runs from level *s* to level *s+1*.

## Members (config defaults, editable)
| Member | Size | Placement |
|--------|------|-----------|
| Footing | 2.0 × 2.0 × 0.6 | bottom y = -1.5, top y = -0.9 |
| Pedestal | 0.6 × 0.6 | y ∈ [-0.9, 0] |
| Column | 0.45 × 0.45 (per-storey override: `columnOverrides`) | storey s: y ∈ [E_s, E_{s+1}] |
| Beam | 0.30 wide × 0.50 deep | y ∈ [E − 0.50, E], centred on gridline |
| Slab | 0.15 thick | y ∈ [E − 0.15, E] |
| Plinth beams | flag `includePlinthBeams` (default on) | beams at L0 → beams at L0..L4 + ROOF |

## Junction convention (single rule, used everywhere)
1. **Columns run level to level**: storey *s* spans y ∈ [E_s, E_{s+1}]. The top face of a column is
   flush with the top of the beams and slab of the level it reaches; the top storey continues to ROOF.
   The ground column starts at y = 0 where the pedestal ends.
2. **Beams butt against the joint member's faces**, never into it. At a level E the joint member is the
   column of the storey below; at L0 it is the **pedestal** (0.6 wide, so plinth beams end at pedestal
   faces). Clear length = span − joint size (5.55 m for 0.45 columns, 5.40 m at L0).
3. **Slab panels are inset to the beam inner faces** (0.15 m from the gridline) and sit inside the beam
   depth envelope. Where a column/pedestal is wider than the beam it protrudes into the panel corner, so
   each panel corner at a joint is **notched** (rectilinear polygon, extruded — no CSG).
4. Level-to-level contact is face contact only (zero volume overlap); the generic overlap test enforces it.

### Deviation from the original brief (deliberate)
The brief placed column segments at y ∈ [E_i, E_{i+1} − 0.50] (ending at the beam *underside*). With beams
ending at column faces that leaves a **0.45 × 0.45 × 0.50 m void at every joint on every level**
(42 nodes × 6 levels), visibly open at the roof. Columns therefore continue through the beam depth and end
flush with the beam/slab top. Consequences, all consistent and tested:
- Column tops/bottoms sit exactly on **level elevations** (not beam undersides).
- Beam ends meet column faces (pedestal faces at L0) — as specified.
- Slab panel corners are notched around joint members; the area identity still closes (see below).

## Slabs and openings
- One component per bay panel: `P{n}`, n = `bayZ × 6 + bayX + 1` (row-major, X fastest), `P01..P30`.
- A bay with an opening is split into the minimal set of rectangles around it: **W** (low-x), **E** (high-x),
  **S** (low-z strip), **N** (high-z strip); zero-size pieces are dropped. IDs `P16-W` etc.
- Openings are centred in their bay and validated to be inside the beam inner faces and clear of column corners.

| Opening | Bay | Size (X × Z) | Levels |
|---------|-----|--------------|--------|
| Stair well | x ∈ [0, 6], z ∈ [-3, 3] | 2.8 × 5.4 → x ∈ [1.6, 4.4], z ∈ [-2.7, 2.7] | L1..L4 (ROOF solid unless `stair.roofAccess`) |
| Service shaft | x ∈ [6, 12], z ∈ [-3, 3] | 1.5 × 1.5 → x ∈ [8.25, 9.75], z ∈ [-0.75, 0.75] | L1..ROOF |

L0 is slab-on-grade (no openings). Area identity per bay (tested, tol 1e-6):
`panels + opening + beam half-footprints + joint quarter-footprints = bay area (centreline to centreline)`.

## Stairs (dog-leg, one per storey L0→L1 … L3→L4)
- 24 risers × 0.15 = 3.6 m per storey; 12 per flight, 11 treads × 0.28 → run 3.08 m; flight width 1.2 m;
  flight gap 0.3 m → plan width 2.7 m inside the 2.8 m opening (0.05 m side clearance).
- Mid-landing: 2.7 × 1.2 m, top at E_s + 1.8. FL1 climbs +z on the low-x side from the arrival edge z = -2.7;
  FL2 climbs -z on the high-x side and its top step meets the next level exactly. Plan length 4.28 m of 5.4 m.
- Each flight is **one** extruded stepped profile (sawtooth top, sloping soffit `waistThickness` 0.20 below the
  nosing line, clipped at its base level). Each landing is one box. Config flag `stair.roofAccess` adds L4→ROOF.

## Component counts (default config)
| Type | Count |
|------|-------|
| Footings | 42 |
| Pedestals | 42 |
| Column segments | 210 (42 × 5 storeys) |
| Beams | 426 (71 × 6 levels: 216 X + 210 Z); 355 with plinth beams off |
| Slab panels | 207 (L0 30, L1–L4 36 each, ROOF 33) |
| Stair flights / landings | 8 / 4 |
| **Total** | **939** |
