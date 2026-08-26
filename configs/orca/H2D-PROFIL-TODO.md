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

Its build volume is also configured as 250 x 250 x 250 mm. It is not the
vendor P1S motion profile. This may leave material mass approximately useful,
but estimated time depends strongly on machine speed and acceleration limits.
An Orca-versus-Bambu Studio calibration against this file therefore does not
qualify the real P1S profile.

`Bambu_H2D_0.4_nozzle.json` has the same deliberate limitation. It supplies a
325 x 320 x 325 mm build-volume envelope and a 0.4 mm nozzle, but it is still a
generic Marlin profile. The filename must not be interpreted as proof of Bambu
motion, firmware, or vendor-profile equivalence.

Both repository-owned generic child profiles now intentionally own exact
`layer_change_gcode='G92 E0'`. That narrow Orca relative-extrusion correction
does not convert either file into a vendor profile and does not implement the
separate J2 bed-shape/Z contract.

## Required owner-controlled input

The owner authorized later public-repository inclusion on 2026-08-26. Before
J0 W8 can run, the complete OrcaSlicer 2.3.1-qualified machine/process/filament
chain for the intended P1S and H2D combinations must still be available,
including every inherited/include profile. Partial chains must not be imported,
and the executor must not invent or tune missing values.

This technical completeness gate is a future calibration/time/geometry lane.
It does not block J1C's production `--load-filaments` binding or the two
repository-child `layer_change_gcode` corrections.

After replacement, the effective profile digest changes by design. Every
calibration entry bound to the former
`profiles.effective_profile_sha256` becomes invalid and all ten anonymized
reference models must be measured again before automated pricing is accepted.

Until the owner-controlled profile input and new measurements exist, this is
`BLOCKED_OWNER_INPUT`: the generic profiles are suitable only for bounded
development checks, not W8 production calibration or Bambu-faithful time
qualification.
