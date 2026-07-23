# 3D Printer Slicer API - Copilot Instructions

Last synchronized: 2026-07-23

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
- GET /pricing
- GET /openapi.json
- GET /docs
- GET /

Slice-service protected (x-slicer-api-key):
- POST /prusa/slice
- POST /orca/slice

Admin protected (x-api-key):
- GET /health/detailed
- POST /pricing/FDM
- POST /pricing/SLA
- PATCH /pricing/:technology/:material
- DELETE /pricing/:technology/:material
- GET /admin/output-files
- GET /admin/download/:fileName

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
- ADMIN_API_KEY must be present at startup.
- SLICE_SERVICE_API_KEY must be present, contain 32-256 bytes of printable ASCII, and differ from ADMIN_API_KEY.
- Slice endpoints require x-slicer-api-key matching SLICE_SERVICE_API_KEY. Missing or wrong credentials return HTTP 401 with `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
- Slice service comparison hashes both values to fixed-length SHA-256 digests and uses crypto.timingSafeEqual. Rejections log only requestId and resolved client IP.
- Preserve slice route order: rate limiter -> service authentication -> root-scoped workspace -> Multer -> queue -> native processing.
- Admin routes require x-api-key equal to ADMIN_API_KEY.
- Admin API key comparison uses crypto.timingSafeEqual (constant-time).
- Admin middleware applies rate limiting and logs failures with requestId + resolved client IP.
- X-Forwarded-For is only trusted when TRUST_PROXY=true and TRUST_PROXY_CIDRS is configured.
- Browser-origin requests to /admin/* are restricted through ADMIN_CORS_ALLOWED_ORIGINS.
- Slice requests without Origin remain allowed. Browser-origin slice requests must match SLICE_CORS_ALLOWED_ORIGINS only.
- /admin/download/:fileName must enforce extension validation, path containment checks, non-symlink checks, and realpath containment checks.
- /admin/download/ALL must return ZIP output while preserving the same containment/symlink safety checks plus MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES limits.
- Shell commands use execFile with argument arrays (no shell interpolation).
- Upload accepts only a single file on choosenFile field with extension validation at upload time.

## Python Runtime Resolution
- PYTHON_EXECUTABLE is optional but must be an existing absolute path when set.
- Fallback resolution checks VIRTUAL_ENV/bin/python3 and VIRTUAL_ENV/Scripts/python.exe.
- Additional fallback candidates are absolute paths: /opt/venv/bin/python3, /usr/local/bin/python3, /usr/bin/python3.
- Server startup fails if no valid absolute Python executable can be resolved.
- DEBUG_COMMAND_LOGS=true enables verbose subprocess command logging.

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

Test organization:
- Keep focused runners small and behavior-specific.
- Split overly complex runners by domain rather than appending unrelated checks.
- Keep stable deterministic runners unchanged unless endpoint behavior requires updates.

## Environment and Config Keys
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
