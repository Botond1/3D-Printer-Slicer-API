---
applyTo: "**"
---

# Repository Wide Instructions

Last synchronized: 2026-07-23

## Architecture
- Backend stack is Node.js + Express + Python helper scripts.
- Slicing engines: PrusaSlicer (FDM/SLA) and OrcaSlicer (FDM only).
- Service-authenticated slicing endpoints: /prusa/slice and /orca/slice.

## Hard Constraints
- Runtime directories must remain root-scoped: input/, output/, configs/.
- Do not introduce app/input, app/output, or app/configs.
- Fail-fast model policy: reject invalid source geometry with INVALID_SOURCE_GEOMETRY.
- Keep queueing and rate-limiting active for CPU-heavy slicing work.
- Keep Orca output mapping deterministic via per-request isolated output directory handling.
- Preserve slice route order: limiter -> x-slicer-api-key authentication -> root-scoped workspace/Multer -> queue -> native processing.

## Security
- ADMIN_API_KEY is mandatory at startup.
- SLICE_SERVICE_API_KEY is mandatory, must contain 32-256 printable-ASCII bytes, and must differ from ADMIN_API_KEY.
- Both slice routes require x-slicer-api-key. Missing or wrong values return exact HTTP 401 `SLICE_SERVICE_AUTH_REQUIRED` before workspace allocation.
- Slice-auth comparison uses fixed-size SHA-256 digests plus crypto.timingSafeEqual; rejection logs contain only requestId and resolved client IP.
- No-Origin requests are allowed. Browser-origin slice calls use only SLICE_CORS_ALLOWED_ORIGINS.
- Admin routes require x-api-key header (timing-safe comparison).
- Admin routes are IP-rate-limited to reduce brute-force API key attempts.
- X-Forwarded-For is only trusted when TRUST_PROXY=true and TRUST_PROXY_CIDRS is configured.
- Unauthorized admin access logging must include requestId + forwarded-header-aware client IP parsing.
- Python executable resolution must use absolute validated paths (PYTHON_EXECUTABLE or trusted fallbacks).
- Admin output download must preserve extension allowlist and path/symlink containment checks.
- Admin output download supports special token ALL for ZIP bulk export while preserving the same containment/symlink safety checks plus MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES limits.
- Shell commands use execFile with argument arrays (no shell interpolation).
- Upload accepts only a single file on choosenFile field with extension validation.
- HTTP defaults/bounds are headers timeout 60000 [1000,60000], request timeout 600000 [60000,600000], keep-alive timeout 5000 [1000,60000], header count 2000 [16,2000], connections 128 [1,1024], and requests/socket 100 [1,1000].
- Invalid HTTP envelope overrides fall back to defaults and effective headers timeout is capped at request timeout. Actual VPS capacity and reverse-proxy timeouts are UNVERIFIED.

## Testing
- Use Python test runners under tests/testing-scripts/.
- Always read generated markdown report from tests/testing-scripts/results/ after runs.

## Agentic Workflow Gates
- Run fast syntax validation before integration tests when source files change.
- Run quality-architect for non-trivial source changes or decomposition guardrail pressure.
- Run docs-sync after code/test/workflow updates settle.
- Keep `.claude/.mcp.template.json` credential-free; never commit `.claude/.mcp.json`.

## Multi-agent Sync
When changing architecture/domain policies, keep synchronized:
- .github/copilot-instructions.md
- CLAUDE.md
- .claude/CLAUDE.md
- .github/skills/*
- .claude/skills/*
- .github/agents/*
- .claude/agents/*
