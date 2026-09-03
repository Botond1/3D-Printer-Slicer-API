# 3D Printer Slicer API - Copilot Instructions

Last synchronized: 2026-09-03

## Architecture Notice
This repository uses both GitHub Copilot and Claude as primary agentic tools.
When architecture rules or domain constraints change in this file, keep these files synchronized:
- CLAUDE.md
- .claude/CLAUDE.md
- .github/agents/* and .claude/agents/*
- .github/skills/*
- .claude/skills/*
- .github/instructions/*

## Goal
Provide a reliable slicing, preview, and pricing API for 3D printing workflows with strict safety and predictable behavior.

## Current Contract (3.3.0, 2026-09-03)

Every retained hard rule is stated once here with its exact value. The
pre-3.2.0 checkpoint narrative (J0..J3B, I10..I12, Hostinger route activation)
is preserved verbatim in `docs/codex/history-waves.md`; per-wave evidence stays
under `docs/codex/evidence/`.

### Engines and native invocation
- Three engines: PrusaSlicer 2.8.1 (FDM + SLA), OrcaSlicer 2.3.1 (FDM), Bambu
  Studio 02.08.02.61 (FDM) at `/opt/prusaslicer`, `/opt/orcaslicer`,
  `/opt/bambustudio` (root-owned, read-only). `bambu-studio` is reached through
  the root-owned 0555 wrapper `/usr/local/bin/bambu-studio`, which starts a
  private Xvfb only for `--export-3mf`; the runtime stage installs `xvfb`,
  `libgl1`, `libgl1-mesa-dri`, `libglx-mesa0`, `libgstreamer1.0-0`,
  `libgstreamer-plugins-base1.0-0`. Both Compose manifests set `init: true`.
  Candidate provenance evidence schema is `i7-s3a-candidate-provenance-v2`.
- Startup atomically verifies all three executables' versions from bounded
  `--help` output before listen; every success carries `engine_version`.
- Prusa receives already transformed geometry and adds no native rotation.
  Its INIs carry per-material density and `temperature` keys; section/key case
  is significant and exact duplicate qualified keys fail closed.
- Orca: `--load-settings machine;process`, selected filament through
  `--load-filaments`, `--arrange 1 --orient 0` and exactly one single-token
  `--allow-rotations=0`. The allowlisted v2.3.1 `Custom` parent chain is a
  versioned repository copy verified byte-equal at image build; runtime
  derivation clears `layer_gcode` and sets `use_relative_e_distances='1'`.
  Filament profiles exist for PLA (1.24), PETG (1.27), ABS (1.04), TPU (1.24
  g/cm3), all 1.75 mm, so all four FDM materials price on every engine.
- Bambu: registry `configs/bambu/printers.json` (schema
  `r3d-bambu-printer-registry-v1`) maps `P1S` (default) and `H2D` to exact
  vendor machine/process/filament names. Layer keys: P1S `0.08`, `0.1`,
  `0.12`, `0.16`, `0.2`, `0.24`, `0.28`; H2D `0.08`, `0.1`, `0.12`, `0.16`,
  `0.2`, `0.24` (`0.1` uses the vendor 0.12 mm process with the layer height
  overridden). Materials PLA/PETG/ABS/TPU map to the official `Generic`
  filaments (`@BBL H2D` variants on the H2D). The vendor chain is flattened
  fail-closed from `/opt/bambustudio/resources/profiles/BBL` or absolute
  `BAMBU_PROFILES_ROOT`; an invalid registry or chain refuses startup. The
  invocation is `--curr-bed-type`, `--export-3mf` (relative to
  `--outputdir`), `--arrange 0 --orient 0`, never `--allow-rotations`.
- Bambu placement is API-owned (`bambu-bed-geometry.js`,
  `bambu-placement.js`, `scale_model.py --place-min-x X --place-min-y Y`) and
  reported as `placement_mm {x_min, y_min}`. Measured inclusive ceilings: P1S
  `256 x 228 x 250` with the alternative footprint `238 x 256` (the bed
  excludes an `18 x 28 mm` corner at the origin, so admission is L-shaped);
  H2D `325 x 320 x 325` (single-filament first-extruder area). Z `250.0` /
  `325.0` pass; `+0.1 mm` on any axis fails. Native rc 192/190 refusals map to
  the K2 `MODEL_OUT_OF_PRINTER_BOUNDS` payload.
- Retained artifacts: Prusa `.gcode` / `.sl1`, Orca `.gcode`, Bambu
  printer-ready `.gcode.3mf`; all three extensions are valid for naming,
  listing, and download.
- P1S ceilings for the generic-Marlin engines stay Prusa `256 x 256 x 249.9`
  and Orca `253.9 x 253.9 x 249.9`; `H2D-QUOTE` stays Prusa `350 x 320 x 324.9`
  and Orca `347.9 x 317.9 x 324.9`, P1S physics on an H2D-sized declared bed,
  quote-only, never production H2D G-code. Prusa's native X/Y edge beyond its
  declared bed is `UNESTABLISHED`.

### Request contract
- `multipart/form-data`, single file field `choosenFile`; formats `.stl`,
  `.obj`, `.3mf`, `.stp`, `.step`, `.igs`, `.iges`, `.ply`, `.zip`. An outer
  ZIP admits exactly one supported source and tolerates `__MACOSX/`,
  `.DS_Store`, `Thumbs.db`, `desktop.ini`, and directory entries; 3MF roots
  match case-insensitively and Bambu/Orca project parts under `Metadata/` and
  `Auxiliaries/` are admitted. `mesh2stl.py` honours the 3MF `unit` attribute
  and concatenates a multi-object scene into one compound STL (no
  split-to-objects). Converters print `INVALID_SOURCE_GEOMETRY|<reason>` on
  stdout and stderr with exit 2, mapped to HTTP 400 `INVALID_SOURCE_GEOMETRY`.
  Geometry is never repaired.
- `supports` defaults to `true` on all engines; any other present non-empty
  value than `true`/`false` is HTTP 400 `INVALID_SUPPORTS`. `infill` is a
  strict integer `0..100` with an optional trailing `%`, never clamped,
  otherwise `INVALID_INFILL`. `orientationMode` is exact `auto|preserve`,
  omission defaults to `auto`, otherwise `INVALID_ORIENTATION_MODE`.
  `keepProportions=true` with several target axes fits within the box
  (smallest ratio); `scalePercent` and `targetSizeX/Y/Z` are mutually
  exclusive. Bambu `printerProfile` (`printer` alias) is `P1S|H2D`
  case-insensitive, otherwise `INVALID_PRINTER_PROFILE`; an unknown vendor
  `processProfile` is `INVALID_PROCESS_PROFILE`; a material without a vendor
  mapping is `MATERIAL_PROFILE_UNAVAILABLE`.
- Option and profile validation runs before queue admission; a 400 never
  consumes a queue slot. Route order is rate limiter -> `x-slicer-api-key`
  authentication -> root-scoped workspace -> Multer -> validation -> queue ->
  native processing.
- `POST /render` (slice auth, shared limiter and queue) returns a deterministic
  1024 x 768 `image/png` (`Cache-Control: no-store`) of the final pose via
  `app/render_preview.py` (numpy + Pillow 12.3.0) with a 60 s budget; bounds
  use the largest FDM envelope `350 x 320 x 325 mm`; timeouts map to 422
  `FILE_PROCESSING_TIMEOUT`.

### Response contract
- `model_transform` is `transform_schema: 2` on success and on the full K2
  `MODEL_OUT_OF_PRINTER_BOUNDS` 422 (which also carries `model_dimensions_mm`
  and `build_volume_limits_mm`). `original_dimensions_available` is `true` iff
  `original_dimensions_mm` is a real measurement and `false` iff it is `null`;
  never substitute oriented dimensions. Oriented/final dimensions must be
  positive with `height_mm == z`, otherwise 422 `MODEL_DIMENSIONS_UNAVAILABLE`.
  The rotation-only matrix is `R_total = R_requested * R_automatic`;
  `stats.object_height_mm == final_dimensions_mm.z` always.
  `orientation_outcome` is `applied`, `unchanged`, `preserved`, or
  `fallback_unmodified`, and every fallback emits one bounded
  `orientation.fallback` event (fixed vocabulary).
- Success requires lowercase 64-hex `profiles.effective_profile_sha256`
  (machine/process/filament content plus normalized material and invocation
  policy, excluding the request `layerHeight`/`infill` overrides; the default
  `supports=true` is digest-neutral while `supports=false` is a different
  effective profile); public profile fields keep original basenames. Bambu responses add `printer`, vendor
  `machine_profile` / `process_profile` / `filament_profile`, diameter,
  density, and `bed_type`.
- `stats.print_time_source` ranks `total_estimated_time` first (Orca and Bambu
  report wall clock including the start sequence), then `m73_p0_r_minutes`,
  `estimated_printing_time` (Prusa's generic profile), `time_seconds`; SLA
  (Elegoo Saturn 4 Ultra quoting) always uses `sla_layer_time_model`, a
  deterministic layer-count model (`configs/sla/printers.json`).
  `material_used_g` comes only from a direct positive mass marker, never from
  length, except SLA's derived resin mass (parsed volume x registered resin
  density, always positive); zero is never published. Orca/Bambu with a
  selected filament profile require positive grams (missing/drifted -> 500
  `SLICE_OUTPUT_UNPARSED`).
- Price: `ceil(max(print_time_seconds, 900) * hourly_rate / 3600)` rounded up
  to 10 HUF in integer arithmetic (1980 s at 800 HUF/h is 440, formerly 450).
  `hourly_rate` and `estimated_price_huf` are `null` for FDM without a
  positive mass or a profile-less Orca material. SLA always has a positive
  resin mass and prices automatically like FDM; its SL1 raster output remains
  quote-only (a real print needs an external UVtools conversion).
- Error statuses: 408 `UPLOAD_TOTAL_TIMEOUT`; 422 `UNSLICEABLE_SOURCE_GEOMETRY`
  (native faulty-mesh/model-load diagnostics, stdout and stderr, path-free
  `detail`), `FILE_PROCESSING_TIMEOUT` only on real timeouts (message names no
  fixed duration); 429 `RATE_LIMIT_EXCEEDED`, `ADMIN_RATE_LIMIT_EXCEEDED`,
  `SLICE_QUEUE_CLIENT_LIMIT` all with `Retry-After` and `retryAfterSeconds`;
  500 `NATIVE_OUTPUT_OVERFLOW`, `SLICE_OUTPUT_UNPARSED`,
  `INTERNAL_PROCESSING_ERROR`, `QUEUE_INTERNAL_ERROR`, `UPLOAD_STORAGE_ERROR`,
  `INTERNAL_SERVER_ERROR`; 503 `SLICE_QUEUE_FULL`, `SLICE_QUEUE_TIMEOUT`,
  `SLICE_QUEUE_SHUTDOWN`, `PROFILE_CATALOGUE_UNAVAILABLE`. Pricing routes
  return `INVALID_TECHNOLOGY`, `INVALID_MATERIAL`, `INVALID_PRICE`,
  `MATERIAL_NOT_FOUND`, `MATERIAL_ALREADY_EXISTS`, `PRICING_PERSISTENCE_FAILED`.

### Catalogue, pricing state, retention
- `GET /profiles` is `r3d-profile-catalogue-v2` with 88 rows: 82 FDM rows (6
  Prusa, 24 Orca, 28 Bambu P1S, 24 Bambu H2D) plus 6 Elegoo Saturn 4 Ultra SLA
  quoting rows (prusa, 2 layer heights x 3 resins). Rows keep
  `declared_build_volume_dimensions_mm` (metadata) separate from the inclusive
  admission authority `largest_passing_dimensions_inclusive_mm`;
  `machine_resolutions` and `fleet_resolutions` are engine-scoped (fleets:
  bambu -> H2D, orca and prusa -> H2D-QUOTE) and never merged. The Saturn 4
  Ultra's admission ceiling mirrors its declared metadata and is provisional
  until a native envelope sweep measures it.
- The pricing file is authoritative: defaults seed only a missing or empty
  `configs/pricing-state/pricing.json`; a deleted material never resurrects;
  `getRate` fails closed with `null`.
- A per-slice retention sweep failure is non-fatal and surfaces as readiness
  reason `RETENTION_UNSAFE`; readiness also probes `configs/bambu`.

### Queue, rate, and runtime budgets
- Slice limiter: 3 requests / 60 s sustained, burst 5, adaptive cooldown up to
  30 s, keyed on the frozen `req.slicePrincipal` slot with IP fallback. Admin:
  30 / 60 s per IP. Queue: length 100, 5 queued + active per principal/IP,
  wait 300000 ms, concurrency default 1 (canonical `1..3`; N=2/3 unqualified).
- `SLICE_COMMAND_TIMEOUT_MS` default 600000, bounded 1000..3600000; Python
  helpers 120 s each, clamped to the native budget; renderer 60 s; upload
  lifetime 600 s. Output beyond the bounded buffer is `NATIVE_OUTPUT_OVERFLOW`.
- Process tree: TERM then KILL; post-SIGKILL settle polls up to 10 s and
  re-kills the group once. Quarantine closes admission, drains at most 10 s,
  exits with status 70 so `restart: unless-stopped` recovers.
- HTTP: headers 60000 [1000,60000]; request 600000 [60000,600000]; keep-alive
  95000 [1000,120000] (must outlive the proxy's 90 s idle timeout); headers
  count 2000 [16,2000]; connections 128 [1,1024]; requests/socket 100
  [1,1000]. Invalid values fall back; headers timeout is capped at request
  timeout.

### Measured facts and boundaries
- Bambu Studio CLI equals the owner's GUI readings on 10 reference models
  (-1.1..+0.1 % time, 0..0.2 % mass, supports off); Orca 2.3.1 BBL profiles
  deviate up to +24 % and have no H2D. Supports on adds +47..+140 % time on
  overhang models. Image smoke, 40 mm PLA cube: Bambu P1S 2453 s / 24.0 g /
  550 HUF, H2D 2452 s / 23.94 g / 550 HUF, Prusa 1980 s / 24.7 g / 440 HUF,
  Orca 2760 s / 24.2 g / 620 HUF; `/render` OK.
- Deploy, registry/image publication, route/DNS/allowlist, production
  container, and consumer-repository changes remain owner-authorized outside
  this repository. Local unit results never prove native or deployed behavior.

## Technology Baseline
- Backend: Node.js + Express
- Processing: Python 3.12 helper scripts (`cad2stl.py`, `mesh2stl.py`,
  `orient.py`, `scale_model.py`, `render_preview.py`); pins gmsh 4.15.2,
  lxml 6.1.2, networkx 3.6.1, numpy 2.5.2, Pillow 12.3.0, scipy 1.18.1,
  trimesh 5.1.0
- Engines: PrusaSlicer 2.8.1 (FDM and SLA), OrcaSlicer 2.3.1 (FDM only),
  Bambu Studio 02.08.02.61 (FDM only)
- Containerization: Docker Compose (`init: true`, read-only root, non-root)

## Repository Surface
- app/: server bootstrap, routes, middleware, services, python helpers
- configs/: pricing state, slicer profiles, and the Bambu printer registry
- input/: temporary request input workspace
- output/: generated .gcode/.sl1/.gcode.3mf artifacts
- tests/: JavaScript/Python unit suites and Python integration runners
- .github/: CI workflows + Copilot instructions + skill mirrors + instruction overlays

## Non-negotiable Constraints
- Keep runtime folders root-scoped: input/, output/, configs/.
- Never use app/input, app/output, or app/configs.
- Keep fail-fast policy for invalid geometry (INVALID_SOURCE_GEOMETRY, UNSLICEABLE_SOURCE_GEOMETRY).
- Never suggest auto-healing source models.
- Preserve queue and rate-limit protections for slicing and render endpoints.

## Runtime Flow
1. Apply the slice rate limiter (principal-keyed, IP fallback).
2. Authenticate `x-slicer-api-key`.
3. Allocate a root-scoped request workspace and receive one multipart upload (field name: choosenFile).
4. Validate options and profile selection.
5. Enqueue the request in the FIFO queue.
6. Convert source to STL when needed and run orientation (`auto` or `preserve`).
7. Apply sizing/rotation, placement (Bambu), and bounds validation.
8. Slice with the selected engine/profile (or render the preview).
9. Parse generated output stats and return stats with calculated price.

## Endpoint Snapshot
Public endpoints:
- GET /health
- GET /ready
- GET /pricing
- GET /profiles
- GET /openapi.json
- GET /docs
- GET /

Slice-service-protected endpoints (x-slicer-api-key required):
- POST /prusa/slice
- POST /orca/slice
- POST /bambu/slice
- POST /render

Pricing-protected endpoints (x-api-key with pricing audience):
- POST /pricing/FDM
- POST /pricing/SLA
- PATCH /pricing/:technology/:material
- DELETE /pricing/:technology/:material

Artifact-protected endpoints (x-api-key with artifact audience):
- GET /admin/output-files
- GET /admin/download/:fileName

Operations-protected endpoints (x-api-key with operations audience):
- GET /health/detailed
- GET /operations/readiness
- GET /operations/metrics

## Security Rules
- Pricing, artifact, and operations active keys are mandatory. Slice startup
  additionally requires one complete `SLICE_SERVICE_AUTH_MODE`: default
  `legacy` requires shared active and forbids principal material/expiry;
  `migration` requires shared active, both principal actives, and a future
  `SLICE_SERVICE_LEGACY_MIGRATION_UNTIL` no more than 90 days away; `principals`
  requires both principal actives and forbids shared active/previous and expiry.
  A previous slot is optional only with its own active. Every configured value,
  including a valid `ADMIN_API_KEY`, must be globally unique, non-placeholder,
  and 32-256 printable-ASCII bytes; only the admin key's exact authorized legacy
  substitution self-reference is skipped.
- Slice and render requests must pass exactly one x-slicer-api-key matching an
  eligible configured slice slot; x-api-key is not an alias. In migration,
  shared slots stop authorizing at the exact request-time expiry while
  principals continue. Missing or wrong credentials return HTTP 401 with
  `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
- Pricing, artifact, and operations routes require x-api-key matching only their
  scoped active or previous key. Cross-audience credentials are rejected.
- Authentication uses fixed-length SHA-256 digest comparisons for active and
  previous slots. Structured rejection events contain bounded correlation and
  audience fields, never credentials, URLs, paths, filenames, or customer data.
- Rotation is two-restart: restart with replacement active + former active in
  previous, migrate the caller, then remove previous and restart to revoke.
- ADMIN_API_KEY is allowed only for a finite migration of one non-slice
  audience named by LEGACY_ADMIN_API_KEY_AUDIENCE with an ISO-8601
  LEGACY_ADMIN_API_KEY_MIGRATION_UNTIL no more than 90 days away. Normal
  operation is scoped and fail closed; slice/broad/expired migration or any
  other cross-slot reuse is refused.
- Forwarded identity defaults off. TRUST_PROXY=true requires a non-empty unique
  set of validated explicit IP/CIDR entries or loopback; malformed, wildcard,
  overbroad, duplicate, or unknown entries refuse startup. Express selects the
  nearest untrusted hop, and direct untrusted peers cannot spoof X-Forwarded-For.
- Safe inbound X-Request-Id values are 1-128 characters, start alphanumeric,
  and then use only alphanumeric, dot, underscore, colon, or hyphen. Invalid
  values are replaced; the resolved ID is returned as X-Request-Id.
- Requests without Origin are allowed. Browser-origin protected calls use only
  the exact audience allowlist: SLICE_, PRICING_, ARTIFACT_, or
  OPERATIONS_CORS_ALLOWED_ORIGINS. ADMIN_CORS_ALLOWED_ORIGINS is legacy-only
  for the single active migration audience.
- Shell commands use execFile with argument arrays and a minimal child
  environment (no shell interpolation).
- Upload accepts only a single file on choosenFile field with extension validation at upload time.
- /admin/download/:fileName must pass filename extension validation
  (.gcode/.sl1/.gcode.3mf), path containment checks, lstat non-symlink checks,
  and realpath containment checks.
- /admin/download/ALL returns a ZIP stream of all valid output files and must preserve the same containment/symlink safety guarantees plus MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES limits.
- Fail-fast geometry policy: invalid geometry returns INVALID_SOURCE_GEOMETRY;
  native refusal returns UNSLICEABLE_SOURCE_GEOMETRY.
- No automatic model healing/correction is allowed.

## Readiness, Observability, and Topology
- GET /health is public process liveness.
- GET /ready is public minimal readiness and exposes only READY/NOT_READY.
- GET /health/detailed uses fresh readiness probes; GET /ready and
  GET /operations/readiness use the bounded readiness cache.
- Operations-scoped readiness reason codes are SHUTDOWN, ADMISSION_CLOSED,
  QUEUE_UNAVAILABLE, NATIVE_RUNTIME_QUARANTINED, STORAGE_UNSAFE,
  RETENTION_UNSAFE, PRICING_UNAVAILABLE, and CONFIG_UNSAFE.
- Structured JSON events use version 1, the fixed vocabulary in
  `app/services/observability/events.js` (including `orientation.fallback`),
  bounded request/job/artifact correlation, allowlisted fields, and
  secret/path/customer redaction. Metrics use fixed audience/outcome/reason/bucket labels only.
- The production topology is an internal-only API with no host port/default
  route and one authenticated reverse-proxy peer; the proxy must not provide
  generic forwarding, NAT, or DNS tunnelling for the API. Deployed
  caller/proxy/firewall facts are owner-verified, not repository claims.

## Queue and Rate Defaults
- Slicing rate limit: 3 requests per 60 seconds, burst 5, per principal (IP fallback)
- Admin rate limit: 30 requests per 60 seconds per IP
- Max concurrent slice jobs: default 1; explicit values must be exact canonical
  decimal 1..3. N=2/N=3 remain unqualified and undeployed.
- Max queue length: 100
- Max queued+active slice jobs per principal/IP: 5
- Max queue wait: 300000 ms
- Slice command timeout: 600000 ms, bounded 1000..3600000
- Python helper timeout: 120000 ms each; render timeout: 60000 ms
- HTTP headers timeout: 60000 ms, bounded 1000..60000
- HTTP request timeout: 600000 ms, bounded 60000..600000
- HTTP keep-alive timeout: 95000 ms, bounded 1000..120000
- HTTP header count: 2000, bounded 16..2000
- HTTP connections: 128, bounded 1..1024
- HTTP requests per socket: 100, bounded 1..1000
- ZIP entry limit: 500 files
- ZIP cumulative size limit: 500 MB

## Queue and Rate Behavior Details
- Slice and admin rate limit responses return HTTP 429 with Retry-After and retryAfterSeconds.
- Expired in-memory rate-limit buckets are cleaned periodically at max(windowMs * 2, 60000).
- Queue overflow returns SLICE_QUEUE_FULL (HTTP 503).
- Per-client queue cap returns SLICE_QUEUE_CLIENT_LIMIT (HTTP 429, Retry-After 5).
- Queue wait timeout returns SLICE_QUEUE_TIMEOUT (HTTP 503).
- Shutdown rejects new work as SLICE_QUEUE_SHUTDOWN (HTTP 503).
- Invalid, empty, non-decimal, unsafe, or out-of-range HTTP envelope overrides fall back to their safe defaults; effective headers timeout is capped at request timeout.
- Actual VPS capacity and reverse-proxy timeouts remain owner-verified.

Return and preserve queue/rate errors:
- RATE_LIMIT_EXCEEDED
- ADMIN_RATE_LIMIT_EXCEEDED
- SLICE_QUEUE_FULL
- SLICE_QUEUE_CLIENT_LIMIT
- SLICE_QUEUE_TIMEOUT
- SLICE_QUEUE_SHUTDOWN
- FILE_PROCESSING_TIMEOUT

## Python Runtime Resolution
- PYTHON_EXECUTABLE (optional) must be an absolute path and must exist when provided.
- If PYTHON_EXECUTABLE is not set, runtime resolution checks VIRTUAL_ENV/bin/python3 and VIRTUAL_ENV/Scripts/python.exe.
- Additional absolute-path fallbacks: /opt/venv/bin/python3, /usr/local/bin/python3, /usr/bin/python3.
- Startup fails fast when no valid absolute Python executable can be resolved.

## Engine Boundaries
Prusa:
- SLA layer heights: 0.025, 0.05 (Elegoo Saturn 4 Ultra quoting; prices
  automatically from a derived resin mass; SL1 raster output is quote-only)
- FDM layer heights: 0.1, 0.2, 0.3

Orca:
- FDM only
- Allowed layer heights: 0.1, 0.2, 0.3
- Requires machine profile + process profile compatibility
- Uses per-request isolated output directories before final artifact alignment.

Bambu:
- FDM only; printers `P1S` (default) and `H2D` from `configs/bambu/printers.json`
- Layer keys: P1S 0.08, 0.1, 0.12, 0.16, 0.2, 0.24, 0.28; H2D 0.08, 0.1, 0.12, 0.16, 0.2, 0.24
- `--arrange 0 --orient 0`, API-owned placement, `.gcode.3mf` artifact

## Environment and Config Keys
- SLICE_SERVICE_AUTH_MODE
- SLICE_SERVICE_API_KEY
- SLICE_SERVICE_API_KEY_PREVIOUS
- SLICE_SERVICE_WOOCOMMERCE_API_KEY
- SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS
- SLICE_SERVICE_LEADPILOT_API_KEY
- SLICE_SERVICE_LEADPILOT_API_KEY_PREVIOUS
- SLICE_SERVICE_LEGACY_MIGRATION_UNTIL
- PRICING_API_KEY
- PRICING_API_KEY_PREVIOUS
- ARTIFACT_API_KEY
- ARTIFACT_API_KEY_PREVIOUS
- OPERATIONS_API_KEY
- OPERATIONS_API_KEY_PREVIOUS
- ADMIN_API_KEY
- LEGACY_ADMIN_API_KEY_AUDIENCE
- LEGACY_ADMIN_API_KEY_MIGRATION_UNTIL
- PORT
- SLICE_CORS_ALLOWED_ORIGINS
- PRICING_CORS_ALLOWED_ORIGINS
- ARTIFACT_CORS_ALLOWED_ORIGINS
- OPERATIONS_CORS_ALLOWED_ORIGINS
- ADMIN_CORS_ALLOWED_ORIGINS
- HTTP_HEADERS_TIMEOUT_MS
- HTTP_REQUEST_TIMEOUT_MS
- HTTP_KEEP_ALIVE_TIMEOUT_MS
- HTTP_MAX_HEADERS_COUNT
- HTTP_MAX_CONNECTIONS
- HTTP_MAX_REQUESTS_PER_SOCKET
- JSON_BODY_LIMIT
- FORM_BODY_LIMIT
- MAX_UPLOAD_BYTES
- UPLOAD_TOTAL_TIMEOUT_MS
- MAX_MODEL_DIMENSION_MM
- MAX_MATERIAL_USED_METERS
- MAX_MATERIAL_USED_GRAMS
- MAX_MATERIAL_USED_ML
- SLICE_RATE_LIMIT_WINDOW_MS
- SLICE_RATE_LIMIT_MAX_REQUESTS
- SLICE_RATE_LIMIT_BURST_CAPACITY
- ADMIN_RATE_LIMIT_WINDOW_MS
- ADMIN_RATE_LIMIT_MAX_REQUESTS
- MAX_CONCURRENT_SLICES
- MAX_SLICE_QUEUE_LENGTH
- MAX_SLICE_QUEUE_PER_IP
- MAX_SLICE_QUEUE_WAIT_MS
- MAX_ZIP_ENTRIES
- MAX_ZIP_UNCOMPRESSED_BYTES
- MAX_SL1_ENTRIES
- SLICE_COMMAND_TIMEOUT_MS
- SLICE_STRICT_GCODE_METRICS
- PYTHON_EXECUTABLE
- VIRTUAL_ENV
- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
- BAMBU_PROFILES_ROOT
- TRUST_PROXY
- TRUST_PROXY_CIDRS
- SLICER_BASE_URL

## Test Execution Rule
Use Python test runners in tests/testing-scripts/.
After each run, read corresponding markdown report in tests/testing-scripts/results/.

Fast gates: `npm run test:js`, `npm run test:python`, `npm run check:syntax`,
`npm run check:repository-safety`. `tests/unit/js/instruction-mirrors.test.js`
requires `.github/agents` == `.claude/agents` and `.github/skills` ==
`.claude/skills` byte for byte.

Primary suite:
- python tests/testing-scripts/slicing/full_api_test_runner.py

Focused suites:
- python tests/testing-scripts/slicing/full_api_orca_fdm_test_runner.py
- python tests/testing-scripts/slicing/full_api_prusa_fdm_test_runner.py
- python tests/testing-scripts/slicing/full_api_prusa_sl1_test_runner.py
- python tests/testing-scripts/slicing/full_api_bambu_fdm_test_runner.py
- python tests/testing-scripts/slicing/bambu_envelope_confirmation_runner.py
- python tests/testing-scripts/slicing/unsupported_upload_test_runner.py
- python tests/testing-scripts/slicing/orientation_visibility_test_runner.py
- python tests/testing-scripts/slicing/native_envelope_sweep_runner.py
- python tests/testing-scripts/render/render_preview_test_runner.py
- python tests/testing-scripts/calibration/bambu_reference_comparison_runner.py --models-dir PRIVATE_DIR --reference PRIVATE_DIR/meres.json --printer P1S --supports false (owner-run only)
- python tests/testing-scripts/pricing/pricing_cycle_test_runner.py
- python tests/testing-scripts/admin/admin_output_files_test_runner.py
- python tests/testing-scripts/rate_limit/rate_limit_regression_test_runner.py
- python tests/testing-scripts/operations/operations_readiness_metrics_test_runner.py
- python tests/testing-scripts/profiles/profile_catalogue_test_runner.py
- python tests/testing-scripts/queue/queue_concurrency_test_runner.py --count N --expected-max-concurrent N --retry-on-429 1 --cleanup-manifest NEW_MANIFEST_PATH --report NEW_REPORT_PATH

Test organization:
- Keep focused runners small and domain-specific (admin output, rate-limit, queue, pricing).
- Split oversized runners into focused suites instead of appending unrelated checks.
- Preserve stable, deterministic runners unless changed endpoint behavior requires updates.
- Runners pace at 20 s and honour `Retry-After`; behavior that depends on the
  slicer binaries is proven only on the built image.

## Preferred Skills
Skills (operational playbooks mapped to agent definitions):
- .github/skills/docker-ops/SKILL.md
- .github/skills/testing/SKILL.md
- .github/skills/docs-sync/SKILL.md
- .github/skills/best-practice/SKILL.md

## Agent Definitions
Mirrored in `.claude/agents/` and `.github/agents/`:
- orchestrator — plans multi-domain tasks and delegates to sub-agents in parallel
- js-developer — Node.js + Express code in app/
- python-developer — Python converters, orientation, scaling, and preview-render scripts
- test-engineer — Python integration test runners and reports
- docs-syncer — documentation and instruction file synchronization
- docker-specialist — Dockerfile, docker-compose, container lifecycle
- quality-architect — iterative OOP/SOLID/design-principles refactor workflow with 23-point checklist

For multi-domain tasks (new features, endpoint changes, cross-cutting fixes), use the orchestrator agent workflow to plan and delegate.

Workflow gates:
- Run fast syntax validation (`node --check`, `python -m py_compile`) before integration suites when source files change.
- Run quality-architect for non-trivial source changes or files near the decomposition guardrails.
- Run the smallest matching Python runner first; run full slicing validation when slicing behavior changes or the user explicitly asks for full validation.
- Run docs-sync last and update mirrored agent/skill assets when workflow policy changes.
- Perform changelog/version/tag work only after validation is green.

Optional MCP:
- `.claude/.mcp.template.json` is a credential-free local MCP template.
- `.claude/.mcp.json` is local-only and must not be committed.

## Documentation Layout
- Global: .github/copilot-instructions.md, CLAUDE.md, .claude/CLAUDE.md
- Codex routing layer: AGENTS.md with docs/codex/project-map.md, security-model.md, hardening-plan.md
- Consumer contract: docs/integration-guide.md
- Operator handoff: docs/codex/handoff-2026-09-02.md
- Historical narrative: docs/codex/history-waves.md and docs/codex/evidence/
- Folder-local docs:
  - app/CLAUDE.md
  - configs/CLAUDE.md
  - tests/testing-scripts/CLAUDE.md
- Instruction overlays: .github/instructions/repository.instructions.md, app.instructions.md, configs.instructions.md, testing-scripts.instructions.md, github.instructions.md
- Optional Claude MCP template: .claude/.mcp.template.json
