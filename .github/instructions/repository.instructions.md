---
applyTo: "**"
---

# Repository Wide Instructions

Last synchronized: 2026-07-30

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
- Normal startup requires distinct active slice, pricing, artifact, and
  operations keys. Optional previous slots are audience-local; every configured
  value must be unique, non-placeholder, and 32-256 printable-ASCII bytes.
- Both slice routes require x-slicer-api-key. Missing or wrong values return exact HTTP 401 `SLICE_SERVICE_AUTH_REQUIRED` before workspace allocation.
- Pricing, artifact, and operations routes require x-api-key for only their
  active or previous audience slot. All comparisons use fixed-size digests.
- Rotate through two restarts; removing previous before restart revokes the old key.
- ADMIN_API_KEY is only a <=90-day, explicitly named, one non-slice audience
  migration. Normal behavior is scoped and fail closed.
- No-Origin requests are allowed. Browser-origin protected calls use only their
  SLICE_, PRICING_, ARTIFACT_, or OPERATIONS_CORS_ALLOWED_ORIGINS list.
- Protected x-api-key routes remain IP-rate-limited.
- Forwarded identity defaults off. TRUST_PROXY=true must compile unique,
  validated explicit IP/CIDR peers or loopback and refuse wildcard/overbroad/
  malformed/unknown values. Use nearest-untrusted-hop client identity.
- Accept only bounded safe inbound request IDs; replace unsafe values and return
  the resolved X-Request-Id.
- Python executable resolution must use absolute validated paths (PYTHON_EXECUTABLE or trusted fallbacks).
- Admin output download must preserve extension allowlist and path/symlink containment checks.
- Admin output download supports special token ALL for ZIP bulk export while preserving the same containment/symlink safety checks plus MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES limits.
- Shell commands use execFile with argument arrays (no shell interpolation).
- Upload accepts only a single file on choosenFile field with extension validation.
- HTTP defaults/bounds are headers timeout 60000 [1000,60000], request timeout 600000 [60000,600000], keep-alive timeout 5000 [1000,60000], header count 2000 [16,2000], connections 128 [1,1024], and requests/socket 100 [1,1000].
- Invalid HTTP envelope overrides fall back to defaults and effective headers timeout is capped at request timeout. Actual VPS capacity and reverse-proxy timeouts are UNVERIFIED.
- Public /health is liveness and /ready is minimal readiness. Detailed
  health/readiness/metrics require operations scope. Keep readiness reason codes
  stable and all event/metric fields bounded, allowlisted, redacted, and
  fixed-cardinality.
- Development Compose remains loopback-published on an ordinary bridge; local
  Docker Desktop 29.6.1 showed that topology permits API/native DNS/TCP/UDP
  egress. The separate production manifest uses an internal private bridge,
  no host port, and a digest-only image, but deployed proxy/firewall/egress
  topology remains `UNVERIFIED`.
- Normal Source/Image Validation is read-only/no-push. Candidate Publication
  retains exact-input `workflow_dispatch` and adds `push` only for
  `codex/i8-s3a-ghcr-signed-candidate`. The push path derives `github.sha` and
  requires repository `Botond1/3D-Printer-Slicer-API`, ref
  `refs/heads/codex/i8-s3a-ghcr-signed-candidate`, actor `Botond1`, hardcoded
  `ghcr.io/botond1/3d-printer-slicer-api`, and exact last non-empty commit line
  `I8-Publication: PUBLISH_I8_SIGNED_GHCR_CANDIDATE`.
- Both event paths fail closed and produce canonical `candidate_sha`,
  `image_ref`, `discovery_tag`, and `registry_repository` outputs. Publication remains
  build-once, full-gate-before-login/push, digest-only, signed/attested, and
  no-deploy. Never overwrite a discovery tag or create mutable promotion tags.
- Pre-C4 HEAD is `81872eda8d7c594ce3a12d79d4c02ecf9e26c6f3`. Source
  `30545194526` and Image `30545194494` are green; Image artifact
  `8760548898` exists. Candidate `30545194754` published the quarantined tag,
  then failed at `digest_roundtrip` when host `ps` reported `process ID out of
  range` after detach/immediate PID handling. The exact inspected PID is
  `UNVERIFIED`. Preserve the tag unchanged at digest
  `sha256:362149192fec548f546cd0a9744b7e9e3cb6d487fa4a825034c26c98aa1fc736`
  and config
  `sha256:b0217aaaf15bac65f2db565e306ded40fa611e26ea3535dfe52a1d2483ae0657`.
  Attestations and candidate artifact are absent, cleanup succeeded, and the
  classification is `I8_CANDIDATE_PUBLISHED_UNATTESTED`.
- C4 uses one bounded exact-container/image state proof in both shared
  prepublication and post-push digest paths. It requires allowlisted state,
  the same positive PID in consecutive healthy observations before host `ps`,
  matching positive UID/GID, and a post-`ps` same-state confirmation. Exact
  `running` status and false paused/restarting/dead flags are required; exited,
  unhealthy, missing-health, OOM, state-error, malformed, timeout, and changed
  state fail closed. Failed upload storage callbacks wait for output close
  before workspace cleanup without changing deadline or retry policy.
- Uploaded evidence may report only `I8_CANDIDATE_EVIDENCE_READY`; only final
  enforcement after evidence upload, publication cleanup, and evidence cleanup
  may report `I8_SIGNED_CANDIDATE_COMPLETE`; both cleanup outcomes remain
  visible in the final summary.
- Post-correction C4 evidence is 734/734 affected tests, full JavaScript
  1296/1296, and Python 42/43 pass with one expected Windows POSIX-permission
  skip. Local Docker is `NOT_RUN_ENVIRONMENT`. One C4 commit and one normal non-force corrective push
  remain authorized. Replacement hosted results are `PENDING`. `main`,
  PR/merge/force-push, later correction, old-tag mutation, release/Git tag,
  deploy, and repository settings remain outside authorization.

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
