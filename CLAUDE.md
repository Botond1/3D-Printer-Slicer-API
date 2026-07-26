# 3D Printer Slicer API - Claude Operating Guide

Last synchronized: 2026-07-26

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

## Candidate image publication boundary

- Normal Image Validation remains read-only, builds once, and never pushes,
  attests, or deploys.
- Candidate Publication retains `workflow_dispatch` for later default-branch
  integration and also accepts `push` only on
  `codex/i8-s3a-ghcr-signed-candidate`. Manual dispatch keeps the exact input
  contract.
- The push path derives the candidate from `github.sha` and requires exact
  repository `Botond1/3D-Printer-Slicer-API`, exact ref
  `refs/heads/codex/i8-s3a-ghcr-signed-candidate`, actor `Botond1`, hardcoded
  registry `ghcr.io/botond1/3d-printer-slicer-api`, and exact last non-empty
  commit line
  `I8-Publication: PUBLISH_I8_SIGNED_GHCR_CANDIDATE`.
- Both event paths fail closed and produce the canonical `candidate_sha`,
  `image_ref`, `discovery_tag`, and `registry_repository` outputs.
- Only its publication job may use `packages: write`, `attestations: write`,
  and `id-token: write`. Login and push occur only after the complete shared
  exact-image gate passes on the same once-built `linux/amd64` image.
- Never overwrite an existing discovery tag or create `latest`, release,
  staging, or production tags. Downstream consumption is exact-digest only:
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:<64 lowercase hex>`.
- Publication is not deployment. Preserve partial candidates and report the
  fail-closed I8 status; do not delete, promote, or deploy them.
- Before the one authorized corrective commit/push, local and remote HEAD are
  `c49bfc698d4d41041e6216c76a11144ffb386183`; hosted Source
  `30163991878` and Image `30163991870` are green. The corrective SHA and its
  Source/Image/Publication runs are pending. No registry, signature, or
  attestation side effect exists.
- Only one normal non-force corrective push to the existing I8 branch is
  authorized. It must not modify `main`, open a PR, merge, force-push, create a
  release/Git tag/mutable image tag, deploy, or change repository settings.

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
- Active scoped keys are mandatory for slice, pricing, artifact, and operations:
  SLICE_SERVICE_API_KEY, PRICING_API_KEY, ARTIFACT_API_KEY, and
  OPERATIONS_API_KEY. Each optional `_PREVIOUS` slot is accepted only for its
  audience. All configured material must be unique, 32-256 printable-ASCII
  bytes, and non-placeholder; invalid configuration refuses startup generically.
- Slice requests must pass x-slicer-api-key matching SLICE_SERVICE_API_KEY. Missing or wrong credentials return HTTP 401 with `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
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
  operation is scoped and fail closed; slice/broad/expired migration is refused.
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
- Max concurrent slice jobs: 1
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
- python tests/testing-scripts/queue/queue_concurrency_test_runner.py --count <N> --retry-on-429 3

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
