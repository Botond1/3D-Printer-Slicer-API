# 3D Printer Slicer API - Claude Instructions

Last synchronized: 2026-07-23

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
- GET /pricing
- GET /openapi.json
- GET /docs
- GET /

Slice-service endpoints (x-slicer-api-key required):
- POST /prusa/slice
- POST /orca/slice

Admin endpoints (x-api-key required):
- GET /health/detailed
- POST /pricing/FDM
- POST /pricing/SLA
- PATCH /pricing/:technology/:material
- DELETE /pricing/:technology/:material
- GET /admin/output-files
- GET /admin/download/:fileName

## Hard Rules
- Use only root-scoped runtime directories: input/, output/, configs/.
- Never switch to app/input, app/output, or app/configs.
- Fail-fast on invalid geometry with INVALID_SOURCE_GEOMETRY.
- Do not auto-repair or mutate invalid user geometry.
- Keep queue and rate-limiting active for slicing.

## Security
- ADMIN_API_KEY must be configured to start API.
- SLICE_SERVICE_API_KEY must be configured, contain 32-256 bytes of printable ASCII, and differ from ADMIN_API_KEY.
- Slice endpoints require x-slicer-api-key matching SLICE_SERVICE_API_KEY. Missing or wrong credentials return HTTP 401 with `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
- Slice service comparison uses fixed-length SHA-256 digests with crypto.timingSafeEqual. Rejection logs contain only requestId and resolved client IP.
- Preserve slice route order: rate limiter -> service authentication -> root-scoped workspace -> Multer -> queue -> native processing.
- Admin operations require matching x-api-key header.
- Admin API key comparison uses crypto.timingSafeEqual (constant-time).
- Admin auth failures are rate-limited and logged with requestId + resolved client IP.
- X-Forwarded-For is only trusted when TRUST_PROXY=true and TRUST_PROXY_CIDRS is configured.
- Browser-origin requests to /admin/* are restricted by ADMIN_CORS_ALLOWED_ORIGINS.
- Slice requests without Origin are allowed. Browser-origin slice calls must match SLICE_CORS_ALLOWED_ORIGINS only.
- Shell commands use execFile with argument arrays (no shell interpolation).
- Upload accepts only a single file on choosenFile field with extension validation at upload time.
- /admin/download/:fileName enforces extension checks, path containment checks, non-symlink target checks, and realpath containment checks.
- /admin/download/ALL returns a ZIP stream of all valid output files while preserving the same containment/symlink safety checks plus MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES limits.

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
- MAX_CONCURRENT_SLICES: 1
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
- DEBUG_COMMAND_LOGS=true enables verbose subprocess command logs.

## Environment Keys
- ADMIN_API_KEY
- SLICE_SERVICE_API_KEY
- PORT
- ADMIN_CORS_ALLOWED_ORIGINS
- SLICE_CORS_ALLOWED_ORIGINS
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
- DEBUG_COMMAND_LOGS
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
