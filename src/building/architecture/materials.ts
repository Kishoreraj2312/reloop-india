/**
 * ReLoop India — architectural material library (A2).
 *
 * Keyed by materialId. `substance` is the physical material class that Part B will attach
 * density, embodied carbon and cost to; `render` is appearance only (PBR parameters). Two
 * entries may share a substance and differ in finish (e.g. masonry with exterior vs
 * interior paint). Plaster and paint are properties of the wall material, not geometry.
 */

export type Substance =
  | "brick_masonry"
  | "concrete"
  | "cement_screed"
  | "stone"
  | "ceramic_tile"
  | "porcelain_tile"
  | "timber"
  | "laminate_board"
  | "aluminium"
  | "mild_steel"
  | "stainless_steel"
  | "glass"
  | "gypsum_board"
  | "sanitary_ceramic"
  | "pvc"
  | "bitumen_membrane"
  | "appliance_mixed"
  // A3 (MEP library, mep/materials.ts)
  | "cpvc"
  | "upvc"
  | "galvanised_steel"
  | "hdpe"
  | "brass"
  | "cast_iron"
  | "copper_conductor"
  | "rigid_pvc_conduit"
  | "electrical_assembly"
  | "mechanical_assembly";

export interface MaterialRender {
  readonly color: number;
  readonly roughness: number;
  readonly metalness: number;
  /** < 1 renders transparent (glass only; no transmission materials). */
  readonly opacity?: number;
  readonly envMapIntensity?: number;
}

export interface ArchMaterial {
  readonly id: string;
  readonly name: string;
  readonly substance: Substance;
  readonly render: MaterialRender;
}

const m = (id: string, name: string, substance: Substance, render: MaterialRender): ArchMaterial =>
  Object.freeze({ id, name, substance, render: Object.freeze(render) });

export const ARCH_MATERIALS: readonly ArchMaterial[] = Object.freeze([
  // Masonry and plaster/paint finishes
  m("masonry_paint_ext", "brick masonry, plastered, exterior paint (warm white)", "brick_masonry", { color: 0xe9e2d6, roughness: 0.92, metalness: 0 }),
  m("masonry_paint_int", "brick masonry, plastered, interior paint (white)", "brick_masonry", { color: 0xf1efea, roughness: 0.95, metalness: 0 }),
  m("masonry_paint_core", "brick masonry, plastered, core paint (light grey)", "brick_masonry", { color: 0xd9dad6, roughness: 0.94, metalness: 0 }),
  m("lintel_rcc_ext", "RCC lintel, plastered, exterior paint", "concrete", { color: 0xe4ddd1, roughness: 0.92, metalness: 0 }),
  m("lintel_rcc_int", "RCC lintel, plastered, interior paint", "concrete", { color: 0xecebe6, roughness: 0.95, metalness: 0 }),
  m("concrete_fin", "precast concrete fin (GRC finish)", "concrete", { color: 0x7e776e, roughness: 0.85, metalness: 0 }),
  m("concrete_band", "floor band / column cladding, textured paint", "concrete", { color: 0xc8bca9, roughness: 0.9, metalness: 0 }),
  m("concrete_balcony", "RCC balcony / canopy slab, plastered", "concrete", { color: 0xdcd5c9, roughness: 0.9, metalness: 0 }),
  m("plaster_soffit", "soffit plaster, exterior paint", "cement_screed", { color: 0xeeeae2, roughness: 0.95, metalness: 0 }),
  // Stone and tiles
  m("stone_cladding", "stone-effect cladding (sandstone tone)", "stone", { color: 0x9a8f80, roughness: 0.82, metalness: 0 }),
  m("stone_coping", "stone coping / window sill (granite)", "stone", { color: 0x6f6b66, roughness: 0.55, metalness: 0 }),
  m("stone_tread", "stair tread / threshold (polished granite)", "stone", { color: 0x7b746c, roughness: 0.4, metalness: 0 }),
  m("cement_screed", "cement sand screed / bedding", "cement_screed", { color: 0x9c9890, roughness: 0.97, metalness: 0 }),
  m("tile_porcelain_floor", "vitrified floor tile 600x600 (warm beige)", "porcelain_tile", { color: 0xd8cdbb, roughness: 0.35, metalness: 0 }),
  m("tile_antiskid", "anti-skid ceramic floor tile 300x300 (grey)", "ceramic_tile", { color: 0xa9aaa6, roughness: 0.7, metalness: 0 }),
  m("tile_wall_ceramic", "glazed ceramic wall tile (white)", "ceramic_tile", { color: 0xf3f2ee, roughness: 0.25, metalness: 0 }),
  m("tile_backsplash", "glazed backsplash tile (sage)", "ceramic_tile", { color: 0xb7c2b0, roughness: 0.25, metalness: 0 }),
  m("tile_balcony", "terracotta-tone outdoor tile", "ceramic_tile", { color: 0xb88d6e, roughness: 0.75, metalness: 0 }),
  m("roof_finish", "roof waterproofing + screed + white reflective tile", "bitumen_membrane", { color: 0xcac7c0, roughness: 0.85, metalness: 0 }),
  // Joinery and metals
  m("timber_door_teak", "teak-veneer flush door", "timber", { color: 0x7a5236, roughness: 0.6, metalness: 0 }),
  m("timber_door_light", "light oak-veneer flush door", "timber", { color: 0xb08c64, roughness: 0.62, metalness: 0 }),
  m("timber_frame", "hardwood door frame", "timber", { color: 0x6b4a32, roughness: 0.6, metalness: 0 }),
  m("laminate_door_wet", "WPC / laminated bathroom door (white)", "laminate_board", { color: 0xe8e6e1, roughness: 0.5, metalness: 0 }),
  m("metal_frame", "powder-coated aluminium frame (charcoal)", "aluminium", { color: 0x3b3e42, roughness: 0.45, metalness: 0.6 }),
  m("metal_railing", "powder-coated MS railing (charcoal)", "mild_steel", { color: 0x2f3236, roughness: 0.5, metalness: 0.55 }),
  m("metal_hardware", "brushed stainless hardware", "stainless_steel", { color: 0xb9bcbf, roughness: 0.3, metalness: 0.9 }),
  m("metal_panel", "anodised aluminium plate (bronze)", "aluminium", { color: 0x6e5a44, roughness: 0.4, metalness: 0.7 }),
  m("pvc_pipe", "uPVC rainwater pipe (grey)", "pvc", { color: 0x8d9094, roughness: 0.6, metalness: 0 }),
  m("glass_clear", "clear float glass 6 mm", "glass", { color: 0xcfe0e6, roughness: 0.05, metalness: 0, opacity: 0.3, envMapIntensity: 1.2 }),
  m("glass_mirror", "silvered mirror glass", "glass", { color: 0xdfe5e8, roughness: 0.02, metalness: 0.95 }),
  // Ceilings, kitchens, sanitary, fittings
  m("ceiling_gypsum", "gypsum board ceiling, white", "gypsum_board", { color: 0xf6f5f1, roughness: 0.95, metalness: 0 }),
  m("cabinet_laminate", "kitchen cabinet carcass / shutters (warm grey laminate)", "laminate_board", { color: 0x8a8278, roughness: 0.55, metalness: 0 }),
  m("cabinet_front_light", "kitchen wall-unit shutters (ivory laminate)", "laminate_board", { color: 0xe6dfd2, roughness: 0.5, metalness: 0 }),
  m("countertop_granite", "granite countertop (black galaxy tone)", "stone", { color: 0x2b2a2a, roughness: 0.3, metalness: 0 }),
  m("stainless_steel", "stainless steel (sink, hood, faucet bodies)", "stainless_steel", { color: 0xc4c7ca, roughness: 0.28, metalness: 0.95 }),
  m("appliance_white", "appliance body (white)", "appliance_mixed", { color: 0xeeeeec, roughness: 0.35, metalness: 0.1 }),
  m("appliance_black", "appliance glass-ceramic top (black)", "appliance_mixed", { color: 0x1d1e20, roughness: 0.2, metalness: 0.2 }),
  m("sanitary_ceramic", "vitreous china sanitaryware (white)", "sanitary_ceramic", { color: 0xf7f7f5, roughness: 0.18, metalness: 0 }),
  m("fixture_light", "light fitting diffuser (opal)", "appliance_mixed", { color: 0xfbfaf6, roughness: 0.4, metalness: 0 }),
]);

const BY_ID = new Map(ARCH_MATERIALS.map((x) => [x.id, x]));

export function archMaterial(id: string): ArchMaterial {
  const x = BY_ID.get(id);
  if (!x) throw new Error(`Unknown architectural material "${id}"`);
  return x;
}

export function hasArchMaterial(id: string): boolean {
  return BY_ID.has(id);
}
