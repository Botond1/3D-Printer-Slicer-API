# Codex operating guide

## Mission and scope

Maintain this standalone 3D Printer Slicer API as a security-sensitive Node.js,
Python, native-slicer, and container system. Work only in this repository. The
production target is a private Hostinger sidecar, never a public slicing
service; LeadPilot changes are always outside this repository's authority.

This is a thin Codex-specific routing layer. It is independent of the manually
mirrored Claude/Copilot corpus in `CLAUDE.md`, `.claude/**`, and `.github/**`.
Link to that corpus for domain detail; do not create or maintain a third mirror.

Canonical Codex knowledge:

- `docs/codex/project-map.md` - verified topology, behavior, and drift.
- `docs/codex/security-model.md` - threats, controls, and accepted risks.
- `docs/codex/hardening-plan.md` - staged work, dependencies, and exit criteria.

## Current J3B native-envelope and original-dimension corrective candidate

J3's production-identical owner matrix passed on exact tree `58c0ccb`, including
artifact-level proof of the Orca `--allow-rotations=0` path. J3B does not reopen
that orientation contract. H2D-QUOTE measurement A and exact local final-
admission B are complete. B binds code-bearing SHA
`47ae13397bb4537b4bb700b8c6bf3d9648364bdc` to exact image ID
`sha256:1f8ec16318eeda4b8f2e24a54e98e972ef22344126b324123f23f220916617a0`;
the revision label matched, and the `999:999` container was healthy, read-only,
with its host port bound only to localhost. The owner then ran the complete
production-identical VPS matrix from exact tree
`db42b93b2416ac0b791a45a0eae1233b303cf557` and independently matched all 445
tracked files. The owner image identifier differs from local B, so this proves
source-tree identity and the production-identical matrix, not byte-identical
image identity.

Success and full K2 HTTP 422 `MODEL_OUT_OF_PRINTER_BOUNDS` use
`transform_schema: 2`. Both always include mandatory
`original_dimensions_available` and nullable `original_dimensions_mm`: true iff
the object came from a real measurement and false iff null, with no oriented
fallback. Oriented/final dimensions are load-bearing and must be positive;
otherwise return controlled HTTP 422 `MODEL_DIMENSIONS_UNAVAILABLE`. Successful
object height always equals final Z. A canonical measured value also requires
`height_mm == z`: a malformed tagged original degrades to the explicit
false/null state, while the same defect in oriented/final data returns the
controlled 422. Explicit native placement/print-volume refusal maps only to the
full K2 bounds response; failed native commands preserve bounded stdout
separately from stderr so either stream can supply the diagnostic. Prusa's
exit-zero/no-artifact case is only this bounds safety net when the output is an
explicit placement refusal; unrelated native or missing-artifact failures
remain internal.

The public catalogue is `r3d-profile-catalogue-v2`. It preserves physical/
profile-declared `declared_build_volume_dimensions_mm` separately from the
exact-boundary-inclusive admission authority
`largest_passing_dimensions_inclusive_mm`; machine and fleet resolutions are
engine-scoped. Owner-accepted P1S ceilings are Prusa
`256 x 256 x 249.9 mm` and Orca `253.9 x 253.9 x 249.9 mm`. Prusa's native X/Y
edge beyond its declared profile remains `UNESTABLISHED`.

H2D-QUOTE is a P1S-derived enlarged-bed quoting chain on both engines, not a
machine-accurate H2D profile and not production H2D G-code. The plugin consumer
uses only `POST /prusa/slice`, so Prusa coverage is mandatory. Exact helper-
image measurement A passed 44/44 fixture preconditions, 10/10 brackets, and
2/2 combined corners. It measured Prusa `350 x 320 x 324.9 mm` and Orca
`347.9 x 317.9 x 324.9 mm`; Prusa's native X/Y edge beyond its declared profile
remains `UNESTABLISHED`. At layer height `0.3 mm`, `325 mm` returned the full K2
HTTP 422 twice on each engine after the exact conjunctive last-layer classifier.
Final-admission B then passed 88/88 fixture preconditions, 20/20 brackets, and
4/4 corners with the same four published P1S/H2D tuples. Catalogue validation
passed 9/9 with optional Prusa digest parity run and passed. Normal sweep
fixtures require outward non-zero facet normals and an immediate native
`prusa-slicer --info` precondition. The separate legal binary zero-normal
regression returned HTTP 200 on Prusa and Orca in exact J2 and B; B reported
schema-2 original availability false/null. The orientation matrix passed 12/12
fixture checks, 4/4 selectors, and all 37 HTTP cases, retaining `20 x 240 x 245 mm` auto
with zero request transform, `18 x 130 x 240 mm` exact auto replay, preserve
plus X90, and invalid `sideways`. The A/B envelope sweep refuses to start until
`GET /profiles` exactly identifies the requested measurement/final-admission
phase; every HTTP result must echo the exact expected limit maximum and source
profile (selected Prusa layer INI or stable Orca machine profile). Native-info
exact-container overrides are bounded fixture-addressing JSON argv templates,
run without a shell or service credentials, and reports retain only a source
label.

The owner VPS matrix confirmed every published inclusive P1S/H2D-QUOTE
boundary on all four selectors, full K2 HTTP 422 conversion for the former
native 500 cases, zero-normal false/null degradation on both engines, distinct
`applied`/`preserved`/`unchanged` outcomes, Orca `456.33 g`, and the unchanged
`248.60 x 99.60 mm` no-yaw footprint. Prusa enlargement is present in all three
layer-height profiles. The catalogue exposes 18 managed profile rows plus six
engine-scoped resolution rows; the profile rows keep declared and inclusive
largest-passing values separate.

Customer exposure is zero. The owner chose one merge and one deploy for
J2+J3+J3B after verification. One branch push, one PR into `main`, and that PR's
merge are now authorized but are not yet claimed complete. Deploy, registry
publication/image promotion, route/DNS/allowlist mutation, production-container
changes, and consumer-repository work remain unauthorized. See
`docs/codex/evidence/j3b-native-envelope-and-original-dimensions.md`.

## Historical J3 orientation-visibility checkpoint

J3 starts from J2 commit
`9b28b95cfa9f931092044300ebfca912421bac32`. The owner-approved request
contract is strict `orientationMode=auto|preserve`, with omission defaulting to
`auto` and any other present value returning `INVALID_ORIENTATION_MODE`.
The exact code-bearing J3 SHA is
`c404326f535fcc70ba62aa923fa6652f4fba5019`; local source gates are green. The
owner later passed the complete J3 matrix on exact tree `58c0ccb`.

On the historical J3 tree, success and `MODEL_OUT_OF_PRINTER_BOUNDS` carried the
same complete first-version `model_transform`, orientation mode/outcome,
requested/automatic/total rotations, and original/oriented/final dimensions.
The rotation-only authoritative matrix composes as
`R_total = R_requested * R_automatic`; it excludes centering, grounding,
scaling, and translation. Original dimensions are measured after safe source
conversion and before service orientation, oriented dimensions after that
orientation, and final dimensions after request sizing/rotation.
`stats.object_height_mm` equals `final_dimensions_mm.z`.

An outer ZIP admits exactly one supported source. A multi-object 3MF is
concatenated into one compound STL, passed as one STL argument, and never sent
through a split-to-objects operation. Disconnected shells retain their relative
placement, so this API has no independent multi-object packing capability.
Orca therefore retains `--arrange 1` and `--orient 0` but
adds exactly one `--allow-rotations=0` token to disable unreported whole-
compound yaw. The exact Orca 2.3.1 flag behavior and complete historical J3
container/VPS matrix are owner-verified. J3 did not
authorize deploy, registry write, route activation, or consumer-repository
changes. See
`docs/codex/evidence/j3-orientation-visibility.md`.

## Historical J2 bounds, catalogue, and dark-route candidate

J2 starts at protected-main baseline
`0dedbe1e9e4c32a0373982a45bf788cdcdb4f024`. Current classification is
`J2_LOCAL_AGGREGATE_PASS; J2_HOSTED_BASELINE_SOURCE_IMAGE_PASS_NO_PUBLISH;
J2_LIVE_ACTIVATION_REHEARSAL_BLOCKED_NOT_RUN; J2_NO_ROUTE_MUTATION;
J2_REHEARSAL_TERMINAL_CONTRACT_DARK;
J2_ORCA_CALIBRATION_BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER`.

J2 established physical/profile-declared P1S `256 x 256 x 250 mm` and H2D-sized
`350 x 320 x 325 mm` metadata and retained the `1 mm` lower compatibility
boundary. J3B's current engine-specific inclusive ceilings above supersede the
historical use of those declared values as admission limits.

Public informational `GET /profiles` remains startup-built and non-critical.
J3B supersedes the historical catalogue with 18 FDM-only v2 rows, separate
declared and largest-passing fields, and per-engine machine/fleet resolution.
The generic SLA fallback is never a machine; Elegoo values remain owner-profile
future work.

The dark route contract accepts one through four unique `/32` callers, with
LeadPilot alone in phase one. Network denial is distinct from backend HTTP 401.
All route actions require one inherited root-private rehearsal lock and stable
root-owned protected ancestors; terminal acceptance requires strict dark
assertion. J2 did not mutate the live route because the exact J0-capable deploy,
private inputs, and external allowlist/TLS/rollback observations are absent.

Calibration records nine numeric Bambu references plus the `M03` boundary. Its
Orca runner enforces `--orient 0`, support off before digest/native work, and
reuses production machine/process `--load-settings` plus separate
`--load-filaments`. Vendor-faithful measurement remains blocked. See
[`docs/codex/evidence/j2-bounds-network-calibration.md`](docs/codex/evidence/j2-bounds-network-calibration.md).

## Current J1C slice-contract corrective checkpoint

Current classification:
`J1C_ZERO_MASS_GUARD_OWNER_SUPPLIED_VPS_PASS;
J1C_ORCA_CORRECTION_LOCAL_FOCUSED_PASS;
J1C_FINAL_COMBINED_IMAGE_RERUN_PENDING;
J1C_CAPABILITY_READINESS_PROPOSAL_ONLY; NO_VENDOR_IMPORT; NO_DEPLOY`.

Focused 19/19 evidence proves that optional direct grams map a recognized
`0.00 g` marker to null/manual pricing while positive time and length remain
required. When selected-profile Orca requires grams, the same zero remains
`GCODE_FILAMENT_NOT_POSITIVE` -> `SLICE_OUTPUT_UNPARSED`; marker drift still
fails closed. Owner-supplied VPS evidence verifies HTTP 200 with positive
filament length and null mass/rate/price for the guard-only diagnostic image.

Production Orca now loads only machine plus process through `--load-settings`
and passes a selected filament snapshot separately through `--load-filaments`.
Both repository-owned P1S/H2D child machine profiles own exact
`layer_change_gcode='G92 E0'`; the pinned upstream copy is unchanged. The
combined focused set passes 69/69. Owner-supplied VPS mechanism evidence shows
the dedicated filament option changes native output from 0.00 g to 4.12 g, but
the exact final combined candidate image rerun remains pending.

The incomplete vendor chain is a separate W8 time/motion calibration lane, not
a J1C blocker; no vendor profile was imported. J2 later corrects P1S
256 x 256 x 250 mm and H2D 350 x 320 x 325 mm bed-shape/Z, and makes the
privacy-safe calibration helper reuse J1C's production invocation policy.

Capability readiness is a proposal only. Public `GET /health` remains cheap
liveness; future capability state belongs on public `GET /ready`. Docker still
checks `/health`, while Traefik already consumes `/ready`, so a future `/ready`
503 could withhold routing without making Docker unhealthy. Startup native
smokes and typed rolling per-engine failure/recovery require a separate wave.
See
[`docs/codex/evidence/j1c-slice-contract-corrective.md`](docs/codex/evidence/j1c-slice-contract-corrective.md).

## Current I12 Wave 3 Hostinger qualification checkpoint

Current classification:
`I12_API_F710_DARK_N1_VERIFIED;
OPERATOR_MAIN_7C8AEE_RESIDUAL_RECONCILIATION_COMPLETE;
CORRECTED_TRAEFIK_DARK_CUTOVER_VERIFIED; PUBLIC_ROUTE_DISABLED`.
Protected operator main `7c8aee0728fc8462c67b4c6d85636bffb7afcdf8`
passed Source `32804297840` and Image `32804297658` after PR `#5`. The deployed
API image source remains the protected-main checkpoint
`f71069cb3ba5ddeb97e69ca1414a00a72a20ce28`,
whose Source `32749722709`, Image `32749722715`, Candidate Publication
`32750334897`, and automatic no-deploy rehearsal `32751148223` passed. Its
exact signed API image remains
`ghcr.io/botond1/3d-printer-slicer-api@sha256:d50c72bd084e14645f2c9c7b18a087317bf080a2d76cf1bc876d5e3427ae1e26`.
The API container remains healthy and dark at retained concurrency one on only
the internal private network, with no API host port or default route.

The corrected socketless Traefik candidate is running and healthy on the exact
file-provider-only image, with no Docker socket or Docker provider. Runtime
inspection proved ingress/private gateway priorities `1/0`, an ingress-owned
IPv4 default route, no container IPv6 default route, the exact effective
read-only configs bind, and one Docker-owned host listener per port `80`/`443`
on both IPv4 and IPv6. The container networks themselves remain IPv6-disabled;
host listener families and container-network IPv6 are separate facts. The
dynamic route directory contains only `.gitkeep`, unknown HTTPS hosts return
404, and no public slicer router is active. ACME bytes remain unchanged.

The prior failed residual set was reconciled by exact identity; the corrected
resumable cutover then established the current candidate/network identities.
The former dedicated proxy is intentionally retained stopped for bounded
rollback; the root-private recovery ledger and success evidence are retained,
while exact helper/upload/temp cleanup passed. Broad
Docker cleanup or prune remains forbidden. Corrective commit `7a490c150bb8c4c1ec6c22561421202152070fbc`
and evidence commit `1fe89d7508f5bbd59a75256ec43722f3f19ae1c2` remain distinct
from the API-image source and did not relabel, rebuild, publish, or replace the
`f71069c` image. Hostname/DNS, approved public caller/CIDR, firewall acceptance,
certificate issuance/continuity, route activation, monitoring/recovery
acceptance, customer traffic, and public production completeness remain
`UNVERIFIED` and separately authorized. See
`docs/codex/evidence/i12-wave3-hostinger-production-qualification.md`.

## Historical I11 protected-main signed-candidate checkpoint

I11 later completed at protected-main SHA
`65706e381b907c6ba09a8eba504af3adaacac86b`: Source `32668796239`, Image
`32668796232`, Candidate Publication `32669087688`, and automatic rehearsal
`32669484893` succeeded. Any corrective-pending statement retained below is
historical and superseded by those exact results and the current I12 checkpoint.

I11 started from exact protected-main baseline
`8253160eef1c3e00c1e40826ec61fd97563ddd9b` and merged PR `#2` at main SHA
`48afd39b26a6c6ca18ec7bbd18a719c846751e26`. Exact-main Source run
`32666929393`, Image run `32666929394`, and Candidate Publication run
`32667219964` succeeded. The immutable candidate digest is
`sha256:3cea88b5009e5bd65b634865608681fccbb9fb721308ada2f6e8844e172541ea`;
SLSA/SPDX attestation IDs are `42460061` and `42460068`, and bounded evidence
artifact `9500456840` was uploaded with exact cleanup. This is signed candidate
evidence only, not deployment or production readiness.

The intended publication entry point is manual `workflow_dispatch` only from
the exact current protected `main` SHA. It has two explicit, mutually exclusive
modes: `publish_new` requires an empty existing-digest input, the exact
`PUBLISH_SIGNED_MAIN_CANDIDATE` confirmation and a proven-absent discovery tag;
`recover_exact_digest` requires the exact
`RECOVER_SIGNED_MAIN_CANDIDATE` confirmation plus one lowercase
`sha256:<64 hex>` digest already bound to the SHA-derived tag and to the
once-built image config. Recovery performs no registry push, overwrite or
delete. Both modes continue only through exact-digest identity, attestation,
verification, bounded evidence and exact cleanup.

Only the publication job may receive registry/attestation/OIDC write
permissions and it binds `candidate-publication` with `deployment: false`.
Environment `candidate-publication` is `LIVE_CONFIG_VERIFIED` as of 2026-08-23,
ID `20443404498`: protected branches true, custom branch policies false, with no
reviewer or wait-timer rules, secrets, variables or deployments. It has exactly
one `branch_policy` protection rule, ID `63481958`, representing that branch
policy. The empty reviewer set reflects the sole-collaborator capability limit,
not human approval.

A successful protected-main Candidate Publication automatically invokes
`Signed Main Candidate Ephemeral Rehearsal (NO DEPLOY)` through `workflow_run`.
It re-proves the upstream run, accepts exactly one bounded publication artifact,
and dynamically creates a digest-only previous/current manifest from the fixed
release-rehearsal policy plus the current I11 provenance. It re-verifies each
image's SLSA and SPDX attestations through API and OCI, runs the hardened I9
private-peer readiness, controlled `STORAGE_UNSAFE` failure and automatic exact-
previous rollback path, then emits bounded evidence and performs exact cleanup.
The rehearsal has only contents/actions/packages/attestations read permission;
it cannot write the registry, deploy, use OIDC or contact the VPS. First
automatic run `32667607266` failed closed before registry read/runtime because a
depth-limited main refresh made the otherwise-full checkout shallow and hid the
valid previous-candidate ancestry. Its always-run cleanup then independently
read unset runtime identity variables and masked the primary reason as cleanup
failure. The corrective contract preserves full history and accepts only an
all-empty or fully valid four-field cleanup identity tuple; final corrective
hosted rehearsal evidence remained `PENDING` at that earlier commit boundary.
The later exact corrective run `32669484893` succeeded.

Publication and rehearsal never grant VPS/SSH, production, release, Git-tag,
mutable image-tag, overwrite or deletion authority. See
[`docs/codex/evidence/i11-mainline-signed-candidate.md`](docs/codex/evidence/i11-mainline-signed-candidate.md).

## Verified I10 mainline-governance checkpoint

I10 integrated exact I9 ancestry into `main` at
`8253160eef1c3e00c1e40826ec61fd97563ddd9b`. Exact-main Source run
`32662043454` and Image run `32662043476` succeeded. The live protected-branch
readback contains exactly `main`; strict required status checks bind the GitHub
Actions contexts `Validate exact source candidate (NO DEPLOY)` and
`Build once, inspect, scan, and discard (NO DEPLOY)` with app ID `15368`.

Main requires a pull request, includes administrators, forbids force-push and
deletion, requires conversation resolution, and permits merge commits only;
squash and rebase are disabled. Required approvals remain zero because
`Botond1` is the sole collaborator and cannot self-approve. This is
`HUMAN_REVIEWER_CAPABILITY_UNAVAILABLE`, not a human-review pass. Rulesets are
empty, required signatures are not enabled, Actions default permission is read,
and Actions cannot approve PRs.
I10 added no image publication, deployment, SSH/VPS, environment or production
authority. See
[`docs/codex/evidence/i10-mainline-governance.md`](docs/codex/evidence/i10-mainline-governance.md);
that historical commit-time evidence remains unchanged, while this section
records the later live exit proof.

## Current I9/S3b ephemeral staging and rollback foundation

Repository checkpoint status:
`I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE`. Exact code-bearing SHA
`c632a75fcb83f2dbcde93d31ef0170de095c4abd` passed Source run
`30623957952`, Image run `30623957930`, and I9 rehearsal run `30623957946`.
I9 evidence artifact `8790622022` and Image evidence artifact `8790673435`
were uploaded after their bounded gates and exact cleanup. This is an
ephemeral hosted rehearsal result, not a production promotion.

I9 starts from the completed I8 exact SHA
`1fffab87960c675a053ae814d374cab331fbb14d` on
`codex/i9-s3b-staging-rollback-foundation`. It adds a hosted-Linux,
registry-read-only rehearsal; it does not deploy, promote a production tag, or
contact the VPS.

The rehearsal manifest binds the signed C7 candidate digest
`sha256:4c0439c9cbc0b52dc0bf88d47e7151ca997073108b20f9c063d614a25a1f8bb5`
and the distinct C6 rehearsal-only previous digest
`sha256:26df5afe5ad48062c8e1d5213b305282d9386688e1666e2ef0a56487de5e8b6c`.
C6 is accepted only after fresh I9 verification of both SLSA provenance and
SPDX attestations; this does not retroactively classify it as a
production-approved release.

At the exact I9 checkpoint, `.github/workflows/staging-rollback-rehearsal.yml`
was an exact-branch push workflow with global non-cancelling concurrency and
read-only permissions. I11 productizes that same runtime proof as a successful
protected-main Candidate Publication `workflow_run`; it is no longer an I9
branch-triggered workflow. The historical I9 run IDs and evidence remain valid
for their commit; I11's protected-main publication-triggered automatic
rehearsal later succeeded in run `32669484893`.

The runtime pulls both immutable digests, dynamically proves the same positive
non-root service UID/GID, prepares only run-owned `0700` state and inert scoped
credentials, and starts the production Compose contract with `--pull never`
and no build. A hardened private peer requires two consecutive liveness,
minimal readiness, authenticated operations readiness, fresh detailed
readiness with Python, idle queue, and missing/wrong-key rejection observations.
An offline Orca 2.3.1 synthetic slice runs against previous, candidate, and
restored-previous identities.

After candidate readiness, the drill changes only the run-owned pricing-state
directory from `0700` to `0500`. `/health` must remain live while fresh
detailed readiness, `/ready`, and operations readiness fail with exactly
`STORAGE_UNSAFE`. Mode `0700` is restored unconditionally and the exact
previous digest must restart with a new container/PID and pass the full gate.
Only bounded allowlisted evidence after exact runtime cleanup may classify
`I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE`.

This closes only the hosted-ephemeral rehearsal foundation. Actual caller/proxy,
firewall, secret delivery, deployed digest, VPS state, change approval,
production promotion, and production rollback remain `UNVERIFIED` and require
separate authorization. Exact hosted status is recorded in
[`docs/codex/evidence/i9-s3b-staging-rollback-foundation.md`](docs/codex/evidence/i9-s3b-staging-rollback-foundation.md).

## Historical I8/S3a signed-candidate publication status

The section below preserves the I8 correction history. I8-C7 is now closed at
exact SHA `1fffab87960c675a053ae814d374cab331fbb14d`: Source run
`30592235730`, Image run `30592235708`, and Candidate Publication run
`30592235740` succeeded. The immutable candidate digest is
`sha256:4c0439c9cbc0b52dc0bf88d47e7151ca997073108b20f9c063d614a25a1f8bb5`
with config identity
`sha256:b16f951a9701335b35b4ef248c2b1764d06c17f5e90ee6c2c2245bedc3026d42`;
both attestations, positive/negative verification, bounded evidence, and exact
cleanup passed. Later pre-run C6/C7 statements are historical, not current.

The I8 branch starts exactly from
`c9ce6c5b3e8cf767563ab46a41b3c0e0e97ce2a6` on
`codex/i8-s3a-ghcr-signed-candidate`. The current committed boundary is I8-C6
commit `71e3a7df1972b78a7c8cc2cc03508558186027ce`. Hosted Source run
`30591301132` and Image run `30591301127` are `SUCCESS`; Image evidence artifact
`8778528680` exists. Candidate Publication run `30591301158` is `FAILURE` after
publication, digest round trip, both attestations, and all positive GitHub API,
OCI, and offline bundle verifications succeeded. Both controlled negative
probes returned nonzero as required, but the step then coupled acceptance to an
obsolete exact `gh` CLI diagnostic sentence.

The C6 candidate tag
`candidate-71e3a7df1972b78a7c8cc2cc03508558186027ce` is quarantined unchanged at
manifest digest
`sha256:26df5afe5ad48062c8e1d5213b305282d9386688e1666e2ef0a56487de5e8b6c`
and config identity
`sha256:8d4de3647161d5688688191c9eb7af301d43216ab22ce0142d0a244e00c72c82`.
Both GitHub/Sigstore attestations exist and positive verification succeeded,
but the Candidate evidence artifact is incomplete. Exact publication,
attestation-bundle-parent, and evidence cleanup succeeded. The exact
classification remains `I8_CANDIDATE_ATTESTATION_UNVERIFIED`. Older candidates
also remain quarantined and unchanged.

I8-C1 narrowly resolves the default-branch `workflow_dispatch` registration
blocker. Candidate Publication retains its exact manual input contract for
future default-branch integration and also accepts `push` only for
`codex/i8-s3a-ghcr-signed-candidate`. The push adapter derives the candidate
from `github.sha` and requires repository
`Botond1/3D-Printer-Slicer-API`, ref
`refs/heads/codex/i8-s3a-ghcr-signed-candidate`, actor `Botond1`, fixed registry
`ghcr.io/botond1/3d-printer-slicer-api`, and exact last non-empty HEAD commit
line:

```text
I8-Publication: PUBLISH_I8_SIGNED_GHCR_CANDIDATE
```

Both event paths fail closed and emit the same canonical `candidate_sha`,
`image_ref`, `discovery_tag`, and `registry_repository` outputs. Preflight has
only `contents: read`; only the publication job has `contents: read`,
`packages: write`, `attestations: write`, and `id-token: write`. Normal Source
and Image Validation remain read-only. Candidate Publication keeps the same
once-built `linux/amd64` image through the complete
runtime/Orca/browser/topology/SBOM/Grype gate before registry login and may
then push only `candidate-<full-source-sha>` to the fixed GHCR repository.

The downstream contract is digest-only:
`ghcr.io/botond1/3d-printer-slicer-api@sha256:<64 lowercase hex>`. A discovery
tag is not an immutable consumption reference. The proposed workflow refuses
an existing tag, verifies manifest/config/platform/labels, pulls the exact
digest, and proves its image ID equals the gated build before recreating an
exact local runtime alias. Production Compose and all registry, signature,
attestation, verification, and evidence identities remain digest-bound. It
creates distinct GitHub/Sigstore SLSA provenance and SPDX 2.3 attestations for
the untagged repository name plus exact registry digest. I8 provenance v2 is
bounded and fail closed, and its final aggregator distinguishes
`BLOCKED_I8_PREPUBLICATION_GATE`, `I8_CANDIDATE_PUBLISHED_UNATTESTED`, and
`I8_CANDIDATE_ATTESTATION_UNVERIFIED`.

The historical C1 failure was helper/action image-alias namespace drift.
I8-C2A corrected that seam and preserves the exact separation between the
candidate-scoped local runtime alias and the canonical registry digest. After a
digest pull is proved to have the gated image ID, the helper and runtime
container use `local/slicer-api-publication:<40-lowercase-sha>`; Orca uses the
independently checked exact image ID. Production Compose, registry identity,
signature, attestation, verification, and evidence remain bound to the exact
registry digest.

C2A then failed at the I4 main-container name contract: the Candidate workflow
supplied `s3a-publication-<run-id>-<run-attempt>`, while
`scripts/i4-image-runtime-envelope.js` admitted only the validation namespace.
The I8-C3 correction admits exactly the full-string
`s3a-(validation|publication)-<decimal-run-id>-<decimal-run-attempt>` forms
with a 128-byte maximum. The complete executable namespace audit records:

- I2 image aliases use exactly the local `validation` and `publication`
  namespaces.
- I4's main container was the sole validation-only drift and now uses the exact
  two-namespace, full-string, bounded contract.
- I2 probe names remain generic, strict, bounded, and distinct where required.
- I6 container and network names remain generic, strict, bounded, and pairwise
  distinct.
- Evidence and temporary directories are generated per run and remain bounded.
- Cleanup uses exact environment references and requires ownership labels plus
  exact image, container, and network identities before removal.
- No other executable validation-only regex exists in the Candidate helper
  chain.

I8-C4 introduces one bounded shared runtime-state proof in both the
prepublication gate and the post-push digest-roundtrip path. It proves exact
container ID and image ID, allowlisted state, the same positive PID in
consecutive healthy observations before host `ps`, matching positive kernel
UID/GID, and the same ready state after `ps`. Status must be exactly `running`;
paused, restarting, dead, exited, unhealthy or missing-health, OOM, state
error, malformed state/PID/identity, timeout, and post-`ps` state change all
fail closed.

The C4 local gate also closed a Windows transport-abort cleanup race: failed
upload storage callbacks now wait for the owned output stream to close before
workspace cleanup begins. The live partial-request test aligns the HTTP receive
and application upload deadlines with their shared production default instead
of relying on Node-version-specific parser timeout settlement.

The uploaded evidence record now stops at
`I8_CANDIDATE_EVIDENCE_READY`; only final enforcement after evidence upload,
publication cleanup, and evidence cleanup may emit
`I8_SIGNED_CANDIDATE_COMPLETE`. One-by-one mutation coverage keeps every final
dependency fail closed, and the final summary independently reports both
cleanup outcomes even when an earlier partial-publication failure is primary.
Post-correction evidence is green for the 734/734 affected
Candidate/runtime/attestation tests, full JavaScript 1296/1296, and Python
42/43 pass with one expected Windows POSIX-permission skip. Local Docker proof
is `NOT_RUN_ENVIRONMENT`.

I8-C5 corrects the C4 digest-runtime invocation drift. The shared exact-image
gate already passed dynamic UID/GID and the complete PID/memory/CPU/log/stop
contract to `scripts/i4-container-entrypoint.sh`; the post-push digest runtime
omitted those eight `EXPECTED_*` variables and the matching bounded Docker log
configuration. Because the entrypoint treats omission as exit `78`, this is the
verified C4 hosted root cause. C5 adds exact invocation parity plus removal
mutation coverage. It also replaces a deterministic wrong-digest negative
probe that addressed a nonexistent OCI manifest with a bounded local
wrong-content artifact and the already positively verified offline bundle, so
verification reaches digest policy instead of failing at registry lookup.
Digest identity, runtime user, topology, attestation, cleanup, and no-deploy
behavior remain unchanged. C5 hosted evidence confirms the runtime parity and
attestation creation before the separate C6 binding defect.

I8-C6 fixed the C5 verification binding defect. The verification Node policy
reads `process.env.REGISTRY_DIGEST` to compare the signed subject, but the step
previously supplied only `DIGEST_REF`; that guaranteed an
`undefined.slice(7)` exception after the cryptographic verification commands.
C6 binds only the exact registry-push digest and adds a step-local mutation.
All other heredoc inputs were audited as bound. The same downstream audit found
that `actions/attest` creates each bundle in a unique runner-temp directory
while the old cleanup removed only the file. C6 now admits only a regular
`attestation.json` in a canonical direct child of canonical `RUNNER_TEMP`,
removes the file, removes its exact parent, and verifies absence. Containment
and parent-removal mutations protect this cleanup. Hosted C6 proved both fixes,
then exposed only the distinct diagnostic-text coupling in negative
verification.

I8-C7 keeps the same positively verified bundle and changes exactly one
dimension per negative probe: wrong local bytes with the correct repository,
then the exact digest with a distinct repository. It requires each verifier
status to be nonzero independently, re-proves the signed offline subject and
unchanged bundle, reuses the full positive identity policy, sends unused stderr
to `/dev/null`, and forbids diagnostic-text acceptance. Exact-SHA hosted
results remain `PENDING` at this commit boundary.
Local C7 evidence is green for 312/312 focused tests, 1352/1352 complete
JavaScript tests, and 43 Python tests with 42 pass plus one expected Windows
POSIX-permission skip. Syntax passes for 173 JavaScript and 32 Python files;
tracked safety covers 307 files and the production audit has zero findings.
Local Docker and actionlint remain `NOT_RUN_ENVIRONMENT`.

The current user authorization permits staged continuation through corrective
commits, normal non-force target-branch pushes, and exact-SHA hosted validation
until the I8 signed candidate exits green. It does not authorize old-tag
mutation, `main` change, PR, merge, force-push, release, Git tag, mutable
registry tag, deploy, VPS/SSH, or repository-setting changes.

The exact-SHA candidate workflow is a reviewed trust assumption: build, full
gate, push, and attestation remain in one job to preserve build identity
without a multi-GiB image-tar handoff. See
[`docs/codex/evidence/i8-s3a-ghcr-signed-candidate.md`](docs/codex/evidence/i8-s3a-ghcr-signed-candidate.md).

## Historical I7/S3a immutable-candidate foundation

The repository now has a separate `docker-compose.production.yml` contract.
It accepts only an operator-supplied
`registry/repository@sha256:<64 lowercase hex>` after
`node scripts/i7-production-compose-contract.js` passes. Raw Compose
interpolation checks presence, not digest syntax, so that validator is a
mandatory preflight. The production manifest has no build, published port, or
proxy service; it preserves the non-root/read-only/resource/logging/runtime
envelope and attaches the API only to the internal `slicer-api-private` bridge.

At I7, Image Validation built once and never pushed or deployed. After all
exact-image gates and exact cleanup pass, it creates one bounded, allowlisted
`candidate-provenance.json`, correlates it to the exact source/run/job/local
image ID/SBOM/scanner database/gate outcomes, uploads the explicit evidence
set, and then removes only that run's evidence. Registry digest, signature,
and attestation are `NOT_CREATED`; deployed digest is
`NOT_APPLICABLE_NO_PUBLISH`. Exact baseline I7 hosted Source run `30160486802`
and Image run `30160486750` are `SUCCESS`; evidence artifact `8620145030`
records the green no-push checkpoint. S3b is `NOT_STARTED`; production
readiness remains `UNVERIFIED`.

## Authority and evidence

Use sources in this order:

1. current user instructions and the authorized execution prompt;
2. executable source, route wiring, OpenAPI generator, manifests, Docker and
   Compose files, workflows, and tests;
3. the Codex knowledge files above;
4. Claude/Copilot instructions, README, changelog, and operational prose.

Treat documentation-only claims as `UNVERIFIED` until code or runtime evidence
supports them. Cite repository paths and symbols in durable knowledge changes.

## Current local checkpoint

S0/S0.1 repository validation is anchored by
`b1411be8cfd68101eb2a3a909b0e1a428e8c111f` (fail-closed validation and
characterization) and `f9ed1ee6791e531670d5d7703f994bfb51986ebb`
(registry/audit dependency remediation). Its committed local gates and
production dependency audit were green with npm 10.9.8. Docker image/health
validation was `NOT_RUN_ENVIRONMENT`; hosted CI, branch protection, deployment
state, and production topology remain `UNVERIFIED`.

S1a upload/workspace lifecycle is `VERIFIED` for the local repository checkpoint
at implementation commit `e7a409566bb8795a22f38bbf9f514b42c51bda74`.
Evidence includes fixed Multer `fieldNestingDepth: 0`, 132/132 JavaScript and
22/22 Python tests, 63 JavaScript and 25 Python syntax files, 163 tracked safety
paths plus the 30-file implementation stage, an exact npm 10.9.8 clean install,
and zero production audit findings.
Docker image/startup smoke was `NOT_RUN_ENVIRONMENT` because the client found no
daemon; hosted CI and all deployment/topology state remain `UNVERIFIED`. This
checkpoint is not production promotion authorization.

The current I1 integration checkpoint is
`I1_CHECKPOINT_BLOCKED_IMAGE`, anchored by runtime commit
`995bb9de750ef2a0ebefb22d8cedf6e19c49cf48`. It integrates, in order,
`a862e2c` (source `78693fe`, dependency maintenance), `4c7df9e` (source
`b91401e`, S3a-B1), `7bc7946` (source `edbe81c`, S3a-V1), `6921f7a`
(source `fd93c0b`, S3a-B2), `d1db7df` (source `67a2922`, S1b), `89369d1`
(source `fd6f4f3`, S1c), `2fee995` (source `d1bc413`, S1c evidence),
`896f3bf` (source `d0d7dc3`, process settlement polling), and then the runtime
commit. Dependency patch ID `5b593dee0baaa1437aedfd4892654bd90c971a4e`
occurs once; duplicate commit `306b799` was not integrated.

I1 now handles `SIGTERM` and `SIGINT` through one single-flight shutdown. It
closes HTTP admission, starts typed queue shutdown, rejects later admission as
`SLICE_QUEUE_SHUTDOWN`, aborts queued and active jobs, waits for both HTTP and
queue drains, and retains an active slot until its task actually settles. The
S1c command contract uses a minimal child environment and bounded TERM-to-KILL
process-tree termination; abort cannot become a later success or released
artifact. Deterministic evidence covers timer, listener, counter, response,
workspace, and process-settlement cleanup.

Local I1 evidence is green for a 175-package clean install, focused
runtime/queue/native tests 48/48, focused quality tests 58/58, aggregate
JavaScript 457/457 and Python 22/22, syntax over 86 tracked JavaScript and 25
Python files, runtime-stage safety over 192
tracked and six staged files, final tracked safety over 196 files, documentation
stage safety over five files, and an offline production audit with zero findings. The online
audit is `BLOCKED_POLICY`; `actionlint` and Docker are unavailable.

Hosted S3a-B2 Source Validation for exact source commit `fd93c0b` passed in run
`29957927228` / job `89051575423` with no annotations or Node 20 warnings.
Image Validation run `29957927370` / job `89051576245` failed. Its retained
artifact is `8545008995` with digest
`sha256:c0c80f843cbea086eb4a8e6a293cd467254b8da67ae1c09b4e84d832a21d3bcc`.
Annotations show liveness exit 1, a Grype HIGH result, scanner-classifier exit
1, and final-gate exit 1. Swiper 7.2.0 advisory
`GHSA-hmx5-qpq5-p643` / `CVE-2026-27212` is an allowed known advisory for
triage, but it is not claimed as the sole failure: the persistent runtime
liveness failure remains unresolved. S3a-V2C's deterministic Swiper vendor
upgrade is not integrated and its worktree/surfaces are untouched.

The historical S1a/S3a manifest freeze was closed by the serialized dependency
patch above. S3a's repository no-deploy workflow separation is integrated, but
its image gate remains blocked. Branch protection, required checks, immutable
registry digest, signature, attestation, promotion, S4, S3b, production
readiness, VPS topology, and deployed state remain `UNVERIFIED`. I1 changes
neither `main` nor the running VPS and grants no deployment permission.
S4 owns service trust and proxy/private-ingress/egress topology; I3 later
implements only its slice-auth/browser-Origin subset. S3b owns staging,
promotion, readiness, and rollback drills only after complete S4 evidence and
separate explicit user/owner authorization. S2 artifact work waits for the S1a
ownership seam, and its container envelope waits for S3a image-control
decisions.

The current I2 branch preserves the I1
queue/native/graceful-shutdown contracts, integrates the deterministic Swiper
12.1.2 remediation into both Orca resource trees, and leaves the exact Orca
v2.3.1 URL/SHA unchanged. Hosted A/B/C evidence verified that root-owned tmpfs
mount roots caused `/app/input/.slice-jobs` startup `EACCES`; the workflow now
resolves nonzero service UID/GID from the immutable image, cross-checks the
running process against host-kernel credentials, and mounts both 64 MiB runtime
tmpfs paths with `rw,nosuid,nodev,noexec`, dynamic UID/GID, and mode `0700`.
Image validation also runs a bounded, network-isolated, exact-image Orca 2.3.1
help and customer-free manifold-cube slice smoke. It validates an Orca 2.3.1
G-code signature plus real extrusion, uses the same contained runtime-profile
generator as production requests, and binds cleanup to the captured container
ID, immutable image ID, and run-owned labels; reusable names alone are never
deletion authority. Exact-candidate hosted Source and Image Validation passed
for commit `05ad6241c566cab593394a094ed36288e0c99165`.
See [`docs/codex/evidence/i2-v2c-liveness-integration.md`](docs/codex/evidence/i2-v2c-liveness-integration.md).
Branch protection/required checks, signature/attestation, registry promotion,
S4, S3b, VPS/deployed state, and production readiness remain `UNVERIFIED`; I2
does not authorize deployment or promotion.

The current I3 worktree is based on exact commit
`6241685f1af0c0a1d4be6f1c229d66ca922fbb88` on branch
`codex/i3-s4a-service-auth-http-envelope`. It implements only bounded S4
service-auth/browser-origin and S2 Node HTTP-envelope subsets. Startup now
requires a separate `SLICE_SERVICE_API_KEY` containing 32-256 bytes of
printable ASCII and different from `ADMIN_API_KEY`. Both slice endpoints use
`x-slicer-api-key`; rejection is exact HTTP 401
`{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`,
uses fixed-length SHA-256 digest comparison with `crypto.timingSafeEqual`, and
logs only request ID plus resolved client IP.
Requests without `Origin` remain allowed; browser-origin slice calls use only
`SLICE_CORS_ALLOWED_ORIGINS`.

Slice admission order is limiter, service authentication, root-scoped
workspace, Multer, queue, then native processing. The application HTTP
defaults/bounds are: headers timeout 60000 `[1000,60000]`, request timeout
600000 `[60000,600000]`, keep-alive timeout 5000 `[1000,60000]`, header count
2000 `[16,2000]`, connections 128 `[1,1024]`, and requests/socket 100
`[1,1000]`. Invalid overrides fall back to their defaults, and effective
headers timeout cannot exceed request timeout. Focused evidence is green, but
the final aggregate, exact implementation SHA, hosted validation, actual VPS
capacity, reverse-proxy timeouts, private ingress/egress topology, deployment,
and production readiness remain pending or `UNVERIFIED`. See
[`docs/codex/evidence/i3-service-auth-and-http-envelope.md`](docs/codex/evidence/i3-service-auth-and-http-envelope.md).

The current I4/S2 worktree is based on exact I3 baseline
`780d64dd786440cb80ddd4df38cb489c16070a07` on branch
`codex/i4-s2-resource-state-envelope`; it is an uncommitted candidate. Central
resource-policy parsing accepts only bounded canonical positive decimal
integers, with omission using defaults and invalid explicit values refusing
startup. It bounds body/upload lifetime, multipart, ZIP/3MF/SL1, model/output/
profile/pricing reads, successful stats/pricing, artifact retention, and
cleanup work. Multipart lifetime expiry is HTTP 408 `UPLOAD_TOTAL_TIMEOUT`.
Successful slices return collision-resistant `job_id` and `artifact_id`;
private metadata, leases, and TTL/count/byte/partial cleanup coordinate managed
artifacts. Primary pricing state is `configs/pricing-state/pricing.json`, with
safe legacy `configs/pricing.json` read/migration fallback and exclusive-temp,
file-fsync, atomic-rename, directory-fsync persistence. The non-root container
uses a read-only root filesystem, root-owned code/profiles, separate writable
input/output/pricing-state binds, restrictive tmpfs, and bounded PID/memory/
CPU/log/stop settings. Exact active-job container stop orchestration remains
`NOT_PROVEN_S2_ACTIVE_JOB_STOP_ORCHESTRATION`; VPS/proxy/topology/egress,
hosted exact-candidate validation, and deployment remain unverified. See
[`docs/codex/evidence/i4-s2-resource-state-envelope.md`](docs/codex/evidence/i4-s2-resource-state-envelope.md).

The current I5/S4 worktree is based on exact I4 baseline
`5be7b19d13616f06504c18217e25bf95c97c6e96` on branch
`codex/i5-s4-trust-topology-observability`. Repository controls now define four
scoped credential audiences (slice, pricing, artifact, operations), active plus
optional previous rotation slots, exact per-audience CORS, fail-closed explicit
proxy peer trust, safe request-ID propagation, public liveness/minimal
readiness, operations-scoped diagnostics/metrics, and versioned redacted
correlation events. The legacy `ADMIN_API_KEY` path is finite: one named
non-slice audience, a maximum 90-day expiry, and no slice/broad/default use.

Baseline hosted Source run `30022045664` and Image run `30022045578` passed for
exact baseline source and image
`sha256:5f159e1051233811ad663175311059829aecdbff16706e39aceba4aac77f9aa3`.
Exact candidate `510e6110ef5c49cd03962627210d6db114554618` passed hosted
Source run `30037842766`; Image run `30037842526` failed closed on independent
active-abort transport and private-inspect contracts. The corrective repository
candidate uses bounded semantic abort outcomes, canonical
`HostConfig.PortBindings`, a separate external-default-route projection, and
one allowlisted topology reason while retaining real ingress/readiness and
API/native egress probes. Compose remains unchanged and no sidecar is invented.
S4 is `IN_PROGRESS` pending both final hosted workflows on one exact SHA.
VPS/proxy/firewall/secret delivery/deployed state,
branch policy, and S3b promotion/readiness/rollback remain pending or
`UNVERIFIED`. No production, push, or deployment authorization is inferred.
See
[`docs/codex/evidence/i5-s4-trust-topology-observability.md`](docs/codex/evidence/i5-s4-trust-topology-observability.md).

The current I6/S5 atomic delta is
`549fa4258c60b2971855e7a202e488d74427ccd4` followed by
`7dd6d73632856967824570c6e38c54b905d032b1`. Decision:
`PRIVATE_PEER_TOPOLOGY_SELECTED; ASYNC_WORKER_DEFERRED`. Protected
`/health/detailed` now runs fresh readiness probes; `/ready` and
`/operations/readiness` retain the bounded cache. Repository validation selects
an internal-only API with no host port/default route and one authenticated
reverse-proxy peer, then requires calibrated API/native DNS/TCP/UDP denial.
The proxy must not provide generic forwarding, NAT, or DNS tunnelling for the
API. Intended/denied callers, proxy hop/CIDR, secret mode, deployed digest, and
Hostinger/proxy/firewall/egress facts remain `UNVERIFIED`. See
[`docs/codex/evidence/i6-s5-private-peer-topology.md`](docs/codex/evidence/i6-s5-private-peer-topology.md)
and
[`docs/codex/i6-s5-private-peer-operator-validation.md`](docs/codex/i6-s5-private-peer-operator-validation.md).

## Read before changing

- Any change: this file, the three Codex knowledge files, root `CLAUDE.md`, and
  the applicable folder-local `CLAUDE.md` / `.github/instructions/**` overlay.
- API or Node runtime: `app/server.js`, applicable route/middleware/service
  modules, `app/docs/swagger-docs.js`, and `app/CLAUDE.md`.
- Python/native processing: all affected `app/*.py`, `app/services/slice/command.js`,
  `input-processing.js`, `transform.js`, profiles, and `Dockerfile` layout.
- Tests: `tests/testing-scripts/CLAUDE.md`, common helpers, the complete affected
  runner, and its generated Markdown report after an integration run.
- Container/supply chain: `Dockerfile`, both Compose files, `.dockerignore`,
  manifests/lockfiles, `.env.example`, and all workflows.
- Profiles/pricing: `configs/CLAUDE.md`, resolver/persistence code, and only the
  specific tracked profiles required to understand compatibility.

## Compatibility invariants

- Keep runtime state in root-scoped `input/`, `output/`, and `configs/`; never
  introduce `app/input`, `app/output`, or `app/configs`.
- Preserve the legacy multipart field spelling `choosenFile` until a separately
  versioned migration is authorized.
- Preserve public endpoint, response-field, status-code, error-code, pricing,
  profile, and slicer-command semantics unless a contract-change stage says
  otherwise.
- Preserve the slice route order: rate limiter, `x-slicer-api-key`
  authentication, root-scoped workspace/Multer upload, queue, then native
  processing. Authentication rejection must allocate no request workspace.
- Keep active and previous slice, pricing, artifact, and operations credentials
  unique and audience-scoped. Rotation is two-restart; previous removal revokes
  the old key. `ADMIN_API_KEY` is legacy-only for one non-slice audience with a
  <=90-day expiry. Never log any credential.
- Keep browser Origin allowlists separate by audience and preserve no-Origin
  service behavior.
- Keep proxy trust disabled by default and compile only explicit validated
  IP/CIDR peers or loopback. Preserve nearest-untrusted-hop spoof resistance.
- Keep public `/ready` minimal and operations diagnostics/metrics protected.
  `/health/detailed` must use fresh readiness probes; `/ready` and
  `/operations/readiness` retain bounded caching.
  Events must remain allowlisted/redacted and metrics fixed-cardinality.
- Execute commands with `execFile` and argument arrays; never add shell
  interpolation for request-controlled data.
- Reject invalid geometry fail-fast as `INVALID_SOURCE_GEOMETRY`; do not heal,
  repair, or mutate user geometry automatically.
- Preserve Prusa FDM/SLA and Orca FDM-only engine boundaries and profile pairing.

## Security and destructive-action boundaries

- Never use or commit real secrets or `.env`. Use explicit inert test values.
- Do not call production/remote APIs or slicers with customer data. Synthetic,
  disposable local tests require an explicit in-scope gate.
- Do not weaken queue, rate, auth, proxy, CORS, path, symlink, ZIP, timeout, or
  geometry controls to make a test pass.
- Do not mutate pricing, slicer profiles, runtime artifacts, private fixtures, or
  generated reports during unit validation.
- Treat `configs/pricing-state/` as private mutable runtime state; keep
  `configs/prusa/` and `configs/orca/` immutable in the container.
- Resolve destructive targets first. Never clean, reset, overwrite, or absorb an
  unrelated dirty worktree.
- A suspected vulnerability is not a desirable contract. Characterize safe
  behavior and record the secure expectation in the hardening plan.

## Git and live-cloud boundaries

- Start with read-only checks for root, remote, HEAD, branch, status, and the
  authorized baseline diff. Stop on unexpected changes.
- Work only on an authorized `codex/*` branch or isolated linked worktree. Never
  edit `main` directly.
- Do not fetch, pull, push, open a PR, tag, release, deploy, SSH, or contact the
  VPS unless the current user explicitly authorizes that exact action.
- Before S3a, a `main` push was configured to attempt deployment. The current
  repository workflows do not automatically deploy on `main` or any validation
  event. Promotion still needs separate verified controls and explicit human
  authorization; validation CI alone does not make a commit production-ready.

## Parallel ownership

Keep first-pass discovery read-only and divide non-overlapping lanes:

- Node/API: bootstrap, middleware, routes, services, OpenAPI, contracts.
- Python/native: converters, transform/orientation, commands, native trust.
- Docker/supply chain: image, Compose, dependencies, CI/deploy/readiness.
- Testability/operations: runners, reports, fixtures, seams, retention, telemetry.

Assign explicit file ownership before parallel edits. Agents are not alone in
the worktree: do not revert others, and reconcile cross-lane findings centrally
before editing shared files.

Parallel lanes return implementation and validation evidence to the integrator.
The integrator alone reconciles canonical shared knowledge after integration;
in the S1a/S3a wave, S3a must not edit `AGENTS.md` or `docs/codex/**` in
parallel with S1a.

## Validation gates

Always run the smallest relevant checks first and report exact commands, exit
codes, and counts:

1. `git diff --check` and complete tracked-source JS/Python syntax validation;
2. deterministic JavaScript and Python unit suites, then aggregate `npm test`;
3. instruction-mirror drift and staged-file secret/size/artifact guards;
4. `npm ci --ignore-scripts --no-audit --no-fund` when lockfile validation applies;
5. applicable focused integration runner, followed by reading its Markdown report;
6. Compose/build/health checks when Docker/runtime inputs change or the gate is
   otherwise applicable; never report an unavailable conditional gate as green.

Run a quality review for non-trivial source changes or decomposition-guardrail
pressure. Files over 500 lines, test runners over 250 lines, services over 300
lines, and functions over 60 lines require an explicit split/defer decision
before adding responsibilities.

## Documentation and drift

Update Codex knowledge when verified topology, risk, or staged exit criteria
change. Do not edit the mirrored Claude/Copilot corpus merely to copy Codex
content. Synchronize that corpus only when a shared project policy or public
contract actually changes, and preserve byte equality of intentional mirrors.

## Required handoff

State status, code/work baselines, branch, local commits, modified files, audit
findings, documentation drift, implemented hardening, contract-preservation
evidence, exact test/gate results, CI/Docker evidence, remaining risks, next
parallel stages, and forbidden-side-effect confirmation. Distinguish `PASS`,
`NOT_RUN_ENVIRONMENT`, and `BLOCKED`; never present a skip as a pass.
