# 3D Printer Slicer API - Claude Operating Guide

Last synchronized: 2026-08-25

## Architecture Notice
This repository uses both GitHub Copilot and Claude as primary agentic tools.
When architecture rules or domain constraints change in this file, keep these files synchronized:
- .github/copilot-instructions.md
- .claude/CLAUDE.md
- .github/agents/* and .claude/agents/*
- .github/skills/*
- .claude/skills/*
- .github/instructions/*

## Goal
Provide a reliable slicing and pricing API for 3D printing workflows with strict safety and predictable behavior.

## J0 W2/W3 public contract

- Every successful Prusa and Orca response requires lowercase
  `profiles.effective_profile_sha256`. After selection, bounded canonical-realpath
  Prusa bytes and the flattened, versioned repository copy of the allowlisted
  Orca v2.3.1 `Custom` parent chain are snapshotted in job scratch for bounds,
  runtime, digest, and native use. Its exact-image build equality gate passes;
  public fields retain child basenames. Stable Orca runtime settings enforce
  empty `layer_gcode` plus relative extrusion, aligned with the flattened pinned
  machine parent's per-layer `G92 E0` reset.
- Prusa INI digest identity is case-sensitive for section/key names and exact
  duplicate qualified keys fail closed like the native Boost parser. Runtime
  generation replaces one exact top-level request key, rejects duplicates, and
  inserts a missing key before the first section.
- OpenAPI includes the four requested omissions `FILE_PROCESSING_TIMEOUT`,
  `INTERNAL_PROCESSING_ERROR`, `ORCA_PROFILE_INCOMPATIBLE`, and
  `MODEL_OUT_OF_PRINTER_BOUNDS`, plus the already-live
  `MODEL_DIMENSIONS_UNAVAILABLE` in the general 422 branch. The bounds code
  requires both `model_dimensions_mm` and `build_volume_limits_mm`. The complete
  live slice-500 enum is `INTERNAL_PROCESSING_ERROR`, `QUEUE_INTERNAL_ERROR`,
  `UPLOAD_STORAGE_ERROR`, and `INTERNAL_SERVER_ERROR`.
- Slice traffic still accepts exactly one `x-slicer-api-key` header. Explicit
  `legacy`, finite `migration`, and final `principals` modes control the shared
  compatibility family and the separate WooCommerce/LeadPilot families.
  `GET /health` and `GET /pricing` remain authentication-free. Before any router
  action, the dark gate must prove principal-only readback, one private positive
  slice per principal, retired-shared and `x-api-key` negative cases, and exact
  cleanup. Missing or inconclusive evidence keeps the route dark. External
  production activation is outside repository evidence and authority.
- Every success also requires the atomically startup-verified `engine_version`
  parsed from both selected executables' bounded `--help` output before listen.
  The startup module has exact-image proof and uses a telemetry-disabled runner,
  so its probes cannot alter slice-native lifecycle metrics/events. Orca sends
  `--arrange 1` and
  `--orient 0`: arrangement places already-rotated geometry onto the build
  plate, while auto-orient stays disabled and cannot replace the requested
  rotation. Focused command/digest contracts and a corrected validation-image
  HTTP transform/final-dimensions E2E pass; the final rebuilt image identity is
  not yet recorded. This is not deployment or public activation. Filament
  profile plus `material_used_g` remains a separate W8 prerequisite classified
  `BLOCKED_OWNER_INPUT / NOT_STARTED` until the owner supplies the required
  Bambu reference profile fields.

## I12 Hostinger production-qualification boundary

- Status is `I12_API_F710_DARK_N1_VERIFIED;
  OPERATOR_MAIN_7C8AEE_RESIDUAL_RECONCILIATION_COMPLETE;
  CORRECTED_TRAEFIK_DARK_CUTOVER_VERIFIED; PUBLIC_ROUTE_DISABLED`.
- The deployed API image source remains the protected-main checkpoint
  `f71069cb3ba5ddeb97e69ca1414a00a72a20ce28`; its exact signed image digest is
  `sha256:d50c72bd084e14645f2c9c7b18a087317bf080a2d76cf1bc876d5e3427ae1e26`.
  It remains healthy and dark at retained concurrency one, without a host API
  port or API default route.
- Corrective operator main
  `7c8aee0728fc8462c67b4c6d85636bffb7afcdf8` passed Source `32804297840` and
  Image `32804297658` after protected PR `#5`. Its operator commits are separate
  from the API-image source and did not rebuild, relabel, or republish that image.
- The corrected socketless Traefik is healthy with exact ingress/private
  `gw_priority: 1/0`, ingress-owned default routing, effective read-only config,
  file provider only, and no Docker socket/provider. Docker owns exact IPv4 and
  IPv6 host listeners for ports 80/443 while the container networks remain
  IPv6-disabled; these are separate properties.
- Failed-cutover resources were reconciled by exact identity into the resumed
  successful state. The old proxy is intentionally retained stopped for
  rollback, task-owned remote temp residue is absent, and ACME bytes are unchanged.
- No public slicer router is active. Hostname/DNS, approved caller/CIDR,
  firewall acceptance, certificate issuance/continuity, route activation,
  monitoring/recovery acceptance, customer traffic, and public production
  completeness remain unverified and separately authorized.

## Candidate image publication boundary

- Normal Image Validation remains read-only, builds once, and never pushes,
  attests, or deploys.
- I10 is live-verified at protected-main SHA
  `8253160eef1c3e00c1e40826ec61fd97563ddd9b`: Source `32662043454` and Image
  `32662043476` succeeded, and strict main policy requires both no-deploy GitHub
  Actions contexts. Main requires a PR, includes administrators, forbids
  force-push/deletion, requires conversation resolution, and enables merge
  commits only. Zero approvals reflect the sole-collaborator self-review limit,
  not human approval; required signatures are not enabled.
- I11 Candidate Publication is manual `workflow_dispatch` only from exact
  current protected `main`. Repository `Botond1/3D-Printer-Slicer-API`, actor
  `Botond1`, `refs/heads/main`, requested/event/checked-out/remote SHA,
  post-I10 ancestry, and registry
  `ghcr.io/botond1/3d-printer-slicer-api` must all match.
- `publish_new` requires an empty existing-digest input, exact confirmation
  `PUBLISH_SIGNED_MAIN_CANDIDATE`, and a proven-absent SHA-derived discovery
  tag before pushing the once-built fully gated image.
- `recover_exact_digest` requires exact confirmation
  `RECOVER_SIGNED_MAIN_CANDIDATE` and a lowercase `sha256:<64 hex>` already
  bound to the SHA-derived tag and the once-built image config. Recovery never
  pushes, overwrites, or deletes registry content.
- Only its publication job may use `packages: write`, `attestations: write`,
  and `id-token: write`. Login and push occur only after the complete shared
  exact-image gate passes on the same once-built `linux/amd64` image.
- The publication job binds GitHub environment `candidate-publication` with
  `deployment: false`. Environment ID `20443404498` is
  `LIVE_CONFIG_VERIFIED` on 2026-08-23: protected branches true, custom branch
  policies false, exactly one `branch_policy` protection rule (ID `63481958`),
  and no reviewer/wait-timer rules, secrets, variables or deployments. No
  reviewer is possible while `Botond1` is the sole collaborator.
- Never overwrite/delete a discovery tag or create `latest`, release, staging,
  or production tags. Downstream consumption is exact-digest only:
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:<64 lowercase hex>`.
- Successful protected-main publication automatically triggers the no-deploy
  rehearsal through `workflow_run`. It re-proves the exact upstream run and
  single bounded artifact, dynamically binds the policy-pinned previous and
  artifact-derived current digests, verifies both images' SLSA/SPDX
  attestations through API and OCI, then runs hardened I9 readiness,
  `STORAGE_UNSAFE`, automatic rollback, bounded evidence and exact cleanup.
  The rehearsal has read permissions only and cannot write GHCR or deploy.
- Publication is not deployment. Preserve and classify partial candidates;
  exact recovery may continue only a matching digest without remote mutation.
  I11 is complete at protected-main SHA
  `65706e381b907c6ba09a8eba504af3adaacac86b`: Source `32668796239`, Image
  `32668796232`, Candidate Publication `32669087688`, and automatic rehearsal
  `32669484893` all succeeded, completing the I11 checkpoint.
- Hosted S4/S5 and I9 results remain ephemeral repository evidence. I12
  separately verifies one exact dark digest, Hostinger VPS, private readiness,
  API/native egress denial and corrected socketless proxy. Public callers,
  proxy CIDR/firewall, DNS/certificate, complete secret lifecycle, route
  activation, customer traffic and public rollback remain separately
  authorized and unverified.

## Technology Baseline
- Backend: Node.js + Express
- Processing: Python 3.12 helper scripts
- Engines: PrusaSlicer (FDM and SLA), OrcaSlicer (FDM only)
- Containerization: Docker Compose

## Runtime Layout (Non-negotiable)
Use root-scoped runtime folders only:
- input/
- output/
- configs/

Do not introduce app/input, app/output, or app/configs.

## Main Data Flow
1. Apply the slice IP rate limiter.
2. Authenticate `x-slicer-api-key`.
3. Allocate a root-scoped request workspace and receive one multipart upload (field name: choosenFile).
4. Enqueue the uploaded request in the FIFO queue.
5. Validate options and convert source to STL when needed.
6. Run orientation optimization.
7. Apply transform/scale/rotation and bounds validation.
8. Slice with selected engine/profile.
9. Parse generated output stats and return stats with calculated price.

## API Endpoint Snapshot
Public endpoints:
- GET /health
- GET /ready
- GET /pricing
- GET /openapi.json
- GET /docs
- GET /

Slice-service-protected endpoints (x-slicer-api-key required):
- POST /prusa/slice
- POST /orca/slice

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

## Security and Validation Rules
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
- Slice requests must pass exactly one x-slicer-api-key matching an eligible
  configured slice slot; x-api-key is not an alias. In migration, shared slots
  stop authorizing at the exact request-time expiry while principals continue.
  Missing or wrong credentials return HTTP 401 with
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
- Slice route order is rate limiter -> service authentication -> root-scoped workspace allocation -> Multer single-file upload -> queue -> native processing.
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
- Shell commands use execFile with argument arrays (no shell interpolation).
- Upload accepts only a single file on choosenFile field with extension validation at upload time.
- /admin/download/:fileName must pass filename extension validation (.gcode/.sl1), path containment checks, lstat non-symlink checks, and realpath containment checks.
- /admin/download/ALL returns a ZIP stream of all valid output files and must preserve the same containment/symlink safety guarantees plus MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES limits.
- Fail-fast geometry policy: invalid geometry returns INVALID_SOURCE_GEOMETRY.
- No automatic model healing/correction is allowed.

## Readiness, Events, Metrics, and Topology
- GET /health is public process liveness.
- GET /ready is public minimal readiness and exposes only READY/NOT_READY.
- GET /health/detailed uses fresh readiness probes; GET /ready and
  GET /operations/readiness use the bounded readiness cache.
- Operations-scoped readiness reason codes are SHUTDOWN, ADMISSION_CLOSED,
  QUEUE_UNAVAILABLE, NATIVE_RUNTIME_QUARANTINED, STORAGE_UNSAFE,
  RETENTION_UNSAFE, PRICING_UNAVAILABLE, and CONFIG_UNSAFE.
- Structured JSON events use version 1, a fixed event vocabulary, bounded
  request/job/artifact correlation, allowlisted fields, and secret/path/customer
  redaction. Metrics use fixed audience/outcome/reason/bucket labels only.
- I6 selects an internal-only API with no host port/default route and one
  authenticated reverse-proxy peer; repository validation requires calibrated
  API/native DNS/TCP/UDP denial. The proxy must not provide generic forwarding,
  NAT, or DNS tunnelling for the API. Decision:
  PRIVATE_PEER_TOPOLOGY_SELECTED; ASYNC_WORKER_DEFERRED. Intended/denied
  callers and all deployed Hostinger/proxy/firewall facts remain UNVERIFIED.

## Queue and Rate Protection
Defaults:
- Slicing rate limit: 3 requests per 60 seconds per IP
- Admin rate limit: 30 requests per 60 seconds per IP
- Max concurrent slice jobs: default 1; explicit values must be exact canonical
  decimal 1..3. N=2/N=3 remain unqualified and undeployed.
- Max queue length: 100
- Max queued+active slice jobs per client IP: 5
- Max queue wait: 300000 ms
- Slice command timeout: 600000 ms (10 minutes)
- HTTP headers timeout: 60000 ms, bounded 1000..60000
- HTTP request timeout: 600000 ms, bounded 60000..600000
- HTTP keep-alive timeout: 5000 ms, bounded 1000..60000
- HTTP header count: 2000, bounded 16..2000
- HTTP connections: 128, bounded 1..1024
- HTTP requests per socket: 100, bounded 1..1000
- ZIP entry limit: 500 files
- ZIP cumulative size limit: 500 MB

Behavior:
- Slice and admin rate limit responses return HTTP 429 with Retry-After and retryAfterSeconds.
- Expired in-memory rate-limit buckets are cleaned periodically at max(windowMs * 2, 60000).
- Queue overflow returns SLICE_QUEUE_FULL (HTTP 503).
- Per-client queue cap returns SLICE_QUEUE_CLIENT_LIMIT (HTTP 429).
- Queue wait timeout returns SLICE_QUEUE_TIMEOUT (HTTP 503).
- Invalid, empty, non-decimal, unsafe, or out-of-range HTTP envelope overrides fall back to their safe defaults; effective headers timeout is capped at request timeout.
- Actual VPS capacity and reverse-proxy timeouts remain UNVERIFIED.

Return and preserve queue/rate errors:
- RATE_LIMIT_EXCEEDED
- ADMIN_RATE_LIMIT_EXCEEDED
- SLICE_QUEUE_FULL
- SLICE_QUEUE_CLIENT_LIMIT
- SLICE_QUEUE_TIMEOUT
- FILE_PROCESSING_TIMEOUT

## Python Runtime Resolution
- PYTHON_EXECUTABLE (optional) must be an absolute path and must exist when provided.
- If PYTHON_EXECUTABLE is not set, runtime resolution checks VIRTUAL_ENV/bin/python3 and VIRTUAL_ENV/Scripts/python.exe.
- Additional absolute-path fallbacks: /opt/venv/bin/python3, /usr/local/bin/python3, /usr/bin/python3.
- Startup fails fast when no valid absolute Python executable can be resolved.

## Engine Boundaries
Prusa:
- SLA layer heights: 0.025, 0.05
- FDM layer heights: 0.1, 0.2, 0.3

Orca:
- FDM only
- Allowed layer heights: 0.1, 0.2, 0.3
- Requires machine profile + process profile compatibility
- Uses per-request isolated output directories before final artifact alignment.

## Configuration Keys
Core keys from .env:
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
- SLICE_COMMAND_TIMEOUT_MS
- PYTHON_EXECUTABLE
- VIRTUAL_ENV
- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
- TRUST_PROXY
- TRUST_PROXY_CIDRS
- SLICER_BASE_URL

## Testing Policy
Use Python test runners in tests/testing-scripts/.
After each run, read corresponding markdown report in tests/testing-scripts/results/.

Primary suite:
- python tests/testing-scripts/slicing/full_api_test_runner.py

Focused suites:
- python tests/testing-scripts/slicing/full_api_orca_fdm_test_runner.py
- python tests/testing-scripts/slicing/full_api_prusa_fdm_test_runner.py
- python tests/testing-scripts/slicing/full_api_prusa_sl1_test_runner.py
- python tests/testing-scripts/slicing/unsupported_upload_test_runner.py
- python tests/testing-scripts/pricing/pricing_cycle_test_runner.py
- python tests/testing-scripts/admin/admin_output_files_test_runner.py
- python tests/testing-scripts/rate_limit/rate_limit_regression_test_runner.py
- python tests/testing-scripts/operations/operations_readiness_metrics_test_runner.py
- python tests/testing-scripts/queue/queue_concurrency_test_runner.py --count N --expected-max-concurrent N --retry-on-429 1 --cleanup-manifest NEW_MANIFEST_PATH --report NEW_REPORT_PATH

Test organization:
- Keep focused runners small and domain-specific (admin output, rate-limit, queue, pricing).
- Split oversized runners into focused suites instead of appending unrelated checks.
- Preserve stable, deterministic runners unless changed endpoint behavior requires updates.

## Skill Routing
Prefer mirrored skills:
- .github/skills/docker-ops/SKILL.md
- .github/skills/testing/SKILL.md
- .github/skills/docs-sync/SKILL.md
- .github/skills/best-practice/SKILL.md
- .claude/skills/docker-ops/SKILL.md
- .claude/skills/testing/SKILL.md
- .claude/skills/docs-sync/SKILL.md
- .claude/skills/best-practice/SKILL.md

Skills are operational playbooks that point to corresponding agent definitions for full context.

## Agent Definitions
Mirrored in `.claude/agents/` and `.github/agents/`:
- orchestrator — plans multi-domain tasks and delegates to sub-agents in parallel
- js-developer — Node.js + Express code in app/
- python-developer — Python converters, orientation, scaling scripts
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

## Documentation Scope Map
- Global Copilot instructions: .github/copilot-instructions.md
- Global Claude guidance: CLAUDE.md and .claude/CLAUDE.md
- Folder-local docs:
  - app/CLAUDE.md
  - configs/CLAUDE.md
  - tests/testing-scripts/CLAUDE.md
- Additional Copilot instruction packs: .github/instructions/
- Optional Claude MCP template: .claude/.mcp.template.json
