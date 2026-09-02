---
applyTo: "app/**"
---

# App Folder Instructions

Last synchronized: 2026-09-02

## Responsibilities
- app/server.js handles bootstrap, middleware, routes, docs, and startup
  guards (three engine versions, Bambu registry/vendor chain, catalogue).
- app/routes should stay lightweight and delegate to services.
  slice.routes.js declares /prusa/slice, /orca/slice, /bambu/slice;
  render.routes.js declares /render; upload-lifecycle.js is the shared
  workspace/multer/deadline/cleanup lifecycle for both.
- app/routes/system.routes.js delegates admin output listing/download
  validation to app/services/admin-output.service.js.
- app/services/pricing.service.js remains the facade API; persistence and
  domain logic live in app/services/pricing/. The pricing file is
  authoritative (defaults seed only a missing/empty file; `getRate` fails
  closed with `null`).
- app/services/render.service.js composes the slice pipeline steps and runs
  `app/render_preview.py` with a dedicated 60 s runner on the shared queue.
- app/services/slice/ contains the modular pipeline: options, queue and
  scheduler, transform, selection/runtime profiles, Orca parent flattening
  (`orca-profile-inheritance.js`), Bambu registry/vendor chain/bed geometry/
  placement (`bambu-printer-registry.js`, `bambu-profile-chain.js`,
  `bambu-bed-geometry.js`, `bambu-placement.js`), snapshots
  (`profile-snapshot.js`), effective identity (`profile-digest.js`), native
  rejection classification (`native-bounds.js`), engine identity
  (`engine-version.js`), filament metadata (`filament-profile.js`), strict
  metrics (`gcode-metrics.js`), the startup catalogue
  (`profile-catalogue.js`), orientation contract
  (`orientation-contract.js`), command/process lifecycle (`command.js`,
  `process-tree.js`), response, and errors.
- app/config/service-auth.js resolves immutable pricing/artifact/operations
  rings plus explicit `legacy`, finite `migration`, or final `principals` slice
  mode with shared compatibility and WooCommerce/LeadPilot rings.
- app/middleware: nearest-untrusted-hop client IP, fixed-digest audience
  checks (`requireAudience.js`), slice authentication that attaches a frozen
  `req.slicePrincipal` (`requireSliceService.js`), per-audience CORS,
  request-ID validation, observability, principal-keyed token-bucket rate
  limiting with periodic pruning (`rateLimit.js`), and error normalization.
- app/services/http-server.js applies bounded HTTP timeouts (keep-alive
  default 95000 ms, maximum 120000 ms), header/connection counts, and
  requests per socket before listen.
- app/services/readiness.service.js provides cached admission-aware probes
  (including `configs/bambu`) for /ready and /operations/readiness plus fresh
  probes for /health/detailed; app/services/runtime-lifecycle.js owns
  single-flight shutdown and the quarantine drain (<= 10 s, exit 70);
  app/services/observability provides redacted events and fixed metrics.
- app/routes/profile-catalogue.routes.js exposes the immutable 82-row startup
  catalogue without authentication; catalogue failure returns typed 503 and
  never changes slice readiness/admission.

## Endpoint Rules
- Keep upload field name as choosenFile.
- Keep every slice-service route ordered as sliceRateLimiter ->
  requireSliceService -> root-scoped workspace/Multer -> option/profile
  validation -> queue -> native processing (or render). A validation 400
  never consumes a queue slot.
- Keep exact missing/wrong slice-auth response HTTP 401 `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
- Keep exactly one slice header, x-slicer-api-key; x-api-key is not a slice alias.
- Every successful slice response requires lowercase
  `profiles.effective_profile_sha256`, actual-selected-executable
  `engine_version`, `supports`, the complete `transform_schema: 2`
  `model_transform` (exact original-availability invariant, positive
  oriented/final dimensions else 422 `MODEL_DIMENSIONS_UNAVAILABLE`,
  `R_total = R_requested * R_automatic`, `stats.object_height_mm` equal to
  final Z), inclusive `build_volume_limits_mm`, and, for Bambu,
  `placement_mm {x_min, y_min}` plus `bed_type`. Public profile fields keep
  original basenames or vendor names, never snapshot names.
- Keep multipart validation strict: `orientationMode` exact `auto|preserve`
  (omission -> `auto`), `supports` boolean with default `true`
  (`INVALID_SUPPORTS`), `infill` integer 0..100 with optional `%` and no
  clamping (`INVALID_INFILL`), `keepProportions=true` fits within the target
  box, Bambu `printerProfile` in `P1S|H2D` (`INVALID_PRINTER_PROFILE`), Bambu
  `processProfile` an exact vendor process name (`INVALID_PROCESS_PROFILE`),
  Bambu material mapped by the registry (`MATERIAL_PROFILE_UNAVAILABLE`).
- Full K2 HTTP 422 `MODEL_OUT_OF_PRINTER_BOUNDS` requires
  `model_dimensions_mm`, `build_volume_limits_mm`, and the same complete
  schema-2 transform; Bambu rc 192/190 refusals map through it. Preserve
  bounded stdout and stderr separately on failed native commands; native
  faulty-mesh/model-load diagnostics on either stream map to 422
  `UNSLICEABLE_SOURCE_GEOMETRY` with a path-free `detail`; converter
  `INVALID_SOURCE_GEOMETRY|` markers map to 400; only real timeouts map to
  422 `FILE_PROCESSING_TIMEOUT`; maxBuffer kills map to 500
  `NATIVE_OUTPUT_OVERFLOW`.
- Keep OpenAPI complete: the four slice-service paths, every live 400/401/
  408/413/422/429/500/503 code, the disjoint bounds branch, and the slice-500
  enum `SLICE_OUTPUT_UNPARSED`, `NATIVE_OUTPUT_OVERFLOW`,
  `INTERNAL_PROCESSING_ERROR`, `QUEUE_INTERNAL_ERROR`, `UPLOAD_STORAGE_ERROR`,
  `INTERNAL_SERVER_ERROR`.
- Atomically verify all three engine versions from bounded `--help` output
  before listen. Keep Orca at `--load-settings machine;process`,
  `--load-filaments filament`, `--arrange 1`, `--orient 0`, and exactly one
  single-token `--allow-rotations=0`; keep Bambu at `--curr-bed-type`,
  `--export-3mf` relative to `--outputdir`, `--arrange 0`, `--orient 0`, and
  never `--allow-rotations`, with API-owned placement through
  `scale_model.py --place-min-x X --place-min-y Y`.
- Preserve filament behavior: Orca PLA/PETG/ABS/TPU repository profiles
  (1.24/1.27/1.04/1.24 g/cm3, 1.75 mm) with exact-byte snapshots and
  digest-covered material; Bambu vendor `Generic` filaments from the registry.
  `material_used_g` is populated only by a direct G-code marker and never
  derived from length; Orca/Bambu with a selected profile require positive
  grams (missing/drifted -> `SLICE_OUTPUT_UNPARSED`); the Prusa path is
  nullable; SLA is always `null` mass/rate/price. Time markers rank
  `total_estimated_time` first.
- Price in integer arithmetic: `ceil(max(print_time_seconds, 900) * rate /
  3600)` rounded up to 10 HUF; 1980 s at 800 HUF/h is 440.
- Keep endpoint contracts stable:
  - POST /prusa/slice, POST /orca/slice, POST /bambu/slice, POST /render (slice)
  - GET /pricing, GET /profiles, GET /health, GET /ready (public)
  - GET /health/detailed, GET /operations/readiness, GET /operations/metrics (operations)
  - POST /pricing/FDM, POST /pricing/SLA, PATCH/DELETE /pricing/:technology/:material (pricing)
  - GET /admin/output-files and GET /admin/download/:fileName incl. `ALL` (artifact)
- Keep `/profiles` bound to the production selection/snapshot/runtime/digest/
  bounds chain: `r3d-profile-catalogue-v2`, FDM-only, 82 rows, separate
  `declared_build_volume_dimensions_mm` and
  `largest_passing_dimensions_inclusive_mm`, engine-scoped
  `machine_resolutions`/`fleet_resolutions`, no cross-engine merge, no manual
  maximum, never the generic SLA fallback or a guessed Elegoo envelope.
- Keep the measured ceilings: Bambu P1S `256 x 228 x 250` (alternative
  `238 x 256`, L-shaped through real placement), Bambu H2D `325 x 320 x 325`,
  Prusa P1S `256 x 256 x 249.9`, Orca P1S `253.9 x 253.9 x 249.9`, Prusa
  H2D-QUOTE `350 x 320 x 324.9`, Orca H2D-QUOTE `347.9 x 317.9 x 324.9`.
  H2D-QUOTE is quote-only P1S physics; real H2D output comes from Bambu.

## Safety Rules
- Preserve queue and rate-limit protections on every slice-service route.
- Preserve mandatory pricing/artifact/operations actives plus one complete slice
  mode; reject one-principal and previous-without-active states; keep all
  configured material globally unique and 32-256 printable ASCII.
- Preserve canonical-realpath bounded profile reads, allowlisted Orca parent
  flattening, fail-closed Bambu vendor-chain flattening (bounded reads, role
  containment, cycle/name/role/depth checks), and job-scratch snapshots before
  bounds/runtime derivation; reject symlink/non-canonical sources, detected
  growth, and exact duplicate Prusa INI qualified keys. Preserve the Docker
  build equality gate for the Orca parents and stable Orca relative-extrusion
  settings.
- Preserve declared metadata separately from the configured inclusive
  largest-passing ceilings; preserve profile minima, the FDM fallback
  `350 x 320 x 325`, and `MAX_MODEL_DIMENSION_MM >= 350`.
- Preserve bounded/redacted auth events and exact per-audience CORS policies.
- Preserve HTTP defaults/bounds: 60000 [1000,60000] headers ms; 600000
  [60000,600000] request ms; 95000 [1000,120000] keep-alive ms; 2000 [16,2000]
  headers; 128 [1,1024] connections; 100 [1,1000] requests/socket. Invalid
  overrides fall back to defaults; effective headers timeout is capped at
  request timeout.
- Preserve the runtime budgets: `SLICE_COMMAND_TIMEOUT_MS` 600000 in
  1000..3600000, 120 s per Python helper clamped to the native budget, 60 s
  renderer, 600 s upload lifetime, 10 s post-SIGKILL settle with one re-kill,
  quarantine drain <= 10 s then exit 70.
- Preserve principal-keyed queue fairness (MAX_SLICE_QUEUE_PER_IP applies per
  principal slot with IP fallback) and the mappings SLICE_QUEUE_FULL (503),
  SLICE_QUEUE_CLIENT_LIMIT (429 with Retry-After), SLICE_QUEUE_TIMEOUT (503),
  SLICE_QUEUE_SHUTDOWN (503).
- Preserve rate-limit response shape and Retry-After behavior for slice/admin throttling.
- Preserve admin download safety guards for single-file and ALL-token ZIP
  responses, the `.gcode`/`.sl1`/`.gcode.3mf` allowlist, and the ZIP limits.
- Preserve Orca per-request isolated output directory handling.
- Preserve exactly one supported outer ZIP source with junk tolerance, 3MF
  units, project-part admission, and compound-STL conversion; never a
  multi-object packing surface.
- Preserve error code names used by clients.
- Do not auto-heal invalid geometry.
- Preserve public minimal readiness and operations-only detailed reasons/metrics;
  keep /health/detailed fresh and /ready plus /operations/readiness cached;
  keep the retention sweep non-fatal (`RETENTION_UNSAFE`).
- Never add request/job/artifact/customer values as metric labels.
- Preserve fail-closed proxy CIDR/loopback compilation and safe request-ID validation.
- Keep every helper invocation on `execFile` with argument arrays and the
  minimal child environment; `render_preview.py` is part of the helper
  allowlist.
