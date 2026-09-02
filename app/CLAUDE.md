# App Folder - Local Claude Guide

Last synchronized: 2026-09-02

## Scope

This document describes the application runtime inside app/. The exact
numbers behind every rule live in the root `CLAUDE.md` "Current contract";
this file maps them to modules.

## Runtime Summary

- HTTP stack: bounded Node HTTP server + Express + helmet + method-aware
  audience CORS + validated request ID + lifecycle observability + global error handler.
- Slice flow: slice limiter (principal-keyed, IP fallback), x-slicer-api-key
  authentication, root-scoped workspace allocation, route-level multer
  single-file upload on choosenFile, option/profile validation before enqueue,
  queueing, conversion, versioned orientation capture, transform/placement/
  bounds validation, native slicing, stats parsing, and pricing response.
- Engines: PrusaSlicer 2.8.1 (FDM/SLA), OrcaSlicer 2.3.1 (FDM), Bambu Studio
  02.08.02.61 (FDM, official vendor chain, API-owned placement).
- Preview: `POST /render` shares the slice limiter, authentication, upload
  lifecycle, and queue, and answers a deterministic 1024 x 768 PNG.
- Public profile catalogue: immutable startup generation (82 rows) for
  machine-bound, server-owned FDM presets; strong ETag/body digest;
  non-critical typed 503.
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
  - Resolves all three engine versions atomically, validates the Bambu
    registry and vendor chain (typed startup failure otherwise), attempts
    non-critical profile-catalogue initialization, then registers JSON/
    urlencoded limits, Swagger endpoints, slice/render/pricing/catalogue/
    system routes, 404 handler, and global error handler.

### Configuration modules

- app/config/constants.js
  - DEFAULTS for rate limits (3/60 s, burst 5; admin 30/60 s), queue limits
    (100, 5 per client, 300000 ms wait, concurrency 1 in `1..3`), upload
    limits, command/HTTP timeouts (keep-alive 95000 ms), layer heights, default
    materials, Orca process/filament maps, `BAMBU_DEFAULT_PROFILES_ROOT`.
  - `MAX_BUILD_VOLUMES.FDM = 350 x 320 x 325`, `MIN_BUILD_VOLUMES = 1 mm`.
  - Validation-only inclusive ceilings: `P1S_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM`
    (Prusa `256 x 256 x 249.9`, Orca `253.9 x 253.9 x 249.9`),
    `H2D_QUOTE_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM` (Prusa
    `350 x 320 x 324.9`, Orca `347.9 x 317.9 x 324.9`),
    `BAMBU_LARGEST_PASSING_DIMENSIONS_INCLUSIVE_MM` (P1S `256 x 228 x 250`,
    H2D `325 x 320 x 325`) and `BAMBU_P1S_ALTERNATIVE_FOOTPRINT_INCLUSIVE_MM`
    (`238 x 256`).
- app/config/resource-policy.js
  - Canonical positive-integer parsing with inclusive bounds for body,
    upload (`UPLOAD_TOTAL_TIMEOUT_MS` 600000 in 1000..600000), multipart,
    ZIP/3MF, model/output/profile/pricing reads, stats ceilings, artifact
    retention, cleanup, `MAX_MODEL_DIMENSION_MM` (10000 in 350..100000), and
    `MAX_CONCURRENT_SLICES`; invalid explicit values refuse startup.
- app/config/service-auth.js
  - Requires pricing, artifact, and operations actives plus one complete
    `SLICE_SERVICE_AUTH_MODE`; all configured material is globally unique and
    32-256 printable ASCII; `ADMIN_API_KEY` is a <=90-day one-audience
    non-slice migration only.
- app/config/route-policy.js
  - Classifies protected routes by normalized method/path, including OPTIONS
    requested method; `POST /render` is slice audience.
- app/config/trust-proxy.js
  - Accepts only explicit validated IP/CIDR entries or loopback.
- app/config/paths.js
  - Resolves absolute runtime paths for input/, output/, configs/, and pricing
    state; ensures required directories exist.
- app/config/python.js
  - Resolves PYTHON_EXECUTABLE securely (absolute existing path or the
    VIRTUAL_ENV / known absolute fallbacks).

### Middleware

- app/middleware/rateLimit.js
  - Token-bucket throttling keyed on the frozen `req.slicePrincipal` slot
    with IP fallback (slice) and per IP (admin); adaptive cooldown up to 30 s;
    HTTP 429 + Retry-After + retryAfterSeconds; periodic bucket pruning.
- app/middleware/requireAdmin.js
  - Pricing, artifact, and operations x-api-key guards from the startup ring.
- app/middleware/requireAudience.js
  - Fixed-length SHA-256 slot comparison and bounded rejection metadata;
    migration shared slots expire at exact request time.
- app/middleware/requireSliceService.js
  - Enforces x-slicer-api-key for the three slice routes and `/render`,
    attaches frozen `req.slicePrincipal {audience, slot}`, returns exact
    HTTP 401 `SLICE_SERVICE_AUTH_REQUIRED`, logs only requestId + client IP.
- app/middleware/corsPolicy.js
  - Allows no-Origin requests; browser origins only from the classified
    audience's allowlist (403 `*_CORS_ORIGIN_NOT_ALLOWED`).
- app/middleware/requestId.js
  - Bounded safe inbound request-ID; replaces invalid input.
- app/middleware/requestObservability.js
  - Request accepted/rejected/completed events and fixed-cardinality outcomes.
- app/middleware/errorHandler.js
  - Normalizes CORS, payload parse/size, multer, upload abort (400
    `UPLOAD_REQUEST_ABORTED`), upload lifetime (408 `UPLOAD_TOTAL_TIMEOUT`),
    and slice/artifact validation errors into the stable JSON shape.

### Routes

- app/routes/slice.routes.js
  - `POST /prusa/slice`, `POST /orca/slice`, `POST /bambu/slice`:
    sliceRateLimiter -> requireSliceService -> upload lifecycle (workspace,
    multer.single('choosenFile'), deadline, cleanup) -> validation -> queue ->
    native handler.
- app/routes/upload-lifecycle.js
  - Shared workspace/multer/deadline/cleanup lifecycle for slice and render.
- app/routes/render.routes.js
  - `POST /render`: sliceRateLimiter -> requireSliceService -> upload
    lifecycle -> render handler on the shared slice queue.
- app/routes/pricing.routes.js + pricing-request.js
  - Public GET /pricing; pricing-scoped mutations with adminRateLimiter and
    stable `errorCode` values (`INVALID_TECHNOLOGY`, `INVALID_MATERIAL`,
    `INVALID_PRICE`, `MATERIAL_NOT_FOUND`, `MATERIAL_ALREADY_EXISTS`,
    `PRICING_PERSISTENCE_FAILED`).
- app/routes/profile-catalogue.routes.js
  - Public GET /profiles: immutable startup snapshot, strong ETag, 304, and
    no-store 503 `PROFILE_CATALOGUE_UNAVAILABLE`.
- app/routes/system.routes.js + admin-download.handlers.js
  - Public GET /health and minimal GET /ready; operations-scoped
    /health/detailed, /operations/readiness, /operations/metrics;
    artifact-scoped /admin/output-files and /admin/download/:fileName
    (`.gcode`, `.sl1`, `.gcode.3mf`; `ALL` ZIP export).

### Services: top-level

- app/services/pricing.service.js, pricing/repository.js, pricing/catalog.js
  - Facade, atomic file persistence, and in-memory catalog. An existing
    pricing file is authoritative: defaults seed only a missing or empty file,
    a deleted material never resurrects, `getRate` fails closed with `null`.
- app/services/slice.service.js
  - Slice orchestrator: validates upload/options/profile before enqueue,
    resolves the queue key (`principal:<slot>` or client IP), runs the
    pipeline, maps queue errors (`SLICE_QUEUE_CLIENT_LIMIT` carries
    Retry-After).
- app/services/render.service.js
  - Composes the slice pipeline's conversion, orientation, transform, and
    bounds (largest FDM envelope) steps, runs `render_preview.py` through a
    dedicated 60 s command runner, bounded-reads and validates the PNG
    (lstat/realpath/signature, 8 MiB cap), and streams `image/png` with
    `Cache-Control: no-store`; timeouts map to 422 `FILE_PROCESSING_TIMEOUT`.
- app/services/admin-output.service.js
  - Artifact listing/download validation and ALL-token ZIP limits.
- app/services/http-server.js
  - Validated Node HTTP timeouts (keep-alive default 95000 ms, maximum
    120000 ms) and connection/header/socket bounds before listen.
- app/services/readiness.service.js
  - Cached admission-aware queue/native/storage/retention/pricing/config
    probes (including `configs/bambu`) for /ready and /operations/readiness;
    fresh probes for /health/detailed; stable reason codes.
- app/services/runtime-lifecycle.js
  - Single-flight shutdown and native-runtime quarantine: closes admission,
    drains at most 10 s, exits with status 70 through an injectable seam.
- app/services/artifact-*.js
  - Managed artifact metadata, leases, retention policy, and store; the
    post-slice retention sweep is non-fatal (`RETENTION_UNSAFE` on failure).
- app/services/observability/
  - Bounded correlation, versioned allowlisted events (fixed vocabulary
    including `orientation.fallback`), fixed-cardinality metrics.

### Services: slice submodules

- bambu-printer-registry.js: loads and validates `configs/bambu/printers.json`
  (`r3d-bambu-printer-registry-v1`), exposes printers, layer keys, process and
  filament names, `bed_type`.
- bambu-profile-chain.js: flattens the vendor `inherits`/include chain from
  `/opt/bambustudio/resources/profiles/BBL` or absolute `BAMBU_PROFILES_ROOT`
  with bounded reads, role containment, cycle/name/role/depth checks.
- bambu-bed-geometry.js: derives printable area, first-extruder area, and
  `bed_exclude_area` rectangles from the flattened vendor machine.
- bambu-placement.js: deterministic centre / shift +Y / shift +X / reject
  placement; admits the L-shaped P1S footprint through real placement.
- command.js: execFile runner with minimal child environment, bounded
  `SLICE_COMMAND_TIMEOUT_MS` (1000..3600000), 120 s Python helper budget
  clamped to the native budget, maxBuffer overflow as `NATIVE_OUTPUT_OVERFLOW`,
  bounded stdout/stderr retained separately on failure.
- process-tree.js: TERM-to-KILL group termination; post-SIGKILL settle polls
  up to 10 s and re-kills once.
- engine.js: executable names and invocation policies (Prusa export flags;
  Orca `--load-settings`/`--load-filaments`, `--arrange 1 --orient 0
  --allow-rotations=0`; Bambu `--curr-bed-type`, `--export-3mf`, `--arrange 0
  --orient 0`, never `--allow-rotations`).
- engine-version.js: atomic pre-listen `--help` version resolution for all
  three executables.
- errors.js: stable error mapping (converter `INVALID_SOURCE_GEOMETRY|` marker
  -> 400; `UNSLICEABLE_SOURCE_GEOMETRY` 422 from native faulty-mesh/model-load
  diagnostics on either stream; only real timeouts -> `FILE_PROCESSING_TIMEOUT`;
  `NATIVE_OUTPUT_OVERFLOW` 500; K2 bounds via native-bounds.js).
- filament-profile.js: Orca PLA/PETG/ABS/TPU profile selection and
  diameter/density; Bambu uses the registry's vendor filament names.
- gcode-metrics.js: time markers ranked `total_estimated_time`,
  `m73_p0_r_minutes`, `estimated_printing_time`, `time_seconds`; Bambu and
  Orca mass/length markers; grams never derived from length.
- input-processing.js: conversion (`cad2stl.py`, `mesh2stl.py` with 3MF
  units and compound STL), `auto`/`preserve` orientation, bounded sidecar,
  `fallback_unmodified` with one `orientation.fallback` event.
- model-stats.js: measured/unavailable dimension results, strict FDM stats,
  SLA estimates (`sla_sl1_metadata_estimate`, `sla_synthetic_estimate`).
- native-bounds.js: explicit placement/print-volume diagnostics (including
  Bambu rc 192/190) -> full schema-2 K2 422 payload.
- options.js: strict `layerHeight`, `material`, `infill` (integer 0..100,
  optional `%`), `supports` (default true), `orientationMode`, sizing,
  rotation, Bambu `printerProfile`/`processProfile` against the registry.
- orientation-contract.js: rotation-only matrices, `transform_schema: 2`,
  original-availability invariant, `R_total = R_requested * R_automatic`.
- output-lifecycle.js: artifact promotion (`.gcode`, `.sl1`, `.gcode.3mf`),
  Prusa exit-zero/no-artifact safety net, non-fatal retention sweep.
- profiles.js, profile-snapshot.js, profile-digest.js,
  orca-profile-inheritance.js: selection, job-scratch snapshots, runtime
  derivation (Prusa INI `temperature` keys; Orca relative extrusion; Bambu
  layer/support overrides), and the effective digest that excludes request
  layer height/infill (default `supports=true` is digest-neutral).
- profile-catalogue.js: immutable 82-row `r3d-profile-catalogue-v2` with
  engine-scoped machine/fleet resolutions.
- queue.js, queue-scheduler.js: bounded FIFO with per-key fairness,
  timeouts, quarantine drain, `SLICE_QUEUE_SHUTDOWN`.
- response.js: success payload (engine version, digest, schema-2 transform,
  inclusive limits, Bambu `placement_mm` and `bed_type`), integer quarter-hour
  price rounding, SLA/manual `null` pricing.
- transform.js: sizing (fit-within-box), request rotation, placement, bounds,
  complete `model_transform` for success and K2.
- zip.js, zip-policy.js, zip-open.js, zip-stream.js, three-mf.js: exactly one
  supported source, junk tolerance, case-insensitive 3MF roots, Bambu/Orca
  project parts under `Metadata/` and `Auxiliaries/`.
- workspace*.js, helper-paths.js, child-environment.js, value-parsers.js,
  number-utils.js, common.js, sl1-stats.js, native-runtime-status.js
  (`QUARANTINE_EXIT_CODE = 70`), request-abort.js, resource-errors.js.

### Utilities and docs generation

- app/utils/client-ip.js, app/utils/logger.js, app/utils/bounded-file.js.
- app/docs/swagger-docs.js composes slice-openapi.js (three slice paths,
  schema-2 transform, `placement_mm`, complete error enums),
  render-openapi.js, pricing-openapi.js, profile-catalogue-openapi.js,
  admin-openapi.js, and system-openapi.js for /openapi.json and /docs.

## Python Helper Scripts in app/

- app/cad2stl.py: CAD-to-STL conversion; prints `INVALID_SOURCE_GEOMETRY|<reason>` and exits 2 on invalid geometry.
- app/mesh2stl.py: OBJ/3MF normalization to STL; honours 3MF `unit`, uses
  `Scene.to_mesh()`, concatenates multi-object scenes; same marker contract.
- app/orient.py: `auto`/`preserve` orientation plus bounded, versioned
  rotation-matrix sidecar output.
- app/scale_model.py: scale/rotation transform plus the strictly ordered
  `--place-min-x X --place-min-y Y` placement pair.
- app/render_preview.py: numpy + Pillow orthographic renderer (1024 x 768,
  isometric, plate grid, dimension caption), byte-identical for identical
  input, O_EXCL output, deterministic face cap, no repair.
- Every helper runs under a 120 s budget clamped to the native budget.

## Endpoint Behavior Notes

- Upload field name must stay choosenFile (multer single-file mode with extension filter).
- All slice-service routes accept exactly one x-slicer-api-key header;
  x-api-key is not an alias. Missing/wrong/expired-shared credentials return
  HTTP 401 `SLICE_SERVICE_AUTH_REQUIRED` before workspace/upload/queue/native
  side effects.
- Option and profile validation answers 400 before queue admission.
- Every success carries `engine_version`, lowercase 64-hex
  `profiles.effective_profile_sha256`, `supports`, schema-2 `model_transform`,
  inclusive `build_volume_limits_mm`, and `stats.object_height_mm` equal to
  final Z; Bambu adds `placement_mm`.
- /prusa/slice allows FDM and SLA by layerHeight; SLA is quote-only (null mass,
  rate, price).
- /orca/slice is FDM-only, profile-compatibility aware, resolves output from a
  per-request isolated directory, and prices all four FDM materials.
- /bambu/slice is FDM-only, registry-bound (`P1S`/`H2D`, registry layer keys,
  optional vendor `processProfile`), places the model itself, and retains
  `.gcode.3mf`.
- /render returns `image/png` with the slice error envelope on failure.
- /profiles is public and informational; catalogue failure never gates slicing.
- /health is liveness; /ready is minimal; /health/detailed is fresh; the
  operations routes require the operations key.
- Unsupported routes return JSON 404 with ROUTE_NOT_FOUND.

## Queue, Rate, and Runtime Semantics

- RATE_LIMIT_EXCEEDED, ADMIN_RATE_LIMIT_EXCEEDED, SLICE_QUEUE_CLIENT_LIMIT -> HTTP 429 with Retry-After
- SLICE_QUEUE_FULL, SLICE_QUEUE_TIMEOUT, SLICE_QUEUE_SHUTDOWN -> HTTP 503
- FILE_PROCESSING_TIMEOUT, UNSLICEABLE_SOURCE_GEOMETRY, MODEL_OUT_OF_PRINTER_BOUNDS, MODEL_DIMENSIONS_UNAVAILABLE -> HTTP 422
- NATIVE_OUTPUT_OVERFLOW, SLICE_OUTPUT_UNPARSED -> HTTP 500
- HTTP_HEADERS_TIMEOUT_MS 60000 [1000,60000]; HTTP_REQUEST_TIMEOUT_MS 600000
  [60000,600000]; HTTP_KEEP_ALIVE_TIMEOUT_MS 95000 [1000,120000];
  HTTP_MAX_HEADERS_COUNT 2000 [16,2000]; HTTP_MAX_CONNECTIONS 128 [1,1024];
  HTTP_MAX_REQUESTS_PER_SOCKET 100 [1,1000].
- Actual VPS capacity and reverse-proxy timeouts are owner-verified facts.

## Local Rules

- Keep route handlers thin; put logic in services/.
- Keep error code vocabulary stable for clients; new codes need OpenAPI,
  README, and integration-guide updates.
- Keep queueing and rate-limit protections active on every slice-service
  route, including /render.
- Keep principal-keyed fairness (`MAX_SLICE_QUEUE_PER_IP` applies per
  principal slot with IP fallback).
- Keep slice authentication before workspace allocation and keep all auth
  events secret-safe.
- Keep validation before enqueue; never let a 400 consume a queue slot.
- Keep profile selection followed by snapshotting (exact Prusa bytes,
  flattened Orca or Bambu chains) before bounds/runtime/digest/native use; do
  not replace original public basenames with snapshot names.
- Keep Orca at `--arrange 1 --orient 0 --allow-rotations=0` and Bambu at
  `--arrange 0 --orient 0` with API-owned placement; never let a native engine
  add an unreported rotation.
- Keep the measured inclusive ceilings and the L-shaped P1S admission; never
  promote them to physical-print proof.
- Keep `/profiles` startup-only, engine-scoped, FDM-only, and never a
  prerequisite for slicing.
- Keep the pricing file authoritative and the price formula in integer
  arithmetic.
- Keep readiness diagnostics and metrics operations-scoped; never add
  request/job/artifact/customer identifiers as metric labels.
- Do not bypass geometry validation rules; never repair geometry.
