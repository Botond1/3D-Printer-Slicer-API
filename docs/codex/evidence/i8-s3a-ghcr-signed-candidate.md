# I8/S3a GHCR signed-candidate evidence

## Scope and current status

I8 starts exactly from
`c9ce6c5b3e8cf767563ab46a41b3c0e0e97ce2a6` on
`codex/i8-s3a-ghcr-signed-candidate`. Before I8-C1, local and remote HEAD are
`c49bfc698d4d41041e6216c76a11144ffb386183`, comprising
`fa45cf6 -> 79a07d4 -> 01055b8 -> c49bfc6`. Hosted Source run
`30163991878` and Image run `30163991870` are `SUCCESS`. Candidate
Publication is `NOT_RUN`. No registry, signature, or attestation side effect
exists.

The root cause is limited to GitHub event registration:
`workflow_dispatch` cannot start a workflow that is absent from the default
branch. I8-C1 resolves only that blocker by retaining the manual trigger for
future default-branch integration while adding a push trigger restricted to
the existing candidate branch. This is a pre-corrective-push checkpoint, not a
hosted-publication success claim.

I8-C1 authorizes exactly one corrective commit and one normal non-force push to
the existing branch. The corrective SHA, discovery tag, and three
push-triggered hosted runs do not exist yet and must not be inferred from the
pre-correction runs below.

Current classifications:

| Evidence | Classification |
| --- | --- |
| Committed/pushed pre-I8-C1 implementation | `CREATED`, local and remote `c49bfc698d4d41041e6216c76a11144ffb386183` |
| Focused/adapted I8-C1 and shared workflow tests | `VERIFIED_LOCAL`, 621/621 pass across 11 files with exact npm 10.9.8 |
| Pre-I8-C1 hosted Source Validation | `SUCCESS`, run `30163991878` |
| Pre-I8-C1 hosted Image Validation | `SUCCESS`, run `30163991870` |
| Candidate Publication at pre-correction SHA | `NOT_RUN` |
| I8-C1 trigger correction | `IMPLEMENTED_LOCAL`; accelerated focused/adapted lane and non-staged local gates green |
| Corrective commit and remaining push | `PENDING`; exactly one normal non-force branch push authorized |
| Corrective hosted Source/Image/Publication | `PENDING_NOT_RUN` |
| GHCR candidate digest | `NOT_CREATED` |
| GitHub/Sigstore signature | `NOT_CREATED` |
| Build-provenance attestation | `NOT_CREATED` |
| SPDX SBOM attestation | `NOT_CREATED` |
| Deployment | `NOT_RUN_NO_DEPLOY` |
| External topology / production readiness | `UNVERIFIED` |

## Exact I7 baseline evidence carried forward

- Baseline branch: `codex/i7-s3a-immutable-candidate-foundation`.
- Exact baseline:
  `c9ce6c5b3e8cf767563ab46a41b3c0e0e97ce2a6`.
- Hosted Source Validation run `30160486802`: `SUCCESS`.
- Hosted Image Validation run `30160486750`: `SUCCESS`.
- Evidence artifact: `8620145030`.
- Run-local image ID:
  `sha256:86866f649ea75f72bff0c0656f752c021e3461067b447a9e1eb49d57ab9387eb`.
- SBOM SHA-256:
  `a4ad4c9014c1288ce4dcfa199dd12e4a6589e208714f56fcc9f31b948709edc4`.
- I7 provenance SHA-256:
  `7b7dbfcf8798facd423465803d08f5030c5b060896e03a7e73869e51e10ff161`.
- I7 evidence records SPDX 2.3, Grype HIGH=0, CRITICAL=0, and known Swiper
  advisory=0.

The I7 image ID is a run-local config identity. It is not and must never be
used as an I8 registry manifest digest.

## Direct source and identity map

```text
authorized target-branch push
  -> exact repository/ref/actor/github.sha/final-trailer adapter
  -> canonical candidate SHA, image ref, discovery tag, and registry repository
  -> one loaded linux/amd64 local image
  -> complete shared identity/runtime/Orca/browser/abort/topology/SBOM/Grype gate
  -> GHCR login only after that gate
  -> one previously absent candidate-<full-source-sha> discovery tag
  -> exact registry manifest digest resolution and cross-check
  -> remove local build identity and pull by digest
  -> kernel identity/liveness/Orca/production-Compose round trip
  -> digest-bound SLSA provenance and SPDX SBOM attestations
  -> GitHub API, OCI, and local-bundle verification plus negative probes
  -> bounded I8 provenance v2 evidence
  -> exact local cleanup and fail-closed final aggregator
```

No graph output was created. The same-job path is intentional: build, complete
gate, push, and attestation must retain one image identity without uploading a
multi-GiB image tar. Therefore the exact-SHA candidate workflow is a reviewed
trust assumption.

## Trigger, confirmation, and permission contract

`candidate-publication.yml` retains `workflow_dispatch` with its existing
exact input contract:

- `candidate_sha`: exactly 40 lowercase hexadecimal characters;
- `confirmation`: exactly `PUBLISH_I8_SIGNED_GHCR_CANDIDATE`;
- `registry_repository`: fixed to
  `ghcr.io/botond1/3d-printer-slicer-api`.

I8-C1 also adds `push` with one literal branch:
`codex/i8-s3a-ghcr-signed-candidate`. It adds no wildcard branch, tag, PR,
schedule, release, `repository_dispatch`, or fallback event.

On `push`, preflight derives:

- `candidate_sha` from `github.sha`;
- exact ref `refs/heads/codex/i8-s3a-ghcr-signed-candidate`;
- exact repository `Botond1/3D-Printer-Slicer-API`;
- exact actor `Botond1`;
- hardcoded registry repository
  `ghcr.io/botond1/3d-printer-slicer-api`;
- authorization from the exact HEAD commit's last non-empty line:

```text
I8-Publication: PUBLISH_I8_SIGNED_GHCR_CANDIDATE
```

The workflow does not use `contains()`, substring/prefix matching, author name
or email, input-selected push registry, a branch wildcard, or a default
confirmation. `workflow_dispatch` and `push` are separate cases; every other
event fails closed. Both cases produce the canonical `candidate_sha`,
`image_ref`, `discovery_tag`, and `registry_repository` outputs.

Shared preflight requires exact repository/ref, event SHA identity, remote
branch HEAD equality, and baseline ancestry. Push additionally requires exact
actor and trailer. Checkout is detached to the exact SHA and does not persist
credentials. Concurrency is candidate-SHA scoped and does not cancel an
in-progress publication.

| Boundary | Permissions |
| --- | --- |
| Workflow default | `contents: none` |
| Publication preflight | `contents: read` |
| Normal Image Validation | `contents: read` |
| Publication job only | `contents: read`, `packages: write`, `attestations: write`, `id-token: write` |

There is no PR, tag, release, schedule, deployment, wildcard, reusable, or
repository-dispatch publication trigger.

## Build-once and prepublication gate

`.github/actions/exact-image-gate/action.yml` is the common gate implementation.
Normal Image Validation uses `retain-image: false` and
`publish-mode: false`; Candidate Publication uses `retain-image: true` and
`publish-mode: true`. Both build exactly once with `load: true`,
`push: false`, and platform `linux/amd64`.

Before GHCR authentication, the shared gate requires source/build identity,
configured `USER=slicer`, nonzero kernel UID/GID, startup health, authenticated
Prusa and Orca/browser smoke, live abort with no released artifact, private
peer ingress, no host port/default route, API and native egress denial,
SPDX 2.3 generation, Grype HIGH=0/CRITICAL=0/known-Swiper=0, bounded evidence,
and run-owned cleanup preconditions.

The normal Image Validation workflow remains read-only and never pushes or
attests.

## GHCR identity and digest-only consumption

The only allowed repository is
`ghcr.io/botond1/3d-printer-slicer-api`. The only allowed tag shape is
`candidate-<full-lowercase-source-sha>`. The workflow authenticates only after
the complete gate and refuses publication unless authenticated registry
inspection proves that discovery tag is absent.

After pushing the same gated local image, it resolves a distinct
`sha256:<64 lowercase hex>` registry manifest digest. It compares the tag and
digest raw manifests, requires a direct single `linux/amd64` manifest,
correlates its config digest to the original local image ID, and checks exact
source/revision/title/description labels plus `USER=slicer`.

It then removes the local tag/build identity, pulls only
`ghcr.io/botond1/3d-printer-slicer-api@sha256:...`, requires the pulled config
identity to equal the gated build, and re-runs kernel UID/GID, liveness, Orca,
and production-Compose digest validation. A final tag lookup must still point
to the verified digest.

The discovery tag is not a consumption contract. Every downstream stage must
use only:

```text
ghcr.io/botond1/3d-printer-slicer-api@sha256:<64 lowercase hex>
```

No `latest`, branch, semver, release, staging, or production tag is permitted.

## Signed attestations and verification

The publication job pins `actions/attest` to exact commit
`f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6`. It proposes two distinct
attestations with untagged subject name
`ghcr.io/botond1/3d-printer-slicer-api`, the exact resolved registry digest,
and `push-to-registry: true`:

1. build provenance with predicate `https://slsa.dev/provenance/v1`;
2. the exact full-gate SPDX JSON SBOM with predicate
   `https://spdx.dev/Document/v2.3`.

Both calls set `create-storage-record: false`. In pinned `actions/attest`
v4.2.0 this disables only the separate Artifact Metadata Storage Record API;
the action still uploads the signed attestation to the GitHub attestations API
before attaching it to the OCI subject. This preserves the required GitHub API
and OCI verification paths without adding `artifact-metadata: write`.

Positive verification requires all three paths for each predicate:

- GitHub attestation API;
- the OCI-attached bundle;
- the local action-produced bundle.

All paths constrain the exact repository, signer workflow, ref, source digest,
subject digest, and predicate. Separate wrong-digest and wrong-repository
probes must fail. An attestation ID or HTTP success alone is insufficient.

No attestation has been created or cryptographically verified before the
authorized corrective push.

## I8 provenance v2 and evidence boundary

`scripts/i8-publication-evidence.js` defines exact-key schema
`i8-s3a-signed-candidate-provenance-v2`.
`scripts/i8-write-publication-evidence.js` independently recomputes repository,
SBOM, scanner, workflow, and outcome correlations before exclusive creation of
`i8-candidate-provenance.json`.

The record correlates source/run/job, run-local image ID, repository, discovery
tag, registry manifest/config digests, Dockerfile/package/lock/SBOM/scan
hashes, runtime/topology/abort gates, digest round trip, both attestation
identities and bundle hashes, signature verification, publication status,
bounded upload, cleanup, and no-deploy result.

Only these hosted files may be uploaded:

- `i8-candidate-provenance.json`;
- `image-identity.txt`;
- `runtime-diagnostics.json`;
- `topology-evidence.json`;
- `sbom.spdx.json`;
- `grype.json`.

Raw attestation bundles, verification output, tokens, certificate dumps,
environment dumps, and push logs are excluded and removed.

## Failure and partial-publication semantics

- Failure before a matching remote push:
  `BLOCKED_I8_PREPUBLICATION_GATE`; no intended registry side effect.
- Matching image published but either attestation incomplete:
  `I8_CANDIDATE_PUBLISHED_UNATTESTED`.
- Attestations created but positive or negative verification incomplete:
  `I8_CANDIDATE_ATTESTATION_UNVERIFIED`.
- Other post-publication evidence, identity, or cleanup failure:
  `I8_PUBLICATION_INFRASTRUCTURE_FAILURE`.
- Success only after every gate:
  `I8_SIGNED_CANDIDATE_COMPLETE`.

After any observed matching push, the exact remote digest is preserved. The
workflow never overwrites or deletes it, creates a mutable promotion tag, or
deploys it.

## I8-C1 accelerated local validation

Command:

```text
npx.cmd --yes npm@10.9.8 exec -- node --test tests/unit/js/i8-candidate-publication-contract.test.js tests/unit/js/i8-provenance-evidence-contract.test.js tests/unit/js/i8-provenance-writer-contract.test.js tests/unit/js/i3-workflow-contracts.test.js tests/unit/js/i4-image-runtime-envelope-contracts.test.js tests/unit/js/i6-topology-workflow-mutations.test.js tests/unit/js/s3a-i8-publication-trigger-contract.test.js tests/unit/js/s3a-image-liveness-enforcement.test.js tests/unit/js/s3a-image-runtime-ownership.test.js tests/unit/js/s3a-orca-runtime-smoke.test.js tests/unit/js/s3a-workflow-contracts.test.js
```

Result: exact npm 10.9.8; 621 tests, 621 pass, 0 fail, 0 skipped across
11 files, including
`tests/unit/js/s3a-i8-publication-trigger-contract.test.js`.

The 621-test I8-C1 mutation coverage includes
trigger/branch/baseline/repository/confirmation,
permission broadening, persistent checkout credentials, floating attest
action, pre-gate login/push, second build, mutable/short/uppercase tags,
malformed/short/uppercase/local-ID/tag digests, overwrite, different-build
config, SBOM mismatch, wrong/unsigned predicates, tag subjects, wrong
workflow/ref/source, missing GitHub/OCI/offline/negative verification,
unbounded bundle upload, evidence-boundary bypass, incomplete cleanup, missing
partial classifications, and missing final aggregator.

I8-C1 includes focused contract and mutation expectations for an exact literal push
branch, alternate branch, actor mismatch/removal, missing/non-exact/substr/
`contains()` trailer confirmation, alternate registry, SHA-input substitution
for `github.sha`, event fallback, lost `workflow_dispatch`, write-permission
broadening, publication-before-gate, second build, mutable tag, and weakened
final aggregation.

Broader local validation:

- exact npm 10.9.8 lockfile install: pass;
- tracked syntax: 163 JavaScript files and 32 Python files pass with Python
  3.12.13;
- aggregate tests: 1,112/1,112 JavaScript pass; Python discovered/run 43,
  passed 42, failed 0, errors 0, skipped 1 because the POSIX permission
  mutation is not executable on Windows;
- production dependency audit: 0 vulnerabilities at moderate threshold;
- tracked repository safety: 294 indexed files pass; a temporary isolated
  index also validates all 26 proposed changed/new files;
- base, development-overlay, and production Compose parsing: pass;
- the three changed action/workflow YAML files parse with `yaml` 2.8.1;
- all repository workflows pass `actionlint` 1.7.7, including its embedded
  ShellCheck checks; the validation image was removed afterward;
- documentation relative-link checks pass for all 11 touched documents;
  instruction-mirror tests pass 2/2.

Proportional local Docker validation performed one `linux/amd64`, pull,
no-cache, loaded build with implicit provenance/SBOM disabled and the exact
four proposed OCI labels. The transient worktree image ID was
`sha256:ac919e5c3ee80bd31645e4df8e033c8899f6e0fd32ffdc90316bac1a849f85dd`.
The exact image resolved configured `USER=slicer`, kernel UID/GID inputs
999/999, passed bounded Orca CLI help plus synthetic slicing, and left no
validation container, tag, image ID, or temporary output. This was local
refactor validation, not a final candidate digest or hosted publication proof.

Final I8-C1 staged safety, post-commit exact-range whitespace, and
worktree-isolation results belong in the integrator report. Working-tree
diff/whitespace and actionlint are green. The pre-correction Source and Image
runs are green; corrective Source/Image/Publication results remain not run.

## Read-only external observations and no-deploy boundary

At preflight, branch protection returned HTTP 404, repository rulesets were
empty, and no environments existed. These are observations, not a policy
change or a production-readiness claim.

I8 does not authorize or perform a PR, merge, release, Git tag, deployment,
SSH/VPS, proxy, firewall, secret, environment, ruleset, branch-protection,
package-setting, registry-delete, or mutable-promotion operation. External
caller/proxy/firewall/egress/secret topology and deployed digest remain
`UNVERIFIED`; production readiness remains `UNVERIFIED`.

The I8-C1 authorization permits one corrective commit and one normal non-force
push to the existing candidate branch. It does not permit a `main` push, PR,
merge, force-push, second corrective push, release, Git tag, mutable image tag,
deployment, SSH/VPS operation, registry overwrite/delete, or repository/
environment/secret/branch-policy setting change.

The corrective push must automatically trigger Source Validation, Image
Validation, and Candidate Publication. Until all three exact-SHA runs and every
publication/attestation/evidence/cleanup gate are green, no hosted publication
or signing success claim is valid.
