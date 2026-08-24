# App Folder - Local Claude Guide

Last synchronized: 2026-08-24

## Scope

This document describes the application runtime inside app/.

## Runtime Summary

- HTTP stack: bounded Node HTTP server + Express + helmet + method-aware
  audience CORS + validated request ID + lifecycle observability + global error handler.
- Upload flow: slice limiter, x-slicer-api-key authentication, root-scoped workspace allocation, route-level multer single-file upload on choosenFile, queueing, option validation, conversion/orientation, transform, native slicing, stats parsing, and pricing response.
- Slicing engines: PrusaSlicer (FDM/SLA) and OrcaSlicer (FDM only).
- Runtime folder contract: root-scoped input/, output/, configs/ only.

## Detailed JavaScript File Responsibilities

### Bootstrap and wiring

- app/server.js
  - Resolves one immutable active/previous key ring for slice, pricing, artifact,
    and operations audiences; invalid or legacy-overbroad configuration refuses startup.
  - Applies helmet policies (standard for API, dedicated CSP for /docs and /openapi.json).
  - Compiles fail-closed trust proxy from TRUST_PROXY + TRUST_PROXY_CIDRS.
  - Applies exact per-audience CORS while allowing requests without Origin,
    validates/propagates X-Request-Id, and observes request settlement.
  - Creates one bounded Node HTTP server before listening.
  - Registers JSON and urlencoded body limits, Swagger endpoints, business routes, 404 handler, and global error handler.

### Configuration modules

- app/config/constants.js
  - Defines DEFAULTS for rate limits, queue limits, upload limits, command/HTTP timeouts, HTTP connection/header/socket limits, layer heights, and default materials.
  - Defines the inclusive application concurrency range `1..3`; the default
    remains `MAX_CONCURRENT_SLICES=1`.
  - Defines extension groups, Orca process-profile defaults, and default pricing matrix.
- app/config/resource-policy.js
  - Treats an omitted `MAX_CONCURRENT_SLICES` as default `1` and accepts an
    explicit value only as a canonical positive decimal integer in `1..3`.
  - Rejects malformed, non-canonical, unsafe, or out-of-range explicit values
    during startup validation.
- app/config/service-auth.js
  - Requires distinct 32-256 printable-ASCII active keys for slice, pricing,
    artifact, and operations; optional previous slots enable bounded rotation.
  - Rejects missing, malformed, placeholder-like, reused, or duplicate material generically.
  - Allows ADMIN_API_KEY only as a <=90-day migration for one named non-slice audience.
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
  - Compares supplied material against active and previous SHA-256 digests for
    one audience and emits bounded rejection metadata.
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
- app/services/slice/common.js
  - Shared helpers for supported extensions, deterministic output naming, isolated Orca output dirs, file alignment, and cleanup.
- app/services/slice/engine.js
  - Resolves slicer executable name by engine.
  - Builds argument arrays for Prusa and Orca commands.
- app/services/slice/errors.js
  - Classifies pipeline failures (geometry, zip, timeout, unsupported format, Orca profile mismatch).
  - Converts exceptions to stable API error responses.
- app/services/slice/input-processing.js
  - Converts supported model/CAD inputs to STL via Python scripts.
  - Runs orientation optimization with graceful fallback.
- app/services/slice/model-stats.js
  - Reads model dimensions and parses slicer outputs for print-time/material stats.
  - Builds SLA print-time estimates when metadata is absent.
- app/services/slice/native-runtime-status.js
  - Owns the process-local fail-closed native-runtime quarantine and publishes
    its bounded subscription/unsubscription seam.
- app/services/slice/number-utils.js
  - Shared positive-integer parsing plus bounded canonical concurrency parsing.
- app/services/slice/options.js
  - Validates request fields: layerHeight, material, infill, size/scale/rotation, unit, and profile overrides.
  - Enforces engine/technology layer constraints and material-technology compatibility.
- app/services/slice/profiles.js
  - Resolves Prusa and Orca profile selection.
  - Validates profile existence.
  - Creates runtime profile variants and resolves build-volume limits from profile metadata.
- app/services/slice/response.js
  - Composes successful slice response payloads.
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
  - Builds transform plan (scale/rotation), applies model transform via Python script, and validates final bounds against build-volume limits.
- app/services/slice/value-parsers.js
  - Normalizes numeric/boolean/unit inputs and sanitizes profile override filenames.
- app/services/slice/zip.js
  - Performs ZIP guard checks (entry count, cumulative uncompressed size, path safety, encryption rejection, exact single supported source file requirement).

### Utilities and docs generation

- app/utils/client-ip.js
  - Provides normalized client IP retrieval using Express trust-proxy behavior.
- app/utils/logger.js
  - Provides structured error logging helper for processing failures.
- app/docs/swagger-docs.js
  - Generates OpenAPI document used by /openapi.json and Swagger UI /docs.

## Python Helper Scripts in app/

- app/cad2stl.py: CAD-to-STL conversion.
- app/mesh2stl.py: mesh normalization to STL.
- app/orient.py: orientation optimization for printability.
- app/scale_model.py: scale/rotation transform execution.

## Endpoint Behavior Notes

- Upload field name must stay choosenFile (multer single-file mode with extension filter).
- Active slice, pricing, artifact, and operations keys are mandatory, unique,
  32-256 printable-ASCII bytes, and non-placeholder. Each audience accepts only
  its optional previous rotation slot.
- Missing/wrong x-slicer-api-key returns HTTP 401 with `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}` before workspace/upload/queue/native side effects.
- No-Origin service requests are allowed; browser-origin protected requests
  must match only their exact audience allowlist.
- /prusa/slice allows FDM and SLA based on layerHeight.
- /orca/slice is FDM-only and profile compatibility aware.
- /orca/slice resolves generated output from per-request isolated output directory before final filename alignment.
- /health is liveness. /ready is public minimal readiness only.
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
- Keep no-Origin service behavior and exact per-audience browser-origin allowlists.
- Keep trust proxy fail closed and request-ID validation before observability/CORS.
- Keep readiness diagnostics and metrics operations-scoped; never add
  request/job/artifact/customer identifiers as metric labels.
- Do not bypass geometry validation rules.
