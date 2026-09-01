# 3D Printer Slicer API - Claude Operating Guide

Last synchronized: 2026-09-01

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

## J3B native-envelope and original-dimension corrective candidate

- J3 itself is owner-verified on the production-identical exact `58c0ccb`
  container, including artifact-level `--allow-rotations=0` proof. Do not
  reopen that orientation contract. J3B measurement A and exact local final-
  admission B are complete. B binds code SHA
  `47ae13397bb4537b4bb700b8c6bf3d9648364bdc` to image ID
  `sha256:1f8ec16318eeda4b8f2e24a54e98e972ef22344126b324123f23f220916617a0`;
  its revision label matched and the `999:999` container was healthy, read-only,
  with its host port bound only to localhost. The owner then passed the complete
  production-identical VPS matrix from exact tree
  `db42b93b2416ac0b791a45a0eae1233b303cf557` after independently matching all
  445 tracked files. Its separately built image ID differs, so this is exact
  source-tree and production-identical-matrix proof, not byte-identical-image
  proof.
- `model_transform` is schema 2. Success and the complete K2
  `MODEL_OUT_OF_PRINTER_BOUNDS` response require both
  `original_dimensions_available` and nullable `original_dimensions_mm`.
  `true` is equivalent to a real measured object; `false` is equivalent to
  `null`. Never substitute oriented dimensions for a missing original.
  Oriented/final dimensions remain mandatory and positive; either unavailable
  branch returns controlled HTTP 422 `MODEL_DIMENSIONS_UNAVAILABLE`.
  Canonical measured data requires `height_mm == z`: a malformed tagged
  original degrades to false/null, while malformed oriented/final data returns
  that controlled 422. `stats.object_height_mm == final_dimensions_mm.z`
  remains unconditional.
- Explicit native placement/print-volume refusal maps to HTTP 422
  `MODEL_OUT_OF_PRINTER_BOUNDS` with the full schema-2 transform, including
  orientation mode/outcome. Failed commands retain bounded stdout independently
  from stderr. Prusa exit-zero/no-artifact maps through this safety net only
  with an explicit placement diagnostic; unrelated failures remain internal.
- Catalogue schema is `r3d-profile-catalogue-v2`. Preserve physical/profile
  metadata as `declared_build_volume_dimensions_mm` and use only
  `largest_passing_dimensions_inclusive_mm` as the inclusive admission
  authority. Machine/fleet derivation is engine-scoped. Accepted P1S ceilings
  are Prusa `256 x 256 x 249.9 mm` and Orca
  `253.9 x 253.9 x 249.9 mm`; Prusa's edge beyond its declared X/Y boundary is
  `UNESTABLISHED`.
- `H2D-QUOTE` exists on both engines and is a P1S-physics estimate on a
  H2D-sized declared bed, quote-only and never production H2D G-code. The
  plugin calls only `POST /prusa/slice`. Exact helper-image measurement A passed
  44/44 fixture preconditions, 10/10 brackets, and 2/2 combined corners. Its
  measured ceilings are Prusa `350 x 320 x 324.9 mm` and Orca
  `347.9 x 317.9 x 324.9 mm`; `325 mm` at `0.3 mm` returned the full K2 HTTP 422
  twice on each engine. Prusa's native X/Y edge beyond its declared quote bed
  remains `UNESTABLISHED`. Final-admission B passed 88/88 fixture preconditions,
  20/20 brackets, and 4/4 corners with all four published tuples.
- Normal generated fixtures require outward non-zero normals plus an immediate
  native `prusa-slicer --info` precondition. Keep the deliberate zero-normal
  regression separate. The orientation HTTP matrix has 37 cases, including the
  `20 x 240 x 245` zero-request auto row, exact `18 x 130 x 240` auto replay,
  preserve+X90, and invalid `sideways`. The A/B envelope sweep requires an
  exact `/profiles` phase guard and exact response `max`/`source_profile`;
  Prusa reports its selected layer INI and Orca its stable machine profile.
  Exact-container native-info uses only a bounded fixture-addressing no-shell
  JSON argv template and the report retains only its source label. Exact local B
  catalogue validation passed 9/9 with optional Prusa digest parity run/pass;
  orientation passed 12/12 fixture checks, 4/4 selectors, and 37/37 HTTP rows.
  A legal binary zero-normal regression returned HTTP 200 on both engines in
  exact J2 and B, with B schema-2 original availability false/null.
  The owner VPS run confirmed all four exact inclusive boundaries, full K2 422
  conversion for the former native 500 cases, distinct applied/preserved/
  unchanged outcomes, unchanged Orca mass/no-yaw guards, and all three enlarged
  Prusa layer profiles. Customer exposure is zero. One branch push, one PR into
  `main`, and that PR's merge are now authorized but not yet claimed complete.
  Deploy, registry/image publication, route/DNS/allowlist, production-container,
  and consumer-repository changes remain unauthorized. See
  `docs/codex/evidence/j3b-native-envelope-and-original-dimensions.md`.

## J3 orientation-visibility local source checkpoint

- J3 starts from J2 commit `9b28b95cfa9f931092044300ebfca912421bac32`.
  Its exact code-bearing SHA is
  `c404326f535fcc70ba62aa923fa6652f4fba5019`; local source gates are green.
  The owner subsequently passed the full J3 matrix on exact tree `58c0ccb`.
  Its owner-approved request field is strict `orientationMode=auto|preserve`;
  omission defaults to `auto` for compatibility, and every other present value
  returns HTTP 400 `INVALID_ORIENTATION_MODE`.
- On the historical J3 tree, success and `MODEL_OUT_OF_PRINTER_BOUNDS` shared
  the complete first-version `model_transform`; J3B supersedes its wire schema
  with `transform_schema: 2`. The orientation contract retains orientation mode and
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
  current J3B candidate run. The full historical J3 HTTP matrix is owner-
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
  consumer reports rebuilds or migrations in advance. A caller-visible
  host-firewall timeout with an incremented deny counter and fixed private
  `r3d-perimeter-deny: ` diagnostic, router HTTP 403, and backend HTTP 401 are
  distinct layers. Every route action requires one inherited root-private FD9
  lock held across the whole rehearsal plus unchanged canonical, root-owned,
  non-writable ancestor chains and equality between the running Traefik dynamic
  bind source and the executing operator pack. HTTP redirects target external
  `:443`, never internal `:8443`; the IPv4 `DOCKER-USER` second layer is valid
  only while Traefik serves one hostname. IPv6 `[::]:443` uses docker-proxy
  without DNAT on this host and is therefore blocked in `ip6tables INPUT`, not
  `DOCKER-USER`; IPv6 port 80 remains untouched. Terminal proof uses strict
  `--assert-router-dark`; only logical fsync-cutpoint recovery is locally proved,
  while real crash/power-loss durability remains external `NOT_VERIFIED`. The
  external orchestrator must prove intended/denied callers, TLS issuance/
  renewal, and the repeated public-route activation/rollback sequence. A
  completed route rehearsal requires proven terminal dark; any
  `*_rollback_uncertain` result is `STOP/UNKNOWN`. Exact protected-main source
  `bf5e712071e3174a67fdb22ff3794003fa3ab32b` has a signed, attested candidate.
  The operator pack must be a real Git clone or linked worktree; a tarball fails
  as `operator_pack_file_invalid`. Every new release must normalize the private
  directory/file modes. Lock-bearing router helpers require host Node v20.20.2
  because the supported container path cannot preserve and prove the already-
  held host FD 9; `--render-router` requires a canonical absolute staging path.
  The owner first reported that exact digest running dark with the intentional
  mounted J2/J3/J3B configs, no API host port, final `/health` and `/ready` 200,
  and all four catalogue entries with their inclusive values alongside the declared
  values. Orca `254.0` was rejected with schema-2 bounds, and
  Orca `253.9` sliced successfully. The previous and candidate releases each
  became healthy within 15 seconds during an owner-host round trip; rollback
  assets and pricing-state stayed intact. Automatic no-deploy run `33450012850`
  remains failed closed on its fixed previous-policy `configs/` guard; the host
  round trip is accepted application-rollback evidence, not a CI pass. A later
  owner-supplied record reports exact
  `router_activation=PASS phase=leadpilot-only entries=1`, an issued
  certificate, approved-source HTTP 200, unlisted-source HTTP 403 with body
  `Forbidden` and no `Content-Type`, and redirect-follow completion on public
  443. The edge 403 is intentionally distinct from the backend 401 envelope. A
  later owner-supplied perimeter record corrects the earlier reset assumption:
  three `REJECT` variants incremented the IPv4 deny counter but produced only a
  caller timeout. The installed conntrack/original-port-443 rules remained
  idempotent at three IPv4 plus one IPv6 `INPUT` rule across three applications
  and survived a Docker-service restart. The owner then observed one normal
  reboot at `2026-09-01 13:14:41`: the perimeter service was active/enabled and
  reapplied the same 3+1 rules, both current containers were healthy at `t+5s`,
  and the API remained on candidate-image prefix `sha256:153987840361...`.
  Allowed traffic returned 200 with valid TLS in 0.13 seconds, IPv6/443 stayed
  blocked, port 80 and ACME were unaffected, and the loopback probe returned
  403. Retained `traefik-traefik-1` stayed stopped/exit 0 with
  `unless-stopped`, runtime `ports={}`, and no 80/443 listener. This closes the
  exact point-in-time perimeter-persistence exit but does not generalize to
  future reboots or crash/power-loss recovery. Exact artifacts are versioned
  under `ops/hostinger/perimeter/`; their real paths and hostname are mandatory
  operator input. Successful
  HTTP-01 alongside the redirect proves issuance compatibility, not forced
  renewal. This repository turn is documentation-only; public router rollback,
  monitoring, recovery acceptance, and customer readiness remain unverified.
  See `docs/codex/evidence/hostinger-leadpilot-route-activation.md`.
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
- Every successful Prusa and Orca response requires lowercase
  `profiles.effective_profile_sha256`. After selection, bounded canonical-realpath
  Prusa bytes and the flattened, versioned repository copy of the allowlisted
  Orca v2.3.1 `Custom` parent chain are snapshotted in job scratch for bounds,
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
- Prusa INI digest identity is case-sensitive for section/key names and exact
  duplicate qualified keys fail closed like the native Boost parser. Runtime
  generation replaces one exact top-level request key, rejects duplicates, and
  inserts a missing key before the first section.
- OpenAPI includes the four requested omissions `FILE_PROCESSING_TIMEOUT`,
  `INTERNAL_PROCESSING_ERROR`, `ORCA_PROFILE_INCOMPATIBLE`, and
  `MODEL_OUT_OF_PRINTER_BOUNDS`, plus the already-live
  `MODEL_DIMENSIONS_UNAVAILABLE` in the general 422 branch. The bounds code
  requires both `model_dimensions_mm` and `build_volume_limits_mm`. The complete
  live slice-500 enum is `SLICE_OUTPUT_UNPARSED`, `INTERNAL_PROCESSING_ERROR`,
  `QUEUE_INTERNAL_ERROR`, `UPLOAD_STORAGE_ERROR`, and `INTERNAL_SERVER_ERROR`.
- Slice traffic still accepts exactly one `x-slicer-api-key` header. Explicit
  `legacy`, finite `migration`, and final `principals` modes control the shared
  compatibility family and the separate WooCommerce/LeadPilot families.
  `GET /health` and `GET /pricing` remain authentication-free. Before any router
  action, the dark gate must prove principal-only readback, one private positive
  slice per principal, retired-shared and `x-api-key` negative cases, and exact
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

## Historical I12 Hostinger production-qualification boundary

- Checkpoint status was `I12_API_F710_DARK_N1_VERIFIED;
  OPERATOR_MAIN_7C8AEE_RESIDUAL_RECONCILIATION_COMPLETE;
  CORRECTED_TRAEFIK_DARK_CUTOVER_VERIFIED; PUBLIC_ROUTE_DISABLED`.
- At that checkpoint the deployed API image source was protected-main
  `f71069cb3ba5ddeb97e69ca1414a00a72a20ce28`; its exact signed image digest is
  `sha256:d50c72bd084e14645f2c9c7b18a087317bf080a2d76cf1bc876d5e3427ae1e26`.
  It was healthy and dark at retained concurrency one, without a host API
  port or API default route.
- Corrective operator main
  `7c8aee0728fc8462c67b4c6d85636bffb7afcdf8` passed Source `32804297840` and
  Image `32804297658` after protected PR `#5`. Its operator commits are separate
  from the API-image source and did not rebuild, relabel, or republish that image.
- The corrected socketless Traefik was healthy with exact ingress/private
  `gw_priority: 1/0`, ingress-owned default routing, effective read-only config,
  file provider only, and no Docker socket/provider. Docker owns exact IPv4 and
  IPv6 host listeners for ports 80/443 while the container networks remain
  IPv6-disabled; these are separate properties.
- Failed-cutover resources were reconciled by exact identity into the resumed
  successful state. The old proxy is intentionally retained stopped for
  rollback, task-owned remote temp residue is absent, and ACME bytes are unchanged.
- At that checkpoint no public slicer router was active. Hostname/DNS, approved caller/CIDR,
  firewall acceptance, certificate issuance/continuity, route activation,
  monitoring/recovery acceptance, customer traffic, and public production
  completeness were unverified and separately authorized.

## Candidate image publication boundary

- Normal Image Validation remains read-only, builds once, and never pushes,
  attests, or deploys.
- I10 is live-verified at protected-main SHA
  `8253160eef1c3e00c1e40826ec61fd97563ddd9b`: Source `32662043454` and Image
  `32662043476` succeeded, and strict main policy requires both no-deploy GitHub
  Actions contexts. Main requires a PR, includes administrators, forbids
  force-push/deletion, requires conversation resolution, and enables merge
  commits only. Zero approvals reflect the sole-collaborator self-review limit,
  not human approval; required signatures are not enabled.
- I11 Candidate Publication is manual `workflow_dispatch` only from exact
  current protected `main`. Repository `Botond1/3D-Printer-Slicer-API`, actor
  `Botond1`, `refs/heads/main`, requested/event/checked-out/remote SHA,
  post-I10 ancestry, and registry
  `ghcr.io/botond1/3d-printer-slicer-api` must all match.
- `publish_new` requires an empty existing-digest input, exact confirmation
  `PUBLISH_SIGNED_MAIN_CANDIDATE`, and a proven-absent SHA-derived discovery
  tag before pushing the once-built fully gated image.
- `recover_exact_digest` requires exact confirmation
  `RECOVER_SIGNED_MAIN_CANDIDATE` and a lowercase `sha256:<64 hex>` already
  bound to the SHA-derived tag and the once-built image config. Recovery never
  pushes, overwrites, or deletes registry content.
- Only its publication job may use `packages: write`, `attestations: write`,
  and `id-token: write`. Login and push occur only after the complete shared
  exact-image gate passes on the same once-built `linux/amd64` image.
- The publication job binds GitHub environment `candidate-publication` with
  `deployment: false`. Environment ID `20443404498` is
  `LIVE_CONFIG_VERIFIED` on 2026-08-23: protected branches true, custom branch
  policies false, exactly one `branch_policy` protection rule (ID `63481958`),
  and no reviewer/wait-timer rules, secrets, variables or deployments. No
  reviewer is possible while `Botond1` is the sole collaborator.
- Never overwrite/delete a discovery tag or create `latest`, release, staging,
  or production tags. Downstream consumption is exact-digest only:
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:<64 lowercase hex>`.
- Successful protected-main publication automatically triggers the no-deploy
  rehearsal through `workflow_run`. It re-proves the exact upstream run and
  single bounded artifact, dynamically binds the policy-pinned previous and
  artifact-derived current digests, verifies both images' SLSA/SPDX
  attestations through API and OCI, then runs hardened I9 readiness,
  `STORAGE_UNSAFE`, automatic rollback, bounded evidence and exact cleanup.
  The rehearsal has read permissions only and cannot write GHCR or deploy.
- Publication is not deployment. Preserve and classify partial candidates;
  exact recovery may continue only a matching digest without remote mutation.
  I11 is complete at protected-main SHA
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
- GET /profiles
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
- Pricing, artifact, and operations active keys are mandatory. Slice startup
  additionally requires one complete `SLICE_SERVICE_AUTH_MODE`: default
  `legacy` requires shared active and forbids principal material/expiry;
  `migration` requires shared active, both principal actives, and a future
  `SLICE_SERVICE_LEGACY_MIGRATION_UNTIL` no more than 90 days away; `principals`
  requires both principal actives and forbids shared active/previous and expiry.
  A previous slot is optional only with its own active. Every configured value,
  including a valid `ADMIN_API_KEY`, must be globally unique, non-placeholder,
  and 32-256 printable-ASCII bytes; only the admin key's exact authorized legacy
  substitution self-reference is skipped.
- Slice requests must pass exactly one x-slicer-api-key matching an eligible
  configured slice slot; x-api-key is not an alias. In migration, shared slots
  stop authorizing at the exact request-time expiry while principals continue.
  Missing or wrong credentials return HTTP 401 with
  `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
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
  operation is scoped and fail closed; slice/broad/expired migration or any
  other cross-slot reuse is refused.
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
- Max concurrent slice jobs: default 1; explicit values must be exact canonical
  decimal 1..3. N=2/N=3 remain unqualified and undeployed.
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
- python tests/testing-scripts/slicing/orientation_visibility_test_runner.py
- python tests/testing-scripts/slicing/native_envelope_sweep_runner.py
- python tests/testing-scripts/pricing/pricing_cycle_test_runner.py
- python tests/testing-scripts/admin/admin_output_files_test_runner.py
- python tests/testing-scripts/rate_limit/rate_limit_regression_test_runner.py
- python tests/testing-scripts/operations/operations_readiness_metrics_test_runner.py
- python tests/testing-scripts/profiles/profile_catalogue_test_runner.py
- python tests/testing-scripts/queue/queue_concurrency_test_runner.py --count N --expected-max-concurrent N --retry-on-429 1 --cleanup-manifest NEW_MANIFEST_PATH --report NEW_REPORT_PATH

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
