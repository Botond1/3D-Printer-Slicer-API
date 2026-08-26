# J1C slice-contract corrective

Date: 2026-08-26

Classification:
`J1C_ZERO_MASS_GUARD_OWNER_SUPPLIED_VPS_PASS;
J1C_ORCA_CORRECTION_LOCAL_FOCUSED_69_OF_69_PASS;
J1C_ORCA_MECHANISM_OWNER_SUPPLIED_VPS_PASS;
J1C_FINAL_COMBINED_IMAGE_RERUN_PENDING;
J1C_CAPABILITY_READINESS_PROPOSAL_ONLY; NO_VENDOR_IMPORT; NO_DEPLOY`.

This evidence record covers the J1C corrective branch
`codex/j1c-slice-contract-corrective`, based on J1 head
`4cbb5faecce5bb5ab2eedb56d55bcf69e5954a31`. The 2026-08-26 prompt addendum
supersedes the earlier vendor-blocked interpretation: the production guard and
Orca defects do not require vendor-profile integration. The incomplete vendor
chain remains a separate calibration/time/geometry lane.

This record distinguishes owner-supplied VPS diagnostic evidence from
repository-local verification. The exact final candidate image containing the
guard correction and both Orca corrections has not yet been rerun. Nothing in
J1C grants registry write, deployment, VPS mutation, public-route activation,
Docker prune, force-push, or consumer-repository authority.

## Corrected production slice contract

### Profile-less recognized zero

Strict G-code parsing keeps positive print time and filament length mandatory.
When direct grams are optional, as for the current Prusa FDM path and
profile-less Orca, a missing or recognized non-positive grams marker is not
published as zero. `material_used_g`, its source, the hourly rate, and the
estimated price remain `null` for manual pricing.

When a selected Orca filament profile requires grams, missing, drifted, or
non-positive direct mass still fails closed. Recognized zero remains
`GCODE_FILAMENT_NOT_POSITIVE`, mapped to bounded HTTP 500
`SLICE_OUTPUT_UNPARSED`. J1C does not derive mass from length or density and
does not weaken the marker-drift negative control.

### Orca filament CLI binding

The production command builder now separates the native profile roles:

```text
--load-settings machine;process
--load-filaments filament
--arrange 1 --orient 0 --slice 0
```

`--load-filaments` is emitted only when a selected filament snapshot exists.
The filament path is never appended to `--load-settings`; profile-less Orca
omits the dedicated option entirely. The request-independent invocation policy
records both the machine/process order and the dedicated filament option, so
the effective-profile digest binds the corrected native contract.

### Orca relative-extrusion reset

The repository-owned P1S and H2D child machine profiles now each own the exact
field:

```json
"layer_change_gcode": "G92 E0"
```

The Orca key is `layer_change_gcode`; the PrusaSlicer-style `layer_gcode` key is
not a substitute for this native validation contract. Runtime process
derivation still owns its separate empty `layer_gcode` and relative-extrusion
settings. The pinned files under `configs/orca/upstream/Custom/` remain
unchanged and continue to be protected by the Docker semantic-equality gate.

The child-profile field and invocation policy are digest-covered. Existing
Orca effective-profile digests therefore do not qualify the corrected
candidate; Prusa profile identity is unaffected by these two Orca changes.

## Owner-supplied VPS diagnostic evidence

The owner reported a production-identical, isolated VPS run of the guard-only
diagnostic image. `POST /prusa/slice` returned HTTP 200 with:

```text
material_used_m: 1.35969
material_used_g: null
material_used_g_source: null
estimated_price_huf: null
hourly_rate: null
engine_version: 2.8.1+linux-x64-GTK3-202409181416
effective_profile_sha256: lowercase 64-hex
```

This proves the guard mechanism under the owner's diagnostic container. It is
not evidence for the later combined candidate containing both Orca changes.

The owner also reported a direct Orca mechanism comparison using the same
model and repository filament profile:

| Native binding | Density | Filament identity | Direct mass |
| --- | ---: | --- | ---: |
| filament appended to `--load-settings` | 0 | empty | 0.00 g |
| filament passed through `--load-filaments` | 1.24 | populated | 4.12 g |

Adding exact `layer_change_gcode = G92 E0` to the repository-owned generic
machine profile also allowed Orca to produce `plate_1.gcode`. These are
owner-supplied diagnostic/mechanism results, not a repository-executed final
HTTP acceptance run.

## Repository-local focused verification

The current combined working tree passed the parser, production command,
profile inheritance/digest, pinned-parent, and Orca smoke contract set:

```text
node --test \
  tests/unit/js/sz-b2-gcode-metrics.test.js \
  tests/unit/js/j1-strict-model-stats.test.js \
  tests/unit/js/s1c-native-command-contracts.test.js \
  tests/unit/js/j0-engine-identity.test.js \
  tests/unit/js/j0-orca-profile-digest.test.js \
  tests/unit/js/j0-orca-profile-inheritance.test.js \
  tests/unit/js/j0-profile-snapshot.test.js \
  tests/unit/js/s3a-orca-runtime-smoke-workflow.test.js \
  tests/unit/js/j0-orca-profile-vendor-contract.test.js

tests 69
suites 2
pass 69
fail 0
cancelled 0
skipped 0
todo 0
```

The suite includes paired positive/negative controls for the observed
positive-length/recognized-zero G-code, exact literal Orca argv, absence of
`--load-filaments` without a selected profile, rejection of filament bytes in
the settings list, both raw child machine fields, flattened inheritance,
effective-digest mutation, pinned-parent equality, and removal or weakening of
the smoke reset guard.

The current combined candidate also passes the complete local aggregate:

```text
JavaScript: 2213/2213 pass
Python: 85 run; 84 pass; 1 expected Windows POSIX-permission skip
```

The final candidate also passes syntax over 251 tracked JavaScript and 39
tracked Python files, the production dependency audit with zero findings,
repository safety over 420 tracked indexed files, and repository safety over
the exact 26-file staged index. `git diff --cached --check` is clean, and the
bounded staged privacy scan found zero private source paths, workspace names,
or lead/order-like identifiers. Exact-image/container and hosted evidence
remain pending because the local Docker daemon is unavailable.

## Vendor and calibration boundary

No vendor profile was copied. The bounded audit of the supplied 11-file set
remains useful, but its missing include templates, H2D-compatible and 0.1/0.3
process coverage, filament parent chains, and exact Orca 2.3.1 qualification
make it unsuitable for partial integration. The owner has authorized later
public-repository inclusion; technical completeness remains the gate.

This incomplete chain does not block the J1C guard or production Orca command/
reset corrections. It remains relevant to Bambu-faithful motion and time
calibration. The P1S/H2D bed-shape and Z correction also remains a separate J2
lane: P1S 256 x 256 x 250 mm and H2D 350 x 320 x 325 mm are not implemented by
J1C.

`scripts/sz-b2-orca-calibration.js` independently embeds the superseded
machine/process/filament `--load-settings` composition. That privacy-safe
calibration helper is outside the production `engine.js` correction, was not
changed here, and is not requalified. W8 calibration must not run as accepted
evidence until that separate helper path is corrected and retested.

## Capability-readiness proposal only

No readiness implementation was added in J1C.

- Public `GET /health` remains cheap liveness.
- Public `GET /ready` remains the required home for future native slicing-
  capability state.
- A startup gate needs at least one Prusa and one selected-filament Orca native
  probe, contained fixtures and cleanup, cache/state/admission integration, and
  exact-image evidence.
- Docker still checks `/health`, while Traefik already consumes `/ready`; a
  future capability-driven `/ready` 503 can withhold routing without making the
  Docker container unhealthy.
- Rolling degradation must use typed per-engine capability failures, a
  synthetic control probe, anti-DoS semantics, and bounded recovery/hysteresis.
  Raw last-N HTTP 5xx must not control readiness.

Any readiness implementation is a separate authorized wave.

## What remains NOT VERIFIED

- The exact final candidate image containing the guard correction,
  `--load-filaments`, and both child-profile reset fields has not been built or
  rerun by the repository executor.
- Final HTTP `POST /orca/slice` success with positive direct grams and pricing
  on that combined image remains pending owner rerun.
- Hosted exact-SHA Source/Image gates remain pending.
- The separate calibration helper's native filament binding remains
  superseded and unqualified.
- Bambu-faithful vendor inheritance, motion/time behavior, J2 bed shape/Z,
  ten-model calibration, and Bambu Studio agreement remain unverified.
- Startup capability smoke and rolling degradation/recovery are neither
  implemented nor tested.
- Image publication, deployment, public routing, customer traffic, and consumer
  acceptance remain `NOT VERIFIED` and unauthorized by J1C.
