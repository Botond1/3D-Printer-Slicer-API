# GPT-5.6 execution prompt — S3a.1 candidate-range whitespace gate

## Recommended execution profile

- Model: `gpt-5.6-terra`
- Reasoning effort: `medium`
- Escalate to `gpt-5.6-sol` / `high` only if the repository's actual Git object or workflow-call semantics invalidate the bounded design below.

## Objective

Correct one narrowly verified S3a workflow defect without expanding the deployment or build scope.

The current source-validation workflow ends with `git diff --check` after an exact, clean, `fetch-depth: 1` checkout. That command inspects the worktree/index delta, which is empty in normal hosted validation; it does not prove that the checked-out candidate tree is free of Git whitespace errors.

Replace this no-op-style gate with a deterministic, fail-closed candidate-range whitespace check that:

1. validates the exact already-resolved `CANDIDATE_SHA`;
2. checks the complete final delta from the candidate's verified merge-base with the freshly fetched `origin/main`, not the clean worktree delta;
3. obtains the necessary history through the exact checkout step rather than an ad hoc authenticated fetch;
4. preserves PR, non-`main` push, manual-dispatch, and reusable-workflow candidate semantics;
5. has durable positive and adversarial tests proving a committed trailing-whitespace mutation fails from a clean multi-commit candidate checkout;
6. preserves every S3a no-deploy, no-push, read-only-permission, exact-SHA, and build-once invariant.

This is a corrective checkpoint only. Do not redesign CI, Docker, dependencies, application code, or production promotion.

## Authorized baselines and isolation

- `CODE_BASELINE` is exactly `ea923c034359d742914154ffbfd68be110714055`.
- The architect will provide a prompt-only `WORK_BASELINE` whose sole `CODE_BASELINE..WORK_BASELINE` change is:
  - `prompts/codex/S3a.1-candidate-whitespace-gate.md`
- Architect/source branch: `codex/s3a-1-candidate-whitespace-gate-prompt`.
- Implementation branch: `codex/s3a-1-candidate-whitespace-gate`.
- Expected origin: `https://github.com/Botond1/3D-Printer-Slicer-API.git`.

Treat the architect checkout as read-only. Create a new linked worktree at a verified-absent path, branched exactly from `WORK_BASELINE`. Do not edit, stage, clean, reset, rebase, amend, or commit in the architect checkout.

Before reading broadly or editing, prove in the implementation worktree:

- repository root and `origin` are exactly the expected repository;
- branch is exactly `codex/s3a-1-candidate-whitespace-gate`;
- `HEAD` equals the supplied `WORK_BASELINE`;
- `git status --porcelain=v1 -uall` is empty;
- `CODE_BASELINE..WORK_BASELINE` contains exactly the one prompt path above;
- the local implementation branch and target worktree were absent before creation;
- `refs/heads/codex/s3a-1-candidate-whitespace-gate` does not already exist on `origin`.

If any preflight assertion fails, stop with `BLOCKED`. Never stash, reset, clean, overwrite, force-update, reuse, or absorb unrelated work.

## GitHub authorization and forbidden external effects

The user explicitly authorizes one normal, non-force push of the completed implementation branch to `origin` after every mandatory local gate is green and the commit is clean:

```text
git push --set-upstream origin codex/s3a-1-candidate-whitespace-gate
```

This authorization is limited to that exact branch. It does not authorize:

- a push to `main` or any other branch;
- force-push, ref deletion, tag, release, PR creation/merge, registry login, image publication, deployment, SSH, VPS access, remote application/slicer calls, or production/customer data;
- changing GitHub repository settings, branch protection, required checks, secrets, environments, or permissions.

The branch push is expected to trigger the existing no-deploy source/image validation workflows. If push authentication is unavailable, keep the verified local commit and report `REMOTE_PUSH_BLOCKED`; do not change credentials or remotes. If the push succeeds, observe the exact branch/SHA workflow runs with an authenticated GitHub CLI when already available. Do not install tooling or broaden authentication. A hosted failure is evidence, not permission to weaken a gate.

## Mandatory reading and fresh verification

Read completely before editing:

- `AGENTS.md`;
- `CLAUDE.md` read-only;
- `docs/codex/project-map.md`;
- `docs/codex/security-model.md`;
- `docs/codex/hardening-plan.md`;
- `.github/instructions/github.instructions.md`;
- `.github/instructions/repository.instructions.md`;
- `.github/workflows/ci.yml`;
- `.github/workflows/deploy.yml`;
- `.github/workflows/image-validation.yml`;
- `tests/unit/js/s3a-workflow-contracts.test.js`;
- `docs/codex/evidence/s3a-build-provenance-and-deploy-separation.md`;
- package scripts and validation runners invoked by the workflow.

Verify from executable behavior—not only string presence—that current `git diff --check` returns green in a clean checkout even when the committed candidate tree contains a whitespace error. Reproduce this only in a disposable temporary Git repository; never mutate the real repository to demonstrate the defect.

## Exclusive implementation ownership

This stage may modify only:

- `.github/workflows/ci.yml`;
- `tests/unit/js/s3a-workflow-contracts.test.js`;
- optionally one new focused test file under `tests/unit/js/` named for the candidate whitespace gate, if that keeps the existing oversized contract file from gaining runtime-fixture responsibilities;
- `docs/codex/evidence/s3a-build-provenance-and-deploy-separation.md`.

Do not edit any other workflow, `app/**`, Dockerfile, `.dockerignore`, Compose, manifests/lockfiles, requirements, validation scripts, canonical Codex knowledge files, `AGENTS.md`, Claude/Copilot mirrors, profiles, pricing, runtime artifacts, or generated test reports.

The existing `s3a-workflow-contracts.test.js` is already oversized. Prefer a small focused dynamic Git-behavior test file while keeping static workflow invariants in the existing contract test. Record the split decision in the final report; do not perform unrelated decomposition.

## Required candidate-range design

Use Git's own whitespace semantics. Do not reimplement whitespace parsing with a regex, ESLint, Prettier, `grep`, or a hand-written file walker.

The hosted step must:

1. run under Bash with `set -euo pipefail`;
2. prove `CANDIDATE_SHA` is the checked-out `HEAD` or reuse the already-durable exact-identity proof without weakening it;
3. resolve `refs/remotes/origin/main` as a commit from history obtained by the credentials-disabled checkout;
4. derive a real merge-base between that verified remote-main commit and `CANDIDATE_SHA`, and fail if no usable base exists;
5. invoke `git diff --check` between the merge-base and the exact `CANDIDATE_SHA`, with `--` terminating revisions;
6. fail non-zero on any Git-detected whitespace error introduced anywhere in the candidate's final delta;
7. remain independent of the mutable worktree/index and avoid trusting event-specific `before` or PR-base values.

A design equivalent to:

```bash
remote_main_sha="$(git rev-parse 'refs/remotes/origin/main^{commit}')"
base_sha="$(git merge-base "$remote_main_sha" "$CANDIDATE_SHA")"
git merge-base --is-ancestor "$base_sha" "$CANDIDATE_SHA"
git diff --check "$base_sha" "$CANDIDATE_SHA" --
```

is expected. Strengthen the guards if executable evidence requires it, but do not silently fall back to an empty range. Do not hard-code a historical baseline SHA, use `HEAD^`, `${{ github.event.before }}`, or trust a PR-base input: those are incomplete for multi-commit/manual/reusable candidates. Do not run a second credentialed `git fetch` step.

Change checkout history depth only as narrowly as required to make `origin/main` plus candidate ancestry available; `fetch-depth: 0` is the expected portable choice. Keep `persist-credentials: false`, exact candidate checkout, `contents: read`, and all current source-validation commands. Prove the remote-main ref exists after checkout; absence is a hard failure, never a green empty diff.

Do not compare the candidate against an empty tree. The current repository contains verified historical trailing-whitespace debt in unrelated files, so a full-tree-as-added check would create a false blocker and pressure this corrective stage to edit forbidden application/Python files. The new gate owns only whitespace errors present in the candidate's final delta from `main`.

## Static and dynamic test contract

### Static workflow contracts

Update the S3a workflow contract so it rejects:

- a bare `run: git diff --check` clean-worktree check;
- `git diff --check` without the derived merge-base and exact `CANDIDATE_SHA`;
- `HEAD^`, `${{ github.event.before }}`, PR-base inputs, an empty-tree comparison, a hard-coded baseline, or an empty-range fallback;
- loss of `set -euo pipefail`, exact checkout identity, full-history availability, verified `origin/main`, ancestry proof, or `--` revision termination;
- any change that reintroduces main-push deployment, registry/image push, write permissions, secrets, SSH, VPS access, or deploy commands.

Mutation cases must alter one invariant at a time and prove the contract fails for the intended reason.

### Disposable Git behavior tests

Use OS temporary directories and local Git only. At minimum prove:

1. a clean committed candidate tree passes from a clean checkout;
2. a committed trailing-whitespace error on a multi-commit feature candidate fails even though `git status --porcelain` is empty;
3. the legacy bare `git diff --check` returns green in that same clean bad-candidate checkout, demonstrating why it was insufficient;
4. the corrected gate works in a local clone with `origin/main`, a diverged feature branch, and complete locally fetched history;
5. pre-existing trailing whitespace committed on `main` but untouched by the candidate does not fail the candidate-range gate;
6. a missing/invalid `origin/main`, missing merge-base, or deliberately empty fallback fails closed;
7. an untracked file is not mistaken for candidate content;
8. paths with spaces do not break the command;
9. temporary repositories and files are removed after both success and failure.

Tests must be deterministic, cross-platform where the repository's current Node suite supports it, use inert synthetic content, and never call a remote network or modify global Git configuration. Set disposable repository-local author identity only.

## Evidence update

Append a clearly labeled S3a.1 correction to the existing S3a evidence document:

- state precisely why the former hosted `git diff --check` was insufficient;
- distinguish the previous local worktree/cached diff evidence from the new `origin/main` merge-base candidate-range guarantee;
- record the exact corrected command shape and dynamic divergent-history evidence;
- keep hosted status `UNVERIFIED` until the pushed implementation SHA's runs actually complete;
- if hosted runs finish, record their exact conclusion without claiming deployment, publication, immutable registry digest, signature, attestation, readiness, rollback, branch protection, or production authorization.

Do not rewrite historical evidence as if it never happened.

## Mandatory local gates

Run the smallest focused checks first, then all repository gates:

1. focused static workflow contract tests;
2. focused disposable-Git behavior tests;
3. controlled adversarial mutations for every new invariant;
4. actionlint for all three workflows using the already-established verified local mechanism, if available;
5. `npm test` with exact JavaScript/Python counts;
6. complete tracked JavaScript and Python syntax gates;
7. instruction-mirror consistency;
8. repository-safety scan over tracked files and non-empty staged scope;
9. exact npm 10.9.8 clean install with `--ignore-scripts --no-audit --no-fund`, followed by rerunning applicable gates;
10. `npm audit --omit=dev --audit-level=moderate` remains green;
11. `git diff --check`, `git diff --cached --check`, staged-name review, and final clean status.

No Dockerfile or runtime input changes are allowed, so local Docker build is not a commit gate for S3a.1. A successful hosted image workflow is useful external evidence but cannot make deployment ready.

Do not weaken or delete an existing test to obtain green. Do not call an unavailable external gate green.

## Commit, push, and stop policy

Create exactly one atomic implementation commit after every mandatory local gate is green:

```text
ci: validate whitespace in exact candidate range
```

Before commit, prove the staged paths are within the exclusive ownership list and run staged safety/diff gates. After commit, rerun the focused tests from the committed tree and require a clean worktree.

Then perform the single authorized non-force push of the exact implementation branch. Do not push if local mandatory gates are red, the branch/ref preflight changed, or the worktree is dirty.

Status meanings:

- `COMPLETED`: local commit and push succeeded, focused/full local gates are green, and the exact pushed SHA's required hosted no-deploy workflows are green.
- `CHECKPOINT_PUSHED`: local commit and push succeeded, local gates are green, but hosted workflows are pending, unavailable, or red; report exact run/evidence state.
- `CHECKPOINT_COMMITTED`: local commit and local gates are green, but the authorized push could not be completed; report the exact authentication/network blocker.
- `BLOCKED`: unsafe preflight or a mandatory local code/test/safety gate is red; do not commit or push unsafe work.

## Required final report

Return exactly this structure in Hungarian:

```text
STATUS: COMPLETED | CHECKPOINT_PUSHED | CHECKPOINT_COMMITTED | BLOCKED
CODE_BASELINE:
WORK_BASELINE:
BRANCH:
COMMIT:
REMOTE_BRANCH_AND_PUSH_RESULT:
MODIFIED_FILES:
ROOT_CAUSE_AND_OLD_GATE_PROOF:
NEW_CANDIDATE_RANGE_CONTRACT:
STATIC_AND_MUTATION_TEST_EVIDENCE:
DISPOSABLE_GIT_RANGE_EVIDENCE:
LOCAL_TESTS_AND_COUNTS:
ACTIONLINT_AND_REPOSITORY_GATES:
DEPENDENCY_AUDIT:
HOSTED_SOURCE_WORKFLOW:
HOSTED_IMAGE_WORKFLOW:
NO_DEPLOY_AND_PERMISSION_PROOF:
DOCUMENTATION_EVIDENCE_UPDATE:
CONTRACT_PRESERVATION_PROOF:
UNRUN_OR_BLOCKED_GATES:
KNOWN_REMAINING_RISKS:
NEXT_INTEGRATION_STEP:
FORBIDDEN_SIDE_EFFECTS_CHECK:
```

Do not claim S1a/S1b/S1c/S2/S4/S3b completion, production readiness, branch protection, immutable registry identity, signature, attestation, deployment, or rollback from this stage.
