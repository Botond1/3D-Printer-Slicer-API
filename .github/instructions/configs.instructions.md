---
applyTo: "configs/**"
---

# Configs Folder Instructions

Last synchronized: 2026-08-25

## Scope
- pricing.json is runtime pricing source of truth.
- pricing.example.json is the template.
- prusa/*.ini and orca/*.json define slicing profiles.
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
  and corrected validation-image HTTP transform/final-dimensions E2E pass; the
  final rebuilt image identity is not yet recorded. The smoke counts positive
  `G1 ... E` only after exact `;BEFORE_LAYER_CHANGE`; prelude/purge extrusion
  is not model-layer proof.
- Preserve stable Orca runtime `layer_gcode=''` and
  `use_relative_e_distances='1'` settings for relative-extrusion consistency
  with the flattened pinned machine parent's per-layer `G92 E0` reset.

## Related Env Keys
- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
- PYTHON_EXECUTABLE
- VIRTUAL_ENV
