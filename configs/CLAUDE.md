# Configs Folder - Local Claude Guide

Last synchronized: 2026-08-31

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
  - All three shipped FDM profiles identify the P1S build envelope as
    `256 x 256 x 250 mm`; bed size must not vary with layer height.
  - The three `FDM_P1S_H2D_SIZE_QUOTING_*` profiles declare
    `350 x 320 x 325 mm` using the same P1S physics, for quoting only.

- configs/orca/*.json
  - Orca machine and process presets.
  - Machine and process compatibility must be respected.
  - The repository P1S and historical H2D placeholder children declare
    `256 x 256 x 250 mm` and `350 x 320 x 325 mm` respectively; these are
    profile metadata, not proof of the current native admission ceiling.
  - `Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json` preserves the compatible P1S
    preset chain on a `350 x 320 x 325 mm` declared bed, quote-only.

- configs/orca/filament/*.json
  - Allowlisted material-selected Orca filament profiles.
  - PLA uses diameter 1.75 mm and density 1.24 g/cm3; PETG uses 1.75 mm and
    1.27 g/cm3, read from the exact selected job snapshot.

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
- Keep filament profiles canonical bounded regular JSON. Their material role,
  exact one positive diameter, and exact one positive density must match the
  request; do not substitute a default when no mapping/file exists.
- `Bambu_P1S_0.4_nozzle.json` and `Bambu_H2D_0.4_nozzle.json` currently identify
  as generic Marlin profiles, not verified native Bambu profiles. Each child
  must own exact `layer_change_gcode='G92 E0'` for the repository's relative-
  extrusion Orca contract. Do not promote them to W8 live calibration without
  the complete approved machine/process/filament chain and the missing Orca-
  side measurements documented in `H2D-PROFIL-TODO.md`.
- Treat the corrected build envelopes as physical fit metadata only. They do
  not make either generic Marlin child a Bambu-faithful motion/time profile.
- Keep the H2D-sized quoting profiles explicit on both engines. They estimate
  with P1S physics, are not hardware-faithful H2D profiles, and must never be
  represented as production H2D G-code. The plugin consumer uses only the
  Prusa slice route, so the three Prusa quote profiles are required.
- Exact helper-image measurement A established H2D-QUOTE Prusa
  `350 x 320 x 324.9 mm` and Orca `347.9 x 317.9 x 324.9 mm`. Preserve those
  measured inclusive ceilings; Prusa's native X/Y edge beyond its declared
  quote bed remains `UNESTABLISHED`. Exact local final-admission B confirmed
  those tuples and the P1S values. The owner production-identical VPS matrix
  from exact tree `db42b93` independently confirmed every inclusive boundary
  and all three enlarged Prusa layer profiles. Its separately built image ID is
  not byte-identical-image evidence.
- Keep every shipped machine-bound FDM envelope compatible with the public
  startup `/profiles` catalogue. The application fallback remains a broad
  compatibility envelope, while the exact configured
  `largest_passing_dimensions_inclusive_mm` value is authoritative for upper
  admission.
- Preserve pricing schema shape:
  - FDM: material -> number
  - SLA: material -> number

## Related Runtime Keys

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

## Notes
- Prusa runtime profiles are generated dynamically from base ini files and request options.
- Orca runtime process profiles are generated dynamically from base json profiles and request options.
- Orca loads machine/process through `--load-settings` and a selected filament
  separately through `--load-filaments`; a null profile omits that option.
- A missing/unsupported filament profile remains explicit null and changes the
  effective-profile digest; public filament basename/diameter/density,
  `material_used_g`, `hourly_rate`, and `stats.estimated_price_huf` are null, so
  the API does not calculate an automatic price.
- Strict FDM metric parsing defaults on and returns `SLICE_OUTPUT_UNPARSED` on
  required positive time/length drift. Direct grams are nullable for the current
  Prusa FDM profile and profile-less Orca, but required for Orca with a selected
  filament profile; mass is never zero-filled or derived from length.
- Profile overrides from requests are filename-only and sanitized before lookup.
- Public profile fields and bounds `source_profile` retain the original selected
  basename rather than the randomized snapshot name.
- Catalogue v2 is explicitly FDM-only. Never label the generic
  `120 x 120 x 150 mm` SLA fallback as a profile-derived machine envelope.
- A catalogue row must separate
  `declared_build_volume_dimensions_mm` plus
  `declared_source_kind: profile-explicit` from the authoritative inclusive
  `largest_passing_dimensions_inclusive_mm`. The unchanged generic `1 mm`
  minimum is `minimum_dimensions_inclusive_mm`, a compatibility floor rather
  than machine metadata.
- The owner-confirmed future SLA printer is the Elegoo Saturn 4 Ultra. Do not
  guess its dimensions: current Prusa `--export-sla` and SL1 parsing cannot
  represent Elegoo `.goo`/`.ctb` artifacts or credible MSLA timing. A later
  wave must use owner Chitubox/Elegoo Satellite profiles. The generic bounded
  v2 selector/component/identity shape can add a truthful row with separate
  per-engine resolution; the current payload remains FDM-only.
- Orca JSON may name only an allowlisted v2.3.1 `Custom` parent. The resolver
  always reads the versioned repository copy, removes `inherits`, and snapshots
  flattened JSON before downstream use; unknown, cyclic, name-mismatched, or
  wrong-role parents fail closed. Stable runtime derivation clears `layer_gcode`
  and sets `use_relative_e_distances='1'`, aligned with the selected repository
  child's exact `layer_change_gcode='G92 E0'` override. The pinned upstream
  parent remains unchanged. The direct native smoke and final
  exact-image HTTP transform/final-dimensions E2E pass; the exact local code/
  image identity is recorded in the J0 evidence document. That smoke accepts
  positive
  `G1 ... E` only after the exact `;BEFORE_LAYER_CHANGE` marker, so prelude/
  purge extrusion does not count as model-layer proof.
