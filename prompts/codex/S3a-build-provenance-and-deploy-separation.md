# GPT-5.6-sol execution prompt — S3a build provenance and deploy separation

You are the implementation agent for the standalone `3D-Printer-Slicer-API` repository. Work as a senior container supply-chain engineer, GitHub Actions security reviewer, release architect, and evidence-driven maintainer. This is one lane of a deliberately parallel wave. A separate S1a agent may change the upload/runtime lifecycle from the same baseline; respect the exclusive ownership boundary below.

## Objective

Create a repository-only S3a foundation without publishing or deploying anything:

1. remove the configured automatic `main`-push-to-VPS path and replace it with non-deploying candidate validation;
2. add an image-validation workflow that builds exactly once per run, performs a synthetic health smoke, produces an SBOM, scans the locally built image, records its content identity, and never pushes it;
3. pin every newly introduced GitHub Action to a verified full commit SHA and reduce workflow credentials;
4. inventory every remaining Docker/OS/Node/Python/native input with verified provenance and an honest immutable/floating classification;
5. harden Dockerfile/package-install inputs only when a real local Docker build, import/startup smoke, SBOM, and scan can prove the change;
6. leave actual production promotion, registry publishing/signing, Hostinger access, readiness/rollback drills, service auth, and private ingress/egress topology to S4 followed by S3b with separate explicit user/owner authorization.

This stage must make parallel development safer while the existing cloud service keeps running. A local commit that disables future automatic deployment does not touch the currently running VPS. Do not push it.

## Baseline and parallel isolation

- Expected code baseline: `aaf7e1db295e74498ce7efdd990343d741c6d635`.
- Start from the clean architect prompt commit on top of that baseline. Record its exact `WORK_BASELINE`.
- The only allowed paths in `CODE_BASELINE..WORK_BASELINE` are:
  - `prompts/codex/S1a-upload-workspace-and-multipart-limits.md`
  - `prompts/codex/S3a-build-provenance-and-deploy-separation.md`
- Treat the architect prompt checkout as read-only. Create a new, verified-absent linked worktree on branch `codex/s3a-build-provenance-foundation`, based exactly on `WORK_BASELINE`.
- Require an empty `git status --porcelain=v1 -uall`, exact root/remote/branch/HEAD, and exact two-path baseline diff before audit or editing.
- If preflight fails, stop. Never stash, reset, clean, overwrite, absorb, delete, or reuse unrelated work.
- Do not fetch/pull repository history, push, open a PR, tag, release, publish an image/artifact outside GitHub's ephemeral workflow artifact store, deploy, contact the VPS, call a remote application/slicer API, or modify LeadPilot.

Read-only network queries are allowed only to verify official upstream action tags/commits, OCI image digests, npm/PyPI metadata, Ubuntu/Node inputs, and vendor release checksums. Prefer primary official sources; record source URL, queried reference, time, and result. Never authenticate to a registry or external service.

## Mandatory reading and audit

Read completely before editing:

- root `AGENTS.md`, the three `docs/codex/**` knowledge files, and this prompt;
- all applicable root/folder-local `CLAUDE.md` and `.github/instructions/**` files;
- `Dockerfile`, `.dockerignore`, both Compose files, `.env.example`;
- `package.json`, `package-lock.json`, `requirements.txt`;
- every `.github/workflows/**` file;
- server startup, `/health`, `/health/detailed`, runtime path/config initialization, and slicer executable resolution;
- S0/S0.1 validation/test runners needed to reuse existing gates.

Inventory, with evidence:

- every `FROM` tag/digest and platform implication;
- Apt repositories, keys, package names/versions, cache behavior, and snapshot status;
- NodeSource and the actual Node/npm versions selected in each stage;
- direct and transitive Python requirements, wheel/sdist/platform markers, and hash state;
- Prusa/Orca URL, version, SHA-256, extraction, and runtime library boundary;
- every Action owner/repository/ref, workflow permission, secret, artifact, cache, and trigger;
- Docker build context exclusions, runtime user/ownership, writable paths, health semantics, and Compose tag use;
- current deploy behavior, mutable `git pull`, concurrent/cancel behavior, readiness limitations, and rollback absence.

Do not call the current image reproducible merely because the AppImages have checksums.

## Exclusive file ownership

This lane may edit only:

- `.github/workflows/**`;
- `Dockerfile` and `.dockerignore` when the conditional Docker gates permit;
- a new generated/verified Python lock input under a clearly named build-only path, and `requirements.txt`, only when the conditional Python/image gates permit;
- a uniquely named `tests/unit/js/s3a-workflow-contracts.test.js` (and no other test file);
- new lane evidence under `docs/codex/evidence/s3a-*.md`.

Do not edit `app/**`, `.env.example`, Compose, `package.json`, `package-lock.json`, existing validation scripts, profiles, pricing, root `AGENTS.md`, or the three canonical `docs/codex/{project-map,security-model,hardening-plan}.md` files. S1a owns the shared knowledge correction during this wave; the later integrator reconciles S3a evidence into canonical docs.

If a necessary change crosses this boundary, report it rather than editing the file. In particular, do not change manifests/lockfile to fix a new advisory. That requires a separate serialized `dependency-maintenance` checkpoint.

## Workstream A — eliminate automatic deployment without creating a new deployment path

The current `deploy.yml` runs on every `main` push and uses an SSH action plus mutable `git pull`/VPS rebuild. S3a must remove that automatic external side effect.

Refactor workflow topology so:

- `.github/workflows/ci.yml` remains validation-only for PRs, non-main pushes, and manual dispatch, and also becomes safely reusable through `workflow_call` without secrets or write permissions;
- a new image-validation workflow can run for PRs, non-main pushes, manual dispatch, and `workflow_call`;
- `.github/workflows/deploy.yml` has no `push` trigger, no schedule, no SSH action, no VPS secrets, no remote command, no registry login, and no deployment job;
- manual dispatch of `deploy.yml` acts only as a production-candidate preflight: it validates an explicitly supplied candidate commit SHA, calls the reusable source and image gates, and reports that promotion is intentionally unavailable pending S4 and S3b;
- candidate validation must not imply approval, readiness, rollback proof, or deployment;
- workflow names and summaries say clearly `NO DEPLOY`/`candidate validation` so an operator cannot mistake a green preflight for a release;
- top-level/job permissions are the minimum `contents: read`; checkout never persists credentials;
- concurrency may cancel superseded validation/build work, but no future production promotion design may inherit `cancel-in-progress: true` without an explicit decision.

Production promotion can be reintroduced only in S3b after S4 service-auth/private-topology evidence and a separate explicit human owner/user authorization. An architect or execution agent cannot grant that exception.

For reusable calls, define a required typed `candidate_sha` input and pass it through every source/image validation job. Accept only a full 40-character hexadecimal commit SHA—never a branch, tag, or general ref. Checkout that exact SHA, resolve `git rev-parse HEAD`, and fail unless it equals the requested value. Normal PR/push triggers may derive the candidate from their event SHA, but the resolved commit must still be recorded. A manual preflight must never accept an input while silently validating the workflow/default branch instead.

## Workstream B — build-once, no-push image validation

Add a dedicated workflow with one build job or an equally strong build-once artifact flow. It must:

- use only full 40-character Action commit SHAs whose tag-to-commit provenance you verified from the official upstream repository/API;
- check out without persisted credentials;
- use BuildKit/buildx and build the repository Dockerfile once for the target Linux platform;
- use checkout plus explicit path context `context: .`, not BuildKit's implicit Git context. Pass no build secrets, secret environment, SSH forwarding, or GitHub token into the build: set the build action's `github-token` input explicitly to an empty string, leave secret/SSH inputs absent, and contract-test all three boundaries;
- never use registry credentials, `push: true`, a mutable production tag, or a remote deployment action;
- load or export that exact local build once, then reuse it for all smoke/SBOM/scan steps rather than rebuilding;
- capture the local image ID and source commit in a small evidence file. Label the image ID accurately: it is not a portable OCI manifest digest, signature, attestation, or provenance statement;
- start a disposable container with an inert admin key, no customer model, no host runtime mounts, no privileged mode, no added capabilities, and no unnecessary host port exposure;
- wait with bounded retries for the existing healthcheck and label the result liveness/startup smoke, not production readiness;
- generate an SPDX or CycloneDX SBOM from the exact built image;
- scan the exact built image and fail on verified high/critical OS or language-package vulnerabilities; retain a sanitized machine-readable result as a short-lived workflow artifact;
- clean the exact container and local image in an `always()` path; never use a broad prune;
- set explicit timeouts and artifact retention; do not upload the full image or customer/runtime data.

If a scanner database/network service is unavailable, the job must fail or clearly distinguish an infrastructure error; it must not silently return green. Avoid unbounded cache restoration from untrusted forks. Do not expose GitHub tokens to container build steps beyond what read-only checkout intrinsically requires.

## Workstream C — workflow contract tests

Create one deterministic `node:test` file, dynamically discovered by the existing runner, that parses or safely inspects workflow text without adding a YAML dependency. It must fail if:

- any workflow regains `pull_request_target` or write permissions;
- checkout persists credentials;
- `deploy.yml` regains a `push`/schedule trigger, SSH/VPS secrets, remote commands, registry login, or an actual deploy step;
- candidate validation lacks the explicit no-deploy boundary;
- image validation permits `push: true`, registry credentials, privileged containers, broad prune, or unpinned Action tags;
- an Action `uses:` value in changed workflows is not a full SHA (local reusable workflows are the explicit exception);
- validation/audit/safety gates are omitted from reusable source validation;
- image cleanup is not guarded by an always-run condition.

Test positive current behavior plus controlled in-memory mutations for the critical prohibitions. Do not write mutated workflow files to the worktree.

Static tests are necessary but not sufficient evidence that hosted Actions actually work; preserve the `UNVERIFIED` label until a later authorized push/hosted run.

## Workstream D — conditional Dockerfile and Python supply-chain hardening

Do not edit the Dockerfile or Python dependency inputs unless a Docker daemon is available and every resulting build/runtime gate below can run.

When available, make the smallest evidence-backed improvements:

1. pin Ubuntu base references by verified OCI digest while retaining a human-readable version tag;
2. select exact npm 10.9.8 in the builder, assert it matches the repository's declared package manager, and run production `npm ci` with `--ignore-scripts --no-audit --no-fund` so the pre-existing Scarf lifecycle hook cannot execute during image build;
3. verify the exact Node 20 source/version and NodeSource key/repository boundary. Pin safely if official provenance and rebuild evidence permit it; otherwise record it as floating rather than inventing a checksum/version;
4. create a fully resolved, hash-checked Linux/CPython 3.12 Python dependency input only if all direct/transitive artifacts, platform markers, hashes, licenses, and import compatibility can be verified. Pin/verify the pip/setuptools/wheel bootstrap as part of the same chain, forbid unverified sdist/build-dependency execution (prefer verified wheels with `--only-binary=:all:` where compatible), and install with `--require-hashes`; do not hand-invent versions/hashes or add a resolver tool to runtime dependencies;
5. preserve the verified Prusa/Orca versions and SHA-256 checks unless official source evidence proves a required change; do not upgrade slicers in S3a;
6. do not take S2 ownership: root-owned/read-only application code, writable-state separation, Compose read-only root, PID/RAM/CPU limits, and profile mount redesign remain later work.

If any item cannot be proven, leave that runtime input unchanged and list it precisely in the evidence/next-stage section. A partial pin must not be described as full reproducibility.

## Provenance evidence document

Create one lane-owned evidence file under `docs/codex/evidence/` containing:

- baseline/commit and audit date;
- a table of every build/workflow input, current reference, verified source, immutable/floating status, and next action;
- exact full Action SHAs and the official tags/commits they were resolved from;
- image build ID/SBOM/scan/health evidence when run;
- Docker-unavailable and hosted-CI skips with precise status;
- explicit remaining risks: Apt/Node/Python floating inputs, Scarf lifecycle behavior, mutable Compose `latest`, root-writable code/config state, liveness-only health, lack of registry signature/provenance, and lack of S4/S3b promotion evidence.

Do not update canonical stage statuses from this parallel lane. The integrator will use this evidence after reconciling S1a.

## Required local integration order

This describes a later local integration branch, not authorization to merge or push `main`:

1. integrate the reviewed S1a commits first because S1a owns the canonical knowledge corrections;
2. integrate the single atomic S3a no-deploy/workflow/evidence commit next;
3. let the integrator create a separate canonical-doc reconciliation commit using the S3a evidence file;
4. rerun the complete combined syntax/test/audit/safety suite and, when available, the exact combined-tree Docker build/SBOM/scan/health gates;
5. do not push `main` or any production branch without a separate explicit user instruction. Any eventual main update must contain the automatic-deploy removal in the same resulting tree, never S1a alone under the legacy deploy trigger.

## Validation gates

Mandatory repository-only gates:

1. exact clean preflight and allowed two-prompt baseline diff;
2. focused workflow contract tests plus their in-memory adversarial mutations;
3. a trusted YAML/workflow syntax validation method that does not execute workflow code;
4. `git diff --check`;
5. complete tracked JS/Python syntax validation;
6. full JavaScript/Python suites and aggregate `npm test`;
7. tracked and non-empty staged repository-safety gates;
8. instruction-mirror consistency;
9. clean install with exact npm 10.9.8 and rerun of all gates;
10. production audit at moderate threshold remains green;
11. proof that changed workflows have only read permissions, no persisted credentials, no secrets/remote deploy path, and all external actions use verified full SHAs;
12. final stat/status review and clean post-commit worktree.

Conditional Docker gates, mandatory before any Dockerfile/requirements commit:

- `docker version` proves a daemon, not only a client;
- clean no-cache target-platform build from the final inputs;
- container startup and bounded `/health` smoke with inert configuration;
- Python imports for every direct requirement inside the final image;
- Node/npm exact-version assertion and proof lifecycle scripts did not run;
- Prusa/Orca executable version/help smoke without customer models;
- SBOM generation and exact-image high/critical scan;
- final image history/config/labels/user/entrypoint inspection;
- exact disposable-resource cleanup with no broad prune.

If Docker is unavailable, workflow/deploy-safety changes may be committed as a `CHECKPOINT_COMMITTED`, but Dockerfile/requirements must remain unchanged. The same safe checkpoint is allowed when Docker is available but an existing image vulnerability, scanner infrastructure error, or unresolved floating input makes build/scan evidence red: preserve the atomic no-deploy/workflow-safety commit, make no Dockerfile/requirements commit, and report `IMAGE_GATE_RED` with exact evidence. Hosted Actions cannot be called green without an authorized remote run, but that external skip alone does not prevent `COMPLETED` when every intended local Docker gate is available and green.

## Commit and stop policy

Use at most two atomic local commits:

1. `ci: disable automatic deploy and validate images` — atomically removes the `main` push/SSH/VPS path and adds the complete reusable source/image/candidate topology plus tests/evidence. There must be no earlier or partial commit that could be promoted while automatic deployment remains active.
2. `build: pin verified slicer image inputs` — optional and forbidden unless every conditional Docker gate is green; include the lane evidence update here or in commit 1 when no runtime build input changes.

Every commit requires staged diff/safety review. Do not amend, rebase, squash, push, open a PR, publish, or deploy.

Status meanings:

- `COMPLETED`: workflow safety plus every intended Docker/provenance change is verified by all local Docker gates; hosted CI and real promotion still remain unverified and unauthorized.
- `CHECKPOINT_COMMITTED`: the atomic repository-only no-deploy/workflow-safety commit is green, but Docker evidence is unavailable or `IMAGE_GATE_RED`; no unverified Dockerfile/requirements change was committed.
- `BLOCKED`: unsafe preflight or a mandatory repository-only gate is red; no unsafe commit.

## Required final report

Return exactly this structure in Hungarian:

```text
STATUS: COMPLETED | CHECKPOINT_COMMITTED | BLOCKED
CODE_BASELINE:
WORK_BASELINE:
BRANCH:
COMMITS:
MODIFIED_FILES:
DEPLOYMENT_SIDE_EFFECT_REMOVAL:
WORKFLOW_PERMISSION_AND_PIN_EVIDENCE:
IMAGE_BUILD_ONCE_DESIGN:
PROVENANCE_INVENTORY:
DOCKERFILE_DEPENDENCY_DECISIONS:
SBOM_AND_SCAN_EVIDENCE:
WORKFLOW_MUTATION_TESTS:
TESTS_AND_COUNTS:
DOCKER_EVIDENCE:
HOSTED_CI_STATUS:
CONTRACT_PRESERVATION_PROOF:
UNRUN_OR_BLOCKED_GATES:
KNOWN_REMAINING_RISKS:
INTEGRATION_NOTES_FOR_S1A:
S4_THEN_S3B_PREREQUISITES:
FORBIDDEN_SIDE_EFFECTS_CHECK:
```

The final forbidden-side-effects line must explicitly confirm: no push/PR/tag/release, no image publication/registry login, no VPS/SSH/deploy, no remote/production API or slicer call, no customer/private model, no real secret, no LeadPilot change, no `app/**`/manifest/lock/profile/pricing/runtime-artifact mutation, and no unrelated worktree damage. Report all disposable local Docker resources and exact cleanup separately.
