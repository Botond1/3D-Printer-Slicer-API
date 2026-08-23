---
applyTo: "app/**"
---

# App Folder Instructions

Last synchronized: 2026-07-25

## Responsibilities
- app/server.js handles bootstrap, middleware, routes, docs, and static output serving.
- app/routes should stay lightweight and delegate to services.
- app/routes/system.routes.js delegates admin output listing/download validation to app/services/admin-output.service.js.
- app/services/pricing.service.js remains the facade API; pricing persistence and pricing-domain logic live in app/services/pricing/ submodules.
- app/services/slice/ contains modular pipeline logic (options, queue, transform, profiles, errors).
- app/config/service-auth.js resolves one immutable active/previous key ring for
  slice, pricing, artifact, and operations plus a finite one-audience legacy migration.
- app/middleware uses nearest-untrusted-hop client IP parsing from fail-closed
  Express trust-proxy configuration.
- app/middleware/requireAudience.js provides fixed-digest, audience-scoped active/previous comparison.
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
- Preserve mandatory distinct 32-256 printable-ASCII active keys, audience-local
  previous slots, two-restart revocation, and the one-audience <=90-day legacy limit.
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
