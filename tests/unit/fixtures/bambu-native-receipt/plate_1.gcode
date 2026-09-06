; HEADER_BLOCK_START
; BambuStudio 02.08.02.61
; model printing time: 7m 33s; total estimated time: 13m 49s
; total layer number: 50
; total filament length [mm] : 596.95
; total filament volume [cm^3] : 1435.82
; total filament weight [g] : 1.78
; filament_density: 1.24
; filament_diameter: 1.75
; max_z_height: 10.00
; filament: 1
; support_material_on_wipe_tower: 0
; HEADER_BLOCK_END

; CONFIG_BLOCK_START
; accel_to_decel_enable = 0
; accel_to_decel_factor = 50%
; activate_air_filtration = 0
; additional_cooling_fan_speed = 70
; additional_fan_full_speed_layer = 0
; alternate_extra_wall = 0
; ams_filament_load_time_ams = 0
; ams_filament_load_time_ams_lite = 0
; ams_filament_load_time_n3f_s = 0
; ams_filament_unload_time_ams = 0
; ams_filament_unload_time_ams_lite = 0
; ams_filament_unload_time_n3f_s = 0
; apply_scarf_seam_on_circles = 1
; auxiliary_fan = 1
; avoid_crossing_wall_includes_support = 0
; bed_custom_model = 
; bed_custom_texture = 
; bed_exclude_area = 0x0,18x0,18x28,0x28
; bed_heat_soak_area = 
; bed_temperature_formula = by_first_filament
; before_layer_change_gcode = 
; best_object_pos = 0.5,0.5
; bottom_color_penetration_layers = 3
; bottom_shell_layers = 3
; bottom_shell_thickness = 0
; bottom_surface_density = 100%
; bottom_surface_pattern = monotonic
; bridge_angle = 0
; bridge_flow = 1
; bridge_no_support = 0
; bridge_speed = 50
; brim_object_gap = 0.1
; brim_type = auto_brim
; brim_width = 5
; chamber_temperatures = 0
; change_filament_gcode = ;=P1S 20251031=\nM620 S[next_extruder]A\nM204 S9000\nG1 Z{max_layer_z + 3.0} F1200\n\nG1 X70 F21000\nG1 Y245\nG1 Y265 F3000\nM400\nM106 P1 S0\nM106 P2 S0\n{if old_filament_temp > 142 && next_extruder < 255}\nM104 S[old_filament_temp]\n{endif}\n{if long_retractions_when_cut[previous_extruder]}\nM620.11 S1 I[previous_extruder] E-{retraction_distances_when_cut[previous_extruder]} F{flush_volumetric_speeds[previous_extruder]/2.4053*60}\n{else}\nM620.11 S0\n{endif}\nM400\nG1 X90 F3000\nG1 Y255 F4000\nG1 X100 F5000\nG1 X120 F15000\nG1 X20 Y50 F21000\nG1 Y-3\n{if toolchange_count == 2}\n; get travel path for change filament\nM620.1 X[travel_point_1_x] Y[travel_point_1_y] F21000 P0\nM620.1 X[travel_point_2_x] Y[travel_point_2_y] F21000 P1\nM620.1 X[travel_point_3_x] Y[travel_point_3_y] F21000 P2\n{endif}\nM620.1 E F{flush_volumetric_speeds[previous_extruder]/2.4053*60} T{flush_temperatures[previous_extruder]}\nT[next_extruder]\nM620.1 E F{flush_volumetric_speeds[next_extruder]/2.4053*60} T{flush_temperatures[next_extruder]}\n\n{if next_extruder < 255}\n{if long_retractions_when_cut[previous_extruder]}\nM620.11 S1 I[previous_extruder] E{retraction_distances_when_cut[previous_extruder]} F{flush_volumetric_speeds[previous_extruder]/2.4053*60}\nM628 S1\nG92 E0\nG1 E{retraction_distances_when_cut[previous_extruder]} F{flush_volumetric_speeds[previous_extruder]/2.4053*60}\nM400\nM629 S1\n{else}\nM620.11 S0\n{endif}\nG92 E0\n{if flush_length_1 > 1}\nM83\n; FLUSH_START\n; always use highest temperature to flush\nM400\n{if filament_type[next_extruder] == \"PETG\"}\nM109 S260\n{elsif filament_type[next_extruder] == \"PVA\"}\nM109 S210\n{else}\nM109 S{flush_temperatures[next_extruder]}\n{endif}\n{if flush_length_1 > 23.7}\nG1 E23.7 F{flush_volumetric_speeds[previous_extruder]/2.4053*60} ; do not need pulsatile flushing for start part\nG1 E{(flush_length_1 - 23.7) * 0.02} F50\nG1 E{(flush_length_1 - 23.7) * 0.23} F{flush_volumetric_speeds[previous_extruder]/2.4053*60}\nG1 E{(flush_length_1 - 23.7) * 0.02} F50\nG1 E{(flush_length_1 - 23.7) * 0.23} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{(flush_length_1 - 23.7) * 0.02} F50\nG1 E{(flush_length_1 - 23.7) * 0.23} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{(flush_length_1 - 23.7) * 0.02} F50\nG1 E{(flush_length_1 - 23.7) * 0.23} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\n{else}\nG1 E{flush_length_1} F{flush_volumetric_speeds[previous_extruder]/2.4053*60}\n{endif}\n; FLUSH_END\nG1 E-[old_retract_length_toolchange] F1800\nG1 E[old_retract_length_toolchange] F300\n{endif}\n\n{if flush_length_2 > 1}\n\nG91\nG1 X3 F12000; move aside to extrude\nG90\nM83\n\n; FLUSH_START\nG1 E{flush_length_2 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_2 * 0.02} F50\nG1 E{flush_length_2 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_2 * 0.02} F50\nG1 E{flush_length_2 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_2 * 0.02} F50\nG1 E{flush_length_2 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_2 * 0.02} F50\nG1 E{flush_length_2 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_2 * 0.02} F50\n; FLUSH_END\nG1 E-[new_retract_length_toolchange] F1800\nG1 E[new_retract_length_toolchange] F300\n{endif}\n\n{if flush_length_3 > 1}\n\nG91\nG1 X3 F12000; move aside to extrude\nG90\nM83\n\n; FLUSH_START\nG1 E{flush_length_3 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_3 * 0.02} F50\nG1 E{flush_length_3 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_3 * 0.02} F50\nG1 E{flush_length_3 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_3 * 0.02} F50\nG1 E{flush_length_3 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_3 * 0.02} F50\nG1 E{flush_length_3 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_3 * 0.02} F50\n; FLUSH_END\nG1 E-[new_retract_length_toolchange] F1800\nG1 E[new_retract_length_toolchange] F300\n{endif}\n\n{if flush_length_4 > 1}\n\nG91\nG1 X3 F12000; move aside to extrude\nG90\nM83\n\n; FLUSH_START\nG1 E{flush_length_4 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_4 * 0.02} F50\nG1 E{flush_length_4 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_4 * 0.02} F50\nG1 E{flush_length_4 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_4 * 0.02} F50\nG1 E{flush_length_4 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_4 * 0.02} F50\nG1 E{flush_length_4 * 0.18} F{flush_volumetric_speeds[next_extruder]/2.4053*60}\nG1 E{flush_length_4 * 0.02} F50\n; FLUSH_END\n{endif}\n; FLUSH_START\nM400\nM109 S[new_filament_temp]\nG1 E2 F{flush_volumetric_speeds[next_extruder]/2.4053*60} ;Compensate for filament spillage during waiting temperature\n; FLUSH_END\nM400\nG92 E0\nG1 E-[new_retract_length_toolchange] F1800\nM106 P1 S255\nM400 S3\n\nG1 X70 F5000\nG1 X90 F3000\nG1 Y255 F4000\nG1 X105 F5000\nG1 Y265 F5000\nG1 X70 F10000\nG1 X100 F5000\nG1 X70 F10000\nG1 X100 F5000\n\nG1 X70 F10000\nG1 X80 F15000\nG1 X60\nG1 X80\nG1 X60\nG1 X80 ; shake to put down garbage\nG1 X100 F5000\nG1 X165 F15000; wipe and shake\nG1 Y256 ; move Y to aside, prevent collision\nM400\nG1 Z{max_layer_z + 3.0} F3000\n{if layer_z <= (initial_layer_print_height + 0.001)}\nM204 S[initial_layer_acceleration]\n{else}\nM204 S[default_acceleration]\n{endif}\n{else}\nG1 X[x_after_toolchange] Y[y_after_toolchange] Z[z_after_toolchange] F12000\n{endif}\nM621 S[next_extruder]A\n
; circle_compensation_manual_offset = 0
; circle_compensation_speed = 200
; close_additional_fan_first_x_layers = 1
; close_fan_the_first_x_layers = 1
; compatible_printers_condition = 
; complete_print_exhaust_fan_speed = 70
; cool_plate_temp = 35
; cool_plate_temp_initial_layer = 35
; cooling_filter_enabled = 0
; cooling_perimeter_transition_distance = 10
; cooling_slowdown_logic = uniform_cooling
; counter_coef_1 = 0
; counter_coef_2 = 0.008
; counter_coef_3 = -0.041
; counter_limit_max = 0.033
; counter_limit_min = -0.035
; counterbore_hole_bridging = none
; curr_bed_type = Textured PEI Plate
; default_acceleration = 10000
; default_ams_type = -1
; default_filament_colour = ""
; default_filament_profile = "Bambu PLA Basic @BBL P1S 0.4 nozzle"
; default_jerk = 0
; default_nozzle_volume_type = Standard
; default_print_profile = 0.20mm Standard @BBL X1C
; deretraction_speed = 30
; detect_floating_vertical_shell = 1
; detect_narrow_internal_solid_infill = 1
; detect_overhang_wall = 1
; detect_thin_wall = 0
; diameter_limit = 50
; different_settings_to_system = ;;
; draft_shield = disabled
; during_print_exhaust_fan_speed = 70
; elefant_foot_compensation = 0.15
; embedding_wall_into_infill = 0
; enable_arc_fitting = 1
; enable_circle_compensation = 0
; enable_filament_dynamic_map = 0
; enable_height_slowdown = 0
; enable_long_retraction_when_cut = 2
; enable_mixed_color_sublayer = 0
; enable_order_independent_overlap_carving = 0
; enable_overhang_bridge_fan = 1
; enable_overhang_speed = 1
; enable_pre_heating = 0
; enable_pressure_advance = 0
; enable_prime_tower = 1
; enable_support = 1
; enable_support_ironing = 0
; enable_tower_interface_features = 0
; enable_wrapping_detection = 0
; enforce_support_layers = 0
; eng_plate_temp = 0
; eng_plate_temp_initial_layer = 0
; ensure_vertical_shell_thickness = enabled
; exclude_object = 1
; extruder_ams_count = 
; extruder_clearance_dist_to_rod = 33
; extruder_clearance_height_to_lid = 90
; extruder_clearance_height_to_rod = 34
; extruder_clearance_max_radius = 68
; extruder_colour = #018001
; extruder_max_nozzle_count = 1
; extruder_nozzle_stats = 
; extruder_offset = 0x2
; extruder_printable_area = 
; extruder_type = Direct Drive
; extruder_variant_list = "Direct Drive Standard,Direct Drive High Flow"
; fan_cooling_layer_time = 100
; fan_direction = left
; fan_max_speed = 100
; fan_min_speed = 100
; farthest_point_timelapse = 1
; filament_adaptive_volumetric_speed = 0
; filament_adhesiveness_category = 100
; filament_bridge_speed = 25
; filament_change_length = 10
; filament_change_length_nc = 10
; filament_colour = #00AE42
; filament_cooling_before_tower = 0
; filament_cost = 20
; filament_density = 1.24
; filament_dev_ams_drying_ams_limitations = 1
; filament_dev_ams_drying_heat_distortion_temperature = 45
; filament_dev_ams_drying_temperature = 45
; filament_dev_ams_drying_time = 12
; filament_dev_chamber_drying_bed_temperature = 70
; filament_dev_chamber_drying_time = 12
; filament_dev_drying_cooling_temperature = 45
; filament_dev_drying_softening_temperature = 50
; filament_diameter = 1.75
; filament_enable_overhang_speed = 1
; filament_end_gcode = "; filament end gcode \n\n"
; filament_extruder_compatibility = 0
; filament_extruder_variant = "Direct Drive Standard"
; filament_flow_ratio = 0.98
; filament_flush_temp = 0
; filament_flush_temp_fast = 0
; filament_flush_volumetric_speed = 0
; filament_ids = GFL99
; filament_is_mixed = 0
; filament_is_support = 0
; filament_map = 1
; filament_map_2 = 0
; filament_map_mode = Auto For Flush
; filament_max_volumetric_speed = 12
; filament_metal_stickiness = None
; filament_minimal_purge_on_wipe_tower = 15
; filament_mixed_components = ""
; filament_mixed_gradient = 0
; filament_mixed_gradient_curve = ""
; filament_mixed_gradient_per_part = 0
; filament_mixed_gradient_range = ""
; filament_mixed_sublayer_ratios = ""
; filament_notes = 
; filament_nozzle_map = 0
; filament_overhang_1_4_speed = 0
; filament_overhang_2_4_speed = 50
; filament_overhang_3_4_speed = 30
; filament_overhang_4_4_speed = 10
; filament_overhang_totally_speed = 10
; filament_pre_cooling_temperature = 0
; filament_pre_cooling_temperature_nc = 0
; filament_preheat_temperature_delta = 0
; filament_prime_volume = 45
; filament_prime_volume_nc = 60
; filament_printable = 3
; filament_ramming_travel_time = 0
; filament_ramming_travel_time_nc = 0
; filament_ramming_volumetric_speed = -1
; filament_ramming_volumetric_speed_nc = -1
; filament_retract_length_nc = 14
; filament_scarf_gap = 15%
; filament_scarf_height = 10%
; filament_scarf_length = 10
; filament_scarf_seam_type = none
; filament_self_index = 1
; filament_settings_id = "Generic PLA"
; filament_shrink = 100%
; filament_soluble = 0
; filament_start_gcode = "; filament start gcode\n{if  (bed_temperature[current_extruder] >55)||(bed_temperature_initial_layer[current_extruder] >55)}M106 P3 S200\n{elsif(bed_temperature[current_extruder] >50)||(bed_temperature_initial_layer[current_extruder] >50)}M106 P3 S150\n{elsif(bed_temperature[current_extruder] >45)||(bed_temperature_initial_layer[current_extruder] >45)}M106 P3 S50\n{endif}\n\n{if activate_air_filtration[current_extruder] && support_air_filtration}\nM106 P3 S{during_print_exhaust_fan_speed_num[current_extruder]} \n{endif}"
; filament_tower_interface_pre_extrusion_dist = 10
; filament_tower_interface_pre_extrusion_length = 0
; filament_tower_interface_print_temp = -1
; filament_tower_interface_purge_volume = 20
; filament_tower_ironing_area = 4
; filament_type = PLA
; filament_velocity_adaptation_factor = 1
; filament_vendor = Generic
; filament_volume_map = 0
; filename_format = {input_filename_base}_{filament_type[0]}_{print_time}.gcode
; fill_multiline = 1
; filter_out_gap_fill = 0
; first_layer_print_sequence = 0
; first_x_layer_fan_speed = 0
; first_x_layer_part_fan_speed = 0
; flush_into_infill = 0
; flush_into_objects = 0
; flush_into_support = 1
; flush_multiplier = 1
; flush_multiplier_fast = 1.2
; flush_volumes_matrix = 0,280,280,280,280,0,280,280,280,280,0,280,280,280,280,0
; flush_volumes_vector = 140,140,140,140,140,140,140,140
; full_fan_speed_layer = 0
; fuzzy_skin = none
; fuzzy_skin_first_layer = 0
; fuzzy_skin_mode = displacement
; fuzzy_skin_noise_type = classic
; fuzzy_skin_octaves = 4
; fuzzy_skin_persistence = 0.5
; fuzzy_skin_point_distance = 0.8
; fuzzy_skin_scale = 1
; fuzzy_skin_thickness = 0.3
; gap_infill_speed = 250
; gcode_add_line_number = 0
; gcode_flavor = marlin
; grab_length = 0
; group_algo_with_time = 0
; has_filament_switcher = 0
; has_scarf_joint_seam = 0
; head_wrap_detect_zone = 
; hole_coef_1 = 0
; hole_coef_2 = -0.008
; hole_coef_3 = 0.23415
; hole_limit_max = 0.22
; hole_limit_min = 0.088
; hot_plate_temp = 55
; hot_plate_temp_initial_layer = 55
; hotend_cooling_rate = 2
; hotend_heating_rate = 2
; impact_strength_z = 10
; independent_support_layer_height = 1
; infill_combination = 0
; infill_direction = 45
; infill_instead_top_bottom_surfaces = 0
; infill_jerk = 9
; infill_lock_depth = 1
; infill_rotate_step = 0
; infill_shift_step = 0.4
; infill_wall_overlap = 15%
; inherits_group = ;;
; initial_layer_acceleration = 500
; initial_layer_flow_ratio = 1
; initial_layer_infill_speed = 105
; initial_layer_jerk = 9
; initial_layer_line_width = 0.5
; initial_layer_print_height = 0.2
; initial_layer_speed = 50
; initial_layer_travel_acceleration = 6000
; inner_wall_acceleration = 0
; inner_wall_jerk = 9
; inner_wall_line_width = 0.45
; inner_wall_speed = 300
; interface_shells = 0
; interlocking_beam = 0
; interlocking_beam_layer_count = 2
; interlocking_beam_width = 0.8
; interlocking_boundary_avoidance = 2
; interlocking_depth = 2
; interlocking_orientation = 22.5
; internal_bridge_support_thickness = 0.8
; internal_solid_infill_line_width = 0.42
; internal_solid_infill_pattern = zig-zag
; internal_solid_infill_speed = 250
; ironing_direction = 45
; ironing_fan_speed = -1
; ironing_flow = 10%
; ironing_inset = 0.21
; ironing_pattern = zig-zag
; ironing_spacing = 0.15
; ironing_speed = 30
; ironing_type = no ironing
; is_infill_first = 0
; layer_change_gcode = ; layer num/total_layer_count: {layer_num+1}/[total_layer_count]\n; update layer progress\nM73 L{layer_num+1}\nM991 S0 P{layer_num} ;notify layer change
; layer_height = 0.2
; line_width = 0.42
; locked_skeleton_infill_pattern = zigzag
; locked_skin_infill_pattern = crosszag
; long_retractions_when_cut = 0
; long_retractions_when_ec = 0
; machine_bed_mass_Y = 0
; machine_end_gcode = ;===== date: 20230428 =====================\nM400 ; wait for buffer to clear\nG92 E0 ; zero the extruder\nG1 E-0.8 F1800 ; retract\nG1 Z{max_layer_z + 0.5} F900 ; lower z a little\nG1 X65 Y245 F12000 ; move to safe pos \nG1 Y265 F3000\n\nG1 X65 Y245 F12000\nG1 Y265 F3000\nM140 S0 ; turn off bed\nM106 S0 ; turn off fan\nM106 P2 S0 ; turn off remote part cooling fan\nM106 P3 S0 ; turn off chamber cooling fan\n\nG1 X100 F12000 ; wipe\n; pull back filament to AMS\nM620 S255\nG1 X20 Y50 F12000\nG1 Y-3\nT255\nG1 X65 F12000\nG1 Y265\nG1 X100 F12000 ; wipe\nM621 S255\nM104 S0 ; turn off hotend\n\nM622.1 S1 ; for prev firware, default turned on\nM1002 judge_flag timelapse_record_flag\nM622 J1\n    M400 ; wait all motion done\n    M991 S0 P-1 ;end smooth timelapse at safe pos\n    M400 S3 ;wait for last picture to be taken\nM623; end of \"timelapse_record_flag\"\n\nM400 ; wait all motion done\nM17 S\nM17 Z0.4 ; lower z motor current to reduce impact if there is something in the bottom\n{if (max_layer_z + 100.0) < 250}\n    G1 Z{max_layer_z + 100.0} F600\n    G1 Z{max_layer_z +98.0}\n{else}\n    G1 Z250 F600\n    G1 Z248\n{endif}\nM400 P100\nM17 R ; restore z current\n\nM220 S100  ; Reset feedrate magnitude\nM201.2 K1.0 ; Reset acc magnitude\nM73.2   R1.0 ;Reset left time magnitude\nM1002 set_gcode_claim_speed_level : 0\n\nM17 X0.8 Y0.8 Z0.5 ; lower motor current to 45% power\n
; machine_hotend_change_time = 0
; machine_load_filament_time = 29
; machine_max_acceleration_e = 5000,5000
; machine_max_acceleration_extruding = 20000,20000
; machine_max_acceleration_retracting = 5000,5000
; machine_max_acceleration_travel = 9000,9000
; machine_max_acceleration_x = 20000,20000
; machine_max_acceleration_y = 20000,20000
; machine_max_acceleration_z = 500,500
; machine_max_force_Y = 0
; machine_max_jerk_e = 2.5,2.5
; machine_max_jerk_x = 9,9
; machine_max_jerk_y = 9,9
; machine_max_jerk_z = 3,3
; machine_max_printed_mass = 0
; machine_max_speed_e = 30,30
; machine_max_speed_x = 500,500
; machine_max_speed_y = 500,500
; machine_max_speed_z = 20,20
; machine_min_extruding_rate = 0
; machine_min_travel_rate = 0
; machine_pause_gcode = M400 U1
; machine_prepare_compensation_time = 260
; machine_start_gcode = ;===== machine: P1S-0.4 ========================\n;===== date: 20251031 =====================\n;===== turn on the HB fan & MC board fan =================\nM104 S75 ;set extruder temp to turn on the HB fan and prevent filament oozing from nozzle\nM710 A1 S255 ;turn on MC fan by default(P1S)\n;===== reset machine status =================\nM290 X40 Y40 Z2.6666666\nG91\nM17 Z0.4 ; lower the z-motor current\nG380 S2 Z30 F300 ; G380 is same as G38; lower the hotbed , to prevent the nozzle is below the hotbed\nG380 S2 Z-25 F300 ;\nG1 Z5 F300;\nG90\nM17 X1.2 Y1.2 Z0.75 ; reset motor current to default\nM960 S5 P1 ; turn on logo lamp\nG90\nM220 S100 ;Reset Feedrate\nM221 S100 ;Reset Flowrate\nM73.2   R1.0 ;Reset left time magnitude\nM1002 set_gcode_claim_speed_level : 5\nM221 X0 Y0 Z0 ; turn off soft endstop to prevent protential logic problem\nG29.1 Z{+0.0} ; clear z-trim value first\nM204 S10000 ; init ACC set to 10m/s^2\n\n;===== heatbed preheat ====================\nM1002 gcode_claim_action:54\nM140 S[bed_temperature_initial_layer_single] ;set bed temp\nM190 S[bed_temperature_initial_layer_single] ;wait for bed temp\n\n\n\n;=============turn on fans to prevent PLA jamming=================\n{if filament_type[initial_extruder]==\"PLA\"}\n    {if (bed_temperature[initial_extruder] >45)||(bed_temperature_initial_layer[initial_extruder] >45)}\n    M106 P3 S180\n    {endif};Prevent PLA from jamming\n{endif}\nM106 P2 S100 ; turn on big fan ,to cool down toolhead\n\n;===== prepare print temperature and material ==========\nM104 S[nozzle_temperature_initial_layer] ;set extruder temp\nG91\nG0 Z10 F1200\nG90\nG28 X\nM975 S1 ; turn on\nG1 X60 F12000\nG1 Y245\nG1 Y265 F3000\nM620 M\nM620 S[initial_extruder]A   ; switch material if AMS exist\n    M109 S[nozzle_temperature_initial_layer]\n    G1 X120 F12000\n\n    G1 X20 Y50 F12000\n    G1 Y-3\n    T[initial_extruder]\n    G1 X54 F12000\n    G1 Y265\n    M400\nM621 S[initial_extruder]A\nM620.1 E F{flush_volumetric_speeds[initial_no_support_extruder]/2.4053*60} T{flush_temperatures[initial_no_support_extruder]}\n\n\nM412 S1 ; ===turn on filament runout detection===\n\nM109 S250 ;set nozzle to common flush temp\nM106 P1 S0\nG92 E0\nG1 E50 F200\nM400\nM104 S[nozzle_temperature_initial_layer]\nG92 E0\nG1 E50 F200\nM400\nM106 P1 S255\nG92 E0\nG1 E5 F300\nM109 S{nozzle_temperature_initial_layer[initial_extruder]-20} ; drop nozzle temp, make filament shink a bit\nG92 E0\nG1 E-0.5 F300\n\nG1 X70 F9000\nG1 X76 F15000\nG1 X65 F15000\nG1 X76 F15000\nG1 X65 F15000; shake to put down garbage\nG1 X80 F6000\nG1 X95 F15000\nG1 X80 F15000\nG1 X165 F15000; wipe and shake\nM400\nM106 P1 S0\n;===== prepare print temperature and material end =====\n\n\n;===== wipe nozzle ===============================\nM1002 gcode_claim_action : 14\nM975 S1\nM106 S255\nG1 X65 Y230 F18000\nG1 Y264 F6000\nM109 S{nozzle_temperature_initial_layer[initial_extruder]-20}\nG1 X100 F18000 ; first wipe mouth\n\nG0 X135 Y253 F20000  ; move to exposed steel surface edge\nG28 Z P0 T300; home z with low precision,permit 300deg temperature\nG29.2 S0 ; turn off ABL\nG0 Z5 F20000\n\nG1 X60 Y265\nG92 E0\nG1 E-0.5 F300 ; retrack more\nG1 X100 F5000; second wipe mouth\nG1 X70 F15000\nG1 X100 F5000\nG1 X70 F15000\nG1 X100 F5000\nG1 X70 F15000\nG1 X100 F5000\nG1 X70 F15000\nG1 X90 F5000\nG0 X128 Y261 Z-1.5 F20000  ; move to exposed steel surface and stop the nozzle\nM104 S140 ; set temp down to heatbed acceptable\nM106 S255 ; turn on fan (G28 has turn off fan)\n\nM221 S; push soft endstop status\nM221 Z0 ;turn off Z axis endstop\nG0 Z0.5 F20000\nG0 X125 Y259.5 Z-1.01\nG0 X131 F211\nG0 X124\nG0 Z0.5 F20000\nG0 X125 Y262.5\nG0 Z-1.01\nG0 X131 F211\nG0 X124\nG0 Z0.5 F20000\nG0 X125 Y260.0\nG0 Z-1.01\nG0 X131 F211\nG0 X124\nG0 Z0.5 F20000\nG0 X125 Y262.0\nG0 Z-1.01\nG0 X131 F211\nG0 X124\nG0 Z0.5 F20000\nG0 X125 Y260.5\nG0 Z-1.01\nG0 X131 F211\nG0 X124\nG0 Z0.5 F20000\nG0 X125 Y261.5\nG0 Z-1.01\nG0 X131 F211\nG0 X124\nG0 Z0.5 F20000\nG0 X125 Y261.0\nG0 Z-1.01\nG0 X131 F211\nG0 X124\nG0 X128\nG2 I0.5 J0 F300\nG2 I0.5 J0 F300\nG2 I0.5 J0 F300\nG2 I0.5 J0 F300\n\nM109 S140 ; wait nozzle temp down to heatbed acceptable\nG2 I0.5 J0 F3000\nG2 I0.5 J0 F3000\nG2 I0.5 J0 F3000\nG2 I0.5 J0 F3000\n\nM221 R; pop softend status\nG1 Z10 F1200\nM400\nG1 Z10\nG1 F30000\nG1 X230 Y15\nG29.2 S1 ; turn on ABL\n;G28 ; home again after hard wipe mouth\nM106 S0 ; turn off fan , too noisy\n;===== wipe nozzle end ================================\n\n\n;===== bed leveling ==================================\nM1002 judge_flag g29_before_print_flag\nM622 J1\n\n    M1002 gcode_claim_action : 1\n    G29 A X{first_layer_print_min[0]} Y{first_layer_print_min[1]} I{first_layer_print_size[0]} J{first_layer_print_size[1]}\n    M400\n    M500 ; save cali data\n\nM623\n;===== bed leveling end ================================\n\n;===== home after wipe mouth============================\nM1002 judge_flag g29_before_print_flag\nM622 J0\n\n    M1002 gcode_claim_action : 13\n    G28\n\nM623\n;===== home after wipe mouth end =======================\n\nM975 S1 ; turn on vibration supression\n\n\n;=============turn on fans to prevent PLA jamming=================\n{if filament_type[initial_extruder]==\"PLA\"}\n    {if (bed_temperature[initial_extruder] >45)||(bed_temperature_initial_layer[initial_extruder] >45)}\n    M106 P3 S180\n    {endif};Prevent PLA from jamming\n{endif}\nM106 P2 S100 ; turn on big fan ,to cool down toolhead\n\n\nM104 S{nozzle_temperature_initial_layer[initial_extruder]} ; set extrude temp earlier, to reduce wait time\n\n;===== mech mode fast check============================\nG1 X128 Y128 Z10 F20000\nM400 P200\nM970.3 Q1 A7 B30 C80  H15 K0\nM974 Q1 S2 P0\n\nG1 X128 Y128 Z10 F20000\nM400 P200\nM970.3 Q0 A7 B30 C90 Q0 H15 K0\nM974 Q0 S2 P0\n\nM975 S1\nG1 F30000\nG1 X230 Y15\nG28 X ; re-home XY\n;===== fmech mode fast check============================\n\n\n;===== nozzle load line ===============================\nM975 S1\nG90\nM83\nT1000\nG1 X18.0 Y1.0 Z0.8 F18000;Move to start position\nM109 S{nozzle_temperature_initial_layer[initial_extruder]}\nG1 Z0.2\nG0 E2 F300\nG0 X240 E15 F{outer_wall_volumetric_speed/(0.3*0.5)     * 60}\nG0 Y11 E0.700 F{outer_wall_volumetric_speed/(0.3*0.5)/ 4 * 60}\nG0 X239.5\nG0 E0.2\nG0 Y1.5 E0.700\nG0 X18 E15 F{outer_wall_volumetric_speed/(0.3*0.5)     * 60}\nM400\n\n;===== for Textured PEI Plate , lower the nozzle as the nozzle was touching topmost of the texture when homing ==\n;curr_bed_type={curr_bed_type}\n{if curr_bed_type==\"Textured PEI Plate\"}\nG29.1 Z{-0.04} ; for Textured PEI Plate\n{endif}\n;========turn off light and wait extrude temperature =============\nM1002 gcode_claim_action : 0\nM106 S0 ; turn off fan\nM106 P2 S0 ; turn off big fan\nM106 P3 S0 ; turn off chamber fan\n\nM975 S1 ; turn on mech mode supression\n
; machine_switch_extruder_time = 0
; machine_unload_filament_time = 28
; master_extruder_id = 1
; max_bridge_length = 0
; max_layer_height = 0.28
; max_travel_detour_distance = 0
; min_bead_width = 85%
; min_feature_size = 25%
; min_layer_height = 0.08
; minimum_sparse_infill_area = 15
; mmu_segmented_region_interlocking_depth = 0
; mmu_segmented_region_max_width = 0
; monotonic_travel_into_wall = 0%
; no_slow_down_for_cooling_on_outwalls = 0
; nozzle_diameter = 0.4
; nozzle_flush_dataset = 0
; nozzle_height = 4.2
; nozzle_temperature = 220
; nozzle_temperature_initial_layer = 220
; nozzle_temperature_range_high = 240
; nozzle_temperature_range_low = 190
; nozzle_type = stainless_steel
; nozzle_volume = 107
; nozzle_volume_type = Standard
; only_one_wall_first_layer = 0
; ooze_prevention = 0
; other_layers_print_sequence = 0
; other_layers_print_sequence_nums = 0
; outer_wall_acceleration = 5000
; outer_wall_jerk = 9
; outer_wall_line_width = 0.42
; outer_wall_speed = 200
; overhang_1_4_speed = 0
; overhang_2_4_speed = 50
; overhang_3_4_speed = 30
; overhang_4_4_speed = 10
; overhang_fan_speed = 100
; overhang_fan_threshold = 50%
; overhang_threshold_participating_cooling = 95%
; overhang_totally_speed = 10
; override_filament_scarf_seam_setting = 0
; override_process_overhang_speed = 0
; physical_extruder_map = 0
; post_process = 
; pre_start_fan_time = 0
; precise_outer_wall = 0
; precise_z_height = 0
; pressure_advance = 0.02
; prime_tower_brim_width = 3
; prime_tower_enable_framework = 0
; prime_tower_extra_rib_length = 0
; prime_tower_fillet_wall = 1
; prime_tower_flat_ironing = 0
; prime_tower_infill_gap = 150%
; prime_tower_lift_height = -1
; prime_tower_lift_speed = 90
; prime_tower_max_speed = 90
; prime_tower_rib_wall = 1
; prime_tower_rib_width = 8
; prime_tower_skip_points = 1
; prime_tower_width = 35
; prime_volume_mode = Default
; print_compatible_printers = "Bambu Lab X1 Carbon 0.4 nozzle";"Bambu Lab X1 0.4 nozzle";"Bambu Lab P1S 0.4 nozzle";"Bambu Lab X1E 0.4 nozzle"
; print_extruder_id = 1
; print_extruder_variant = "Direct Drive Standard"
; print_flow_ratio = 1
; print_in_clockwise = 0
; print_sequence = by layer
; print_settings_id = 0.20mm Standard @BBL X1C
; printable_area = 0x0,256x0,256x256,0x256
; printable_height = 250
; printer_extruder_id = 1
; printer_extruder_variant = "Direct Drive Standard"
; printer_model = Bambu Lab P1S
; printer_notes = 
; printer_settings_id = Bambu Lab P1S 0.4 nozzle
; printer_structure = corexy
; printer_technology = FFF
; printer_variant = 0.4
; printing_by_object_gcode = 
; process_notes = 
; raft_contact_distance = 0.1
; raft_expansion = 1.5
; raft_first_layer_density = 90%
; raft_first_layer_expansion = -1
; raft_layers = 0
; reduce_crossing_wall = 0
; reduce_fan_stop_start_freq = 1
; reduce_infill_retraction_mode = Auto
; required_nozzle_HRC = 3
; resolution = 0.012
; retract_before_wipe = 0%
; retract_length_toolchange = 2
; retract_lift_above = 0
; retract_lift_below = 249
; retract_restart_extra = 0
; retract_restart_extra_toolchange = 0
; retract_when_changing_layer = 1
; retraction_distances_when_cut = 18
; retraction_distances_when_ec = 0
; retraction_length = 0.8
; retraction_minimum_travel = 1
; retraction_speed = 30
; role_base_wipe_speed = 1
; scan_first_layer = 0
; scarf_angle_threshold = 155
; seam_gap = 15%
; seam_placement_away_from_overhangs = 0
; seam_position = aligned
; seam_slope_conditional = 1
; seam_slope_entire_loop = 0
; seam_slope_gap = 0
; seam_slope_inner_walls = 1
; seam_slope_min_length = 10
; seam_slope_start_height = 10%
; seam_slope_steps = 10
; seam_slope_type = none
; silent_mode = 0
; single_extruder_multi_material = 1
; skeleton_infill_density = 15%
; skeleton_infill_line_width = 0.45
; skin_infill_density = 15%
; skin_infill_depth = 2
; skin_infill_line_width = 0.45
; skirt_distance = 2
; skirt_height = 1
; skirt_loops = 0
; skirt_per_object = 1
; slice_closing_radius = 0.049
; slicing_mode = regular
; slow_down_for_layer_cooling = 1
; slow_down_layer_time = 8
; slow_down_min_speed = 20
; slowdown_end_acc = 100000
; slowdown_end_height = 400
; slowdown_end_speed = 1000
; slowdown_start_acc = 100000
; slowdown_start_height = 0
; slowdown_start_speed = 1000
; small_perimeter_speed = 50%
; small_perimeter_threshold = 0
; smooth_coefficient = 150
; smooth_speed_discontinuity_area = 1
; solid_infill_filament = 0
; sparse_infill_acceleration = 100%
; sparse_infill_anchor = 400%
; sparse_infill_anchor_max = 20
; sparse_infill_density = 20%
; sparse_infill_filament = 0
; sparse_infill_lattice_angle_1 = -45
; sparse_infill_lattice_angle_2 = 45
; sparse_infill_line_width = 0.45
; sparse_infill_pattern = grid
; sparse_infill_speed = 270
; spiral_mode = 0
; spiral_mode_max_xy_smoothing = 200%
; spiral_mode_smooth = 0
; standby_temperature_delta = -5
; start_end_points = 30x-3,54x245
; supertack_plate_temp = 45
; supertack_plate_temp_initial_layer = 45
; support_air_filtration = 0
; support_angle = 0
; support_base_pattern = default
; support_base_pattern_spacing = 2.5
; support_bottom_interface_spacing = 0.5
; support_bottom_z_distance = 0.2
; support_chamber_temp_control = 0
; support_cooling_filter = 0
; support_critical_regions_only = 0
; support_expansion = 0
; support_fast_purge_mode = 0
; support_filament = 0
; support_interface_bottom_layers = 2
; support_interface_filament = 0
; support_interface_loop_pattern = 0
; support_interface_not_for_body = 1
; support_interface_pattern = auto
; support_interface_spacing = 0.5
; support_interface_speed = 80
; support_interface_top_layers = 2
; support_ironing_direction = 0
; support_ironing_flow = 10%
; support_ironing_inset = 0
; support_ironing_pattern = zig-zag
; support_ironing_spacing = 0.15
; support_ironing_speed = 30
; support_line_width = 0.42
; support_object_first_layer_gap = 0.2
; support_object_skip_flush = 0
; support_object_xy_distance = 0.35
; support_on_build_plate_only = 0
; support_remove_small_overhang = 1
; support_speed = 150
; support_style = default
; support_threshold_angle = 30
; support_top_z_distance = 0.2
; support_type = tree(auto)
; symmetric_infill_y_axis = 0
; temperature_vitrification = 45
; template_custom_gcode = 
; textured_plate_temp = 55
; textured_plate_temp_initial_layer = 55
; thick_bridges = 0
; thumbnail_size = 50x50
; time_lapse_gcode = ;========Date 20250206========\n; SKIPPABLE_START\n; SKIPTYPE: timelapse\nM622.1 S1 ; for prev firmware, default turned on\nM1002 judge_flag timelapse_record_flag\nM622 J1\n{if timelapse_type == 0} ; timelapse without wipe tower\nM971 S11 C10 O0\nM1004 S5 P1  ; external shutter\n{elsif timelapse_type == 1} ; timelapse with wipe tower\nG92 E0\nG1 X65 Y245 F20000 ; move to safe pos\nG17\nG2 Z{layer_z} I0.86 J0.86 P1 F20000\nG1 Y265 F3000\nM400\nM1004 S5 P1  ; external shutter\nM400 P300\nM971 S11 C11 O0\nG92 E0\nG1 X100 F5000\nG1 Y255 F20000\n{endif}\nM623\n; SKIPPABLE_END
; timelapse_type = 0
; top_area_threshold = 200%
; top_color_penetration_layers = 5
; top_one_wall_type = all top
; top_shell_layers = 5
; top_shell_thickness = 1
; top_solid_infill_flow_ratio = 1
; top_surface_acceleration = 2000
; top_surface_density = 100%
; top_surface_jerk = 9
; top_surface_line_width = 0.42
; top_surface_pattern = monotonicline
; top_surface_speed = 200
; top_z_overrides_xy_distance = 0
; travel_acceleration = 10000
; travel_jerk = 9
; travel_short_distance_acceleration = 250
; travel_speed = 500
; travel_speed_z = 0
; tree_support_branch_angle = 45
; tree_support_branch_diameter = 2
; tree_support_branch_diameter_angle = 5
; tree_support_branch_distance = 5
; tree_support_wall_count = -1
; upward_compatible_machine = "Bambu Lab P1P 0.4 nozzle";"Bambu Lab X1 0.4 nozzle";"Bambu Lab X1 Carbon 0.4 nozzle";"Bambu Lab X1E 0.4 nozzle";"Bambu Lab A1 0.4 nozzle";"Bambu Lab H2D 0.4 nozzle";"Bambu Lab H2D Pro 0.4 nozzle";"Bambu Lab H2S 0.4 nozzle";"Bambu Lab P2S 0.4 nozzle";"Bambu Lab H2C 0.4 nozzle";"Bambu Lab X2D 0.4 nozzle";"Bambu Lab A2L 0.4 nozzle"
; use_firmware_retraction = 0
; use_relative_e_distances = 1
; vertical_shell_speed = 80%
; volumetric_speed_coefficients = "0 0 0 0 0 0"
; wall_distribution_count = 1
; wall_filament = 0
; wall_generator = classic
; wall_loops = 2
; wall_sequence = inner wall/outer wall
; wall_transition_angle = 10
; wall_transition_filter_deviation = 25%
; wall_transition_length = 100%
; wipe = 1
; wipe_distance = 2
; wipe_speed = 80%
; wipe_tower_no_sparse_layers = 0
; wipe_tower_rotation_angle = 0
; wipe_tower_x = 15
; wipe_tower_y = 220
; wrapping_detection_gcode = 
; wrapping_detection_layers = 20
; wrapping_exclude_area = 
; xy_contour_compensation = 0
; xy_hole_compensation = 0
; z_direction_outwall_speed_continuous = 0
; z_hop = 0.4
; z_hop_types = Auto Lift
; CONFIG_BLOCK_END

; EXECUTABLE_BLOCK_START
M73 P0 R13
M201 X20000 Y20000 Z500 E5000
M203 X500 Y500 Z20 E30
M204 P20000 R5000 T20000
M205 X9.00 Y9.00 Z3.00 E2.50
M106 S0
M106 P2 S0
; FEATURE: Custom
;===== machine: P1S-0.4 ========================
;===== date: 20251031 =====================
;===== turn on the HB fan & MC board fan =================
M104 S75 ;set extruder temp to turn on the HB fan and prevent filament oozing from nozzle
M710 A1 S255 ;turn on MC fan by default(P1S)
;===== reset machine status =================
M290 X40 Y40 Z2.6666666
G91
M17 Z0.4 ; lower the z-motor current
G380 S2 Z30 F300 ; G380 is same as G38; lower the hotbed , to prevent the nozzle is below the hotbed
G380 S2 Z-25 F300 ;
G1 Z5 F300;
G90
M17 X1.2 Y1.2 Z0.75 ; reset motor current to default
M960 S5 P1 ; turn on logo lamp
G90
M220 S100 ;Reset Feedrate
M221 S100 ;Reset Flowrate
M73.2   R1.0 ;Reset left time magnitude
M1002 set_gcode_claim_speed_level : 5
M221 X0 Y0 Z0 ; turn off soft endstop to prevent protential logic problem
G29.1 Z0 ; clear z-trim value first
M204 S10000 ; init ACC set to 10m/s^2

;===== heatbed preheat ====================
M1002 gcode_claim_action:54
M140 S55 ;set bed temp
M190 S55 ;wait for bed temp



;=============turn on fans to prevent PLA jamming=================

    
    M106 P3 S180
    ;Prevent PLA from jamming

M106 P2 S100 ; turn on big fan ,to cool down toolhead

;===== prepare print temperature and material ==========
M104 S220 ;set extruder temp
G91
G0 Z10 F1200
G90
G28 X
M975 S1 ; turn on
G1 X60 F12000
G1 Y245
G1 Y265 F3000
M620 M
M620 S0A   ; switch material if AMS exist
    M109 S220
    G1 X120 F12000

    G1 X20 Y50 F12000
    G1 Y-3
    T0
    G1 X54 F12000
    G1 Y265
    M400
M621 S0A
M620.1 E F299.339 T240


M412 S1 ; ===turn on filament runout detection===

M109 S250 ;set nozzle to common flush temp
M106 P1 S0
G92 E0
M73 P4 R13
G1 E50 F200
M400
M104 S220
G92 E0
M73 P35 R8
G1 E50 F200
M400
M106 P1 S255
G92 E0
G1 E5 F300
M109 S200 ; drop nozzle temp, make filament shink a bit
G92 E0
M73 P37 R8
G1 E-0.5 F300

M73 P39 R8
G1 X70 F9000
G1 X76 F15000
G1 X65 F15000
G1 X76 F15000
G1 X65 F15000; shake to put down garbage
G1 X80 F6000
G1 X95 F15000
G1 X80 F15000
G1 X165 F15000; wipe and shake
M400
M106 P1 S0
;===== prepare print temperature and material end =====


;===== wipe nozzle ===============================
M1002 gcode_claim_action : 14
M975 S1
M106 S255
G1 X65 Y230 F18000
G1 Y264 F6000
M109 S200
G1 X100 F18000 ; first wipe mouth

G0 X135 Y253 F20000  ; move to exposed steel surface edge
G28 Z P0 T300; home z with low precision,permit 300deg temperature
G29.2 S0 ; turn off ABL
G0 Z5 F20000

G1 X60 Y265
G92 E0
G1 E-0.5 F300 ; retrack more
G1 X100 F5000; second wipe mouth
G1 X70 F15000
G1 X100 F5000
G1 X70 F15000
G1 X100 F5000
G1 X70 F15000
G1 X100 F5000
G1 X70 F15000
G1 X90 F5000
G0 X128 Y261 Z-1.5 F20000  ; move to exposed steel surface and stop the nozzle
M104 S140 ; set temp down to heatbed acceptable
M106 S255 ; turn on fan (G28 has turn off fan)

M221 S; push soft endstop status
M221 Z0 ;turn off Z axis endstop
G0 Z0.5 F20000
G0 X125 Y259.5 Z-1.01
G0 X131 F211
G0 X124
G0 Z0.5 F20000
G0 X125 Y262.5
G0 Z-1.01
G0 X131 F211
G0 X124
G0 Z0.5 F20000
G0 X125 Y260.0
G0 Z-1.01
G0 X131 F211
G0 X124
G0 Z0.5 F20000
G0 X125 Y262.0
G0 Z-1.01
G0 X131 F211
G0 X124
G0 Z0.5 F20000
G0 X125 Y260.5
G0 Z-1.01
G0 X131 F211
G0 X124
G0 Z0.5 F20000
G0 X125 Y261.5
G0 Z-1.01
G0 X131 F211
G0 X124
G0 Z0.5 F20000
G0 X125 Y261.0
G0 Z-1.01
G0 X131 F211
G0 X124
G0 X128
G2 I0.5 J0 F300
M73 P40 R8
G2 I0.5 J0 F300
G2 I0.5 J0 F300
G2 I0.5 J0 F300

M109 S140 ; wait nozzle temp down to heatbed acceptable
G2 I0.5 J0 F3000
G2 I0.5 J0 F3000
G2 I0.5 J0 F3000
G2 I0.5 J0 F3000

M221 R; pop softend status
G1 Z10 F1200
M400
G1 Z10
G1 F30000
G1 X230 Y15
G29.2 S1 ; turn on ABL
;G28 ; home again after hard wipe mouth
M106 S0 ; turn off fan , too noisy
;===== wipe nozzle end ================================


;===== bed leveling ==================================
M1002 judge_flag g29_before_print_flag
M622 J1

    M1002 gcode_claim_action : 1
    G29 A X100 Y100 I20 J15
    M400
    M500 ; save cali data

M623
;===== bed leveling end ================================

;===== home after wipe mouth============================
M1002 judge_flag g29_before_print_flag
M622 J0

    M1002 gcode_claim_action : 13
    G28

M623
;===== home after wipe mouth end =======================

M975 S1 ; turn on vibration supression


;=============turn on fans to prevent PLA jamming=================

    
    M106 P3 S180
    ;Prevent PLA from jamming

M106 P2 S100 ; turn on big fan ,to cool down toolhead


M104 S220 ; set extrude temp earlier, to reduce wait time

;===== mech mode fast check============================
G1 X128 Y128 Z10 F20000
M400 P200
M970.3 Q1 A7 B30 C80  H15 K0
M974 Q1 S2 P0

G1 X128 Y128 Z10 F20000
M400 P200
M970.3 Q0 A7 B30 C90 Q0 H15 K0
M974 Q0 S2 P0

M975 S1
G1 F30000
M73 P41 R8
G1 X230 Y15
G28 X ; re-home XY
;===== fmech mode fast check============================


;===== nozzle load line ===============================
M975 S1
G90
M83
T1000
G1 X18.0 Y1.0 Z0.8 F18000;Move to start position
M109 S220
G1 Z0.2
G0 E2 F300
G0 X240 E15 F4800
G0 Y11 E0.700 F1200
G0 X239.5
G0 E0.2
G0 Y1.5 E0.700
G0 X18 E15 F4800
M400

;===== for Textured PEI Plate , lower the nozzle as the nozzle was touching topmost of the texture when homing ==
;curr_bed_type=Textured PEI Plate

G29.1 Z-0.04 ; for Textured PEI Plate

;========turn off light and wait extrude temperature =============
M1002 gcode_claim_action : 0
M106 S0 ; turn off fan
M106 P2 S0 ; turn off big fan
M106 P3 S0 ; turn off chamber fan

M975 S1 ; turn on mech mode supression
; MACHINE_START_GCODE_END
; filament start gcode
M106 P3 S150


;VT0 H-1
G90
G21
M83 ; use relative distances for extrusion
M981 S1 P20000 ;open spaghetti detector
; CHANGE_LAYER
; Z_HEIGHT: 0.2
; LAYER_HEIGHT: 0.2
G1 E-.8 F1800
; layer num/total_layer_count: 1/50
; update layer progress
M73 L1
M991 S0 P0 ;notify layer change
M106 S0
M106 P2 S0
; OBJECT_ID: 15
G1 X119.143 Y112.143 F30000
M204 S6000
G1 Z.4
G1 Z.2
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.5
G1 F3000
M204 S500
G1 X100.857 Y112.143 E.68108
M73 P42 R8
G1 X100.857 Y98.857 E.49485
G1 X119.143 Y98.857 E.68108
G1 X119.143 Y112.083 E.49261
M204 S6000
G1 X119.6 Y112.6 F30000
; FEATURE: Outer wall
M73 P42 R7
G1 F3000
M204 S500
G1 X100.4 Y112.6 E.71513
G1 X100.4 Y98.4 E.5289
G1 X119.6 Y98.4 E.71513
G1 X119.6 Y112.54 E.52666
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 X117.6 Y112.546 E-.76
; WIPE_END
M73 P43 R7
G1 E-.04 F1800
M204 S6000
G1 X117.836 Y104.917 Z.6 F30000
G1 X118.019 Y99.04 Z.6
G1 Z.2
G1 E.8 F1800
; FEATURE: Bottom surface
; LINE_WIDTH: 0.50828
G1 F6139
M204 S500
G1 X118.754 Y99.776 E.03946
G1 X118.754 Y100.434 E.02496
G1 X117.566 Y99.246 E.06373
G1 X116.908 Y99.246 E.02496
G1 X118.754 Y101.092 E.09902
G1 X118.754 Y101.75 E.02496
G1 X116.25 Y99.246 E.13431
G1 X115.592 Y99.246 E.02496
G1 X118.754 Y102.408 E.16961
M73 P44 R7
G1 X118.754 Y103.066 E.02496
G1 X114.934 Y99.246 E.2049
G1 X114.276 Y99.246 E.02496
G1 X118.754 Y103.724 E.2402
G1 X118.754 Y104.383 E.02496
G1 X113.617 Y99.246 E.27549
G1 X112.959 Y99.246 E.02496
G1 X118.754 Y105.041 E.31078
G1 X118.754 Y105.699 E.02496
G1 X112.301 Y99.246 E.34608
G1 X111.643 Y99.246 E.02496
G1 X118.754 Y106.357 E.38137
G1 X118.754 Y107.015 E.02496
G1 X110.985 Y99.246 E.41666
G1 X110.327 Y99.246 E.02496
G1 X118.754 Y107.673 E.45196
G1 X118.754 Y108.331 E.02496
G1 X109.669 Y99.246 E.48725
M73 P45 R7
G1 X109.011 Y99.246 E.02496
G1 X118.754 Y108.989 E.52255
G1 X118.754 Y109.648 E.02496
G1 X108.352 Y99.246 E.55784
G1 X107.694 Y99.246 E.02496
G1 X118.754 Y110.306 E.59313
G1 X118.754 Y110.964 E.02496
G1 X107.036 Y99.246 E.62843
G1 X106.378 Y99.246 E.02496
G1 X118.754 Y111.622 E.66372
G1 X118.754 Y111.754 E.00503
G1 X118.229 Y111.754 E.01993
G1 X105.72 Y99.246 E.67083
G1 X105.062 Y99.246 E.02496
G1 X117.571 Y111.754 E.67083
G1 X116.913 Y111.754 E.02496
G1 X104.404 Y99.246 E.67083
G1 X103.746 Y99.246 E.02496
G1 X116.254 Y111.754 E.67083
G1 X115.596 Y111.754 E.02496
G1 X103.088 Y99.246 E.67083
G1 X102.429 Y99.246 E.02496
G1 X114.938 Y111.754 E.67083
G1 X114.28 Y111.754 E.02496
G1 X101.771 Y99.246 E.67083
G1 X101.246 Y99.246 E.01994
G1 X101.246 Y99.378 E.00502
G1 X113.622 Y111.754 E.66373
G1 X112.964 Y111.754 E.02496
G1 X101.246 Y100.036 E.62843
G1 X101.246 Y100.694 E.02496
G1 X112.306 Y111.754 E.59314
G1 X111.648 Y111.754 E.02496
G1 X101.246 Y101.352 E.55785
G1 X101.246 Y102.01 E.02496
G1 X110.99 Y111.754 E.52255
G1 X110.331 Y111.754 E.02496
G1 X101.246 Y102.669 E.48726
G1 X101.246 Y103.327 E.02496
G1 X109.673 Y111.754 E.45197
G1 X109.015 Y111.754 E.02496
G1 X101.246 Y103.985 E.41667
G1 X101.246 Y104.643 E.02496
G1 X108.357 Y111.754 E.38138
M73 P46 R7
G1 X107.699 Y111.754 E.02496
G1 X101.246 Y105.301 E.34608
G1 X101.246 Y105.959 E.02496
G1 X107.041 Y111.754 E.31079
G1 X106.383 Y111.754 E.02496
G1 X101.246 Y106.617 E.2755
G1 X101.246 Y107.275 E.02496
G1 X105.725 Y111.754 E.2402
G1 X105.066 Y111.754 E.02496
G1 X101.246 Y107.934 E.20491
G1 X101.246 Y108.592 E.02496
G1 X104.408 Y111.754 E.16962
G1 X103.75 Y111.754 E.02496
G1 X101.246 Y109.25 E.13432
G1 X101.246 Y109.908 E.02496
G1 X103.092 Y111.754 E.09903
G1 X102.434 Y111.754 E.02496
G1 X101.246 Y110.566 E.06373
G1 X101.246 Y111.224 E.02496
G1 X101.982 Y111.96 E.03947
; CHANGE_LAYER
; Z_HEIGHT: 0.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F6300
G1 X101.246 Y111.224 E-.39553
G1 X101.246 Y110.566 E-.25009
G1 X101.458 Y110.779 E-.11439
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 2/50
; update layer progress
M73 L2
M991 S0 P1 ;notify layer change
M106 S255
M106 P2 S178
; open powerlost recovery
M1003 S1
; OBJECT_ID: 15
M204 S10000
G17
G3 Z.6 I-.109 J1.212 P1  F30000
G1 X119.398 Y112.398 Z.6
G1 Z.4
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F6085
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F6085
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X118.472 Y112.234 Z.8 F30000
G1 Z.4
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42019
G1 F6085
G1 X119.065 Y111.641 E.02578
G1 X119.065 Y111.108 E.0164
G1 X118.108 Y112.065 E.0416
M73 P47 R7
G1 X117.574 Y112.065 E.0164
G1 X119.065 Y110.574 E.0648
G1 X119.065 Y110.041 E.0164
G1 X117.041 Y112.065 E.08799
G1 X116.507 Y112.065 E.0164
G1 X119.065 Y109.507 E.11119
G1 X119.065 Y108.974 E.0164
G1 X115.974 Y112.065 E.13439
G1 X115.44 Y112.065 E.0164
G1 X119.065 Y108.44 E.15758
G1 X119.065 Y107.907 E.0164
G1 X114.907 Y112.065 E.18078
G1 X114.373 Y112.065 E.0164
G1 X119.065 Y107.373 E.20398
G1 X119.065 Y106.84 E.0164
G1 X113.84 Y112.065 E.22717
G1 X113.306 Y112.065 E.0164
G1 X119.065 Y106.306 E.25037
G1 X119.065 Y105.772 E.0164
G1 X112.772 Y112.065 E.27357
G1 X112.239 Y112.065 E.0164
G1 X119.065 Y105.239 E.29676
G1 X119.065 Y104.705 E.0164
G1 X111.705 Y112.065 E.31996
G1 X111.172 Y112.065 E.0164
G1 X119.065 Y104.172 E.34316
G1 X119.065 Y103.638 E.0164
G1 X110.638 Y112.065 E.36635
G1 X110.105 Y112.065 E.0164
G1 X119.065 Y103.105 E.38955
G1 X119.065 Y102.571 E.0164
G1 X109.571 Y112.065 E.41275
G1 X109.038 Y112.065 E.0164
G1 X119.065 Y102.038 E.43594
G1 X119.065 Y101.504 E.0164
G1 X108.504 Y112.065 E.45914
G1 X107.971 Y112.065 E.0164
G1 X119.065 Y100.971 E.48234
G1 X119.065 Y100.437 E.0164
G1 X107.437 Y112.065 E.50553
G1 X106.903 Y112.065 E.0164
G1 X119.065 Y99.903 E.52873
G1 X119.065 Y99.37 E.0164
G1 X106.37 Y112.065 E.55193
G1 X105.836 Y112.065 E.0164
G1 X118.966 Y98.935 E.57082
G1 X118.432 Y98.935 E.0164
G1 X105.303 Y112.065 E.57082
G1 X104.769 Y112.065 E.0164
G1 X117.899 Y98.935 E.57082
G1 X117.365 Y98.935 E.0164
G1 X104.236 Y112.065 E.57082
G1 X103.702 Y112.065 E.0164
G1 X116.832 Y98.935 E.57082
G1 X116.298 Y98.935 E.0164
G1 X103.169 Y112.065 E.57082
G1 X102.635 Y112.065 E.0164
G1 X115.765 Y98.935 E.57082
G1 X115.231 Y98.935 E.0164
G1 X102.102 Y112.065 E.57082
G1 X101.568 Y112.065 E.0164
G1 X114.697 Y98.935 E.57082
G1 X114.164 Y98.935 E.0164
G1 X101.035 Y112.065 E.57082
G1 X100.935 Y112.065 E.00305
G1 X100.935 Y111.63 E.01335
G1 X113.63 Y98.935 E.55194
G1 X113.097 Y98.935 E.0164
G1 X100.935 Y111.097 E.52874
G1 X100.935 Y110.563 E.0164
G1 X112.563 Y98.935 E.50555
G1 X112.03 Y98.935 E.0164
G1 X100.935 Y110.03 E.48235
G1 X100.935 Y109.496 E.0164
G1 X111.496 Y98.935 E.45915
G1 X110.963 Y98.935 E.0164
G1 X100.935 Y108.963 E.43596
G1 X100.935 Y108.429 E.0164
G1 X110.429 Y98.935 E.41276
G1 X109.896 Y98.935 E.0164
G1 X100.935 Y107.896 E.38956
G1 X100.935 Y107.362 E.0164
G1 X109.362 Y98.935 E.36637
G1 X108.828 Y98.935 E.0164
G1 X100.935 Y106.829 E.34317
G1 X100.935 Y106.295 E.0164
G1 X108.295 Y98.935 E.31997
G1 X107.761 Y98.935 E.0164
G1 X100.935 Y105.761 E.29678
G1 X100.935 Y105.228 E.0164
G1 X107.228 Y98.935 E.27358
G1 X106.694 Y98.935 E.0164
G1 X100.935 Y104.694 E.25038
G1 X100.935 Y104.161 E.0164
G1 X106.161 Y98.935 E.22719
G1 X105.627 Y98.935 E.0164
G1 X100.935 Y103.627 E.20399
G1 X100.935 Y103.094 E.0164
G1 X105.094 Y98.935 E.18079
G1 X104.56 Y98.935 E.0164
G1 X100.935 Y102.56 E.1576
G1 X100.935 Y102.027 E.0164
G1 X104.027 Y98.935 E.1344
G1 X103.493 Y98.935 E.0164
G1 X100.935 Y101.493 E.1112
G1 X100.935 Y100.96 E.0164
G1 X102.96 Y98.935 E.08801
G1 X102.426 Y98.935 E.0164
G1 X100.935 Y100.426 E.06481
G1 X100.935 Y99.892 E.0164
M73 P48 R7
G1 X101.892 Y98.935 E.04161
G1 X101.359 Y98.935 E.0164
G1 X100.766 Y99.529 E.02579
; CHANGE_LAYER
; Z_HEIGHT: 0.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F9542.237
G1 X101.359 Y98.935 E-.31883
G1 X101.892 Y98.935 E-.20275
G1 X101.449 Y99.379 E-.23842
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 3/50
; update layer progress
M73 L3
M991 S0 P2 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z.8 I-.715 J.985 P1  F30000
G1 X119.398 Y112.398 Z.8
G1 Z.6
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F6105
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F6105
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X118.62 Y105.149 Z1 F30000
G1 X119.234 Y99.528 Z1
G1 Z.6
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42019
G1 F6105
G1 X118.641 Y98.935 E.02578
G1 X118.108 Y98.935 E.0164
G1 X119.065 Y99.892 E.0416
G1 X119.065 Y100.426 E.0164
G1 X117.574 Y98.935 E.0648
G1 X117.041 Y98.935 E.0164
G1 X119.065 Y100.959 E.08799
G1 X119.065 Y101.493 E.0164
G1 X116.507 Y98.935 E.11119
G1 X115.974 Y98.935 E.0164
G1 X119.065 Y102.026 E.13439
G1 X119.065 Y102.56 E.0164
G1 X115.44 Y98.935 E.15758
G1 X114.907 Y98.935 E.0164
G1 X119.065 Y103.093 E.18078
G1 X119.065 Y103.627 E.0164
G1 X114.373 Y98.935 E.20398
G1 X113.84 Y98.935 E.0164
G1 X119.065 Y104.161 E.22717
G1 X119.065 Y104.694 E.0164
G1 X113.306 Y98.935 E.25037
G1 X112.772 Y98.935 E.0164
G1 X119.065 Y105.228 E.27357
G1 X119.065 Y105.761 E.0164
G1 X112.239 Y98.935 E.29676
G1 X111.705 Y98.935 E.0164
G1 X119.065 Y106.295 E.31996
G1 X119.065 Y106.828 E.0164
G1 X111.172 Y98.935 E.34316
G1 X110.638 Y98.935 E.0164
G1 X119.065 Y107.362 E.36635
G1 X119.065 Y107.895 E.0164
G1 X110.105 Y98.935 E.38955
G1 X109.571 Y98.935 E.0164
G1 X119.065 Y108.429 E.41275
G1 X119.065 Y108.962 E.0164
G1 X109.038 Y98.935 E.43594
G1 X108.504 Y98.935 E.0164
G1 X119.065 Y109.496 E.45914
G1 X119.065 Y110.029 E.0164
G1 X107.971 Y98.935 E.48234
G1 X107.437 Y98.935 E.0164
G1 X119.065 Y110.563 E.50553
G1 X119.065 Y111.097 E.0164
G1 X106.903 Y98.935 E.52873
G1 X106.37 Y98.935 E.0164
G1 X119.065 Y111.63 E.55193
G1 X119.065 Y112.065 E.01336
G1 X118.966 Y112.065 E.00304
G1 X105.836 Y98.935 E.57082
G1 X105.303 Y98.935 E.0164
G1 X118.432 Y112.065 E.57082
G1 X117.899 Y112.065 E.0164
G1 X104.769 Y98.935 E.57082
G1 X104.236 Y98.935 E.0164
G1 X117.365 Y112.065 E.57082
G1 X116.832 Y112.065 E.0164
G1 X103.702 Y98.935 E.57082
G1 X103.169 Y98.935 E.0164
G1 X116.298 Y112.065 E.57082
G1 X115.765 Y112.065 E.0164
G1 X102.635 Y98.935 E.57082
G1 X102.102 Y98.935 E.0164
G1 X115.231 Y112.065 E.57082
G1 X114.697 Y112.065 E.0164
G1 X101.568 Y98.935 E.57082
G1 X101.035 Y98.935 E.0164
G1 X114.164 Y112.065 E.57082
G1 X113.63 Y112.065 E.0164
G1 X100.935 Y99.37 E.55194
G1 X100.935 Y99.903 E.0164
G1 X113.097 Y112.065 E.52874
G1 X112.563 Y112.065 E.0164
G1 X100.935 Y100.437 E.50555
G1 X100.935 Y100.97 E.0164
G1 X112.03 Y112.065 E.48235
G1 X111.496 Y112.065 E.0164
G1 X100.935 Y101.504 E.45915
G1 X100.935 Y102.037 E.0164
G1 X110.963 Y112.065 E.43596
G1 X110.429 Y112.065 E.0164
G1 X100.935 Y102.571 E.41276
G1 X100.935 Y103.104 E.0164
G1 X109.896 Y112.065 E.38956
G1 X109.362 Y112.065 E.0164
G1 X100.935 Y103.638 E.36637
G1 X100.935 Y104.172 E.0164
G1 X108.828 Y112.065 E.34317
G1 X108.295 Y112.065 E.0164
G1 X100.935 Y104.705 E.31997
G1 X100.935 Y105.239 E.0164
G1 X107.761 Y112.065 E.29678
G1 X107.228 Y112.065 E.0164
G1 X100.935 Y105.772 E.27358
G1 X100.935 Y106.306 E.0164
G1 X106.694 Y112.065 E.25038
G1 X106.161 Y112.065 E.0164
G1 X100.935 Y106.839 E.22719
G1 X100.935 Y107.373 E.0164
G1 X105.627 Y112.065 E.20399
G1 X105.094 Y112.065 E.0164
G1 X100.935 Y107.906 E.18079
G1 X100.935 Y108.44 E.0164
G1 X104.56 Y112.065 E.1576
M73 P49 R7
G1 X104.027 Y112.065 E.0164
G1 X100.935 Y108.973 E.1344
G1 X100.935 Y109.507 E.0164
G1 X103.493 Y112.065 E.1112
G1 X102.96 Y112.065 E.0164
G1 X100.935 Y110.04 E.08801
G1 X100.935 Y110.574 E.0164
G1 X102.426 Y112.065 E.06481
G1 X101.892 Y112.065 E.0164
G1 X100.935 Y111.108 E.04161
G1 X100.935 Y111.641 E.0164
G1 X101.529 Y112.234 E.02579
; CHANGE_LAYER
; Z_HEIGHT: 0.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F9542.237
G1 X100.935 Y111.641 E-.31883
G1 X100.935 Y111.108 E-.20275
G1 X101.379 Y111.551 E-.23842
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 4/50
; update layer progress
M73 L4
M991 S0 P3 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z1 I-.057 J1.216 P1  F30000
G1 X119.398 Y112.398 Z1
G1 Z.8
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F2035
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2035
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z1.2 F30000
G1 X101.822 Y112.05 Z1.2
G1 Z.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2035
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
M73 P49 R6
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 1
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 5/50
; update layer progress
M73 L5
M991 S0 P4 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z1.2 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z1.2
G1 Z1
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
M73 P50 R6
G1 E-.04 F1800
G1 X110.172 Y112.266 Z1.4 F30000
G1 X106.664 Y112.05 Z1.4
G1 Z1
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 1.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 6/50
; update layer progress
M73 L6
M991 S0 P5 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z1.4 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z1.4
G1 Z1.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
M73 P51 R6
G1 E-.04 F1800
G1 X110.165 Y112.408 Z1.6 F30000
G1 X101.822 Y112.05 Z1.6
G1 Z1.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 1.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 7/50
; update layer progress
M73 L7
M991 S0 P6 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z1.6 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z1.6
G1 Z1.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
M73 P52 R6
G1 E-.04 F1800
G1 X110.172 Y112.266 Z1.8 F30000
G1 X106.664 Y112.05 Z1.8
G1 Z1.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 1.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 8/50
; update layer progress
M73 L8
M991 S0 P7 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z1.8 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z1.8
G1 Z1.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
M73 P53 R6
G1 E-.04 F1800
G1 X110.165 Y112.408 Z2 F30000
G1 X101.822 Y112.05 Z2
G1 Z1.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 1.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 9/50
; update layer progress
M73 L9
M991 S0 P8 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z2 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z2
G1 Z1.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
M73 P54 R6
G1 E-.04 F1800
G1 X110.172 Y112.266 Z2.2 F30000
G1 X106.664 Y112.05 Z2.2
G1 Z1.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 10/50
; update layer progress
M73 L10
M991 S0 P9 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z2.2 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z2.2
G1 Z2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
M73 P55 R6
G1 E-.04 F1800
G1 X110.165 Y112.408 Z2.4 F30000
G1 X101.822 Y112.05 Z2.4
G1 Z2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 2.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 11/50
; update layer progress
M73 L11
M991 S0 P10 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z2.4 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z2.4
G1 Z2.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
M73 P56 R6
G1 E-.04 F1800
G1 X110.172 Y112.266 Z2.6 F30000
G1 X106.664 Y112.05 Z2.6
G1 Z2.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 2.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 12/50
; update layer progress
M73 L12
M991 S0 P11 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z2.6 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z2.6
G1 Z2.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
M73 P56 R5
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
M73 P57 R5
G1 E-.04 F1800
G1 X110.165 Y112.408 Z2.8 F30000
G1 X101.822 Y112.05 Z2.8
G1 Z2.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 2.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 13/50
; update layer progress
M73 L13
M991 S0 P12 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z2.8 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z2.8
G1 Z2.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
M73 P58 R5
G1 E-.04 F1800
G1 X110.172 Y112.266 Z3 F30000
G1 X106.664 Y112.05 Z3
G1 Z2.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 2.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 14/50
; update layer progress
M73 L14
M991 S0 P13 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z3 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z3
G1 Z2.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
M73 P59 R5
G1 E-.04 F1800
G1 X110.165 Y112.408 Z3.2 F30000
G1 X101.822 Y112.05 Z3.2
G1 Z2.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 3
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 15/50
; update layer progress
M73 L15
M991 S0 P14 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z3.2 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z3.2
G1 Z3
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z3.4 F30000
M73 P60 R5
G1 X106.664 Y112.05 Z3.4
G1 Z3
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 3.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 16/50
; update layer progress
M73 L16
M991 S0 P15 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z3.4 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z3.4
G1 Z3.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z3.6 F30000
M73 P61 R5
G1 X101.822 Y112.05 Z3.6
G1 Z3.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 3.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 17/50
; update layer progress
M73 L17
M991 S0 P16 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z3.6 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z3.6
G1 Z3.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z3.8 F30000
M73 P62 R5
G1 X106.664 Y112.05 Z3.8
G1 Z3.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 3.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 18/50
; update layer progress
M73 L18
M991 S0 P17 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z3.8 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z3.8
G1 Z3.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z4 F30000
M73 P63 R5
G1 X101.822 Y112.05 Z4
G1 Z3.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 3.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 19/50
; update layer progress
M73 L19
M991 S0 P18 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z4 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z4
G1 Z3.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
M73 P63 R4
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z4.2 F30000
G1 X106.664 Y112.05 Z4.2
G1 Z3.8
M73 P64 R4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 20/50
; update layer progress
M73 L20
M991 S0 P19 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z4.2 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z4.2
G1 Z4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z4.4 F30000
G1 X101.822 Y112.05 Z4.4
G1 Z4
M73 P65 R4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 4.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 21/50
; update layer progress
M73 L21
M991 S0 P20 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z4.4 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z4.4
G1 Z4.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z4.6 F30000
G1 X106.664 Y112.05 Z4.6
G1 Z4.2
M73 P66 R4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 4.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 22/50
; update layer progress
M73 L22
M991 S0 P21 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z4.6 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z4.6
G1 Z4.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z4.8 F30000
G1 X101.822 Y112.05 Z4.8
G1 Z4.4
M73 P67 R4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 4.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 23/50
; update layer progress
M73 L23
M991 S0 P22 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z4.8 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z4.8
G1 Z4.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z5 F30000
G1 X106.664 Y112.05 Z5
G1 Z4.6
M73 P68 R4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 4.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 24/50
; update layer progress
M73 L24
M991 S0 P23 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z5 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z5
G1 Z4.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z5.2 F30000
G1 X101.822 Y112.05 Z5.2
G1 Z4.8
M73 P69 R4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 5
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 25/50
; update layer progress
M73 L25
M991 S0 P24 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z5.2 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z5.2
G1 Z5
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z5.4 F30000
G1 X106.664 Y112.05 Z5.4
G1 Z5
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
M73 P70 R4
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 5.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 26/50
; update layer progress
M73 L26
M991 S0 P25 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z5.4 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z5.4
G1 Z5.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z5.6 F30000
G1 X101.822 Y112.05 Z5.6
G1 Z5.2
M73 P71 R4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
M73 P71 R3
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 5.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 27/50
; update layer progress
M73 L27
M991 S0 P26 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z5.6 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z5.6
G1 Z5.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z5.8 F30000
G1 X106.664 Y112.05 Z5.8
G1 Z5.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
M73 P72 R3
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 5.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 28/50
; update layer progress
M73 L28
M991 S0 P27 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z5.8 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z5.8
G1 Z5.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z6 F30000
G1 X101.822 Y112.05 Z6
G1 Z5.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
M73 P73 R3
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 5.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 29/50
; update layer progress
M73 L29
M991 S0 P28 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z6 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z6
G1 Z5.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z6.2 F30000
G1 X106.664 Y112.05 Z6.2
G1 Z5.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
M73 P74 R3
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 30/50
; update layer progress
M73 L30
M991 S0 P29 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z6.2 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z6.2
G1 Z6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z6.4 F30000
G1 X101.822 Y112.05 Z6.4
G1 Z6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
M73 P75 R3
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 6.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 31/50
; update layer progress
M73 L31
M991 S0 P30 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z6.4 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z6.4
G1 Z6.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z6.6 F30000
G1 X106.664 Y112.05 Z6.6
G1 Z6.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
M73 P76 R3
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 6.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 32/50
; update layer progress
M73 L32
M991 S0 P31 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z6.6 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z6.6
G1 Z6.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z6.8 F30000
G1 X101.822 Y112.05 Z6.8
G1 Z6.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
M73 P77 R3
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 6.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 33/50
; update layer progress
M73 L33
M991 S0 P32 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z6.8 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z6.8
G1 Z6.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z7 F30000
G1 X106.664 Y112.05 Z7
G1 Z6.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
M73 P78 R3
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
M73 P78 R2
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 6.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 34/50
; update layer progress
M73 L34
M991 S0 P33 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z7 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z7
G1 Z6.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z7.2 F30000
G1 X101.822 Y112.05 Z7.2
G1 Z6.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
M73 P79 R2
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 7
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 35/50
; update layer progress
M73 L35
M991 S0 P34 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z7.2 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z7.2
G1 Z7
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z7.4 F30000
G1 X106.664 Y112.05 Z7.4
G1 Z7
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
M73 P80 R2
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 7.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 36/50
; update layer progress
M73 L36
M991 S0 P35 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z7.4 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z7.4
G1 Z7.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z7.6 F30000
G1 X101.822 Y112.05 Z7.6
G1 Z7.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
M73 P81 R2
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 7.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 37/50
; update layer progress
M73 L37
M991 S0 P36 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z7.6 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z7.6
G1 Z7.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z7.8 F30000
G1 X106.664 Y112.05 Z7.8
G1 Z7.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
M73 P82 R2
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 7.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 38/50
; update layer progress
M73 L38
M991 S0 P37 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z7.8 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z7.8
G1 Z7.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z8 F30000
G1 X101.822 Y112.05 Z8
G1 Z7.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
M73 P83 R2
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 7.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 39/50
; update layer progress
M73 L39
M991 S0 P38 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z8 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z8
G1 Z7.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z8.2 F30000
G1 X106.664 Y112.05 Z8.2
G1 Z7.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
G1 X105.036 Y112.05 E.05401
M73 P84 R2
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 40/50
; update layer progress
M73 L40
M991 S0 P39 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z8.2 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z8.2
G1 Z8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z8.4 F30000
G1 X101.822 Y112.05 Z8.4
G1 Z8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
M73 P85 R2
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 8.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 41/50
; update layer progress
M73 L41
M991 S0 P40 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z8.4 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z8.4
G1 Z8.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
M73 P85 R1
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z8.6 F30000
G1 X106.664 Y112.05 Z8.6
G1 Z8.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
G1 X105.036 Y112.05 E.05401
M73 P86 R1
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 8.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 42/50
; update layer progress
M73 L42
M991 S0 P41 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z8.6 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z8.6
G1 Z8.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z8.8 F30000
G1 X101.822 Y112.05 Z8.8
G1 Z8.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
M73 P87 R1
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 8.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 43/50
; update layer progress
M73 L43
M991 S0 P42 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z8.8 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z8.8
G1 Z8.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2031
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2031
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.172 Y112.266 Z9 F30000
G1 X106.664 Y112.05 Z9
G1 Z8.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2031
G1 X105.036 Y112.05 E.05401
G1 X100.95 Y107.964 E.19166
G1 X100.95 Y108.793 E.02748
M73 P88 R1
G1 X110.793 Y98.95 E.46173
G1 X109.207 Y98.95 E.05259
G1 X119.05 Y108.793 E.46173
G1 X119.05 Y107.964 E.02748
G1 X114.964 Y112.05 E.19166
G1 X116.55 Y112.05 E.05259
G1 X103.45 Y98.95 E.61452
G1 X105.036 Y98.95 E.05259
G1 X100.95 Y103.036 E.19166
G1 X100.95 Y102.207 E.02748
G1 X110.793 Y112.05 E.46173
G1 X109.207 Y112.05 E.05259
G1 X119.05 Y102.207 E.46173
G1 X119.05 Y103.036 E.02748
G1 X114.964 Y98.95 E.19166
G1 X116.55 Y98.95 E.05259
G1 X103.45 Y112.05 E.61452
G1 X101.822 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 8.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X103.45 Y112.05 E-.61876
G1 X103.713 Y111.787 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 44/50
; update layer progress
M73 L44
M991 S0 P43 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z9 I-.047 J1.216 P1  F30000
G1 X119.398 Y112.398 Z9
G1 Z8.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2034
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2034
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.165 Y112.408 Z9.2 F30000
G1 X101.822 Y112.05 Z9.2
G1 Z8.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2034
G1 X103.45 Y112.05 E.05401
G1 X116.55 Y98.95 E.61452
G1 X114.964 Y98.95 E.05259
M73 P89 R1
G1 X119.05 Y103.036 E.19166
G1 X119.05 Y102.207 E.02748
G1 X109.207 Y112.05 E.46173
G1 X110.793 Y112.05 E.05259
G1 X100.95 Y102.207 E.46173
G1 X100.95 Y103.036 E.02748
G1 X105.036 Y98.95 E.19166
G1 X103.45 Y98.95 E.05259
G1 X116.55 Y112.05 E.61452
G1 X114.964 Y112.05 E.05259
G1 X119.05 Y107.964 E.19166
G1 X119.05 Y108.793 E.02748
G1 X109.207 Y98.95 E.46173
G1 X110.793 Y98.95 E.05259
G1 X100.95 Y108.793 E.46173
G1 X100.95 Y107.964 E.02748
G1 X105.036 Y112.05 E.19166
G1 X106.664 Y112.05 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 9
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X105.036 Y112.05 E-.61876
G1 X104.773 Y111.787 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 45/50
; update layer progress
M73 L45
M991 S0 P44 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z9.2 I-.051 J1.216 P1  F30000
G1 X119.398 Y112.398 Z9.2
G1 Z9
G1 E.8 F1800
; FEATURE: Inner wall
G1 F2268
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F2268
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X110.19 Y112.033 Z9.4 F30000
G1 X106.287 Y111.673 Z9.4
G1 Z9
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F2268
G1 X104.659 Y111.673 E.05401
G1 X101.327 Y108.341 E.15627
G1 X101.327 Y108.416 E.00246
M73 P90 R1
G1 X110.416 Y99.328 E.42634
G1 X109.584 Y99.328 E.02757
G1 X118.673 Y108.416 E.42634
G1 X118.673 Y108.341 E.00246
G1 X115.341 Y111.673 E.15627
G1 X116.173 Y111.673 E.02757
G1 X103.828 Y99.328 E.57913
G1 X104.659 Y99.327 E.02757
G1 X101.327 Y102.659 E.15627
G1 X101.327 Y102.584 E.00246
G1 X110.416 Y111.673 E.42634
G1 X109.584 Y111.673 E.02757
G1 X118.673 Y102.584 E.42634
G1 X118.673 Y102.659 E.00246
G1 X115.341 Y99.328 E.15627
G1 X116.173 Y99.328 E.02757
G1 X103.827 Y111.673 E.57913
G1 X102.199 Y111.673 E.05401
G1 X119.035 Y99.124 F30000
; Slow Down Start
; FEATURE: Floating vertical shell
; LINE_WIDTH: 0.399308
G1 F3000;_EXTRUDE_SET_SPEED
G1 X119.035 Y111.876 E.37033
G1 X119.008 Y112.008 E.00391
G1 X118.876 Y112.035 E.00391
G1 X101.124 Y112.035 E.51554
G1 X100.992 Y112.008 E.00391
G1 X100.965 Y111.876 E.00391
G1 X100.965 Y99.124 E.37033
G1 X100.992 Y98.992 E.00391
G1 X101.124 Y98.965 E.00391
G1 X118.876 Y98.965 E.51554
G1 X119.008 Y98.992 E.00391
G1 X119.023 Y99.065 E.00217
; Slow Down End
; CHANGE_LAYER
; Z_HEIGHT: 9.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F3000
G1 X119.008 Y98.992 E-.02837
G1 X118.876 Y98.965 E-.05117
G1 X117.085 Y98.965 E-.68045
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 46/50
; update layer progress
M73 L46
M991 S0 P45 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z9.4 I-1.199 J.206 P1  F30000
G1 X119.398 Y112.398 Z9.4
G1 Z9.2
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F8843.478
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F9547.055
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
M73 P91 R1
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X118.315 Y112.231 Z9.6 F30000
G1 Z9.2
G1 E.8 F1800
; FEATURE: Bridge
; LINE_WIDTH: 0.40272
; LAYER_HEIGHT: 0.4
G1 F3000
G1 X119.028 Y111.518 E.05233
G1 X119.028 Y110.878 E.03323
G1 X117.878 Y112.028 E.08445
G1 X117.237 Y112.028 E.03323
G1 X119.028 Y110.237 E.13145
G1 X119.028 Y109.597 E.03323
G1 X116.597 Y112.028 E.17844
G1 X115.957 Y112.028 E.03323
G1 X119.028 Y108.957 E.22543
G1 X119.028 Y108.317 E.03323
G1 X115.317 Y112.028 E.27242
G1 X114.676 Y112.028 E.03323
G1 X119.028 Y107.676 E.31941
G1 X119.028 Y107.036 E.03323
G1 X114.036 Y112.028 E.3664
G1 X113.396 Y112.028 E.03323
G1 X119.028 Y106.396 E.41339
G1 X119.028 Y105.756 E.03323
G1 X112.756 Y112.028 E.46038
G1 X112.115 Y112.028 E.03323
G1 X119.028 Y105.115 E.50738
G1 X119.028 Y104.475 E.03323
G1 X111.475 Y112.028 E.55437
G1 X110.835 Y112.028 E.03323
G1 X119.028 Y103.835 E.60136
G1 X119.028 Y103.195 E.03323
G1 X110.195 Y112.028 E.64835
G1 X109.554 Y112.028 E.03323
G1 X119.028 Y102.554 E.69534
G1 X119.028 Y101.914 E.03323
G1 X108.914 Y112.028 E.74233
G1 X108.274 Y112.028 E.03323
G1 X119.028 Y101.274 E.78932
G1 X119.028 Y100.634 E.03323
G1 X107.634 Y112.028 E.83631
G1 X106.993 Y112.028 E.03323
G1 X119.028 Y99.993 E.8833
G1 X119.028 Y99.353 E.03323
G1 X106.353 Y112.028 E.9303
G1 X105.713 Y112.028 E.03323
G1 X118.769 Y98.972 E.95829
G1 X118.129 Y98.972 E.03323
G1 X105.073 Y112.028 E.95829
G1 X104.432 Y112.028 E.03323
G1 X117.489 Y98.972 E.95829
G1 X116.849 Y98.972 E.03323
G1 X103.792 Y112.028 E.95829
G1 X103.152 Y112.028 E.03323
G1 X116.208 Y98.972 E.95829
G1 X115.568 Y98.972 E.03323
G1 X102.512 Y112.028 E.95829
G1 X101.871 Y112.028 E.03323
G1 X114.928 Y98.972 E.95829
G1 X114.288 Y98.972 E.03323
G1 X101.231 Y112.028 E.95829
G1 X100.972 Y112.028 E.01346
G1 X100.972 Y111.647 E.01976
G1 X113.647 Y98.972 E.93034
G1 X113.007 Y98.972 E.03323
G1 X100.972 Y111.007 E.88335
G1 X100.972 Y110.367 E.03323
G1 X112.367 Y98.972 E.83635
G1 X111.727 Y98.972 E.03323
G1 X100.972 Y109.727 E.78936
G1 X100.972 Y109.086 E.03323
G1 X111.086 Y98.972 E.74237
G1 X110.446 Y98.972 E.03323
G1 X100.972 Y108.446 E.69538
G1 X100.972 Y107.806 E.03323
G1 X109.806 Y98.972 E.64839
G1 X109.166 Y98.972 E.03323
G1 X100.972 Y107.166 E.6014
G1 X100.972 Y106.525 E.03323
G1 X108.525 Y98.972 E.55441
G1 X107.885 Y98.972 E.03323
G1 X100.972 Y105.885 E.50742
G1 X100.972 Y105.245 E.03323
G1 X107.245 Y98.972 E.46043
G1 X106.605 Y98.972 E.03323
G1 X100.972 Y104.605 E.41343
G1 X100.972 Y103.964 E.03323
G1 X105.964 Y98.972 E.36644
G1 X105.324 Y98.972 E.03323
M73 P92 R1
G1 X100.972 Y103.324 E.31945
G1 X100.972 Y102.684 E.03323
G1 X104.684 Y98.972 E.27246
G1 X104.044 Y98.972 E.03323
G1 X100.972 Y102.044 E.22547
G1 X100.972 Y101.404 E.03323
G1 X103.404 Y98.972 E.17848
G1 X102.763 Y98.972 E.03323
G1 X100.972 Y100.763 E.13149
G1 X100.972 Y100.123 E.03323
G1 X102.123 Y98.972 E.0845
G1 X101.483 Y98.972 E.03323
G1 X100.769 Y99.685 E.05237
; CHANGE_LAYER
; Z_HEIGHT: 9.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F3000
G1 X101.483 Y98.972 E-.38344
G1 X102.123 Y98.972 E-.24329
G1 X101.875 Y99.22 E-.13327
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 47/50
; update layer progress
M73 L47
M991 S0 P46 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z9.6 I-.731 J.973 P1  F30000
G1 X119.398 Y112.398 Z9.6
G1 Z9.4
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F6127
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F6127
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X118.62 Y105.149 Z9.8 F30000
G1 X119.234 Y99.528 Z9.8
G1 Z9.4
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42019
G1 F6127
M73 P92 R0
G1 X118.641 Y98.935 E.02578
G1 X118.108 Y98.935 E.0164
G1 X119.065 Y99.892 E.0416
G1 X119.065 Y100.426 E.0164
G1 X117.574 Y98.935 E.0648
G1 X117.041 Y98.935 E.0164
G1 X119.065 Y100.959 E.08799
G1 X119.065 Y101.493 E.0164
G1 X116.507 Y98.935 E.11119
G1 X115.974 Y98.935 E.0164
G1 X119.065 Y102.026 E.13439
G1 X119.065 Y102.56 E.0164
G1 X115.44 Y98.935 E.15758
G1 X114.907 Y98.935 E.0164
G1 X119.065 Y103.093 E.18078
G1 X119.065 Y103.627 E.0164
G1 X114.373 Y98.935 E.20398
G1 X113.84 Y98.935 E.0164
M73 P93 R0
G1 X119.065 Y104.161 E.22717
G1 X119.065 Y104.694 E.0164
G1 X113.306 Y98.935 E.25037
G1 X112.772 Y98.935 E.0164
G1 X119.065 Y105.228 E.27357
G1 X119.065 Y105.761 E.0164
G1 X112.239 Y98.935 E.29676
G1 X111.705 Y98.935 E.0164
G1 X119.065 Y106.295 E.31996
G1 X119.065 Y106.828 E.0164
G1 X111.172 Y98.935 E.34316
G1 X110.638 Y98.935 E.0164
G1 X119.065 Y107.362 E.36635
G1 X119.065 Y107.895 E.0164
G1 X110.105 Y98.935 E.38955
G1 X109.571 Y98.935 E.0164
G1 X119.065 Y108.429 E.41275
G1 X119.065 Y108.962 E.0164
G1 X109.038 Y98.935 E.43594
G1 X108.504 Y98.935 E.0164
G1 X119.065 Y109.496 E.45914
G1 X119.065 Y110.029 E.0164
G1 X107.971 Y98.935 E.48234
G1 X107.437 Y98.935 E.0164
G1 X119.065 Y110.563 E.50553
G1 X119.065 Y111.097 E.0164
G1 X106.903 Y98.935 E.52873
G1 X106.37 Y98.935 E.0164
G1 X119.065 Y111.63 E.55193
G1 X119.065 Y112.065 E.01336
G1 X118.966 Y112.065 E.00304
G1 X105.836 Y98.935 E.57082
G1 X105.303 Y98.935 E.0164
G1 X118.432 Y112.065 E.57082
G1 X117.899 Y112.065 E.0164
G1 X104.769 Y98.935 E.57082
G1 X104.236 Y98.935 E.0164
G1 X117.365 Y112.065 E.57082
G1 X116.832 Y112.065 E.0164
G1 X103.702 Y98.935 E.57082
G1 X103.169 Y98.935 E.0164
G1 X116.298 Y112.065 E.57082
G1 X115.765 Y112.065 E.0164
G1 X102.635 Y98.935 E.57082
G1 X102.102 Y98.935 E.0164
G1 X115.231 Y112.065 E.57082
G1 X114.697 Y112.065 E.0164
G1 X101.568 Y98.935 E.57082
G1 X101.035 Y98.935 E.0164
G1 X114.164 Y112.065 E.57082
G1 X113.63 Y112.065 E.0164
G1 X100.935 Y99.37 E.55194
G1 X100.935 Y99.903 E.0164
G1 X113.097 Y112.065 E.52874
G1 X112.563 Y112.065 E.0164
G1 X100.935 Y100.437 E.50555
G1 X100.935 Y100.97 E.0164
G1 X112.03 Y112.065 E.48235
G1 X111.496 Y112.065 E.0164
G1 X100.935 Y101.504 E.45915
G1 X100.935 Y102.037 E.0164
G1 X110.963 Y112.065 E.43596
G1 X110.429 Y112.065 E.0164
G1 X100.935 Y102.571 E.41276
G1 X100.935 Y103.104 E.0164
G1 X109.896 Y112.065 E.38956
G1 X109.362 Y112.065 E.0164
G1 X100.935 Y103.638 E.36637
G1 X100.935 Y104.172 E.0164
G1 X108.828 Y112.065 E.34317
G1 X108.295 Y112.065 E.0164
G1 X100.935 Y104.705 E.31997
G1 X100.935 Y105.239 E.0164
G1 X107.761 Y112.065 E.29678
G1 X107.228 Y112.065 E.0164
G1 X100.935 Y105.772 E.27358
G1 X100.935 Y106.306 E.0164
G1 X106.694 Y112.065 E.25038
G1 X106.161 Y112.065 E.0164
G1 X100.935 Y106.839 E.22719
G1 X100.935 Y107.373 E.0164
G1 X105.627 Y112.065 E.20399
G1 X105.094 Y112.065 E.0164
G1 X100.935 Y107.906 E.18079
G1 X100.935 Y108.44 E.0164
G1 X104.56 Y112.065 E.1576
G1 X104.027 Y112.065 E.0164
G1 X100.935 Y108.973 E.1344
G1 X100.935 Y109.507 E.0164
G1 X103.493 Y112.065 E.1112
G1 X102.96 Y112.065 E.0164
G1 X100.935 Y110.04 E.08801
G1 X100.935 Y110.574 E.0164
G1 X102.426 Y112.065 E.06481
G1 X101.892 Y112.065 E.0164
G1 X100.935 Y111.108 E.04161
G1 X100.935 Y111.641 E.0164
G1 X101.529 Y112.234 E.02579
; CHANGE_LAYER
; Z_HEIGHT: 9.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F9542.237
G1 X100.935 Y111.641 E-.31883
G1 X100.935 Y111.108 E-.20275
G1 X101.379 Y111.551 E-.23842
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 48/50
; update layer progress
M73 L48
M991 S0 P47 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z9.8 I-.057 J1.216 P1  F30000
G1 X119.398 Y112.398 Z9.8
G1 Z9.6
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F6080
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F6080
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
M73 P94 R0
G1 E-.04 F1800
G1 X118.472 Y112.234 Z10 F30000
G1 Z9.6
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42019
G1 F6080
G1 X119.065 Y111.641 E.02578
G1 X119.065 Y111.108 E.0164
G1 X118.108 Y112.065 E.0416
G1 X117.574 Y112.065 E.0164
G1 X119.065 Y110.574 E.0648
G1 X119.065 Y110.041 E.0164
G1 X117.041 Y112.065 E.08799
G1 X116.507 Y112.065 E.0164
G1 X119.065 Y109.507 E.11119
G1 X119.065 Y108.974 E.0164
G1 X115.974 Y112.065 E.13439
G1 X115.44 Y112.065 E.0164
G1 X119.065 Y108.44 E.15758
G1 X119.065 Y107.907 E.0164
G1 X114.907 Y112.065 E.18078
G1 X114.373 Y112.065 E.0164
G1 X119.065 Y107.373 E.20398
G1 X119.065 Y106.84 E.0164
G1 X113.84 Y112.065 E.22717
G1 X113.306 Y112.065 E.0164
G1 X119.065 Y106.306 E.25037
G1 X119.065 Y105.772 E.0164
G1 X112.772 Y112.065 E.27357
G1 X112.239 Y112.065 E.0164
G1 X119.065 Y105.239 E.29676
G1 X119.065 Y104.705 E.0164
G1 X111.705 Y112.065 E.31996
G1 X111.172 Y112.065 E.0164
G1 X119.065 Y104.172 E.34316
G1 X119.065 Y103.638 E.0164
G1 X110.638 Y112.065 E.36635
G1 X110.105 Y112.065 E.0164
G1 X119.065 Y103.105 E.38955
G1 X119.065 Y102.571 E.0164
G1 X109.571 Y112.065 E.41275
G1 X109.038 Y112.065 E.0164
G1 X119.065 Y102.038 E.43594
G1 X119.065 Y101.504 E.0164
G1 X108.504 Y112.065 E.45914
G1 X107.971 Y112.065 E.0164
G1 X119.065 Y100.971 E.48234
G1 X119.065 Y100.437 E.0164
G1 X107.437 Y112.065 E.50553
G1 X106.903 Y112.065 E.0164
G1 X119.065 Y99.903 E.52873
G1 X119.065 Y99.37 E.0164
G1 X106.37 Y112.065 E.55193
G1 X105.836 Y112.065 E.0164
G1 X118.966 Y98.935 E.57082
G1 X118.432 Y98.935 E.0164
G1 X105.303 Y112.065 E.57082
G1 X104.769 Y112.065 E.0164
G1 X117.899 Y98.935 E.57082
G1 X117.365 Y98.935 E.0164
G1 X104.236 Y112.065 E.57082
G1 X103.702 Y112.065 E.0164
G1 X116.832 Y98.935 E.57082
G1 X116.298 Y98.935 E.0164
G1 X103.169 Y112.065 E.57082
G1 X102.635 Y112.065 E.0164
G1 X115.765 Y98.935 E.57082
G1 X115.231 Y98.935 E.0164
G1 X102.102 Y112.065 E.57082
G1 X101.568 Y112.065 E.0164
G1 X114.697 Y98.935 E.57082
G1 X114.164 Y98.935 E.0164
G1 X101.035 Y112.065 E.57082
G1 X100.935 Y112.065 E.00305
G1 X100.935 Y111.63 E.01335
G1 X113.63 Y98.935 E.55194
G1 X113.097 Y98.935 E.0164
G1 X100.935 Y111.097 E.52874
G1 X100.935 Y110.563 E.0164
G1 X112.563 Y98.935 E.50555
G1 X112.03 Y98.935 E.0164
G1 X100.935 Y110.03 E.48235
G1 X100.935 Y109.496 E.0164
G1 X111.496 Y98.935 E.45915
G1 X110.963 Y98.935 E.0164
G1 X100.935 Y108.963 E.43596
G1 X100.935 Y108.429 E.0164
G1 X110.429 Y98.935 E.41276
G1 X109.896 Y98.935 E.0164
G1 X100.935 Y107.896 E.38956
G1 X100.935 Y107.362 E.0164
G1 X109.362 Y98.935 E.36637
G1 X108.828 Y98.935 E.0164
G1 X100.935 Y106.829 E.34317
G1 X100.935 Y106.295 E.0164
G1 X108.295 Y98.935 E.31997
G1 X107.761 Y98.935 E.0164
G1 X100.935 Y105.761 E.29678
G1 X100.935 Y105.228 E.0164
G1 X107.228 Y98.935 E.27358
G1 X106.694 Y98.935 E.0164
G1 X100.935 Y104.694 E.25038
G1 X100.935 Y104.161 E.0164
G1 X106.161 Y98.935 E.22719
G1 X105.627 Y98.935 E.0164
G1 X100.935 Y103.627 E.20399
G1 X100.935 Y103.094 E.0164
G1 X105.094 Y98.935 E.18079
G1 X104.56 Y98.935 E.0164
G1 X100.935 Y102.56 E.1576
G1 X100.935 Y102.027 E.0164
G1 X104.027 Y98.935 E.1344
G1 X103.493 Y98.935 E.0164
G1 X100.935 Y101.493 E.1112
G1 X100.935 Y100.96 E.0164
G1 X102.96 Y98.935 E.08801
G1 X102.426 Y98.935 E.0164
G1 X100.935 Y100.426 E.06481
G1 X100.935 Y99.892 E.0164
G1 X101.892 Y98.935 E.04161
G1 X101.359 Y98.935 E.0164
G1 X100.766 Y99.529 E.02579
; CHANGE_LAYER
; Z_HEIGHT: 9.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F9542.237
G1 X101.359 Y98.935 E-.31883
G1 X101.892 Y98.935 E-.20275
G1 X101.449 Y99.379 E-.23842
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 49/50
; update layer progress
M73 L49
M991 S0 P48 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z10 I-.715 J.985 P1  F30000
G1 X119.398 Y112.398 Z10
G1 Z9.8
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F6105
M73 P95 R0
G1 X100.602 Y112.398 E.62349
G1 X100.602 Y98.602 E.45763
G1 X119.398 Y98.602 E.62349
G1 X119.398 Y112.338 E.45564
M204 S250
G1 X119.79 Y112.79 F30000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F6105
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
; WIPE_START
G1 F9547.055
M204 S10000
G1 X117.79 Y112.736 E-.76
; WIPE_END
G1 E-.04 F1800
G1 X118.62 Y105.149 Z10.2 F30000
G1 X119.234 Y99.528 Z10.2
G1 Z9.8
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42019
G1 F6105
G1 X118.641 Y98.935 E.02578
G1 X118.108 Y98.935 E.0164
G1 X119.065 Y99.892 E.0416
G1 X119.065 Y100.426 E.0164
G1 X117.574 Y98.935 E.0648
G1 X117.041 Y98.935 E.0164
G1 X119.065 Y100.959 E.08799
G1 X119.065 Y101.493 E.0164
G1 X116.507 Y98.935 E.11119
G1 X115.974 Y98.935 E.0164
G1 X119.065 Y102.026 E.13439
G1 X119.065 Y102.56 E.0164
G1 X115.44 Y98.935 E.15758
G1 X114.907 Y98.935 E.0164
G1 X119.065 Y103.093 E.18078
G1 X119.065 Y103.627 E.0164
G1 X114.373 Y98.935 E.20398
G1 X113.84 Y98.935 E.0164
G1 X119.065 Y104.161 E.22717
G1 X119.065 Y104.694 E.0164
G1 X113.306 Y98.935 E.25037
G1 X112.772 Y98.935 E.0164
G1 X119.065 Y105.228 E.27357
G1 X119.065 Y105.761 E.0164
G1 X112.239 Y98.935 E.29676
G1 X111.705 Y98.935 E.0164
G1 X119.065 Y106.295 E.31996
G1 X119.065 Y106.828 E.0164
G1 X111.172 Y98.935 E.34316
G1 X110.638 Y98.935 E.0164
G1 X119.065 Y107.362 E.36635
G1 X119.065 Y107.895 E.0164
G1 X110.105 Y98.935 E.38955
G1 X109.571 Y98.935 E.0164
G1 X119.065 Y108.429 E.41275
G1 X119.065 Y108.962 E.0164
G1 X109.038 Y98.935 E.43594
G1 X108.504 Y98.935 E.0164
G1 X119.065 Y109.496 E.45914
G1 X119.065 Y110.029 E.0164
G1 X107.971 Y98.935 E.48234
G1 X107.437 Y98.935 E.0164
G1 X119.065 Y110.563 E.50553
G1 X119.065 Y111.097 E.0164
G1 X106.903 Y98.935 E.52873
G1 X106.37 Y98.935 E.0164
G1 X119.065 Y111.63 E.55193
G1 X119.065 Y112.065 E.01336
G1 X118.966 Y112.065 E.00304
G1 X105.836 Y98.935 E.57082
G1 X105.303 Y98.935 E.0164
G1 X118.432 Y112.065 E.57082
G1 X117.899 Y112.065 E.0164
G1 X104.769 Y98.935 E.57082
G1 X104.236 Y98.935 E.0164
G1 X117.365 Y112.065 E.57082
G1 X116.832 Y112.065 E.0164
G1 X103.702 Y98.935 E.57082
G1 X103.169 Y98.935 E.0164
G1 X116.298 Y112.065 E.57082
G1 X115.765 Y112.065 E.0164
G1 X102.635 Y98.935 E.57082
G1 X102.102 Y98.935 E.0164
G1 X115.231 Y112.065 E.57082
G1 X114.697 Y112.065 E.0164
G1 X101.568 Y98.935 E.57082
G1 X101.035 Y98.935 E.0164
G1 X114.164 Y112.065 E.57082
G1 X113.63 Y112.065 E.0164
G1 X100.935 Y99.37 E.55194
G1 X100.935 Y99.903 E.0164
G1 X113.097 Y112.065 E.52874
G1 X112.563 Y112.065 E.0164
G1 X100.935 Y100.437 E.50555
G1 X100.935 Y100.97 E.0164
G1 X112.03 Y112.065 E.48235
G1 X111.496 Y112.065 E.0164
G1 X100.935 Y101.504 E.45915
G1 X100.935 Y102.037 E.0164
G1 X110.963 Y112.065 E.43596
G1 X110.429 Y112.065 E.0164
G1 X100.935 Y102.571 E.41276
G1 X100.935 Y103.104 E.0164
G1 X109.896 Y112.065 E.38956
G1 X109.362 Y112.065 E.0164
G1 X100.935 Y103.638 E.36637
G1 X100.935 Y104.172 E.0164
G1 X108.828 Y112.065 E.34317
G1 X108.295 Y112.065 E.0164
G1 X100.935 Y104.705 E.31997
G1 X100.935 Y105.239 E.0164
G1 X107.761 Y112.065 E.29678
G1 X107.228 Y112.065 E.0164
G1 X100.935 Y105.772 E.27358
G1 X100.935 Y106.306 E.0164
G1 X106.694 Y112.065 E.25038
G1 X106.161 Y112.065 E.0164
G1 X100.935 Y106.839 E.22719
G1 X100.935 Y107.373 E.0164
G1 X105.627 Y112.065 E.20399
G1 X105.094 Y112.065 E.0164
G1 X100.935 Y107.906 E.18079
G1 X100.935 Y108.44 E.0164
G1 X104.56 Y112.065 E.1576
G1 X104.027 Y112.065 E.0164
G1 X100.935 Y108.973 E.1344
G1 X100.935 Y109.507 E.0164
G1 X103.493 Y112.065 E.1112
G1 X102.96 Y112.065 E.0164
G1 X100.935 Y110.04 E.08801
G1 X100.935 Y110.574 E.0164
G1 X102.426 Y112.065 E.06481
G1 X101.892 Y112.065 E.0164
G1 X100.935 Y111.108 E.04161
G1 X100.935 Y111.641 E.0164
G1 X101.529 Y112.234 E.02579
; CHANGE_LAYER
; Z_HEIGHT: 10
; LAYER_HEIGHT: 0.2
; WIPE_START
M73 P96 R0
G1 F9542.237
G1 X100.935 Y111.641 E-.31883
G1 X100.935 Y111.108 E-.20275
G1 X101.379 Y111.551 E-.23842
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 50/50
; update layer progress
M73 L50
M991 S0 P49 ;notify layer change
; OBJECT_ID: 15
G17
G3 Z10.2 I-.082 J1.214 P1  F30000
G1 X119.79 Y112.79 Z10.2
G1 Z10
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F6567
M204 S5000
G1 X100.21 Y112.79 E.60164
G1 X100.21 Y98.21 E.448
G1 X119.79 Y98.21 E.60164
G1 X119.79 Y112.73 E.44616
;========Date 20250206========
; SKIPPABLE_START
; SKIPTYPE: timelapse
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0
M1004 S5 P1  ; external shutter

M623
; SKIPPABLE_END
M204 S10000
G1 X119.583 Y112.182 F30000
; FEATURE: Top surface
G1 F6567
M204 S2000
G1 X119.182 Y112.583 E.01742
G1 X118.648 Y112.583
G1 X119.583 Y111.648 E.0406
G1 X119.583 Y111.115
G1 X118.115 Y112.583 E.06377
G1 X117.582 Y112.583
G1 X119.583 Y110.582 E.08694
G1 X119.583 Y110.049
G1 X117.049 Y112.583 E.11011
G1 X116.515 Y112.583
G1 X119.583 Y109.515 E.13329
G1 X119.583 Y108.982
G1 X115.982 Y112.583 E.15646
G1 X115.449 Y112.583
G1 X119.583 Y108.449 E.17963
G1 X119.583 Y107.916
G1 X114.916 Y112.583 E.20281
G1 X114.382 Y112.583
G1 X119.583 Y107.382 E.22598
G1 X119.583 Y106.849
G1 X113.849 Y112.583 E.24915
G1 X113.316 Y112.583
G1 X119.583 Y106.316 E.27232
G1 X119.583 Y105.783
G1 X112.783 Y112.583 E.2955
G1 X112.249 Y112.583
G1 X119.583 Y105.249 E.31867
G1 X119.583 Y104.716
G1 X111.716 Y112.583 E.34184
G1 X111.183 Y112.583
G1 X119.583 Y104.183 E.36501
G1 X119.583 Y103.65
G1 X110.65 Y112.583 E.38819
G1 X110.116 Y112.583
G1 X119.583 Y103.116 E.41136
G1 X119.583 Y102.583
G1 X109.583 Y112.583 E.43453
G1 X109.05 Y112.583
G1 X119.583 Y102.05 E.4577
G1 X119.583 Y101.517
G1 X108.517 Y112.583 E.48088
G1 X107.983 Y112.583
G1 X119.583 Y100.983 E.50405
G1 X119.583 Y100.45
G1 X107.45 Y112.583 E.52722
G1 X106.917 Y112.583
G1 X119.583 Y99.917 E.55039
G1 X119.583 Y99.383
G1 X106.383 Y112.583 E.57357
G1 X105.85 Y112.583
G1 X119.583 Y98.85 E.59674
G1 X119.482 Y98.417
G1 X105.317 Y112.583 E.61555
G1 X104.784 Y112.583
G1 X118.949 Y98.417 E.61555
G1 X118.416 Y98.417
G1 X104.25 Y112.583 E.61555
G1 X103.717 Y112.583
G1 X117.882 Y98.417 E.61555
G1 X117.349 Y98.417
G1 X103.184 Y112.583 E.61555
G1 X102.651 Y112.583
G1 X116.816 Y98.417 E.61555
G1 X116.283 Y98.417
G1 X102.117 Y112.583 E.61555
G1 X101.584 Y112.583
G1 X115.749 Y98.417 E.61555
G1 X115.216 Y98.417
G1 X101.051 Y112.583 E.61555
G1 X100.518 Y112.583
G1 X114.683 Y98.417 E.61555
G1 X114.15 Y98.417
G1 X100.417 Y112.15 E.59673
G1 X100.417 Y111.616
G1 X113.616 Y98.417 E.57356
M73 P97 R0
G1 X113.083 Y98.417
G1 X100.417 Y111.083 E.55039
G1 X100.417 Y110.55
G1 X112.55 Y98.417 E.52722
G1 X112.017 Y98.417
G1 X100.417 Y110.017 E.50404
G1 X100.417 Y109.483
G1 X111.483 Y98.417 E.48087
G1 X110.95 Y98.417
G1 X100.417 Y108.95 E.4577
G1 X100.417 Y108.417
G1 X110.417 Y98.417 E.43453
G1 X109.884 Y98.417
G1 X100.417 Y107.884 E.41135
G1 X100.417 Y107.35
G1 X109.35 Y98.417 E.38818
G1 X108.817 Y98.417
G1 X100.417 Y106.817 E.36501
G1 X100.417 Y106.284
G1 X108.284 Y98.417 E.34184
G1 X107.751 Y98.417
G1 X100.417 Y105.751 E.31866
G1 X100.417 Y105.217
G1 X107.217 Y98.417 E.29549
G1 X106.684 Y98.417
G1 X100.417 Y104.684 E.27232
G1 X100.417 Y104.151
G1 X106.151 Y98.417 E.24914
G1 X105.618 Y98.417
G1 X100.417 Y103.618 E.22597
G1 X100.417 Y103.084
G1 X105.084 Y98.417 E.2028
G1 X104.551 Y98.417
G1 X100.417 Y102.551 E.17963
G1 X100.417 Y102.018
G1 X104.018 Y98.417 E.15645
G1 X103.485 Y98.417
G1 X100.417 Y101.485 E.13328
G1 X100.417 Y100.951
G1 X102.951 Y98.417 E.11011
G1 X102.418 Y98.417
G1 X100.417 Y100.418 E.08694
G1 X100.417 Y99.885
G1 X101.885 Y98.417 E.06376
G1 X101.351 Y98.417
G1 X100.417 Y99.351 E.04059
G1 X100.417 Y98.818
G1 X100.818 Y98.417 E.01742
; close powerlost recovery
M1003 S0
; WIPE_START
G1 F9547.055
M204 S10000
G1 X100.417 Y98.818 E-.21541
G1 X100.417 Y99.351 E-.20264
G1 X101.054 Y98.715 E-.34195
; WIPE_END
G1 E-.04 F1800
G17
G3 Z10.4 I1.217 J0 P1  F30000
M106 S0
M106 P2 S0
M981 S0 P20000 ; close spaghetti detector
; FEATURE: Custom
; MACHINE_END_GCODE_START
; filament end gcode 

;===== date: 20230428 =====================
M400 ; wait for buffer to clear
G92 E0 ; zero the extruder
G1 E-0.8 F1800 ; retract
G1 Z10.5 F900 ; lower z a little
G1 X65 Y245 F12000 ; move to safe pos 
G1 Y265 F3000

G1 X65 Y245 F12000
G1 Y265 F3000
M140 S0 ; turn off bed
M106 S0 ; turn off fan
M106 P2 S0 ; turn off remote part cooling fan
M106 P3 S0 ; turn off chamber cooling fan

G1 X100 F12000 ; wipe
; pull back filament to AMS
M620 S255
G1 X20 Y50 F12000
G1 Y-3
T255
G1 X65 F12000
G1 Y265
G1 X100 F12000 ; wipe
M621 S255
M104 S0 ; turn off hotend

M622.1 S1 ; for prev firware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
    M400 ; wait all motion done
    M991 S0 P-1 ;end smooth timelapse at safe pos
    M400 S3 ;wait for last picture to be taken
M623; end of "timelapse_record_flag"

M400 ; wait all motion done
M17 S
M17 Z0.4 ; lower z motor current to reduce impact if there is something in the bottom

    G1 Z110 F600
    G1 Z108

M400 P100
M17 R ; restore z current

M220 S100  ; Reset feedrate magnitude
M201.2 K1.0 ; Reset acc magnitude
M73.2   R1.0 ;Reset left time magnitude
M1002 set_gcode_claim_speed_level : 0

M17 X0.8 Y0.8 Z0.5 ; lower motor current to 45% power
M73 P100 R0
; EXECUTABLE_BLOCK_END

