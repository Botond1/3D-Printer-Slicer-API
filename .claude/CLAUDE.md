# 3D Printer Slicer API - Claude Instructions

Last synchronized: 2026-09-01

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

## J3B native-envelope and original-dimension corrective candidate

- J3 passed the owner's production-identical matrix on exact tree `58c0ccb`,
  including artifact-level `--allow-rotations=0` proof. J3B does not reopen
  that orientation contract. Measurement A and exact local final-admission B
  are complete. B binds source `47ae13397bb4537b4bb700b8c6bf3d9648364bdc`
  to image ID
  `sha256:1f8ec16318eeda4b8f2e24a54e98e972ef22344126b324123f23f220916617a0`;
  its revision label matched and the `999:999` container was healthy, read-only,
  with its host port bound only to localhost. The owner then passed the complete
  production-identical VPS matrix from exact tree
  `db42b93b2416ac0b791a45a0eae1233b303cf557` after independently matching all
  445 tracked files. Its separately built image ID differs, so this is exact
  source-tree and production-identical-matrix proof, not byte-identical-image
  proof.
- `model_transform` uses `transform_schema: 2`. Success and the full K2 bounds
  response always contain `original_dimensions_available` and nullable
  `original_dimensions_mm`: true iff a real measurement object exists, false
  iff null, with no oriented fallback. Unavailable/non-positive oriented or
  final dimensions return HTTP 422 `MODEL_DIMENSIONS_UNAVAILABLE`; success
  always requires object height equal to final Z. Canonical measured data also
  requires `height_mm == z`: malformed tagged original data degrades to
  false/null, while malformed oriented/final data returns that controlled 422.
- Explicit native placement/print-volume refusal maps to HTTP 422
  `MODEL_OUT_OF_PRINTER_BOUNDS` with the complete schema-2 transform and its
  orientation mode/outcome. Failed commands preserve bounded stdout separately
  from stderr. Prusa exit-zero/no-artifact maps through this safety net only
  with an explicit placement diagnostic; other failures remain internal.
- Catalogue schema is `r3d-profile-catalogue-v2`. Keep
  `declared_build_volume_dimensions_mm` as profile metadata and
  `largest_passing_dimensions_inclusive_mm` as the exact-boundary-inclusive
  admission authority. Derive machine/fleet envelopes per engine. Accepted P1S
  ceilings are Prusa `256 x 256 x 249.9 mm` and Orca
  `253.9 x 253.9 x 249.9 mm`; Prusa beyond its declared X/Y edge is
  `UNESTABLISHED`.
- Both engines expose `H2D-QUOTE`: a quote-only P1S-physics profile on a
  H2D-sized declared bed, never hardware-faithful H2D estimation or production
  H2D G-code. The plugin calls only `POST /prusa/slice`. Exact helper-image
  measurement A passed 44/44 fixture preconditions, 10/10 brackets, and 2/2
  combined corners. Its measured ceilings are Prusa `350 x 320 x 324.9 mm` and
  Orca `347.9 x 317.9 x 324.9 mm`; `325 mm` at `0.3 mm` returned the full K2
  HTTP 422 twice on each engine. Prusa's native X/Y edge beyond its declared
  quote bed remains `UNESTABLISHED`. Final-admission B passed 88/88 fixture
  preconditions, 20/20 brackets, and 4/4 corners with all four published tuples.
- Normal generated fixtures require outward non-zero normals and an immediate
  native `prusa-slicer --info` precondition; the deliberate zero-normal row is
  separate. The orientation HTTP matrix has 37 cases, including `20 x 240 x
  245` zero-request auto, exact `18 x 130 x 240` auto replay, preserve+X90, and
  invalid `sideways`. The A/B envelope sweep requires an exact `/profiles`
  phase guard and exact response `max`/`source_profile`; Prusa reports its
  selected layer INI and Orca its stable machine profile. Exact-container
  native-info uses only a bounded fixture-addressing no-shell JSON argv template
  and the report retains only its source label. Exact local B catalogue checks
  passed 9/9 with optional Prusa digest parity run/pass; orientation passed
  12/12 fixture checks, 4/4 selectors, and 37/37 HTTP rows. A legal binary zero-
  normal regression returned HTTP 200 on both engines in exact J2 and B, with B
  schema-2 original availability false/null. The owner VPS run confirmed all
  four exact inclusive boundaries, full K2 422 conversion for the former native
  500 cases, distinct applied/preserved/unchanged outcomes, unchanged Orca
  mass/no-yaw guards, and all three enlarged Prusa layer profiles. Customer
  exposure is zero. One branch push, one PR into `main`, and that PR's merge are
  now authorized but not yet claimed complete. Deploy, registry/image
  publication, route/DNS/allowlist, production-container, and consumer-
  repository changes remain unauthorized.
  See `docs/codex/evidence/j3b-native-envelope-and-original-dimensions.md`.

## J3 orientation-visibility local source checkpoint

- J3 starts from J2 commit `9b28b95cfa9f931092044300ebfca912421bac32`.
  Its exact code-bearing SHA is
  `c404326f535fcc70ba62aa923fa6652f4fba5019`; local source gates are green and
  the later exact-tree `58c0ccb` owner container/VPS matrix passed.
  Its owner-approved request field is strict `orientationMode=auto|preserve`;
  omission defaults to `auto` for compatibility, and every other present value
  returns HTTP 400 `INVALID_ORIENTATION_MODE`.
- On the historical J3 tree, success and `MODEL_OUT_OF_PRINTER_BOUNDS` shared
  the first transform schema; J3B supersedes it with `transform_schema: 2`.
  The orientation contract retains orientation mode and
  outcome, requested/automatic/total rotations, and original/oriented/final
  dimensions. The authoritative rotation is rotation-only and composes as
  `R_total = R_requested * R_automatic`; it does not encode centering,
  grounding, scaling, or translation. `original_dimensions_mm` is measured
  after safe source conversion and before service orientation,
  `oriented_dimensions_mm` after orientation, and `final_dimensions_mm` after
  request sizing/rotation. `stats.object_height_mm` must equal
  `model_transform.final_dimensions_mm.z`.
- `orientation_outcome` is one of `applied`, `unchanged`, `preserved`, or
  `fallback_unmodified`. Bounds wording must branch on the outcome: only
  `applied` may say the model does not fit even after automatic rotation;
  `unchanged` says automatic evaluation kept the pose, `preserved` refers to
  the submitted pose, and `fallback_unmodified` must disclose that automatic
  orientation was unavailable.
- An outer ZIP admits exactly one supported source file. If that file is a 3MF
  scene, its internal geometries are concatenated into one compound STL before
  native slicing. The API passes one STL argv and requests no split-to-objects
  operation, so disconnected shells retain their relative placement rather
  than becoming independently packable objects. Orca keeps `--arrange 1` for
  placement and
  `--orient 0`, while exactly one single-token `--allow-rotations=0` disables
  only whole-compound arrange yaw. Prusa receives the already transformed
  geometry and adds no native rotation.
- The exact Orca 2.3.1 AppImage flag shape is `OWNER_VERIFIED_INPUT`:
  `--allow-rotations=0` produced real G-code with 6.25 g, while the split
  `--allow-rotations 0` form failed with `No such file: 0`. This is not a
  current J3B candidate run. The historical J3 full HTTP matrix is owner-
  verified; the later J3B owner production-identical VPS matrix also passed on
  exact tree `db42b93`. Neither result authorizes deploy, registry write, route
  activation, or consumer-repository change. See
  `docs/codex/evidence/j3-orientation-visibility.md`.

## J2 bounds/network baseline and J3B catalogue successor

- J2 starts from protected main
  `0dedbe1e9e4c32a0373982a45bf788cdcdb4f024`. It established the
  physical/profile-declared P1S `256 x 256 x 250 mm` and H2D-sized
  `350 x 320 x 325 mm` metadata, the unchanged `1 mm` compatibility minima,
  and `MAX_MODEL_DIMENSION_MM >= 350`. J3B separates those declared values from
  the measured, inclusive admission ceiling.
- Public `GET /profiles` remains startup-built, immutable, informational, and
  independent of slicing availability. Its current
  `r3d-profile-catalogue-v2` payload contains 18 machine-bound server-owned FDM
  rows, preserves the strong `ETag`, body `catalogue_sha256`, 304 behavior, and
  typed non-critical 503 `PROFILE_CATALOGUE_UNAVAILABLE`, and never advertises
  the generic `120 x 120 x 150 mm` SLA fallback as a machine.
- Every entry exposes `declared_build_volume_dimensions_mm`,
  `declared_source_kind: profile-explicit`,
  `minimum_dimensions_inclusive_mm`, and the exact-boundary-inclusive admission
  authority `largest_passing_dimensions_inclusive_mm`. Preserve the bounded
  generic engine/selector/component shape and
  `effective_profile_identity_schema: r3d-effective-slice-profile-v2`.
  Machine and fleet resolutions are derived per technology and engine; never
  merge Prusa and Orca values, synthesize a component-wise ceiling, or add a
  manual `fleet_max`.
- The owner-confirmed future SLA printer is the Elegoo Saturn 4 Ultra, but the
  current Prusa `--export-sla` and SL1 metadata parser are incompatible with
  its `.goo`/`.ctb` artifacts and credible MSLA timing. Do not guess its build
  envelope. SLA remediation is a separate future wave using owner-supplied
  Chitubox/Elegoo Satellite profiles. A later truthful SLA row can use catalogue
  v2 without another schema-version change; no SLA row exists today.
- P1S largest-passing admission is owner-accepted as Prusa
  `256 x 256 x 249.9 mm` and Orca `253.9 x 253.9 x 249.9 mm`. Prusa's native
  X/Y edge beyond its declared physical profile remains `UNESTABLISHED`.
  H2D-QUOTE exists on both engines with P1S physics and an enlarged declared
  bed, quoting only. Measurement A established and exact local final-admission B
  confirmed Prusa `350 x 320 x 324.9 mm` and Orca
  `347.9 x 317.9 x 324.9 mm`.
- The Hostinger route preparation accepts exactly one canonical private IPv4
  `/32` row in the sole `leadpilot-only` phase. A second row, broader prefix,
  `ipStrategy`, or forwarded-header identity fails closed. The allowance is
  machine-level: every process on the shared caller host inherits it, and an
  unreserved-address reassignment silently admits the next holder unless the
  consumer reports rebuilds or migrations in advance. A host-firewall TCP reset and fixed
  private `J2_ALLOWLIST_DENY` event, or router HTTP 403, remain distinct from
  backend HTTP 401. Every route action requires one inherited root-private FD9
  lock held across the whole rehearsal plus unchanged canonical, root-owned,
  non-writable ancestor chains and equality between the running Traefik dynamic
  bind source and the executing operator pack. HTTP redirects target external
  `:443`, never internal `:8443`; the `DOCKER-USER` second layer is valid only
  while Traefik serves one hostname. Terminal proof uses strict
  `--assert-router-dark`; only logical fsync-cutpoint recovery is locally proved,
  while real crash/power-loss durability remains external `NOT_VERIFIED`. The
  external orchestrator must prove intended/denied callers, TLS issuance/
  renewal, and the repeated activation/rollback sequence. A completed rehearsal requires proven terminal dark; any
  `*_rollback_uncertain` result is `STOP/UNKNOWN`. Live rehearsal is
  `BLOCKED / NOT RUN`. Exact protected-main source
  `bf5e712071e3174a67fdb22ff3794003fa3ab32b` has a signed, attested candidate,
  but it is not deployed and its automatic no-deploy rehearsal stopped on the
  fixed previous-policy `configs/` compatibility check. Private live evidence
  is also absent. J2 performs no route
  mutation; the latest prior I12 dark state was
  not re-verified. Never infer permanent activation from repository gates.
- Calibration now has nine numeric Bambu reference cases and the `M03`
  P1S-overheight rejection. Measurement fixes Orca `--orient 0`, disables
  support in the measurement-only runtime profile, and reuses the production
  machine/process `--load-settings` plus separate `--load-filaments` policy.
  Orca measurement and
  automatic-pricing acceptance remain blocked on complete approved vendor
  profiles and an available local Docker daemon.

## J1 calibration harvest over the J0 W2/W3 public contract

- J1C's guard-only diagnostic image has owner-supplied VPS proof: recognized
  `0.00 g` with positive length returns HTTP 200 and null mass/rate/price, while
  selected-profile zero and marker drift remain fail closed. The combined
  parser/Orca command/profile focused set passes 69/69; the exact final image
  containing all corrections still awaits the owner's rerun.
- Production Orca sends machine plus process through `--load-settings` and an
  optional selected filament snapshot through dedicated `--load-filaments`.
  Both repository-owned P1S/H2D children own exact
  `layer_change_gcode='G92 E0'`; pinned upstream parents remain unchanged.
  Owner-supplied mechanism evidence produced 4.12 g instead of 0.00 g. The
  incomplete vendor chain remains a separate W8 calibration lane, not a J1C
  blocker; J2 separately owns bed shape/Z. Capability readiness remains
  proposal-only on public `/ready`, while `/health` stays cheap liveness; see
  `docs/codex/evidence/j1c-slice-contract-corrective.md`.
- Successful Prusa and Orca payloads require lowercase
  `profiles.effective_profile_sha256`. After selection, bounded canonical-realpath
  Prusa bytes and the flattened, versioned repository copy of the allowlisted
  Orca v2.3.1 `Custom` parent chain provide one job-scratch lineage for bounds,
  runtime, digest, and native use. Its exact-image build equality gate passes;
  public fields retain child basenames. Stable Orca runtime settings enforce
  empty `layer_gcode` plus relative extrusion, aligned with each selected
  repository child machine's exact `layer_change_gcode='G92 E0'` override.
- J1 selects repository PLA/PETG filament profiles, snapshots their exact bytes,
  loads machine/process through `--load-settings`, and loads selected filament
  separately through `--load-filaments`. The effective digest
  binds normalized material and selected filament JSON or explicit null.
  Successful Orca payloads expose nullable filament basename plus actual
  diameter/density. OpenAPI requires nullable `stats.material_used_g`; it may
  contain only a direct G-code mass marker and is never derived from filament
  length. Strict FDM output requires positive time and length. On the optional-
  mass Prusa path, a missing or recognized non-positive direct grams marker
  returns `material_used_g:null`, `hourly_rate:null`, and
  `stats.estimated_price_huf:null`; zero is never published. Orca with a selected filament profile also
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
  The retained P1S and H2D candidates are generic Marlin profiles. Nine numeric
  Bambu references plus the `M03` P1S-boundary result are recorded, but W8 Orca
  calibration remains `BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER`; no automatic-
  pricing acceptance is inferred.

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
- GET /profiles
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
- MAX_MODEL_DIMENSION_MM
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
- tests/testing-scripts/slicing/orientation_visibility_test_runner.py
- tests/testing-scripts/slicing/native_envelope_sweep_runner.py
- tests/testing-scripts/admin/admin_output_files_test_runner.py
- tests/testing-scripts/rate_limit/rate_limit_regression_test_runner.py
- tests/testing-scripts/operations/operations_readiness_metrics_test_runner.py
- tests/testing-scripts/profiles/profile_catalogue_test_runner.py
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
