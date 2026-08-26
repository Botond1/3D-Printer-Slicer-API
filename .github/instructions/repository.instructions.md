---
applyTo: "**"
---

# Repository Wide Instructions

Last synchronized: 2026-08-26

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
- Normal startup requires pricing, artifact, and operations active keys plus one
  complete slice mode: default shared-only `legacy`; shared plus both principals
  and a future <=90-day expiry for `migration`; or both principals with no
  shared slots/expiry for `principals`. Reject one-principal and previous-
  without-active states; every configured value, including a valid
  `ADMIN_API_KEY`, must be globally unique, non-placeholder, and 32-256
  printable ASCII. Only the admin key's exact authorized legacy substitution
  self-reference is skipped.
- Both slice routes require exactly one x-slicer-api-key header; x-api-key is not
  a slice alias and service auth must not gain a dual reader. Missing, wrong, or
  migration-expired shared values return exact HTTP 401
  `SLICE_SERVICE_AUTH_REQUIRED` before workspace allocation. Principal slots
  continue at and after migration expiry.
- Pricing, artifact, and operations routes require x-api-key for only their
  active or previous audience slot. All comparisons use fixed-size digests.
- Rotate through two restarts; removing previous before restart revokes the old key.
- ADMIN_API_KEY is only a <=90-day, explicitly named, one non-slice audience
  migration. Any other cross-slot reuse is refused; normal behavior is scoped
  and fail closed.
- Before any router action, require the principal-only dark gate: sanitized
  `principals` readback with both actives and no shared/expiry material, one
  private positive slice per principal, retired-shared and `x-api-key` negative
  cases, and exact cleanup. Missing or inconclusive evidence keeps the route
  dark. External production activation is outside repository evidence and
  authority.
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
- Snapshot selected canonical regular Prusa bytes and the allowlisted,
  flattened versioned repository copy of the Orca v2.3.1 `Custom` parent chain
  into job scratch before bounds/runtime use. The same lineage feeds bounds,
  runtime, digest, and native invocation, while public fields retain child
  basenames. Preserve the Docker build equality gate against pinned native
  parents and stable Orca `layer_gcode=''` / `use_relative_e_distances='1'`,
  aligned with each selected repository child machine's exact
  `layer_change_gcode='G92 E0'` override. Keep machine/process under
  `--load-settings` and optional selected filament under `--load-filaments`.
- Every successful Prusa/Orca response requires actual-selected-executable
  `engine_version` and lowercase `profiles.effective_profile_sha256`. Keep
  Prusa section/key identity case-sensitive and reject exact duplicate
  qualified keys like the native Boost parser.
- OpenAPI includes the four requested omitted runtime codes plus the already-
  live `MODEL_DIMENSIONS_UNAVAILABLE` general-422 correction. Keep the bounds
  branch disjoint and require both dimension payloads. Keep the complete live
  slice-500 enum: `INTERNAL_PROCESSING_ERROR`, `QUEUE_INTERNAL_ERROR`,
  `UPLOAD_STORAGE_ERROR`, and `INTERNAL_SERVER_ERROR`.
- Resolve both selected engines' versions atomically from bounded `--help`
  output before listen; publish neither unless both pass. The startup module has
  exact-image proof. Keep Orca invocation at `--arrange 1` / `--orient 0` after
  preprocessing/bounds checks: arrangement places the already-rotated model
  onto the build plate, while auto-orient stays disabled and cannot replace the
  requested rotation. Focused command/digest contracts and final exact-image
  HTTP transform/final-dimensions E2E pass for both principals; the exact local
  code/image identity is recorded in the J0 evidence document.
- Filament-profile identity plus `material_used_g` is a separate W8 prerequisite
  classified `BLOCKED_OWNER_INPUT / NOT_STARTED` pending required Bambu
  reference profile fields; do not infer it from the effective-profile digest.
- HTTP defaults/bounds are headers timeout 60000 [1000,60000], request timeout 600000 [60000,600000], keep-alive timeout 5000 [1000,60000], header count 2000 [16,2000], connections 128 [1,1024], and requests/socket 100 [1,1000].
- Invalid HTTP envelope overrides fall back to defaults and effective headers timeout is capped at request timeout. Actual VPS capacity and reverse-proxy timeouts are UNVERIFIED.
- Public /health is liveness and /ready is minimal readiness. Detailed
  health/readiness/metrics require operations scope. Keep readiness reason codes
  stable and all event/metric fields bounded, allowlisted, redacted, and
  fixed-cardinality.
- Development Compose remains loopback-published on an ordinary bridge; local
  Docker Desktop 29.6.1 showed that topology permits API/native DNS/TCP/UDP
  egress. The separate production manifest uses an internal private bridge,
  no host port, and a digest-only image. I12 live dark evidence verifies the
  exact deployed API/native egress denial, private API peer and corrected
  Traefik gateway topology; public caller, firewall, DNS/certificate, route and
  full production acceptance remain `UNVERIFIED`.
- A dual-attached production Traefik peer requires Compose `2.33.1+`, exactly
  ingress `gw_priority: 1` and private `gw_priority: 0`, a non-internal ingress
  bridge, and runtime proof that the ingress attachment owns its default route.
  Ordinary `priority`, list order, tied/reversed values, or an implicit gateway
  are not acceptable substitutes. The API itself remains private-only with no
  default route.
- Docker bind evidence is effectively read-only only when the exact source and
  destination match and runtime `RW=false`; an empty inspect `Mode` is valid and
  must not be misclassified as writable. Keep API-image source identity and
  operator-pack source identity separate; never relabel an older API image with
  a newer operator commit.
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
  outcomes pass. I11 completed at protected-main SHA
  `65706e381b907c6ba09a8eba504af3adaacac86b`: Source `32668796239`, Image
  `32668796232`, Candidate Publication `32669087688`, and automatic rehearsal
  `32669484893` succeeded.
- A successful protected-main publication automatically triggers only the
  completed/main `workflow_run` rehearsal. One exact bounded publication
  artifact plus the release policy generates distinct previous/current
  digest-only identities; both images require SLSA/SPDX API+OCI verification
  before hardened I9 readiness, `STORAGE_UNSAFE`, automatic rollback, bounded
  evidence and exact cleanup. Rehearsal permissions are read-only; the exact
  I11 hosted result is the successful run above.
- Hosted S4/S5 and I9 topology/rollback evidence remains ephemeral repository
  proof. I12 separately verifies one exact dark N=1 API digest and Traefik
  topology on the authorized VPS; public caller/firewall/DNS/certificate/route,
  secret lifecycle, live rollback, and full production acceptance remain
  unverified and separately authorized.

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
