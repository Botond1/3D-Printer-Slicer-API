---
applyTo: "**"
---

# Repository Wide Instructions

Last synchronized: 2026-09-01

## Architecture
- Backend stack is Node.js + Express + Python helper scripts.
- Slicing engines: PrusaSlicer (FDM/SLA) and OrcaSlicer (FDM only).
- Service-authenticated slicing endpoints: /prusa/slice and /orca/slice.
- Public informational startup catalogue: GET /profiles.

## Hard Constraints
- Runtime directories must remain root-scoped: input/, output/, configs/.
- Do not introduce app/input, app/output, or app/configs.
- Fail-fast model policy: reject invalid source geometry with INVALID_SOURCE_GEOMETRY.
- Keep queueing and rate-limiting active for CPU-heavy slicing work.
- Keep Orca output mapping deterministic via per-request isolated output directory handling.
- Preserve slice route order: limiter -> x-slicer-api-key authentication -> root-scoped workspace/Multer -> queue -> native processing.
- Preserve the physical/profile-declared P1S `256 x 256 x 250 mm` and enlarged
  quote-bed `350 x 320 x 325 mm` dimensions separately from native admission.
  Runtime bounds and the public catalogue consume the largest value proved to
  pass, inclusively: P1S Prusa `256 x 256 x 249.9 mm` and Orca
  `253.9 x 253.9 x 249.9 mm`. Prusa's native X/Y edge beyond the declared
  profile remains `UNESTABLISHED`. Exact helper-image measurement A established
  H2D-QUOTE Prusa `350 x 320 x 324.9 mm` and Orca
  `347.9 x 317.9 x 324.9 mm`; Prusa native X/Y beyond that declared quote bed
  remains `UNESTABLISHED`. Exact local final-admission B confirmed all four
  published tuples with 88/88 fixture preconditions, 20/20 brackets, and 4/4
  combined corners. The FDM fallback and configured
  `MAX_MODEL_DIMENSION_MM >= 350` remain compatibility constraints; the
  existing `1 mm` profile minima remain unchanged.
- Preserve strict `orientationMode=auto|preserve`, with only omission defaulting
  to `auto`. Success and the full K2 `MODEL_OUT_OF_PRINTER_BOUNDS` HTTP 422
  response require the same complete `transform_schema: 2` payload.
  `original_dimensions_available` is mandatory: `true` iff
  `original_dimensions_mm` is an object from a real measurement and `false`
  iff it is null; never substitute oriented dimensions. Oriented and final
  dimensions are load-bearing and must be positive, otherwise return controlled
  HTTP 422 `MODEL_DIMENSIONS_UNAVAILABLE`. The authoritative rotation-only
  matrix is `R_requested * R_automatic`; successful object height always equals
  final Z. Canonical measured data also requires `height_mm == z`: malformed
  tagged original data degrades to false/null, while malformed oriented/final
  data returns the controlled 422.
- Preserve bounded native stdout independently from stderr on command failure.
  Full K2 native mapping still requires an explicit placement/print-volume
  diagnostic from either stream. A Prusa exit-zero/no-artifact result is only a
  placement safety-net rejection when that explicit diagnostic is present.
- Preserve exactly one supported source per outer ZIP. Multi-object 3MF scenes
  are concatenated into one compound STL, passed as one STL argument, and not
  sent through split-to-objects. Orca may keep `--arrange 1` for placement but
  must use `--orient 0` plus exactly one single-token
  `--allow-rotations=0` to prevent unreported native rotation.

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
- Before initial activation or any later router mutation, require the
  principal-only dark gate: sanitized
  `principals` readback with both actives and no shared/expiry material, one
  private positive slice per principal, retired-shared and `x-api-key` negative
  cases, and exact cleanup. Missing or inconclusive evidence forbids the router
  mutation. The current owner-supplied post-activation record is
  `router_activation=PASS phase=leadpilot-only entries=1`, certificate issued,
  allowed-source HTTP 200, external unlisted-source HTTP 403 without a
  `Content-Type`, and redirect-follow completion on public 443. This
  documentation-only repository change does not independently repeat or mutate
  that live state; firewall TCP-reset/counter proof, public router rollback,
  forced renewal, monitoring, and customer readiness remain separate.
- Keep `/profiles` unauthenticated, startup-built, immutable, informational,
  and independent of slicing availability. Preserve the strong ETag,
  conditional 304, body `catalogue_sha256`, typed non-critical 503, and the
  exact 18-row machine-bound FDM-only `r3d-profile-catalogue-v2` set. Every row
  must expose physical/profile-declared
  `declared_build_volume_dimensions_mm` separately from the authoritative,
  exact-boundary-inclusive `largest_passing_dimensions_inclusive_mm`. The
  latter is the admission authority consumed by both the API and clients.
  Preserve `declared_source_kind: profile-explicit` and
  `minimum_dimensions_inclusive_mm`; the minimum remains a compatibility floor,
  not machine metadata. Keep every per-printer/per-engine preset row and fail on
  drift within one technology/printer/engine. Resolve machine and fleet
  envelopes per technology and engine; never merge Prusa and Orca ceilings,
  silently minimize them, or add a manual `fleet_max`. Never publish the
  generic `120 x 120 x 150 mm` SLA fallback as a machine envelope.
- The future SLA printer is the owner-confirmed Elegoo Saturn 4 Ultra, but its
  dimensions must not be guessed. Current Prusa `--export-sla`/SL1 handling is
  incompatible with Elegoo `.goo`/`.ctb` artifacts and credible MSLA timing.
  Remediate in a separate wave from owner Chitubox/Elegoo Satellite profiles.
  Preserve bounded generic `engine`, generic endpoint plus ordered
  `slice_selector.parameters[{name,value}]`, ordered path-free
  `profile_components[{role,basename,selector_parameter}]`, exact nullable
  component-to-selector bindings, the exact
  `r3d-effective-slice-profile-v2` identity marker. A later truthful SLA row
  and its independent per-engine SLA fleet resolution can use catalogue v2
  without another schema-version change.
- Keep H2D-QUOTE on both engines as a P1S-derived, enlarged-bed quoting chain.
  It is quoting-only, not machine-accurate and never proof of production H2D
  G-code. The plugin consumer calls only `POST /prusa/slice`, so Prusa coverage
  is required. Measurement A passed 44/44 fixture preconditions, 10/10 brackets,
  and 2/2 combined corners. At `0.3 mm`, `325 mm` returned the full K2 HTTP 422
  twice on each engine after the exact conjunctive last-layer classifier. Exact
  local final-admission B passed 88/88 fixture preconditions, 20/20 brackets,
  4/4 combined corners, the 9/9 catalogue lane, and the optional Prusa digest-
  parity lane. The owner production-identical VPS matrix from exact tree
  `db42b93` later confirmed all four inclusive boundaries, full K2 422 mapping,
  zero-normal false/null degradation, and the Orca mass/no-yaw guards. The
  separate owner image ID is not byte-identical-image evidence. J2+J3+J3B is
  merged at protected main `bf5e712`; the later owner-reported dark API deploy
  and subsequent live route record are recorded below. Consumer-repository
  mutation remains outside this repository's authority.
- Hostinger routing accepts exactly one canonical private IPv4
  `/32` entry in the sole `leadpilot-only` phase. A second entry, broader
  prefix, forwarded identity, or `ipStrategy` fails closed. This is
  machine-level trust, and unreserved-address reassignment is a silent perimeter
  failure unless the consumer reports rebuilds or migrations in advance.
  Host-firewall TCP rejection and
  fixed private `J2_ALLOWLIST_DENY`, or router HTTP 403, must remain distinct
  from backend HTTP 401. The external orchestrator owns allowed/denied, TLS
  issuance/renewal, rollback, and final-dark proof. One inherited root-private
  FD9 lock must span the complete rehearsal; each action re-proves canonical,
  root-owned, non-writable ancestors plus exact running dynamic-bind/operator-
  pack equality, and terminal proof uses strict
  `--assert-router-dark`. Local evidence covers logical fsync cutpoints, not
  real crash/power-loss durability. Redirects target external `:443`, never
  internal `:8443`; a `DOCKER-USER` 443 rule is valid only for one hosted name.
  Any `*_rollback_uncertain` result is `STOP/UNKNOWN`, not dark evidence. The
  operator pack must be a Git clone or linked worktree; a tarball surfaces
  `operator_pack_file_invalid`. Normalize root-private modes after every new
  release, keep lock-bearing router helpers on host Node v20.20.2, and pass a
  canonical absolute staging target to `--render-router`. Exact
  protected-main source `bf5e712071e3174a67fdb22ff3794003fa3ab32b` has a
  signed, attested immutable candidate. The owner first reported that exact
  digest running dark from a later operator release tree with intentional mounted
  configs, no API host port, final `/health` and `/ready` 200, and a completed
  previous/candidate health round trip within 15 seconds per direction. The
  recovery set and pricing-state snapshot remain intact. Automatic run
  `33450012850` stays failed closed on configs compatibility; the operator-host
  round trip is separate application-rollback evidence, not a CI pass. A later
  owner-supplied record reports
  `router_activation=PASS phase=leadpilot-only entries=1`, issued TLS,
  approved-source HTTP 200, unlisted-source plain HTTP 403, and redirect-follow
  completion on public 443. That 403 is not host-firewall TCP-reset/counter
  proof, and successful HTTP-01 issuance is not the forced-renewal rehearsal.
  This documentation-only repository turn performs no route mutation or host
  action. Public router rollback, monitoring, recovery acceptance, and customer
  readiness remain separate.
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
- OpenAPI includes the four requested omitted runtime codes plus the controlled
  `MODEL_DIMENSIONS_UNAVAILABLE` general-422 correction. Keep the bounds branch
  disjoint and require both dimension payloads plus the complete schema-v2 K2
  `model_transform`, including orientation and original-availability fields.
  Keep the complete live
  slice-500 enum: `INTERNAL_PROCESSING_ERROR`, `QUEUE_INTERNAL_ERROR`,
  `UPLOAD_STORAGE_ERROR`, and `INTERNAL_SERVER_ERROR`.
- Resolve both selected engines' versions atomically from bounded `--help`
  output before listen; publish neither unless both pass. The startup module has
  exact-image proof. Keep Orca invocation at `--arrange 1`, `--orient 0`, and
  one `--allow-rotations=0` after preprocessing/bounds checks: arrangement
  translates the already-rotated compound model onto the build plate, while
  auto-orient and arrange yaw stay disabled and cannot replace or extend the
  reported rotation. Focused command/digest contracts and final exact-image
  HTTP transform/final-dimensions E2E pass for both principals; the exact local
  code/image identity is recorded in the J0 evidence document.
- Bambu reference numbers are available for nine measurable cases plus one
  P1S-overheight boundary. Tight Orca time/mass qualification remains blocked
  on the complete owner-approved vendor profile chain and runnable Docker; do
  not infer calibration from the effective-profile digest or physical envelope.
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
  proof. Historical I12 evidence separately verifies one exact dark N=1 API
  digest and Traefik topology on the authorized VPS. A later owner-supplied
  record adds the LeadPilot-only route, certificate issuance, approved-source
  HTTP 200, unlisted-source HTTP 403, and redirect-follow completion on public
  443. Exact firewall identity/counters, forced renewal, public router rollback,
  secret lifecycle, monitoring/recovery, customer readiness, and full production
  acceptance remain unverified and separately authorized.

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
