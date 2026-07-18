# Hardening plan

## Status vocabulary

- `NOT_STARTED`: authorized shape is known; implementation has not begun.
- `IN_PROGRESS`: bounded work is active but exit criteria are not all proven.
- `BLOCKED`: a required dependency or mandatory gate prevents safe completion.
- `VERIFIED`: every stage exit criterion has evidence; environment-unavailable
  conditional checks are explicitly recorded rather than called green.

This plan was initialized 2026-07-18 from code baseline
`899f1916437620ab536e912bf404d8da261cc37f` and work baseline
`02afc555509f00d432c24520601f4c7034becd81`.

## Stage overview

| Stage | Status | Depends on | Parallel ownership | Outcome and exact exit condition |
| --- | --- | --- | --- | --- |
| S0 - knowledge, characterization, truthful runners, validation CI | `VERIFIED` | clean authorized baseline | docs; JS tests/seams; Python runner tests; CI/safety scripts in disjoint files | Four Codex knowledge files exist; deterministic JS/Python suites and complete tracked-source syntax gates pass; failed runner scenarios propagate non-zero; validation-only CI and repository guards exist; all mandatory S0 gates are green. |
| S1 - job/upload lifecycle and cancellation | `NOT_STARTED` | `S0 VERIFIED` | runtime-lifecycle lane; native-cancellation lane; tests owned separately | Upload enters a job-scoped workspace; full/client/deadline/abort/error/success paths clean deterministically; deadlines fire at configured time independent of slots; counters remain correct; child trees are terminated with verified escalation; stale recovery works; local script paths are module-anchored while flattened Docker behavior is unchanged. |
| S2 - resource/state envelope | `NOT_STARTED` | S0; integrates after S1 lifecycle seams | resource/archive lane; artifact/pricing lane; container-permission lane | Measured CPU/RAM/PID/disk/archive/model/output caps fail closed; streaming/actual-byte limits apply; unique artifact correlation plus TTL/count/byte quotas exist; output validity is required before success; pricing writes are atomic with rollback; root filesystem/code/profiles are read-only/root-owned and mutable pricing/input/output are separated. |
| S3 - reproducible supply chain and safe promotion | `NOT_STARTED` | S0; may branch in parallel with S1 | build/provenance lane; deploy/readiness lane | Verified immutable base/dependency/action inputs; clean CI builds one digest-addressed image; SBOM, scan, signature/provenance are verified; deployment promotes that artifact through human approval; readiness proves dependencies; rollback is documented and drilled without mutable `git pull` builds. |
| S4 - service trust and operations | `NOT_STARTED` | S1/S2 security surfaces and S3 promotion | auth/policy lane; observability lane; topology/integration-contract lane | Rotatable scoped service auth protects all sensitive operations; protected-route CORS/admin policy is consistent; structured redacted logs/metrics/traces correlate request/job/artifact; proxy trust is tested; private Hostinger sidecar has restricted ingress/egress; LeadPilot integration is a separately authorized contract. |
| S5 - optional isolated worker and async API | `NOT_STARTED` | explicit architecture decision after S1-S4 evidence | API-version lane; worker-isolation lane; migration lane | Decision record approves cost/complexity; isolated worker enforces resource/network boundaries; versioned async job states, idempotency, cancellation, retention, and compatibility migration are tested without silently changing current endpoints. |

## S0 work package and gates

S0 is behavior-preserving. Production edits are limited to exporting existing
pure helpers or a default-preserving test seam. Server bootstrap/listen,
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

`NOT_COVERED_S0`: real queue deadlines, upload cleanup on queue rejection,
abort/process-tree termination, server factory/root injection, timestamp/output
collision, zero-stat output rejection, retention, pricing atomicity, protected
pricing CORS, readiness, and production authentication redesign.

S0 verification snapshot (2026-07-18): lockfile installation completed with
`npm ci --ignore-scripts --no-audit --no-fund`; dynamic syntax, JavaScript and
Python unit tests, mirror equality, index safety, and whitespace gates passed.
The network-enabled audit reported one high and three moderate package findings
for the locked Multer/Express dependency graph; S0 did not silently change
dependency versions (D-011). Compose configuration validated with the available
standalone client, while image/health smoke was `NOT_RUN_ENVIRONMENT` because no
Docker daemon was reachable. Native integration runners were
`NOT_RUN_ENVIRONMENT` because only the tracked `.gitkeep` fixture exists; neither
conditional skip is represented as green.

## S1 detailed exit criteria

- Allocate a unique job directory before any persistent upload; store every
  intermediate path under it and final artifacts under a correlated ID.
- Reject queue full/client cap before persistence where feasible, or guarantee
  cleanup in one ownership boundary when persistence must occur first.
- Enforce deadline with a real timer/abort signal; a blocked active worker cannot
  postpone queued rejection. Remove timer/listener state on every completion.
- Cancel converters/slicers and descendants on deadline/client abort/shutdown;
  prove TERM grace, KILL escalation, no orphan, and response mapping.
- Resolve Python helpers relative to their module/application root locally while
  preserving flattened `/app` image behavior and exact command arguments.
- Register cleanup targets before launch; orientation timeout/failure cannot
  leave untracked artifacts or silently bypass the timeout contract.
- Recover stale job workspaces at startup with containment, age, and ownership
  guards. Concurrency, counter, abort, restart, and residue tests all pass.

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
- Enforce CPU, RAM, PID, temp/output disk, log, and egress-aware resource bounds;
  generated bomb/limit tests fail closed without customer fixtures.

## S3 detailed exit criteria

- Inventory and verify upstream provenance before pinning Ubuntu digests,
  NodeSource/Apt inputs, Python versions/hashes, Action SHAs, and Compose images.
  Do not invent pins or hashes.
- Install Node from the lockfile with lifecycle-script policy justified; build in
  clean CI once; record commit and image digest.
- Produce and retain SBOM, vulnerability results, signature, and provenance;
  deploy only the verified digest.
- Separate validation/build from promotion. Use environment approval/change
  window, non-overlapping deployment concurrency, bounded readiness retries,
  and an immutable previous digest.
- Readiness proves Python, slicer executables/profiles, writable state and a safe
  synthetic operation as appropriate. A failed rollout automatically restores
  the prior artifact, and the rollback drill is recorded.

## S4 detailed exit criteria

- Define key audience/scope/rotation/revocation and authorize every protected
  route consistently; avoid distributing a single broad admin key.
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

After the shared S0 baseline, S1 runtime lifecycle and S3 supply-chain work may
branch in parallel with disjoint ownership. S1 owns `app/services/slice*`, slice
routes, cancellation, workspace tests, and local-path corrections. S3 owns
Docker/build/deploy workflows and provenance tooling. Neither lane rewrites the
other's files. Integration waits for both to rebase/reconcile against the same
S0 tests; S2 then consumes S1 job ownership and S3 image controls. S4 integrates
only after those security surfaces stabilize.

## Decision and risk log

| ID | Decision / risk | Evidence and consequence | Owner / resolution |
| --- | --- | --- | --- |
| D-001 | S0 records but does not fix upload residue or false deadlines. | Multer precedes handler queue; timeout is checked only on dequeue ([project map](project-map.md)). | S1 lifecycle |
| D-002 | Do not characterize vulnerability outcomes as desired behavior. | Durable tests cover safe FIFO/caps/mappings, not delayed expiry, residue, collision, or zero-stat success. | All test owners |
| D-003 | Local Python path divergence is real but container command contract must not change in S0. | Bare script names work only in flattened image. | S1 native/path lane |
| D-004 | Validation CI does not protect `main` by itself. | Branch rules/required checks are external `UNVERIFIED`; `main` still triggers deploy. | S3 + repository admin |
| D-005 | Do not invent Action SHAs, image digests, Python hashes, or versions. | Provenance must be verified upstream first. | S3 build lane |
| D-006 | `/health` remains liveness in S0. | It returns status/uptime only; deploy uses it as smoke. | S3 readiness lane |
| D-007 | Pricing CORS inconsistency is not an auth bypass but remains high-risk policy drift. | API key still applies; Origin classification covers only `/admin/**`. | S4 auth/policy lane |
| D-008 | Successful outputs need explicit ownership/retention, not timestamp folklore. | No response correlation, TTL, quota, or collision resistance. | S2 artifact lane |
| D-009 | Native compromise is contained only partially. | Non-root/cap-drop/PID exist, but code/config/state and network remain writable/available. | S2/S5 |
| D-010 | Promotion to `main` is not part of S0 completion. | Current workflow can deploy every `main` push. | human-approved integration decision |
| D-011 | The locked dependency graph has current audit findings; S0 must not hide them with an unreviewed upgrade. | `npm audit --omit=dev --audit-level=high` reported GHSA-72gw-mp4g-v24j and GHSA-3p4h-7m6x-2hcm for Multer plus GHSA-q8mj-m7cp-5q26 through `qs`/Express: one high and three moderate package findings. | S1 request-lifecycle mitigation + S3 provenance/upgrade verification |
