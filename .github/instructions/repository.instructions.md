---
applyTo: "**"
---

# Repository Wide Instructions

Last synchronized: 2026-08-23

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
- I10 live policy is verified at exact protected-main SHA
  `8253160eef1c3e00c1e40826ec61fd97563ddd9b`; Source `32662043454` and Image
  `32662043476` succeeded. Strict required checks bind both no-deploy GitHub
  Actions contexts. Main requires a PR, includes administrators, forbids
  force-push/deletion, requires conversation resolution and enables merge
  commits only. Zero approvals reflect the sole-collaborator self-review limit,
  not human approval; required signatures are not enabled.
- Normal Source/Image Validation remains read-only/no-push. I11 Candidate
  Publication is manual `workflow_dispatch` only from exact current protected
  `main`. Repository, actor `Botond1`, main ref, requested/event/checkout/remote
  SHA, post-I10 ancestry and fixed GHCR repository must match.
- `publish_new` requires an empty existing digest, exact
  `PUBLISH_SIGNED_MAIN_CANDIDATE`, and a proven-absent SHA-derived tag before the
  once-built fully gated image may be pushed.
- `recover_exact_digest` requires exact
  `RECOVER_SIGNED_MAIN_CANDIDATE` plus one lowercase `sha256:<64 hex>` already
  matching the SHA-derived tag manifest and once-built image config. It performs
  no registry push, overwrite or delete.
- Global permission is none, preflight is contents-read, and only publication
  may use contents-read plus packages/attestations/OIDC write. The publication
  job binds environment `candidate-publication` with `deployment: false`.
  Environment ID `20443404498` is `LIVE_CONFIG_VERIFIED` on 2026-08-23:
  protected branches true, custom branch policies false, exactly one
  `branch_policy` protection rule (ID `63481958`), and no reviewer/wait-timer
  rules, secrets, variables or deployments.
- Both modes remain build-once, full-gate-before-login, digest-only,
  signed/attested and no-deploy. Never create mutable/release/staging/production
  tags. Recovery evidence must not claim tag absence, an image push or a
  registry write.
- Evidence may report only `I11_MAIN_CANDIDATE_EVIDENCE_READY`; final
  enforcement may report `I11_MAIN_SIGNED_CANDIDATE_COMPLETE` only after exact
  digest identity, attestations, verification, bounded upload and both cleanup
  outcomes pass. I11 implementation and hosted results remain `PENDING` until
  observed.
- A successful protected-main publication automatically triggers only the
  completed/main `workflow_run` rehearsal. One exact bounded publication
  artifact plus the release policy generates distinct previous/current
  digest-only identities; both images require SLSA/SPDX API+OCI verification
  before hardened I9 readiness, `STORAGE_UNSAFE`, automatic rollback, bounded
  evidence and exact cleanup. Rehearsal permissions are read-only and its
  hosted result remains `PENDING`.
- Hosted S4/S5 and I9 topology/rollback evidence is ephemeral repository proof,
  not production. Deployed caller/proxy/firewall/secrets/digest/VPS/readiness/
  rollback remain unverified and separately authorized.

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
