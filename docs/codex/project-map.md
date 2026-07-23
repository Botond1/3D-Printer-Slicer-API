# Verified project map

## Current I5/S4 scoped-trust candidate

- Exact baseline: `5be7b19d13616f06504c18217e25bf95c97c6e96`;
  branch: `codex/i5-s4-trust-topology-observability`.
- Protected routes are method-aware and audience-scoped:
  slice (`x-slicer-api-key`), pricing/artifact/operations (`x-api-key`).
  Each audience has one mandatory active and optional previous key. Startup
  rejects missing, malformed, placeholder-like, duplicate, or cross-audience
  reuse. Rotation accepts old+new after restart 1 and revokes old after previous
  removal plus restart 2.
- `ADMIN_API_KEY` is only a finite compatibility migration for one named
  non-slice audience, with a future ISO timestamp no more than 90 days away.
  Normal operation requires all scoped active keys and is fail closed.
- Browser Origin is exact and isolated per audience. No-Origin service requests
  remain allowed. Proxy trust defaults false and true requires explicit unique
  validated IP/CIDR peers or loopback. Express stops identity at the nearest
  untrusted hop; invalid request IDs are replaced and the safe value is echoed.
- Public `/health` is liveness and `/ready` returns only READY/NOT_READY.
  Operations scope protects detailed health, full readiness reasons, and
  fixed-cardinality Prometheus metrics. Versioned events correlate bounded
  request/job/artifact IDs and exclude credentials, paths, filenames, customer
  data, arbitrary event names, and unbounded labels.
- Hosted baseline Source `30022045664` and Image `30022045578` passed. The exact
  local A/B image was
  `sha256:5f159e1051233811ad663175311059829aecdbff16706e39aceba4aac77f9aa3`.
  Docker Desktop 29.6.1 ordinary bridge preserved loopback ingress but allowed
  API/native DNS/TCP/UDP sentinel egress. Internal bridge denied egress but
  exposed no loopback listener. Exact resources were removed.
- Exact candidate `510e6110ef5c49cd03962627210d6db114554618`
  passed hosted Source run `30037842766`. Hosted Image run `30037842526`
  failed closed on independent semantic-abort and monolithic private-inspect
  assertions while image identity, health, authenticated Prusa/Orca slicing,
  egress sentinel, SBOM/Grype, evidence upload, and cleanup succeeded.
- The corrective repository contract accepts only bounded abort termination
  representations after active admission, explicit abort, native settlement,
  queue-zero, and unchanged API/filesystem inventories. Private topology is a
  pure allowlisted validator: canonical `HostConfig.PortBindings` proves the
  requested fixed loopback publish; a bounded runtime projection separately
  proves no external default route. Docker API 1.48 and Desktop 29 fixtures
  cover the inspect-shape portability seam.
- Compose remains unchanged and no sidecar was invented. Status is
  `IN_PROGRESS` pending final exact-SHA hosted Source and Image success.
  Deployed caller/proxy/firewall/secret/digest/VPS state and S3b remain
  `UNVERIFIED`.

## Current I4/S2 resource-state candidate

- Exact baseline: `780d64dd786440cb80ddd4df38cb489c16070a07`;
  branch: `codex/i4-s2-resource-state-envelope`.
- A central strict-integer resource policy now bounds upload lifetime and actual
  bytes, ZIP/3MF/SL1 expansion, model/profile/output/pricing reads, successful
  statistics, and managed-artifact retention. Successful slice responses add
  backward-compatible `job_id` and `artifact_id` correlation.
- Managed outputs use ownership metadata, active-download leases, deterministic
  TTL/count/byte eviction, and bounded partial/startup cleanup. Pricing commits
  use serialized candidate snapshots and same-directory exclusive temporary
  files with full writes, file flush, atomic rename, and directory-sync where
  supported. Primary state is `configs/pricing-state/pricing.json`; the legacy
  `configs/pricing.json` is migration input only.
- Production Compose uses a read-only root, root-owned code/profiles, only
  input/output/pricing-state persistent writable binds, restrictive 64 MiB
  `/tmp`, non-root identity, and bounded PID/memory/CPU/log/stop settings.
- This is `PENDING_LOCAL_VALIDATION` until final aggregate, Docker, commit, and
  exact-SHA hosted gates finish. VPS capacity, proxy/private topology, egress,
  S4/S3b, deployment, and production readiness remain `UNVERIFIED`.

## Snapshot and authority

- Historical S0 audit date: **2026-07-18**.
- Historical code baseline: `899f1916437620ab536e912bf404d8da261cc37f`.
- Historical work baseline: `02afc555509f00d432c24520601f4c7034becd81`.
- The only code-to-work-baseline addition is the
  [S0 execution prompt](../../prompts/codex/S0-characterization-and-ci-baseline.md).
- The original topology and capability matrices below are historical S0
  snapshots. The current repository delta is anchored separately; historical
  `ABSENT`/`UNTESTED` labels must not be read as current results.
- This document records repository evidence, not production health. GitHub
  settings, secrets, branch protection, the VPS state, and the deployed version
  are `UNVERIFIED`.

## Current S0.1 verification delta

The current local checkpoint is anchored by
`b1411be8cfd68101eb2a3a909b0e1a428e8c111f` (fail-closed validation and
characterization) and `f9ed1ee6791e531670d5d7703f994bfb51986ebb`
(dependency remediation). The later documentation commit intentionally does not
name itself.

| Surface | Historical S0 snapshot | Current local evidence |
| --- | --- | --- |
| Unit discovery | JS/Python suites absent | 63/63 JavaScript tests pass; Python reports 22 discovered, 22 run, 22 pass, 0 failures/errors/skips; empty discovery fails closed. |
| Tracked syntax | partial named-file checks | Dynamic gates validate 48 JavaScript and 25 Python files and fail on an empty applicable set without creating bytecode. |
| Repository safety | absent | Scanner selects and inspects 146 tracked paths; staged commit gates inspected 20 paths for the characterization commit and 3 for the dependency commit; empty staged scope is allowed only outside required-nonempty mode. |
| Auth/queue/error characterization | untested or source-only | Live timing-safe admin calls, rejected-callback non-execution, and adjacent processing-error status/code ownership have deterministic tests. |
| Production dependency audit | one high plus three moderate findings | Exact npm 10.9.8 locks Express 4.22.2, Multer 2.2.0, body-parser 1.20.6, and qs 6.15.3; full production audit reports zero findings at every severity and the three named S0 registry findings are absent. This did not by itself supply `GHSA-72gw-mp4g-v24j`'s application-level nesting-depth mitigation; S1a adds that separately. |
| Conditional/external gates | unverified | Clean lockfile installation and all local gates pass. Docker image/health smoke is `NOT_RUN_ENVIRONMENT` because no daemon was available; hosted CI, branch protection, required checks, deployment, and production topology remain `UNVERIFIED`. |

This delta verifies a local repository baseline only. A `main` push still had an
independent deployment path in the historical S0/S0.1 snapshot. S3a later
removed that path; neither checkpoint authorizes production promotion.

## Current S1a verification checkpoint

S1a is `VERIFIED` for the local repository checkpoint at implementation commit
`e7a409566bb8795a22f38bbf9f514b42c51bda74`; the later canonical documentation
commit intentionally does not name itself. Exact npm 10.9.8 clean installation,
zero-finding production audit, full deterministic suites, tracked syntax,
tracked and staged safety, whitespace, instruction-mirror, and forbidden-surface
gates passed. Docker image/startup smoke is `NOT_RUN_ENVIRONMENT` because the
client found no daemon and created no Docker resource. This does not verify S3a,
S4, S3b, hosted CI, deployed topology, or promotion readiness.

Current repository evidence:

- [`workspace.js`](../../app/services/slice/workspace.js) creates an unguessable
  marked directory under root-scoped `input/.slice-jobs`, rejects path-segment
  and symlink/junction escapes, owns cleanup idempotently, and may own a final
  output candidate only through exclusive creation and explicit release.
- [`slice.routes.js`](../../app/routes/slice.routes.js) applies the IP limiter
  before allocation, then owns allocation, `upload.single('choosenFile')`, the
  awaited queue-aware handler, and cleanup in one `try`/`finally` lifecycle.
- The multipart envelope is finite: `fileSize` retains the 500 MB safe default
  and hard maximum, `files: 1`, `fields: 40`, `parts: 42`,
  `fieldNameSize: 64`, `fieldSize: 65536`, and fixed, non-configurable
  `fieldNestingDepth: 0`. Bounded environment overrides exist only for the
  configurable values. Busboy 1.6.0 keeps its internal fixed
  `MAX_HEADER_PAIRS = 2000`; no lower application override is claimed.
- Live synthetic multipart tests in
  [`slice-route-lifecycle.test.js`](../../tests/unit/js/slice-route-lifecycle.test.js)
  and
  [`slice-route-multipart-live.test.js`](../../tests/unit/js/slice-route-multipart-live.test.js)
  send a file before `a[b]`, observe HTTP 400 /
  `UPLOAD_FIELD_NESTING_TOO_DEEP` through Multer's `LIMIT_FIELD_NESTING` path,
  and wait for zero request-owned residue. The same focused evidence covers the
  normal flat alias inventory and other parser/admission/failure/success cleanup
  paths without using a real slicer or customer fixture.
- [`server.js`](../../app/server.js) awaits a startup audit before listening.
  Production startup is report-only: destructive stale-workspace recovery is
  not enabled while total lifetime and rolling/shared-volume exclusivity remain
  unproven.
- Final local counts are 132/132 JavaScript tests, 22/22 Python tests, syntax
  over 63 JavaScript and 25 Python files, and safety inspection of 163 tracked
  paths plus the 30-file implementation stage. Node was v24.11.1 and bundled
  Python was 3.12.13. The exact production audit reported zero findings.

## Current I0 S1a/S3a integration checkpoint

The integrated tree retains all S1a upload/workspace/multipart behavior above
and includes the S3a/S3a.1 repository workflow controls. `deploy.yml` is now a
manual exact-candidate preflight only; it calls reusable source and image gates
and has no deployment, registry publication, SSH, VPS, or production-secret
path. Source validation resolves and checks out the exact candidate with
credentials disabled, and its final whitespace gate derives a dynamic
merge-base from `refs/remotes/origin/main`, proves ancestry, and checks that
candidate range without an empty fallback. Image validation builds once, loads
one run-local SHA-tagged image, and reuses it for smoke, SBOM, and fail-closed
HIGH/CRITICAL scanning without pushing it.

Hosted evidence applies to exact original S3a.1 implementation commit
`4f55062096d57a9245282b686fd8619c29c473e8`: Source Validation run
`29680527745` passed; Image Validation run `29680527711` failed closed. The
image failure cause is `UNVERIFIED` and the scan gate must remain fail closed.
Branch protection, required checks, immutable registry digest, signature,
attestation, promotion, production readiness, VPS topology, deployed identity,
and the integrated cherry-pick SHA's hosted results remain `UNVERIFIED`. I0 did
not change `main` or the running VPS.

## Current I1 S1c/S3a integration checkpoint

The canonical current checkpoint is `I1_CHECKPOINT_BLOCKED_IMAGE`, anchored by
runtime commit `995bb9de750ef2a0ebefb22d8cedf6e19c49cf48`. Historical checkpoint
records above and under [`evidence/`](evidence/) remain historical; this section
supersedes their pre-integration stage status without rewriting them.

The integrated cherry-pick equivalents, in exact order, are `a862e2c` (source
`78693fe`, dependency patch), `4c7df9e` (source `b91401e`, S3a-B1), `7bc7946`
(source `edbe81c`, S3a-V1), `6921f7a` (source `fd93c0b`, S3a-B2), `d1db7df`
(source `67a2922`, S1b), `89369d1` (source `fd6f4f3`, S1c), `2fee995`
(source `d1bc413`, S1c evidence), `896f3bf` (source `d0d7dc3`, settlement
polling), followed by `995bb9d`. Dependency patch ID
`5b593dee0baaa1437aedfd4892654bd90c971a4e` occurs once; duplicate `306b799`
was not picked.

Runtime and queue behavior now verified locally:

- `SIGTERM` and `SIGINT` enter one single-flight lifecycle. Queue shutdown
  starts synchronously, HTTP admission closes, and shutdown awaits both drains.
- Queue shutdown rejects new admission with typed HTTP 503
  `SLICE_QUEUE_SHUTDOWN`, aborts queued and active jobs, and does not release an
  active slot/counter until the task promise settles.
- Real queued-job timers enforce wait deadlines independently of worker
  availability. Abort, activation, expiry, shutdown, and settlement clean
  timers/listeners/counters exactly once.
- The effective signal reaches every converter/slicer phase. Native cancellation
  terminates exact process trees with bounded TERM-to-KILL escalation, and an
  unverified tree retains the command and queue slot fail closed.
- Child commands receive an explicit minimal environment. Pre-abort and phase
  guards prevent later work; abort cannot produce a success response or release
  a final artifact. Route/workspace/response cleanup remains awaited.

Local evidence: clean install 175 packages; focused runtime/queue/native 48/48;
focused quality 58/58; aggregate 457/457 JavaScript and 22/22 Python; syntax 86
tracked JavaScript and 25 Python files; repository
safety at the runtime stage over 192 tracked and six staged files, plus final
tracked safety over 196 files and documentation-stage safety over five files;
offline production audit zero. Online
audit is `BLOCKED_POLICY`; `actionlint` and Docker are unavailable. The
transient Graphify service map covered 30 code files, 411 nodes, 767 edges, 15
communities, 659 extracted and 108 inferred relations, with no missing,
dangling, self-loop, or duplicate relation edges; its output was removed.

Hosted exact-source S3a-B2 evidence is mixed. Source run `29957927228`, job
`89051575423`, passed with no annotations or Node 20 warnings. Image run
`29957927370`, job `89051576245`, failed and retained artifact `8545008995`,
digest `sha256:c0c80f843cbea086eb4a8e6a293cd467254b8da67ae1c09b4e84d832a21d3bcc`.
Annotations record liveness exit 1, Grype HIGH, scanner-classifier exit 1, and
final-gate exit 1. Swiper 7.2.0 `GHSA-hmx5-qpq5-p643` /
`CVE-2026-27212` is a known allowed advisory, but the unresolved persistent
runtime liveness failure means it cannot be called the sole image failure.
S3a-V2C is not integrated and its surfaces remain untouched.

Branch protection, required checks, registry digest/signature/attestation,
promotion, S4, S3b, production readiness, VPS topology, and deployed state
remain `UNVERIFIED`. I1 made no `main`, PR/merge, tag/release, registry, VPS,
SSH, or deployment change and authorizes none.

## Current I2 V2C and image-liveness checkpoint

I2 is anchored from exact I1 baseline
`c6110e197ebe7e95d15ba597954108297251fb7b`. It integrates V2C equivalents
`cf45524` and `9f8ae6b` in source order, preserves the I1 queue, native-process,
and graceful-shutdown behavior, installs Swiper 12.1.2 into both Orca resource
trees, and leaves Orca v2.3.1 plus its pinned SHA-256 unchanged.

Hosted A/B/C evidence proved the old tmpfs roots were `0:0`/`0755` and failed
service-user writes while image directories and dynamic `uid/gid/mode=0700`
tmpfs mounts passed. The main container failed at the same
`/app/input/.slice-jobs` path with `EACCES`. The final workflow resolves nonzero
UID/GID from the immutable image, verifies the running process credentials from
host-kernel state, retains both restrictive 64 MiB tmpfs mounts, and requires
both running and healthy. Exact evidence, tests, hosted runs, and remaining
boundaries are recorded in
[`evidence/i2-v2c-liveness-integration.md`](evidence/i2-v2c-liveness-integration.md).

The exact candidate image also runs an offline, non-root Orca 2.3.1 help and
customer-free manifold-cube slice smoke with bounded resources and output. The
gate requires the expected Orca version, one bounded regular G-code file, its
Orca 2.3.1 generator signature, and real extrusion. Smoke and final cleanup
remove only a captured container ID whose immutable image ID and two run-owned
labels match; a reused container name is reported but never removed.

Branch protection and required-check settings, signature/attestation,
immutable registry promotion, S4, S3b, VPS/deployed state, and production
readiness remain `UNVERIFIED`. I2 did not deploy or promote.

## Historical I3 service-auth and HTTP-envelope checkpoint

I5 supersedes this checkpoint's S4 credential, Origin, proxy, readiness, and
observability status. The section remains as historical evidence.

I3 is based on exact commit
`6241685f1af0c0a1d4be6f1c229d66ca922fbb88` on
`codex/i3-s4a-service-auth-http-envelope`. It implements only the slice-service
authentication/browser-Origin subset of S4 and the Node HTTP-server subset of
S2. The worktree has no exact implementation commit yet.

At I3, startup required `SLICE_SERVICE_API_KEY` to contain 32-256
printable-ASCII bytes and differ from the then-broad credential. Both slice endpoints required
`x-slicer-api-key` after the IP limiter and before root-scoped workspace
allocation. Missing or wrong credentials return exact HTTP 401
`{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
The middleware hashes supplied and configured values to fixed-length SHA-256
digests before `crypto.timingSafeEqual`; its rejection event contains only
sanitized request ID and resolved client IP.

Requests without `Origin` remained allowed. Browser-origin slice calls used
only `SLICE_CORS_ALLOWED_ORIGINS`. I5 later completed exact protected-audience
Origin isolation. The Node server applied these defaults/inclusive bounds:
headers timeout 60000 `[1000,60000]`, request timeout 600000
`[60000,600000]`, keep-alive timeout 5000 `[1000,60000]`, header count 2000
`[16,2000]`, connections 128 `[1,1024]`, and requests/socket 100
`[1,1000]`. Empty, non-decimal, unsafe, zero/negative, or out-of-range
overrides use defaults; effective headers timeout is capped at request timeout.

Focused results currently report 469/469 integrated tests, 6/6 focused
Python-runner tests, 5/5 I3 mutation tests, and passing HTTP assertions/repeats.
Final aggregate and hosted exact-SHA results are pending. Root-scoped
`input/`, `output/`, and `configs/` are preserved. No Docker local build,
deployment, or production proof is claimed; actual VPS capacity, proxy
timeouts, private ingress/egress, the remaining S2/S4 exits, and production
state are `UNVERIFIED`. Detailed evidence is in
[`evidence/i3-service-auth-and-http-envelope.md`](evidence/i3-service-auth-and-http-envelope.md).

## Current I4 S2 resource/state checkpoint

I4 starts from exact I3 baseline
`780d64dd786440cb80ddd4df38cb489c16070a07` on
`codex/i4-s2-resource-state-envelope`; the candidate is an uncommitted worktree
delta.

- [`resource-policy.js`](../../app/config/resource-policy.js) centrally bounds
  body/upload lifetime, multipart, ZIP/3MF/SL1, model/output/profile/pricing,
  successful stats/pricing, retention, and cleanup work. Omitted values use
  defaults; an invalid explicit value refuses startup. Multipart expiry maps to
  HTTP 408 `UPLOAD_TOTAL_TIMEOUT`.
- Generated archives validate declared and actual bytes, entry count,
  per-entry bytes, compression ratio, path depth/type/encryption, canonical 3MF
  parts, and archive identity. Success requires bounded contained regular
  outputs and finite positive required stats.
- Workspaces and artifacts use collision-resistant `job-<32 hex>` and
  `artifact-<32 hex>` identifiers. Responses expose `job_id`/`artifact_id`;
  private metadata, download leases, and TTL/count/byte/partial cleanup
  coordinate managed output without exposing metadata in admin downloads.
- Primary pricing state is `configs/pricing-state/pricing.json`. Safe legacy
  `configs/pricing.json` is migration/fallback input. Persistence uses an
  exclusive `0600` temp file, complete write, file fsync, atomic rename, and
  directory fsync where supported, then publishes in-memory state.
- The non-root container keeps code/profiles root-owned and read-only. Compose
  uses a read-only root filesystem, separate `0700` UID/GID-owned writable
  input/output/pricing-state binds, restrictive tmpfs, dropped capabilities,
  no-new-privileges, and bounded PID/memory/CPU/log/stop settings.

Supplied local evidence is green for multipart 24/24, generated archives 5/5,
focused S2/state/container 107/107, container/workflow 382/382, quality focused
73/73, archive 6/6, OpenAPI 5/5, syntax 15/15, exact npm 10.9.8 install, zero
audit vulnerabilities, and diff whitespace. Python integration is
`NOT_RUN_ENVIRONMENT`; active-job container stop orchestration is
`NOT_PROVEN_S2_ACTIVE_JOB_STOP_ORCHESTRATION`. Hosted exact-candidate
validation, VPS/proxy/topology, egress, S4, S3b, and deployment remain pending
or unverified. See
[`evidence/i4-s2-resource-state-envelope.md`](evidence/i4-s2-resource-state-envelope.md).

## System context

The service is a synchronous HTTP API that accepts model/CAD input, invokes
Python and native slicers, stores generated artifacts, and calculates a price.
The authorized target is a private Hostinger sidecar; making it a public slicer
or changing LeadPilot is out of scope
([S0 prompt](../../prompts/codex/S0-characterization-and-ci-baseline.md)).

Actual request-to-artifact sequence:

1. Express applies security headers, CORS, request ID, and body parsers
   ([`app/server.js`](../../app/server.js), middleware registration).
2. A slicing route applies the IP limiter, authenticates `x-slicer-api-key`,
   allocates a marked job directory under root `input/.slice-jobs`, and then
   Multer writes one `choosenFile` into that request-owned workspace
   ([`app/routes/slice.routes.js`](../../app/routes/slice.routes.js),
   `createSliceRouter`;
   [`requireSliceService.js`](../../app/middleware/requireSliceService.js);
   [`workspace.js`](../../app/services/slice/workspace.js),
   `createJobWorkspace`). Authentication rejection allocates no workspace and
   cannot reach Multer, queue admission, or native work.
3. The awaited handler binds request/response disconnects to one abort signal,
   then enqueues the already-uploaded request by resolved client IP
   ([`app/services/slice.service.js`](../../app/services/slice.service.js),
   `handleSlicePrusa` / `handleSliceOrca`).
4. Only after a worker slot opens does `processSlice` receive the queue-owned
   effective signal, parse request options,
   rename/inspect input, convert/orient, transform, and validate build bounds;
   upload, extraction, conversion, orientation, transform, engine staging, and
   request-time profile paths remain inside the owning workspace
   ([`pipeline.js`](../../app/services/slice/pipeline.js), `processSlice`).
5. A runtime profile and argument array are built; `execFile` invokes Python or
   Prusa/Orca with a minimal environment, timeout, and exact-tree cancellation
   ([`app/services/slice/command.js`](../../app/services/slice/command.js),
   `runCommand`).
6. The slicer first writes inside the workspace. A validated regular output is
   exclusively copied to a registered direct child of root `output/`; ownership
   is released only after the success response finishes, otherwise cleanup
   removes the candidate
   ([`output-lifecycle.js`](../../app/services/slice/output-lifecycle.js),
   `runSlicerAndParseStats`; [`response-lifecycle.js`](../../app/services/slice/response-lifecycle.js)).
7. The route-level `finally` runs idempotent workspace cleanup after parser,
   queue, validation, processing, response, or success settlement. The released
   successful `.gcode`/`.sl1` remains in root `output/`.

This order differs from prose that places option validation before queueing; the
code order is authoritative.

## Repository and module map

| Surface | Canonical responsibility and evidence |
| --- | --- |
| Bootstrap | [`app/server.js`](../../app/server.js): admin/service-key startup guards, middleware order, docs/routes, bounded listener. |
| Runtime configuration | [`app/config/constants.js`](../../app/config/constants.js), [`service-auth.js`](../../app/config/service-auth.js), [`paths.js`](../../app/config/paths.js), [`python.js`](../../app/config/python.js). |
| HTTP contract | [`app/routes`](../../app/routes), [`app/middleware`](../../app/middleware), and [`swagger-docs.js`](../../app/docs/swagger-docs.js). |
| HTTP server envelope | [`http-server.js`](../../app/services/http-server.js) validates and applies header/request/keep-alive timeouts, header/connection counts, and requests/socket before listen. |
| Slice orchestration | [`app/services/slice.service.js`](../../app/services/slice.service.js) owns queue settlement and delegates to [`pipeline.js`](../../app/services/slice/pipeline.js), [`output-lifecycle.js`](../../app/services/slice/output-lifecycle.js), and [`response-lifecycle.js`](../../app/services/slice/response-lifecycle.js). |
| Request workspace ownership | [`workspace.js`](../../app/services/slice/workspace.js) owns marked job allocation, containment, output-candidate custody, idempotent cleanup, and audit-only stale classification. |
| Pricing | [`pricing.service.js`](../../app/services/pricing.service.js) facade plus [`pricing/repository.js`](../../app/services/pricing/repository.js) and [`pricing/catalog.js`](../../app/services/pricing/catalog.js). |
| Admin artifacts | [`admin-output.service.js`](../../app/services/admin-output.service.js) validates extension, containment, lstat, and realpath. Its existing filesystem-checking `resolveValidatedOutputFile` helper is exported for tests; it is not a pure helper. |
| Python/native preprocessing | [`app/cad2stl.py`](../../app/cad2stl.py), [`mesh2stl.py`](../../app/mesh2stl.py), [`orient.py`](../../app/orient.py), [`scale_model.py`](../../app/scale_model.py). |
| Profiles/state | Immutable [`configs/prusa`](../../configs/prusa) and [`configs/orca`](../../configs/orca) profiles plus writable primary pricing state `configs/pricing-state/pricing.json`; legacy `configs/pricing.json` is migration/fallback input only. |
| Integration runners | [`tests/testing-scripts`](../../tests/testing-scripts) with shared helpers in `common/`; reports are generated in ignored `results/`. |
| Runtime/container | [`Dockerfile`](../../Dockerfile), [`docker-compose.yml`](../../docker-compose.yml), and [`docker-compose.dev.yml`](../../docker-compose.dev.yml). |
| Automation | [`ci.yml`](../../.github/workflows/ci.yml) and [`image-validation.yml`](../../.github/workflows/image-validation.yml) validate an exact candidate without deployment; [`deploy.yml`](../../.github/workflows/deploy.yml) is a manual no-deploy preflight that calls both gates. |

## Runtime state and artifact lifecycle

- `app/config/paths.js` selects the repository root locally and `/app` in the
  flattened image, preserving root-scoped `input/`, `output/`, and `configs/`;
  S1a adds only the internal `input/.slice-jobs` ownership root.
- Slice authentication now precedes allocation. Multer persists input before
  queue admission, but allocation and persistence occur inside one route-owned
  lifecycle. Full/client-limit rejection and dequeue-time expiry settle before
  its `finally`, so they no longer bypass request-owned workspace cleanup
  ([`slice.routes.js`](../../app/routes/slice.routes.js), `lifecycle`;
  [`queue.js`](../../app/services/slice/queue.js), `enqueueSliceJob`).
- Multer configures finite file/field/part/name/value limits and fixed
  `fieldNestingDepth: 0`; live synthetic evidence exercises the real parser and
  global error mapping. Busboy's header-pair boundary remains its internal fixed
  value 2000. I3 separately bounds the Node server's header/request/keep-alive
  timeouts, header count, connections, and requests/socket. Actual proxy/VPS
  behavior, total streamed upload duration, and measured memory/disk/CPU
  envelopes remain S2 work.
- Queue expiry has an immediate per-job timer and a dequeue-time defense in
  depth. Shutdown and client disconnect use the same effective abort contract;
  active capacity remains occupied until the active task actually settles
  ([`queue-scheduler.js`](../../app/services/slice/queue-scheduler.js),
  `createQueueScheduler`).
- Temporary renamed/extracted/converted/oriented/transformed/profile and native
  staging paths resolve inside the marked workspace. Cleanup validates marker,
  containment, and symlink state before recursive removal; it never recursively
  removes the input or output root.
- Output names contain a sanitized source base plus collision-resistant
  `artifact-<32 hex>` identity. Responses expose `job_id` and `artifact_id`.
  Private metadata and leases support TTL/count/byte/partial cleanup without
  deleting active downloads ([`common.js`](../../app/services/slice/common.js),
  [`artifact-store.js`](../../app/services/artifact-store.js),
  [`response.js`](../../app/services/slice/response.js)).
- Startup classifies only immediate, correctly named and marked stale workspace
  children. It reports but does not delete them. The programmatic deletion mode
  additionally requires a verified exclusive lease and a stale threshold beyond
  a proven bounded lifetime plus safety margin; `server.js` never enables it in
  S1a.
- Pricing is in-memory plus bounded atomic persistence at
  `configs/pricing-state/pricing.json`. Safe legacy state is migrated;
  exclusive temp ownership, file fsync, atomic rename, supported directory
  fsync, and publish-after-persist sequencing prevent failed mutations from
  changing memory ([`pricing.service.js`](../../app/services/pricing.service.js),
  [`pricing/repository.js`](../../app/services/pricing/repository.js)).

## API and compatibility boundaries

Runtime route registration, not README lists, is canonical:

- public liveness/pricing/slicing/docs routes are registered by
  [`server.js`](../../app/server.js), [`slice.routes.js`](../../app/routes/slice.routes.js),
  [`pricing.routes.js`](../../app/routes/pricing.routes.js), and
  [`system.routes.js`](../../app/routes/system.routes.js);
- protected pricing mutations apply `adminRateLimiter` then pricing audience
  authentication; `/admin/**` uses artifact audience; `/health/detailed` and
  `/operations/**` use operations audience;
- `/prusa/slice` and `/orca/slice` apply rate limiting then mandatory
  `x-slicer-api-key` authentication before workspace/Multer/queue/native work;
  active/previous rotation and revocation are repository-tested; deployed
  private binding, proxy/firewall, and egress remain `UNVERIFIED`;
- `choosenFile`, stable status/error mappings, Prusa FDM/SLA, Orca FDM-only,
  profile pairing, pricing behavior, and argument semantics are compatibility
  invariants for behavior-preserving stages;
- OpenAPI is generated structurally by
  [`swagger-docs.js`](../../app/docs/swagger-docs.js); it is not a complete
  inventory of registered routes or runtime error responses.

## External executable and dependency boundaries

- `PYTHON_EXECUTABLE` must be absolute and exist, but regular-file, executable,
  ownership, and symlink provenance are not verified
  ([`app/config/python.js`](../../app/config/python.js)).
- Python helpers load untrusted geometry through `trimesh`/`gmsh`; native
  Prusa/Orca parse the resulting model and profiles. They run in the API process
  container's security domain, not an isolated worker.
- `runCommand` uses `execFile` and exact argument arrays, supplies a tested
  minimal environment, and coordinates timeout/abort cancellation across the
  exact child tree ([`command.js`](../../app/services/slice/command.js),
  [`process-tree.js`](../../app/services/slice/process-tree.js)). POSIX uses a
  detached process group; Windows uses trusted absolute `taskkill.exe` exact-PID
  tree requests. Failed termination proof retains the active slot fail closed.
- Native children no longer inherit arbitrary API environment values. Network
  egress remains unrestricted and belongs to the S4 topology gate.
- Docker verifies versioned Prusa/Orca AppImage SHA-256 values, while Ubuntu
  tags, NodeSource/Apt inputs, unversioned Python requirements, action tags, and
  Compose image tags remain floating
  ([`Dockerfile`](../../Dockerfile), [`requirements.txt`](../../requirements.txt),
  [`image-validation.yml`](../../.github/workflows/image-validation.yml)).

The remaining delivery cycle is formally separated: S3a repository-only
build-once/no-deploy controls are integrated. I4 implements the local S2
resource/state and container-envelope candidate; exact active-job container
stop orchestration and live host/proxy evidence remain unproven. I5 implements
and deterministic-tests the repository credential lifecycle, protected Origin
policy, proxy/request identity, readiness, events, and metrics. Private ingress
plus denied API/native egress is blocked by the locally available Docker
capability and remains unverified on the target host. S3b owns
staging, promotion, readiness, and rollback only after complete S4 evidence and
separate explicit user/owner authorization. No repository result verifies
production topology or authorizes promotion.

## Historical S0 test and CI capability matrix

This table records the pre-implementation work baseline. Use the current S0.1
delta above for present test and audit status.

| Capability at work baseline | Evidence | Result |
| --- | --- | --- |
| JS unit/characterization suite | [`package.json`](../../package.json) has only `start`/`dev` | `ABSENT` |
| Python unit suite | Only network/native integration runners exist under [`tests/testing-scripts`](../../tests/testing-scripts) | `ABSENT` |
| Runner exit truth | Combined and three engine wrappers ignore returned `failed_count` | `PARTIAL` |
| Runtime JS syntax | [`deploy.yml`](../../.github/workflows/deploy.yml) names 11 of 32 tracked runtime JS files | `PARTIAL` |
| Runtime Python syntax | All four `app/*.py` are named, using bytecode-writing `py_compile` | `PARTIAL` |
| Validation-only CI | Only combined validation/deploy workflow exists | `ABSENT` |
| Private fixtures | [`tests/testing-files/.gitkeep`](../../tests/testing-files/.gitkeep) is the only tracked fixture | external prerequisite |
| Mirror consistency | `.github/agents` vs `.claude/agents` and `.github/skills` vs `.claude/skills` are byte-equal at this baseline | verified read-only audit |

## Change-impact map

| Change | Recheck at minimum |
| --- | --- |
| Route/middleware/auth/CORS | route order, error mapping, admin auth, OpenAPI, public contract tests |
| Queue/upload lifecycle | FIFO/concurrency/caps, real deadlines, abort cleanup, per-client counters, disk residue |
| Python/converter/transform | syntax, synthetic geometry fixtures, native arguments, timeout/tree cancellation, bounds |
| Profile selection | filename traversal, existence/compatibility, build volume parsing, Prusa/Orca matrices |
| Pricing | catalog edges, atomic persistence/rollback, protected route policy, lifecycle runner |
| Output/admin download | filename/extension, path/realpath/symlink/race, ZIP caps, retention/quota |
| Docker/dependencies | Compose config, image build, non-root/read-only state, health, SBOM/scan; S3a repository evidence first |
| Workflow/deploy | S3a permissions/triggers/immutable artifact identity and automatic-deploy separation; S3b approval/readiness/rollback after S4 topology evidence |

## Verified documentation/code discrepancies

1. `/health` is liveness only. `/ready` is intentionally minimal; operations
   readiness checks queue/native/storage/retention/pricing/config, while detailed
   health additionally checks Python. This is not a real synthetic native slice.
2. OpenAPI omits docs/root routes and several 413/429/503 responses. It
   also claims default pricing entries cannot be deleted, but route/catalog code
   contains no such guard.
3. Historically, README's “zero-downtime” and broad supply-chain claims exceeded
   the in-place, floating-input deployment then implemented by
   `deploy.yml`/`Dockerfile`. S3a removed that automatic deploy path, but did not
   verify production readiness or the remaining supply-chain claims.
4. `docker-compose.dev.yml` live-mounts three Python helpers but not
   `scale_model.py`.
5. README/config example pricing differs from the code fallback in
   [`app/config/constants.js`](../../app/config/constants.js), `DEFAULT_PRICING`.

## Open unknowns

- `UNVERIFIED`: active GitHub secrets, required checks, branch protection,
  environment approvals, and workflow token defaults.
- `UNVERIFIED`: deployed commit/image and digest, intended/denied callers, VPS
  checkout cleanliness, exact reverse-proxy CIDRs/hops/timeouts, actual host
  capacity, firewall/egress, quotas, backups, monitoring, and rollback readiness.
- `UNVERIFIED`: production secret source, ownership, filesystem mode, and
  current/previous/revoked key state.
- Locally tested process-tree cancellation does not verify hostile
  archive/model parser behavior, exact Prusa/Orca metadata variants, or the
  production/container egress boundary.
- Product/browser policy now has separate protected-audience Origin controls;
  the actual deployed allowlists remain `UNVERIFIED`.

The S1a/S3a manifest freeze was wave-scoped and is closed. The serialized
dependency-maintenance patch is integrated exactly once. Future advisory work
still requires explicit serialized manifest/lock ownership and fresh
install/audit evidence.
