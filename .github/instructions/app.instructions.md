---
applyTo: "app/**"
---

# App Folder Instructions

Last synchronized: 2026-08-31

## Responsibilities
- app/server.js handles bootstrap, middleware, routes, docs, and static output serving.
- app/routes should stay lightweight and delegate to services.
- app/routes/system.routes.js delegates admin output listing/download validation to app/services/admin-output.service.js.
- app/services/pricing.service.js remains the facade API; pricing persistence and pricing-domain logic live in app/services/pricing/ submodules.
- app/services/slice/ contains modular pipeline logic (options, queue,
  transform, selection/runtime profiles, allowlisted Orca parent flattening in
  `app/services/slice/orca-profile-inheritance.js`, snapshots in
  `app/services/slice/profile-snapshot.js`, effective-profile identity in
  `app/services/slice/profile-digest.js`, native rejection classification in
  `app/services/slice/native-bounds.js`, native version identity in
  `app/services/slice/engine-version.js`, filament selection/metadata in
  `app/services/slice/filament-profile.js`, strict FDM metrics in
  `app/services/slice/gcode-metrics.js`, startup catalogue in
  `app/services/slice/profile-catalogue.js`, versioned orientation and total-
  rotation identity in `app/services/slice/orientation-contract.js`, response,
  errors).
- app/config/service-auth.js resolves immutable pricing/artifact/operations
  rings plus explicit `legacy`, finite `migration`, or final `principals` slice
  mode with shared compatibility and WooCommerce/LeadPilot rings.
- app/middleware uses nearest-untrusted-hop client IP parsing from fail-closed
  Express trust-proxy configuration.
- app/middleware/requireAudience.js compares every resolved fixed-digest slot;
  migration shared slots stop authorizing at exact request-time expiry while
  principal slots continue.
- app/middleware/corsPolicy.js keeps all four protected audience allowlists
  separate while permitting requests without Origin.
- app/middleware/requestId.js validates/replaces inbound request IDs before
  requestObservability emits lifecycle events.
- app/middleware/rateLimit.js includes periodic expired-bucket cleanup and separate admin throttling middleware.
- app/services/http-server.js applies bounded HTTP timeouts, header/connection counts, and requests per socket before listen.
- app/services/readiness.service.js provides cached admission-aware probes for
  /ready and /operations/readiness plus fresh probes for /health/detailed;
  app/services/observability provides redacted events and fixed-cardinality
  metrics.
- app/routes/profile-catalogue.routes.js exposes the immutable startup
  catalogue without authentication. Catalogue failure returns typed 503 and
  never changes slice readiness/admission.

## Endpoint Rules
- Keep upload field name as choosenFile.
- Keep both slice routes ordered as sliceRateLimiter -> requireSliceService -> root-scoped workspace/Multer -> queue -> native processing.
- Keep exact missing/wrong slice-auth response HTTP 401 `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
- Keep exactly one slice header, x-slicer-api-key; x-api-key is not a slice alias.
- Every successful Prusa/Orca response requires lowercase
  `profiles.effective_profile_sha256` plus actual-selected-executable
  `engine_version`. Public profile fields and bounds `source_profile` keep
  original selected basenames, never randomized snapshot names.
- Keep multipart `orientationMode` strict: omission defaults to `auto`; the
  only present values are exact `auto` and `preserve`; every other value returns
  HTTP 400 `INVALID_ORIENTATION_MODE`.
- Success and full K2 HTTP 422 `MODEL_OUT_OF_PRINTER_BOUNDS` require the same
  complete `model_transform` with `transform_schema: 2`, orientation
  mode/outcome, requested/automatic/total rotations, and all dimension stages.
  `original_dimensions_available` is mandatory: true iff
  `original_dimensions_mm` is an object from a real measurement, false iff it
  is null, with no oriented fallback. Oriented and final dimensions are
  load-bearing and must be positive; otherwise return controlled HTTP 422
  `MODEL_DIMENSIONS_UNAVAILABLE`. A canonical measured tag requires
  `height_mm == z`. Malformed tagged original data degrades to false/null;
  malformed tagged oriented/final data takes the controlled 422 branch.
  Compose its rotation-only matrix as
  `R_total = R_requested * R_automatic`; never include centering, grounding,
  scaling, or translation. Original is after safe conversion and before
  service orientation. Keep `stats.object_height_mm` equal to final Z.
- Preserve bounded stdout and stderr as separate properties on failed native
  commands. Placement classification may inspect both streams, but it must
  still require an explicit placement/print-volume diagnostic. When Prusa exits
  zero without an artifact, map to full K2 only if that retained output carries
  the explicit diagnostic; otherwise preserve the missing-artifact failure.
- Keep OpenAPI's four requested omissions plus the already-live
  `MODEL_DIMENSIONS_UNAVAILABLE` general-422 correction. The disjoint
  `MODEL_OUT_OF_PRINTER_BOUNDS` branch requires both dimension payloads and the
  complete versioned transform payload. Keep
  the complete live slice-500 enum: `SLICE_OUTPUT_UNPARSED`,
  `INTERNAL_PROCESSING_ERROR`, `QUEUE_INTERNAL_ERROR`, `UPLOAD_STORAGE_ERROR`,
  and `INTERNAL_SERVER_ERROR`.
- Atomically verify both selected engine versions from bounded `--help` output
  before listen; requests read the all-success initialized map. The startup
  module has exact-image proof and uses a telemetry-disabled runner that cannot
  alter slice-native lifecycle metrics/events. Keep Orca invocation at
  `--arrange 1`, `--orient 0`, and exactly one single-token
  `--allow-rotations=0` after preprocessing/bounds checks: arrangement retains
  translation/placement, while native auto-orient and unreported whole-
  compound yaw stay disabled.
  Focused command/digest contracts and final exact-image HTTP transform/final-
  dimensions E2E pass for both principals; the exact local code/image identity
  is recorded in the J0 evidence document.
- Preserve J1 Orca filament behavior: repository PLA/PETG selection, exact-byte
  job snapshot, machine/process through `--load-settings`, selected filament
  through dedicated `--load-filaments`, digest-covered normalized
  material plus filament JSON or explicit null, and nullable public basename/
  diameter/density. OpenAPI requires nullable `material_used_g`, populated only
  by a direct G-code marker and never derived from length. Strict FDM requires
  positive time and length. Current Prusa FDM and profile-less Orca map a
  missing or recognized non-positive optional grams marker to null/manual,
  never zero. Selected-profile Orca still requires positive grams; recognized
  zero remains `GCODE_FILAMENT_NOT_POSITIVE` -> `SLICE_OUTPUT_UNPARSED`, and
  marker drift remains fail closed. Owner-supplied VPS evidence verifies the
  guard-only HTTP 200/null path and the Orca mechanism's 0.00 g to 4.12 g
  correction. The combined local focused set passes 69/69; the final combined
  exact-image rerun remains pending.
- Keep W8 Orca calibration
  `BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER`: the retained P1S and H2D
  candidates are generic Marlin profiles, not verified native Bambu profiles.
  J2 supplies only their `256 x 256 x 250 mm` and
  `350 x 320 x 325 mm` physical envelopes. Nine numeric Bambu references plus
  the `M03` P1S-boundary result exist; the runner fixes `--orient 0` and support
  off, but no Orca measurement, deploy, public route, or automatic-pricing
  acceptance is authorized.
- Keep endpoint contracts stable:
  - POST /prusa/slice
  - POST /orca/slice
  - GET /pricing
  - GET /profiles (public, strong ETag/304, body digest, non-critical 503)
  - GET /health and GET /ready (public)
  - GET /health/detailed, GET /operations/readiness, GET /operations/metrics (operations)
  - POST /pricing/FDM, POST /pricing/SLA, PATCH/DELETE /pricing/:technology/:material (pricing)
  - GET /admin/output-files and GET /admin/download/:fileName (artifact)
  - GET /admin/download/:fileName supports `ALL` token for ZIP bulk download
- Keep `/profiles` bound to the production selection/snapshot/runtime/digest/
  bounds chain. `r3d-profile-catalogue-v2` is explicitly FDM-only, lists 18
  machine-bound server-owned presets, and binds every row to printer and engine.
  Preserve physical/profile-declared `declared_build_volume_dimensions_mm`
  separately from the exact-boundary-inclusive admission authority
  `largest_passing_dimensions_inclusive_mm`, along with
  `declared_source_kind: profile-explicit` and
  `minimum_dimensions_inclusive_mm`. Preserve
  bounded generic `engine`, generic `slice_selector.endpoint` plus ordered
  `parameters[{name,value}]`, ordered path-free
  `profile_components[{role,basename,selector_parameter}]`, exact nullable
  component-to-selector bindings, exact
  `effective_profile_identity_schema: r3d-effective-slice-profile-v2`.
  Keep all per-printer/per-engine preset rows and fail closed on drift within a
  technology/printer/engine. Derive `machine_resolutions` and
  `fleet_resolutions` independently for each technology and engine; never merge
  Prusa/Orca ceilings, synthesize a component-wise minimum, or add a manual
  maximum. Owner-accepted P1S admission is Prusa
  `256 x 256 x 249.9 mm` and Orca `253.9 x 253.9 x 249.9 mm`; Prusa's native X/Y
  edge beyond the declared profile remains `UNESTABLISHED`. H2D-QUOTE exists on
  both engines with P1S physics and enlarged declared bed
  `350 x 320 x 325 mm`; it is quote-only, not machine-accurate or production
  H2D G-code. Exact helper-image measurement A established Prusa
  `350 x 320 x 324.9 mm` and Orca `347.9 x 317.9 x 324.9 mm`; exact local
  final-admission B confirmed those tuples with 88/88 fixture preconditions,
  20/20 brackets, and 4/4 corners. Prusa native X/Y beyond its declared quote
  bed remains `UNESTABLISHED`. The owner production-identical VPS matrix from
  exact tree `db42b93` later confirmed all four inclusive selector boundaries,
  full K2 422 mapping, and all three enlarged Prusa layer profiles; its
  separately built image ID is not byte-identical-image evidence. Never
  advertise the generic
  `120 x 120 x 150 mm` SLA fallback as a printer envelope. Catalogue v2 can add
  a later truthful SLA row and independent per-engine SLA fleet resolution
  without another schema-version change.
- Do not guess dimensions for the owner-confirmed Elegoo Saturn 4 Ultra. Current
  Prusa `--export-sla`/SL1 handling is incompatible with its `.goo`/`.ctb`
  artifacts and credible MSLA timing; a separate future wave must use owner
  Chitubox/Elegoo Satellite profiles.

## Safety Rules
- Preserve queue and rate-limit protections.
- Preserve mandatory pricing/artifact/operations actives plus one complete slice
  mode: default shared-only `legacy`; shared plus both principals and a future
  <=90-day expiry for `migration`; or both principals with no shared slots/
  expiry for `principals`. Reject one-principal and previous-without-active
  states; keep all configured material, including a valid `ADMIN_API_KEY`,
  globally unique and 32-256 printable ASCII. Only the admin key's exact
  authorized legacy substitution self-reference is skipped.
- Preserve canonical-realpath bounded profile reads, allowlisted Orca v2.3.1
  versioned-repository parent flattening, and exact Prusa-byte/flattened-Orca
  job-scratch snapshots before bounds/runtime derivation; reject symlink/non-
  canonical sources, detected growth, unknown/cyclic/name- or role-mismatched
  parents, and exact duplicate Prusa INI qualified keys. Preserve the Docker
  build semantic-equality gate and stable Orca `layer_gcode=''` /
  `use_relative_e_distances='1'` settings aligned with each selected repository
  child machine's exact `layer_change_gcode='G92 E0'` override.
- Preserve declared P1S `256 x 256 x 250 mm` and H2D-sized quote
  `350 x 320 x 325 mm` metadata separately from the configured inclusive
  largest-passing ceilings. Preserve profile minima, the compatibility FDM
  fallback, and `MAX_MODEL_DIMENSION_MM >= 350`.
- Preserve bounded/redacted auth events and exact per-audience CORS policies.
- Preserve HTTP defaults/bounds: 60000 [1000,60000] headers ms; 600000 [60000,600000] request ms; 5000 [1000,60000] keep-alive ms; 2000 [16,2000] headers; 128 [1,1024] connections; 100 [1,1000] requests/socket.
- Invalid HTTP envelope overrides fall back to defaults; effective headers timeout is capped at request timeout. VPS capacity and proxy timeouts remain UNVERIFIED.
- Preserve per-client queue fairness cap (MAX_SLICE_QUEUE_PER_IP).
- Preserve queue/status mapping: SLICE_QUEUE_FULL (503), SLICE_QUEUE_CLIENT_LIMIT (429), SLICE_QUEUE_TIMEOUT (503).
- Preserve rate-limit response shape and Retry-After behavior for slice/admin throttling.
- Preserve admin download safety guards for both single-file and ALL-token ZIP responses.
- Preserve ALL-token ZIP resource limits using MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES.
- Preserve Orca per-request isolated output directory handling.
- Preserve exactly one supported outer ZIP source. A multi-object 3MF is
  concatenated into one compound STL, passed as one STL argument, and not sent
  through split-to-objects; it is not an independent multi-object packing
  surface.
- Preserve error code names used by clients.
- Do not auto-heal invalid geometry.
- Preserve public minimal readiness and operations-only detailed reasons/metrics.
  Keep /health/detailed fresh and /ready plus /operations/readiness cached.
- J1C capability readiness is proposal-only: keep `/health` cheap and place any
  future native slicing-capability state on public `/ready`. Require separate
  startup-smoke, Docker/VPS, typed per-engine failure, anti-DoS, and recovery/
  hysteresis evidence before implementation.
- Never add request/job/artifact/customer values as metric labels.
- Preserve fail-closed proxy CIDR/loopback compilation and safe request-ID validation.
- I6 validation requires an internal-only API with no host port/default route,
  an authenticated private peer, and calibrated API/native egress denial.
  Async worker work remains deferred and deployed topology remains UNVERIFIED.
