# J1 / SZ-B2 Orca runtime and calibration contract

This document records the curated J1 behavior layered onto the verified J0
runtime. It is a source contract, not deployment or live-calibration evidence.

## Authentication and admission remain J0-owned

`POST /orca/slice` and `POST /prusa/slice` accept slice credentials only in
`x-slicer-api-key`. J0's scoped service-auth configuration remains authoritative:
startup refuses malformed, missing, duplicate, partial-mode, or expired key
sets. The route order remains limiter → service authentication → job lifecycle
and workspace → multipart → queue → native processing.

J1 adds no legacy `SLICE_API_KEY`, `x-api-key` slice fallback, unauthenticated
slice path, or runtime 503 mode. Pricing, artifact, and operations credentials
remain separate and are not exposed to the native slicer process.

## Native invocation and child environment

J0's request-independent Orca policy is preserved:

```text
--load-settings machine;process
--load-filaments filament
--arrange 1 --orient 0 --slice 0
```

The dedicated filament option is omitted when the selected material has no
repository profile. A filament snapshot must never be appended to
`--load-settings`, because Orca silently ignores that role there. `--arrange 1`
places the already
preprocessed geometry on the bed. `--orient 0` prevents the native slicer from
silently replacing the request-owned rotation.

The existing minimal child-environment module is unchanged by J1. It forwards
only the bounded platform allowlist plus safe Python flags and controlled
temporary/home directories. Application credentials and pricing configuration
are not inherited.

## Strict, billing-safe G-code metrics

FDM output is parsed by `app/services/slice/gcode-metrics.js`. The strict path
requires known positive print-time and filament-length markers. OpenAPI requires
`stats.material_used_g`, but the field is nullable: a non-null value must come
from a direct G-code mass marker and is never calculated from length or density.
J1C supersedes the earlier claim that the affected Prusa FDM output had no
direct marker: container diagnosis found a recognized `0.00 g` marker. When
grams are optional, a missing or recognized non-positive marker returns
`material_used_g:null`, `hourly_rate:null`, and
`stats.estimated_price_huf:null` for manual pricing; it never substitutes zero.

Orca with a selected repository filament profile additionally requires a known
positive direct mass marker. Multiple extruder gram values are summed. Missing,
malformed, ambiguous, or non-positive required Orca mass becomes bounded
`500 SLICE_OUTPUT_UNPARSED`; recognized zero is specifically
`GCODE_FILAMENT_NOT_POSITIVE`. Above-policy mass is also refused. Profile-less
Orca accepts missing or recognized non-positive mass only as null and remains on
the manual-pricing path.

`SLICE_STRICT_GCODE_METRICS=true` is the default when the variable is omitted.
The explicit value `false` exists only as a bounded drift-diagnosis switch and
must not be used for qualification or normal service operation.

Successful FDM responses preserve positive `stats.material_used_m` and always
include nullable `stats.material_used_g`. Any non-null grams value is the direct
G-code marker. Internal source identifiers make parser fallback or format drift
visible without changing the public nullable contract.

Focused regression coverage:

- known Orca and Prusa time/length markers and direct-mass variants;
- current Prusa missing/recognized-zero success with null mass/rate/price;
- selected-profile Orca missing/recognized-zero failure and profile-less Orca
  null/manual;
- multiple-extruder summation;
- malformed and drifted markers;
- strict default when the environment variable is absent;
- the legacy-tolerant negative control, proving that strict mode closes the
  former silent-zero behavior.

## Filament selection and exact identity

J1 maps supported normalized Orca materials to repository profiles:

| Material | Profile | Diameter | Density |
|---|---|---:|---:|
| PLA | `filament/PLA_generic.json` | 1,75 mm | 1,24 g/cm³ |
| PETG | `filament/PETG_generic.json` | 1,75 mm | 1,27 g/cm³ |

The selected filament file is snapshotted into the job-owned workspace before
digest construction or native invocation. Machine and process load through
`--load-settings`; the selected filament loads through `--load-filaments`. The
success response reports the original stable
basename in `profiles.filament_profile`, plus the exact used
`profiles.filament_diameter_mm` and `profiles.filament_density_g_cm3` values.

The effective identity remains `profiles.effective_profile_sha256`. Its
canonical payload covers the resolved machine and process settings, the raw
selected filament profile (or `null`), normalized material, and the stable
request-independent native invocation policy. Request identity and filesystem
paths are excluded. The digest therefore changes when the filament profile or
material changes, and it also differs between a selected profile and `null`.

An unmapped material deliberately has:

```json
{
  "filament_profile": null,
  "filament_diameter_mm": null,
  "filament_density_g_cm3": null
}
```

Slicing may still complete, but its distinct digest has no calibrated entry.
The API therefore emits `hourly_rate: null` and
`stats.estimated_price_huf: null`; it does not calculate an automatic price.
The consumer must keep the result on the manual-pricing path rather than
substituting a default filament identity or rate.

## Engine identity

`engine_version` comes from the actual native executable. Both slicer binaries
are queried and validated before the HTTP listener starts; missing, malformed,
or conflicting version output refuses startup. J1 does not add environment-
reported version fields or a hard-coded fallback.

Calibration entries must bind both `engine_version` and
`profiles.effective_profile_sha256`. Either changing invalidates the previous
measurement.

## Repository machine correction and separate W8 blocker

The existing `Bambu_P1S_0.4_nozzle.json` and the newly harvested
`Bambu_H2D_0.4_nozzle.json` are generic Marlin profiles. Their names and build
volumes do not establish Bambu vendor motion behavior. Their exact child-owned
`layer_change_gcode='G92 E0'` field is sufficient for the repository relative-
extrusion contract, but time calibration against real Bambu Studio cannot be
qualified with these generic motion profiles.

A bounded vendor-input audit parsed all 11 supplied JSON files, matched all 11
declared hashes, and derived candidate volumes P1S 256 x 256 x 250 mm and H2D
350 x 320 x 325 mm. The set is not self-contained: 11 referenced include
templates, an H2D-compatible process, 0.1/0.3 BBL processes, vendor filament
profiles and parent chains, and exact OrcaSlicer 2.3.1 runtime qualification
are missing. The owner authorized later public-repository inclusion; technical
completeness remains the gate.

No vendor file, resolver, or build-volume constant was changed. Production
Orca now loads selected filament through `--load-filaments`, and both repository
child machine profiles own exact `layer_change_gcode='G92 E0'`. Owner-supplied
mechanism evidence produced 4.12 g instead of 0.00 g. The incomplete vendor
chain is not a J1C blocker; it keeps W8 time/motion calibration
`BLOCKED_OWNER_INPUT`. J2 separately owns P1S/H2D bed shape and Z. See
`configs/orca/H2D-PROFIL-TODO.md`.

## Capability-readiness proposal boundary

J1C adds no readiness code. `GET /health` remains cheap public liveness and
future slicing-capability state belongs on public `GET /ready`. A meaningful
startup gate needs at least Prusa and selected-filament Orca native probes,
contained scratch/process cleanup, readiness cache/state and admission
integration, and Docker/VPS evidence. Docker continues to check `/health`;
Traefik already consumes `/ready`, so a future `/ready` 503 may withhold routing
without making Docker unhealthy. Rolling degradation needs typed per-engine
capability failures, anti-DoS rules, and bounded recovery/hysteresis; raw last-N
HTTP 5xx is unsafe. This is proposal-only and belongs to a separate wave.

## Privacy-safe calibration runner

`npm run sz-b2:calibrate` runs `scripts/sz-b2-orca-calibration.js`. Actual model
paths belong only in an owner-controlled, repository-external manifest. The
runner verifies the declared `M01`–`M10` SHA-256 identity before use and must
emit only anonymized model IDs and verified hashes as model identity in durable
output; measurement records must not expose a path or basename.

J2 routes the calibration invocation through the production `engine.js`
command builder. Machine/process profiles load through `--load-settings`, the
selected filament loads separately through `--load-filaments`, and the helper
still forces `--orient 0` plus support-off settings before digest and native
execution. This closes the J1C invocation drift, but missing owner-approved
vendor profiles and local Docker still block accepted Orca calibration evidence.

The owner path itself is never passed to Docker. After the source is inspected
and hash-verified, the runner creates one run-owned temporary staging directory
with mode `0700`, copies the bytes under the neutral name `input<extension>` with
mode `0600`, and re-verifies size plus SHA-256. Docker receives only that
anonymous staging copy as a read-only bind at `/models/input<extension>`. The
stage file and directory are bound at creation to their canonical path plus
filesystem device, inode, and birth-time identity. Cleanup rechecks regular
file/directory type and that exact identity before unlink/rmdir; a same-name
foreign file or root replacement is refused without deletion. Staging or
cleanup failure produces a stable code and cannot turn into a successful record.

Durable failure diagnostics are code-only: anonymous identity plus bounded
`phase` and stable error `code`. Raw native/Docker stdout, stderr, exception
text, paths, and basenames are not copied into a result or Markdown table. The
runner's own stderr progress contains only `M01`–`M10` and the verified hash.

Before any measurement, the supplied image reference is resolved to one exact
`sha256:<64 hex>` image ID; the container is launched by that ID. Every accepted
success record binds that `image_id`, the executable-derived `engine_version`,
`effective_profile_sha256`, `filament_profile`,
`filament_diameter_mm`, and `filament_density_g_cm3`. Missing or malformed
identity/metadata makes the container record invalid. The container remains
network-disabled, non-root, read-only, resource-bounded, and uses J0's
`--arrange 1 --orient 0` policy.

Container cleanup is deletion-authority bounded. Before `docker container rm`,
inspect must prove the exact generated container name, exact run label, fixed
calibration-purpose label, and exact image ID. Any foreign or malformed identity
refuses removal. After a successful removal, or when inspect reports the name
missing, an exact-name all-container listing must prove absence; control or
absence-proof failure makes cleanup fail closed.

The anonymized worksheet is `docs/kalibracio-2026-08.md`. No model path,
customer name, lead identifier, or order identifier belongs in repository
files, tests, evidence, or committed command history.

## Evidence boundary

Unit and source gates can prove parser failure behavior, filament argument
precedence, response fields, snapshot/digest continuity, and null-profile
degradation without customer models. They do not prove:

- the final vendor P1S or H2D profile;
- measurements for the ten private reference models;
- Bambu Studio agreement within ±10%;
- host memory sizing or production capacity;
- deployment, public route activation, or consumer acceptance.

Those remain separately authorized, owner-controlled evidence steps.
