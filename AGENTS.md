# Codex operating guide

## Mission and scope

Maintain this standalone 3D Printer Slicer API as a security-sensitive Node.js,
Python, native-slicer, and container system. Work only in this repository. The
production target is a private Hostinger sidecar, never a public slicing
service; LeadPilot and WooCommerce plugin changes are always outside this
repository's authority.

This is a thin Codex-specific routing layer. It is independent of the manually
mirrored Claude/Copilot corpus in `CLAUDE.md`, `.claude/**`, and `.github/**`.
Link to that corpus for domain detail; do not create or maintain a third mirror.

Canonical Codex knowledge:

- `docs/codex/project-map.md` - verified topology, behavior, and drift.
- `docs/codex/security-model.md` - threats, controls, and accepted risks.
- `docs/codex/hardening-plan.md` - staged work, dependencies, and exit criteria.

Current-state references (read these before the historical material):

- `docs/integration-guide.md` - the consumer contract as of 3.3.0.
- `docs/codex/handoff-2026-09-03.md` - operator handoff, traps, open items
  (`handoff-2026-09-02.md` still holds the three-engine FDM material).
- `CLAUDE.md` section "Current contract (3.3.0, 2026-09-03)" - every retained
  hard rule with its exact value.
- `CHANGELOG.md` - the 3.3.0 entry lists every consumer-visible change.

## Current state (3.3.0, 2026-09-03)

Classification:
`THREE_ENGINES_PRUSA_2_8_1_ORCA_2_3_1_BAMBU_02_08_02_61;
SLA_QUOTING_ELEGOO_SATURN_4_ULTRA_PRICED_FROM_LAYER_COUNT_MODEL;
BAMBU_CLI_EQUALS_OWNER_GUI_ON_10_REFERENCE_MODELS;
BAMBU_ENVELOPES_MEASURED_P1S_256x228x250_ALT_238x256_H2D_325x320x325;
SATURN_ENVELOPE_DECLARED_NOT_MEASURED_SLA_TIME_MODEL_UNCALIBRATED;
PRODUCTION_RUNS_SIGNED_MAIN_CANDIDATE_4FB770D7;
PUBLIC_ROUTE_ACTIVE_LEADPILOT_ONLY_NO_CUSTOMER_TRAFFIC;
FURTHER_DEPLOY_REGISTRY_ROUTE_DNS_ALLOWLIST_CONSUMER_CHANGES_NOT_AUTHORIZED`.

- `main` is the only branch. The service has three engines: `POST /bambu/slice`
  (Bambu Studio 02.08.02.61, official BBL vendor chain, API-owned placement,
  `.gcode.3mf` artifact), `POST /orca/slice`, and `POST /prusa/slice` for both
  FDM and the Elegoo Saturn 4 Ultra SLA quoting path, plus `POST /render`
  (deterministic 1024 x 768 PNG of the final pose). `supports` and strict
  `infill` apply on every engine, pricing is integer-rounded, and the runtime
  budgets are the ones listed in `CLAUDE.md`. `GET /profiles` publishes 88 rows
  (82 FDM + 6 `SATURN4U` SLA).
- SLA quotes are priced from the deterministic layer-count time model
  `sla-layer-time-v1` (`configs/sla/printers.json`) and a resin-density mass;
  the `.sl1` raster stays quote-only (a printable `.goo` needs UVtools). The
  per-layer motion time is an assumption until the owner calibrates it, and the
  Saturn's admission ceiling mirrors its declared metadata rather than a
  measured native edge.
- Production runs the signed main candidate for
  `4fb770d792eac932f02a6c9b3f407a7822a1996b`
  (`ghcr.io/botond1/3d-printer-slicer-api@sha256:c32b4c6f659b6b75cd504213014c1c95da9ab6d293b18906e8f3c78425f3159b`)
  behind the LeadPilot-only route, deployed and verified on 2026-09-03 as
  recorded in `docs/codex/handoff-2026-09-03.md`; the 3.2.0 release stays on the
  host for rollback. Both consumers are integrated in contract and neither is
  switched on, so there is no customer traffic. Every further publication still
  requires the manual `workflow_dispatch` from protected `main`, and deploy,
  route, DNS, allowlist, and consumer mutation each require separate owner
  authorization.
- The pre-3.2.0 narrative (J0..J3B, I10..I12, Hostinger route activation and
  perimeter persistence) is preserved verbatim in
  `docs/codex/history-waves.md`; the evidence files under `docs/codex/evidence/`
  are unchanged. Superseded facts are flagged at the top of that file.

## Authority and evidence

Use sources in this order:

1. current user instructions and the authorized execution prompt;
2. executable source, route wiring, OpenAPI generator, manifests, Docker and
   Compose files, workflows, and tests;
3. the Codex knowledge files above;
4. Claude/Copilot instructions, README, changelog, and operational prose.

Treat documentation-only claims as `UNVERIFIED` until code or runtime evidence
supports them. Cite repository paths and symbols in durable knowledge changes.
Local unit results never prove native-slicer or deployed behavior; behavior
that depends on the binaries is proven only on the built image.

## Read before changing

- Any change: this file, the three Codex knowledge files, root `CLAUDE.md`, and
  the applicable folder-local `CLAUDE.md` / `.github/instructions/**` overlay.
- API or Node runtime: `app/server.js`, applicable route/middleware/service
  modules, `app/docs/swagger-docs.js` plus the per-surface OpenAPI modules, and
  `app/CLAUDE.md`.
- Python/native processing: all affected `app/*.py` (including
  `render_preview.py`), `app/services/slice/command.js`, `input-processing.js`,
  `transform.js`, `bambu-placement.js`, `bambu-bed-geometry.js`,
  `bambu-profile-chain.js`, profiles, and `Dockerfile` layout.
- Tests: `tests/testing-scripts/CLAUDE.md`, common helpers, the complete affected
  runner, and its generated Markdown report after an integration run.
- Container/supply chain: `Dockerfile`, `scripts/bambu-studio-wrapper.sh`, all
  three Compose files, `.dockerignore`, manifests/lockfiles, `requirements.txt`,
  `.env.example`, and all workflows.
- Profiles/pricing: `configs/CLAUDE.md`, `configs/bambu/printers.json`,
  resolver/persistence code, and only the specific tracked profiles required to
  understand compatibility.

## Compatibility invariants

- Keep runtime state in root-scoped `input/`, `output/`, and `configs/`; never
  introduce `app/input`, `app/output`, or `app/configs`.
- Preserve the legacy multipart field spelling `choosenFile` until a separately
  versioned migration is authorized.
- Preserve public endpoint, response-field, status-code, error-code, pricing,
  profile, and slicer-command semantics unless a contract-change stage says
  otherwise. The consumer-visible contract is `docs/integration-guide.md`.
- Preserve the slice route order: rate limiter, `x-slicer-api-key`
  authentication, root-scoped workspace/Multer upload, option and profile
  validation, queue, then native processing. Authentication rejection must
  allocate no request workspace; a validation 400 must consume no queue slot.
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
- Reject invalid geometry fail-fast as `INVALID_SOURCE_GEOMETRY` (converter
  marker) or `UNSLICEABLE_SOURCE_GEOMETRY` (native refusal); do not heal,
  repair, or mutate user geometry automatically.
- Preserve Prusa FDM/SLA, Orca FDM-only, and Bambu FDM-only engine boundaries,
  Orca profile pairing, and the Bambu registry-bound printer/process/material
  selection. Keep Orca at `--arrange 1 --orient 0 --allow-rotations=0` and
  Bambu at `--arrange 0 --orient 0` with API-owned placement.
- Keep the measured inclusive ceilings, the L-shaped P1S admission, the
  `.gcode.3mf` artifact extension, the schema-2 transform invariants, the
  integer price formula, and the Saturn 4 Ultra SLA time/mass model as stated in `CLAUDE.md`.

## Security and destructive-action boundaries

- Never use or commit real secrets or `.env`. Use explicit inert test values.
- Never commit a real IP address, hostname, or credential; documentation uses
  RFC 5737 ranges and `.invalid` hostnames deliberately.
- Never read or publish `docs/research/`; it is gitignored operator material.
- Do not call production/remote APIs or slicers with customer data. Synthetic,
  disposable local tests require an explicit in-scope gate. The owner's Bambu
  reference models and readings stay private; calibration reports identify
  models by index and SHA-256 prefix only.
- Do not weaken queue, rate, auth, proxy, CORS, path, symlink, ZIP, timeout, or
  geometry controls to make a test pass.
- Do not mutate pricing, slicer profiles, the Bambu registry, runtime
  artifacts, private fixtures, or generated reports during unit validation.
- Treat `configs/pricing-state/` as private mutable runtime state; keep
  `configs/prusa/`, `configs/orca/`, and `configs/bambu/` immutable in the
  container.
- Resolve destructive targets first. Never clean, reset, overwrite, or absorb an
  unrelated dirty worktree.
- A suspected vulnerability is not a desirable contract. Characterize safe
  behavior and record the secure expectation in the hardening plan.

## Git and live-cloud boundaries

- Start with read-only checks for root, remote, HEAD, branch, status, and the
  authorized baseline diff. Stop on unexpected changes.
- Work only on an authorized branch or isolated linked worktree. Never edit
  `main` directly; `main` requires a PR and merge commits only.
- Do not fetch, pull, push, open a PR, tag, release, deploy, SSH, or contact the
  VPS unless the current user explicitly authorizes that exact action.
- Validation CI never deploys. Candidate publication is manual
  `workflow_dispatch` from exact protected `main`; promotion still needs
  separate verified controls and explicit human authorization.

## Parallel ownership

Keep first-pass discovery read-only and divide non-overlapping lanes:

- Node/API: bootstrap, middleware, routes, services, OpenAPI, contracts.
- Python/native: converters, transform/orientation/placement, renderer,
  commands, native trust.
- Docker/supply chain: image, wrapper, Compose, dependencies, CI/deploy/readiness.
- Testability/operations: runners, reports, fixtures, seams, retention, telemetry.

Assign explicit file ownership before parallel edits. Agents are not alone in
the worktree: do not revert others, and reconcile cross-lane findings centrally
before editing shared files. The integrator alone reconciles canonical shared
knowledge after integration.

## Validation gates

Always run the smallest relevant checks first and report exact commands, exit
codes, and counts:

1. `git diff --check` and complete tracked-source JS/Python syntax validation
   (`npm run check:syntax`);
2. deterministic JavaScript and Python unit suites (`npm run test:js`,
   `npm run test:python`), then aggregate `npm test`;
3. instruction-mirror drift (`tests/unit/js/instruction-mirrors.test.js`) and
   the tracked-file safety guard (`npm run check:repository-safety`);
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
contract actually changes, and preserve byte equality of intentional mirrors
(`.github/agents` == `.claude/agents`, `.github/skills` == `.claude/skills`).
Keep the historical narrative in `docs/codex/history-waves.md` verbatim; add a
dated handoff under `docs/codex/` instead of rewriting history.

## Required handoff

State status, code/work baselines, branch, local commits, modified files, audit
findings, documentation drift, implemented hardening, contract-preservation
evidence, exact test/gate results, CI/Docker evidence, remaining risks, next
parallel stages, and forbidden-side-effect confirmation. Distinguish `PASS`,
`NOT_RUN_ENVIRONMENT`, and `BLOCKED`; never present a skip as a pass.
