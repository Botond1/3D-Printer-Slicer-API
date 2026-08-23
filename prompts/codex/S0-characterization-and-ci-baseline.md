# GPT-5.6-sol execution prompt — S0 knowledge, characterization and CI

You are the implementation agent for the standalone `3D-Printer-Slicer-API` repository. Work as a senior security engineer, Node.js/Python maintainer, test architect, and container engineer. This is a live-cloud-adjacent project: if GitHub Actions and the required secrets are active, the tracked workflow is configured to attempt a VPS deployment on every `main` push. Whether that external deployment is active or healthy is `UNVERIFIED` and must not be assumed.

## Objective

Create the repository's durable Codex knowledge foundation and the first behavior-preserving hardening layer:

1. thoroughly verify the real project from code, not from README claims;
2. create a thin Codex operating guide and evidence-backed project/security/roadmap knowledge files;
3. establish deterministic local characterization tests and truthful validation commands;
4. make existing test runners fail the process when scenarios fail;
5. add CI validation that is separate from deployment;
6. leave runtime API, slicer behavior, pricing, profiles, public contracts, and production deployment unchanged in this stage.

Do not implement the queue/upload lifecycle fix yet. S0 must make that later change safely testable.

## Baseline and isolation

- Expected code baseline: `899f1916437620ab536e912bf404d8da261cc37f`.
- Start from the clean architect commit that contains only this prompt on top of the code baseline. The only allowed path in `CODE_BASELINE..WORK_BASELINE` is `prompts/codex/S0-characterization-and-ci-baseline.md`. Record both:
  - `CODE_BASELINE` — the expected commit above;
  - `WORK_BASELINE` — the exact HEAD from which you create your work branch.
- Before editing, run read-only preflight checks for repository root, remote, HEAD, branch, status, and the diff from `CODE_BASELINE` to `WORK_BASELINE`.
- If the worktree is dirty, or `CODE_BASELINE..WORK_BASELINE` changes any path other than the single allowed prompt path above, stop. Do not stash, reset, clean, overwrite, or absorb unrelated work.
- Create and work only on `codex/s0-characterization-ci-baseline` (or an isolated linked worktree using that branch). Never edit `main` directly.
- Do not fetch, pull, push, open a PR, tag, release, deploy, SSH to a VPS, call a remote/production API, or touch the LeadPilot repository.
- Do not create or use real secrets. Do not commit `.env`; use explicit inert test values only.

## Evidence hierarchy

Use this order when sources disagree:

1. current user instructions and this prompt for scope and authorization;
2. executable source, route registration, OpenAPI generator, Docker/Compose, workflow files, dependency manifests, and tests for actual behavior;
3. newly created Codex knowledge files for verified system understanding and forward plans;
4. `CLAUDE.md`, `.claude/**`, `.github/**`, README, and changelog as compatibility references, not proof.

Every material assertion in a knowledge file must cite a repository path and, where useful, a symbol or line range. Label uncertain claims as `UNVERIFIED`; do not turn documentation claims into facts.

## Mandatory reading and full-project audit

Read completely before editing:

- root `CLAUDE.md`, `.claude/CLAUDE.md`, and `.github/copilot-instructions.md`;
- all folder-local `CLAUDE.md` files and applicable `.github/instructions/**` files;
- every runtime `.js` and `.py` file under `app/`;
- `Dockerfile`, both Compose files, `.dockerignore`, `.env.example`;
- `package.json`, `package-lock.json`, and `requirements.txt`;
- `.github/workflows/**`;
- the OpenAPI generator, README API sections, all test runners, and their common helpers;
- tracked slicer profiles sufficiently to understand trust and compatibility boundaries. Do not rewrite profiles.

Inventory the complete file set dynamically. Do not assume the current workflow's hard-coded syntax-check list is complete.

## Parallel read-only discovery

Use parallel sub-agents if available, but keep their first pass read-only. Assign non-overlapping areas:

- **Lane A — Node/API contract:** bootstrap, middleware order, auth/CORS/proxy trust, multipart upload, queue, cleanup, output, pricing, OpenAPI and stable errors.
- **Lane B — Python/native boundary:** converters, orientation/transform behavior, executable resolution, command timeout/termination, native parser/slicer trust boundary.
- **Lane C — Docker/supply chain/deploy:** image construction, dependency reproducibility, permissions, mounts, networks, resource limits, CI/deploy gates and rollback/readiness.
- **Lane D — testability/operations:** existing runners, exit semantics, fixtures, reports, deterministic test seams, retention, observability and local-development claims.

Each lane must return findings with code evidence, documentation discrepancies, unknowns, and proposed tests. Reconcile them centrally before edits. Never let parallel agents edit overlapping files.

At minimum, explicitly verify these architect hypotheses rather than accepting them blindly:

- Multer persists an upload before queue admission, and queue rejection/late expiry can leave it behind.
- Queue wait expiry is evaluated only when a worker slot becomes available, not at the configured deadline.
- the published Python slice runners can report failed scenarios but still exit with status `0`;
- the CI syntax list covers only part of the runtime source before the workflow's configured `main` deployment attempt;
- local root-level `npm start` may not resolve bare Python script paths used inside the flattened Docker layout;
- protected pricing mutations may not receive the same browser-origin CORS classification as `/admin/**`;
- successful outputs have no bounded retention/job-artifact correlation;
- base images, Python dependencies, NodeSource/Apt inputs, Actions, and the Compose `latest` image are not all immutable;
- `/health` is liveness, not a production readiness proof.

## Deliverable A — Codex knowledge foundation

Create exactly these durable knowledge files:

1. `AGENTS.md`
2. `docs/codex/project-map.md`
3. `docs/codex/security-model.md`
4. `docs/codex/hardening-plan.md`

Do not create a third full mirror of the Claude/Copilot instruction corpus.

### `AGENTS.md`

Keep it concise and routing-oriented (target at most roughly 180 lines). It must contain:

- mission and standalone-repository scope;
- evidence/authority order;
- required reading by change type;
- non-negotiable compatibility invariants;
- security, secrets, destructive-action, Git and deployment boundaries;
- safe branch/worktree rules for a live-cloud project;
- parallel lane ownership rules;
- validation gates and conditional gates;
- documentation maintenance and drift policy;
- required final handoff format.

State explicitly that this thin Codex layer is independent of the manually mirrored Claude/Copilot corpus. Codex knowledge must link to, not duplicate, that corpus. Do not edit the legacy global instructions merely to copy Codex content; synchronize them later only when a shared project policy or contract actually changes.

It must preserve, by reference rather than by duplicating every list:

- root-scoped `input/`, `output/`, `configs/` runtime layout;
- the legacy multipart field spelling `choosenFile` until a separately versioned migration exists;
- stable public endpoint/error semantics unless an explicit contract-change stage authorizes them;
- `execFile`/argument-array command execution with no shell interpolation;
- fail-fast invalid geometry and no automatic healing;
- Prusa FDM/SLA and Orca FDM engine boundaries;
- no LeadPilot changes from this repository;
- private Hostinger sidecar as the production target, never a public slicer service.

### `docs/codex/project-map.md`

Include:

- verified baseline and audit date;
- system context and request-to-artifact flow;
- repository/module map and canonical sources;
- runtime state and artifact lifecycle;
- API/compatibility boundaries without copying the complete endpoint schema;
- external executable and dependency boundaries;
- test/CI capability matrix;
- change-impact map;
- verified documentation/code discrepancies and open unknowns.

### `docs/codex/security-model.md`

Include:

- scope and explicit deployment assumptions;
- assets/data classification, actors, trust boundaries and attack surface;
- threat/abuse-case matrix with severity, current control, evidence, gap and planned verification;
- controls classified as `IMPLEMENTED_AND_TESTED`, `IMPLEMENTED_UNTESTED`, `PARTIAL`, or `ABSENT`;
- mandatory invariants, verification matrix, accepted risks and non-goals.

Cover malicious multipart input, ZIP/3MF bombs and traversal, symlink/races, native parser/slicer compromise, command injection, CPU/RAM/disk/PID exhaustion, queue starvation, proxy spoofing, admin/internal key compromise, output disclosure, cleanup residue, supply-chain compromise, logging injection/leakage, and deploy/readiness failure.

### `docs/codex/hardening-plan.md`

Maintain statuses using `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, and `VERIFIED`. Include dependencies, parallel ownership, exact exit criteria, and a decision/risk log for:

- **S0:** knowledge, characterization, truthful runners, local validation CI;
- **S1:** upload/job workspace lifecycle, real queue deadlines, abort/process-tree cancellation, cleanup and stale-file recovery; also correct verified local-versus-container Python script path divergence without changing the container contract;
- **S2:** resource envelope, archive/model limits, output quotas/TTL, streaming/size caps, atomic pricing persistence/rollback, read-only root filesystem, root-owned application code and read-only slicer profiles with separately writable state;
- **S3:** reproducible supply chain, immutable image CI, signed/scanned artifact, deployment/readiness/rollback separation;
- **S4:** service-to-service auth, protected-route CORS/admin-policy consistency, structured observability, egress-restricted private Hostinger sidecar topology and LeadPilot integration contract;
- **S5 (optional, decision-gated):** isolated worker container and asynchronous versioned jobs API.

Mark which post-S0 lanes can run in parallel. At minimum, S1 runtime lifecycle and S3 supply-chain work may branch in parallel after the shared S0 test/knowledge baseline, with disjoint file ownership; integration waits for both.

## Deliverable B — deterministic characterization foundation

Implement a small, behavior-preserving test foundation. Do not add production dependencies solely for tests unless there is no reasonable built-in alternative and you document the decision.

### Strict production-change budget

S0 must not change server bootstrap/listen behavior, middleware or route order, queue scheduling, filesystem lifecycle, command arguments/execution, pricing behavior, slicer behavior, or Docker runtime behavior. Production-code edits are limited to exporting existing pure helpers or adding a default-preserving test seam with unchanged production call sites. If a test would require a server factory, queue redesign, clock abstraction, root-path architecture change, or broad dependency injection, mark it `NOT_COVERED_S0`, add its secure expectation to the hardening plan, and defer it.

Required outcomes:

- Use Node's built-in `node:test` runner for new JavaScript unit/characterization tests.
- Use Python standard-library `unittest` for new Python runner tests; do not add pytest in S0.
- Add truthful package scripts, including at least `test:js`, `test:python`, `npm test` as their aggregate, and dynamically discovered complete JS syntax validation. The top-level command used by CI must run both the JavaScript and Python unit suites.
- Discover only tracked project JavaScript/Python sources; exclude `.git`, `node_modules`, virtual environments, runtime `input/` and `output/`, generated reports and caches. Validate Python syntax by parsing/compiling source text without writing `.pyc` files; do not use `py_compile` as the implementation of this gate.
- Tests must use OS temporary directories and clean them in `finally`/test teardown. They must not mutate tracked runtime `input/`, `output/`, `configs/`, real pricing, or user files.
- Create only tiny, deterministic, self-authored fixtures needed for offline checks. A minimal ASCII STL may be committed under a narrowly allowed fixture path. Generate ZIP variants during tests where practical. Do not unignore the entire private/heavy `tests/testing-files/**` tree and do not add large binaries.
- Preserve all production endpoint names, request/response fields, status codes, error codes, defaults, profile semantics, pricing behavior and slicer command semantics.
- Minimal internal exports/factories or dependency injection for testability are allowed only when production behavior is proven unchanged. Do not refactor `server.js` into a new architecture in this stage.

Required S0 characterization coverage:

- value/option parsing and profile filename traversal rejection;
- stable middleware/error mappings;
- queue FIFO, concurrency, per-client cap, overflow and typed error mapping using isolated subprocesses or another non-invasive seam;
- admin auth behavior for missing, wrong and correct inert keys, including wrong keys with both equal and unequal lengths. Do not use timing benchmarks; prove the `timingSafeEqual` code path structurally or through an isolated helper;
- safe output name sanitization and extension selection;
- structured OpenAPI assertions for current paths, methods, `x-api-key` declarations, multipart field `choosenFile` and documented response-status keys; separate source-level contract assertions for selected stable error-code mappings exposed by error, queue and middleware modules. Do not expand the OpenAPI contract in S0, require undocumented `errorCode` enums from it, or use a byte-for-byte full-document snapshot;
- byte equality of intentionally mirrored `.github/agents` ↔ `.claude/agents` and `.github/skills` ↔ `.claude/skills` pairs.

Conditional/best-effort S0 coverage, allowed only within the strict change budget:

- existing admin output extension/path/realpath/symlink containment through minimal pure-helper exports; otherwise defer root injection/service factories;
- pricing/stat edge characterization;
- other pure helpers discovered during audit.

Do not lock delayed queue expiry, timestamp collision, upload residue, zero-stat success, or another suspected vulnerability into a durable desirable contract. Record each as `PARTIAL`/`KNOWN_RISK` with an explicit S1/S2 secure expectation and exit criterion. Do not write a test that asserts an upload leak is desirable.

## Deliverable C — truthful existing runners

Inspect every Python runner and wrapper. A runner that records one or more failed scenarios must exit non-zero. At minimum, correct the combined runner and all three per-engine wrappers if the audit confirms they ignore `failed_count`.

Add a standard-library `unittest` that stubs scenario execution and proves both success (`0`) and failure (non-zero) process-exit propagation without network, slicers, or private fixtures. Static source-text assertions are not sufficient. Expose it through `test:python` and run it in CI.

Preserve generated Markdown report formats unless a correction is necessary. If any runner is skipped because real slicers or private fixtures are absent, say so; never report a skipped runner as passed.

## Deliverable D — validation CI separate from deploy

Add a validation-only workflow, preferably `.github/workflows/ci.yml`, for pull requests and non-deployment branch validation. It must use this trigger/permission posture (equivalent formatting is fine):

```yaml
permissions:
  contents: read

on:
  pull_request:
  push:
    branches-ignore:
      - main
  workflow_dispatch:
```

It must not use `pull_request_target`, deploy secrets, write permissions, or call a deploy workflow. It must not deploy. Include, as applicable:

- checkout and explicit major-version runtime setup tags consistent with the current baseline; inventory immutable Action SHA pinning as later work rather than inventing SHAs;
- `npm ci --ignore-scripts --no-audit --no-fund` (unless scripts are proven required);
- complete dynamic JS syntax validation;
- Python syntax validation;
- `npm test`;
- fixture/secret/large-file guard suitable for this repository;
- optional instruction-mirror drift check if it is not already part of `npm test`.

Do not modify the production deploy trigger, VPS commands, secrets, or server in S0. Record the configured automatic-deploy risk and its S3 migration/rollback plan. Do not claim the new CI protects `main` until branch protection and workflow requirements are externally configured.

The resulting S0 commit is not production merge-ready by itself: merging anything to `main` is configured to activate the existing deployment workflow. The final report and hardening plan must state that promotion to `main` requires a separate human-approved change window and integration decision, or prior completion of the deployment-trigger safety work.

Do not invent dependency versions, image digests, Action commit SHAs, or Python hashes. Record floating inputs precisely. Pinning belongs to a later stage with verified upstream provenance.

## Explicit exclusions

In S0, do not:

- fix queue/upload cleanup, cancellation, retention, pricing atomicity, CORS, readiness, or API auth yet;
- add `/v1`, async jobs, databases, brokers, object storage or LeadPilot integration code;
- alter slicer profiles, pricing data, generated artifacts, or supported file types;
- change Docker runtime behavior or dependency versions merely to make an audit green;
- weaken, delete or broadly rewrite existing security controls/tests/docs;
- run real untrusted/customer models, upload customer files, or call any remote/production Prusa/Orca/AI/API service. A disposable local test server or locally built container is allowed only for the conditional gates below, with synthetic fixtures and inert secrets.

## Validation gates

Run and report exact commands, exit codes and test counts.

Mandatory local gates for an S0 commit:

1. clean preflight before edits;
2. `git diff --check`;
3. complete dynamic JavaScript syntax validation over the scoped project files;
4. AST/source-compile-based Python syntax validation without leaving `__pycache__`/`.pyc` residue;
5. `npm ci --ignore-scripts --no-audit --no-fund` from the lockfile. Registry/cache access may require network, but this remains mandatory; if installation cannot complete, do not claim the gate is green;
6. `npm run test:js` with zero failed JavaScript tests;
7. `npm run test:python` with zero failed Python unit tests and explicit proof that runner failure counts propagate to non-zero exit status;
8. aggregate `npm test` with zero failed tests;
9. instruction mirror consistency check or an explicit documented list of pre-existing drift;
10. scan only added/staged files for private-key markers and high-risk secret assignments. Never print a detected value—report only path and rule ID—and document the limitations of the check;
11. added/staged-file size guard with a documented threshold and narrow allowlist; prove that `.env`, runtime output, private fixtures and generated reports are not staged;
12. `git status --short` and `git diff --stat` review.

Conditional gates:

- Run `npm audit --omit=dev --audit-level=high` when network access is available; record advisories exactly and do not silently upgrade dependencies.
- Run `docker compose config` and a Docker image build/health smoke only if Docker is available. These are mandatory if you change Docker, Compose, runtime dependencies, or image inputs; otherwise an accurately reported environment skip does not block this S0 documentation/test commit.
- Run the smallest relevant existing integration runner only when required slicer binaries/container and legal fixtures are available. Read its generated Markdown report. Lack of those external prerequisites must be reported as `NOT_RUN_ENVIRONMENT`, not green and not a reason to fabricate fixtures/results.

If a mandatory local gate fails, diagnose only failures caused by your changes. Do not silently fix unrelated baseline defects or grant yourself overrides. No S0-B commit while its required gates are red.

## Checkpoints and commit policy

- Keep the change set limited to knowledge files, tests/testability seams, package scripts/lock consistency, truthful test runner exit behavior, and validation-only CI.
- Use at most two atomic local commits with a mandatory diff/self-review between them:
  1. **S0-A:** `docs: add Codex hardening knowledge base`
  2. **S0-B:** `test: establish slicer hardening baseline`
- S0-A may commit after documentation-only checks (`git diff --check`, topology/claim review, staged-file safety) pass. S0-B may commit only after every mandatory local gate above passes.
- Never push it.
- `COMPLETED`: all mandatory and all applicable conditional gates ran and are green.
- `CHECKPOINT_COMMITTED`: mandatory gates are green; only non-applicable or environment-unavailable conditional gates remain, each listed precisely.
- `BLOCKED`: the baseline is unsafe/dirty or a mandatory gate is red; S0-B must not be committed and the report must say `COMMITS: NINCS` if no safe S0-A checkpoint exists.
- Docker/network/native slicer absence alone does not block an unaffected S0 surface, but it must never be reported as green.

## Required final report

Return exactly this structure, in Hungarian, with concise evidence:

```text
STATUS: COMPLETED | CHECKPOINT_COMMITTED | BLOCKED
CODE_BASELINE:
WORK_BASELINE:
BRANCH:
COMMITS:
MODIFIED_FILES:
AUDIT_FINDINGS:
DOCUMENTATION_DISCREPANCIES:
KNOWLEDGE_FILES_CREATED:
IMPLEMENTED_S0_HARDENING:
CONTRACT_PRESERVATION_PROOF:
TESTS_AND_COUNTS:
CI_EVIDENCE:
DOCKER_REPRODUCIBILITY_INVENTORY:
SECURITY_FINDINGS:
UNRUN_OR_BLOCKED_GATES:
KNOWN_RISKS:
NEXT_PARALLEL_ETAPS:
FORBIDDEN_SIDE_EFFECTS_CHECK:
```

The forbidden-side-effects check must explicitly confirm: no push/PR/tag/release, no VPS/deploy, no remote/production API or slicer call, no customer model, no real secret, no LeadPilot modification, no pricing/profile/runtime artifact mutation, and no unrelated worktree damage. Report any disposable local Docker/API smoke separately.
