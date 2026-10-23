/**
 * Densities for the mass estimate (B1), keyed by materialId. Every material id used by the
 * A1 / A2 / A3 generators has an entry (a test enforces it).
 *
 * `reference`: a published unit weight (IS 875 (Part 1) family / common engineering values) or
 *   the value the repository already uses for that material.
 * `assumed`: a typical handbook / manufacturer value chosen here, with the reasoning in `note`.
 * `null`: no mass is computed. Used for hollow, assembled or mixed products that the model draws
 *   as a SOLID box or cylinder (sanitaryware, cabinets, appliances, hollow metal sections,
 *   pipes, light fittings, flush doors): "solid box is not the product volume".
 *
 * These are order-of-magnitude values for an exhibition-grade estimate. They are not verified
 * against the standard texts in this repository (none is bundled); check before any design use.
 */

export type DensityBasis = "reference" | "assumed";

export interface MaterialProps {
  readonly densityKgM3: number | null;
  readonly basis: DensityBasis;
  readonly source: string;
  readonly note?: string;
}

const SOLID_BOX = "solid box is not the product volume";

const d = (densityKgM3: number, basis: DensityBasis, source: string, note?: string): MaterialProps => (note === undefined ? { densityKgM3, basis, source } : { densityKgM3, basis, source, note });
const none = (source: string, note: string): MaterialProps => ({ densityKgM3: null, basis: "assumed", source, note });

const RCC = "A1 STRUCTURAL_MATERIAL 2400 kg/m3 (plain concrete ≈ 24 kN/m3, IS 875 (Part 1))";
const CONC_NOTE = "reinforcement not included; plaster/paint layer not included";
const BRICK = "DECISIONS_AND_ASSUMPTIONS.md (A0): brick masonry 1800 kg/m3; IS 875 (Part 1) brickwork ≈ 1800–1920";
const GRANITE = "granite 2600–2800 kg/m3 (typical; IS 875 (Part 1) stone table)";
const MORTAR = "cement mortar 1900–2100 kg/m3 (typical; IS 875 (Part 1))";
const CERAMIC = "ceramic tile body 2000–2400 kg/m3 (manufacturer range)";

export const MATERIAL_PROPS: Readonly<Record<string, MaterialProps>> = Object.freeze({
  // A1
  rcc_conceptual: d(2400, "reference", RCC, CONC_NOTE),
  // A2 concrete and masonry
  concrete_balcony: d(2400, "assumed", "same convention as rcc_conceptual", CONC_NOTE),
  concrete_band: d(2400, "assumed", "same convention as rcc_conceptual", "GRC/textured finish treated as concrete"),
  concrete_fin: d(2400, "assumed", "same convention as rcc_conceptual", "precast fin; GRC finish treated as concrete"),
  lintel_rcc_ext: d(2400, "assumed", "same convention as rcc_conceptual", CONC_NOTE),
  lintel_rcc_int: d(2400, "assumed", "same convention as rcc_conceptual", CONC_NOTE),
  masonry_paint_ext: d(1800, "reference", BRICK, "plaster and paint not counted separately"),
  masonry_paint_int: d(1800, "reference", BRICK, "plaster and paint not counted separately"),
  masonry_paint_core: d(1800, "reference", BRICK, "plaster and paint not counted separately"),
  // Screed, plaster, stone, tiles
  cement_screed: d(2000, "assumed", MORTAR),
  plaster_soffit: d(2000, "assumed", MORTAR, "soffit plaster modelled as a thin board"),
  stone_cladding: d(2300, "assumed", "sandstone 2200–2500 kg/m3 (typical)"),
  stone_coping: d(2700, "assumed", GRANITE),
  stone_tread: d(2700, "assumed", GRANITE),
  countertop_granite: d(2700, "assumed", GRANITE),
  tile_porcelain_floor: d(2400, "assumed", "vitrified/porcelain tile body ≈ 2300–2500 kg/m3 (manufacturer range)"),
  tile_antiskid: d(2200, "assumed", CERAMIC),
  tile_wall_ceramic: d(2200, "assumed", CERAMIC),
  tile_backsplash: d(2200, "assumed", CERAMIC),
  tile_balcony: d(2000, "assumed", CERAMIC, "terracotta / stoneware tile, lower end of the range"),
  roof_finish: none("composite", "waterproofing + screed + tile layers are modelled as one board; no single density"),
  // Boards, timber, metals, glass
  ceiling_gypsum: d(750, "assumed", "12.5 mm gypsum board ≈ 9–10 kg/m2 (manufacturer range)"),
  timber_frame: d(700, "assumed", "teak / hardwood 630–720 kg/m3 (IS 875 (Part 1) timber table range)", "solid hardwood section"),
  timber_door_teak: none("composite", `flush door leaf: ${SOLID_BOX} (real leaf has a core)`),
  timber_door_light: none("composite", `flush door leaf: ${SOLID_BOX} (real leaf has a core)`),
  laminate_door_wet: none("composite", `WPC/laminate door leaf: ${SOLID_BOX}`),
  cabinet_laminate: none("composite", `kitchen carcass/shutters: ${SOLID_BOX}`),
  cabinet_front_light: none("composite", `kitchen shutters: ${SOLID_BOX}`),
  metal_frame: none("aluminium extrusion", `hollow extruded sections drawn as solid boxes: ${SOLID_BOX}`),
  metal_railing: none("mild steel", `railing section (solid bar vs hollow tube) not specified: ${SOLID_BOX}`),
  metal_hardware: none("stainless", `hardware drawn as solid boxes: ${SOLID_BOX}`),
  metal_panel: d(2700, "assumed", "aluminium 2700 kg/m3", "anodised plate drawn at its real thickness"),
  stainless_steel: none("stainless", `sinks, hoods, faucets drawn as solid boxes/cylinders: ${SOLID_BOX}`),
  pvc_pipe: none("PVC", `pipes drawn as solid cylinders; wall thickness not modelled: ${SOLID_BOX}`),
  glass_clear: d(2500, "assumed", "soda-lime float glass ≈ 2500 kg/m3"),
  glass_mirror: d(2500, "assumed", "soda-lime float glass ≈ 2500 kg/m3"),
  // Sanitary, appliances, fixtures
  sanitary_ceramic: none("vitreous china", `sanitaryware drawn as solid boxes: ${SOLID_BOX}`),
  appliance_white: none("assembled product", `appliances drawn as solid boxes: ${SOLID_BOX}`),
  appliance_black: none("assembled product", `appliances drawn as solid boxes: ${SOLID_BOX}`),
  fixture_light: none("assembled product", `light fittings: ${SOLID_BOX}`),
  // A3 MEP (catalogue parts, route cylinders: pipe/cable wall and conductor sections are not modelled)
  cpvc_cold: none("CPVC", `pipe drawn as a solid cylinder, wall thickness not modelled: ${SOLID_BOX}`),
  cpvc_hot: none("CPVC", `pipe drawn as a solid cylinder, wall thickness not modelled: ${SOLID_BOX}`),
  gi_pipe: none("galvanised steel", `pipe drawn as a solid cylinder, wall thickness not modelled: ${SOLID_BOX}`),
  upvc_swr: none("uPVC", `pipe drawn as a solid cylinder, wall thickness not modelled: ${SOLID_BOX}`),
  upvc_drain: none("uPVC", `pipe drawn as a solid cylinder, wall thickness not modelled: ${SOLID_BOX}`),
  upvc_vent: none("uPVC", `pipe drawn as a solid cylinder, wall thickness not modelled: ${SOLID_BOX}`),
  brass_valve: none("brass", `valve/meter body: ${SOLID_BOX}`),
  cast_iron_cover: none("cast iron", `catalogue part: ${SOLID_BOX}`),
  hdpe_tank: none("HDPE", `tank is hollow: ${SOLID_BOX}`),
  pump_body: none("assembled product", `pump set: ${SOLID_BOX}`),
  concrete_precast: d(2400, "assumed", "same convention as rcc_conceptual", "solid precast elements only (hollow chambers/tanks are excluded by type)"),
  steel_stand: none("mild steel", `frame drawn as a solid box: ${SOLID_BOX}`),
  enclosure_steel: none("sheet steel", `enclosure is hollow: ${SOLID_BOX}`),
  device_white: none("assembled product", `wiring device: ${SOLID_BOX}`),
  conduit_lighting: none("rigid PVC", `conduit drawn as a solid cylinder: ${SOLID_BOX}`),
  conduit_power: none("rigid PVC", `conduit drawn as a solid cylinder: ${SOLID_BOX}`),
  cable_lighting: none("copper/PVC", "cable drawn as a solid cylinder; conductor area not modelled"),
  cable_power: none("copper/PVC", "cable drawn as a solid cylinder; conductor area not modelled"),
  cable_armoured: none("copper/XLPE/steel", "cable drawn as a solid cylinder; conductor area not modelled"),
  tray_gi: none("galvanised steel", "tray drawn as an envelope; sheet thickness not modelled"),
  earth_gi: none("galvanised steel", `earthing conductor: ${SOLID_BOX}`),
});

/** Component types whose material has a density but whose shape is hollow: no mass. */
export const HOLLOW_TYPES: Readonly<Record<string, string>> = Object.freeze({
  sump_tank: `water tank is hollow: ${SOLID_BOX}`,
  earth_pit: `pit is hollow: ${SOLID_BOX}`,
  inspection_chamber: `chamber is hollow: ${SOLID_BOX}`,
  manhole: `manhole is hollow: ${SOLID_BOX}`,
  recharge_pit: `pit is hollow: ${SOLID_BOX}`,
});

export function materialProps(materialId: string): MaterialProps | undefined {
  return MATERIAL_PROPS[materialId];
}

export interface DensityLookup {
  readonly densityKgM3: number | null;
  readonly props: MaterialProps | undefined;
  /** Why the density is null (empty when it is not). */
  readonly reason: string;
}

export function densityFor(componentType: string, geometryKind: string, materialId: string): DensityLookup {
  const props = MATERIAL_PROPS[materialId];
  if (!props) return { densityKgM3: null, props, reason: `material "${materialId}" has no density entry` };
  const hollow = HOLLOW_TYPES[componentType];
  if (hollow) return { densityKgM3: null, props, reason: hollow };
  if (geometryKind === "part") return { densityKgM3: null, props, reason: `catalogue part: envelope × fill is a drawing aid, ${SOLID_BOX}` };
  if (props.densityKgM3 === null) return { densityKgM3: null, props, reason: props.note ?? SOLID_BOX };
  return { densityKgM3: props.densityKgM3, props, reason: "" };
}
