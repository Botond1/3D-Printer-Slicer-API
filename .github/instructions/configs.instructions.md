---
applyTo: "configs/**"
---

# Configs Folder Instructions

Last synchronized: 2026-08-31

## Scope
- pricing.json is runtime pricing source of truth.
- pricing.example.json is the template.
- prusa/*.ini and orca/*.json define slicing profiles.
- orca/filament/*.json are material-selected filament profiles whose exact
  positive diameter/density are exposed from the job snapshot.
- orca/upstream/Custom/**/*.json are the versioned runtime source for the pinned
  OrcaSlicer v2.3.1 `Custom` parent chain; Docker build requires canonical
  semantic equality with the exact native files.
- Shipped Prusa FDM and Orca P1S profiles declare
  `256 x 256 x 250 mm`; the historical Orca H2D placeholder declares
  `350 x 320 x 325 mm`. Declared profile metadata is separate from native
  admission.
- Three Prusa `FDM_P1S_H2D_SIZE_QUOTING_*` profiles and Orca
  `Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json` declare the H2D-size bed while
  retaining P1S-derived physics for quoting only.

## Rules
- Keep configs at repository root in configs/.
- Keep pricing schema shape intact for FDM and SLA objects.
- Do not rename profile files unless profile resolution logic is updated as well.
- Do not let physical bed/height metadata vary by layer height. Preserve that
  declared metadata, but use only the configured inclusive largest-passing
  value for upper admission. FDM fallback remains a broad compatibility
  envelope and the existing `1 mm` profile minima remain unchanged.
- Preserve Prusa INI section/key case and reject exact duplicate qualified keys.
- Keep selected profiles and allowlisted Orca parents canonical regular files so
  bounded exact Prusa-byte or flattened-Orca job-scratch snapshots precede
  bounds/runtime/digest/native use; reject symlink/non-canonical sources,
  detected growth, and unknown/cyclic/wrong-role inheritance.
- Update the pinned Orca binary, versioned parent copies, Docker equality gate,
  and parent-identity contracts together; never edit them independently or add
  environment-dependent runtime root selection.
- Preserve original selected basenames in public profile and bounds
  `source_profile` metadata. The direct native smoke for the flattened snapshots
  and final exact-image HTTP transform/final-dimensions E2E pass; the exact local
  code/image identity is recorded in the J0 evidence document. The smoke counts
  positive
  `G1 ... E` only after exact `;BEFORE_LAYER_CHANGE`; prelude/purge extrusion
  is not model-layer proof.
- Preserve stable Orca runtime `layer_gcode=''` and
  `use_relative_e_distances='1'` settings for relative-extrusion consistency
  with each selected repository child machine's exact
  `layer_change_gcode='G92 E0'` override. Keep the pinned upstream parent
  unchanged.
- Preserve machine/process loading through `--load-settings`, optional selected
  filament loading through `--load-filaments`, and digest coverage of
  normalized material plus selected filament JSON or explicit null. Never
  substitute a default profile when no material mapping/file exists; preserve
  null filament metadata, `material_used_g`, `hourly_rate`, and
  `stats.estimated_price_huf` so no automatic price is calculated. Direct grams
  are required for selected-profile Orca, but remain nullable for the current
  Prusa FDM profile and profile-less Orca; never derive mass from length.
- Keep P1S/H2D generic-Marlin candidates blocked from W8 live calibration until
  the complete approved Bambu machine/process/filament chain and the missing
  Orca-side measurements are available; this separate vendor lane does not
  block the repository-owned J1C reset and filament-CLI corrections.
  `H2D-PROFIL-TODO.md` records the gap.
- Correct physical envelopes do not qualify generic Marlin motion/time data.
  Nine numeric Bambu references plus the P1S-overheight boundary exist, but
  tight Orca calibration still requires the complete approved vendor chain.
- Keep H2D-QUOTE on both engines. It is not hardware-faithful H2D estimation or
  production H2D G-code; the plugin consumer depends on the Prusa route. Exact
  helper-image measurement A established Prusa `350 x 320 x 324.9 mm` and Orca
  `347.9 x 317.9 x 324.9 mm`. Prusa native X/Y beyond its declared quote bed
  remains `UNESTABLISHED`. Exact local final-admission B confirmed both tuples
  and their P1S counterparts; only the owner VPS matrix remains
  `PENDING_OWNER`.
- Public catalogue v2 is explicitly FDM-only and may include
  only profiles with a bound machine identity. Never represent the generic
  `120 x 120 x 150 mm` SLA fallback as a profile-derived printer envelope.
- Publish explicit physical/profile metadata as
  `declared_build_volume_dimensions_mm` with
  `declared_source_kind: profile-explicit`; admission uses only the precisely
  named inclusive `largest_passing_dimensions_inclusive_mm`. The unchanged
  generic `1 mm` `minimum_dimensions_inclusive_mm` is a compatibility floor.
- The owner-confirmed future SLA printer is the Elegoo Saturn 4 Ultra; do not
  guess its dimensions. Current Prusa `--export-sla`/SL1 handling cannot
  represent Elegoo `.goo`/`.ctb` artifacts or credible MSLA timing. A separate
  future wave must use owner Chitubox/Elegoo Satellite profiles. The bounded
  generic v2 selector/component/identity shape can add a truthful row with
  separate per-engine resolution; the current payload remains FDM-only.

## Related Env Keys
- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
- MAX_MATERIAL_USED_METERS
- MAX_MATERIAL_USED_GRAMS
- MAX_MATERIAL_USED_ML
- MAX_MODEL_DIMENSION_MM
- SLICE_STRICT_GCODE_METRICS
- PYTHON_EXECUTABLE
- VIRTUAL_ENV
