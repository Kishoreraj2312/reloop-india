/**
 * ReLoop India — MEP configuration (A3). Every MEP assumption lives here.
 *
 * CONCEPTUAL PLANNING MODEL: routes, sizes, slopes, device counts and quantities are
 * planning assumptions for a recovery-planning digital twin. Nothing here is a
 * construction-ready, load-calculated or code-certified MEP design.
 *
 * Heights are relative to the slab top of the storey (A2 datums: FFL = slab + 0.05,
 * ceiling underside = slab + 2.85, board top = slab + 2.8625, beam soffit = slab + 3.10,
 * slab soffit above = slab + 3.45). Two service zones follow from the A1/A2 geometry:
 *   zone A (2.87..3.10): below the beams, above the ceiling boards. Supply pipes, conduits
 *     and trays run here and cross gridline walls through sleeved penetrations.
 *   zone B (3.10..3.45): above the masonry (walls stop at the beam soffit), between beams.
 *     Sloped drainage from the floor above hangs here and stays within one structural bay.
 */

export const MEP_DISCLAIMER =
  "Conceptual MEP planning model (A3): not a construction-ready, load-calculated or code-certified design.";

export const MEP_CONFIG = {
  /** Gap kept between unrelated services and between services and structure. */
  clearance: 0.02,
  /** Zone A layer centrelines above the storey slab top. */
  layers: { lighting: 2.895, power: 2.93, cold: 2.975, hot: 3.035, submain: 3.072 },
  /** Cable tray bottom above the storey slab top (corridor, services room, shaft branches). */
  trayBottom: 3.01,
  /** Zone B for drains hanging below slab s: between the wall tops and the slab soffit. */
  drainZone: { aboveWallTop: 0.02, belowSoffit: 0.03 },
  /** Ground floor drains below the L0 slab (soil), and the underground building drain. */
  ground: { branchTop: -0.2, branchBottom: -0.46, drainTop: -0.56, drainFloor: -0.86 },
  /** Concealed pipes/conduits run in wall chases this far behind the plaster face (centreline). */
  chase: 0.035,
  /** Void connection point in front of a wall chase (into the room). */
  voidStub: 0.1,

  // ── Plumbing ───────────────────────────────────────────────────────────────
  pipe: {
    // CPVC SDR 11 (outer diameters, m)
    cpvc15: { od: 0.0159, nominal: "1/2 in (15 mm) CPVC" },
    cpvc20: { od: 0.0222, nominal: "3/4 in (20 mm) CPVC" },
    cpvc25: { od: 0.0286, nominal: "1 in (25 mm) CPVC" },
    // GI medium class
    gi25: { od: 0.0337, nominal: "DN25 GI" },
    gi40: { od: 0.0483, nominal: "DN40 GI" },
    gi50: { od: 0.0603, nominal: "DN50 GI" },
    gi65: { od: 0.0761, nominal: "DN65 GI" },
    // uPVC SWR and underground drainage
    waste50: { od: 0.05, nominal: "50 mm uPVC waste" },
    swr75: { od: 0.075, nominal: "75 mm uPVC SWR" },
    swr110: { od: 0.11, nominal: "110 mm uPVC SWR" },
    drain160: { od: 0.16, nominal: "160 mm uPVC underground drain" },
    rain110: { od: 0.11, nominal: "110 mm uPVC rainwater" },
  },
  /** Falls (1 in n). */
  slope: { soil: 1 / 60, waste: 1 / 40, underground: 1 / 100 },
  /** Stack: soil + waste single stack (vented through the roof), standing off its walls. */
  stack: { ventAboveRoof: 1.2, standoff: 0.01, candidateStep: 0.05 },
  /** Fixture tails: wall waste outlets on gridline walls step out this far before the floor. */
  tail: { floorStep: 0.075, chaseBottom: 0.12 },
  water: {
    /** Overhead tanks (two rotomoulded tanks on a steel platform over the services bay). */
    tankCapacityL: 5000,
    tankCount: 2,
    platform: { height: 0.6, thickness: 0.1 },
    /** Planning demand used only to label the storage (135 lpcd x 4 persons x 29 flats, 1/2 day overhead). */
    demand: { lpcd: 135, persons: 4 },
    sump: { x0: 20.0, x1: 24.0, z0: -1.6, z1: 1.6, depth: 2.4, top: -0.4, capacityL: 25000 },
    pumpPad: { x0: 18.9, x1: 19.75, z0: -1.1, z1: 1.1, height: 0.12 },
    meterInCorridor: true,
  },
  geyser: { capacityL: 25, centreAboveFFL: 2.2, rooms: ["bathroom"] as readonly string[] },

  // ── Electrical ─────────────────────────────────────────────────────────────
  conduit: {
    lighting: { od: 0.02, nominal: "20 mm PVC conduit" },
    power: { od: 0.025, nominal: "25 mm PVC conduit" },
    submain: { od: 0.032, nominal: "32 mm PVC conduit" },
  },
  cable: {
    lighting: { od: 0.008, nominal: "3 x 1.5 sq mm Cu FR PVC" },
    power: { od: 0.01, nominal: "3 x 2.5 sq mm Cu FR PVC" },
    heavy: { od: 0.012, nominal: "3 x 4 sq mm Cu FR PVC" },
    submain: { od: 0.019, nominal: "2C x 10 sq mm Cu XLPE armoured + 6 sq mm PE" },
    feeder: { od: 0.026, nominal: "4C x 16 sq mm Cu XLPE armoured" },
    incoming: { od: 0.055, nominal: "3.5C x 185 sq mm Al XLPE armoured (utility LT service)" },
  },
  /** Device centre heights above FFL. */
  device: { switch: 1.2, socketLow: 0.3, counter: 1.12, washer: 1.25, fridge: 1.0, ac: 2.25, hood: 2.3, db: 1.8, fdb: 1.75 },
  earth: { strip: { width: 0.025, thickness: 0.003, nominal: "25 x 3 mm GI strip" }, pits: 2 },
} as const;

export type MepConfig = typeof MEP_CONFIG;
