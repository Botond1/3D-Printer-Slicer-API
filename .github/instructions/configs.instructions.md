---
applyTo: "configs/**"
---

# Configs Folder Instructions

Last synchronized: 2026-09-02

## Scope
- pricing-state/pricing.json is the runtime pricing source of truth,
  persisted atomically; pricing.example.json is the template. An existing
  file is authoritative: defaults seed only a missing or empty file and a
  deleted material never resurrects.
- prusa/*.ini define Prusa profiles (P1S `FDM_0.{1,2,3}mm.ini`, quote-only
  `FDM_P1S_H2D_SIZE_QUOTING_0.{1,2,3}mm.ini`, `SLA_0.025mm.ini`,
  `SLA_0.05mm.ini`) with per-material density and `temperature` keys.
- orca/*.json define Orca machine/process profiles; orca/filament/*.json are
  the material-selected filament profiles (PLA 1.24, PETG 1.27, ABS 1.04,
  TPU 1.24 g/cm3, 1.75 mm) whose exact positive diameter/density are exposed
  from the job snapshot; orca/upstream/Custom/**/*.json are the versioned
  OrcaSlicer v2.3.1 `Custom` parents verified byte-equal at image build.
- bambu/printers.json (`r3d-bambu-printer-registry-v1`) maps the public
  `P1S` (default) and `H2D` ids to the exact vendor machine, process (per
  layer key), and `Generic` filament names of the Bambu Studio 02.08.02.61
  resources flattened from `/opt/bambustudio/resources/profiles/BBL` or
  absolute `BAMBU_PROFILES_ROOT`. Layer keys: P1S 0.08, 0.1, 0.12, 0.16, 0.2,
  0.24, 0.28; H2D 0.08, 0.1, 0.12, 0.16, 0.2, 0.24 (`0.1` reuses the 0.12 mm
  process with the layer height overridden).
- Shipped Prusa FDM and Orca P1S profiles declare `256 x 256 x 250 mm`; the
  quote profiles declare `350 x 320 x 325 mm`. Declared metadata is separate
  from the measured inclusive admission ceilings (Prusa P1S
  `256 x 256 x 249.9`, Orca P1S `253.9 x 253.9 x 249.9`, Prusa H2D-QUOTE
  `350 x 320 x 324.9`, Orca H2D-QUOTE `347.9 x 317.9 x 324.9`, Bambu P1S
  `256 x 228 x 250` with alternative `238 x 256`, Bambu H2D `325 x 320 x 325`)
  kept in `app/config/constants.js`.

## Rules
- Keep configs at repository root in configs/.
- Keep pricing schema shape intact for FDM and SLA objects.
- Do not rename profile or registry files unless resolution logic is updated as well.
- Do not let physical bed/height metadata vary by layer height. Preserve
  declared metadata, but use only the configured inclusive largest-passing
  value for upper admission. FDM fallback remains `350 x 320 x 325`; the
  `1 mm` profile minima remain unchanged.
- Preserve Prusa INI section/key case and reject exact duplicate qualified keys.
  Keep the `temperature` / `first_layer_temperature` / `bed_temperature`
  keys (never `nozzle_temperature`) and the per-material `filament_density`.
- Keep selected profiles, allowlisted Orca parents, and Bambu vendor files
  canonical regular files so bounded exact-byte or flattened job-scratch
  snapshots precede bounds/runtime/digest/native use; reject symlink/
  non-canonical sources, detected growth, and unknown/cyclic/wrong-role
  inheritance.
- Update the pinned Orca binary, versioned parent copies, Docker equality gate,
  and parent-identity contracts together; never edit them independently or add
  environment-dependent runtime root selection. A Bambu Studio upgrade must
  update the AppImage URL/SHA-256, re-check the registry names, and re-measure
  the envelopes.
- Preserve original selected basenames (Prusa/Orca) or vendor machine names
  (Bambu) in public profile and bounds `source_profile` metadata.
- Preserve stable Orca runtime `layer_gcode=''` and
  `use_relative_e_distances='1'` with each repository child's exact
  `layer_change_gcode='G92 E0'`; keep the pinned upstream parent unchanged.
- Preserve machine/process loading through `--load-settings`, selected
  filament through `--load-filaments`, and digest coverage of normalized
  material plus filament JSON or explicit null. Never substitute a default
  profile when no mapping/file exists: a null Orca filament keeps
  `material_used_g`, `hourly_rate`, and `stats.estimated_price_huf` null; a
  Bambu material without a registry mapping is 400
  `MATERIAL_PROFILE_UNAVAILABLE`.
- The generic-Marlin `Bambu_P1S_0.4_nozzle.json` / `Bambu_H2D_0.4_nozzle.json`
  are not vendor-faithful: Orca 2.3.1 deviates by up to +24 % from Bambu
  Studio and has no H2D. `POST /bambu/slice` with the official vendor chain
  is the quoting authority for Bambu Lab printers (CLI equals the owner's GUI
  within -1.1..+0.1 % time and 0..0.2 % mass on the ten reference models).
- Keep H2D-QUOTE on both generic-Marlin engines as quote-only P1S physics;
  it is never hardware-faithful H2D estimation or production H2D G-code.
- Public catalogue v2 is FDM-only, 82 rows (6 Prusa, 24 Orca, 28 Bambu P1S,
  24 Bambu H2D), engine-scoped resolutions, and never the generic
  `120 x 120 x 150 mm` SLA fallback or a guessed Elegoo Saturn 4 Ultra envelope.
- Readiness probes configs/bambu; an invalid registry or unresolvable vendor
  chain refuses startup with a typed code.

## Related Env Keys
- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
- BAMBU_PROFILES_ROOT
- MAX_MATERIAL_USED_METERS
- MAX_MATERIAL_USED_GRAMS
- MAX_MATERIAL_USED_ML
- MAX_MODEL_DIMENSION_MM
- SLICE_STRICT_GCODE_METRICS
- PYTHON_EXECUTABLE
- VIRTUAL_ENV
