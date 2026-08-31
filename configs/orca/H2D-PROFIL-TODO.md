# H2D vendor profile remains future; J3B H2D-QUOTE is not that profile

## Current J3B quoting decision

The owner decided on 2026-08-31 that H2D-sized quoting must exist on both
engines without claiming an H2D machine profile. J3B therefore derives the
quote chain from the working P1S physics and enlarges only the declared bed to
`350 x 320 x 325 mm`.

Repository quote profiles:

- Prusa: `FDM_P1S_H2D_SIZE_QUOTING_0.1mm.ini`,
  `FDM_P1S_H2D_SIZE_QUOTING_0.2mm.ini`, and
  `FDM_P1S_H2D_SIZE_QUOTING_0.3mm.ini`.
- Orca: `Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json` plus the existing P1S
  process/filament chain.

The public printer identity is `H2D-QUOTE`, not H2D. These profiles are for
quoting only. They are not machine-accurate H2D physics, are not a production
H2D G-code contract, and must not be used to qualify H2D firmware, motion,
print time, mass, or hardware safety. The plugin consumer calls only
`POST /prusa/slice`, so the Prusa enlargement is required even though both
engines remain in the repository contract.

## Native-envelope evidence boundary

Catalogue v2 publishes physical/profile-declared
`declared_build_volume_dimensions_mm` separately from the exact-boundary-
inclusive admission authority `largest_passing_dimensions_inclusive_mm`.

Exact-image measurement A used helper source
`2f4cddab923863ee8a9231e26671ddd2e70444eb` and image ID
`sha256:f2259f29fb1472ba695c90f664af0fe0b9a298b89f5139667a0ec8a274406fae`.
All 44 fixture preconditions, 10 brackets, and 2 repeated combined corners
passed:

| Engine | Measured inclusive X (mm) | Measured inclusive Y (mm) | Measured inclusive Z (mm) |
| --- | ---: | ---: | ---: |
| Prusa | 350 | 320 | 324.9 |
| Orca | 347.9 | 317.9 | 324.9 |

At layer height `0.3 mm`, `325 mm` returned the complete K2 HTTP 422 twice on
each engine after the exact conjunctive last-layer classifier. Prusa's native
X/Y edge beyond its declared profile remains `UNESTABLISHED`; measurement A
does not extend the declared bed.

Exact local final-admission B used code-bearing source
`47ae13397bb4537b4bb700b8c6bf3d9648364bdc` and image ID
`sha256:1f8ec16318eeda4b8f2e24a54e98e972ef22344126b324123f23f220916617a0`.
Its matching revision label, non-root `999:999` identity, healthy state,
read-only root, and host port bound only to localhost were verified. All 88 fixture
preconditions, 20 brackets, and 4 combined corners passed, confirming the same
Prusa `350 x 320 x 324.9 mm` and Orca `347.9 x 317.9 x 324.9 mm` inclusive
tuples. The generated A and B reports stay local and uncommitted.

The owner later passed the production-identical VPS matrix from exact tree
`db42b93b2416ac0b791a45a0eae1233b303cf557` after independently matching all
445 tracked files. The owner image ID differs from local B, so this is source-
tree rather than byte-identical-image proof. Orca H2D-QUOTE passed
`347.9 x 317.9 mm`, rejected the tested `348.0 mm` edge and `350 x 320 mm`, and
Prusa H2D-QUOTE passed `350 x 320 mm`; `324.9 mm` Z passed on both engines.
All three Prusa layer-height profiles carry the enlargement. Prusa native X/Y
beyond its declared quote bed remains `UNESTABLISHED`.

## Existing generic machine-profile limitation

`Bambu_P1S_0.4_nozzle.json` is named like a Bambu Lab P1S profile, but its
effective identity is generic Marlin rather than vendor P1S motion. The earlier
`Bambu_H2D_0.4_nozzle.json` placeholder has the same limitation and is not the
J3B quote chain. Exact `layer_change_gcode='G92 E0'` and the physical bed shape
do not make either file vendor-faithful.

These generic chains can support bounded development and quote-path checks,
but cannot establish Bambu-faithful time or automatic-pricing calibration.
Owner-approved P1S admission remains Prusa `256 x 256 x 249.9 mm` and Orca
`253.9 x 253.9 x 249.9 mm`; Prusa's native X/Y edge beyond its declared profile
remains `UNESTABLISHED`.

## Future owner-controlled vendor input

A real H2D production profile still requires the complete OrcaSlicer
2.3.1-qualified machine/process/filament chain, including every inherited
profile, plus hardware-qualified evidence. Partial chains must not be imported,
and missing values must not be invented or tuned in this repository.

When a complete vendor chain is later authorized, its effective profile digest
will change by design and every earlier calibration bound to the old digest
will become invalid. The anonymized numeric calibration matrix and independent
P1S boundary must be rerun before automatic pricing acceptance.

That future calibration lane remains
`BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER`. It does not block J3B's bounded
H2D-sized quote contract, and J3B does not authorize registry publication,
deploy, public-route mutation, customer traffic, or consumer-repository work.
