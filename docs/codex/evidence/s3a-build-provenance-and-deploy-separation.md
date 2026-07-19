# S3a build provenance and deploy-separation evidence

## Scope and result

- Audit date: `2026-07-19` (`Europe/Budapest`).
- Upstream-reference audit recorded at: `2026-07-19T02:46:52+02:00`.
- `CODE_BASELINE`: `aaf7e1db295e74498ce7efdd990343d741c6d635`.
- `WORK_BASELINE`: `c3f1a06bd1ed48b80e3bb825e21ac6455bf1218d`.
- Implementation branch: `codex/s3a-build-provenance-foundation`.
- Implementation commit: the commit containing this document is authoritative. A commit cannot safely contain its own Git object ID, so the final execution report records that ID.
- Expected status: `CHECKPOINT_COMMITTED` when every repository-only gate is green. Docker-dependent gates were unavailable, so this lane makes no Dockerfile or dependency-input claim.

The configured `main`-push-to-SSH/VPS deployment path is removed atomically with reusable source validation, build-once image validation, manual candidate preflight, contract tests, and this evidence. The replacement workflows contain no deployment, publication, registry-login, SSH, VPS, or remote-application path. A green manual preflight means only that its source and image validation jobs succeeded; it is not approval, production readiness, rollback evidence, promotion, or deployment.

## Candidate and no-deploy topology

The reusable source and image workflows accept a required full 40-character commit SHA when called or manually dispatched. PR and non-`main` push runs use the event's full `github.sha`. The resolver checks whether the `inputs` context actually contains `candidate_sha`; if it does, even an empty value is preserved and rejected rather than falling back. Only direct PR/push events without that input key use the event SHA. Each gate validates the lowercase SHA syntax through environment variables, checks out the resolved exact ref with credentials disabled, and proves `git rev-parse HEAD` equals the requested candidate.

The manual `deploy.yml` definition itself comes from the ref on which an operator dispatches it. Its two called gates then inspect the explicitly requested candidate checkout. Source validation runs `tests/unit/js/s3a-workflow-contracts.test.js` as a focused, fail-closed gate before the aggregate suite; therefore a candidate predating the S3a contract file cannot silently pass with fewer workflow-safety tests.

The image workflow has exactly one Dockerfile build action. It uses explicit path context `.`, targets `linux/amd64`, loads one SHA-tagged local image, and never pushes. The same local image reference is used for identity inspection, an isolated liveness-only container smoke, Syft SBOM generation, and Grype scanning. Its local Docker image ID is explicitly described as local identity only—not a portable OCI manifest digest, signature, attestation, or provenance statement.

The disposable container has no host port, bind mount, customer model, privileged mode, added capability, or external network. It receives only a run-scoped inert admin value, drops all capabilities, enables `no-new-privileges`, and uses isolated tmpfs runtime input/output paths. The existing Docker `HEALTHCHECK` is bounded to 240 seconds and is labeled startup/liveness evidence only. Cleanup runs under `always()` and removes only the run's exact container and exact local tag; no broad prune exists.

The scanner action is allowed to return control so an explicit enforcement step can distinguish scanner/action/output failure (`scanner infrastructure failure`) from parsed high/critical findings (`vulnerability gate failure`). Missing, empty, malformed, or structurally invalid Grype JSON fails closed. Candidate-controlled Syft/Grype auto-configuration is disabled by workflow-created empty configs under an exact run-scoped `runner.temp` directory. Identity, SPDX JSON, and Grype JSON are uploaded only after regular-file, non-symlink, realpath, size, JSON-structure, and identity-allowlist checks; retention is seven days and the image is never uploaded. The exact temp files/directory are removed after upload.

## Verified workflow inputs

All tag-to-commit resolutions below were queried read-only with `git ls-remote` against the named official repository during the recorded audit window. Changed workflow `uses:` values contain the verified 40-character commit, with local reusable workflow paths as the only exception.

| Input | Workflow reference | Official source and queried ref | Verified result | Classification / next action |
|---|---|---|---|---|
| Checkout | `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683` | `https://github.com/actions/checkout.git`, `refs/tags/v4.2.2` | `11bd71901bbe5b1630ceea73d27597364c9af683` | Immutable action commit; checkout credentials explicitly disabled. |
| Node setup | `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` | `https://github.com/actions/setup-node.git`, `refs/tags/v4.4.0` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | Immutable action commit; requested Node `20` still floats within that major. |
| Python setup | `actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065` | `https://github.com/actions/setup-python.git`, `refs/tags/v5.6.0` | `a26af69be951a213d495a4c3e4e4022e16d87065` | Immutable action commit; requested Python `3.12` still floats within that minor. |
| Artifact upload | `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` | `https://github.com/actions/upload-artifact.git`, `refs/tags/v4.6.2` | `ea165f8d65b6e75b540449e92b4886f43607fa02` | Immutable action commit; GitHub artifact service is external runner infrastructure. |
| Buildx setup | `docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` | `https://github.com/docker/setup-buildx-action.git`, `refs/tags/v3.12.0` | `8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` | Immutable action commit. |
| Build action | `docker/build-push-action@263435318d21b8e681c14492fe198d362a7d2c83` | `https://github.com/docker/build-push-action.git`, `refs/tags/v6.18.0` | `263435318d21b8e681c14492fe198d362a7d2c83` | Immutable action commit; explicit local load and `push: false`. |
| SBOM action | `anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610` | `https://github.com/anchore/sbom-action.git`, `refs/tags/v0.24.0` | `e22c389904149dbc22b58101806040fa8d37a610` | Immutable action commit; automatic artifact/release/dependency-snapshot side effects disabled. |
| Scan action | `anchore/scan-action@e1165082ffb1fe366ebaf02d8526e7c4989ea9d2` | `https://github.com/anchore/scan-action.git`, `refs/tags/v7.4.0` | `e1165082ffb1fe366ebaf02d8526e7c4989ea9d2` | Immutable action commit; result enforcement is separate and fail-closed. |
| Buildx binary | `v0.35.0` | `https://github.com/docker/buildx.git`, `refs/tags/v0.35.0` | Tag commit `151a92201622eeb80e19bdd9681af2266772875f` | Version-selected, but downloaded release bytes were not independently checksum-bound by this lane and are not classified immutable. The setup action has no GitHub-token input, binary cache publication is disabled, and its exact builder is post-run cleanup. BuildKit driver image remains implicit/floating. |
| Syft binary | `v1.44.0` | `https://github.com/anchore/syft.git`, `refs/tags/v1.44.0` | Tag commit `841cd08bca4a32482543bb55cc97c0950f541581` | Version-selected inside an immutable action, but release bytes were not independently checksum-bound and remain a mutable distribution boundary. No local SBOM was possible. |
| Grype binary | `v0.110.0` | `https://github.com/anchore/grype.git`, `refs/tags/v0.110.0` | Tag commit `1be6fd4022d3450b77d4cb2ff25f0031c1c2b4ce` | Version-selected inside an immutable action, but release bytes were not independently checksum-bound and remain a mutable distribution boundary. The vulnerability DB is necessarily time-varying and cache is disabled. |
| Local reusable source gate | `./.github/workflows/ci.yml` | Candidate repository content | Exact local path | Candidate-bound, but not an external action SHA; intentional policy exception. |
| Local reusable image gate | `./.github/workflows/image-validation.yml` | Candidate repository content | Exact local path | Candidate-bound, but not an external action SHA; intentional policy exception. |

Other workflow inputs and boundaries:

| Input / boundary | Current reference | Classification / evidence |
|---|---|---|
| GitHub-hosted runner | `ubuntu-latest` | Floating runner image and preinstalled toolchain. Hosted execution remains required evidence. |
| Candidate source | Required lowercase 40-hex commit; event SHA for PR/non-main push | Immutable Git object after exact checkout and `rev-parse` equality proof. |
| Node validation runtime | Node `20` | Major pinned only; floating patch/minor. Exact npm is installed separately. |
| npm validation runtime | `npm@10.9.8` | Exact package version, installed with lifecycle scripts/audit/funding disabled and version asserted. Registry delivery remains an external network input. |
| Python validation runtime | Python `3.12` | Minor pinned only; floating patch. No repository Python packages are installed for syntax/unit gates. |
| Docker target | `linux/amd64` | Explicit because both slicer AppImages are x64 assets. Single-platform local Docker image ID is still not registry provenance. |
| Build context | Explicit `context: .` plus repository `.dockerignore` | Candidate tree is the source. No implicit BuildKit Git context and no build GitHub token. Secret and SSH build inputs are absent. |
| Build output | `local/slicer-api-validation:<candidate SHA>`, `load: true`, `push: false` | Run-local tag only; never a production/mutable registry tag. |
| Build cache | `no-cache: true`, `pull: true`; fresh run-scoped Buildx builder; no cache export | Prevents reuse of layer cache and pulls current base metadata, but does **not** disable Dockerfile `RUN --mount=type=cache` mounts. The workflow publishes no cache and setup cleanup removes its builder, so cross-run reuse is not intended on the ephemeral hosted runner. Same-build mutable cache mounts remain unpinned. |
| BuildKit driver | setup-buildx default driver/driver image | Floating external execution input. Pin a verified BuildKit image digest in a later, Docker-tested checkpoint. |
| Build provenance/SBOM flags | Build action `provenance: false`, `sbom: false` | BuildKit attestations are deliberately not asserted for a no-push local image; a separate exact-image Syft SBOM is created. |
| Build credentials | `github-token: ''`; no secret, secret-env, secret-file, or SSH input | No build credential channel. Checkout also uses `persist-credentials: false`. |
| Runtime smoke value | Generated inert admin value scoped to run/attempt | Non-production, not read from a secret store, not persisted in evidence. |
| Runtime isolation | `--network none`, no host port/mount, `--cap-drop ALL`, `no-new-privileges`, PID bound, tmpfs input/output | Synthetic local startup/liveness only; no customer/private input. Root filesystem and app/config writeability are unchanged S2 scope. |
| SBOM | SPDX JSON from the exact local image with explicit workflow-owned empty Syft config in `runner.temp` | Workflow-defined; candidate `.syft.yaml` auto-detection is disabled. No local result because Docker daemon was unavailable. |
| Vulnerability source | Grype DB fetched at workflow runtime; explicit workflow-owned empty Grype config in `runner.temp` | Floating by security necessity. Candidate `.grype.yaml` auto-detection is disabled. The report identifies the observed DB/result; infrastructure failure cannot be green. |
| Evidence artifact | Exact regular identity text + SPDX JSON + Grype JSON files from unique `runner.temp`, retention `7` days | Upload is gated by non-symlink/realpath/size/structure/identity validation; ephemeral GitHub workflow artifact only; no image publication. Exact temp cleanup follows upload. |

## Container and dependency input inventory

No item in this section was modified. The Docker daemon gate was unavailable, so the inventory intentionally distinguishes repository checksums and lock integrity from end-to-end verified provenance.

| Build input | Current reference | Verified source / observation | Immutable or floating | Required next action |
|---|---|---|---|---|
| Base image, all three stages | `ubuntu:24.04`, no digest and no `--platform` in Dockerfile | Official `docker.io/library/ubuntu:24.04`; read-only audit observation: index digest `sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90`, `linux/amd64` manifest `sha256:52df9b1ee71626e0088f7d400d5c6b5f7bb916f8f0c82b474289a4ece6cf3faf`, observed `2026-07-19`; no pull occurred | Floating Dockerfile tag. Observed digest does not bind future builds. | Pin a verified version-plus-digest only in a Docker-green checkpoint, then rebuild/import/smoke/SBOM/scan/history-test. |
| Ubuntu package repositories | Sources embedded in the selected Ubuntu image | Ubuntu archive metadata resolved live by `apt-get update`; no snapshot URI or Release-file digest is stored | Floating, including all transitive packages | Use a verified snapshot/provenance plan in a separately Docker-tested dependency checkpoint. |
| BuildKit cache mounts | Apt `/var/cache/apt` and `/var/lib/apt` with `sharing=locked` in all stages; pip `/root/.cache/pip`; npm `/root/.npm` | Dockerfile cache-mount declarations; no explicit immutable cache ID/content/export | Mutable during the one build. Apt paths can be reused across stages inside the same builder; `no-cache` does not turn these mounts off. Fresh hosted runner + fresh builder + no export means cross-run reuse is not intended, but contents are not provenance-pinned. | Treat all resolved package bytes/metadata as live inputs; later reproducibility work must bind them or use verified snapshots/artifacts. |
| Builder Apt packages | `ca-certificates`, `curl`, `gnupg`, `python3`, `python3-venv` | Package names only; versions/transitives selected live | Floating | Resolve and record exact package graph only with repeatable Docker evidence. |
| Slicer-stage Apt packages | `ca-certificates`, `wget` | Package names only; versions/transitives selected live | Floating | Same as above. |
| Runtime Apt packages | `ca-certificates`, `curl`, `gnupg`, `python3`, `libglu1-mesa`, `libgtk-3-0`, `libegl1`, `libwebkit2gtk-4.1-0`, `libgomp1`, `libosmesa6`, `libxft2`, `libxinerama1`, then NodeSource `nodejs` | Package names only; versions/transitives selected live; `curl`/`gnupg` are later purged | Floating | Same as above; native slicer compatibility must be retested. |
| NodeSource signing key | `https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key`, fetched twice | HTTPS URL in Dockerfile; no expected fingerprint/checksum assertion | Floating trust/bootstrap boundary | Verify official key fingerprint and repository metadata before pinning; do not invent a checksum. |
| NodeSource repository | `https://deb.nodesource.com/node_20.x nodistro main`, configured twice | Live NodeSource channel; no snapshot | Floating | Verify and assert an exact Node 20 build only with successful image gates. |
| Builder Node/npm | Live NodeSource `nodejs`; bundled npm runs production install | `packageManager` declares npm `10.9.8`, but Dockerfile neither installs nor asserts it | Floating and currently weaker than source CI | Docker-green follow-up should install/assert npm 10.9.8 and add `--ignore-scripts`. |
| Runtime Node | Live NodeSource `nodejs`; npm/npx/corepack removed afterward | Major channel only; exact selected package not recorded | Floating | Record exact package/version and native runtime proof in Docker-green follow-up. |
| Node manifest/lock | `package.json` plus lockfile v3, 176 package entries (175 non-root) | All 175 non-root lock entries include registry `resolved` and `integrity`; direct resolved versions: `archiver 7.0.1`, `cors 2.8.6`, `dotenv 17.3.1`, `express 4.22.2`, `helmet 8.1.0`, `multer 2.2.0`, `swagger-ui-express 5.0.1`, `yauzl 3.3.0` | Artifact bytes are integrity-bound by the lock, while registry availability and install tooling remain external. | Preserve lock. Dependency changes require the serialized dependency-maintenance lane. |
| Node lifecycle behavior | Dockerfile runs `npm ci --omit=dev --no-audit --no-fund` without `--ignore-scripts` | Lock graph contains the `@scarf/scarf@1.4.0` install script through `swagger-ui-dist`; source CI uses `--ignore-scripts` | Existing image build can execute lifecycle code | Add `--ignore-scripts` only with the mandatory Docker rebuild and runtime gates. |
| Node license metadata | Lockfile package metadata | `busboy@1.6.0` and `streamsearch@1.1.0` have no lockfile license field | Incomplete inventory metadata | Resolve through an SBOM/license review, not a manifest edit in S3a. |
| Python bootstrap | `python3 -m venv`; unversioned `pip install --upgrade pip setuptools wheel` | Live PyPI resolution, no versions/hashes, build tooling retained in final copied venv | Floating and executable supply-chain input | Resolve exact compatible wheel artifacts, licenses, and hashes before any change. |
| Python direct requirements | `trimesh`, `numpy`, `numpy-stl`, `scipy`, `lxml`, `networkx`, `gmsh` | Seven unversioned, unhashed, markerless requirements; live PyPI resolution | Floating direct and transitive graph; wheel/sdist choice and build dependencies are unresolved | Produce a Linux/CPython 3.12 wheel-only, fully hashed, license-reviewed graph and prove imports/native loading before commit. |
| PrusaSlicer asset | Version `2.8.1`; official GitHub release URL in Dockerfile; repository SHA-256 `565f2f4bd4dbb05904a459d54db1916b6932124709c1d17b5aacfe9f5f2f1b03` | `https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/...AppImage`; Dockerfile verifies downloaded bytes before executing extraction | URL/version plus repository checksum bind bytes, but upstream signature/provenance was not independently established in this lane; build args are overridable | Preserve version/checksum. Re-verify vendor evidence and extraction in Docker-green follow-up; do not upgrade in S3a. |
| OrcaSlicer asset | Version `2.3.1`; official GitHub release URL in Dockerfile; repository SHA-256 `f199e5408914efdbbbfa4fd6752cd6ad4727209b488bc47bff9a0da5f053a701` | `https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.3.1/...AppImage`; Dockerfile verifies downloaded bytes before executing extraction | Same boundary as Prusa; x64 Ubuntu 24.04 asset | Preserve version/checksum and prove native startup in Docker-green follow-up. |
| Slicer extraction | Both verified-by-repository-checksum AppImages run as root with `--appimage-extract` | Dockerfile behavior | Deterministic only for identical input bytes and base/runtime tools; not independently reproduced in this lane | Treat downloaded executable extraction as a privileged build-time boundary in later provenance work. |
| Repository application inputs | `app/`, `configs/`, `package.json`, `package-lock.json` copied from exact candidate | Exact Git candidate after checkout | Candidate content-addressed by commit, subject to context exclusions and ignored local files | Hosted clean checkout is required. Do not claim a generic local context is clean. |
| `.dockerignore` context | Current baseline file | Excludes known runtime/output and secret patterns, but does not generally exclude `input/`, `configs/pricing.json`, `docs/`, `prompts/`, root agent documents, or `scripts/` | Context policy is incomplete | `configs/pricing.json` is Git-ignored yet copied by `COPY configs/`; a dirty local build could bake private/mutable pricing state. Fix only with Docker-green evidence in the owning lane. Other listed paths reach BuildKit even when not copied. |
| Runtime identity/ownership | `USER slicer`; application/config copies use `--chown=slicer:slicer` | Dockerfile | Non-root process, but application/config/home/root filesystem remain writable to the runtime user | Root-owned/read-only code, explicit writable-state separation, and read-only root are S2 ownership. |
| Docker health | HTTP `GET /health` from inside the container | Source route returns status and uptime only | Liveness/startup signal, not readiness; `/health/detailed` also does not execute Prusa/Orca | Add readiness/native executable checks only in the authorized later stage. |
| Compose API image | `3d-psa:latest` | Local/mutable Compose tag | Floating mutable tag; not used by S3a workflow | S4 then S3b must define immutable registry promotion and deployment identity. |
| Compose monitoring image | `louislam/uptime-kuma:1` | Public mutable major tag | Floating | Pin and validate in the owning Compose/deployment stage. |

## Local validator provenance

Workflow YAML was validated without executing it using `actionlint` v1.7.12 from the official release:

- release API/source: `https://api.github.com/repos/rhysd/actionlint/releases/latest` and `https://github.com/rhysd/actionlint/releases/tag/v1.7.12`;
- downloaded asset: `actionlint_1.7.12_windows_amd64.zip`;
- official checksum file: `actionlint_1.7.12_checksums.txt`;
- expected and observed archive SHA-256: `6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9`;
- extracted executable SHA-256: `54ca21be3de4c7cfa26914aa8b61bd76bf573ef3caac5f80d110558cdf241718`;
- reported binary: `actionlint 1.7.12`, Windows/amd64, built with Go 1.26.1;
- location: temporary `C:\tmp` audit directory only; no validator binary is committed.

This gate proves GitHub Actions workflow schema/expression structure as understood by actionlint; it does not prove hosted runner execution or availability of external actions/services.

## Repository-only validation evidence

The final staged five-file candidate was validated locally with these results:

- exact package manager: Corepack selected `npm 10.9.8`; clean `npm ci --ignore-scripts --no-audit --no-fund` installed 175 lockfile packages and changed no manifest/lock input;
- trusted workflow syntax: checksum-verified actionlint v1.7.12 accepted all three workflow files;
- whitespace: `git diff --check` and `git diff --cached --check` passed;
- syntax: 49 tracked JavaScript files and 25 tracked Python files passed the repository syntax runners;
- focused workflow contract: 146/146 positive and in-memory adversarial mutation tests passed;
- aggregate suites: JavaScript 209/209 and Python 22/22 passed (231 total, zero skipped);
- instruction mirrors: 2/2 agent/skill mirror tests passed;
- repository safety: 151 tracked indexed files and the non-empty five-file staged scope passed;
- production dependency audit: exact npm 10.9.8 reported zero vulnerabilities at the moderate threshold.

The workflow-contract suite rejects unsupported YAML structural forms instead of silently ignoring them, asserts that every mutation actually changed the in-memory source, and never writes a mutated workflow to the worktree. These local results do not upgrade hosted image execution from `UNVERIFIED`.

## Docker and hosted-CI evidence

Docker client inspection at `2026-07-19T02:44:26+02:00` reported client `29.6.1`, Buildx `v0.35.0-desktop.2`, Compose `v5.1.4`, and no server. The named-pipe connection failed because `//./pipe/docker_engine` did not exist. No container, image, volume, network, builder, registry login, pull, or build was created. The read-only `buildx imagetools inspect` registry metadata query above did not pull an image.

Consequently these mandatory conditional gates were **not run**:

- Docker build and local image import;
- container startup and bounded health/liveness smoke;
- Python imports inside the final image;
- Prusa/Orca native executable startup checks;
- exact-image SPDX SBOM generation;
- exact-image high/critical vulnerability scan;
- Docker history, layer, ownership, and architecture assertions;
- post-run Docker resource cleanup (there were no run-created Docker resources).

Per the S3a gate, `Dockerfile`, `.dockerignore`, and `requirements.txt` therefore remain byte-identical to `WORK_BASELINE`. Baseline SHA-256 values used for the final preservation check are:

| Preserved file | SHA-256 |
|---|---|
| `Dockerfile` | `fffb30450c3c00f17872ff668f191c9deb19d0b889d08ecf30e670b6dacdb0d5` |
| `.dockerignore` | `bcbe9e1aa5e61ebe11effea916b278afb9719c5006ee57c535b7f1a8062636cc` |
| `docker-compose.yml` | `c467bcebe1fbc1f8dcc0717aacbc56ed620da08242fca6668720707864facbdc` |
| `docker-compose.dev.yml` | `975d9399c0211eb6c53a6a9d08bdd1cd4457fbd5cbdbed16664bf5448f087321` |
| `package.json` | `2eb5b7ad6a1d17da04647be0f088e233c7899b24acb2217685fbdc40bce43094` |
| `package-lock.json` | `f6558eaa127b081979308306fa50ecc96a2167ba0fe7a0e64edba94ca0c815be` |
| `requirements.txt` | `77612390b7dde174c98f7f01996960d7c84fe992a4e97b599192ee84a4b46063` |

Hosted GitHub Actions were **not run**, because this branch is intentionally not pushed. The local gates cover syntax, deterministic tests, mutation contracts, audit, repository safety, permission/ref inspection, and source preservation. They cannot substitute for hosted build/SBOM/scan/smoke evidence.

## Remaining risks and next-stage boundary

- Ubuntu tags, Apt repositories/packages, NodeSource trust/repository/package selection, Node patch level, Python bootstrap, and the entire Python dependency graph remain floating.
- The existing Docker build can execute the pre-existing Scarf lifecycle hook because it lacks `npm ci --ignore-scripts`; it was not changed without Docker proof.
- Compose still uses mutable `latest`/major tags.
- Application code and configs remain runtime-user-writable, and the root filesystem is not read-only; this is later S2 scope.
- Health is liveness only. There is no production readiness proof or native slicer health proof.
- No registry image exists, so there is no registry digest, signature, attestation, publish proof, or end-to-end provenance statement.
- Buildx, Syft, and Grype are version-selected but their downloaded release bytes are not checksum-bound by this lane; the default BuildKit driver image and hosted runner also remain floating.
- Scanner DB contents are time-varying; only the machine-readable report from a specific run can identify observed findings.
- Build-context exclusions do not prevent a dirty local `configs/pricing.json` from being copied into an image. Hosted clean checkout reduces but does not repair that policy gap.
- Production promotion, registry publication/signing, service authentication, private network topology, approval, readiness, rollback, and deployment remain unavailable pending S4 followed by S3b and separate owner authorization.
- Canonical stage documents are intentionally unchanged in this parallel lane. The integrator must reconcile this evidence after reviewed S1a integration.

## Integration handoff

1. Integrate reviewed S1a commits first.
2. Integrate the single atomic S3a commit next; never push an intermediate tree on which the legacy automatic deploy workflow still exists.
3. Let the integrator perform a separate canonical-document reconciliation from this evidence.
4. Rerun syntax, focused and aggregate tests, production audit, tracked/staged repository safety, instruction-mirror consistency, and workflow contract inspection on the combined tree.
5. On a trusted Docker host, rerun the complete build/import/liveness/import/native/SBOM/scan/history gates on the combined candidate before any Dockerfile/dependency change.
6. S4 must establish the service/security boundary. Only then may S3b design authorized immutable registry promotion, signing/attestation, approval, readiness, rollback, and deployment.

## S3a.1 correction: exact candidate-range whitespace gate

The former source workflow ended with a bare `git diff --check`. Because the exact candidate checkout is normally clean, that command inspected only the empty worktree/index delta and could return success even when a committed candidate file contained trailing whitespace. It therefore was local-worktree evidence, not proof about the candidate commit.

The corrected source gate uses the credentials-disabled, full-history exact checkout to resolve `refs/remotes/origin/main` as a commit, derive `merge-base(origin/main, CANDIDATE_SHA)`, prove that base is an ancestor of the exact candidate, and run:

```bash
git diff --check "$base_sha" "$CANDIDATE_SHA" --
```

This is a fail-closed final candidate-delta guarantee: it does not use an event `before` value, a PR-base value, `HEAD^`, an empty tree, a historical hard-coded baseline, or an empty-range fallback. Whitespace debt already committed on `main` and untouched by the candidate remains outside the range.

The focused disposable-Git tests create a local `origin/main`, a diverged multi-commit feature candidate, and a fresh clean checkout. They prove that the legacy bare command returns green for a committed trailing-whitespace candidate while the corrected range command fails; they also cover clean candidates, pre-existing unchanged main debt, untracked files, paths with spaces, invalid/missing `origin/main`, missing merge-base, and cleanup after success and failure. This correction's local static contract and mutation suite passed 156/156, the disposable-Git suite passed 5/5, and the aggregate suites passed 224/224 JavaScript and 22/22 Python tests. Hosted source and image status for the S3a.1 implementation SHA remains `UNVERIFIED` until the authorized branch push triggers and completes the no-deploy workflows.
