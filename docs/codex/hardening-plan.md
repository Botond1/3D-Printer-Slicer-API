# Hardening plan

## Status vocabulary

- `NOT_STARTED`: authorized shape is known; implementation has not begun.
- `IN_PROGRESS`: bounded work is active but exit criteria are not all proven.
- `PENDING_LOCAL_VALIDATION`: implementation and focused evidence exist in the
  active worktree, but mandatory reinstall/audit/full-suite/applicable Docker/
  commit gates are incomplete; this is not verification.
- `BLOCKED`: a required dependency or mandatory gate prevents safe completion.
- `VERIFIED`: every stage exit criterion has evidence; environment-unavailable
  conditional checks are explicitly recorded rather than called green.

This plan was initialized 2026-07-18 from historical code baseline
`899f1916437620ab536e912bf404d8da261cc37f` and work baseline
`02afc555509f00d432c24520601f4c7034becd81`.

## Stage overview

| Stage | Status | Depends on | Parallel ownership | Outcome and exact exit condition |
| --- | --- | --- | --- | --- |
| S0/S0.1 - truthful local baseline and dependency gate | `VERIFIED` | clean authorized baseline | committed validation and dependency-remediation evidence | Commits `b1411be8cfd68101eb2a3a909b0e1a428e8c111f` and `f9ed1ee6791e531670d5d7703f994bfb51986ebb` have green local fail-closed tests, syntax/safety gates, clean install, and zero production audit findings. Environment/external skips are explicit; this is not promotion authorization. |
| S1a - upload and job-workspace lifecycle | `VERIFIED` | `S0/S0.1 VERIFIED` | committed slice upload/workspace lifecycle, focused tests, and canonical wave reconciliation | Commit `e7a409566bb8795a22f38bbf9f514b42c51bda74` allocates marked ownership before persistence, fixes `fieldNestingDepth: 0`, bounds parser counts/sizes, contains transient/output custody, cleans admission/rejection/error/response/success paths, and keeps startup stale recovery audit-only. Exact clean install/audit/full-suite/syntax/safety gates passed; Docker was explicitly environment-unavailable. |
| S1b - queue deadlines and abort contract | `VERIFIED` | S1a workspace ownership | integrated queue scheduling/deadline/counter/runtime lifecycle | Independent deadlines, request/shutdown AbortSignal propagation, typed `SLICE_QUEUE_SHUTDOWN`, single settlement, active-slot retention, and timer/listener/counter/workspace cleanup have deterministic local evidence. |
| S1c - native process lifecycle and environment | `VERIFIED` | S1b AbortSignal contract | integrated command/native process lane | Exact arrays, minimal environment, absolute helper paths, bounded TERM-to-KILL exact-tree cancellation, fail-closed unverifiable-tree quarantine, and no post-abort success/artifact have deterministic local evidence. |
| S2 - resource/state envelope | `NOT_STARTED` | artifact work waits for S1a; process limits integrate with S1b/S1c; container envelope waits for S3a image controls | resource/archive lane; artifact/pricing lane; container-permission lane | Measured HTTP/CPU/RAM/PID/disk/archive/model/output caps fail closed; streaming/actual-byte limits apply; unique artifact correlation plus TTL/count/byte quotas exist; output validity is required before success; pricing writes are atomic with rollback; root filesystem/code/profiles are read-only/root-owned and mutable pricing/input/output are separated. |
| S3a - repository build/provenance and automatic-deploy separation | `BLOCKED` | S0.1; integrated through I1 | exact-candidate, build-once, no-push/no-deploy validation and Node 24 action maintenance are integrated; remaining image/runtime and supply-chain evidence stays fail closed | Exact S3a-B2 source validation is green, but hosted image validation has both an unresolved persistent liveness failure and a HIGH scanner path. Swiper 7.2.0 is known, but is not claimed as the sole failure. Immutable registry digest, signature/attestation, branch policy, promotion, topology, readiness, and rollback are unverified. |
| S4 - service trust and topology | `NOT_STARTED` | S1a/S1b/S1c/S2 security surfaces and S3a design evidence | service auth/policy; proxy/private-ingress and egress topology; observability | Rotatable scoped service auth protects slice and sensitive operations; protected-route policy is consistent; logs/metrics/traces correlate request/job/artifact; proxy trust is tested; private sidecar ingress and egress are restricted. No production promotion without this evidence or explicit human owner/user-approved, documented risk acceptance; an agent cannot grant the exception. |
| S3b - staging and promotion drill | `NOT_STARTED` | S3a evidence; S4 evidence; separate explicit user/owner authorization | staging/promotion/readiness/rollback drill only | Promote a verified immutable artifact through a human-authorized staging gate; readiness is bounded and meaningful; failure restores the prior artifact; the drill is recorded. No authorization or verification is inferred from S1a/S3a/S4 repository work. |
| S5 - optional isolated worker and async API | `NOT_STARTED` | explicit architecture decision after S1a-S4 and S3b evidence | API-version lane; worker-isolation lane; migration lane | Decision record approves cost/complexity; isolated worker enforces resource/network boundaries; versioned async job states, idempotency, cancellation, retention, and compatibility migration are tested without silently changing current endpoints. |

## Current S0.1 verification checkpoint

- Characterization/fail-closed implementation:
  `b1411be8cfd68101eb2a3a909b0e1a428e8c111f`.
- Dependency/CI implementation:
  `f9ed1ee6791e531670d5d7703f994bfb51986ebb`.
- Local deterministic evidence: JavaScript 63/63; Python 22 discovered,
  22 run, 22 pass, 0 failures/errors/skips; syntax 48 JS and 25 Python;
  repository safety 146 tracked paths, with 20 staged paths for the first commit
  and 3 for the dependency commit.
- Exact tooling: npm 10.9.8, local Node v24.11.1, bundled Python 3.12.13.
  Clean install from the final lockfile and the complete local gates passed.
- Locked dependency delta: Express 4.22.1 to 4.22.2, Multer 2.1.1 to 2.2.0,
  body-parser 1.20.4 to 1.20.6, and qs 6.14.2 to 6.15.3. Production audit
  changed from one high plus three moderate findings (four total) to zero at
  every severity. This registry/audit remediation did not itself configure the
  `GHSA-72gw-mp4g-v24j` application nesting-depth mitigation; S1a adds that
  separately.
- Docker image/health smoke is `NOT_RUN_ENVIRONMENT` because no daemon was
  available and no Docker resource was created. Hosted CI and external branch
  protection are `UNVERIFIED`.

`VERIFIED` here means the local S0/S0.1 baseline gates and dependency audit are
green. It does not verify deployment, production topology, service
authentication, or authorize a `main` promotion.

## Current S1a verification checkpoint

- Runtime implementation creates a random marked workspace under
  `input/.slice-jobs` before Multer persists bytes and gives the route one
  awaited cleanup `finally` across upload, queue settlement, processing,
  response completion, and success.
- Upload, extracted, converted, oriented, transformed, engine-staging, and
  request-time profile files are contained in that workspace. A final output is
  exclusively promoted to a registered direct child of `output/` and released
  only after the success response finishes.
- Multipart defaults are finite: `fileSize: 524288000`, `files: 1`,
  `fields: 40`, `parts: 42`, `fieldNameSize: 64`, `fieldSize: 65536`, and fixed,
  non-configurable `fieldNestingDepth: 0`. Busboy 1.6.0 retains the internal
  fixed `MAX_HEADER_PAIRS = 2000`; no configurable lower header-pair limit is
  claimed.
- Focused live synthetic evidence sends a file before `a[b]`, observes Multer
  `LIMIT_FIELD_NESTING` mapped to HTTP 400 /
  `UPLOAD_FIELD_NESTING_TOO_DEEP`, and waits for zero request-owned residue.
  Focused workspace, parser, route, output-settlement, recovery, and adversarial
  mutation tests cover the other S1a properties semantically; no unstable
  aggregate count is recorded here.
- Startup awaits immediate-child stale classification before listening and is
  report-only. Programmatic deletion requires exclusive-lease proof plus a
  stale threshold beyond a bounded lifetime and safety margin, so production
  deletion remains disabled in S1a.
- Implementation commit: `e7a409566bb8795a22f38bbf9f514b42c51bda74`.
  Exact npm 10.9.8 clean installation and production audit passed with zero
  findings. Full local evidence is 132/132 JavaScript tests, 22/22 Python tests,
  syntax over 63 JavaScript and 25 Python files, safety over 163 tracked paths
  and the 30-file implementation stage, plus green whitespace and mirror gates.
- Docker build/startup smoke is `NOT_RUN_ENVIRONMENT`: Docker client 29.6.1
  could not find a daemon and no resource was created. S1a is locally
  `VERIFIED`; S3a, S4, S3b, hosted CI, production topology, and promotion remain
  unverified.

## Current I0 S1a/S3a integration checkpoint

- S1a upload/workspace/multipart behavior remains integrated unchanged.
- S3a/S3a.1 adds exact-candidate checkout, one run-local image reused across
  smoke/SBOM/scan, no registry push or deployment, and a dynamic
  `merge-base(origin/main, candidate)..candidate` whitespace gate with ancestry
  proof and no empty fallback.
- On exact original S3a.1 commit
  `4f55062096d57a9245282b686fd8619c29c473e8`, hosted Source Validation run
  `29680527745` passed. Hosted Image Validation run `29680527711` failed closed;
  its cause is `UNVERIFIED` and the HIGH/CRITICAL gate must not be weakened.
- Branch protection, required checks, immutable registry digest,
  signature/attestation, promotion, production readiness, VPS topology, and
  deployed state remain `UNVERIFIED`. I0 changed neither `main` nor the running
  VPS.

## Current I1 S1c/S3a integration checkpoint

- Canonical status: `I1_CHECKPOINT_BLOCKED_IMAGE` at runtime commit
  `995bb9de750ef2a0ebefb22d8cedf6e19c49cf48`.
- Integrated equivalents, in order: `a862e2c` from `78693fe`, `4c7df9e` from
  `b91401e`, `7bc7946` from `edbe81c`, `6921f7a` from `fd93c0b`, `d1db7df`
  from `67a2922`, `89369d1` from `fd6f4f3`, `2fee995` from `d1bc413`,
  `896f3bf` from `d0d7dc3`, then `995bb9d`.
- Dependency patch ID `5b593dee0baaa1437aedfd4892654bd90c971a4e`
  appears once. Duplicate `306b799` was not picked.
- `SIGTERM`/`SIGINT` now enter one single-flight shutdown that closes HTTP,
  begins typed queue shutdown, aborts queued and active jobs, and awaits both
  drains. Active capacity is held until task settlement; cancellation cannot
  become later success or artifact release.
- S1c propagates the effective signal through every native phase, supplies a
  minimal child environment, and uses bounded TERM-to-KILL exact-tree
  termination. Timers, listeners, counters, response/workspace custody, and
  process polling clean or settle deterministically.
- Local evidence: clean install 175; runtime/queue/native 48/48; quality-focused
  58/58; aggregate JavaScript 457/457 and Python 22/22; syntax 86 tracked
  JavaScript and 25 Python files; runtime-stage safety 192
  tracked/six staged, final tracked safety 196, and documentation-stage safety
  five staged; offline audit zero. Online audit is `BLOCKED_POLICY`; `actionlint`
  and Docker are unavailable.
- The transient Graphify service map covered 30 code files, 411 nodes, 767
  edges, 15 communities, and 659 extracted/108 inferred relations, without
  missing, dangling, self-loop, or duplicate relation edges. Output was removed.
- Exact S3a-B2 source commit `fd93c0b` passed hosted Source run `29957927228` /
  job `89051575423` with no annotations or Node 20 warnings. Image run
  `29957927370` / job `89051576245` failed; artifact `8545008995` has digest
  `sha256:c0c80f843cbea086eb4a8e6a293cd467254b8da67ae1c09b4e84d832a21d3bcc`.
  Annotations show liveness exit 1, Grype HIGH, scanner-classifier exit 1, and
  final-gate exit 1.
- Swiper 7.2.0 `GHSA-hmx5-qpq5-p643` / `CVE-2026-27212` is known and allowed
  for bounded triage, but persistent runtime liveness is independently
  unresolved. S3a-V2C is not integrated and its worktree/surfaces are untouched.
- Branch protection, required checks, registry digest/signature/attestation,
  promotion, S4, S3b, production readiness, VPS/deployed state remain
  `UNVERIFIED`. No production authorization or side effect is inferred.

## Current I2 V2C and liveness closure

- Exact baseline `c6110e197ebe7e95d15ba597954108297251fb7b`; V2C equivalents
  `cf45524` then `9f8ae6b`; executable correction checkpoint
  `17c8a04c440c2ca75f8a5cadbfbe97682ea611a3`.
- I1 queue deadline, shutdown, capacity ownership, native process-tree, minimal
  environment, and no-post-abort-success contracts remain green.
- Swiper 12.1.2 is transactionally installed into both Orca trees and verified
  offline; Orca v2.3.1 URL/SHA and Node 24-compatible Action pins remain.
- Hosted A/B/C evidence verifies tmpfs ownership as the liveness root cause.
  The final fix dynamically resolves nonzero service UID/GID, cross-checks the
  running kernel credentials, mounts both runtime paths at 64 MiB with
  `rw,nosuid,nodev,noexec,uid,gid,mode=0700`, and keeps `USER slicer`.
- Exact cleanup and one terminal cleanup classification precede the fail-closed
  final aggregator. The one-time A/B/C matrix is absent from the final workflow;
  bounded identity/state/log, SPDX, and Grype evidence remains.
- I2 closes repository image validation only. Branch protection/required checks,
  signature/attestation, registry promotion, S4, S3b, VPS/deployed state, and
  production readiness remain `UNVERIFIED`; deployment is not authorized.

## S0 work package and gates

S0 is behavior-preserving. Production edits are limited to exporting an
existing helper or a default-preserving test seam; notably,
`resolveValidatedOutputFile` remains a filesystem-checking helper rather than a
pure function. Server bootstrap/listen,
middleware/route order, queue scheduling, filesystem lifecycle, command
arguments, slicer/pricing behavior, Docker runtime, profiles, and public
contracts must remain unchanged.

S0 exit criteria:

1. Thin `AGENTS.md`, project map, security model, and this plan cite executable
   evidence and label external state `UNVERIFIED`.
2. `node:test` covers value/options/profile traversal, middleware/error mapping,
   queue FIFO/concurrency/client cap/overflow/typed mapping, inert admin auth,
   safe output naming, structured OpenAPI, selected source mappings, and byte
   equality of intentional instruction mirrors.
3. Standard-library `unittest` stubs scenario execution and proves success/fail
   process exit propagation for the combined and all three engine wrappers.
4. Complete Git-tracked JavaScript syntax uses `node --check`; Python syntax is
   AST/source compiled without `.pyc` or cache residue.
5. `test:js`, `test:python`, aggregate `npm test`, and the CI top-level command
   run truthfully with zero failed unit tests.
6. Validation-only CI runs for PRs, non-`main` pushes, and dispatch with
   `contents: read`, no deploy secrets/calls/write permissions, and no
   `pull_request_target`.
7. Lockfile install, diff whitespace, mirror drift, staged secret/size/artifact
   safety, status/stat review, and applicable conditional gates are evidenced.
8. The existing deploy workflow is unchanged. Promotion to `main` is explicitly
   deferred to a separate human-approved change window/integration decision or
   prior deployment-trigger safety work.
9. S0.1 uses exact npm 10.9.8 for lock generation and CI, a clean install passes,
   and the full production audit has zero findings at every severity. This exit
   covers registry/audit remediation, not the S1a application-level multipart
   nesting-depth mitigation.

`NOT_COVERED_S0`: real queue deadlines, upload cleanup on queue rejection,
abort/process-tree termination, server factory/root injection, timestamp/output
collision, zero-stat output rejection, retention, pricing atomicity, protected
pricing CORS, readiness, production authentication redesign, multipart parser
limits beyond `fileSize`, total upload/request/header/socket/connection limits,
and `runCommand` argument/environment integrity.

Historical S0 verification snapshot (2026-07-18): lockfile installation completed with
`npm ci --ignore-scripts --no-audit --no-fund`; dynamic syntax, JavaScript and
Python unit tests, mirror equality, index safety, and whitespace gates passed.
The network-enabled audit reported one high and three moderate package findings
for the locked Multer/Express dependency graph; S0 did not silently change
dependency versions (D-011). Compose configuration validated with the available
standalone client, while image/health smoke was `NOT_RUN_ENVIRONMENT` because no
Docker daemon was reachable. Native integration runners were
`NOT_RUN_ENVIRONMENT` because only the tracked `.gitkeep` fixture exists; neither
conditional skip is represented as green.

## S1a/S1b/S1c detailed exit criteria

S1a owns upload and workspace lifecycle:

- Allocate a unique job directory before any persistent upload; store every
  request-time intermediate path under it. Preserve the existing public final
  artifact naming contract for S2 rather than inventing correlation in S1a.
- Configure finite multipart file/field/part/name/value limits, fixed
  non-configurable `fieldNestingDepth: 0`, and stable public mappings. Generated
  requests must prove every configured limit fails closed and removes every
  owned byte. Record Busboy 1.6.0's actual fixed
  `MAX_HEADER_PAIRS = 2000`; do not claim a configurable header limit that the
  parser does not consume.
- Keep rate-limit rejection before workspace allocation. Because queue admission
  follows persistence, guarantee cleanup in one awaited ownership boundary for
  queue full, client cap, and dequeue-time expiry without changing queue
  scheduling.
- Register cleanup targets before launch; orientation failure cannot leave
  untracked artifacts. Audit immediate stale workspaces at startup with
  containment, age, and ownership guards; production deletion remains disabled
  until exclusive lease and bounded-lifetime preconditions are proven.
- S1a verification requires every mandatory reinstall/audit/full-suite/staged
  safety/commit gate; an environment-unavailable conditional Docker check is
  recorded explicitly and is never called green.

S1b follows S1a and owns queue deadlines plus the AbortSignal contract:

- Enforce deadline with a real timer/abort signal; a blocked active worker cannot
  postpone queued rejection. Remove timer/listener state on every completion.
- Convert client disconnect and shutdown into the same single-settlement abort
  contract. Prove counters, timer/listener cleanup, response mapping, and
  workspace cleanup across concurrency, abort, and expiry paths.

S1c follows that AbortSignal contract and owns native process execution:

- Cancel converters/slicers and descendants on deadline/client abort/shutdown;
  prove TERM grace, KILL escalation, no orphan, and response mapping.
- Establish the smallest explicit child-process environment allowlist. Dynamic
  tests must prove required runtime entries survive while `ADMIN_API_KEY`, an
  inert secret marker, and unrelated API environment variables do not.
- Resolve Python helpers relative to their module/application root locally while
  preserving flattened `/app` image behavior. Prove exact executable/argument
  arrays and environment separately; never introduce shell interpolation.

## S2 detailed exit criteria

- Establish measured per-request/model/archive limits, including actual streamed
  bytes, nesting/type policy, finite geometry/stat validation, and bounded output
  reads. No healing is introduced.
- Require a contained regular non-symlink output of allowed type and size plus
  finite/range-checked stats before returning success; zero-stat success is not
  preserved as a contract.
- Generate collision-resistant job/artifact IDs; return/record correlation and
  enforce TTL, count, byte, partial-output, and stale cleanup policies.
- Persist pricing by validated temp write, fsync/atomic replace where supported,
  rollback in-memory state on failure, and test crash/failure behavior.
- Run with read-only root filesystem and root-owned application/native code;
  mount profiles read-only and separate writable pricing, input, and output.
- Measure and enforce total upload duration, request/header/socket deadlines,
  connection/concurrency limits, CPU, RAM, PID, temp/output disk, log, and
  egress-aware resource bounds; generated bomb/limit tests fail closed without
  customer fixtures.

## S3a detailed exit criteria

- Inventory and verify upstream provenance before pinning Ubuntu digests,
  NodeSource/Apt inputs, Python versions/hashes, Action SHAs, and Compose images.
  Do not invent pins or hashes. During the S1a/S3a parallel wave, do not edit
  `package.json` or `package-lock.json`.
- Install Node from the lockfile with lifecycle-script policy justified; build in
  clean CI once; record commit and image digest.
- Produce and retain SBOM, vulnerability results, signature, and provenance;
  make the verified digest available to later authorized promotion.
- Separate validation/build from automatic deployment so a validation or `main`
  event cannot silently deploy a mutable checkout. Verify workflow permissions,
  immutable artifact identity, external branch protection, and required checks
  rather than inferring them from workflow text.
- Return repository/build evidence to the integrator. Do not edit `AGENTS.md` or
  `docs/codex/**` in parallel; do not claim staging, topology, promotion,
  readiness, or rollback verification.

## S4 detailed exit criteria

- Define key audience/scope/rotation/revocation and authorize every protected
  route consistently, including public slice endpoints; avoid distributing a
  single broad admin key.
- Apply one explicit browser-origin policy to all protected operations, including
  pricing, while preserving non-browser service behavior and stable errors.
- Test proxy hop/CIDR behavior; deploy only behind the verified private topology.
- Emit structured, sanitized request/job/artifact events, bounded native
  diagnostics, queue/resource metrics, and actionable readiness alerts.
- Restrict sidecar ingress to the intended caller and egress to required
  dependencies. LeadPilot changes remain a separate repository authorization.
- If production is proposed without any required S4 control, require explicit
  human owner/user-approved, documented risk acceptance. An agent cannot approve
  its own production exception.

## S3b detailed exit criteria

- Begin only after S3a repository evidence and S4 service-auth/topology evidence
  exist and the user/owner separately and explicitly authorizes the staging and
  promotion drill.
- Promote only the verified immutable digest through a human approval/change
  window with non-overlapping deployment concurrency and an immutable previous
  digest.
- Readiness uses bounded retries and proves Python, slicer executables/profiles,
  writable state, and a safe synthetic operation as appropriate; `/health`
  liveness alone is insufficient.
- A failed rollout automatically restores the prior artifact, and the staging,
  readiness, and rollback drill evidence is recorded. Repository evidence alone
  cannot mark S3b or production promotion verified.

## S5 decision gate

S5 proceeds only if threat/performance evidence shows that S1-S4 in-process
controls are insufficient or asynchronous work is a product requirement. The
decision must compare isolation, operational complexity, migration risk, queue
durability, API compatibility, and cost. No `/v1` or async job contract is added
before that decision.

## Parallel sequencing and integration

The S1a/S3a parallel-wave manifest freeze is closed. Its separate serialized
dependency-maintenance patch is integrated exactly once. A future advisory
still requires a newly authorized serialized owner for manifest/lock edits and
fresh reinstall/audit evidence.

S1a owns upload/job-workspace lifecycle and canonical knowledge corrections for
this wave. S3a owns repository-only Docker/build/provenance and
automatic-deploy separation; S3a must not edit `AGENTS.md` or `docs/codex/**` in
parallel. Each lane returns implementation and validation evidence. After
integration, the integrator alone reconciles canonical shared knowledge against
the integrated tree.

S1b and S1c are integrated at I1: real queue deadlines, abort propagation,
graceful runtime shutdown, process-tree cancellation, exact command integrity,
and subprocess-environment minimization are locally verified.
S2 artifact lifecycle waits for S1a, while its container envelope waits for S3a
image-control decisions. S4 then supplies service authentication and verified
proxy/private ingress/egress topology. S3b may run staging, promotion, readiness,
and rollback drills only after S4 evidence and separate explicit user/owner
authorization. No production promotion occurs without those verified gates or
explicit human owner/user-approved, documented risk acceptance; an agent cannot
grant itself the exception.

## Decision and risk log

| ID | Decision / risk | Evidence and consequence | Owner / resolution |
| --- | --- | --- | --- |
| D-001 | S0 recorded upload residue and false deadlines; S1a fixed workspace ownership and I1 adds independent queue timers. | Multer still precedes queue admission, but the route awaits safe settlement and cleanup; queued timeout no longer waits for worker availability ([project map](project-map.md)). | S1b locally verified; S2 owns the wider HTTP/resource envelope |
| D-002 | Do not characterize vulnerability outcomes as desired behavior. | Durable tests cover safe FIFO/caps/mappings, not delayed expiry, residue, collision, or zero-stat success. | All test owners |
| D-003 | Local Python path divergence was real at S0. | I1 resolves allowlisted helpers absolutely from the application module while preserving flattened `/app` image behavior. | S1c locally verified |
| D-004 | Validation CI does not protect `main` by itself. | Branch rules/required checks remain external `UNVERIFIED`; the former automatic `main` deploy is removed, but workflow text alone does not enforce repository settings. | repository admin required-check verification; S3b promotion gate |
| D-005 | Do not invent Action SHAs, image digests, Python hashes, or versions. | Provenance must be verified upstream first. | S3a build lane |
| D-006 | `/health` remains liveness in S0. | It returns status/uptime only; deploy uses it as smoke. | S3b readiness drill after S4 |
| D-007 | Pricing CORS inconsistency is not an auth bypass but remains high-risk policy drift. | API key still applies; Origin classification covers only `/admin/**`. | S4 auth/policy lane |
| D-008 | Successful outputs need explicit ownership/retention, not timestamp folklore. | No response correlation, TTL, quota, or collision resistance. | S2 artifact lane |
| D-009 | Native compromise is contained only partially. | Non-root/cap-drop/PID exist, but code/config/state and network remain writable/available. | S2/S5 |
| D-010 | Promotion to `main` was not part of S0 completion. | At S0 the workflow could deploy every `main` push. S3a has since removed that repository path without creating a replacement promotion mechanism. | S4 then separately authorized S3b promotion design |
| D-011 | S0.1 remediated the registry/audit findings, but that result alone did not complete the application mitigation for deeply nested multipart fields. | Commit `f9ed1ee6791e531670d5d7703f994bfb51986ebb` locks Multer 2.2.0 and the other verified non-major fixes, and its production audit is zero. S1a commit `e7a409566bb8795a22f38bbf9f514b42c51bda74` separately configures and live-tests fixed `limits.fieldNestingDepth: 0`. | S0.1 registry/audit remediation and S1a application mitigation locally verified |
| D-012 | Native children require both secret minimization and egress control. | I1 supplies a tested minimal environment excluding API secrets, but parser/slicer processes still share unrestricted container egress. | S1c environment verified; S4 topology/container egress gate before promotion |
| D-013 | Public slice routes have no application service authentication. | Rate limiting is not caller authentication, and private/localhost topology is an independent external control currently `UNVERIFIED`. | S4 service-auth/private-topology evidence, or explicit human owner/user-approved, documented risk acceptance; an agent cannot grant the exception. S3b blocks promotion meanwhile. |
| D-014 | `fileSize` alone was not a complete multipart/HTTP resource envelope. | S1a now locally verifies finite file/field/part/name/value limits and fixed `fieldNestingDepth: 0`, with live file-first rejection/cleanup evidence; Busboy keeps a fixed 2000 header-pair boundary. Total upload time, request/header/socket timeouts, connection limits, and measured resource envelopes remain open. | S2 measured server and connection envelope |
| D-015 | A `main` push could historically deploy independently of validation CI. | S3a removed that path. Exact S3a-B2 source is green, but image liveness and HIGH scanning remain red; required checks and branch protection are external `UNVERIFIED`. | S3a image/runtime diagnosis plus repository policy verification; S3b only after S4 and separate authorization |
| D-016 | The manifest/lock freeze was limited to the S1a/S3a parallel wave. | The dependency patch is now integrated once by patch ID; duplicate `306b799` was not picked. | Future advisory work requires a new serialized owner and audit evidence |
| D-017 | Parallel lanes return evidence; the integrator owns canonical reconciliation. | I1 reconciliation supersedes historical stage status without rewriting historical evidence files. | Integrator maintains `AGENTS.md` and `docs/codex/**` after integration |
| D-018 | Graceful shutdown must drain both HTTP and queue work without early capacity release. | `SIGTERM`/`SIGINT` are single-flight; queue shutdown aborts queued/active work, closes HTTP, and awaits both drains while active slots remain owned until task settlement. | I1 runtime lifecycle locally verified |
| D-019 | A known image advisory does not explain away an independent liveness failure. | Hosted Image run `29957927370` shows both persistent liveness exit 1 and the HIGH scanner path. Swiper 7.2.0 is known, but S3a-V2C is not integrated. | S3a remains blocked; diagnose/fix both paths without weakening gates |
| D-020 | I2 separates the verified tmpfs liveness root cause from the Swiper advisory. | Exact A/B/C and main-container evidence proves root-owned tmpfs mount roots caused startup `EACCES`; V2C independently produces zero `GHSA-hmx5-qpq5-p643` findings. Dynamic nonzero UID/GID plus kernel cross-check and mode `0700` fix liveness without root or world-writable state. | I2 repository image validation closed; external policy, provenance/promotion, S4/S3b, and production evidence remain required |
