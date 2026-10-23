/**
 * Category classification (B1): componentType + material substance -> one Category.
 * Names are never parsed. A componentType not in the table gives "other" and an UNCLASSIFIED
 * issue so that it shows up in the inventory instead of disappearing.
 */

import type { ComponentRecord } from "@/building/structure";
import { hasMaterial, materialById } from "@/building/materialLibrary";
import type { Category } from "./types";

const T = (category: Category, types: string): [string, Category][] => types.split(/\s+/).filter(Boolean).map((t) => [t, category]);

/** componentType -> category. Includes every type produced by the A1, A2 and A3 generators. */
export const TYPE_CATEGORY: ReadonlyMap<string, Category> = new Map<string, Category>([
  ...T("concrete", `beam column footing pedestal slab stair_flight stair_landing
    balcony_slab balcony_kerb enclosure_slab entrance_canopy shaft_cap facade_band facade_fin
    column_cladding window_sunshade wall_lintel enclosure_wall_lintel pump_plinth`),
  ...T("masonry", `wall_pier wall_sill wall_reveal wall_above enclosure_wall_masonry enclosure_wall_above_lintel parapet shaft_upstand`),
  ...T("stone", `coping door_threshold entrance_landing entrance_step kitchen_countertop plinth_cap plinth_cladding
    stair_landing_finish stair_riser stair_string stair_tread window_sill`),
  ...T("tile_floor", "floor_tile balcony_finish enclosure_floor"),
  ...T("tile_wall", "wall_tile_panel kitchen_backsplash"),
  ...T("screed", "floor_screed"),
  ...T("plaster", "balcony_soffit"),
  ...T("ceiling_board", "ceiling_board ceiling_cove ceiling_fascia"),
  ...T("skirting", "skirting"),
  ...T("glazing", "glazing"),
  ...T("glass_fixture", "mirror shower_screen"),
  ...T("metal", `window_frame window_sash window_mullion door_leaf_frame balcony_baluster balcony_handrail balcony_post
    stair_baluster stair_handrail facade_sign`),
  ...T("sanitary", "basin wc_cistern wc_pan shower_tray kitchen_sink"),
  ...T("kitchen_unit", `kitchen_base_cabinet kitchen_wall_cabinet kitchen_door_front kitchen_drawer_front kitchen_filler kitchen_plinth`),
  ...T("appliance", "appliance_washer kitchen_fridge kitchen_hob kitchen_hood water_heater"),
  ...T("fitting", `basin_faucet bath_accessory door_handle door_hinge window_handle kitchen_faucet shower_arm shower_head shower_mixer
    floor_drain roof_drain facade_rainwater_head light_downlight light_fixture light_surface light_bulkhead
    angle_valve check_valve float_valve foot_valve valve water_meter trap cleanout pipe_elbow pipe_tee pipe_cross
    vent_cowl manhole_cover supply_connection sewer_connection conduit_bend conduit_adaptor junction_box tray_fitting`),
  ...T("pipe", `facade_downpipe balcony_outlet pipe drain_branch drain_pipe drain_stack building_drain sewer_pipe storm_drain
    rainwater_pipe rising_main down_take pipe_header shower_riser vent_pipe trap_waste_pipe`),
  ...T("cable", "cable feeder_cable incoming_cable motor_cable service_cable submain_cable earth_strip"),
  ...T("containment", "conduit cable_tray cable_tray_riser"),
  ...T("mep_equipment", `ac_point common_distribution_board distribution_board earth_bar earth_pit energy_meter feeder_pillar geyser_point
    isolator main_panel mcb meter_board power_outlet rccb socket_outlet switch_board
    inspection_chamber manhole recharge_pit pump pump_control_panel sump_tank support_post tank_platform water_tank`),
  ...T("mep_stub", "connection_point"),
  ...T("roof_finish", "roof_finish"),
]);

/** door_leaf / door_frame split by what they are made of (timber, board or metal). */
function bySubstance(rec: ComponentRecord): Category | null {
  if (rec.componentType !== "door_leaf" && rec.componentType !== "door_frame") return null;
  if (!hasMaterial(rec.materialId)) return null;
  switch (materialById(rec.materialId).substance) {
    case "timber":
      return "timber";
    case "laminate_board":
      return "board";
    case "aluminium":
    case "mild_steel":
    case "stainless_steel":
      return "metal";
    default:
      return null;
  }
}

/** Assemblies (group records) are not physical quantities: category "assembly". */
export function classify(rec: ComponentRecord): { category: Category; classified: boolean } {
  if (rec.geometry.kind === "group") return { category: "assembly", classified: true };
  const s = bySubstance(rec);
  if (s) return { category: s, classified: true };
  const c = TYPE_CATEGORY.get(rec.componentType);
  return c ? { category: c, classified: true } : { category: "other", classified: false };
}
