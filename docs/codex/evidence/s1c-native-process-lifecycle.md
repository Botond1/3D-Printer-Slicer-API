# S1c native process lifecycle evidence

## Checkpoint identity

- STATUS: local implementation and mandatory local gates verified; hosted checks are recorded in the closing report after the single authorized push.
- CODE_BASELINE: `67a2922b33f2a07d7aa729896394dcf6c6dd1d4f`.
- BRANCH: `codex/s1c-native-process-lifecycle`.
- COMMITS: implementation/tests `fd6f4f3e311f4c2b8e67366b32bd361762b8fc06`; this evidence is the separately justified second atomic commit.
- DEPENDENCY_BASELINE: dependency patch-id `5b593dee0baaa1437aedfd4892654bd90c971a4e` is already present in the authorized baseline.
- REMOTE_BRANCH_AND_PUSH_RESULT: `PENDING_POST_PUSH`; exactly one normal non-force target-branch push is allowed after the committed candidate-range gate.

## Discovery and characterization

- GRAPHIFY_AND_DIRECT_SOURCE_MAP: a disposable, code-only graph was built outside the repository at `C:\tmp\s1c-graphify-67a2922` from 94 tracked code files: 1,174 nodes, 2,078 edges, and 63 communities. Its query traced `slice.service` signal ownership through `pipeline`, conversion/orientation/model-info/transform, `runCommand`, slicer execution, artifact validation/parsing/promotion, response settlement, and route cleanup. No `graphify-out` path was created in the repository.
- OLD_PROCESS_LIFECYCLE_FAILURE_PROOF: baseline `runCommand` accepted but ignored a third signal argument; a pre-aborted probe still spawned and completed, and an inert marker inherited by the child proved full parent-environment inheritance. A direct-child timeout left the recorded inert child/grandchild PIDs 9928/5496 alive until exact-PID cleanup. Baseline orientation and model-info fallbacks both swallowed a synthetic abort. Bare `mesh2stl.py` resolution failed from repository-root cwd although the helper existed under `app/`.

## Implemented contracts

- ABORT_SIGNAL_PROPAGATION: the exact S1b effective signal now reaches mesh/CAD conversion, orientation, transform, model-info, Prusa, and Orca commands. Pre-abort and phase-boundary guards prevent new work after cancellation; `signal.reason` wins over timeout.
- PROCESS_TREE_MODEL: POSIX commands use one detached per-job process group. Windows uses the trusted absolute `System32\taskkill.exe` with exact `/PID <pid> /T`, never a process name and never shell interpolation. Unsafe/self/zero/non-integer PIDs are rejected. Exited or ambiguous identities fail closed without targeting a possibly reused PID.
- TERM_AND_KILL_ESCALATION: abort and timeout share one idempotent coordinator. POSIX sends group TERM, waits a bounded grace, then sends group KILL only when still alive. Windows attempts exact-tree graceful termination, verifies the root, then uses exact-tree `/F` and verifies again. Unverified trees quarantine the command/queue slot; timer and abort listener are removed.
- WINDOWS_AND_POSIX_BEHAVIOR: deterministic injected seams cover TERM-only exit, bounded KILL escalation, Windows graceful/forced arrays, failed-proof quarantine, exit-state identity loss, and POSIX group probes. The final production Win32 smoke created only its recorded inert child PID 5160 and grandchild PID 25492; abort returned `ABORT_ERR` and both were confirmed dead.
- TIMEOUT_COMPATIBILITY: `SLICE_COMMAND_TIMEOUT_MS` remains the timer source and timeout retains HTTP 422 / `FILE_PROCESSING_TIMEOUT`. Abort and queue-shutdown reasons are not overwritten.
- FALLBACK_ABORT_PROOF: orientation and model-info retain genuine-error fallbacks but rethrow abort/queue-shutdown cancellation.
- MINIMAL_ENVIRONMENT_ALLOWLIST: children receive only platform runtime keys (path, locale, temp, and Windows system-root/executable-extension keys) plus fixed Python safety flags: no parent-environment spread.
- SECRET_EXCLUSION_PROOF: dynamic factory and real-child tests pass required runtime values while excluding `ADMIN_API_KEY`, an inert secret marker, database/application settings, and unsafe Python/Node injection variables. Normal logs and public error responses do not contain the child environment or native output.
- HELPER_PATH_CONTRACT: the four allowlisted Python helpers resolve from the slice module to absolute `app/` paths independent of cwd; the unchanged Docker `WORKDIR /app` and flattened copy contract remains valid.
- EXACT_COMMAND_ARRAY_PROOF: tests deep-compare complete executable/argument arrays for `mesh2stl.py`, `cad2stl.py`, `orient.py`, `scale_model.py`, `prusa-slicer --info`, Prusa slicing, and Orca slicing.
- NO_ORPHAN_PROOF: deterministic tree tests and the applicable production Win32 smoke confirm no child/grandchild remains after verified termination. The queue-slot test proves capacity remains occupied until both native callback and tree settlement.
- NO_POST_ABORT_ARTIFACT_PROOF: cancellation checkpoints prevent later transform/slice/parse/promotion phases; a promotion race cannot become a success response and cleanup ownership remains intact.

## Validation

- MUTATION_TESTS_AND_COUNTS: 10/10 S1c source mutations were rejected inside the focused aggregate.
- FOCUSED_TESTS_AND_COUNTS: final S1c aggregate 43/43; inherited S1b regression 48/48; no skip/fail/cancel.
- FULL_TESTS_AND_COUNTS: exact npm 10.9.8 aggregate passed JavaScript 368/368 and Python 22/22 (Python 3.12.13).
- SYNTAX_AND_REPOSITORY_GATES: staged complete syntax JavaScript 80/80 and Python 25/25; instruction mirrors 2/2; tracked repository safety 186 files; implementation-stage safety 17 non-empty files; changed/new syntax 17/17; forbidden-surface and secret-pattern gates passed; `git diff --check` and staged diff-check passed; manifest/lockfile diff empty.
- DEPENDENCY_AUDIT: `corepack npm audit --omit=dev --audit-level=moderate` ran three times with exact npm 10.9.8; every run reported `found 0 vulnerabilities`. Clean install used `npm ci --ignore-scripts --no-audit --no-fund` and installed 175 packages.
- QUALITY_AND_DECOMPOSITION_REVIEW: read-only best-practice review improved the touched-area score from 15/23 to 21/23 and found no remaining S1c blocker. No source exceeds 500 lines, no service exceeds 300, and no S1c test exceeds 250 (maximum 239). Nonblocking inherited pressure remains in 297-line `transform.js` and its 78-line validation function; extending it should trigger extraction.
- CANDIDATE_RANGE: performed after this evidence commit against a freshly fetched `origin/main`, proving the merge base is an ancestor and `git diff --check <merge-base> HEAD --` is clean; exact SHAs are recorded in the closing report.

## Environment and handoff

- HOSTED_SOURCE_WORKFLOW: `PENDING_POST_PUSH`; the exact hosted result is recorded in the closing report without amending/pushing again.
- HOSTED_IMAGE_WORKFLOW: `PENDING_POST_PUSH`; inherited image failure, if present, is outside S1c scope and is reported without making the gate green.
- UNRUN_OR_BLOCKED_GATES: Docker is `NOT_RUN_ENVIRONMENT` because the client was installed but no daemon existed. The full API slicing runner is `NOT_RUN_ENVIRONMENT`: no supported fixture files existed under `tests/testing-files`, so it exited before creating a markdown report. Neither condition is presented as green.
- KNOWN_REMAINING_RISKS: a process tree whose identity or termination cannot be verified is deliberately quarantined by retaining its queue slot, preferring fail-closed availability loss over overlapping an unverified native job. Cross-platform POSIX live smoke remains for Linux integration; deterministic POSIX process-group coverage is green locally on Windows.
- I1_INTEGRATION_HANDOFF: integrate the exact two-commit S1c tip only after exact remote-SHA and hosted Source/Image status verification; preserve the fail-closed tree-identity and queue-settlement contracts.
- FORBIDDEN_SIDE_EFFECTS_CHECK: no main push, PR, merge, deploy, registry/VPS/SSH action, tag/release, production/customer call, native slicer invocation, workflow/Docker/Compose/manifest/lockfile change, canonical-doc change, queue/request-abort/workspace rewrite, `graphify-out`, or foreign-worktree mutation occurred.
