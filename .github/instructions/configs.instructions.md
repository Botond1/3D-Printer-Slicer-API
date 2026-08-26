---
applyTo: "configs/**"
---

# Configs Folder Instructions

Last synchronized: 2026-08-26

## Scope
- pricing.json is runtime pricing source of truth.
- pricing.example.json is the template.
- prusa/*.ini and orca/*.json define slicing profiles.
- orca/filament/*.json are material-selected filament profiles whose exact
  positive diameter/density are exposed from the job snapshot.
- orca/upstream/Custom/**/*.json are the versioned runtime source for the pinned
  OrcaSlicer v2.3.1 `Custom` parent chain; Docker build requires canonical
  semantic equality with the exact native files.

## Rules
- Keep configs at repository root in configs/.
- Keep pricing schema shape intact for FDM and SLA objects.
- Do not rename profile files unless profile resolution logic is updated as well.
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
  with the flattened pinned machine parent's per-layer `G92 E0` reset.
- Preserve native settings order machine-process-filament and digest coverage of
  normalized material plus selected filament JSON or explicit null. Never
  substitute a default profile when no material mapping/file exists; preserve
  null filament metadata, `material_used_g`, `hourly_rate`, and
  `stats.estimated_price_huf` so no automatic price is calculated. Direct grams
  are required for selected-profile Orca, but remain nullable for the current
  Prusa FDM profile and profile-less Orca; never derive mass from length.
- Keep P1S/H2D generic-Marlin candidates blocked from W8 live calibration until
  owner-supplied real Bambu machine/process references and acceptance inputs are
  available; `H2D-PROFIL-TODO.md` records the gap.

## Related Env Keys
- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
- MAX_MATERIAL_USED_METERS
- MAX_MATERIAL_USED_GRAMS
- MAX_MATERIAL_USED_ML
- SLICE_STRICT_GCODE_METRICS
- PYTHON_EXECUTABLE
- VIRTUAL_ENV
