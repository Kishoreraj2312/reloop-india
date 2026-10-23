# ReLoop India — Phase B1 Stage 0 Audit

Counts below come from `scripts/b1/audit_counts.ts` (`npx vite-node scripts/b1/audit_counts.ts`, `--md` for the
table), run against `getStructure`, `getArchitecture` and `getMep` with `DEFAULT_CONFIG`, not from documentation.
Where this brief and the code disagree, the code wins; the differences are listed in section 2.

Read in full or in the relevant parts: `types.ts`, `registry.ts`, `structure/geometry.ts`, `grid.ts` (material),
`architecture/record.ts`, `materials.ts`, `walls.ts`, `openings.ts`, `floors.ts`, `interior.ts`, `generate.ts`,
`mep/record.ts`, `mep/generate.ts`, `App.tsx`, `ComponentInspector.tsx`, `ControlsPanel.tsx`, and the data-model,
specification, decisions and roadmap documents (counts, density assumptions, limitations).

## 1. Confirmed facts

| Fact | Result |
|---|---|
| A1 + A2 records (`getStructure` + `getArchitecture().records`) | **51,494** = 945 STR + 50,549 ARC |
| ARC | 2,737 assemblies (`geometry.kind === "group"`, every `componentType` ends `_assembly`) + **47,812 leaves** |
| STR | 945 members, no assemblies (725 boxes, 210 xz prisms, 10 zy prisms) |
| ARC geometry | 45,994 box, 1,818 cylinder, 2,737 group |
| Rotated boxes | 20, all rotated about X only: 10 `stair_handrail`, 10 `stair_string` (use local size, not the world box) |
| Prisms | 210 `xz` (slab panels with notched corners) and 10 `zy` (stair flights with a sloped soffit) |
| Units | ARC m2 31,991 · m3 3,571 · nr 12,610 · m 2,377; STR m3 945 (every record has `quantity` + `unit`) |
| Duplicate ids | 0 |
| Hosted openings (`storeys[s].walls[i].openings`) | 439 (87 G + 88 × 4); door / window / cased-opening assemblies: **440** |
| Wall assemblies | 902: 896 in the model's hosted walls, plus 6 stairwell linings (U of three piers, no own `thickness`, unit nr) |
| Piece roles | `wall_pier` 1,353 · `wall_sill` 171 · `wall_reveal` 342 · `wall_lintel` 439 · `wall_above` 439; all 2,726 pieces of hosted walls have the full run thickness |
| Stone sill thickness | `ARCH_CONFIG.openings.stoneSill.thickness` = 0.03 m |
| STR material | `rcc_conceptual`, 2400 kg/m3 (`STRUCTURAL_MATERIAL`) |
| ARC materials | `ARCH_MATERIALS` (id, name, substance, render): no densities |
| Distinct `componentType` / `materialId` in the whole model | 204 / 61 |

## 2. Where the brief and the code disagree

1. **A3 (MEP) exists.** The brief says plumbing and electrical are only `connection_point` stubs. The code has a full
   conceptual MEP model: 35,886 records (278 assemblies + 35,608 leaves: 24,839 cylinders, 10,752 catalogue `part`s,
   17 boxes), 8,684 plumbing + 27,202 electrical. `App.tsx` registers STR + ARC + MEP = **87,380** records, so that is
   what the viewer, registry and inspector see. The engine takes any record set; the identities are tested on STR + ARC
   (the brief's 51,494) and on the full 87,380. The 353 ARC `connection_point` records still exist.
2. **A new geometry kind, `part`** (`size` + `fill`, a catalogue fitting drawn from a shared mesh). Its volume
   `size × fill` is a drawing aid, not a product volume: counted as 1 nr or by length, never given a mass.
3. **`BuildingComponent.unit`** also allows `pcs` and `kg`; no record uses them (the engine maps `pcs` to nr and
   rejects `kg`).
4. **Mass table.** The repository already assumes brick masonry 1800 kg/m3 and steel 7850 (DECISIONS_AND_ASSUMPTIONS.md);
   those are used rather than new numbers.
5. **Previous audit draft.** An untracked `docs/B1_AUDIT.md` and `scripts/b1/audit_counts.ts` were present at the start
   of this phase; they are replaced. The old draft listed MEP as stubs and treated several types loosely, so none of
   its numbers were reused.

## 3. Findings that shape the engine

- **Walls have no CSG.** Net masonry is the sum of the pier / sill / reveal / above pieces; the opening voids are
  derived from the hosted opening extents. `window_assembly` / `door_assembly` / `cased_opening_assembly` list
  `dependencies: [host wall id, lintel piece id]`, which is the key that links each opening to exactly one wall.
- **One door cannot be linked:** `ARC-DOOR-RF-MUM-S-01` is hosted by the roof enclosure (`ARC-ROOF-RF-MUM`,
  `enclosure_wall_*` pieces), which is not a wall assembly with hosted openings. The engine reports it as an
  `UNLINKED_OPENING` issue; the enclosure masonry is still counted as leaves, so no total is affected.
- **Record quantity vs geometry.** Recomputing every leaf from its geometry matched `record.quantity` except five
  skirting returns (`ARC-SKT-*-CM-SVC-02`): a 0.07 m long × 0.10 m high strip, where "longest side" picks the height.
  Rule adopted: the length is the box side that equals `dimensions.length` (the value still comes from the geometry).
  After the change there are 0 mismatches over 84,365 leaves.
- **Nothing is nested** (no group inside a group) and every ARC / MEP leaf has a parent that exists.
- **Not modelled:** reinforcement, structural steel, MEP pipe wall thickness and conductor size, mortar, plaster and paint
  (material properties), formwork.
- **No lint tool exists** in the repository and none was added.

## 4. Classification gate

Every `componentType` below is mapped by `src/engine/quantities/classify.ts`. Unclassified types in the full model: **0**
(a test fails, and the inventory raises `UNCLASSIFIED`, if a generator adds one). `door_leaf` and `door_frame` are
split by material substance (timber / board / metal).

### componentType table (system, geometry, count, unit, category, materialIds)

| system | componentType | geometry | count | unit | category | materialIds |
|---|---|---|---:|---|---|---|
| architecture | `appliance_washer` | box | 29 | nr | appliance | appliance_white |
| architecture | `balcony_assembly` | group | 24 | nr | assembly | concrete_balcony |
| architecture | `balcony_baluster` | box | 1488 | nr | metal | metal_railing |
| architecture | `balcony_canopy_assembly` | group | 6 | nr | assembly | concrete_balcony |
| architecture | `balcony_finish` | box | 24 | m2 | tile_floor | tile_balcony |
| architecture | `balcony_handrail` | box | 72 | m | metal | metal_railing |
| architecture | `balcony_kerb` | box | 72 | m3 | concrete | concrete_balcony |
| architecture | `balcony_outlet` | cylinder | 24 | nr | pipe | pvc_pipe |
| architecture | `balcony_post` | box | 168 | nr | metal | metal_railing |
| architecture | `balcony_slab` | box | 30 | m3 | concrete | concrete_balcony |
| architecture | `balcony_soffit` | box | 30 | m2 | plaster | plaster_soffit |
| architecture | `basin` | box | 79 | nr | sanitary | sanitary_ceramic |
| architecture | `basin_faucet` | box, cylinder | 158 | nr | fitting | stainless_steel |
| architecture | `bath_accessory` | box | 142 | nr | fitting | stainless_steel |
| architecture | `bathroom_assembly` | group | 79 | nr | assembly | sanitary_ceramic |
| architecture | `cased_opening_assembly` | group | 5 | nr | assembly | stone_tread |
| architecture | `ceiling_assembly` | group | 365 | nr | assembly | ceiling_gypsum |
| architecture | `ceiling_board` | box | 1699 | m2 | ceiling_board | ceiling_gypsum |
| architecture | `ceiling_cove` | box | 1644 | m2 | ceiling_board | ceiling_gypsum |
| architecture | `ceiling_fascia` | box | 548 | m2 | ceiling_board | ceiling_gypsum |
| architecture | `ceiling_fixtures_assembly` | group | 365 | nr | assembly | fixture_light |
| architecture | `column_cladding` | box | 185 | m2 | concrete | concrete_band |
| architecture | `connection_point` | cylinder | 353 | nr | mep_stub | pvc_pipe |
| architecture | `coping` | box | 44 | m3 | stone | stone_coping |
| architecture | `door_assembly` | group | 264 | nr | assembly | laminate_door_wet, metal_frame, timber_door_light, timber_door_teak |
| architecture | `door_frame` | box | 807 | nr | metal | metal_frame, timber_frame |
| architecture | `door_handle` | box | 1060 | nr | fitting | metal_hardware |
| architecture | `door_hinge` | box | 795 | nr | fitting | metal_hardware |
| architecture | `door_leaf` | box | 263 | m2 | board | laminate_door_wet, metal_frame, timber_door_light, timber_door_teak |
| architecture | `door_leaf_frame` | box | 8 | nr | metal | metal_frame |
| architecture | `door_threshold` | box | 269 | m3 | stone | stone_tread |
| architecture | `enclosure_floor` | box | 4 | m2 | tile_floor | tile_porcelain_floor |
| architecture | `enclosure_slab` | box | 1 | m3 | concrete | concrete_balcony |
| architecture | `enclosure_wall_above_lintel` | box | 1 | m3 | masonry | masonry_paint_ext |
| architecture | `enclosure_wall_lintel` | box | 1 | m3 | concrete | lintel_rcc_ext |
| architecture | `enclosure_wall_masonry` | box | 5 | m3 | masonry | masonry_paint_ext |
| architecture | `entrance_assembly` | group | 1 | nr | assembly | stone_tread |
| architecture | `entrance_canopy` | box | 1 | m3 | concrete | concrete_balcony |
| architecture | `entrance_landing` | box | 1 | m3 | stone | stone_tread |
| architecture | `entrance_step` | box | 2 | m3 | stone | stone_tread |
| architecture | `facade_assembly` | group | 24 | nr | assembly | concrete_band |
| architecture | `facade_band` | box | 125 | m2 | concrete | concrete_band |
| architecture | `facade_downpipe` | cylinder | 24 | m | pipe | pvc_pipe |
| architecture | `facade_fin` | box | 66 | m3 | concrete | concrete_fin |
| architecture | `facade_rainwater_head` | box | 4 | nr | fitting | pvc_pipe |
| architecture | `facade_sign` | box | 1 | nr | metal | metal_panel |
| architecture | `floor_drain` | box | 108 | nr | fitting | stainless_steel |
| architecture | `floor_finish_assembly` | group | 370 | nr | assembly | tile_antiskid, tile_porcelain_floor |
| architecture | `floor_screed` | box | 947 | m2 | screed | cement_screed |
| architecture | `floor_tile` | box | 23874 | m2 | tile_floor | tile_antiskid, tile_porcelain_floor |
| architecture | `glazing` | box | 322 | m2 | glazing | glass_clear |
| architecture | `kitchen_assembly` | group | 29 | nr | assembly | cabinet_laminate |
| architecture | `kitchen_backsplash` | box | 63 | m2 | tile_wall | tile_backsplash |
| architecture | `kitchen_base_cabinet` | box | 246 | nr | kitchen_unit | cabinet_laminate |
| architecture | `kitchen_countertop` | box | 145 | m2 | stone | countertop_granite |
| architecture | `kitchen_door_front` | box | 361 | nr | kitchen_unit | cabinet_front_light, cabinet_laminate |
| architecture | `kitchen_drawer_front` | box | 217 | nr | kitchen_unit | cabinet_laminate |
| architecture | `kitchen_faucet` | box, cylinder | 58 | nr | fitting | stainless_steel |
| architecture | `kitchen_filler` | box | 58 | nr | kitchen_unit | cabinet_laminate |
| architecture | `kitchen_fridge` | box | 29 | nr | appliance | appliance_white |
| architecture | `kitchen_hob` | box | 29 | nr | appliance | appliance_black |
| architecture | `kitchen_hood` | box | 58 | nr | appliance | stainless_steel |
| architecture | `kitchen_plinth` | box | 58 | m | kitchen_unit | cabinet_laminate |
| architecture | `kitchen_sink` | box | 145 | nr | sanitary | stainless_steel |
| architecture | `kitchen_wall_cabinet` | box | 115 | nr | kitchen_unit | cabinet_laminate |
| architecture | `light_downlight` | cylinder | 1040 | nr | fitting | fixture_light |
| architecture | `light_fixture` | box, cylinder | 4 | nr | fitting | fixture_light |
| architecture | `light_surface` | cylinder | 137 | nr | fitting | fixture_light |
| architecture | `mirror` | box | 79 | m2 | glass_fixture | glass_mirror |
| architecture | `parapet` | box | 22 | m3 | masonry | masonry_paint_ext |
| architecture | `parapet_assembly` | group | 4 | nr | assembly | masonry_paint_ext |
| architecture | `plinth_assembly` | group | 1 | nr | assembly | stone_cladding |
| architecture | `plinth_cap` | box | 4 | m3 | stone | stone_coping |
| architecture | `plinth_cladding` | box | 226 | m2 | stone | stone_cladding |
| architecture | `roof_drain` | cylinder | 4 | nr | fitting | metal_hardware |
| architecture | `roof_drain_assembly` | group | 1 | nr | assembly | metal_hardware |
| architecture | `roof_enclosure_assembly` | group | 1 | nr | assembly | masonry_paint_ext |
| architecture | `roof_finish` | box | 36 | m2 | roof_finish | roof_finish |
| architecture | `roof_finish_assembly` | group | 1 | nr | assembly | roof_finish |
| architecture | `shaft_cap` | box | 1 | m3 | concrete | concrete_balcony |
| architecture | `shaft_upstand` | box | 4 | m3 | masonry | masonry_paint_ext |
| architecture | `shaft_upstand_assembly` | group | 1 | nr | assembly | masonry_paint_ext |
| architecture | `shower_arm` | cylinder | 63 | nr | fitting | stainless_steel |
| architecture | `shower_head` | cylinder | 63 | nr | fitting | stainless_steel |
| architecture | `shower_mixer` | box | 63 | nr | fitting | stainless_steel |
| architecture | `shower_screen` | box | 63 | m2 | glass_fixture | glass_clear |
| architecture | `shower_tray` | box | 63 | nr | sanitary | sanitary_ceramic |
| architecture | `skirting` | box | 2198 | m | skirting | tile_porcelain_floor |
| architecture | `stair_baluster` | box | 225 | nr | metal | metal_railing |
| architecture | `stair_finish_assembly` | group | 15 | nr | assembly | stone_tread |
| architecture | `stair_handrail` | box | 15 | m | metal | metal_railing |
| architecture | `stair_landing_finish` | box | 5 | m2 | stone | stone_tread |
| architecture | `stair_riser` | box | 120 | m2 | stone | stone_tread |
| architecture | `stair_string` | box | 10 | m | stone | stone_tread |
| architecture | `stair_tread` | box | 110 | m2 | stone | stone_tread |
| architecture | `utility_appliances_assembly` | group | 29 | nr | assembly | sanitary_ceramic |
| architecture | `wall_above` | box | 439 | m3 | masonry | masonry_paint_core, masonry_paint_ext, masonry_paint_int |
| architecture | `wall_assembly` | group | 902 | m2, nr | assembly | masonry_paint_core, masonry_paint_ext, masonry_paint_int |
| architecture | `wall_lintel` | box | 439 | m3 | concrete | lintel_rcc_ext, lintel_rcc_int |
| architecture | `wall_pier` | box | 1353 | m3 | masonry | masonry_paint_core, masonry_paint_ext, masonry_paint_int |
| architecture | `wall_reveal` | box | 342 | m3 | masonry | masonry_paint_ext |
| architecture | `wall_sill` | box | 171 | m3 | masonry | masonry_paint_ext |
| architecture | `wall_tile_panel` | box | 583 | m2 | tile_wall | tile_wall_ceramic |
| architecture | `wall_tiling_assembly` | group | 79 | nr | assembly | tile_wall_ceramic |
| architecture | `wc_cistern` | box | 79 | nr | sanitary | sanitary_ceramic |
| architecture | `wc_pan` | box | 79 | nr | sanitary | sanitary_ceramic |
| architecture | `window_assembly` | group | 171 | nr | assembly | metal_frame |
| architecture | `window_frame` | box | 684 | nr | metal | metal_frame |
| architecture | `window_handle` | box | 320 | nr | fitting | metal_hardware |
| architecture | `window_mullion` | box | 125 | nr | metal | metal_frame |
| architecture | `window_sash` | box | 1280 | nr | metal | metal_frame |
| architecture | `window_sill` | box | 171 | m3 | stone | stone_coping |
| architecture | `window_sunshade` | box | 132 | m3 | concrete | concrete_band |
| electrical | `ac_point` | part | 97 | nr | mep_equipment | device_white |
| electrical | `cable` | cylinder | 11272 | m | cable | cable_lighting, cable_power |
| electrical | `cable_tray` | part | 24 | m | containment | tray_gi |
| electrical | `cable_tray_assembly` | group | 5 | nr | assembly | tray_gi |
| electrical | `cable_tray_riser` | part | 4 | m | containment | tray_gi |
| electrical | `cables_assembly` | group | 34 | nr | assembly | cable_lighting |
| electrical | `common_distribution_board` | part | 5 | nr | mep_equipment | enclosure_steel |
| electrical | `conduit` | cylinder | 8148 | m | containment | conduit_lighting, conduit_power |
| electrical | `conduit_adaptor` | part | 34 | nr | fitting | conduit_power |
| electrical | `conduit_bend` | part | 3263 | nr | fitting | conduit_lighting, conduit_power |
| electrical | `conduits_assembly` | group | 34 | nr | assembly | conduit_lighting |
| electrical | `distribution_assembly` | group | 7 | nr | assembly | cable_armoured, enclosure_steel |
| electrical | `distribution_board` | part | 29 | nr | mep_equipment | enclosure_steel |
| electrical | `distribution_board_assembly` | group | 34 | nr | assembly | enclosure_steel |
| electrical | `earth_bar` | part | 6 | nr | mep_equipment | earth_gi |
| electrical | `earth_pit` | part | 2 | nr | mep_equipment | concrete_precast |
| electrical | `earth_strip` | box | 9 | m | cable | earth_gi |
| electrical | `earthing_assembly` | group | 6 | nr | assembly | earth_gi |
| electrical | `energy_meter` | part | 30 | nr | mep_equipment | device_white |
| electrical | `feeder_cable` | cylinder | 4 | m | cable | cable_armoured |
| electrical | `feeder_pillar` | part | 1 | nr | mep_equipment | enclosure_steel |
| electrical | `geyser_point` | part | 63 | nr | mep_equipment | device_white |
| electrical | `incoming_cable` | cylinder | 3 | m | cable | cable_armoured |
| electrical | `isolator` | part | 34 | nr | mep_equipment | device_white |
| electrical | `junction_box` | part | 2150 | nr | fitting | conduit_lighting, conduit_power |
| electrical | `light_bulkhead` | part | 5 | nr | fitting | fixture_light |
| electrical | `main_panel` | part | 1 | nr | mep_equipment | enclosure_steel |
| electrical | `mcb` | part | 302 | nr | mep_equipment | device_white |
| electrical | `meter_board` | part | 1 | nr | mep_equipment | enclosure_steel |
| electrical | `motor_cable` | cylinder | 8 | m | cable | cable_armoured |
| electrical | `power_outlet` | part | 150 | nr | mep_equipment | device_white |
| electrical | `rccb` | part | 34 | nr | mep_equipment | device_white |
| electrical | `service_cable` | cylinder | 2 | m | cable | cable_armoured |
| electrical | `socket_outlet` | part | 367 | nr | mep_equipment | device_white |
| electrical | `submain_cable` | cylinder | 628 | m | cable | cable_armoured |
| electrical | `switch_board` | part | 355 | nr | mep_equipment | device_white |
| electrical | `tray_fitting` | part | 17 | nr | fitting | tray_gi |
| electrical | `wiring_devices_assembly` | group | 34 | nr | assembly | device_white |
| plumbing | `angle_valve` | part | 216 | nr | fitting | stainless_steel |
| plumbing | `building_drain` | cylinder | 18 | m | pipe | upvc_drain |
| plumbing | `check_valve` | part | 2 | nr | fitting | brass_valve |
| plumbing | `cleanout` | part | 64 | nr | fitting | upvc_swr |
| plumbing | `cold_water_assembly` | group | 36 | nr | assembly | cpvc_cold, gi_pipe |
| plumbing | `down_take` | cylinder | 10 | m | pipe | gi_pipe |
| plumbing | `drain_branch` | cylinder | 737 | m | pipe | upvc_swr |
| plumbing | `drain_pipe` | cylinder | 764 | m | pipe | upvc_swr |
| plumbing | `drain_stack` | cylinder | 207 | m | pipe | upvc_swr |
| plumbing | `drainage_assembly` | group | 31 | nr | assembly | upvc_swr |
| plumbing | `float_valve` | part | 1 | nr | fitting | brass_valve |
| plumbing | `foot_valve` | part | 2 | nr | fitting | brass_valve |
| plumbing | `hot_water_assembly` | group | 29 | nr | assembly | cpvc_hot |
| plumbing | `inspection_chamber` | part | 16 | nr | mep_equipment | concrete_precast |
| plumbing | `manhole` | part | 2 | nr | mep_equipment | concrete_precast |
| plumbing | `manhole_cover` | part | 2 | nr | fitting | cast_iron_cover |
| plumbing | `pipe` | cylinder | 2397 | m | pipe | cpvc_cold, cpvc_hot, gi_pipe |
| plumbing | `pipe_cross` | part | 59 | nr | fitting | upvc_swr |
| plumbing | `pipe_elbow` | part | 2483 | nr | fitting | cpvc_cold, cpvc_hot, gi_pipe, pvc_pipe, stainless_steel, upvc_drain, upvc_swr |
| plumbing | `pipe_header` | cylinder | 30 | m | pipe | gi_pipe |
| plumbing | `pipe_tee` | part | 550 | nr | fitting | cpvc_cold, gi_pipe, upvc_swr |
| plumbing | `pump` | part | 2 | nr | mep_equipment | pump_body |
| plumbing | `pump_control_panel` | part | 1 | nr | mep_equipment | enclosure_steel |
| plumbing | `pump_plinth` | box | 1 | nr | concrete | concrete_precast |
| plumbing | `rainwater_assembly` | group | 8 | nr | assembly | pvc_pipe |
| plumbing | `rainwater_pipe` | cylinder | 16 | m | pipe | pvc_pipe |
| plumbing | `recharge_pit` | part | 4 | nr | mep_equipment | concrete_precast |
| plumbing | `rising_main` | cylinder | 12 | m | pipe | gi_pipe |
| plumbing | `sewer_assembly` | group | 2 | nr | assembly | upvc_drain |
| plumbing | `sewer_connection` | part | 2 | nr | fitting | upvc_drain |
| plumbing | `sewer_pipe` | cylinder | 18 | m | pipe | upvc_drain |
| plumbing | `shower_riser` | cylinder | 189 | m | pipe | cpvc_cold |
| plumbing | `storm_drain` | cylinder | 4 | m | pipe | upvc_drain |
| plumbing | `sump_tank` | box | 1 | nr | mep_equipment | concrete_precast |
| plumbing | `supply_connection` | part | 1 | nr | fitting | gi_pipe |
| plumbing | `support_post` | box | 1 | nr | mep_equipment | steel_stand |
| plumbing | `tank_platform` | box | 5 | nr | mep_equipment | steel_stand |
| plumbing | `trap` | part | 216 | nr | fitting | stainless_steel, upvc_swr |
| plumbing | `trap_waste_pipe` | cylinder | 324 | m | pipe | stainless_steel |
| plumbing | `valve` | part | 43 | nr | fitting | brass_valve |
| plumbing | `vent_assembly` | group | 18 | nr | assembly | upvc_vent |
| plumbing | `vent_cowl` | part | 16 | nr | fitting | upvc_vent |
| plumbing | `vent_pipe` | cylinder | 48 | m | pipe | upvc_vent |
| plumbing | `water_heater` | part | 63 | nr | appliance | appliance_white |
| plumbing | `water_meter` | part | 31 | nr | fitting | brass_valve |
| plumbing | `water_tank` | part | 2 | nr | mep_equipment | hdpe_tank |
| structure | `beam` | box | 426 | m3 | concrete | rcc_conceptual |
| structure | `column` | box | 210 | m3 | concrete | rcc_conceptual |
| structure | `footing` | box | 42 | m3 | concrete | rcc_conceptual |
| structure | `pedestal` | box | 42 | m3 | concrete | rcc_conceptual |
| structure | `slab` | prism | 210 | m3 | concrete | rcc_conceptual |
| structure | `stair_flight` | prism | 10 | m3 | concrete | rcc_conceptual |
| structure | `stair_landing` | box | 5 | m3 | concrete | rcc_conceptual |
