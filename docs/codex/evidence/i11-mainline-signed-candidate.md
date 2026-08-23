# I11 protected-main signed-candidate productization

## Checkpoint boundary

- Exact baseline and current protected-main SHA:
  `8253160eef1c3e00c1e40826ec61fd97563ddd9b`.
- Implementation branch: `codex/i11-release-productization`.
- Commit-time status: `PENDING_LOCAL_AND_HOSTED_VALIDATION`.
- This document records the intended I11 contract before its implementation
  commit and hosted publication exist. It does not pre-claim a final I11 SHA,
  local test count, Source/Image success, Candidate Publication success,
  registry digest, attestation, publication/rehearsal evidence artifact or
  cleanup result. The GitHub environment is the sole live-verified I11 setup
  exception described below.
- I11 authorizes candidate publication only. It does not authorize deployment,
  VPS/SSH access, production mutation, a release or Git tag, a mutable image
  tag, registry overwrite/deletion, or repository-policy weakening.

## Verified I10 prerequisite

I10 is complete at exact main SHA
`8253160eef1c3e00c1e40826ec61fd97563ddd9b`:

- Source Validation run `32662043454`: `SUCCESS`.
- Image Validation run `32662043476`: `SUCCESS`.
- Protected branches: exactly `main`.
- Strict required checks:
  - `Validate exact source candidate (NO DEPLOY)`, app ID `15368`;
  - `Build once, inspect, scan, and discard (NO DEPLOY)`, app ID `15368`.
- Pull request required, administrators enforced, force-push and deletion
  forbidden, conversation resolution required.
- Merge commits are the sole enabled strategy; squash and rebase are disabled.
- Rulesets are empty and required signatures are not enabled. Default Actions
  workflow permission is read, and Actions cannot approve pull requests.
- Required approving reviews are zero because `Botond1` is the sole
  collaborator and cannot self-approve. Classification:
  `HUMAN_REVIEWER_CAPABILITY_UNAVAILABLE`, not a human-review pass.
- No publication or deployment workflow ran as part of I10.

The historical
[`i10-mainline-governance.md`](i10-mainline-governance.md) file intentionally
records its pre-merge pending state and is not rewritten. The live results above
are the canonical closure of those pending exits.

## Graphify and direct source map

No committed Graphify output is required for I11. The direct executable-source
map is authoritative:

```text
workflow_dispatch on refs/heads/main
  -> exact event/request/repository/actor/ref/SHA preflight
  -> exact remote main HEAD and post-I10 ancestry
  -> publication_mode and mode-bound confirmation
  -> checkout exact candidate without persisted credentials
  -> one linux/amd64 image build
  -> complete runtime / Orca / browser / topology / SBOM / Grype gate
  -> candidate-publication environment, deployment: false
  -> GHCR authentication
  -> publish_new: absent tag -> push once
     OR
     recover_exact_digest: matching existing tag/digest/config -> no push
  -> immutable digest round trip and production Compose identity
  -> SLSA provenance and SPDX SBOM attestations
  -> positive and negative cryptographic verification
  -> bounded mode-aware evidence and allowlisted upload
  -> exact publication/evidence cleanup
  -> final fail-closed aggregation
  -> successful Candidate Publication workflow_run on main
  -> re-proven upstream API identity and exactly one bounded artifact
  -> dynamic distinct previous/current digest-only manifest
  -> per-image SLSA/SPDX verification through API and OCI
  -> hardened I9 readiness / STORAGE_UNSAFE / automatic previous rollback
  -> bounded rehearsal evidence and exact cleanup
```

Historical hosted S4/S5 private-peer topology and I9 rollback rehearsal are
ephemeral runner evidence. They do not prove the production Hostinger/VPS,
caller, proxy, firewall, secret-delivery, deployed-digest, live-readiness or
rollback state.

## Manual trigger and identity contract

Candidate Publication must accept only `workflow_dispatch`. The selected
workflow ref, `github.ref`, and source identity must be exact current protected
`main`; `candidate_sha` must be one full lowercase 40-hex post-baseline SHA and
must equal all of:

1. the requested input;
2. the workflow event SHA;
3. the checked-out HEAD;
4. the current `refs/heads/main` remote HEAD.

Repository must be exactly `Botond1/3D-Printer-Slicer-API`, actor exactly
`Botond1`, and registry repository exactly
`ghcr.io/botond1/3d-printer-slicer-api`. Pull-request, push, merge-group,
schedule, repository-dispatch, alternate branch/actor/repository/registry,
baseline SHA, detached/stale main and malformed input paths fail closed.

The concurrency key is repository-wide for main candidate publication and does
not cancel an in-progress publication. This prevents two manual modes from
racing the same immutable discovery namespace.

## Publication modes and recovery boundary

### `publish_new`

- `existing_registry_digest` must be empty.
- Confirmation must be exactly `PUBLISH_SIGNED_MAIN_CANDIDATE`.
- Discovery tag is exactly `candidate-<full candidate SHA>`.
- Registry absence must be positively distinguishable from transport,
  permission or service failure. An existing or ambiguous tag blocks.
- The complete once-built image gate must pass before registry login or push.
- Exactly that gated local image may be tagged and pushed once. A second build,
  overwrite, delete, mutable tag or alternate repository is forbidden.
- Evidence semantics on success are `registry_operation=published_new`,
  `tag_absent_before_push=true`, `same_image_pushed=true`, and
  `registry_write_performed=true`.

### `recover_exact_digest`

- `existing_registry_digest` must be exactly one lowercase
  `sha256:<64 hex>` value.
- Confirmation must be exactly `RECOVER_SIGNED_MAIN_CANDIDATE`.
- The SHA-derived discovery tag must already exist at that exact manifest
  digest. Its non-index manifest config digest must equal the once-built local
  image ID, while manifest and config identities must remain distinct.
- Recovery cannot tag/push remotely, overwrite, delete, or accept an arbitrary
  existing tag. It adopts only the exact matching immutable subject and then
  continues digest pull, runtime/Compose identity, attestation, verification,
  evidence and cleanup.
- Evidence semantics on success are `registry_operation=recovered_existing`,
  `tag_absent_before_push=false`, `same_image_pushed=false`,
  `existing_exact_digest_verified=true`, and
  `registry_write_performed=false`.

### Partial-publication decisions

- No remote candidate: use `publish_new` only after proven absence.
- Exact SHA-derived tag, expected digest and expected config all match: use
  `recover_exact_digest`; do not republish.
- Tag exists but digest/config/source/platform identity is foreign, malformed or
  ambiguous: block and preserve it unchanged.
- Complete signed/attested candidate already exists: re-verify read-only or stop;
  do not mutate it merely to reproduce a workflow result.

## Automatic signed-main ephemeral rehearsal

Only a completed, successful `Candidate Publication - Signed GHCR (NO DEPLOY)`
`workflow_run` on `main` may start the productized rehearsal. Preflight
re-validates the workflow name/path/ID, dispatch event, conclusion, repository,
branch, source SHA, run ID/attempt and current-main ancestry through the GitHub
API. It accepts exactly one non-expired artifact named
`i11-main-signed-candidate-<sha>-<run>-<attempt>`, bounded to 130 MiB and a
GitHub `sha256` artifact digest. Extraction permits exactly these six regular,
non-link, direct-child files:

- `i11-main-candidate-provenance.json`;
- `image-identity.txt`;
- `runtime-diagnostics.json`;
- `topology-evidence.json`;
- `sbom.spdx.json`;
- `grype.json`.

`.github/release-rehearsal-policy.json` pins the previous signed candidate and
its signer/predicate identities. The exact publication provenance supplies the
current protected-main digest/config/source/attestation identity. The runtime
manifest is generated, not manually edited: it requires distinct previous and
current source/digest/config identities, previous ancestry, byte-compatible
`configs` and `docker-compose.production.yml`, `linux/amd64`, `User=slicer`,
digest-only runtime, per-image attestations, and no registry write, mutable tag
or deploy.

Both manifest/config identities are freshly inspected. Each image's SLSA v1
and SPDX 2.3 attestations are verified through both GitHub API and OCI bundle
paths against exact signer workflow, source ref/SHA and GitHub OIDC issuer.
Only then are both immutable digests pulled, their shared positive non-root
UID/GID established, and the hardened I9 production-Compose/private-peer lane
run. It requires two readiness passes and Orca smoke for previous/current,
observes liveness-preserving `STORAGE_UNSAFE` after pricing state `0700 -> 0500`,
restores `0700`, automatically restores the exact previous digest under a new
container/PID, and repeats readiness/Orca proof.

The rehearsal workflow has global empty permissions; preflight has only
contents/actions read and the runtime job only contents/actions/packages/
attestations read. It has no registry write, OIDC, environment, deployment,
SSH/VPS or release authority.

GitHub evaluates a `workflow_run` file from the then-current default branch.
The downstream preflight therefore requires the published candidate to remain
an ancestor of current protected `main`, rather than requiring `main` still to
equal that candidate. It checks out and executes the candidate's own scripts,
policy and Compose inputs, and re-proves the immutable upstream artifact. A
later protected-main workflow-only change could nevertheless change the YAML
orchestration used for an older candidate; this is a documented repository
governance residual, not production readiness evidence.

Final status
`SIGNED_MAIN_CANDIDATE_EPHEMERAL_REHEARSAL_COMPLETE` requires exact verification,
runtime/evidence cleanup, bounded allowlisted upload, preserved remote digests
and `not_applicable_ephemeral_no_deploy`. Implementation and hosted result are
`PENDING` at this documentation boundary.

The productized workflow contract test is 346 physical lines. Its mutation and
final-aggregation lanes are already separate files; further behavior-neutral
decomposition is deferred until after hosted proof to avoid changing the
security-sensitive test oracle during release-chain integration.

## GitHub environment and permission contract

Environment `candidate-publication` is `LIVE_CONFIG_VERIFIED` on 2026-08-23:

```text
environment: candidate-publication
id: 20443404498
deployment_branch_policy:
  protected_branches: true
  custom_branch_policies: false
protection_rules: [branch_policy (id 63481958)]
reviewers: []
wait_timer_rule: absent
secrets: []
variables: []
deployments: []
```

The publication job must bind:

```yaml
environment:
  name: candidate-publication
  deployment: false
```

No reviewer or wait rule is configured. `Botond1` is the sole collaborator and
cannot self-approve; the empty reviewer set is a capability limit, not human
approval. `deployment: false` keeps the publication job from creating an
environment deployment record.

Permissions remain least privilege:

- workflow default: `contents: none`;
- preflight: `contents: read` only;
- publication: `contents: read`, `packages: write`, `attestations: write`, and
  `id-token: write` only;
- no deployment, repository-content write, pull-request write, SSH/VPS, release,
  settings or production permission.

## Evidence and final enforcement contract

The bounded I11 provenance record must use an I11 schema and exact allowlisted
keys. It must correlate repository, exact main ref/SHA, workflow run/job, local
image ID, manifest/config/digest/platform/source/User identity, SBOM and scanner
hashes, both attestation IDs and bundles, positive/negative verification, mode,
registry operation and cleanup.

Mode semantics are not interchangeable. Recovery must not claim an absent tag,
a pushed image or any registry write. New publication must not claim adoption of
an existing digest. Mutation tests must independently reject weakening of:

- manual-main-only event/ref/actor/repository/remote-HEAD identity;
- post-I10 ancestry and exact SHA equality;
- mode choice, confirmation and digest emptiness/format pairing;
- new-tag absence and ambiguous-registry failure;
- recovery manifest/config/exact-digest identity and no-push behavior;
- build-once/full-gate-before-login ordering;
- environment name, protected-main branch policy and `deployment: false`;
- successful-main-publication-only `workflow_run`, upstream API and exact single
  artifact identity;
- dynamic policy/provenance manifest, distinct digest/config/source identity,
  ancestry and configs/production-Compose compatibility;
- per-image API+OCI attestation verification and read-only permissions;
- hardened I9 phase order, `STORAGE_UNSAFE`, automatic exact-previous rollback,
  bounded rehearsal evidence and exact cleanup;
- job-local permissions and no-deploy surfaces;
- mode-aware evidence booleans and terminal classifications;
- exact cleanup, evidence upload boundary and final fail-closed aggregation.

The evidence writer may emit only
`I11_MAIN_CANDIDATE_EVIDENCE_READY`. Final enforcement may report
`I11_MAIN_SIGNED_CANDIDATE_COMPLETE` only after the exact immutable subject,
attestations, verification, evidence upload, publication cleanup and evidence
cleanup all succeed. A published but incomplete subject remains preserved and
is classified truthfully for exact recovery; it is never deleted or overwritten.

## Commit-time gate ledger

| Gate | Status at this document boundary |
| --- | --- |
| I11 implementation commit and exact SHA | `PENDING` |
| Focused contract/mutation tests | `PENDING` |
| Full JavaScript/Python tests | `PENDING` |
| Syntax, safety, mirror, diff and actionlint gates | `PENDING` |
| Exact-SHA Source Validation | `PENDING` |
| Exact-SHA Image Validation, SBOM and Grype | `PENDING` |
| `candidate-publication` environment creation/readback | `LIVE_CONFIG_VERIFIED` — ID `20443404498`, 2026-08-23 |
| Manual Candidate Publication | `PENDING` |
| Registry manifest/config digest | `PENDING` |
| SLSA/SPDX attestation IDs and verification | `PENDING` |
| Bounded I11 evidence artifact and exact cleanup | `PENDING` |
| Automatic signed-main ephemeral rehearsal and artifact | `PENDING` |
| Deployment/VPS/production topology | `NOT_RUN_NOT_AUTHORIZED` |

This documentation lane performs no commit, push, registry action, environment
or repository-setting mutation, workflow dispatch, deploy, VPS/SSH operation,
tag, release or cleanup outside its own files.
