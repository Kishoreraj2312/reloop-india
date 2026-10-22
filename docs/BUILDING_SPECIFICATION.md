# ReLoop India — Building Specification

## Coordinate System
- Units: metres (1 scene unit = 1 m)
- Y-up, X = 36 m axis (East), Z = 30 m axis (North)
- Plan origin at building centre
- Ground datum y = 0 is top of L0 slab

## Grid
| Axis | Labels | Positions (m)            | Count | Spacing |
|------|--------|--------------------------|-------|---------|
| X    | A–G    | -18, -12, -6, 0, 6, 12, 18 | 7   | 6.0     |
| Z    | 1–6    | -15, -9, -3, 3, 9, 15      | 6   | 6.0     |

Derived: `positions[i] = -footprint/2 + i × spacing`

## Levels
| Level | Elevation (m) | Description       |
|-------|--------------|-------------------|
| FDN   | -1.5 to 0    | Foundation zone   |
| L0    | 0.0          | Ground floor slab |
| L1    | 3.6          | First floor       |
| L2    | 7.2          | Second floor      |
| L3    | 10.8         | Third floor       |
| L4    | 14.4         | Fourth floor      |
| ROOF  | 18.0         | Roof slab         |

Derived: `elevation[i] = i × storeyHeight (3.6 m)`

## Structural Members (conceptual defaults)
| Member   | Width | Depth | Height/Thickness | Notes              |
|----------|-------|-------|------------------|--------------------|
| Footing  | 2.0   | 2.0   | 0.6              | Isolated pad       |
| Pedestal | 0.6   | 0.6   | 0.9              | Above footing      |
| Column   | 0.45  | 0.45  | storey-dependent | Between slab levels|
| Beam     | 0.30  | 0.50  | —                | Top at slab level  |
| Slab     | —     | —     | 0.15             | Per-bay panels     |

## Junction Convention
- Beams: top face at slab elevation E; bottom at E − beam.depth
- Columns: top at E − beam.depth; bottom at level below E
- Slabs: inset to beam inner faces

## Cores
- Stair well: X ∈ [0, 6], Z ∈ [-3, 3] (bay D-E / 3-4)
- Service shaft: X ∈ [6, 12], Z ∈ [-3, 3] (bay E-F / 3-4)
- Stair: 24 risers × 0.15 m = 3.6 m per storey; tread 0.28 m; width 1.2 m
