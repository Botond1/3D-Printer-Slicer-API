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

## Current local checkpoint

S0/S0.1 repository validation is anchored by
`b1411be8cfd68101eb2a3a909b0e1a428e8c111f` (fail-closed validation and
characterization) and `f9ed1ee6791e531670d5d7703f994bfb51986ebb`
(registry/audit dependency remediation). Its committed local gates and
production dependency audit were green with npm 10.9.8. Docker image/health
validation was `NOT_RUN_ENVIRONMENT`; hosted CI, branch protection, deployment
state, and production topology remain `UNVERIFIED`.

S1a upload/workspace lifecycle is `VERIFIED` for the local repository checkpoint
at implementation commit `e7a409566bb8795a22f38bbf9f514b42c51bda74`.
Evidence includes fixed Multer `fieldNestingDepth: 0`, 132/132 JavaScript and
22/22 Python tests, 63 JavaScript and 25 Python syntax files, 163 tracked safety
paths plus the 30-file implementation stage, an exact npm 10.9.8 clean install,
and zero production audit findings.
Docker image/startup smoke was `NOT_RUN_ENVIRONMENT` because the client found no
daemon; hosted CI and all deployment/topology state remain `UNVERIFIED`. This
checkpoint is not production promotion authorization.

The current I1 integration checkpoint is
`I1_CHECKPOINT_BLOCKED_IMAGE`, anchored by runtime commit
`995bb9de750ef2a0ebefb22d8cedf6e19c49cf48`. It integrates, in order,
`a862e2c` (source `78693fe`, dependency maintenance), `4c7df9e` (source
`b91401e`, S3a-B1), `7bc7946` (source `edbe81c`, S3a-V1), `6921f7a`
(source `fd93c0b`, S3a-B2), `d1db7df` (source `67a2922`, S1b), `89369d1`
(source `fd6f4f3`, S1c), `2fee995` (source `d1bc413`, S1c evidence),
`896f3bf` (source `d0d7dc3`, process settlement polling), and then the runtime
commit. Dependency patch ID `5b593dee0baaa1437aedfd4892654bd90c971a4e`
occurs once; duplicate commit `306b799` was not integrated.

I1 now handles `SIGTERM` and `SIGINT` through one single-flight shutdown. It
closes HTTP admission, starts typed queue shutdown, rejects later admission as
`SLICE_QUEUE_SHUTDOWN`, aborts queued and active jobs, waits for both HTTP and
queue drains, and retains an active slot until its task actually settles. The
S1c command contract uses a minimal child environment and bounded TERM-to-KILL
process-tree termination; abort cannot become a later success or released
artifact. Deterministic evidence covers timer, listener, counter, response,
workspace, and process-settlement cleanup.

Local I1 evidence is green for a 175-package clean install, focused
runtime/queue/native tests 48/48, focused quality tests 58/58, aggregate
JavaScript 457/457 and Python 22/22, syntax over 86 tracked JavaScript and 25
Python files, runtime-stage safety over 192
tracked and six staged files, final tracked safety over 196 files, documentation
stage safety over five files, and an offline production audit with zero findings. The online
audit is `BLOCKED_POLICY`; `actionlint` and Docker are unavailable.

Hosted S3a-B2 Source Validation for exact source commit `fd93c0b` passed in run
`29957927228` / job `89051575423` with no annotations or Node 20 warnings.
Image Validation run `29957927370` / job `89051576245` failed. Its retained
artifact is `8545008995` with digest
`sha256:c0c80f843cbea086eb4a8e6a293cd467254b8da67ae1c09b4e84d832a21d3bcc`.
Annotations show liveness exit 1, a Grype HIGH result, scanner-classifier exit
1, and final-gate exit 1. Swiper 7.2.0 advisory
`GHSA-hmx5-qpq5-p643` / `CVE-2026-27212` is an allowed known advisory for
triage, but it is not claimed as the sole failure: the persistent runtime
liveness failure remains unresolved. S3a-V2C's deterministic Swiper vendor
upgrade is not integrated and its worktree/surfaces are untouched.

The historical S1a/S3a manifest freeze was closed by the serialized dependency
patch above. S3a's repository no-deploy workflow separation is integrated, but
its image gate remains blocked. Branch protection, required checks, immutable
registry digest, signature, attestation, promotion, S4, S3b, production
readiness, VPS topology, and deployed state remain `UNVERIFIED`. I1 changes
neither `main` nor the running VPS and grants no deployment permission.
S4 owns service trust and proxy/private-ingress/egress topology; I3 later
implements only its slice-auth/browser-Origin subset. S3b owns staging,
promotion, readiness, and rollback drills only after complete S4 evidence and
separate explicit user/owner authorization. S2 artifact work waits for the S1a
ownership seam, and its container envelope waits for S3a image-control
decisions.

The current I2 branch preserves the I1
queue/native/graceful-shutdown contracts, integrates the deterministic Swiper
12.1.2 remediation into both Orca resource trees, and leaves the exact Orca
v2.3.1 URL/SHA unchanged. Hosted A/B/C evidence verified that root-owned tmpfs
mount roots caused `/app/input/.slice-jobs` startup `EACCES`; the workflow now
resolves nonzero service UID/GID from the immutable image, cross-checks the
running process against host-kernel credentials, and mounts both 64 MiB runtime
tmpfs paths with `rw,nosuid,nodev,noexec`, dynamic UID/GID, and mode `0700`.
Image validation also runs a bounded, network-isolated, exact-image Orca 2.3.1
help and customer-free manifold-cube slice smoke. It validates an Orca 2.3.1
G-code signature plus real extrusion, uses the same contained runtime-profile
generator as production requests, and binds cleanup to the captured container
ID, immutable image ID, and run-owned labels; reusable names alone are never
deletion authority. Exact-candidate hosted Source and Image Validation passed
for commit `05ad6241c566cab593394a094ed36288e0c99165`.
See [`docs/codex/evidence/i2-v2c-liveness-integration.md`](docs/codex/evidence/i2-v2c-liveness-integration.md).
Branch protection/required checks, signature/attestation, registry promotion,
S4, S3b, VPS/deployed state, and production readiness remain `UNVERIFIED`; I2
does not authorize deployment or promotion.

The current I3 worktree is based on exact commit
`6241685f1af0c0a1d4be6f1c229d66ca922fbb88` on branch
`codex/i3-s4a-service-auth-http-envelope`. It implements only bounded S4
service-auth/browser-origin and S2 Node HTTP-envelope subsets. Startup now
requires a separate `SLICE_SERVICE_API_KEY` containing 32-256 bytes of
printable ASCII and different from `ADMIN_API_KEY`. Both slice endpoints use
`x-slicer-api-key`; rejection is exact HTTP 401
`{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`,
uses fixed-length SHA-256 digest comparison with `crypto.timingSafeEqual`, and
logs only request ID plus resolved client IP.
Requests without `Origin` remain allowed; browser-origin slice calls use only
`SLICE_CORS_ALLOWED_ORIGINS`.

Slice admission order is limiter, service authentication, root-scoped
workspace, Multer, queue, then native processing. The application HTTP
defaults/bounds are: headers timeout 60000 `[1000,60000]`, request timeout
600000 `[60000,600000]`, keep-alive timeout 5000 `[1000,60000]`, header count
2000 `[16,2000]`, connections 128 `[1,1024]`, and requests/socket 100
`[1,1000]`. Invalid overrides fall back to their defaults, and effective
headers timeout cannot exceed request timeout. Focused evidence is green, but
the final aggregate, exact implementation SHA, hosted validation, actual VPS
capacity, reverse-proxy timeouts, private ingress/egress topology, deployment,
and production readiness remain pending or `UNVERIFIED`. See
[`docs/codex/evidence/i3-service-auth-and-http-envelope.md`](docs/codex/evidence/i3-service-auth-and-http-envelope.md).

The current I4/S2 worktree is based on exact I3 baseline
`780d64dd786440cb80ddd4df38cb489c16070a07` on branch
`codex/i4-s2-resource-state-envelope`; it is an uncommitted candidate. Central
resource-policy parsing accepts only bounded canonical positive decimal
integers, with omission using defaults and invalid explicit values refusing
startup. It bounds body/upload lifetime, multipart, ZIP/3MF/SL1, model/output/
profile/pricing reads, successful stats/pricing, artifact retention, and
cleanup work. Multipart lifetime expiry is HTTP 408 `UPLOAD_TOTAL_TIMEOUT`.
Successful slices return collision-resistant `job_id` and `artifact_id`;
private metadata, leases, and TTL/count/byte/partial cleanup coordinate managed
artifacts. Primary pricing state is `configs/pricing-state/pricing.json`, with
safe legacy `configs/pricing.json` read/migration fallback and exclusive-temp,
file-fsync, atomic-rename, directory-fsync persistence. The non-root container
uses a read-only root filesystem, root-owned code/profiles, separate writable
input/output/pricing-state binds, restrictive tmpfs, and bounded PID/memory/
CPU/log/stop settings. Exact active-job container stop orchestration remains
`NOT_PROVEN_S2_ACTIVE_JOB_STOP_ORCHESTRATION`; VPS/proxy/topology/egress,
hosted exact-candidate validation, and deployment remain unverified. See
[`docs/codex/evidence/i4-s2-resource-state-envelope.md`](docs/codex/evidence/i4-s2-resource-state-envelope.md).

The current I5/S4 worktree is based on exact I4 baseline
`5be7b19d13616f06504c18217e25bf95c97c6e96` on branch
`codex/i5-s4-trust-topology-observability`. Repository controls now define four
scoped credential audiences (slice, pricing, artifact, operations), active plus
optional previous rotation slots, exact per-audience CORS, fail-closed explicit
proxy peer trust, safe request-ID propagation, public liveness/minimal
readiness, operations-scoped diagnostics/metrics, and versioned redacted
correlation events. The legacy `ADMIN_API_KEY` path is finite: one named
non-slice audience, a maximum 90-day expiry, and no slice/broad/default use.

Baseline hosted Source run `30022045664` and Image run `30022045578` passed for
exact baseline source and image
`sha256:5f159e1051233811ad663175311059829aecdbff16706e39aceba4aac77f9aa3`.
Exact candidate `510e6110ef5c49cd03962627210d6db114554618` passed hosted
Source run `30037842766`; Image run `30037842526` failed closed on independent
active-abort transport and private-inspect contracts. The corrective repository
candidate uses bounded semantic abort outcomes, canonical
`HostConfig.PortBindings`, a separate external-default-route projection, and
one allowlisted topology reason while retaining real ingress/readiness and
API/native egress probes. Compose remains unchanged and no sidecar is invented.
S4 is `IN_PROGRESS` pending both final hosted workflows on one exact SHA.
VPS/proxy/firewall/secret delivery/deployed state,
branch policy, and S3b promotion/readiness/rollback remain pending or
`UNVERIFIED`. No production, push, or deployment authorization is inferred.
See
[`docs/codex/evidence/i5-s4-trust-topology-observability.md`](docs/codex/evidence/i5-s4-trust-topology-observability.md).

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
- Preserve the slice route order: rate limiter, `x-slicer-api-key`
  authentication, root-scoped workspace/Multer upload, queue, then native
  processing. Authentication rejection must allocate no request workspace.
- Keep active and previous slice, pricing, artifact, and operations credentials
  unique and audience-scoped. Rotation is two-restart; previous removal revokes
  the old key. `ADMIN_API_KEY` is legacy-only for one non-slice audience with a
  <=90-day expiry. Never log any credential.
- Keep browser Origin allowlists separate by audience and preserve no-Origin
  service behavior.
- Keep proxy trust disabled by default and compile only explicit validated
  IP/CIDR peers or loopback. Preserve nearest-untrusted-hop spoof resistance.
- Keep public `/ready` minimal and operations diagnostics/metrics protected.
  Events must remain allowlisted/redacted and metrics fixed-cardinality.
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
- Treat `configs/pricing-state/` as private mutable runtime state; keep
  `configs/prusa/` and `configs/orca/` immutable in the container.
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
- Before S3a, a `main` push was configured to attempt deployment. The current
  repository workflows do not automatically deploy on `main` or any validation
  event. Promotion still needs separate verified controls and explicit human
  authorization; validation CI alone does not make a commit production-ready.

## Parallel ownership

Keep first-pass discovery read-only and divide non-overlapping lanes:

- Node/API: bootstrap, middleware, routes, services, OpenAPI, contracts.
- Python/native: converters, transform/orientation, commands, native trust.
- Docker/supply chain: image, Compose, dependencies, CI/deploy/readiness.
- Testability/operations: runners, reports, fixtures, seams, retention, telemetry.

Assign explicit file ownership before parallel edits. Agents are not alone in
the worktree: do not revert others, and reconcile cross-lane findings centrally
before editing shared files.

Parallel lanes return implementation and validation evidence to the integrator.
The integrator alone reconciles canonical shared knowledge after integration;
in the S1a/S3a wave, S3a must not edit `AGENTS.md` or `docs/codex/**` in
parallel with S1a.

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
