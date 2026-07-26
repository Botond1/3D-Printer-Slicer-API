# 3D Printer Slicer API - Copilot Instructions

Last synchronized: 2026-07-26

## Architecture Notice
This project uses both GitHub Copilot and Claude as primary agentic tools.
If architecture/domain rules change in this file, synchronize changes in:
- CLAUDE.md
- .claude/CLAUDE.md
- .github/agents/* and .claude/agents/*
- .github/skills/*
- .claude/skills/*
- .github/instructions/*

## Goal
Provide a stable and secure slicing API with strict fail-fast validation and production-safe queue controls.

## Candidate Image Publication Boundary

- Normal Image Validation remains read-only and never pushes, attests, or
  deploys.
- Candidate Publication retains exact-input `workflow_dispatch` and also
  accepts `push` only for `codex/i8-s3a-ghcr-signed-candidate`.
- Push authorization derives `github.sha` and requires exact repository
  `Botond1/3D-Printer-Slicer-API`, exact ref
  `refs/heads/codex/i8-s3a-ghcr-signed-candidate`, actor `Botond1`, hardcoded
  `ghcr.io/botond1/3d-printer-slicer-api`, and exact final non-empty commit
  line `I8-Publication: PUBLISH_I8_SIGNED_GHCR_CANDIDATE`.
- Both event paths fail closed and emit canonical `candidate_sha`, `image_ref`,
  `discovery_tag`, and `registry_repository` outputs.
- Only its publication job may hold packages/attestations/OIDC write
  permissions, and only after the complete shared gate succeeds on the same
  once-built `linux/amd64` image may it log in and push.
- Refuse any existing discovery tag. Never create `latest`, release, staging,
  or production tags. Consumption is only by
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:<64 lowercase hex>`.
- Publication is not deployment. Preserve and classify any partial published
  candidate; never overwrite, delete, promote, or deploy it.
- Pre-correction local and remote HEAD are
  `c49bfc698d4d41041e6216c76a11144ffb386183`; hosted Source run
  `30163991878` and Image run `30163991870` are `SUCCESS`. One normal
  non-force corrective push to the existing I8 branch is authorized; its exact
  Source/Image/Publication runs are pending. No registry side effect exists;
  candidate digest, signature, and attestations are `NOT_CREATED`.
- Preserve the no-`main`, no-PR/merge/force-push, no-release/Git-tag, no
  mutable-image-tag, no-deploy, and no-repository-setting-change boundary.

## Technology Baseline
- Backend: Node.js + Express
- Processing: Python 3.12
- Engines: PrusaSlicer (FDM and SLA), OrcaSlicer (FDM only)
- Runtime: Docker Compose

## Repository Surface
- app/: server bootstrap, routes, middleware, services, python converters
- configs/: pricing and slicer profile configuration
- input/: temporary request input workspace
- output/: generated .gcode/.sl1 artifacts
- tests/testing-scripts/: Python integration tests and report generation
- .github/: CI workflow + Copilot instructions + skill mirrors + instruction overlays

## Runtime Flow
Slice IP rate limit -> x-slicer-api-key authentication -> root-scoped workspace/Multer upload -> queue -> validate options -> convert/orient -> transform -> native slice -> parse stats -> compute pricing -> return response.

## Endpoint Snapshot
Public:
- GET /health
- GET /ready
- GET /pricing
- GET /openapi.json
- GET /docs
- GET /

Slice-service protected (x-slicer-api-key):
- POST /prusa/slice
- POST /orca/slice

Pricing protected (pricing x-api-key):
- POST /pricing/FDM
- POST /pricing/SLA
- PATCH /pricing/:technology/:material
- DELETE /pricing/:technology/:material

Artifact protected (artifact x-api-key):
- GET /admin/output-files
- GET /admin/download/:fileName

Operations protected (operations x-api-key):
- GET /health/detailed
- GET /operations/readiness
- GET /operations/metrics

## Non-negotiable Constraints
- Keep runtime folders root-scoped: input/, output/, configs/.
- Never use app/input, app/output, or app/configs.
- Keep fail-fast policy for invalid geometry (INVALID_SOURCE_GEOMETRY).
- Never suggest auto-healing source models.
- Preserve queue and rate-limit protections for slicing endpoints.

## Queue and Rate Defaults
- 3 requests / 60s / IP for slicing routes
- 30 requests / 60s / IP for admin routes
- MAX_CONCURRENT_SLICES default: 1
- MAX_SLICE_QUEUE_LENGTH default: 100
- MAX_SLICE_QUEUE_PER_IP default: 5
- MAX_SLICE_QUEUE_WAIT_MS default: 300000
- Slice command timeout default: 600000 ms
- HTTP headers timeout: 60000 ms, bounded 1000..60000
- HTTP request timeout: 600000 ms, bounded 60000..600000
- HTTP keep-alive timeout: 5000 ms, bounded 1000..60000
- HTTP header count: 2000, bounded 16..2000
- HTTP connections: 128, bounded 1..1024
- HTTP requests per socket: 100, bounded 1..1000
- MAX_ZIP_ENTRIES default: 500
- MAX_ZIP_UNCOMPRESSED_BYTES default: 524288000

## Queue and Rate Behavior Details
- Slice and admin throttling return HTTP 429 with Retry-After and retryAfterSeconds.
- Expired in-memory rate-limit buckets are periodically removed at max(windowMs * 2, 60000).
- Queue overflow returns SLICE_QUEUE_FULL (HTTP 503).
- Per-client queue cap returns SLICE_QUEUE_CLIENT_LIMIT (HTTP 429).
- Queue wait timeout returns SLICE_QUEUE_TIMEOUT (HTTP 503).
- Invalid, empty, non-decimal, unsafe, or out-of-range HTTP envelope values fall back to the documented defaults; effective headers timeout is capped at request timeout.
- Actual VPS capacity and reverse-proxy timeouts remain UNVERIFIED.

## Engine Boundaries
Prusa:
- Layer heights: 0.025, 0.05, 0.1, 0.2, 0.3
- SLA inferred for 0.025 and 0.05

Orca:
- FDM only
- Layer heights: 0.1, 0.2, 0.3
- Machine/process profile compatibility is mandatory
- Output mapping uses per-request isolated output directories to avoid cross-request artifact races.

## Security Rules
- Normal startup requires distinct active SLICE_SERVICE_API_KEY,
  PRICING_API_KEY, ARTIFACT_API_KEY, and OPERATIONS_API_KEY values. Optional
  `_PREVIOUS` slots are audience-local; all configured values must be unique,
  non-placeholder, and 32-256 printable-ASCII bytes.
- Slice endpoints require x-slicer-api-key matching SLICE_SERVICE_API_KEY. Missing or wrong credentials return HTTP 401 with `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
- Pricing, artifact, and operations endpoints require x-api-key matching only
  their active or previous scoped slot. Cross-audience keys are rejected.
- Authentication compares fixed-length SHA-256 digests for both slots.
  Structured rejection events are bounded/redacted and contain no key, URL,
  path, filename, or customer data.
- Rotation uses two restarts: replacement active + former active previous,
  caller migration, then previous removal and a second restart for revocation.
- ADMIN_API_KEY is a finite legacy migration key only: one non-slice audience
  named by LEGACY_ADMIN_API_KEY_AUDIENCE, with
  LEGACY_ADMIN_API_KEY_MIGRATION_UNTIL no more than 90 days away.
- Preserve slice route order: rate limiter -> service authentication -> root-scoped workspace -> Multer -> queue -> native processing.
- Forwarded identity defaults off. TRUST_PROXY=true requires unique validated
  explicit IP/CIDR peers or loopback; malformed, wildcard, overbroad,
  duplicate, or unknown entries refuse startup. Nearest-untrusted-hop
  resolution prevents a direct untrusted peer selecting spoofed XFF prefixes.
- Safe inbound X-Request-Id values are bounded; invalid input is replaced and
  the resolved value is returned.
- No-Origin requests remain allowed. Browser-origin protected calls use only
  the matching SLICE_, PRICING_, ARTIFACT_, or
  OPERATIONS_CORS_ALLOWED_ORIGINS list. ADMIN_CORS_ALLOWED_ORIGINS is
  legacy-only for the one migrated audience.
- /admin/download/:fileName must enforce extension validation, path containment checks, non-symlink checks, and realpath containment checks.
- /admin/download/ALL must return ZIP output while preserving the same containment/symlink safety checks plus MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES limits.
- Shell commands use execFile with argument arrays (no shell interpolation).
- Upload accepts only a single file on choosenFile field with extension validation at upload time.

## Readiness, Observability, and Topology
- Public /health is liveness; public /ready exposes only READY/NOT_READY.
- /health/detailed uses fresh readiness probes; /ready and
  /operations/readiness use the bounded readiness cache.
- Operations readiness reasons are SHUTDOWN, ADMISSION_CLOSED,
  QUEUE_UNAVAILABLE, NATIVE_RUNTIME_QUARANTINED, STORAGE_UNSAFE,
  RETENTION_UNSAFE, PRICING_UNAVAILABLE, and CONFIG_UNSAFE.
- Versioned structured events use fixed names, bounded request/job/artifact
  correlation, and allowlisted/redacted fields. Runtime metrics use only fixed
  audience/outcome/reason/duration labels.
- I6 selects an internal-only API with no host port/default route and one
  authenticated reverse-proxy peer; repository validation requires calibrated
  API/native DNS/TCP/UDP denial. The proxy must not provide generic forwarding,
  NAT, or DNS tunnelling for the API. Decision:
  PRIVATE_PEER_TOPOLOGY_SELECTED; ASYNC_WORKER_DEFERRED. Deployed
  caller/proxy/firewall facts remain UNVERIFIED.

## Python Runtime Resolution
- PYTHON_EXECUTABLE is optional but must be an existing absolute path when set.
- Fallback resolution checks VIRTUAL_ENV/bin/python3 and VIRTUAL_ENV/Scripts/python.exe.
- Additional fallback candidates are absolute paths: /opt/venv/bin/python3, /usr/local/bin/python3, /usr/bin/python3.
- Server startup fails if no valid absolute Python executable can be resolved.

## Preferred Skills
Skills (operational playbooks mapped to agent definitions):
- .github/skills/docker-ops/SKILL.md
- .github/skills/testing/SKILL.md
- .github/skills/docs-sync/SKILL.md
- .github/skills/best-practice/SKILL.md

## Agent Definitions
Mirrored in `.github/agents/` and `.claude/agents/`:
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

## Test Execution Rule
After every test run, read the generated markdown report under tests/testing-scripts/results/ before concluding.

Focused test runners:
- tests/testing-scripts/slicing/unsupported_upload_test_runner.py
- tests/testing-scripts/admin/admin_output_files_test_runner.py
- tests/testing-scripts/rate_limit/rate_limit_regression_test_runner.py
- tests/testing-scripts/operations/operations_readiness_metrics_test_runner.py

Test organization:
- Keep focused runners small and behavior-specific.
- Split overly complex runners by domain rather than appending unrelated checks.
- Keep stable deterministic runners unchanged unless endpoint behavior requires updates.

## Environment and Config Keys
- SLICE_SERVICE_API_KEY
- SLICE_SERVICE_API_KEY_PREVIOUS
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

## Documentation Layout
Global:
- .github/copilot-instructions.md
- CLAUDE.md
- .claude/CLAUDE.md

Folder-local:
- app/CLAUDE.md
- configs/CLAUDE.md
- tests/testing-scripts/CLAUDE.md

Instruction overlays:
- .github/instructions/repository.instructions.md
- .github/instructions/app.instructions.md
- .github/instructions/configs.instructions.md
- .github/instructions/testing-scripts.instructions.md
- .github/instructions/github.instructions.md
- .claude/.mcp.template.json
