/**
 * ReLoop India — MEP material library (A3).
 *
 * Same shape as the architectural library (substance for Part B, render params for the
 * viewer). Colours follow the A3 convention: cold water muted blue-grey, hot water muted
 * red, drainage and vent distinct neutral greys, electrical dark neutrals with a restrained
 * warm accent on lighting, metallic/neutral trays and enclosures. MEP records may also use
 * A2 materials where the substance is the same (rainwater uPVC, appliance bodies, lamps).
 */

import type { ArchMaterial, MaterialRender, Substance } from "../architecture/materials";

const m = (id: string, name: string, substance: Substance, render: MaterialRender): ArchMaterial =>
  Object.freeze({ id, name, substance, render: Object.freeze(render) });

export const MEP_MATERIALS: readonly ArchMaterial[] = Object.freeze([
  // Water supply
  m("cpvc_cold", "CPVC pipe SDR 11, cold water (blue-grey identification)", "cpvc", { color: 0x6c8594, roughness: 0.45, metalness: 0.05 }),
  m("cpvc_hot", "CPVC pipe SDR 11, hot water (red identification)", "cpvc", { color: 0x9a5c52, roughness: 0.45, metalness: 0.05 }),
  m("gi_pipe", "galvanised steel pipe, medium class (rising main / down-take)", "galvanised_steel", { color: 0x62798a, roughness: 0.42, metalness: 0.45 }),
  m("brass_valve", "forged brass valve / meter body", "brass", { color: 0x9c8559, roughness: 0.35, metalness: 0.75 }),
  m("hdpe_tank", "rotomoulded HDPE water tank (black)", "hdpe", { color: 0x2b2d2f, roughness: 0.62, metalness: 0 }),
  m("pump_body", "monoblock pump set, painted cast iron", "mechanical_assembly", { color: 0x4d6170, roughness: 0.5, metalness: 0.3 }),
  m("steel_stand", "MS structural stand, painted (tank platform)", "galvanised_steel", { color: 0x55595d, roughness: 0.55, metalness: 0.35 }),
  m("concrete_precast", "precast concrete chamber / sump", "concrete", { color: 0xa9a59c, roughness: 0.9, metalness: 0 }),
  m("cast_iron_cover", "cast iron manhole / chamber cover", "cast_iron", { color: 0x3d3f41, roughness: 0.7, metalness: 0.4 }),
  // Drainage
  m("upvc_swr", "uPVC SWR pipe, soil and waste (IS 13592)", "upvc", { color: 0x7a7e81, roughness: 0.55, metalness: 0 }),
  m("upvc_vent", "uPVC SWR pipe, vent (light grey)", "upvc", { color: 0xa9acae, roughness: 0.55, metalness: 0 }),
  m("upvc_drain", "uPVC underground drain pipe (dark grey)", "upvc", { color: 0x5e6163, roughness: 0.6, metalness: 0 }),
  // Electrical
  m("conduit_lighting", "rigid PVC conduit, lighting circuits (warm grey)", "rigid_pvc_conduit", { color: 0x6a5c4c, roughness: 0.55, metalness: 0 }),
  m("conduit_power", "rigid PVC conduit, power circuits (charcoal)", "rigid_pvc_conduit", { color: 0x3c4044, roughness: 0.55, metalness: 0 }),
  m("cable_lighting", "PVC insulated Cu cable 1.5 sq mm (lighting)", "copper_conductor", { color: 0x9a7444, roughness: 0.5, metalness: 0.1 }),
  m("cable_power", "PVC insulated Cu cable 2.5-4 sq mm (power)", "copper_conductor", { color: 0x2f3134, roughness: 0.5, metalness: 0.1 }),
  m("cable_armoured", "XLPE armoured Cu cable (submains / incoming)", "copper_conductor", { color: 0x232527, roughness: 0.6, metalness: 0.15 }),
  m("tray_gi", "perforated GI cable tray", "galvanised_steel", { color: 0xa8adb1, roughness: 0.38, metalness: 0.75 }),
  m("enclosure_steel", "powder-coated sheet-steel enclosure (light grey)", "electrical_assembly", { color: 0xd3d5d2, roughness: 0.48, metalness: 0.2 }),
  m("device_white", "modular wiring device / MCB (white polycarbonate)", "electrical_assembly", { color: 0xeeede8, roughness: 0.4, metalness: 0 }),
  m("earth_gi", "GI earthing strip / bar", "galvanised_steel", { color: 0x9aa0a4, roughness: 0.42, metalness: 0.7 }),
]);
