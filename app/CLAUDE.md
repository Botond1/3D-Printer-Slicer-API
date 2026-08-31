# App Folder - Local Claude Guide

Last synchronized: 2026-08-31

## Scope

This document describes the application runtime inside app/.

## Runtime Summary

- HTTP stack: bounded Node HTTP server + Express + helmet + method-aware
  audience CORS + validated request ID + lifecycle observability + global error handler.
- Upload flow: slice limiter, x-slicer-api-key authentication, root-scoped workspace allocation, route-level multer single-file upload on choosenFile, queueing, strict option validation, conversion, versioned orientation capture, transform/bounds validation, native slicing, stats parsing, and pricing response.
- Slicing engines: PrusaSlicer (FDM/SLA) and OrcaSlicer (FDM only).
- Public profile catalogue: immutable startup generation for machine-bound,
  server-owned FDM presets; strong ETag/body digest; non-critical typed 503.
- J3B transform/envelope contract: schema-2 original-measurement availability,
  load-bearing oriented/final dimensions, per-engine inclusive admission
  ceilings, and full K2 mapping for explicit native placement rejection.
- Runtime folder contract: root-scoped input/, output/, configs/ only.

## Detailed JavaScript File Responsibilities

### Bootstrap and wiring

- app/server.js
  - Resolves immutable pricing/artifact/operations rings plus one explicit
    `legacy`, finite `migration`, or final `principals` slice mode with shared
    compatibility and WooCommerce/LeadPilot rings; incomplete or overbroad
    configuration refuses startup.
  - Applies helmet policies (standard for API, dedicated CSP for /docs and /openapi.json).
  - Compiles fail-closed trust proxy from TRUST_PROXY + TRUST_PROXY_CIDRS.
  - Applies exact per-audience CORS while allowing requests without Origin,
    validates/propagates X-Request-Id, and observes request settlement.
  - Creates one bounded Node HTTP server before listening.
  - Resolves both engine versions, attempts non-critical profile-catalogue
    initialization, then registers JSON/urlencoded limits, Swagger endpoints,
    business routes, 404 handler, and global error handler.

### Configuration modules

- app/config/constants.js
  - Defines DEFAULTS for rate limits, queue limits, upload limits, command/HTTP timeouts, HTTP connection/header/socket limits, layer heights, and default materials.
  - Defines the inclusive application concurrency range `1..3`; the default
    remains `MAX_CONCURRENT_SLICES=1`.
  - Defines extension groups, Orca process-profile defaults, and default pricing matrix.
  - Uses `350 x 320 x 325 mm` as the largest-supported FDM fallback and keeps
    the existing `1 mm` profile minima unchanged; shipped profiles must supply
    exact upper machine metadata.
  - Owns validation-only largest-passing ceilings separately from declared
    profile dimensions. P1S is Prusa `256 x 256 x 249.9 mm` and Orca
    `253.9 x 253.9 x 249.9 mm`; exact helper-image measurement A established
    H2D-sized quote values as Prusa `350 x 320 x 324.9 mm` and Orca
    `347.9 x 317.9 x 324.9 mm`. Prusa native X/Y beyond the declared quote bed
    remains `UNESTABLISHED`; final-admission B is still pending.
- app/config/resource-policy.js
  - Treats an omitted `MAX_CONCURRENT_SLICES` as default `1` and accepts an
    explicit value only as a canonical positive decimal integer in `1..3`.
  - Rejects malformed, non-canonical, unsafe, or out-of-range explicit values
    during startup validation.
  - Accepts `MAX_MODEL_DIMENSION_MM` only from `350` through `100000`; its
    default remains `10000`.
- app/config/service-auth.js
  - Requires pricing, artifact, and operations actives plus one complete
    `SLICE_SERVICE_AUTH_MODE`; default `legacy` requires shared active,
    `migration` requires shared active, both principal actives, and a future
    <=90-day legacy expiry, while `principals` requires both principal actives
    and forbids shared active/previous and expiry.
  - Optional previous slots require their own active; all configured key
    material, including a valid `ADMIN_API_KEY`, is globally unique and 32-256
    printable ASCII. Only its exact authorized legacy substitution self-
    reference is skipped.
  - Rejects missing, malformed, placeholder-like, reused, or duplicate material generically.
  - Allows ADMIN_API_KEY only as a <=90-day migration for one named non-slice audience; any other cross-slot reuse fails closed.
- app/config/route-policy.js
  - Classifies protected routes by normalized method/path, including OPTIONS requested method.
- app/config/trust-proxy.js
  - Accepts only explicit validated IP/CIDR entries or loopback; rejects
    wildcard, broad, duplicate, malformed, and unknown trust configuration.
- app/config/paths.js
  - Resolves absolute runtime paths for input/, output/, configs/, and pricing files.
  - Ensures required directories exist before request processing.
- app/config/python.js
  - Resolves PYTHON_EXECUTABLE securely.
  - Requires absolute existing executable when explicitly configured.
  - Falls back via VIRTUAL_ENV and known absolute runtime paths.

### Middleware

- app/middleware/rateLimit.js
  - Implements in-memory per-IP throttling with configurable window/limit.
  - Exposes sliceRateLimiter and adminRateLimiter.
  - Returns HTTP 429 + Retry-After + retryAfterSeconds on limit exceed.
  - Periodically prunes expired buckets.
- app/middleware/requireAdmin.js
  - Creates pricing, artifact, and operations x-api-key guards from the startup key ring.
- app/middleware/requireAudience.js
  - Compares supplied material against every resolved fixed-length SHA-256 slot
    for one audience and emits bounded rejection metadata.
  - In slice `migration`, shared slots authorize only strictly before the
    request-time expiry; principal slots continue at and after it.
- app/middleware/requireSliceService.js
  - Enforces x-slicer-api-key for both slice endpoints.
  - Hashes supplied/configured values to fixed-size SHA-256 digests before crypto.timingSafeEqual.
  - Returns exact HTTP 401 `SLICE_SERVICE_AUTH_REQUIRED` and logs only requestId + resolved client IP.
- app/middleware/corsPolicy.js
  - Allows requests without Origin.
  - Uses only the classified audience's SLICE_, PRICING_, ARTIFACT_, or
    OPERATIONS_CORS_ALLOWED_ORIGINS list.
- app/middleware/requestId.js
  - Accepts one bounded safe inbound request-ID format; replaces invalid input
    and returns the resolved X-Request-Id.
- app/middleware/requestObservability.js
  - Emits request accepted/rejected/completed events and fixed-cardinality outcomes.
- app/middleware/errorHandler.js
  - Normalizes CORS, payload parse/size, and multer upload errors.
  - Keeps stable JSON error payload shape for clients.

### Routes

- app/routes/slice.routes.js
  - Declares POST /prusa/slice and POST /orca/slice.
  - Applies sliceRateLimiter -> requireSliceService -> root-scoped workspace -> multer upload -> queue/native handler.
  - Enforces upload.single('choosenFile') and extension whitelist.
- app/routes/pricing.routes.js
  - Declares GET /pricing (public).
  - Declares pricing-scoped mutation routes and applies adminRateLimiter plus
    the injected pricing authenticator.
- app/routes/profile-catalogue.routes.js
  - Declares public GET /profiles.
  - Returns the immutable serialized startup snapshot with a strong ETag,
    supports weak/strong `If-None-Match` candidates and 304, and returns
    no-store HTTP 503 `PROFILE_CATALOGUE_UNAVAILABLE` when initialization failed.
- app/routes/system.routes.js
  - Declares public GET /health and minimal GET /ready.
  - Declares operations-scoped GET /health/detailed,
    /operations/readiness, and /operations/metrics.
  - Declares artifact-scoped GET /admin/output-files and /admin/download/:fileName.
  - Delegates hardened output listing/download validation to app/services/admin-output.service.js.

### Services: top-level

- app/services/pricing.service.js
  - Facade service that coordinates pricing load/save lifecycle and exposes stable pricing APIs to routes and slicer modules.
  - Delegates persistence to repository and material/domain logic to catalog modules.
- app/services/pricing/repository.js
  - File-system repository for pricing payload read/write and candidate-file discovery.
  - Handles primary/legacy pricing source resolution.
- app/services/pricing/catalog.js
  - In-memory pricing domain catalog for normalization, material lookup, and rate calculation logic.
  - Encapsulates technology/material rules and mutation operations.
- app/services/slice.service.js
  - Central orchestrator for slice requests.
  - Validates upload, parses options, enqueues job by client IP, preprocesses model, runs slicer command, parses stats, computes pricing, and returns response.
  - Maps queue-layer failures into stable API error codes and status codes.
- app/services/admin-output.service.js
  - Validates generated output artifacts for admin listing, single-file download, and ALL-token ZIP export.
  - Applies extension allowlist, path containment, non-symlink target checks, realpath containment, and bulk ZIP resource limits.
- app/services/http-server.js
  - Applies validated Node HTTP header/request/keep-alive timeouts, header count, connection count, and requests-per-socket before listen.
  - Falls back to defaults for empty, non-decimal, unsafe, or out-of-range values and caps headers timeout at request timeout.
- app/services/readiness.service.js
  - Caches admission-aware queue/native/storage/retention/pricing/config probes
    for /ready and /operations/readiness; exposes fresh probes to
    /health/detailed.
  - Emits stable reason codes and closes admission before shutdown drain.
- app/services/observability/
  - Carries bounded request/job/artifact correlation, emits versioned allowlisted
    redacted JSON events, and renders fixed-cardinality metrics.

### Services: slice submodules

- app/services/slice/command.js
  - Runs external binaries via execFile with argument arrays.
  - Enforces SLICE_COMMAND_TIMEOUT_MS without emitting raw native stdout/stderr.
  - On command failure, retains bounded stdout and stderr as separate error
    properties so a stdout placement diagnostic is not hidden by a stderr
    warning; neither stream is emitted to logs.
- app/services/slice/common.js
  - Shared helpers for supported extensions, deterministic output naming, isolated Orca output dirs, file alignment, and cleanup.
- app/services/slice/engine.js
  - Resolves slicer executable name by engine.
  - Builds argument arrays and request-independent invocation policy for Prusa
    and Orca. Prusa export flags, Orca's machine/process `--load-settings`
    order, and the selected filament's dedicated `--load-filaments` option are
    composed from that same hash-fed policy; Orca sends
    `--arrange 1`, `--orient 0`, and exactly one single-token
    `--allow-rotations=0` after preprocessing/bounds checks. Arrangement keeps
    translation/placement while whole-compound yaw and native auto-orient are
    disabled, so no post-contract rotation is omitted.
- app/services/slice/engine-version.js
  - Resolves both selected executables' bounded `--help` output atomically before
    listen, publishes only the all-success initialized map, and evicts failures.
- app/services/slice/errors.js
  - Classifies pipeline failures (geometry, zip, timeout, unsupported format,
    Orca profile mismatch, and complete-context native placement refusal).
  - Converts exceptions to stable API error responses.
- app/services/slice/filament-profile.js
  - Resolves the allowlisted Orca filament profile from normalized material and
    reads exact positive diameter/density from the selected snapshot.
- app/services/slice/gcode-metrics.js
  - Strictly parses bounded positive FDM time and filament length. Direct grams
    are nullable for Prusa/profile-less Orca: a missing or recognized non-
    positive optional marker becomes null, never zero. Grams remain mandatory
    and positive for Orca with a selected filament profile; mass is never
    derived from length.
- app/services/slice/input-processing.js
  - Converts supported model/CAD inputs to STL via Python scripts.
  - Runs `auto` orientation or `preserve` normalization and accepts only the
    bounded, exact-shape, versioned orientation sidecar from the owned workspace.
  - Converts a missing/invalid optimizer result to explicit
    `fallback_unmodified` identity rather than claiming a rotation.
- app/services/slice/model-stats.js
  - Returns explicit `measured` or `unavailable` model-dimension results;
    failed `prusa-slicer --info` measurement never becomes silent zeros, while
    a genuinely measured zero remains distinguishable.
  - A canonical measured tag requires finite non-negative X/Y/Z/height and
    `height_mm === z`. Malformed tagged original provenance degrades to
    unavailable; malformed oriented/final measurements fail through the
    controlled dimensions-unavailable branch.
  - Parses slicer outputs for print-time/material
    length and nullable direct grams. `SLICE_STRICT_GCODE_METRICS` defaults to
    true; missing required Orca mass maps to `SLICE_OUTPUT_UNPARSED`, and a
    recognized required zero maps through `GCODE_FILAMENT_NOT_POSITIVE`.
  - Builds SLA print-time estimates when metadata is absent.
- app/services/slice/native-runtime-status.js
  - Owns the process-local fail-closed native-runtime quarantine and publishes
    its bounded subscription/unsubscription seam.
- app/services/slice/number-utils.js
  - Shared positive-integer parsing plus bounded canonical concurrency parsing.
- app/services/slice/options.js
  - Validates request fields: layerHeight, material, infill, size/scale/rotation,
    unit, profile overrides, and strict `orientationMode=auto|preserve`.
    Omission alone defaults to `auto`; malformed or differently cased present
    values return `INVALID_ORIENTATION_MODE`.
  - Enforces engine/technology layer constraints and material-technology compatibility.
- app/services/slice/orientation-contract.js
  - Validates proper 3x3 rotation matrices and the versioned orientation
    sidecar; owns orientation modes/outcomes and `transform_schema: 2`.
  - Requires `original_dimensions_available:true` exactly with a real measured
    object and false exactly with `original_dimensions_mm:null`; it never uses
    oriented dimensions as original provenance. Oriented/final measurements
    must be positive.
  - Composes the authoritative rotation-only matrix as
    `R_total = R_requested * R_automatic` and emits canonical Euler summaries.
- app/services/slice/output-lifecycle.js
  - If a slicer exits zero but produces no output artifact, preserves the
    engine's existing missing-artifact failure unless stdout/stderr contains an
    explicit placement refusal. That Prusa safety-net case maps through the
    complete K2 native-bounds contract.
- app/services/slice/profiles.js
  - Resolves Prusa and Orca machine/process/filament profile selection.
  - Validates profile existence.
  - Creates runtime profile variants and resolves build-volume limits from
    snapshot bytes while preserving the original selected basename for public
    `source_profile` metadata.
  - Preserves `declaredMax` as physical/profile metadata and makes runtime
    `max` consume only the configured per-engine
    `largestPassingDimensionsInclusive` admission value.
  - Keeps Prusa INI section/key case significant, rejects exact duplicate
    qualified keys, and replaces one exact top-level request key or inserts a
    missing one before the first section.
  - Clears Orca `layer_gcode` and sets `use_relative_e_distances='1'` for stable
    relative extrusion aligned with each repository child machine's exact
    `layer_change_gcode='G92 E0'` override.
- app/services/slice/orca-profile-inheritance.js
  - Always resolves and flattens the allowlisted versioned repository copy of
    the Orca v2.3.1 `Custom` machine/process parent chain; unknown, cyclic,
    name-mismatched, and wrong-role parents fail closed.
- app/services/slice/profile-snapshot.js
  - Bounded-reads canonical regular profiles after selection and creates exact
    Prusa-byte or flattened Orca JSON snapshots in exclusive job scratch before
    bounds/runtime derivation; symlink/non-canonical sources and detected growth
    fail closed.
- app/services/slice/profile-digest.js
  - Builds the deterministic effective machine/process and request-independent
    native-invocation identity, including stable relative-extrusion settings,
    while excluding request layer-height/infill.
- app/services/slice/profile-catalogue.js
  - Builds the immutable `r3d-profile-catalogue-v2` managed-preset catalogue at startup through the
    production selection, snapshot, runtime-profile, build-volume, filament,
    and effective-digest chain.
  - V2 lists only machine-bound server-owned FDM presets: Prusa/Orca P1S and
    explicit `H2D-QUOTE`. Custom overrides and dynamic/unmapped materials remain outside v2.
    The generic `120 x 120 x 150 mm` SLA fallback is never a machine envelope.
  - Uses a bounded generic `engine`, generic `slice_selector.endpoint` plus
    ordered `parameters[{name,value}]`, and ordered path-free
    `profile_components[{role,basename,selector_parameter}]`. Nullable
    `selector_parameter` binds machine/combined to `printerProfile`, process to
    `processProfile`, and filament to no selector.
  - Declares `effective_profile_identity_schema` as
    `r3d-effective-slice-profile-v2`.
    `declared_build_volume_dimensions_mm` and
    `declared_source_kind: profile-explicit` identify physical/profile metadata;
    `largest_passing_dimensions_inclusive_mm` alone is the inclusive admission
    authority. `minimum_dimensions_inclusive_mm` is a generic floor.
  - The owner-confirmed future SLA printer is the Elegoo Saturn 4 Ultra, but
    current Prusa `--export-sla`/SL1 handling cannot represent its `.goo`/`.ctb`
    artifacts or credible MSLA timing. Do not guess its dimensions; remediation
    is a later owner-profiled Chitubox/Elegoo Satellite wave. A truthful row can
    use catalogue v2 and a separate per-engine technology fleet row without
    another schema-version change; none exists now.
  - Preserves every per-printer/per-engine preset row. Presets inside one
    technology/printer/engine must agree on declared and admission envelopes or
    catalogue construction fails. `machine_resolutions` and
    `fleet_resolutions` are engine-scoped; cross-engine ceilings are never
    merged or minimized component-wise.
  - Current P1S ceilings are Prusa `256 x 256 x 249.9 mm` and Orca
    `253.9 x 253.9 x 249.9 mm`. H2D-QUOTE measurement A established Prusa
    `350 x 320 x 324.9 mm` and Orca `347.9 x 317.9 x 324.9 mm`; the exact
    Prusa X/Y edge beyond its declared quote bed remains `UNESTABLISHED`, and the
    final-admission-B matrix remains pending. Catalogue failure never gates slicing.
- app/services/slice/response.js
  - Composes successful slice response payloads and refuses success without a
    lowercase 64-hex `profiles.effective_profile_sha256` or machine-readable
    actual-selected-executable `engine_version`.
  - Requires the complete schema-2 `model_transform`, including the exact
    original-availability invariant, and enforces
    `stats.object_height_mm === model_transform.final_dimensions_mm.z`.
  - Encapsulates pricing and profile payload mapper strategies for engine/technology-specific response shaping.
- app/services/slice/queue.js
  - Implements the bounded FIFO queue with canonical
    `MAX_CONCURRENT_SLICES=1..3`, `MAX_SLICE_QUEUE_LENGTH`,
    `MAX_SLICE_QUEUE_PER_IP`, and `MAX_SLICE_QUEUE_WAIT_MS`.
  - Applies per-client fairness and timeout rejection semantics.
  - Emits typed queue-domain errors and centralized queue-to-API error mapping metadata.
- app/services/slice/queue-scheduler.js
  - Closes admission synchronously on native-runtime quarantine, drains queued
    and active ownership, and releases the quarantine subscriber exactly once
    after drain.
- app/services/slice/transform.js
  - Builds the scale/request-rotation plan, applies it through Python, and
    validates final bounds against build-volume limits.
  - Builds one complete `model_transform` for both success and
    `MODEL_OUT_OF_PRINTER_BOUNDS`, including orientation and
    original/oriented/final dimensions.
  - Allows original measurement provenance to be unavailable, but returns
    controlled HTTP 422 `MODEL_DIMENSIONS_UNAVAILABLE` if oriented or final
    load-bearing measurement is unavailable, malformed, non-positive, or has
    `height_mm !== z`.
- app/services/slice/native-bounds.js
  - Recognizes only explicit native placement/print-volume diagnostics and
    builds the full K2 HTTP 422 payload only from a complete schema-2 transform
    plus selected build limits; incomplete/unrelated failures remain internal.
  - Classifies bounded message, stderr, and stdout independently preserved by
    command/output lifecycle handling, including Prusa exit-zero/no-artifact
    placement diagnostics.
- app/services/slice/value-parsers.js
  - Normalizes numeric/boolean/unit inputs and sanitizes profile override filenames.
- app/services/slice/zip.js
  - Performs ZIP guard checks (entry count, cumulative uncompressed size, path safety, encryption rejection, exact single supported source file requirement).
  - Never creates a multi-source plate: one 3MF source may contain multiple
    geometries, but `mesh2stl.py` concatenates them into one compound STL, the
    command passes one STL argument, and no split-to-objects operation is used.

### Utilities and docs generation

- app/utils/client-ip.js
  - Provides normalized client IP retrieval using Express trust-proxy behavior.
- app/utils/logger.js
  - Provides structured error logging helper for processing failures.
- app/docs/swagger-docs.js
  - Generates OpenAPI document used by /openapi.json and Swagger UI /docs.
- app/docs/profile-catalogue-openapi.js
  - Defines the public catalogue 200/304/503 contract, strong ETag/body digest,
    machine-bound entry fields, and informational/non-critical semantics.
- app/docs/slice-openapi.js
  - Defines strict `orientationMode`, the complete `transform_schema: 2`
    response schema, `engine_version`, and the effective-profile digest.
  - Requires both original-dimension fields and encodes the true/object versus
    false/null invariant on success and full bounds errors.
  - Keeps `MODEL_DIMENSIONS_UNAVAILABLE` in the general branch and requires
    model dimensions, build limits, and the same complete `model_transform` in
    the disjoint `MODEL_OUT_OF_PRINTER_BOUNDS` branch. The slice-500 enum is the
    complete live set: `SLICE_OUTPUT_UNPARSED`, `INTERNAL_PROCESSING_ERROR`,
    `QUEUE_INTERNAL_ERROR`, `UPLOAD_STORAGE_ERROR`, and `INTERNAL_SERVER_ERROR`.

## Python Helper Scripts in app/

- app/cad2stl.py: CAD-to-STL conversion.
- app/mesh2stl.py: mesh normalization to STL.
- app/orient.py: `auto`/`preserve` orientation preprocessing plus exclusive,
  bounded, versioned rotation-matrix sidecar output.
- app/scale_model.py: scale/rotation transform execution.

## Endpoint Behavior Notes

- Upload field name must stay choosenFile (multer single-file mode with extension filter).
- Pricing, artifact, and operations actives plus one complete slice mode are
  mandatory. Slice `legacy`, finite `migration`, and final `principals` modes
  never admit a one-principal configuration; all configured slots are globally
  unique, 32-256 printable-ASCII bytes, and non-placeholder.
- Both slice routes accept exactly one x-slicer-api-key header; x-api-key is not
  an alias. Missing/wrong/expired-shared credentials return HTTP 401 with
  `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}` before workspace/upload/queue/native side effects.
- Every successful Prusa/Orca payload requires
  `profiles.effective_profile_sha256`. Snapshot-backed bounds/runtime/digest/
  native work does not expose randomized snapshot names: profile metadata and
  bounds `source_profile` retain original selected basenames.
- The optional multipart `orientationMode` is exact `auto|preserve`; omission
  defaults to `auto` for backward-compatible behavior. All other present values
  fail with HTTP 400 `INVALID_ORIENTATION_MODE`.
- Every success and full bounds failure carries `transform_schema: 2`,
  `orientation_mode`, `orientation_outcome`, requested/automatic/total
  rotations, and original/oriented/final dimensions. Original availability is
  explicit: true iff a real measurement object exists, false iff null; no
  oriented fallback is permitted. The matrix is rotation-only, uses
  `R_total = R_requested * R_automatic`, and excludes translation, grounding,
  and scaling; `stats.object_height_mm` equals final Z.
- OpenAPI documents the four requested omitted codes plus the already-live
  `MODEL_DIMENSIONS_UNAVAILABLE` general-422 correction. Bounds errors require
  `model_dimensions_mm`, `build_volume_limits_mm`, and the complete
  `model_transform`. The complete live
  slice-500 enum is `SLICE_OUTPUT_UNPARSED`, `INTERNAL_PROCESSING_ERROR`,
  `QUEUE_INTERNAL_ERROR`, `UPLOAD_STORAGE_ERROR`, and `INTERNAL_SERVER_ERROR`.
- Success requires `engine_version` from the atomic pre-listen bounded `--help`
  verification of both selected executables; the startup module has exact-image
  proof and uses a telemetry-disabled runner that cannot alter slice-native
  lifecycle metrics/events. Orca passes `--arrange 1`, `--orient 0`, and one
  `--allow-rotations=0`, so placement can translate the model onto the plate
  without adding an unreported whole-compound yaw or replacing the request-
  owned rotation. Focused
  command/digest contracts and final exact-image HTTP transform/final-dimensions
  E2E pass on code SHA `ed85eec63409b7362fe05c2b99031eeb24b5b9c9` and local
  image ID `sha256:66697a1ca69e13600a91481bf474d042c0f89b236ccbaf67fcf2dea8824f2c7f`.
  Both principal families pass; a valid key only under `x-api-key` rejects
  without request residue.
- J1 Orca selection snapshots repository PLA/PETG filament profiles, loads
  machine/process through `--load-settings`, and loads selected filament through
  dedicated `--load-filaments`. The digest binds normalized material
  plus selected filament JSON or explicit null. Orca success exposes nullable
  `filament_profile`, `filament_diameter_mm`, and
  `filament_density_g_cm3`. OpenAPI requires nullable `material_used_g`, which
  must be direct and never length-derived. Strict FDM requires positive time and
  length. Current Prusa FDM and profile-less Orca map a missing or recognized
  non-positive optional grams marker to null/manual, never zero. Selected-
  profile Orca still requires positive grams; recognized zero remains
  `GCODE_FILAMENT_NOT_POSITIVE` -> `SLICE_OUTPUT_UNPARSED`, and marker drift
  remains fail closed. Owner-supplied VPS evidence verifies the guard-only HTTP
  200/null path and the Orca mechanism's 0.00 g to 4.12 g correction. The
  combined local focused set passes 69/69; the final combined exact-image rerun
  remains pending.
- Keep W8 Orca calibration
  `BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER`: the retained P1S and H2D
  candidates identify as generic Marlin profiles, not verified native Bambu
  profiles. J2 supplies only their `256 x 256 x 250 mm` and
  `350 x 320 x 325 mm` physical envelopes. Nine numeric Bambu references plus
  the `M03` P1S-boundary result exist; the calibration runner fixes
  `--orient 0`, support off, and production machine/process `--load-settings`
  plus separate `--load-filaments`, but no Orca measurement, deploy, public route,
  or automatic-pricing acceptance is authorized.
- No-Origin service requests are allowed; browser-origin protected requests
  must match only their exact audience allowlist.
- /prusa/slice allows FDM and SLA based on layerHeight.
- /orca/slice is FDM-only and profile compatibility aware.
- /orca/slice resolves generated output from per-request isolated output directory before final filename alignment.
- /health is liveness. /ready is public minimal readiness only.
- /profiles is public and informational. Its v2 rows separate declared profile
  dimensions from `largest_passing_dimensions_inclusive_mm`, the inclusive
  admission authority, and resolve machines/fleets per engine. Slice routes
  remain authoritative; catalogue initialization failure returns typed 503
  without changing readiness or slice admission.
- J1C capability readiness is proposal-only: keep `/health` cheap, place future
  native slicing capability on public `/ready`, and require separate startup-
  smoke, Docker/VPS, typed per-engine failure, anti-DoS, and recovery/hysteresis
  evidence before implementation.
- /health/detailed, /operations/readiness, and /operations/metrics require the
  operations key. Readiness reason codes are stable and metrics labels are fixed.
- /health/detailed uses fresh readiness probes; /ready and
  /operations/readiness retain bounded caching.
- /admin/download/:fileName requires the artifact key and applies path safety guards.
- /admin/download/:fileName supports ALL token for ZIP bulk download while preserving extension allowlist, path/symlink containment checks, and MAX_ZIP_ENTRIES/MAX_ZIP_UNCOMPRESSED_BYTES limits.
- Unsupported routes return JSON 404 with ROUTE_NOT_FOUND.

## Endpoint and Middleware Chain Map

Public endpoints:

- GET /health -> handler
- GET /ready -> minimal readiness handler
- GET /pricing -> handler
- GET /profiles -> immutable startup snapshot / conditional 304 / non-critical typed 503
- GET /openapi.json -> handler
- GET /docs -> swagger-ui middleware chain
- GET / -> redirect to /docs

Slice-service-protected endpoints:

- POST /prusa/slice -> sliceRateLimiter -> requireSliceService -> allocate workspace -> multer.single(choosenFile) -> enqueue -> native processing
- POST /orca/slice -> sliceRateLimiter -> requireSliceService -> allocate workspace -> multer.single(choosenFile) -> enqueue -> native processing

Pricing-protected endpoints:

- POST /pricing/FDM -> adminRateLimiter -> pricing audience -> handler
- POST /pricing/SLA -> adminRateLimiter -> pricing audience -> handler
- PATCH /pricing/:technology/:material -> adminRateLimiter -> pricing audience -> handler
- DELETE /pricing/:technology/:material -> adminRateLimiter -> pricing audience -> handler

Artifact-protected endpoints:

- GET /admin/output-files -> adminRateLimiter -> artifact audience -> handler
- GET /admin/download/:fileName -> adminRateLimiter -> artifact audience -> handler

Operations-protected endpoints:

- GET /health/detailed -> adminRateLimiter -> operations audience -> handler
- GET /operations/readiness -> adminRateLimiter -> operations audience -> handler
- GET /operations/metrics -> adminRateLimiter -> operations audience -> handler

Queue and rate status semantics:

- MAX_CONCURRENT_SLICES defaults to 1; explicit values must be canonical
  decimal 1..3. N=2/N=3 are not yet host-qualified or deployed.
- RATE_LIMIT_EXCEEDED -> HTTP 429
- ADMIN_RATE_LIMIT_EXCEEDED -> HTTP 429
- SLICE_QUEUE_FULL -> HTTP 503
- SLICE_QUEUE_CLIENT_LIMIT -> HTTP 429
- SLICE_QUEUE_TIMEOUT -> HTTP 503
- FILE_PROCESSING_TIMEOUT -> HTTP 422

HTTP server defaults and inclusive bounds:

- HTTP_HEADERS_TIMEOUT_MS: 60000, bounded 1000..60000
- HTTP_REQUEST_TIMEOUT_MS: 600000, bounded 60000..600000
- HTTP_KEEP_ALIVE_TIMEOUT_MS: 5000, bounded 1000..60000
- HTTP_MAX_HEADERS_COUNT: 2000, bounded 16..2000
- HTTP_MAX_CONNECTIONS: 128, bounded 1..1024
- HTTP_MAX_REQUESTS_PER_SOCKET: 100, bounded 1..1000
- Actual VPS capacity and reverse-proxy timeouts remain UNVERIFIED.
- I6 validation selects an internal-only API with no host port/default route,
  an authenticated private peer, and calibrated API/native DNS/TCP/UDP denial.
  Async worker work is deferred; deployed topology remains UNVERIFIED.

## Local Rules

- Keep route handlers thin; put logic in services/.
- Keep error code vocabulary stable for clients.
- Keep queueing and rate-limit protections active.
- Preserve per-client queue fairness cap (MAX_SLICE_QUEUE_PER_IP).
- Keep protected x-api-key throttling active on pricing/artifact/operations routes.
- Keep slice authentication before workspace allocation and keep all auth events secret-safe.
- Keep profile selection followed by allowlisted Orca parent flattening and
  exact Prusa-byte/flattened-Orca job-scratch snapshotting before bounds/runtime
  use; do not replace original public basenames with snapshot names.
- Keep the versioned Orca parent copy semantically equal to the pinned native
  resources through the Docker build gate; do not add environment-dependent
  runtime root selection.
- Keep successful profile digests mandatory and keep the bounds/general OpenAPI
  422 branches disjoint.
- Keep `orientationMode` strict and backward-compatible by defaulting only
  omission to `auto`. Preserve the complete versioned transform contract on
  both success and bounds failure, the total-matrix multiplication order, and
  the final-height invariant.
- Keep ZIP input at exactly one supported source. Do not describe a multi-
  object 3MF as independently packable after it has been concatenated into one
  compound STL and passed without a split-to-objects operation. Keep Orca
  placement enabled but forbid unreported yaw with the
  exact one-token `--allow-rotations=0` form.
- Keep `/profiles` startup-only and request-cheap. Preserve its strong ETag,
  canonical `catalogue_sha256`, exact managed preset set, per-printer/per-engine
  envelopes, and no-manual-fleet-maximum shape. Do not make catalogue readiness
  a prerequisite for slicing. Keep v2 FDM-only and never publish the generic
  SLA fallback as a printer envelope. Preserve the engine-generic selector,
  path-free component chain, digest-schema marker, declared-profile metadata,
  exact inclusively named admission ceiling, and engine-scoped resolutions.
- Keep `H2D-QUOTE` on both engines as P1S-derived quote-only physics. Never
  describe it as machine-accurate H2D output or production H2D G-code. Do not
  promote the measured-A Prusa `350 x 320 x 324.9 mm` or Orca
  `347.9 x 317.9 x 324.9 mm` values to final-admission-B or owner-VPS proof.
- Keep no-Origin service behavior and exact per-audience browser-origin allowlists.
- Keep trust proxy fail closed and request-ID validation before observability/CORS.
- Keep readiness diagnostics and metrics operations-scoped; never add
  request/job/artifact/customer identifiers as metric labels.
- Do not bypass geometry validation rules.
