# ReLoop India — Component Data Model

## ID Convention
Format: `SYSTEM-TYPE-FLOOR-LOCATION`

| Segment  | Values                          | Examples       |
|----------|---------------------------------|----------------|
| SYSTEM   | STR, ARC, PLB, ELC              | STR            |
| TYPE     | FTG, PED, COL, BM, SLAB, STAIR, LAND, WALL, DOOR, WIN, PIPE, COND, DB... | COL |
| FLOOR    | G, F01–F04, RF                  | F01            |
| LOCATION | Grid intersection(s) or index   | A1, X-A1-B1, P03 |

Examples:
- `STR-FTG-G-A1` — Foundation at grid A-1
- `STR-COL-F01-A1` — Column on floor 1 at A-1
- `STR-BM-F02-X-A1-B1` — X-beam floor 2 from A1 to B1
- `STR-SLAB-F03-P03` — Slab panel 3 on floor 3
- `ARC-WALL-G-A1-B1` — Wall on ground floor between A1 and B1

IDs are deterministic and human-readable. The `buildComponentId()` / `parseComponentId()`
functions enforce the format and enable round-trip parsing.

## BuildingComponent Interface
See `src/building/types.ts`. Key fields:
- `id`, `name`, `system`, `componentType`, `floor`, `materialId`
- `dimensions` (length/width/height/diameter/thickness)
- `quantity`, `unit`, `condition`, `recoveryRoute`, `confidence`
- `dependencies[]`, `parentId`
- `originalPosition`, `originalRotation` — immutable baseline transforms

## Scenario State
Scenario overlays (`ScenarioOverlay`) are separate Maps keyed by component ID.
They hold `removed`, `removalPhase`, and `notes` without mutating baseline records.
