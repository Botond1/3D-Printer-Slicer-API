# Orca Bambu machine profiles: owner input required before W8

## Verified repository limitation

The repository file `Bambu_P1S_0.4_nozzle.json` is named like a Bambu Lab P1S
profile, but its effective identity is a generic Marlin machine:

```json
{
  "name": "MyMarlin 0.4 nozzle",
  "printer_model": "Generic Marlin Printer",
  "gcode_flavor": "marlin"
}
```

Its J2 physical build envelope is configured as 256 x 256 x 250 mm. It is not
the vendor P1S motion profile. This may leave material mass approximately
useful, but estimated time depends strongly on machine speed and acceleration
limits. An Orca-versus-Bambu Studio calibration against this file therefore
does not qualify the real P1S profile.

`Bambu_H2D_0.4_nozzle.json` has the same deliberate limitation. Its J2
physical build envelope is 350 x 320 x 325 mm with a 0.4 mm nozzle, but it is
still a generic Marlin profile. The filename must not be interpreted as proof
of Bambu motion, firmware, or vendor-profile equivalence.

Both repository-owned generic child profiles now intentionally own exact
`layer_change_gcode='G92 E0'`. That narrow Orca relative-extrusion correction
does not convert either file into a vendor profile. J2 supplies the physical
fit envelope only; it does not qualify vendor motion, time, firmware, or
pricing equivalence.

## Required owner-controlled input

The owner authorized later public-repository inclusion on 2026-08-26. Before
the W8 production calibration can run, the complete OrcaSlicer 2.3.1-qualified
machine/process/filament chain for the intended P1S and H2D combinations must
still be available,
including every inherited/include profile. Partial chains must not be imported,
and the executor must not invent or tune missing values.

This technical completeness gate is the remaining time/motion calibration
lane. It does not block J1C's production `--load-filaments` binding, the two
repository-child `layer_change_gcode` corrections, or J2's physical fit
envelopes.

After replacement, the effective profile digest changes by design. Every
calibration entry bound to the former
`profiles.effective_profile_sha256` becomes invalid. The nine numerically
measurable anonymized models must be rerun and `M03` must independently remain
a clean P1S-boundary rejection before automated pricing is accepted.

The Bambu Studio side currently has nine numeric reference rows plus the `M03`
boundary result. The Orca side remains
`BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER`: the owner-approved complete profile
chains are absent and the local Docker daemon was unavailable at this
checkpoint. The generic profiles are suitable only for bounded development
checks, not W8 production calibration or Bambu-faithful time qualification.
