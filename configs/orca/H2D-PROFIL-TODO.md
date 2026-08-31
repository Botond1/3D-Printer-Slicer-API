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

The enlarged values are not yet measured on the exact J3B candidate image.
Current searchable status is `PENDING_LOCAL_EXACT_IMAGE_SWEEP`, with provisional
seeds only:

| Engine | Provisional X (mm) | Provisional Y (mm) | Provisional Z (mm) |
| --- | ---: | ---: | ---: |
| Prusa | 350 | 320 | 324.9 |
| Orca | 347.9 | 317.9 | 324.9 |

The exact candidate-image sweep must confirm or replace every value. If the
largest passing ceiling is lower, publish the measured lower value; never round
up to the declared bed. The owner reruns the container matrix afterward. Until
then no H2D-QUOTE exact-image or VPS result is claimed.

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
