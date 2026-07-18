# Hardening plan

## Status vocabulary

- `NOT_STARTED`: authorized shape is known; implementation has not begun.
- `IN_PROGRESS`: bounded work is active but exit criteria are not all proven.
- `BLOCKED`: a required dependency or mandatory gate prevents safe completion.
- `VERIFIED`: every stage exit criterion has evidence; environment-unavailable
  conditional checks are explicitly recorded rather than called green.

This plan was initialized 2026-07-18 from historical code baseline
`899f1916437620ab536e912bf404d8da261cc37f` and work baseline
`02afc555509f00d432c24520601f4c7034becd81`.

## Stage overview

| Stage | Status | Depends on | Parallel ownership | Outcome and exact exit condition |
| --- | --- | --- | --- | --- |
| S0/S0.1 - truthful local baseline and dependency gate | `VERIFIED` | clean authorized baseline | S0.1 solely owns manifests/lockfile, validation scripts, validation CI, and current-state docs | Commits `b1411be8cfd68101eb2a3a909b0e1a428e8c111f` and `f9ed1ee6791e531670d5d7703f994bfb51986ebb` have green local fail-closed tests, syntax/safety gates, clean install, and zero production audit findings. Environment/external skips are explicit; this is not promotion authorization. |
| S1a - upload and job-workspace lifecycle | `NOT_STARTED` | `S0/S0.1 VERIFIED` | slice upload/workspace lifecycle and its focused tests | Allocate ownership before persistence; explicit multipart limits and all admission/rejection/error/success paths clean one job workspace; startup stale recovery is contained and tested. |
| S1b - queue deadlines and abort contract | `NOT_STARTED` | S1a workspace ownership | queue scheduling/deadline/counter lane | Deadlines fire independently of worker availability; client abort and deadline produce one AbortSignal contract; timers/listeners/counters and owned workspace cleanup are correct on every path. |
| S1c - native process lifecycle and environment | `NOT_STARTED` | S1b AbortSignal contract | command/native process lane | Exact argument arrays are preserved; converters/slicers receive a tested minimal environment; abort terminates complete process trees with verified escalation and no orphan; local helper paths are module-anchored without changing flattened image behavior. |
| S2 - resource/state envelope | `NOT_STARTED` | artifact work waits for S1a; process limits integrate with S1b/S1c; container envelope waits for S3 image controls | resource/archive lane; artifact/pricing lane; container-permission lane | Measured HTTP/CPU/RAM/PID/disk/archive/model/output caps fail closed; streaming/actual-byte limits apply; unique artifact correlation plus TTL/count/byte quotas exist; output validity is required before success; pricing writes are atomic with rollback; root filesystem/code/profiles are read-only/root-owned and mutable pricing/input/output are separated. |
| S3 - reproducible supply chain and safe promotion | `NOT_STARTED` | S0.1; may run in parallel with S1 runtime work | Docker/build/provenance and validation/deploy separation only; no manifest/lockfile edits | Verified immutable build inputs; clean CI builds one digest-addressed image; SBOM, scan, signature/provenance are verified; deployment promotes through human approval only after auth/private-topology gates; readiness and rollback are proven without mutable `git pull` builds. |
| S4 - service trust and operations | `NOT_STARTED` | S1a/S1b/S1c/S2 security surfaces and S3 promotion design | auth/policy lane; observability lane; topology/integration-contract lane | Rotatable scoped service auth protects slice and sensitive operations; protected-route policy is consistent; logs/metrics/traces correlate request/job/artifact; proxy trust is tested; private sidecar ingress/egress is restricted. No production promotion without this evidence or an explicit architect-approved risk decision. |
| S5 - optional isolated worker and async API | `NOT_STARTED` | explicit architecture decision after S1a-S4 evidence | API-version lane; worker-isolation lane; migration lane | Decision record approves cost/complexity; isolated worker enforces resource/network boundaries; versioned async job states, idempotency, cancellation, retention, and compatibility migration are tested without silently changing current endpoints. |

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
  every severity; all three named GHSAs are absent.
- Docker image/health smoke is `NOT_RUN_ENVIRONMENT` because no daemon was
  available and no Docker resource was created. Hosted CI and external branch
  protection are `UNVERIFIED`.

`VERIFIED` here means the local S0/S0.1 baseline gates and dependency audit are
green. It does not verify deployment, production topology, service
authentication, or authorize a `main` promotion.

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
   the full production audit has zero findings at every severity, and the three
   named dependency advisories are absent.

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
  intermediate path under it and final artifacts under a correlated ID.
- Configure explicit multipart file/field/part/header counts and sizes. Generated
  requests must prove each limit fails closed and removes every owned byte.
- Reject queue full/client cap before persistence where feasible, or guarantee
  cleanup in one ownership boundary when persistence must occur first.
- Register cleanup targets before launch; orientation failure cannot leave
  untracked artifacts. Recover stale workspaces at startup with containment,
  age, and ownership guards.

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

## S3 detailed exit criteria

- Inventory and verify upstream provenance before pinning Ubuntu digests,
  NodeSource/Apt inputs, Python versions/hashes, Action SHAs, and Compose images.
  Do not invent pins or hashes and do not edit `package.json` or
  `package-lock.json`, which remain S0.1-owned inputs.
- Install Node from the lockfile with lifecycle-script policy justified; build in
  clean CI once; record commit and image digest.
- Produce and retain SBOM, vulnerability results, signature, and provenance;
  deploy only the verified digest.
- Separate validation/build from promotion. Use environment approval/change
  window, non-overlapping deployment concurrency, bounded readiness retries,
  and an immutable previous digest.
- Block promotion until service authentication plus private,
  ingress/egress-restricted topology is verified, or an explicit
  architect-approved risk decision is recorded. External branch protection and
  required checks must be verified rather than inferred from workflow text.
- Readiness proves Python, slicer executables/profiles, writable state and a safe
  synthetic operation as appropriate. A failed rollout automatically restores
  the prior artifact, and the rollback drill is recorded.

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

## S5 decision gate

S5 proceeds only if threat/performance evidence shows that S1-S4 in-process
controls are insufficient or asynchronous work is a product requirement. The
decision must compare isolation, operational complexity, migration risk, queue
durability, API compatibility, and cost. No `/v1` or async job contract is added
before that decision.

## Parallel sequencing and integration

S0.1 is the sole owner of `package.json`, `package-lock.json`, validation
scripts, validation CI, and the current-state knowledge update. After S0.1
integration, S1a owns upload/job-workspace lifecycle. S1b follows the S1a
ownership seam for real queue deadlines and abort propagation; S1c follows the
resulting AbortSignal contract for process-tree cancellation, exact command
integrity, and subprocess-environment minimization.

S3 Docker/build/provenance and validation/deploy-separation work may branch in
parallel with S1 runtime work, but it must not edit manifests or the lockfile.
S2 artifact lifecycle waits for S1a workspace ownership, while S2 container
envelope work waits for S3 image-control decisions. S4 auth/topology evidence is
a promotion prerequisite. Lanes use disjoint files and reconcile against the
same S0.1 tests; no production promotion occurs before auth/topology and
deploy-safety gates are verified or explicitly risk-accepted by the architect.

## Decision and risk log

| ID | Decision / risk | Evidence and consequence | Owner / resolution |
| --- | --- | --- | --- |
| D-001 | S0 records but does not fix upload residue or false deadlines. | Multer precedes handler queue; timeout is checked only on dequeue ([project map](project-map.md)). | S1a workspace lifecycle + S1b deadlines |
| D-002 | Do not characterize vulnerability outcomes as desired behavior. | Durable tests cover safe FIFO/caps/mappings, not delayed expiry, residue, collision, or zero-stat success. | All test owners |
| D-003 | Local Python path divergence is real but container command contract must not change in S0. | Bare script names work only in flattened image. | S1c native/path lane |
| D-004 | Validation CI does not protect `main` by itself. | Branch rules/required checks are external `UNVERIFIED`; `main` still triggers deploy. | S3 + repository admin |
| D-005 | Do not invent Action SHAs, image digests, Python hashes, or versions. | Provenance must be verified upstream first. | S3 build lane |
| D-006 | `/health` remains liveness in S0. | It returns status/uptime only; deploy uses it as smoke. | S3 readiness lane |
| D-007 | Pricing CORS inconsistency is not an auth bypass but remains high-risk policy drift. | API key still applies; Origin classification covers only `/admin/**`. | S4 auth/policy lane |
| D-008 | Successful outputs need explicit ownership/retention, not timestamp folklore. | No response correlation, TTL, quota, or collision resistance. | S2 artifact lane |
| D-009 | Native compromise is contained only partially. | Non-root/cap-drop/PID exist, but code/config/state and network remain writable/available. | S2/S5 |
| D-010 | Promotion to `main` is not part of S0 completion. | Current workflow can deploy every `main` push. | human-approved integration decision |
| D-011 | Historical S0 dependency findings were remediated narrowly in S0.1; this does not solve application upload lifecycle design. | Commit `f9ed1ee6791e531670d5d7703f994bfb51986ebb` locks the verified non-major fixes and the full production audit is zero at every severity; all three named GHSAs are absent. | S0.1 dependency gate complete; S1a still owns upload cleanup/parser limits; S3 owns later provenance without manifest edits |
| D-012 | Native children inherit the API environment and share unrestricted egress. | `runCommand` supplies no explicit `env`; a compromised parser/slicer may read `ADMIN_API_KEY` or other process secrets and contact external systems. | S1c minimal environment allowlist and dynamic exclusion proof; topology/container egress gate before promotion |
| D-013 | Public slice routes have no application service authentication. | Rate limiting is not caller authentication, and private/localhost topology is an independent external control currently `UNVERIFIED`. | S4 service-auth/private-topology evidence, or explicit architect-approved risk decision; S3 blocks promotion meanwhile |
| D-014 | `fileSize` alone is not a complete multipart/HTTP resource envelope. | Field/part/header counts and sizes, total upload time, request/header/socket timeouts, and connection limits are `NOT_COVERED_S0`. | S1a parser limits/cleanup tests; S2 measured server and connection envelope |
| D-015 | A `main` push can deploy independently of validation CI. | Required checks and branch protection are external `UNVERIFIED`; no S0/S0.1 commit is production authorization. | S3 validation/build/promotion separation plus repository-admin verification and human approval |
