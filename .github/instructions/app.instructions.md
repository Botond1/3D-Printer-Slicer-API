---
applyTo: "app/**"
---

# App Folder Instructions

Last synchronized: 2026-08-26

## Responsibilities
- app/server.js handles bootstrap, middleware, routes, docs, and static output serving.
- app/routes should stay lightweight and delegate to services.
- app/routes/system.routes.js delegates admin output listing/download validation to app/services/admin-output.service.js.
- app/services/pricing.service.js remains the facade API; pricing persistence and pricing-domain logic live in app/services/pricing/ submodules.
- app/services/slice/ contains modular pipeline logic (options, queue,
  transform, selection/runtime profiles, allowlisted Orca parent flattening in
  `app/services/slice/orca-profile-inheritance.js`, snapshots in
  `app/services/slice/profile-snapshot.js`, effective-profile identity in
  `app/services/slice/profile-digest.js`, native version identity in
  `app/services/slice/engine-version.js`, filament selection/metadata in
  `app/services/slice/filament-profile.js`, strict FDM metrics in
  `app/services/slice/gcode-metrics.js`, response, errors).
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

## Endpoint Rules
- Keep upload field name as choosenFile.
- Keep both slice routes ordered as sliceRateLimiter -> requireSliceService -> root-scoped workspace/Multer -> queue -> native processing.
- Keep exact missing/wrong slice-auth response HTTP 401 `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
- Keep exactly one slice header, x-slicer-api-key; x-api-key is not a slice alias.
- Every successful Prusa/Orca response requires lowercase
  `profiles.effective_profile_sha256` plus actual-selected-executable
  `engine_version`. Public profile fields and bounds `source_profile` keep
  original selected basenames, never randomized snapshot names.
- Keep OpenAPI's four requested omissions plus the already-live
  `MODEL_DIMENSIONS_UNAVAILABLE` general-422 correction. The disjoint
  `MODEL_OUT_OF_PRINTER_BOUNDS` branch requires both dimension payloads. Keep
  the complete live slice-500 enum: `SLICE_OUTPUT_UNPARSED`,
  `INTERNAL_PROCESSING_ERROR`, `QUEUE_INTERNAL_ERROR`, `UPLOAD_STORAGE_ERROR`,
  and `INTERNAL_SERVER_ERROR`.
- Atomically verify both selected engine versions from bounded `--help` output
  before listen; requests read the all-success initialized map. The startup
  module has exact-image proof and uses a telemetry-disabled runner that cannot
  alter slice-native lifecycle metrics/events. Keep Orca invocation at `--arrange 1` /
  `--orient 0` after preprocessing/bounds checks: arrangement places already-
  rotated geometry onto the build plate, while auto-orient stays disabled.
  Focused command/digest contracts and final exact-image HTTP transform/final-
  dimensions E2E pass for both principals; the exact local code/image identity
  is recorded in the J0 evidence document.
- Preserve J1 Orca filament behavior: repository PLA/PETG selection, exact-byte
  job snapshot, native machine-process-filament order, digest-covered normalized
  material plus filament JSON or explicit null, and nullable public basename/
  diameter/density. OpenAPI requires nullable `material_used_g`, populated only
  by a direct G-code marker and never derived from length. Strict FDM requires
  positive time and length; selected-profile Orca also requires positive grams,
  with missing/drifted mass returning 500 `SLICE_OUTPUT_UNPARSED`. Current Prusa
  FDM and profile-less Orca preserve null grams, `hourly_rate`, and
  `stats.estimated_price_huf`; no automatic price may be calculated.
- Keep W8 live calibration `BLOCKED_OWNER_INPUT`: the retained P1S and new H2D
  candidates are generic Marlin profiles, not verified native Bambu profiles.
  Require real machine/process references, owner-selected models, and owner-
  approved acceptance thresholds; repository evidence grants no deployment or
  public-route authority.
- Keep endpoint contracts stable:
  - POST /prusa/slice
  - POST /orca/slice
  - GET /pricing
  - GET /health and GET /ready (public)
  - GET /health/detailed, GET /operations/readiness, GET /operations/metrics (operations)
  - POST /pricing/FDM, POST /pricing/SLA, PATCH/DELETE /pricing/:technology/:material (pricing)
  - GET /admin/output-files and GET /admin/download/:fileName (artifact)
  - GET /admin/download/:fileName supports `ALL` token for ZIP bulk download

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
  `use_relative_e_distances='1'` settings aligned with the flattened pinned
  machine parent's per-layer `G92 E0` reset.
- Preserve bounded/redacted auth events and exact per-audience CORS policies.
- Preserve HTTP defaults/bounds: 60000 [1000,60000] headers ms; 600000 [60000,600000] request ms; 5000 [1000,60000] keep-alive ms; 2000 [16,2000] headers; 128 [1,1024] connections; 100 [1,1000] requests/socket.
- Invalid HTTP envelope overrides fall back to defaults; effective headers timeout is capped at request timeout. VPS capacity and proxy timeouts remain UNVERIFIED.
- Preserve per-client queue fairness cap (MAX_SLICE_QUEUE_PER_IP).
- Preserve queue/status mapping: SLICE_QUEUE_FULL (503), SLICE_QUEUE_CLIENT_LIMIT (429), SLICE_QUEUE_TIMEOUT (503).
- Preserve rate-limit response shape and Retry-After behavior for slice/admin throttling.
- Preserve admin download safety guards for both single-file and ALL-token ZIP responses.
- Preserve ALL-token ZIP resource limits using MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES.
- Preserve Orca per-request isolated output directory handling.
- Preserve error code names used by clients.
- Do not auto-heal invalid geometry.
- Preserve public minimal readiness and operations-only detailed reasons/metrics.
  Keep /health/detailed fresh and /ready plus /operations/readiness cached.
- Never add request/job/artifact/customer values as metric labels.
- Preserve fail-closed proxy CIDR/loopback compilation and safe request-ID validation.
- I6 validation requires an internal-only API with no host port/default route,
  an authenticated private peer, and calibrated API/native egress denial.
  Async worker work remains deferred and deployed topology remains UNVERIFIED.
