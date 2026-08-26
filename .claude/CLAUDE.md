# 3D Printer Slicer API - Claude Instructions

Last synchronized: 2026-08-26

## Architecture Notice
This repository uses both GitHub Copilot and Claude as primary agentic tools.
If rules are changed here, synchronize with:
- CLAUDE.md
- .github/copilot-instructions.md
- .github/agents/* and .claude/agents/*
- .github/skills/*
- .claude/skills/*
- .github/instructions/*

## Goal
Keep slicing behavior safe, deterministic, and production-friendly while preserving strict domain constraints.

## J1 calibration harvest over the J0 W2/W3 public contract

- Successful Prusa and Orca payloads require lowercase
  `profiles.effective_profile_sha256`. After selection, bounded canonical-realpath
  Prusa bytes and the flattened, versioned repository copy of the allowlisted
  Orca v2.3.1 `Custom` parent chain provide one job-scratch lineage for bounds,
  runtime, digest, and native use. Its exact-image build equality gate passes;
  public fields retain child basenames. Stable Orca runtime settings enforce
  empty `layer_gcode` plus relative extrusion, aligned with the flattened pinned
  machine parent's per-layer `G92 E0` reset.
- J1 selects repository PLA/PETG filament profiles, snapshots their exact bytes,
  and composes Orca settings as machine-process-filament. The effective digest
  binds normalized material and selected filament JSON or explicit null.
  Successful Orca payloads expose nullable filament basename plus actual
  diameter/density. OpenAPI requires nullable `stats.material_used_g`; it may
  contain only a direct G-code mass marker and is never derived from filament
  length. Strict FDM output requires positive time and length. The current Prusa
  FDM profile has no direct grams marker, so its successful response returns
  `material_used_g:null`, `hourly_rate:null`, and
  `stats.estimated_price_huf:null`. Orca with a selected filament profile also
  requires positive direct grams and maps missing/drifted mass to HTTP 500
  `SLICE_OUTPUT_UNPARSED`; profile-less Orca remains null/manual.
- Prusa INI section/key case remains significant. Exact duplicate qualified
  keys fail closed like the native Boost parser; runtime generation replaces
  one exact top-level request key, rejects duplicates, and inserts a missing key
  before the first section.
- OpenAPI adds the four requested omissions `FILE_PROCESSING_TIMEOUT`,
  `INTERNAL_PROCESSING_ERROR`, `ORCA_PROFILE_INCOMPATIBLE`, and
  `MODEL_OUT_OF_PRINTER_BOUNDS`, and places the already-live
  `MODEL_DIMENSIONS_UNAVAILABLE` in the general 422 branch. The bounds code
  requires model dimensions and build-volume limits. The complete live slice-
  500 enum is `SLICE_OUTPUT_UNPARSED`, `INTERNAL_PROCESSING_ERROR`,
  `QUEUE_INTERNAL_ERROR`, `UPLOAD_STORAGE_ERROR`, and `INTERNAL_SERVER_ERROR`.
- Slice requests retain exactly one `x-slicer-api-key` header. Explicit
  `legacy`, finite `migration`, and final `principals` modes select the shared
  compatibility and separate WooCommerce/LeadPilot key families. Public
  `GET /health` and `GET /pricing` remain unchanged. Before any router action,
  the dark gate must prove principal-only readback, one private positive slice
  per principal, retired-shared and `x-api-key` negative cases, and exact
  cleanup. Missing or inconclusive evidence keeps the route dark. External
  production activation is outside repository evidence and authority.
- Every success also requires the atomically startup-verified `engine_version`
  parsed from both selected executables' bounded `--help` output before listen.
  The startup module has exact-image proof and uses a telemetry-disabled runner,
  so its probes cannot alter slice-native lifecycle metrics/events. Orca sends
  `--arrange 1` and
  `--orient 0`: arrangement places already-rotated geometry onto the build
  plate, while auto-orient stays disabled and cannot replace the requested
  rotation. Focused command/digest contracts and final exact-image HTTP
  transform/final-dimensions E2E pass on code SHA `ed85eec63409b7362fe05c2b99031eeb24b5b9c9`
  and local image ID `sha256:66697a1ca69e13600a91481bf474d042c0f89b236ccbaf67fcf2dea8824f2c7f`.
  Both principal families pass; a valid key only under `x-api-key` rejects
  without request residue. That exact-image result is historical J0 evidence,
  not J1 deployment. J1 focused tests cover filament selection/null identity,
  nullable Prusa/manual pricing, selected-profile Orca direct grams, and strict
  marker-drift failure. Strict mode defaults on and never substitutes zero or a
  length-derived mass.
  The retained P1S and new H2D candidates are generic Marlin profiles, so real
  Bambu references, owner-selected models, and acceptance thresholds keep W8
  live calibration `BLOCKED_OWNER_INPUT`.

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

- Normal Image Validation remains read-only/no-push/no-deploy.
- I10 is live-verified at protected-main SHA
  `8253160eef1c3e00c1e40826ec61fd97563ddd9b`; Source `32662043454` and Image
  `32662043476` passed. Strict main policy requires both no-deploy contexts, a
  PR, administrator enforcement, no force-push/deletion, conversation
  resolution, and merge-commit-only integration. Zero approvals are the
  sole-collaborator self-review limitation, not human approval; required
  signatures are not enabled.
- I11 Candidate Publication accepts manual `workflow_dispatch` only from exact
  current protected `main`. Repository, actor `Botond1`, main ref,
  requested/event/checkout/remote SHA, post-I10 ancestry and fixed GHCR
  repository must agree.
- `publish_new` requires an empty digest input, exact
  `PUBLISH_SIGNED_MAIN_CANDIDATE`, and a proven-absent SHA-derived discovery tag.
- `recover_exact_digest` requires exact
  `RECOVER_SIGNED_MAIN_CANDIDATE` plus one lowercase `sha256:<64 hex>` already
  matching the SHA-derived tag and once-built image config. It performs no
  registry push, overwrite or delete.
- Registry, attestation, and OIDC write permissions belong only to the
  publication job, after the shared complete gate passes on the same once-built
  `linux/amd64` image.
- The job uses environment `candidate-publication` with `deployment: false`.
  Environment ID `20443404498` is `LIVE_CONFIG_VERIFIED` on 2026-08-23:
  protected branches true, custom branch policies false, exactly one
  `branch_policy` protection rule (ID `63481958`), and no reviewer/wait-timer
  rules, secrets, variables or deployments.
- Never overwrite/delete an existing discovery tag or create mutable/release/
  staging/production tags. Consumers use only
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:<64 lowercase hex>`.
- A successful protected-main publication automatically triggers the no-deploy
  `workflow_run` rehearsal. It validates one exact publication artifact,
  dynamically binds policy-pinned previous and artifact-derived current
  digests, verifies each image's SLSA/SPDX attestations through API and OCI,
  and runs hardened I9 readiness, `STORAGE_UNSAFE`, automatic rollback,
  bounded evidence and exact cleanup with read permissions only.
- Publication never authorizes deploy. Preserve and classify partial remote
  candidates; exact recovery may continue only a matching digest without
  remote mutation. I11 is complete at protected-main SHA
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
- Node.js + Express API
- Python 3.12 preprocessing/orientation scripts
- PrusaSlicer for FDM and SLA
- OrcaSlicer for FDM
- Docker Compose runtime

## Data Flow
IP rate limit -> x-slicer-api-key authentication -> root-scoped workspace/Multer upload -> FIFO queue -> option validation -> converter/orientation -> transform/bounds check -> native slicer execution -> output parsing -> pricing response.

## Endpoint Reference
Public endpoints:
- GET /health
- GET /ready
- GET /pricing
- GET /openapi.json
- GET /docs
- GET /

Slice-service endpoints (x-slicer-api-key required):
- POST /prusa/slice
- POST /orca/slice

Pricing endpoints (pricing x-api-key):
- POST /pricing/FDM
- POST /pricing/SLA
- PATCH /pricing/:technology/:material
- DELETE /pricing/:technology/:material

Artifact endpoints (artifact x-api-key):
- GET /admin/output-files
- GET /admin/download/:fileName

Operations endpoints (operations x-api-key):
- GET /health/detailed
- GET /operations/readiness
- GET /operations/metrics

## Hard Rules
- Use only root-scoped runtime directories: input/, output/, configs/.
- Never switch to app/input, app/output, or app/configs.
- Fail-fast on invalid geometry with INVALID_SOURCE_GEOMETRY.
- Do not auto-repair or mutate invalid user geometry.
- Keep queue and rate-limiting active for slicing.

## Security
- Normal startup requires pricing, artifact, and operations actives plus one
  complete `SLICE_SERVICE_AUTH_MODE`. Default `legacy` requires shared active
  and forbids principals/expiry; `migration` requires shared active, both
  principal actives, and a future <=90-day legacy expiry; `principals` requires
  both principal actives and forbids shared active/previous and expiry. Optional
  previous slots require their own active. All configured material, including a
  valid `ADMIN_API_KEY`, is globally unique, non-placeholder, and 32-256
  printable ASCII or startup fails; only the admin key's exact authorized
  legacy substitution self-reference is skipped.
- Slice endpoints require exactly one x-slicer-api-key matching an eligible
  configured slice slot; x-api-key is not an alias. Migration shared slots stop
  authorizing at exact request-time expiry while principal slots continue.
  Missing or wrong credentials return HTTP 401 with
  `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
- Pricing, artifact, and operations endpoints require x-api-key matching their
  own active or previous slot; cross-audience keys are rejected.
- Fixed-length digest comparisons cover both slots. Structured auth events are
  bounded/redacted and contain no credential, URL, path, filename, or customer data.
- Rotate in two restarts: new active + old previous, migrate caller, remove
  previous, restart again. Removal revokes the old key.
- ADMIN_API_KEY is legacy migration material only: one non-slice audience,
  explicitly named and expiring within 90 days through
  LEGACY_ADMIN_API_KEY_AUDIENCE + LEGACY_ADMIN_API_KEY_MIGRATION_UNTIL. Any
  other cross-slot reuse is refused.
- Preserve slice route order: rate limiter -> service authentication -> root-scoped workspace -> Multer -> queue -> native processing.
- Forwarded identity defaults off. TRUST_PROXY=true requires unique validated
  explicit IP/CIDR peers or loopback; invalid, broad, wildcard, duplicate, or
  unknown entries refuse startup. Nearest-untrusted-hop semantics resist spoofed XFF.
- Valid inbound X-Request-Id is bounded safe ASCII; invalid input is replaced
  and the resolved value is returned in X-Request-Id.
- No-Origin requests are allowed. Browser-origin protected calls must match only
  their SLICE_, PRICING_, ARTIFACT_, or OPERATIONS_CORS_ALLOWED_ORIGINS list.
  ADMIN_CORS_ALLOWED_ORIGINS is legacy-only for the migrated audience.
- Shell commands use execFile with argument arrays (no shell interpolation).
- Upload accepts only a single file on choosenFile field with extension validation at upload time.
- /admin/download/:fileName enforces extension checks, path containment checks, non-symlink target checks, and realpath containment checks.
- /admin/download/ALL returns a ZIP stream of all valid output files while preserving the same containment/symlink safety checks plus MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES limits.

## Readiness and Observability
- Public /health is liveness; public /ready exposes only READY/NOT_READY.
- /health/detailed uses fresh readiness probes; /ready and
  /operations/readiness use the bounded readiness cache.
- Operations readiness reasons are SHUTDOWN, ADMISSION_CLOSED,
  QUEUE_UNAVAILABLE, NATIVE_RUNTIME_QUARANTINED, STORAGE_UNSAFE,
  RETENTION_UNSAFE, PRICING_UNAVAILABLE, and CONFIG_UNSAFE.
- Versioned structured events use fixed names, bounded request/job/artifact
  correlation, and allowlisted/redacted fields. Metrics use fixed-cardinality
  audience/outcome/reason/duration labels only.
- I6 selects an internal-only API with no host port/default route and one
  authenticated reverse-proxy peer; repository validation requires calibrated
  API/native DNS/TCP/UDP denial. The proxy must not provide generic forwarding,
  NAT, or DNS tunnelling for the API. Decision:
  PRIVATE_PEER_TOPOLOGY_SELECTED; ASYNC_WORKER_DEFERRED. Deployed
  caller/proxy/firewall facts remain UNVERIFIED.

## Engine Constraints
Prusa:
- Supports layer heights: 0.025, 0.05, 0.1, 0.2, 0.3

Orca:
- FDM only
- Supports layer heights: 0.1, 0.2, 0.3
- Requires compatible machine/process profile pairing
- Uses per-request isolated output directories before final output-file alignment.

## Queue and Rate Defaults
- Slice rate limit: 3 requests per minute per IP
- Admin rate limit: 30 requests per minute per IP
- MAX_CONCURRENT_SLICES: default 1; explicit canonical decimal 1..3 only.
  N=2/N=3 remain unqualified and undeployed.
- MAX_SLICE_QUEUE_LENGTH: 100
- MAX_SLICE_QUEUE_PER_IP: 5
- MAX_SLICE_QUEUE_WAIT_MS: 300000
- Slice timeout: 600000 ms
- HTTP_HEADERS_TIMEOUT_MS: 60000, bounded 1000..60000
- HTTP_REQUEST_TIMEOUT_MS: 600000, bounded 60000..600000
- HTTP_KEEP_ALIVE_TIMEOUT_MS: 5000, bounded 1000..60000
- HTTP_MAX_HEADERS_COUNT: 2000, bounded 16..2000
- HTTP_MAX_CONNECTIONS: 128, bounded 1..1024
- HTTP_MAX_REQUESTS_PER_SOCKET: 100, bounded 1..1000
- MAX_ZIP_ENTRIES: 500
- MAX_ZIP_UNCOMPRESSED_BYTES: 524288000

Queue and rate behavior:
- Slice/admin rate-limit responses return HTTP 429 with Retry-After and retryAfterSeconds.
- Rate-limit buckets are periodically pruned (max(windowMs * 2, 60000)).
- SLICE_QUEUE_FULL returns HTTP 503.
- SLICE_QUEUE_CLIENT_LIMIT returns HTTP 429.
- SLICE_QUEUE_TIMEOUT returns HTTP 503.
- Invalid, empty, non-decimal, unsafe, or out-of-range HTTP envelope values fall back to their defaults; headers timeout is capped at request timeout.
- Actual VPS capacity and reverse-proxy timeouts are UNVERIFIED.

## Python Runtime Resolution
- PYTHON_EXECUTABLE is optional but must be an existing absolute path when set.
- Without PYTHON_EXECUTABLE, runtime resolver checks VIRTUAL_ENV/bin/python3 and VIRTUAL_ENV/Scripts/python.exe.
- Additional absolute fallbacks: /opt/venv/bin/python3, /usr/local/bin/python3, /usr/bin/python3.
- Server startup fails if no valid absolute Python executable can be resolved.

## Environment Keys
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
- SLICE_COMMAND_TIMEOUT_MS
- SLICE_STRICT_GCODE_METRICS
- PYTHON_EXECUTABLE
- VIRTUAL_ENV
- ORCA_MACHINE_PROFILE
- ORCA_PROCESS_PROFILE_0_1
- ORCA_PROCESS_PROFILE_0_2
- ORCA_PROCESS_PROFILE_0_3
- TRUST_PROXY
- TRUST_PROXY_CIDRS
- SLICER_BASE_URL

## Skill Packs
Claude skills (operational playbooks mapped to agent definitions):
- .claude/skills/docker-ops/SKILL.md
- .claude/skills/testing/SKILL.md
- .claude/skills/docs-sync/SKILL.md
- .claude/skills/best-practice/SKILL.md

## Agent Definitions
Mirrored in `.claude/agents/` and `.github/agents/`:
- orchestrator — plans multi-domain tasks and delegates to sub-agents in parallel
- js-developer — Node.js + Express code in app/
- python-developer — Python converters, orientation, scaling scripts
- test-engineer — Python integration test runners and reports
- docs-syncer — documentation and instruction file synchronization
- docker-specialist — Dockerfile, docker-compose, container lifecycle
- quality-architect — iterative OOP/SOLID/design-principles refactor workflow with 23-point checklist

For multi-domain tasks, use the orchestrator agent workflow to plan and delegate.

Workflow gates:
- Run fast syntax validation (`node --check`, `python -m py_compile`) before integration suites when source files change.
- Run quality-architect for non-trivial source changes or files near the decomposition guardrails.
- Run the smallest matching Python runner first; run full slicing validation when slicing behavior changes or the user explicitly asks for full validation.
- Run docs-sync last and update mirrored agent/skill assets when workflow policy changes.
- Perform changelog/version/tag work only after validation is green.

Optional MCP:
- `.claude/.mcp.template.json` is a credential-free local MCP template.
- `.claude/.mcp.json` is local-only and must not be committed.

## Testing Rule
After running any Python test runner in tests/testing-scripts/, always read matching markdown report in tests/testing-scripts/results/.

Focused test runners:
- tests/testing-scripts/slicing/unsupported_upload_test_runner.py
- tests/testing-scripts/admin/admin_output_files_test_runner.py
- tests/testing-scripts/rate_limit/rate_limit_regression_test_runner.py
- tests/testing-scripts/operations/operations_readiness_metrics_test_runner.py
- `python tests/testing-scripts/queue/queue_concurrency_test_runner.py --count N --expected-max-concurrent N --retry-on-429 1 --cleanup-manifest NEW_MANIFEST_PATH --report NEW_REPORT_PATH`

The capacity runner requires an exactly empty artifact inventory before load
and writes create-new evidence. Host execution uses the dynamic non-root
service identity; cleanup follows only after the API is stopped and uses the
same exact image consumer described in `ops/hostinger/RUNBOOK.md`.

Test organization:
- Keep focused runners small and behavior-oriented.
- Split oversized runners by domain and avoid mixing unrelated assertions.
- Leave stable deterministic runners unchanged unless endpoint behavior changes.

## Documentation Topology
Global:
- CLAUDE.md
- .claude/CLAUDE.md
- .github/copilot-instructions.md

Folder-local:
- app/CLAUDE.md
- configs/CLAUDE.md
- tests/testing-scripts/CLAUDE.md

Copilot instruction overlays:
- .github/instructions/repository.instructions.md
- .github/instructions/app.instructions.md
- .github/instructions/configs.instructions.md
- .github/instructions/testing-scripts.instructions.md
- .github/instructions/github.instructions.md
- .claude/.mcp.template.json
