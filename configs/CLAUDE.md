# Configs Folder - Local Claude Guide

Last synchronized: 2026-08-25

## Scope

This folder contains runtime configuration files used by slicing and pricing.

## Files

- configs/pricing.json
  - Active pricing matrix for FDM and SLA materials.
  - Read and written by app/services/pricing.service.js.

- configs/pricing.example.json
  - Template used to initialize pricing.json when missing.

- configs/prusa/*.ini
  - Prusa profile presets by layer height.
  - Includes FDM and SLA presets.

- configs/orca/*.json
  - Orca machine and process presets.
  - Machine and process compatibility must be respected.

- configs/orca/upstream/Custom/**/*.json
  - Versioned runtime source for the OrcaSlicer v2.3.1 `Custom` parent chain.
  - Docker build requires canonical semantic equality with the exact pinned
    native resource files.

## Safety Constraints

- Keep this folder at repository root (not under app/).
- Do not rename existing profile files without updating profile resolution logic.
- Keep Prusa INI section/key case intact. Exact duplicate qualified keys fail
  closed like the native Boost parser; do not use duplicates as override order.
- Selected profiles and allowlisted Orca parents must remain canonical regular
  files. Runtime bounded-reads exact Prusa bytes or resolves/flattens the Orca
  v2.3.1 parent chain into job scratch before bounds/runtime/digest/native use;
  symlink/non-canonical sources and detected growth are rejected.
- Do not edit the vendored Orca parents independently or add runtime root
  selection. A native-version upgrade must update the pinned binary, versioned
  copies, Docker semantic-equality gate, and focused parent-identity contracts
  together.
- Preserve pricing schema shape:
  - FDM: material -> number
  - SLA: material -> number

## Related Runtime Keys

- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
- PYTHON_EXECUTABLE
- VIRTUAL_ENV

## Notes
- Prusa runtime profiles are generated dynamically from base ini files and request options.
- Orca runtime process profiles are generated dynamically from base json profiles and request options.
- Profile overrides from requests are filename-only and sanitized before lookup.
- Public profile fields and bounds `source_profile` retain the original selected
  basename rather than the randomized snapshot name.
- Orca JSON may name only an allowlisted v2.3.1 `Custom` parent. The resolver
  always reads the versioned repository copy, removes `inherits`, and snapshots
  flattened JSON before downstream use; unknown, cyclic, name-mismatched, or
  wrong-role parents fail closed. Stable runtime derivation clears `layer_gcode`
  and sets `use_relative_e_distances='1'`, aligned with the flattened pinned
  machine parent's per-layer `G92 E0` reset. The direct native smoke and
  corrected validation-image HTTP transform/final-dimensions E2E pass; the final
  rebuilt image identity is not yet recorded. That smoke accepts positive
  `G1 ... E` only after the exact `;BEFORE_LAYER_CHANGE` marker, so prelude/
  purge extrusion does not count as model-layer proof.
