# J0 W2/W3 response and slice-auth contract

Date: 2026-08-25

Classification:
`J0_W2_W3_FOCUSED_LOCAL_CONTRACTS_PASS; FINAL_AGGREGATE_PENDING;
NO_EXTERNAL_PRODUCTION_AUTHORITY; J0_ENGINE_HELP_EXACT_IMAGE_PASS;
J0_ORCA_PARENT_BUILD_EQUALITY_PASS;
J0_ARRANGE1_ORIENT0_EXACT_IMAGE_HTTP_E2E_PASS;
J0_FINAL_IMAGE_ID_PENDING_REBUILD;
J0_FILAMENT_W8_BLOCKED_OWNER_INPUT_NOT_STARTED`.

## Authority and boundary

This record covers only the local W2 response/OpenAPI delta and W3
slice-principal authentication delta. It contains no sensitive or environment-
specific values. External production activation is outside this repository
evidence and authority.

This record proves only the focused local effective-profile/Orca-parent,
engine-version, Orca command-policy, OpenAPI/runtime-error, required-bounds, and
slice-principal contracts. Closing the already-live
`MODEL_DIMENSIONS_UNAVAILABLE` schema gap and completing the live slice-500 enum
are adjacent OpenAPI review fixes.
Exact-candidate-image engine help/version proof and the corrected Orca HTTP E2E
also pass. The final image identity may change during the last source-only
rebuild, so no final image ID is recorded here.
Filament-profile identity plus `material_used_g` is a separate W8 prerequisite
classified `BLOCKED_OWNER_INPUT / NOT_STARTED` until the owner supplies the
required Bambu reference profile fields.

## W2 effective profile and response contract

- [`app/services/slice/orca-profile-inheritance.js`](../../../app/services/slice/orca-profile-inheritance.js)
  always resolves the [versioned repository copies](../../../configs/orca/upstream/README.md)
  of the exact allowlisted Orca v2.3.1 `Custom` machine/process parent chain,
  with bounded depth and fail-closed unknown, cyclic, name-mismatched, or wrong-
  role inheritance. The Docker build semantic-equality gate against the exact
  pinned `/opt` parents passes for the candidate image through
  [`scripts/verify-orca-profile-vendor.js`](../../../scripts/verify-orca-profile-vendor.js);
  runtime resolution never switches roots based on environment state.
- [`app/services/slice/profile-snapshot.js`](../../../app/services/slice/profile-snapshot.js)
  snapshots each selected profile after selection and before bounds or runtime
  derivation: exact selected bytes for Prusa, and flattened resolved JSON with
  `inherits` removed for Orca. The shared bounded reader requires regular non-
  symlink sources at canonical real paths, checks opened identity/size, and
  detects growth. Exclusive `0600` writes keep snapshots in owning job scratch.
- [`app/services/slice/pipeline.js`](../../../app/services/slice/pipeline.js)
  passes those snapshots to build-volume parsing and to the runtime/digest/
  native path. [`app/services/slice/output-lifecycle.js`](../../../app/services/slice/output-lifecycle.js)
  derives the runtime profile from that snapshot lineage, calculates the digest,
  and builds native arguments from the same lineage. The success response uses
  the original selection paths, so `prusa_profile`, `machine_profile`, and
  `process_profile` retain their original stable basenames rather than scratch
  names. Snapshot-backed build-volume parsing separately receives the original
  selected printer/machine path only for public
  `build_volume_limits_mm.source_profile` basename metadata.
- [`app/services/slice/profiles.js`](../../../app/services/slice/profiles.js)
  remains responsible for selection, runtime-profile generation, and
  snapshot-backed bounds parsing. Stable Orca runtime derivation clears
  `layer_gcode` and sets `use_relative_e_distances='1'`. This keeps relative
  extrusion consistent with the flattened pinned machine parent's per-layer
  `G92 E0` reset and keeps that server-owned behavior digest-covered.
- [`app/services/slice/profile-digest.js`](../../../app/services/slice/profile-digest.js)
  canonicalizes effective Prusa INI or Orca machine/process JSON profile layers.
  It excludes paths, request/job/model identity, request layer height, and
  request infill. Engine, technology, machine configuration, other process
  settings, stable server-added Orca runtime settings, and the
  request-independent native invocation policy remain covered.
- Prusa INI canonicalization normalizes irrelevant ordering/comments without
  lowercasing section or key names; native-significant case variants therefore
  remain distinct and digest-covered. An exact duplicate qualified key fails
  closed like the native Boost INI parser. Runtime-profile generation replaces
  one exact top-level lowercase request-owned `layer_height` or, for FDM,
  `fill_density`, rejects a duplicate top-level key, and inserts a missing key
  before the first section.
- [`app/services/slice/response.js`](../../../app/services/slice/response.js)
  requires a lowercase 64-hex digest at
  `profiles.effective_profile_sha256` for both engines before composing success.
- [`app/services/slice/engine-version.js`](../../../app/services/slice/engine-version.js)
  runs both selected executables with `--help` through a bounded timeout/output
  envelope before listen. It requires one engine-specific version and the
  expected help sentinel, publishes the initialized map only after both pass,
  caches successful resolution, and evicts rejection. Request work reads the
  startup map without a request-owned version process. Both
  [`app/services/slice/response.js`](../../../app/services/slice/response.js)
  and OpenAPI require `engine_version` on every success.
- [`app/services/slice/engine.js`](../../../app/services/slice/engine.js) fixes
  the Orca request policy at `--arrange 1` and `--orient 0` after preprocessing
  and bounds validation. Arrangement may translate the already rotated model
  onto the build plate, while native auto-orient remains disabled; the requested
  rotation is not replaced. The command policy alone does not prove full API
  final-dimension behavior.
- [`app/docs/slice-openapi.js`](../../../app/docs/slice-openapi.js) preserves the
  runtime `errorCode` field and adds exactly the four requested previously
  omitted emitted
  `FILE_PROCESSING_TIMEOUT`, `INTERNAL_PROCESSING_ERROR`,
  `ORCA_PROFILE_INCOMPATIBLE`, and `MODEL_OUT_OF_PRINTER_BOUNDS` codes.
- The adjacent review also adds the already-live
  `MODEL_DIMENSIONS_UNAVAILABLE` response code only to the general validation
  branch. It now matches exactly one 422 `oneOf` branch, while the bounds code
  remains disjoint.
- The adjacent HTTP 500 review completes that enum with the full live set:
  `INTERNAL_PROCESSING_ERROR`, `QUEUE_INTERNAL_ERROR`, `UPLOAD_STORAGE_ERROR`,
  and `INTERNAL_SERVER_ERROR`.
- The `MODEL_OUT_OF_PRINTER_BOUNDS` OpenAPI branch requires
  `model_dimensions_mm.{x,y,z}` and
  `build_volume_limits_mm.{min,max,source_profile}`, matching the response from
  [`app/services/slice/transform.js`](../../../app/services/slice/transform.js).

The digest is a configuration and invocation-policy identity. It binds the
fixed Orca `--arrange 1` / `--orient 0` policy, including the change from the
superseded arrangement-disabled policy, but does not prove a native orientation
result.
It is not the separately returned actual-binary `engine_version`, nor a
filament, material-grams, artifact, customer, or binary-file identity.

The flattened Orca snapshot makes the repository resolver, rather than native
fallback inheritance, own the effective parent values passed downstream. A
focused mutation proves that changing a non-overridden parent value changes the
digest while the selected child name remains unchanged. The direct native smoke
exercises the flattened snapshots against the pinned native resources, and the
extrusion check accepts a positive `G1 ... E` only after the exact
`;BEFORE_LAYER_CHANGE` marker, so a prelude/purge move cannot establish model-
layer extrusion. The
corrected validation-image HTTP E2E below proves the model-transform/final-
dimensions seam. The final rebuilt image identity is not yet recorded.

## Exact-image engine help observation

The bounded exact-candidate-image preflight returned exit 0 for both supported
help queries. Prusa produced 6087 bytes and Orca produced 5121 bytes. Both
binaries returned exit 1 for `--version`, so the implementation uses the
observed supported `--help` surface. The real
`initializeSlicerEngineVersions()` module then passed in a network-disabled,
non-root, read-only exact-image envelope and atomically published
`prusa=2.8.1+linux-x64-GTK3-202409181416` and `orca=2.3.1`; the disposable
probe container was removed. This proves the startup engine-version path on
that exact candidate image, not deployment or public activation.

## Superseded arrange-disabled observation and corrected exact-image proof

A predecessor candidate passed the vendored-parent equality gate and a bounded
direct native smoke with arrangement disabled and auto-orient disabled. That
fixture translated its pre-rotated asymmetric prism into non-negative
coordinates, so its pass did not establish the HTTP transform seam. The later
exact-image HTTP probe applied
the requested X90 rotation around the model origin, retained negative Y, and
Orca rejected the result with native status 206 and `Nothing to be sliced`.
This supersedes the prior direct-smoke pass as evidence for API behavior.

The corrected source now uses `--arrange 1` to place the already rotated model
onto the build plate and keeps `--orient 0` so Orca does not choose a new
orientation. Focused invocation-policy, command-array, and digest-binding
contracts cover this source boundary.

The corrected validation exact image then passed the network-disabled,
read-only, healthy-container HTTP E2E. The existing Python optimizer produced
pre-request dimensions 20 x 30 x 10 mm; request rotation X90 produced final
dimensions 20 x 10 x 30 mm. The successful Orca response contained
`engine_version=2.3.1`, a lowercase SHA-256-shaped effective-profile digest,
and the original stable profile basenames. Supplying the otherwise valid slice
credential under `x-api-key` returned HTTP 401, preserving
`x-slicer-api-key` as the only slice header. Exact cleanup passed.

This proves the corrected placement/orientation, response, profile-metadata,
and single-header behavior on that validation image. The final rebuilt image
identity remains pending. External production activation is outside this
repository evidence and authority.

## W3 slice-principal contract

Both `POST /prusa/slice` and `POST /orca/slice` continue to accept exactly the
`x-slicer-api-key` header. `x-api-key` is not an alias. Rejection remains before
workspace allocation, upload, queue admission, native work, and artifact
release. `GET /health` and `GET /pricing` remain authentication-free.

[`app/config/service-auth.js`](../../../app/config/service-auth.js) resolves
`SLICE_SERVICE_AUTH_MODE` once at startup:

| Mode | Required | Forbidden | Optional rotation |
| --- | --- | --- | --- |
| `legacy` (default) | shared active | both principal families; `SLICE_SERVICE_LEGACY_MIGRATION_UNTIL` | shared previous with shared active |
| `migration` | shared active; WooCommerce active; LeadPilot active; parseable future slice migration expiry no more than 90 days away | missing or out-of-window expiry | each family's previous with its own active; shared slots authorize only strictly before expiry |
| `principals` | WooCommerce active; LeadPilot active | shared active/previous; slice migration expiry | each principal previous with its own active |

All configured service-key material must be valid and unique across audiences,
principals, and slots. Any previous-without-active, one-principal, unknown-mode,
mode/slot/deadline mismatch, malformed value, placeholder, or duplicate refuses
startup with the generic configuration error. A configured valid
`ADMIN_API_KEY` participates in that global uniqueness set even when its legacy
migration is not active; only its exact repetition as the authorized
substitution for one missing non-slice active is skipped during registration.
The repository route-activation target is `principals`. External production
activation is outside this repository evidence and authority.

Before any router action, the operator contract requires a sanitized dark
readback proving `principals`, both principal actives, `legacyAccepted=false`,
`expiresAt=null`, and absent shared active/previous plus expiry. One private,
customer-free synthetic slice per principal must pass; every available retired
shared credential under `x-slicer-api-key` and a correct principal supplied
only under `x-api-key` must return exact HTTP 401 without workspace, queue, or
artifact effects. Missing or inconclusive readback, probe, or cleanup keeps the
route dark. This gate is defined but not run as repository evidence here;
external production activation remains outside repository authority.

[`app/middleware/requireAudience.js`](../../../app/middleware/requireAudience.js)
performs every fixed-length digest comparison for the resolved slice ring.
Absent slots use a dummy digest to keep comparison topology stable, but an
absent or empty slot cannot authorize. In `migration`, request time at or after
the exact expiry disables authorization from both shared slots while both
principal families continue; all resolved slots remain compared before the
decision.

No Compose manifest changed for W3: the existing `env_file` passthrough carries
the selected environment file. External production activation is outside this
repository evidence and authority.

## Verification boundary

Focused deterministic coverage is provided by:

- `tests/unit/js/j0-profile-digest.test.js`;
- `tests/unit/js/j0-orca-profile-inheritance.test.js`;
- `tests/unit/js/j0-orca-profile-vendor-contract.test.js`;
- `tests/unit/js/j0-engine-identity.test.js`;
- `tests/unit/js/j0-response-contract.test.js`;
- `tests/unit/js/i5-credential-policy.test.js`;
- `tests/unit/js/i5-security-mutations.test.js`;
- `tests/unit/js/slice-route-lifecycle.test.js`.

The focused contract lane passed on 2026-08-25. No final aggregate count is
recorded here; aggregate verification and final classification remain owned by
the integrator.

Final aggregate, final rebuilt image identity, exact commit/SHA, and hosted
validation are not established by this record. External production activation
is outside this repository evidence and authority.
