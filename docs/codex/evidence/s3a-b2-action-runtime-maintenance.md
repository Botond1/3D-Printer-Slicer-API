# S3a-B2 GitHub Actions runtime-maintenance evidence

Date: 2026-07-22

## Scope and identity

- Code/work baseline: `edbe81ccbdba3a04312c800de636c1ee543674f2`.
- Branch: `codex/s3a-b2-action-runtime-maintenance` in a clean linked worktree;
  the temporary Graphify outputs were never tracked and were removed before
  staging.
- Scope is limited to GitHub Action runtime maintenance, its fail-closed
  workflow contract/mutation evidence, and this record.
- Dockerfile, Compose, vendor installation, S3a-V2C, package manifests,
  dependencies, application runtime, scanner policy, deployment behavior, and
  canonical Codex knowledge are unchanged.

## Hosted warning boundary

The exact hosted Node.js 20 deprecation annotations named these actions:

- Source Validation run `29950761459`, job `89027574695`:
  `actions/checkout`, `actions/setup-node`, and `actions/setup-python`.
- Image Validation run `29950761163`, job `89027574061`:
  `actions/checkout`, `actions/upload-artifact`,
  `docker/setup-buildx-action`, and `docker/build-push-action`.

The annotations did not name `anchore/sbom-action@v0.24.0` or
`anchore/scan-action@v7.4.0`, so those exact full-SHA pins remain unchanged.
Hosted execution of this candidate is `UNVERIFIED`; the run references above
characterize the baseline warnings only.

The complete post-change `uses:` inventory is 11 occurrences: three external
actions in `ci.yml`; six external actions in `image-validation.yml`; and the
two unchanged local reusable-workflow calls in `deploy.yml`. There are eight
unique external actions because the same checkout pin appears in both reusable
validation workflows. Seven external occurrences (six unique actions) are the
warning-backed Node 24 updates; the two Anchore occurrences and both local calls
are intentionally unchanged.

## Official release and immutable-pin evidence

The official release pages and action manifests establish the first audited
Node 24 major for each named action. Every tag was resolved read-only against
the official repository tag ref, and the resulting full 40-character commit is
the workflow value. All six Node 24 majors require Actions Runner `v2.327.1` or
later.

| Action | Retired baseline | Audited Node 24 pin | Official release and relevant change |
| --- | --- | --- | --- |
| Checkout | `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683` (`v4.2.2`) | `actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8` (`v5.0.0`) | [v5.0.0](https://github.com/actions/checkout/releases/tag/v5.0.0): runtime-only Node 24 major. Existing exact-ref, full-history/shallow-history, and `persist-credentials: false` inputs remain. |
| Node setup | `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` (`v4.4.0`) | `actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444` (`v5.0.0`) | [v5.0.0](https://github.com/actions/setup-node/releases/tag/v5.0.0): Node 24 plus automatic package-manager cache detection. `package-manager-cache: false` is now explicit, preserving the prior no-cache behavior while Node `20` remains the validated application toolchain. |
| Python setup | `actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065` (`v5.6.0`) | `actions/setup-python@e797f83bcb11b83ae66e0230d6156d7c80228e7c` (`v6.0.0`) | [v6.0.0](https://github.com/actions/setup-python/releases/tag/v6.0.0): Node 24 runtime major; the existing Python `3.12` selection is unchanged. |
| Artifact upload | `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` (`v4.6.2`) | `actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f` (`v6.0.0`) | [v6.0.0](https://github.com/actions/upload-artifact/releases/tag/v6.0.0): first default Node 24 release; the exact four paths, error-on-missing, seven-day retention, no overwrite, and hidden-file exclusion remain. |
| Buildx setup | `docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` (`v3.12.0`) | `docker/setup-buildx-action@4d04d5d9486b7bd6fa91e7baf45bbb4f8b9deedd` (`v4.0.0`) | [v4.0.0](https://github.com/docker/setup-buildx-action/releases/tag/v4.0.0): Node 24, ESM/toolkit updates, and deprecated input/output removal. The used `version`, `cache-binary`, and `cleanup` inputs remain supported and unchanged. |
| Image build | `docker/build-push-action@263435318d21b8e681c14492fe198d362a7d2c83` (`v6.18.0`) | `docker/build-push-action@d08e5c354a6adb9ed34480a06d141179aa583294` (`v7.0.0`) | [v7.0.0](https://github.com/docker/build-push-action/releases/tag/v7.0.0): Node 24 and removal of deprecated summary/export controls not used here. `DOCKER_BUILD_RECORD_UPLOAD` and `DOCKER_BUILD_SUMMARY`, plus all build-once inputs, remain supported and unchanged. |

## Preserved workflow security contract

- Workflow and job permissions remain exactly `contents: read`.
- Exact lowercase 40-character candidate selection, credential-free exact-ref
  checkout, and checked-out identity proof remain unchanged.
- Source validation retains the dynamic
  `merge-base(origin/main, candidate)..candidate` whitespace gate, ancestry
  proof, full history, and no empty-tree/range fallback.
- Image validation still builds exactly once, loads one candidate-SHA local
  image, never logs into a registry, never pushes, and never deploys.
- The same local image remains the only smoke, identity, SPDX SBOM, and Grype
  target. The Grype cutoff remains `high`, includes unfixed findings, and keeps
  its fail-closed scanner/infrastructure distinction.
- Bounded diagnostics, exact four-file evidence boundary/upload, seven-day
  retention, final independent fail-closed aggregation, and exact-resource
  cleanup remain unchanged.
- `deploy.yml` remains a manual two-gate no-deploy preflight with no production
  environment, secret, SSH/VPS, publication, release, or promotion path.

The contract validator now binds each external action to both its exact audited
SHA and exact release comment. It rejects retired Node 20 pins for every changed
action occurrence, wrong comments, appended scalar content after a valid SHA,
and setup-node cache-policy drift. Existing adversarial mutations continue to
cover the security invariants above.

## Local validation

- Graphify-first workflow audit: `PASS`. The temporary report covered all three
  workflows with 23 nodes, 30 edges, five communities, 93% extracted edges,
  7% inferred edges, no ambiguous edges, and no import cycle. Its untracked
  artifacts were removed before staging.
- `corepack.cmd npm ci --ignore-scripts --no-audit --no-fund`: exit `0` with
  exact npm `10.9.8`; 175 packages installed from the unchanged lockfile.
- `node --test tests/unit/js/s3a-workflow-contracts.test.js
  tests/unit/js/candidate-whitespace-gate.test.js
  tests/unit/js/s3a-image-liveness-enforcement.test.js`: exit `0`, 240/240
  focused workflow/whitespace/liveness tests passed.
- Final `node --check tests/unit/js/s3a-workflow-contracts.test.js` and focused
  contract rerun: exit `0`, 212/212 tests passed.
- `corepack.cmd npm run check:syntax` with the absolute bundled Python 3.12.13
  test interpreter: exit `0`; 67 tracked JavaScript and 25 tracked Python files
  passed.
- `corepack.cmd npm test` with both `TEST_PYTHON_EXECUTABLE` and
  `PYTHON_EXECUTABLE` set to that inert local interpreter: exit `0`; the final
  post-mutation rerun passed 372/372 JavaScript and 22/22 Python, with zero
  skips.
- `corepack.cmd npm run check:repository-safety`: exit `0`; 174 tracked indexed
  files passed. After selecting the exact four intended files,
  `corepack.cmd npm run check:repository-safety:staged` also exited `0` and
  validated four non-empty staged indexed files.
- `node --test tests/unit/js/instruction-mirrors.test.js`: exit `0`, 2/2 mirror
  tests passed.
- Read-only quality-architect review found one isolated mutation gap in the
  setup-node input-key allowlist. The requested `cache: npm` bypass mutation was
  added while preserving `package-manager-cache: false` and passes in the final
  focused/aggregate results above. Decomposition of the existing 1,830-line
  workflow-contract test is explicitly deferred to a separate refactor: this
  patch adds no new test domain, and splitting it here would widen the
  action-runtime-only scope.
- `git diff --check` and the explicit work-baseline diff check: exit `0`.
- `actionlint`: `NOT_RUN_ENVIRONMENT`; no executable is installed. The
  fail-closed local workflow parser and mutation suite above is green, but it
  is not represented as an actionlint run.
- Exact npm 10.9.8 production audit: `BLOCKED_POLICY`. The sandboxed request
  could not reach the audit endpoint, and the required network escalation was
  rejected because it would disclose lockfile-derived dependency metadata to
  the npm registry. No retry or workaround was attempted.
- Docker/image/runtime and native integration gates are `NOT_APPLICABLE` to
  this action-metadata-only patch and were not run. Hosted CI is not claimed as
  run for this candidate.

## Remaining boundary

Node 24 is the JavaScript runtime embedded in the maintained actions; it does
not change the repository's selected application Node.js 20 or Python 3.12
toolchains. The hosted runner version, hosted action execution, branch
protection, required checks, image result, production topology, and deployed
identity remain external and `UNVERIFIED`. No PR, push, merge, tag, release,
registry publication, deployment, or production change is authorized by this
checkpoint.
