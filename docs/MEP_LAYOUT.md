# ReLoop India — MEP Layout (A3)

**Conceptual planning model.** Routes, sizes, falls, device counts and quantities are planning
assumptions for a recovery-planning digital twin. Nothing here is a construction-ready,
load-calculated or code-certified MEP design. Passing the automated checks establishes geometric
validity and logical connectivity only, not engineering adequacy.

Source of truth: `src/building/mep/` (all assumptions in `config.ts`). Geometry and records come
from one generator run (`getMep(cfg)`), so quantities always match what is drawn.

## Service zones (from the A1/A2 geometry)

Heights above each storey's slab top: ceiling board top 2.8625, beam soffit 3.10, slab soffit 3.45.

| Zone | Height | Use |
|---|---|---|
| A (below beams) | 2.87 to 3.10 | lighting conduit 2.885, power conduit 2.923, cold water 2.962, hot water 3.035, submain conduit 3.058, cable tray 2.99 to 3.065 |
| B (above masonry, between beams) | 3.13 to 3.42 | sloped drainage from the floor above; stays within one structural bay, never crosses a beam |
| Ground | below the L0 slab | ground-floor branches (-0.17 to -0.46), stack bases (-0.78), building drains 1:100, incoming/pump cables, earth strips |

Concealed drops run in wall chases 35 mm behind the plaster face. Walls, finishes and ceilings are
penetrated by sleeves; beams, columns and foundations never are.

## Plumbing (8,684 records)

- **Water supply.** Municipal connection, bulk meter, 25 kL sump (east of the building), two
  monoblock pumps (foot valves, NRVs, gate valves, starter panel), DN50 rising main underground to
  the service shaft and up it, two 5,000 L HDPE tanks on a steel platform over the services bay,
  DN65 down-take, a floor isolation valve per storey, DN32 corridor header, a gate valve and water
  meter per flat (29) and one for the ground-floor common block, then a CPVC tree in each flat's
  ceiling void to every A2 supply connection point (angle valves at WCs, basins, sinks, washers).
- **Hot water.** A 25 L geyser in every bathroom with a shower (63 networks), feeding the mixer's
  hot inlet; a concealed riser from each mixer to its shower arm.
- **Drainage.** Single-stack soil and waste: 16 stacks (110 mm), each placed in a wet-room corner
  that is free on all storeys, with cleanouts, stack vent and cowl 1.2 m above the roof. Branch
  trees under each slab at 1:60 (110 mm) and 1:40 (50 to 75 mm), floor traps, bottle traps under
  basins and sinks. Ground-floor drains join below the slab. Building drains 160 mm at 1:100 to
  inspection chambers outside the long facades, sewer lines to two final manholes, capped
  connections to the municipal sewer.
- **Rainwater.** The four A2 roof drains discharge through the parapet into the side of the A2
  downpipes (saddle branch: the gable band leaves no room for a junction fitting; the A2 rainwater
  heads sit above the roof finish and act as overflows); shoes at the downpipe feet lead to four
  recharge pits. A2 downpipes are referenced, not duplicated.

All 786 A2 plumbing endpoints are connected; no plumbing item is unresolved.

## Electrical (27,202 records)

- **Supply.** Feeder pillar south of the building, underground incoming cable to the main LT
  panel (MDB) in the ground-floor meter room, meter bank with 30 energy meters.
- **Distribution.** Perforated GI cable tray: meter room, ground corridor, services room, a
  vertical riser in the service shaft, and a corridor tray on every floor. 29 flat submains and
  5 common feeders are laid in lanes on the trays and leave them in conduit for the flat DBs
  (foyer, by the entrance) and the common DBs (services room, one per floor). Pump feeder
  underground to the starter panel.
- **Final circuits (302).** Per flat: L1/L2 lighting, P1 sockets, P2 kitchen/utility, one circuit
  per AC point and per geyser point, each with its MCB behind an isolator and RCCB. Conduit trees
  in the ceiling void with round junction boxes, drops through the ceiling to every A2 light
  fitting, wall chases to switch boards (latch side of each door; outside wet-room doors),
  sockets, AC, kitchen, washer and geyser points. Common: corridor lighting, services room,
  staircase bulkheads (one per storey, new: A2 has no stair lights), ground-floor common rooms,
  entrance canopy and facade lights.
- **Earthing.** Two earth pits, main earthing terminal in the meter room, riser earth strip in
  the shaft, floor earth bars. DBs are earthed through the submain protective conductor (not
  drawn separately).

## Unresolved (reported, not invented)

16 devices could not be wired through the ceiling void and are left out of the model (listed
in `getMep(cfg).unresolved`): an AC/socket point in A1 bedroom 2 and A6 bedroom 1 on every
storey, a switch board in A4 bedroom 3 on every storey, and one ground-floor common socket.

Not modelled: roof-access enclosure light (the gridline beam blocks a concealed route), duct
ventilation for internal wet rooms, lightning protection, load/voltage-drop calculations,
balcony spouts (A2 free discharge).

## Checks

- `src/building/mep/plumbing.test.ts`, `electrical.test.ts`: unique deterministic IDs, hierarchy,
  quantities equal to the drawn geometry, symmetric connectivity, one connected graph per network
  and circuit, every A2 endpoint served, drainage falls as drawn, no run through beams, columns or
  foundations, no clash outside the documented allow-list (`validate.ts`).
- `npm run verify:browser:a3`: MEP groups, system and category toggles, lights kept with hidden
  ceilings, X-ray, network trace, reset (real clicks in headless Chrome).
