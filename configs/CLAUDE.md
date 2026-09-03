# Configs Folder - Local Claude Guide

Last synchronized: 2026-09-03

## Scope

This folder contains runtime configuration files used by slicing and pricing:
the Prusa INI profiles, the Orca JSON profiles with their pinned upstream
parents and filament profiles, the Bambu printer registry, the SLA (Elegoo
Saturn 4 Ultra) printer registry, and the pricing state.

## Files

- configs/pricing-state/pricing.json
  - Active pricing matrix for FDM and SLA materials, persisted atomically
    (exclusive temp, fsync, rename) by app/services/pricing/repository.js.
  - The file is authoritative: `DEFAULT_PRICING` in
    `app/config/constants.js` seeds only a missing or empty file, defaults are
    never merged back in, and a deleted material never resurrects on restart.
    A safe legacy `configs/pricing.json` is migrated on startup.

- configs/pricing.example.json
  - Template for a first `configs/pricing.json`.

- configs/prusa/*.ini
  - `FDM_0.1mm.ini`, `FDM_0.2mm.ini`, `FDM_0.3mm.ini` declare the P1S
    `256 x 256 x 250 mm` envelope (generic Marlin profile); the admission
    ceiling is `256 x 256 x 249.9`.
  - `FDM_P1S_H2D_SIZE_QUOTING_0.{1,2,3}mm.ini` declare `350 x 320 x 325 mm`
    with the same P1S physics, quote-only; admission `350 x 320 x 324.9`.
  - `SLA_0.025mm.ini` and `SLA_0.05mm.ini` declare the Elegoo Saturn 4 Ultra
    `218.88 x 122.88 x 220 mm` bed and produce `.sl1`; the SL1 raster output
    remains quote-only (a real print needs an external UVtools conversion to
    the vendor `.goo`/`.ctb` format), but the quote itself now prices
    automatically from a real parsed resin mass.
  - Every FDM INI carries per-material `filament_density` and uses the
    `temperature` / `first_layer_temperature` / `bed_temperature` keys (never
    `nozzle_temperature`). Bed shape and height must not vary by layer height.

- configs/orca/*.json
  - `Bambu_P1S_0.4_nozzle.json` (default machine, generic Marlin identity,
    admission `253.9 x 253.9 x 249.9`), `Bambu_H2D_0.4_nozzle.json`
    (historical placeholder), `Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json`
    (quote-only, admission `347.9 x 317.9 x 324.9`), and process
    `FDM_0.{1,2,3}mm.json`.
  - Each repository child machine owns exact `layer_change_gcode='G92 E0'`;
    runtime derivation clears `layer_gcode` and sets
    `use_relative_e_distances='1'`.

- configs/orca/filament/*.json
  - Allowlisted material-selected Orca filament profiles: PLA 1.24, PETG 1.27,
    ABS 1.04, TPU 1.24 g/cm3, all 1.75 mm, read from the exact job snapshot.
    All four FDM materials therefore price automatically on Orca.

- configs/orca/upstream/Custom/**/*.json
  - Versioned runtime source for the OrcaSlicer v2.3.1 `Custom` parent chain
    (`fdm_machine_common`, `fdm_process_common`, `fdm_process_marlin_common`).
    `scripts/verify-orca-profile-vendor.js` requires byte equality with the
    pinned native resources at image build. Never edit them; override in the
    repository leaf profiles.

- configs/orca/H2D-PROFIL-TODO.md
  - Records the still-missing owner-approved vendor chain for the Orca engine.
    Superseded for quoting purposes by the Bambu engine, which uses the
    official vendor profiles directly.

- configs/bambu/printers.json
  - Schema `r3d-bambu-printer-registry-v1`, `default_printer: P1S`.
  - Maps `P1S` and `H2D` to the exact vendor machine name
    (`Bambu Lab P1S 0.4 nozzle`, `Bambu Lab H2D 0.4 nozzle`), `bed_type`
    (`Textured PEI Plate`), the layer-key -> vendor process map (P1S `0.08`,
    `0.1`, `0.12`, `0.16`, `0.2`, `0.24`, `0.28`; H2D `0.08`, `0.1`, `0.12`,
    `0.16`, `0.2`, `0.24`; `0.1` reuses the 0.12 mm process with the layer
    height overridden), and the material -> filament map (`Generic PLA`,
    `Generic PETG`, `Generic ABS`, `Generic TPU`, `@BBL H2D` variants on the H2D).
  - Names are resolved against the vendor resources flattened from
    `/opt/bambustudio/resources/profiles/BBL` (or absolute
    `BAMBU_PROFILES_ROOT`) by app/services/slice/bambu-profile-chain.js. An
    invalid registry or an unresolvable chain refuses startup
    (`STARTUP_BAMBU_REGISTRY_INVALID`, `STARTUP_BAMBU_PROFILE_CHAIN_FAILED`);
    readiness probes this directory.
  - The measured Bambu admission ceilings live in `app/config/constants.js`
    (`BAMBU_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM`: P1S `256 x 228 x 250`,
    alternative footprint `238 x 256`; H2D `325 x 320 x 325`), keyed by the
    vendor machine name. The bed shape itself (printable area, first-extruder
    area, `bed_exclude_area`) is read from the flattened vendor machine.

- configs/sla/printers.json
  - Schema `r3d-sla-printer-registry-v1`, `default_printer: SATURN4U`.
  - `SATURN4U` (Elegoo Saturn 4 Ultra, MSLA) declares
    `declared_build_volume_mm: 218.88 x 122.88 x 220`, `quote_raster_pixels`
    (768 x 432, disclosure-only and not the real LCD resolution), the
    owner-tunable `time_model` (`sla-layer-time-v1`: bottom/transition layer
    counts, per-layer and per-bottom-layer motion seconds, exposure seconds by
    exact layer-height key, bottom exposure seconds), and `resins` (`Standard`
    1.10, `ABS-Like` 1.10, `Flexible` 1.05 g/cm3).
  - Resin keys match the pricing catalogue's SLA material keys
    case-insensitively; `app/services/slice/sla-printer-registry.js` loads and
    validates the registry strictly at startup (`STARTUP_SLA_REGISTRY_INVALID`
    on any structural drift) and exposes it to `model-stats.js` (resin
    density), `sla-time-model.js` (the layer-time model), and `response.js`
    (`profiles.sla_printer`, `profiles.resin_density_g_cm3`).
  - The declared build volume is also `MAX_BUILD_VOLUMES.SLA` in
    `app/config/constants.js`; the admission ceiling
    (`SLA_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM`, currently the same
    `218.88 x 122.88 x 220` triple) is PROVISIONAL until a native envelope
    sweep measures the Saturn 4 Ultra's real edge-of-bed admission the way the
    P1S and H2D-QUOTE tables were measured.

## Safety Constraints

- Keep this folder at repository root (not under app/).
- Do not rename existing profile or registry files without updating profile
  resolution logic.
- Keep Prusa INI section/key case intact. Exact duplicate qualified keys fail
  closed like the native Boost parser; do not use duplicates as override order.
- Selected profiles, allowlisted Orca parents, and Bambu vendor files must
  remain canonical regular files. Runtime bounded-reads exact Prusa bytes or
  resolves/flattens the Orca and Bambu chains into job scratch before
  bounds/runtime/digest/native use; symlink/non-canonical sources, detected
  growth, unknown/cyclic/name-mismatched/wrong-role parents fail closed.
- Do not edit the vendored Orca parents independently or add runtime root
  selection. A native-version upgrade must update the pinned binary, versioned
  copies, Docker semantic-equality gate, and focused parent-identity contracts
  together. A Bambu Studio upgrade must update the AppImage URL/SHA-256, the
  registry names if the vendor renamed presets, and re-measure the envelopes.
- Keep filament profiles canonical bounded regular JSON. Their material role,
  exact one positive diameter, and exact one positive density must match the
  request; do not substitute a default when no mapping/file exists.
- `Bambu_P1S_0.4_nozzle.json` and `Bambu_H2D_0.4_nozzle.json` remain generic
  Marlin profiles, not vendor-faithful Bambu profiles. Orca 2.3.1 with the
  bundled BBL profiles deviates by up to +24 % from Bambu Studio and has no
  H2D; the Bambu engine is the quoting authority for Bambu Lab printers.
- Keep the H2D-sized quoting profiles explicit on both generic-Marlin engines.
  They estimate with P1S physics, are not hardware-faithful H2D profiles, and
  must never be represented as production H2D G-code. Real H2D quotes and
  printer-ready `.gcode.3mf` come only from `POST /bambu/slice`.
- Treat declared build envelopes as physical fit metadata only. Admission uses
  the configured per-engine `largest_passing_dimensions_inclusive_mm`, which
  `GET /profiles` publishes separately from `declared_build_volume_dimensions_mm`.
- Preserve pricing schema shape:
  - FDM: material -> number (HUF per hour)
  - SLA: material -> number (HUF per hour; prices automatically from the
    resin mass derived from the parsed SL1 volume and resin density)

## Related Runtime Keys

- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
- BAMBU_PROFILES_ROOT
- MAX_SL1_ENTRIES
- MAX_MATERIAL_USED_METERS
- MAX_MATERIAL_USED_GRAMS
- MAX_MATERIAL_USED_ML
- MAX_MODEL_DIMENSION_MM
- SLICE_STRICT_GCODE_METRICS
- PYTHON_EXECUTABLE
- VIRTUAL_ENV

## Notes
- Prusa runtime profiles are generated dynamically from base INI files and
  request options (layer height, infill, supports).
- Orca and Bambu runtime process profiles are generated dynamically from the
  flattened base profiles and request options; the Bambu runtime process
  overrides the layer height and `enable_support`.
- Orca loads machine/process through `--load-settings` and a selected filament
  separately through `--load-filaments`; Bambu loads the flattened vendor
  machine/process/filament snapshots and adds `--curr-bed-type`.
- A missing/unsupported Orca filament profile remains explicit null and
  changes the effective-profile digest; public filament basename/diameter/
  density, `material_used_g`, `hourly_rate`, and `stats.estimated_price_huf`
  are null, so the API does not calculate an automatic price. A Bambu
  material without a registry mapping is HTTP 400 `MATERIAL_PROFILE_UNAVAILABLE`.
- Strict FDM metric parsing defaults on and returns `SLICE_OUTPUT_UNPARSED` on
  required positive time/length drift. Direct grams are required for Orca and
  Bambu with a selected filament profile and nullable on the Prusa path; mass
  is never zero-filled or derived from length.
- Profile overrides from requests are filename-only and sanitized before
  lookup; Bambu `processProfile` is matched against the registry's vendor
  process names instead.
- Public profile fields and bounds `source_profile` retain the original
  selected basename (Prusa INI, Orca machine JSON) or the vendor machine name
  (Bambu) rather than the randomized snapshot name.
- Catalogue v2 has 88 rows: 82 FDM rows (6 Prusa, 24 Orca, 28 Bambu P1S, 24
  Bambu H2D) plus 6 Elegoo Saturn 4 Ultra SLA rows on `prusa` (2 layer heights
  x 3 resins). Never label a fallback-only, non-explicit-metadata profile as a
  machine envelope. The Saturn 4 Ultra's admission ceiling mirrors its
  declared bed/height metadata and is explicitly PROVISIONAL until a native
  envelope sweep measures it, unlike the owner-measured P1S/H2D-QUOTE/Bambu
  ceilings.
