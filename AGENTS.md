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

## Authority and evidence

Use sources in this order:

1. current user instructions and the authorized execution prompt;
2. executable source, route wiring, OpenAPI generator, manifests, Docker and
   Compose files, workflows, and tests;
3. the Codex knowledge files above;
4. Claude/Copilot instructions, README, changelog, and operational prose.

Treat documentation-only claims as `UNVERIFIED` until code or runtime evidence
supports them. Cite repository paths and symbols in durable knowledge changes.

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
- A `main` push is currently configured to attempt deployment. Promotion needs a
  separate human-approved change window and integration decision; validation CI
  alone does not make a commit production-ready.

## Parallel ownership

Keep first-pass discovery read-only and divide non-overlapping lanes:

- Node/API: bootstrap, middleware, routes, services, OpenAPI, contracts.
- Python/native: converters, transform/orientation, commands, native trust.
- Docker/supply chain: image, Compose, dependencies, CI/deploy/readiness.
- Testability/operations: runners, reports, fixtures, seams, retention, telemetry.

Assign explicit file ownership before parallel edits. Agents are not alone in
the worktree: do not revert others, and reconcile cross-lane findings centrally
before editing shared files.

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
