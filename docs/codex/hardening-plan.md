# Hardening plan

## I8/S3a signed-candidate publication checkpoint

Status: `BLOCKED_PREFLIGHT`.

Implemented locally on exact baseline
`c9ce6c5b3e8cf767563ab46a41b3c0e0e97ce2a6`:

- one shared exact-image gate for normal no-push Image Validation and Candidate
  Publication;
- a separate manual workflow with exact branch/SHA/repository/confirmation and
  baseline-ancestry checks;
- job-local least privilege, with registry/attestation/OIDC writes only in the
  publication job;
- build-once `linux/amd64` validation before GHCR authentication or push;
- absent-tag/no-overwrite enforcement and digest-only downstream identity;
- exact registry manifest/config/platform/source/User correlation;
- digest-pinned pull, kernel identity, liveness, Orca, and production-Compose
  round trip;
- exact-digest SLSA provenance and SPDX 2.3 GitHub/Sigstore attestations,
  three-path positive verification, and two negative verification probes;
- bounded I8 provenance v2, explicit partial-publication classifications,
  allowlisted upload, exact cleanup, and final fail-closed aggregation.

The exact npm 10.9.8 focused/adapted I8 and shared Image Validation contract
lane is green at 587/587. This does not prove hosted publication.

Open exit gates:

1. Obtain explicit authorization for the minimum default-branch registration
   change or an explicitly approved alternative. GitHub cannot dispatch a new
   `workflow_dispatch` workflow that exists only on the candidate branch.
2. Commit and non-force push the exact target branch, then prove final remote
   SHA and baseline ancestry.
3. Run hosted Source Validation and normal read-only Image Validation on that
   exact SHA.
4. Only after both pass, dispatch Candidate Publication with the exact
   confirmation and verify one previously absent discovery tag.
5. Record exact registry digest, digest round trip, provenance/SBOM attestation
   IDs and bundle hashes, positive and negative cryptographic verification,
   bounded artifact identity, exact cleanup, and final aggregator success.

Until all exits are green: candidate tag/digest `NOT_CREATED`; signature
`NOT_CREATED`; attestations `NOT_CREATED`; hosted I8 evidence `PENDING`;
deployment `NOT_RUN`; external topology and production readiness `UNVERIFIED`.
The exact-SHA candidate workflow remains the reviewed trust assumption needed
for the same-job no-tar build/gate/push identity constraint.

## Historical I7/S3a immutable-candidate foundation

Status: `HOSTED_VERIFIED_NO_PUSH`.

The repository now separates production operation from development Compose.
Production accepts only an externally supplied immutable digest after the
mandatory contract validator passes, preserves the runtime security envelope,
publishes no API port, and places the API only on an internal private bridge.
Image Validation remains build-once/no-push/no-deploy and emits bounded
allowlisted provenance only after the exact-image gates and exact cleanup
succeed.

Exact I7 hosted Source run `30160486802` and Image run `30160486750`
succeeded; evidence artifact `8620145030` is the retained no-push checkpoint.
Remaining exits beyond I7 are explicit:

- verify or establish required branch policy without overstating the observed
  404/no-ruleset result;
- separately authorize and create a registry digest, signature, and
  attestation if promotion is later approved;
- prove deployed caller, proxy, secret, firewall, egress, digest, VPS,
  readiness, and rollback behavior before S3b.

Registry publication, signing, attestation, deployment, and VPS mutation are
outside this delta. S3b is `NOT_STARTED`; production readiness is
`UNVERIFIED`. See
[`evidence/i7-s3a-immutable-candidate-foundation.md`](evidence/i7-s3a-immutable-candidate-foundation.md).

## I6/S5 private-peer topology decision

Status: `IN_PROGRESS`; repository topology selected, deployment proof pending.

Atomic delta: `549fa4258c60b2971855e7a202e488d74427ccd4` followed
by `7dd6d73632856967824570c6e38c54b905d032b1`.
Decision: `PRIVATE_PEER_TOPOLOGY_SELECTED; ASYNC_WORKER_DEFERRED`.

The API is internal-only with no host-published port. An authenticated
reverse-proxy peer provides intended ingress and may also attach to an approved
ingress network, but must not provide generic forwarding, NAT, or DNS
tunnelling for the API. Repository validation calibrates an owned sentinel and
then requires API and spawned-native DNS/TCP/UDP denial. Protected
`/health/detailed` is fresh; `/ready` and `/operations/readiness` stay cached.

Intended/denied callers, proxy hop/CIDR, secret mode, immutable deployed digest,
and Hostinger/proxy/firewall/egress behavior remain `UNVERIFIED`. See the
[I6 evidence](evidence/i6-s5-private-peer-topology.md) and
[operator contract](i6-s5-private-peer-operator-validation.md).

## Historical I5/S4 scoped trust, topology, and observability checkpoint

Status: `IN_PROGRESS` pending final exact-SHA hosted validation.

Exact baseline is `5be7b19d13616f06504c18217e25bf95c97c6e96`.
Repository implementation and deterministic tests cover:

- separate slice, pricing, artifact, and operations audiences with mandatory
  active and optional previous slots, exact route/header mapping, fixed-digest
  comparison, cross-audience rejection, two-restart rotation/revocation, and a
  generic fail-closed startup error;
- a finite `ADMIN_API_KEY` migration for exactly one named non-slice audience,
  expiring no more than 90 days after startup evaluation;
- exact per-audience browser Origin allowlists, no-Origin service behavior,
  fail-closed proxy peer validation, nearest-untrusted-hop XFF resolution,
  bounded request-ID validation/replacement, and X-Request-Id propagation;
- public liveness and minimal readiness, operations-scoped detailed readiness
  and metrics, stable readiness reasons, versioned allowlisted/redacted events,
  request/job/artifact correlation, and fixed-cardinality metric labels.

Baseline hosted Source run `30022045664` and Image run `30022045578` passed.
The exact baseline image used locally was
`sha256:5f159e1051233811ad663175311059829aecdbff16706e39aceba4aac77f9aa3`.
On Docker Desktop 29.6.1, ordinary bridge plus loopback publish preserved
ingress but allowed API and native DNS/TCP/UDP egress. An internal bridge denied
egress but exposed no loopback listener. Exact A/B resources were removed.
Compose remains unchanged, loopback-published, and non-internal. No sidecar was
invented. Exact candidate `510e6110ef5c49cd03962627210d6db114554618`
passed hosted Source run `30037842766`; Image run `30037842526` failed closed
on two independent contracts: active-abort client transport representation and
the monolithic private-inspect predicate. The corrective source now accepts
only bounded semantic abort outcomes after the substantive server invariants,
validates requested loopback publication from canonical
`HostConfig.PortBindings`, proves external-default-route absence separately,
and emits one allowlisted `contractReason`. Docker API 1.48 and Desktop 29
fixtures cover the differing inspect representations. These are repository and
local-test facts only; the final candidate is not complete until both hosted
workflows pass on its exact SHA.

External
reverse-proxy CIDRs/hops and
timeouts, intended/denied deployed callers, host firewall/egress, production
secret source/ownership/mode, deployed digest/VPS state, branch protection/
required checks, S3b promotion/readiness/rollback, and production readiness are
`UNVERIFIED`. Deploy and production actions are not authorized.

## I4/S2 fast-track checkpoint

Status: `PENDING_LOCAL_VALIDATION`.

Implemented repository controls cover measured application limits, archive and
output validity, job/artifact correlation, leased bounded retention, atomic
serialized pricing persistence, and a fail-closed non-root/read-only container
resource envelope. Final local aggregate and Docker evidence, atomic commits,
and Source/Image hosted runs on one exact SHA remain stage-exit gates.

Directory fsync is attempted and required when the platform exposes it; an
unsupported directory fsync limits crash-durability guarantees, while a hard
post-rename sync error cannot be rolled back transactionally without a larger
journal protocol. Active-job container-stop orchestration is not claimed.
S4 topology/egress/credential lifecycle, S3b promotion, VPS capacity, deployed
identity, and production readiness remain later work.

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
| S2 - resource/state envelope | `IN_PROGRESS` | artifact work waits for S1a; process limits integrate with S1b/S1c; container envelope waits for S3a image controls | I3 implements a bounded Node HTTP-server subset; resource/archive, artifact/pricing, and container-permission exits remain open | I3 locally implements and focuses tests on header/request/keep-alive timeouts, header/connection counts, and requests/socket with bounded fallback. Final aggregate and exact-SHA evidence are pending; measured VPS/proxy/CPU/RAM/PID/disk/archive/model/output caps, streaming limits, artifact retention/correlation, atomic pricing, and read-only state separation remain incomplete. |
| S3a - repository build/provenance and automatic-deploy separation | `BLOCKED_PREFLIGHT` | S0.1; exact hosted I7 baseline green | I8 locally factors one shared build-once gate and adds manual least-privilege digest-bound GHCR publication, attestations, verification, bounded v2 evidence, and no-deploy aggregation | I7 Source `30160486802` and Image `30160486750` are green. I8's exact npm 10.9.8 focused/adapted lane is 587/587, but GitHub cannot dispatch the new workflow until default-branch registration, which is not authorized. I8 GHCR digest/signature/attestations are `NOT_CREATED`; S3b/deployed topology/readiness/rollback remain unverified or not started. |
| S4 - service trust and topology | `IN_PROGRESS` | S1a/S1b/S1c/S2 security surfaces and S3a design evidence | I5 supplies scoped trust; I6 selects the internal private-peer/no-host-port topology | Repository validation requires authenticated peer ingress, auth rejection, no API external route, and calibrated API/native DNS/TCP/UDP denial. Deployed callers, proxy/firewall, secrets, digest, and egress remain `UNVERIFIED`. |
| S3b - staging and promotion drill | `NOT_STARTED` | S3a evidence; S4 evidence; separate explicit user/owner authorization | staging/promotion/readiness/rollback drill only | Promote a verified immutable artifact through a human-authorized staging gate; readiness is bounded and meaningful; failure restores the prior artifact; the drill is recorded. No authorization or verification is inferred from S1a/S3a/S4 repository work. |
| S5 - topology/optional async worker decision | `IN_PROGRESS` | I5 trust controls and S4 topology evidence | private-peer topology selected; async API/worker deferred | `PRIVATE_PEER_TOPOLOGY_SELECTED; ASYNC_WORKER_DEFERRED`. Complete exact deployed caller, proxy, secret, digest, firewall, and egress evidence without changing current endpoints. |

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
  `cf45524` then `9f8ae6b`.
- I1 queue deadline, shutdown, capacity ownership, native process-tree, minimal
  environment, and no-post-abort-success contracts remain green.
- Swiper 12.1.2 is transactionally installed into both Orca trees and verified
  offline; Orca v2.3.1 URL/SHA and Node 24-compatible Action pins remain.
- Hosted A/B/C evidence verifies tmpfs ownership as the liveness root cause.
  The final fix dynamically resolves nonzero service UID/GID, cross-checks the
  running kernel credentials, mounts both runtime paths at 64 MiB with
  `rw,nosuid,nodev,noexec,uid,gid,mode=0700`, and keeps `USER slicer`.
- Exact cleanup captures expected absent-container/image probes in conditional
  contexts that cannot trip the runner's implicit Bash `errexit`; unexpected
  inspect/removal failures still fail closed before the final aggregator. The
  one-time A/B/C matrix is absent from the final workflow; bounded
  identity/state/log, SPDX, and Grype evidence remains.
- The exact candidate image runs a bounded, offline, non-root Orca 2.3.1 help
  and customer-free manifold-cube slice. It requires the exact version, a
  bounded regular G-code output, its Orca 2.3.1 signature, and real extrusion.
  Cleanup uses the captured container ID only after immutable-image and
  run-label ownership checks; a foreign container that reuses the name is not
  deleted.
- I2 closes repository image validation only. Branch protection/required checks,
  signature/attestation, registry promotion, S4, S3b, VPS/deployed state, and
  production readiness remain `UNVERIFIED`; deployment is not authorized.

## Historical I3 S2/S4 partial implementation

This checkpoint is superseded for S4 by the I5 section above.

- Exact baseline:
  `6241685f1af0c0a1d4be6f1c229d66ca922fbb88`; branch:
  `codex/i3-s4a-service-auth-http-envelope`.
- S4 subset: I3 required a separate `SLICE_SERVICE_API_KEY` containing
  32-256 printable-ASCII bytes and different from the then-broad credential.
  `x-slicer-api-key` protects both slice routes after the limiter and before
  workspace/Multer/queue/native effects. Missing or wrong credentials return
  exact HTTP 401
  `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`;
  comparison uses fixed-size SHA-256 digests plus `crypto.timingSafeEqual`;
  rejection logs contain only request ID and resolved client IP.
- Browser-origin subset: no-Origin requests remain allowed. Browser-origin
  slice requests used only `SLICE_CORS_ALLOWED_ORIGINS`; protected pricing and
  the other audience policies were completed later by I5.
- S2 subset: the Node server applies defaults/bounds for headers timeout 60000
  `[1000,60000]`, request timeout 600000 `[60000,600000]`, keep-alive timeout
  5000 `[1000,60000]`, header count 2000 `[16,2000]`, connections 128
  `[1,1024]`, and requests/socket 100 `[1,1000]`. Invalid overrides fall back
  to defaults and effective headers timeout is capped at request timeout.
- Current focused evidence reports 469/469 integrated tests, 6/6 focused
  Python-runner tests, 5/5 I3 mutations, and passing HTTP assertions/repeats.
  The final aggregate, exact implementation SHA, and hosted exact-SHA
  validation are pending; this is not a `VERIFIED` stage exit.
- Root-scoped `input/`, `output/`, and `configs/` remain unchanged. Docker local
  build, deployment, production proof, actual VPS capacity, proxy timeouts,
  private ingress/egress, rotation/revocation, and full S2/S4 exits are
  `UNVERIFIED`.

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

- I3 completes only the application HTTP-server configuration subset described
  above. It does not establish actual VPS or reverse-proxy behavior and does
  not close the remaining criteria below.
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

- I5 implements and deterministic tests cover four distinct credential
  audiences, active/previous slots, exact route/header mapping, two-restart
  revocation, finite one-audience legacy migration, and stable auth errors.
- Exact per-audience Origin policy covers slice, protected pricing, artifact,
  and operations routes while preserving no-Origin service behavior.
- Proxy configuration fails closed on malformed, wildcard, overbroad,
  duplicate, unknown, or empty-enabled trust; local tests cover loopback/CIDR,
  nearest-untrusted-hop spoof resistance, and request-ID injection replacement.
- Structured version-1 request/job/artifact/runtime events are allowlisted,
  bounded, correlated, and redacted. Operational metrics use fixed labels and
  public readiness discloses no detailed reasons.
- The remaining mandatory topology exit is blocked: prove intended private
  ingress and denied unintended callers while denying API/native DNS/TCP/UDP
  egress on the final deployed architecture. Docker Desktop internal networking
  denied egress but removed the loopback listener.
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

Decision: `PRIVATE_PEER_TOPOLOGY_SELECTED; ASYNC_WORKER_DEFERRED`. No `/v1`,
async job, or isolated-worker contract is authorized by I6. Revisit async work
only under a separate decision covering durability, compatibility, migration,
operational complexity, and cost.

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
image-control decisions. I5 supplies repository-tested scoped credentials,
Origin/proxy/request identity, readiness, events, and metrics. I6 selects the
private-peer/no-host-port topology and its fail-closed repository validation
contract; deployed proof remains `UNVERIFIED`.
S3b may run staging, promotion, readiness, and rollback drills only
after complete S4 evidence and separate explicit user/owner authorization. No
production promotion occurs without those verified gates or explicit human
owner/user-approved, documented risk acceptance; an agent cannot grant itself
the exception.

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
| D-013 | I3 established a separate slice credential; I5 supersedes the wider service-trust contract. | I5 tests four active/previous audiences, two-restart revocation, finite legacy migration, exact Origin/proxy/request identity, readiness, events, and metrics. I6 selects the private-peer repository topology; deployed topology and secret delivery remain `UNVERIFIED`. | Complete deployed S4/S5 caller, proxy, secret, digest, firewall, and egress evidence before S3b. |
| D-014 | `fileSize` alone was not a complete multipart/HTTP resource envelope. | S1a verifies finite multipart limits. I3 adds bounded Node header/request/keep-alive timeouts, header count, connection count, and requests/socket with fallback, but actual VPS/proxy behavior, total streamed upload duration, and measured CPU/RAM/disk envelopes remain open. | Complete S2 measured server, proxy, and resource envelope. |
| D-015 | A `main` push could historically deploy independently of validation CI. | S3a removed that path. Exact S3a-B2 source is green, but image liveness and HIGH scanning remain red; required checks and branch protection are external `UNVERIFIED`. | S3a image/runtime diagnosis plus repository policy verification; S3b only after S4 and separate authorization |
| D-016 | The manifest/lock freeze was limited to the S1a/S3a parallel wave. | The dependency patch is now integrated once by patch ID; duplicate `306b799` was not picked. | Future advisory work requires a new serialized owner and audit evidence |
| D-017 | Parallel lanes return evidence; the integrator owns canonical reconciliation. | I1 reconciliation supersedes historical stage status without rewriting historical evidence files. | Integrator maintains `AGENTS.md` and `docs/codex/**` after integration |
| D-018 | Graceful shutdown must drain both HTTP and queue work without early capacity release. | `SIGTERM`/`SIGINT` are single-flight; queue shutdown aborts queued/active work, closes HTTP, and awaits both drains while active slots remain owned until task settlement. | I1 runtime lifecycle locally verified |
| D-019 | A known image advisory does not explain away an independent liveness failure. | Hosted Image run `29957927370` shows both persistent liveness exit 1 and the HIGH scanner path. Swiper 7.2.0 is known, but S3a-V2C is not integrated. | S3a remains blocked; diagnose/fix both paths without weakening gates |
| D-020 | I2 separates the verified tmpfs liveness root cause from the Swiper advisory. | Exact A/B/C and main-container evidence proves root-owned tmpfs mount roots caused startup `EACCES`; V2C independently produces zero `GHSA-hmx5-qpq5-p643` findings. Dynamic nonzero UID/GID plus kernel cross-check and mode `0700` fix liveness without root or world-writable state. | I2 repository image validation closed; external policy, provenance/promotion, S4/S3b, and production evidence remain required |
| D-021 | Application defaults do not prove host or proxy capacity. | I3 tests the Node HTTP envelope in-process, but no exact-SHA hosted result, VPS measurement, or reverse-proxy timeout inspection exists. | Keep VPS capacity and proxy timeouts `UNVERIFIED`; complete measured S2/S4 topology evidence before promotion. |
| D-022 | I5's loopback-published topology could not combine ingress with egress denial; I6 replaces it. | Historical Docker Desktop A/B remains valid. I6 selects an internal-only API with an authenticated private peer, no API host port/default route, and calibrated API/native egress-denial validation. | Verify callers, proxy hop, secret mode, deployed digest, firewall, and egress externally before S3b. Async worker is deferred. |
