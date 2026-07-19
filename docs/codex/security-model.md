# Security model

## Scope and deployment assumptions

The original matrices in this model cover the repository at historical code baseline
`899f1916437620ab536e912bf404d8da261cc37f`, audited 2026-07-18. It covers
HTTP ingress, mutable runtime state, Python/native processing, administrative
operations, containerization, CI, and the configured deployment path.

The authorized production intent is a private Hostinger sidecar, not a public
slicing service. Whether GitHub secrets, branch protection, the VPS, reverse
proxy, firewall, monitoring, backups, or the deployed commit are active or safe
is `UNVERIFIED`. A successful `/health` response is not assumed to prove
production readiness
([S0 prompt](../../prompts/codex/S0-characterization-and-ci-baseline.md),
[`system.routes.js`](../../app/routes/system.routes.js)).

The current repository workflow is validation-only: it no longer automatically
deploys a `main` push. This repository fact does not verify or change the
running VPS, production topology, promotion controls, or deployed identity.

## Classification vocabulary

- `IMPLEMENTED_AND_TESTED`: the control exists and a deterministic, current
  test exercises its security property.
- `IMPLEMENTED_UNTESTED`: the control exists in executable code, but no durable
  deterministic test at this baseline proves it.
- `PENDING_LOCAL_VALIDATION`: implementation and focused deterministic evidence
  exist in the active worktree, but mandatory reinstall/audit/full-suite/
  applicable Docker/commit gates have not all completed; this is not verified.
- `PARTIAL`: the control covers only part of the threat or has a material gap.
- `ABSENT`: no effective repository control was found.

These classifications describe the audited baseline, not external production.

## Current S0.1 control delta

Current local evidence is anchored by
`b1411be8cfd68101eb2a3a909b0e1a428e8c111f` (fail-closed validation and
characterization) and `f9ed1ee6791e531670d5d7703f994bfb51986ebb`
(dependency remediation). The historical matrices below remain useful for
unmodified risks, but these current results supersede their old
`ABSENT`/`IMPLEMENTED_UNTESTED` labels for the named controls.

| Current control | Classification | Local evidence and remaining boundary |
| --- | --- | --- |
| Timing-safe admin comparison | `IMPLEMENTED_AND_TESTED` | A live middleware test observes `crypto.timingSafeEqual` for correct, wrong equal-length, and wrong unequal-length inert keys; a direct-equality mutation is rejected. |
| FIFO/concurrency/overflow/client-cap queue | `IMPLEMENTED_AND_TESTED` | Isolated process tests prove ordering/caps and that rejected callbacks execute exactly zero times. Real enqueue deadlines and upload cleanup remain absent. |
| Processing error status/code ownership | `IMPLEMENTED_AND_TESTED` | Dynamic fake-response cases bind every stable mapping, including adjacent invalid-geometry/archive branches, to status and code. |
| Admin output path resolution | `IMPLEMENTED_AND_TESTED` for characterized filesystem cases | `resolveValidatedOutputFile` is the existing filesystem-checking helper newly exported for temporary-directory tests; it is not pure. Descriptor-level TOCTOU protection remains S2 work. |
| Validation discovery and repository safety | `IMPLEMENTED_AND_TESTED` | 63/63 JS tests and 22/22 Python tests pass; syntax covers 48 JS and 25 Python files; 146 tracked paths are safety-inspected and zero-file required scopes fail closed. |
| Locked production dependency graph | `IMPLEMENTED_AND_TESTED` for the local audit gate | Exact npm 10.9.8 locks Express 4.22.2, Multer 2.2.0, body-parser 1.20.6, and qs 6.15.3. The former one-high/three-moderate registry result is now zero at every severity. That audit result did not itself configure the `GHSA-72gw-mp4g-v24j` application mitigation; S1a owns the separate fixed nesting-depth control. |
| Multipart parser-limit behavior beyond `fileSize` | `NOT_COVERED_S0` | Field/part/header counts and sizes, total upload time, request/header/socket timeouts, and connection limits lack deterministic coverage; see S1a/S2 exits below. |
| `runCommand` argument and environment integrity | `NOT_COVERED_S0` | `execFile` arrays exist, but no current test proves the exact argument/environment contract or a minimal child environment; see S1c. |

The clean lockfile install and local gates passed. Docker image/health validation
was `NOT_RUN_ENVIRONMENT` because no daemon was available. Hosted CI, required
checks, branch protection, deployed state, and production topology remain
`UNVERIFIED`; this local control delta is not promotion authorization.

## Current S1a control delta

S1a is `VERIFIED` for the local repository checkpoint at implementation commit
`e7a409566bb8795a22f38bbf9f514b42c51bda74`. Exact npm 10.9.8 clean installation,
the zero-finding production audit, 132/132 JavaScript and 22/22 Python tests,
63-JavaScript/25-Python syntax, safety over 163 tracked paths plus the 30-file
implementation stage, whitespace, mirrors, and forbidden-surface checks passed.
Docker smoke is `NOT_RUN_ENVIRONMENT` because
no daemon was available. These results do not verify S3a, S4, S3b, hosted CI,
production topology, or promotion.

| Current control | Classification | Local evidence and remaining boundary |
| --- | --- | --- |
| Marked per-request workspace ownership | `IMPLEMENTED_AND_TESTED` | [`workspace.js`](../../app/services/slice/workspace.js) allocates random marked directories under `input/.slice-jobs`, uses segment-aware containment and symlink/junction rejection, and cleans idempotently without adopting input/output roots or foreign output candidates. Focused temporary-directory tests exercise uniqueness, marker/version, exact output identity/custody, neighbor preservation, path mutation, and symlink cases. |
| One route lifecycle across upload and queue settlement | `IMPLEMENTED_AND_TESTED` | [`slice.routes.js`](../../app/routes/slice.routes.js) places rate limiting before allocation and awaits Multer plus the queue-aware service inside one cleanup `finally`. Live HTTP cases cover parser failure after a persisted file, missing file, queue full/client cap/expiry mapping, validation failure, downstream throw, abort settlement, and success with zero request-owned residue; focused response-settlement tests cover finish/close/error custody. S1b still owns real queue timers and AbortSignal semantics. |
| Finite multipart parser envelope | `IMPLEMENTED_AND_TESTED` | Actual defaults are `fileSize: 524288000`, `files: 1`, `fields: 40`, `parts: 42`, `fieldNameSize: 64`, `fieldSize: 65536`, and fixed non-configurable `fieldNestingDepth: 0`; bounded overrides cannot restore infinity. Live file-first `a[b]` evidence reaches Multer `LIMIT_FIELD_NESTING`, maps to HTTP 400 / `UPLOAD_FIELD_NESTING_TOO_DEEP`, and observes cleanup. Busboy 1.6.0 retains its internal fixed `MAX_HEADER_PAIRS = 2000`; no lower application override is claimed. Total upload/request/header/socket/connection bounds remain S2 work. |
| Startup stale-workspace audit | `IMPLEMENTED_AND_TESTED` | Startup awaits immediate-child classification before listening and remains audit/report-only. Marked age, malformed/unmarked/fresh entries, symlink roots, partial inspection failure, and the programmatic exclusive-lease/bounded-lifetime deletion preconditions have focused tests. Production deletion remains disabled because total lifetime and rolling/shared-volume exclusivity are unproven. |

## Current I0 workflow-security delta

The integrated S3a/S3a.1 workflows require an exact candidate SHA, check out
with credentials disabled and `contents: read`, build one run-local image for
all image checks, never push or deploy it, and fail closed on missing, malformed,
infrastructure-failed, or HIGH/CRITICAL scan results. Source whitespace is
checked over the dynamically derived `origin/main` merge-base-to-candidate
range, with ancestry proof and no empty fallback.

For exact original implementation commit
`4f55062096d57a9245282b686fd8619c29c473e8`, hosted Source Validation run
`29680527745` passed and Image Validation run `29680527711` failed closed. Its
cause is `UNVERIFIED`; the failure is not evidence of either a clean image or a
confirmed vulnerability finding. Branch protection, required checks, immutable
registry digest, signature, attestation, promotion, production readiness, VPS
topology, and deployed state remain `UNVERIFIED`. I0 touched neither `main` nor
the running VPS.

## Assets and data classification

| Asset | Classification | Security need | Evidence |
| --- | --- | --- | --- |
| Uploaded model/CAD/archive | customer-confidential, untrusted | containment, bounded processing, cleanup | Multer and pipeline in [`slice.routes.js`](../../app/routes/slice.routes.js) / [`slice.service.js`](../../app/services/slice.service.js) |
| Generated `.gcode` / `.sl1` | customer-confidential, integrity-sensitive | authorized disclosure, correlation, retention | [`admin-output.service.js`](../../app/services/admin-output.service.js) |
| Admin API key / historical deployment credentials | secret | non-disclosure, rotation, least privilege | [`requireAdmin.js`](../../app/middleware/requireAdmin.js); current repository workflows request no production credential, while external secret state remains `UNVERIFIED` |
| Pricing data | business-confidential mutable state | authenticated, atomic, recoverable writes | [`pricing.service.js`](../../app/services/pricing.service.js) and repository/catalog modules |
| Slicer profiles | safety/integrity configuration | trusted, read-only to runtime where possible | [`configs`](../../configs), [`profiles.js`](../../app/services/slice/profiles.js) |
| Application/native binaries | executable trusted computing base | provenance, immutability, isolation | [`Dockerfile`](../../Dockerfile), manifests |
| Logs/request IDs | operational, may contain customer metadata | integrity, bounded content, access control | [`logger.js`](../../app/utils/logger.js), command/auth logging |

## Actors and trust boundaries

Actors include anonymous API clients, browser clients, authenticated admin
clients, trusted reverse proxies, repository contributors/CI, the deployment
operator, and an attacker controlling uploaded bytes or request fields.

Material trust boundaries:

1. Internet/client to Express middleware and multipart parser.
2. Express process to mutable `input/`, `output/`, and `configs/` bind mounts.
3. JavaScript to Python, `trimesh`/`gmsh`, PrusaSlicer, and OrcaSlicer native
   processes via `execFile`.
4. Admin key boundary protecting pricing, detailed health, and artifact access.
5. Proxy-to-app boundary controlling forwarded client identity.
6. Source/lockfiles/build network to the run-local validation image. The former
   GitHub-workflow-to-mutable-VPS path is historical and has been removed from
   the repository; any external deployment path is `UNVERIFIED`.
7. API/monitoring containers to the default Compose network and unrestricted
   outbound network.

## Attack surface

- multipart file name, extension, content, size, archive structure, and request
  options on public slice routes;
- JSON/form bodies and Origin/forwarded headers on public and protected routes;
- admin output names and `ALL` archive export;
- native parsers, profile metadata, generated G-code/SL1, and command output;
- in-memory queue/rate state plus disk-backed input/output/pricing state;
- Docker build context, registries/package indexes, GitHub Actions, historical
  SSH deployment, any external mutable host checkout, and monitoring image.

## Historical S0 threat and abuse-case matrix

The following table records the pre-implementation S0 audit. Apply the current
delta above when reading test classifications.

| Threat / abuse case | Severity | Current control | Evidence | Gap | Planned verification / stage |
| --- | --- | --- | --- | --- | --- |
| Malicious multipart input or field confusion | High | Historical `PARTIAL`: one `choosenFile`, extension filter, byte cap, rate limiter; current tested S1a adds finite file/field/part/name/value limits and fixed `fieldNestingDepth: 0` | [`slice.routes.js`](../../app/routes/slice.routes.js); live file-first nesting rejection in [`slice-route-lifecycle.test.js`](../../tests/unit/js/slice-route-lifecycle.test.js) | extension is not content validation; total HTTP/upload resource envelope remains incomplete | S1a parser/workspace controls are locally verified; S2 owns content and measured HTTP/server resource envelope |
| ZIP bomb, traversal, encryption, multiple/unsupported entries | High | `IMPLEMENTED_UNTESTED`: lazy entry inspection, path/entry/declared-size limits, exact one supported file | [`zip.js`](../../app/services/slice/zip.js), `inspectZipFile` | declared sizes can be deceptive; 3MF/native archives bypass this ZIP-specific guard; extraction/runtime disk not quota-bound | S2 generated archive tests, streaming/actual-byte caps, model/archive policy |
| Admin output traversal, symlink, realpath escape, TOCTOU | High | `PARTIAL`: filename extension, containment, lstat non-symlink, realpath containment | [`admin-output.service.js`](../../app/services/admin-output.service.js), `resolveValidatedOutputFile` | validate-then-open race; hard links/mount changes not addressed | S0 filesystem-helper/temp-dir tests; S2 descriptor-based or equivalent race-safe open |
| Native parser/slicer compromise | Critical | `PARTIAL`: non-root container, cap drop, PID cap | [`Dockerfile`](../../Dockerfile), [`docker-compose.yml`](../../docker-compose.yml) | runtime user owns app/config; writable mounts, shared service process, no CPU/RAM/disk/egress isolation | S2 read-only/root-owned layout and quotas; S5 isolated worker decision |
| Command injection through request data | Critical | `IMPLEMENTED_UNTESTED`: centralized `execFile` with argument arrays | [`command.js`](../../app/services/slice/command.js), [`engine.js`](../../app/services/slice/engine.js) | executable provenance, inherited environment, failure-log injection, and descendant lifecycle are not controlled | Argument/environment integrity is `NOT_COVERED_S0`; S1c exact arguments, minimal environment, cancellation; S3a executable provenance |
| CPU/RAM/disk/PID exhaustion | Critical | `PARTIAL`: upload/ZIP caps, queue/rate bounds, command timeout, container PID limit | constants, [`queue.js`](../../app/services/slice/queue.js), Compose | 500 MB defaults are large; no CPU/RAM/tmpfs-size/disk/output quota; direct-child timeout only | S1c cancellation; S2 measured envelope/quotas/streaming; S5 isolation decision |
| Queue starvation, monopolization, or false timeout | High | `PARTIAL`: FIFO, concurrency, max queue, queued+active per-client cap; S1a route ownership now cleans after queue settlement | [`queue.js`](../../app/services/slice/queue.js); [`slice.routes.js`](../../app/routes/slice.routes.js) | wait expiry is dequeue-only and IP identity is coarse | S1a workspace ownership is locally verified; S1b owns real deadlines, abort, and counters |
| Proxy spoofing / rate-limit evasion | High | `IMPLEMENTED_UNTESTED`: forwarded headers trusted only with explicit boolean plus CIDR/name list | [`server.js`](../../app/server.js), `resolveTrustProxySetting`; [`client-ip.js`](../../app/utils/client-ip.js) | actual proxy chain/CIDRs are external and `UNVERIFIED` | S4 topology test and proxy-header matrix |
| Admin/internal key compromise or brute force | Critical | `PARTIAL`: mandatory startup key, timing-safe comparison, admin limiter, request ID/IP log | [`requireAdmin.js`](../../app/middleware/requireAdmin.js), route chains | static shared key, no rotation/scope/audience; pricing CORS classification gap; responses lack stable codes | S0 inert-key tests; S4 service-to-service auth and consistent admin policy |
| Output disclosure or cross-job collision | High | `PARTIAL`: admin auth plus extension/path checks | [`system.routes.js`](../../app/routes/system.routes.js), [`common.js`](../../app/services/slice/common.js) | no job ownership, artifact ID, response correlation, TTL; millisecond same-name collision | S2 unique IDs, quotas/TTL/correlation; S4 service authorization contract |
| Cleanup residue after rejection/failure | High | Historical `PARTIAL`; current tested S1a centralizes marked-workspace cleanup after parser, queue, processing, response, and success settlement | [`workspace.js`](../../app/services/slice/workspace.js); [`slice.routes.js`](../../app/routes/slice.routes.js) | stale production deletion, abort deadlines, and final artifact retention/quota remain deferred | S1a local lifecycle verification; S1b deadline ownership; S2 retention/quota |
| Supply-chain compromise | Critical | `PARTIAL`: npm lock integrity and AppImage SHA-256 | [`package-lock.json`](../../package-lock.json), [`Dockerfile`](../../Dockerfile) | floating base/Apt/NodeSource/Python/Actions/Compose inputs; no SBOM/sign/scan/provenance | S3a verified pins/hashes, immutable image, SBOM, signing, scan |
| Log injection or confidential-data leakage | Medium | `PARTIAL`: normal subprocess failures and unclassified slice failures now emit stable path-free messages; native stdout/stderr remains gated and truncated behind `DEBUG_COMMAND_LOGS=true` | [`command.js`](../../app/services/slice/command.js), [`errors.js`](../../app/services/slice/errors.js), [`logger.js`](../../app/utils/logger.js) | debug native output is unescaped and generic unknown 5xx logging can still include raw error metadata; no centralized structured redaction | S4 structured/redacted logs, correlation and injection tests |
| Deploy/readiness/rollback failure | Critical | Historical S0 `ABSENT`: the former deploy used fixed sleep plus liveness curl; current S3a workflow is no-deploy validation only | [`deploy.yml`](../../.github/workflows/deploy.yml), [`image-validation.yml`](../../.github/workflows/image-validation.yml) | automatic deploy is removed, but no approval, immutable registry identity, signature/attestation, readiness, rollback, or verified production topology exists; hosted image validation is fail-closed red with cause `UNVERIFIED` | S3a-B image/supply-chain diagnosis without weakening the scan gate; S4 topology; S3b only after S4 and separate explicit authorization |
| Protected pricing browser-origin policy bypass | High | `PARTIAL`: API key and admin limiter still apply | [`pricing.routes.js`](../../app/routes/pricing.routes.js) | CORS identifies only `/admin/**` in [`server.js`](../../app/server.js) | S4 unified protected-route policy; do not change contract in S0 |

## Current unresolved promotion risks and exact exits

| Risk | Severity | Current evidence | Required exit / owner |
| --- | --- | --- | --- |
| Native Python/slicer compromise can read inherited API-process secrets and use unrestricted egress. | Critical | `runCommand` supplies no child `env`, so children inherit values including `ADMIN_API_KEY`; parser/slicer processes share the API container network boundary. | **S1c:** define the minimum converter/slicer environment allowlist and dynamically prove required entries survive while an inert secret marker and unrelated variables do not; preserve exact argument arrays and add AbortSignal/process-tree cancellation tests. Network egress restriction remains a verified topology/container gate before promotion. |
| Public slice endpoints lack application-layer service authentication. | Critical | `/prusa/slice` and `/orca/slice` have rate limiting but no service-auth middleware. Localhost/private binding is a separate external control and is `UNVERIFIED`. | **S4 service trust/topology + S3b promotion gate:** verify service authentication and private, ingress/egress-restricted topology before production promotion, or obtain explicit human owner/user-approved, documented risk acceptance. An agent cannot grant this exception. No current commit is authorization. |
| Multipart/HTTP ingress can exhaust resources beyond `fileSize`. | High | Locally verified S1a evidence covers bounded file/field/part/name/value limits, fixed `fieldNestingDepth: 0`, stable error mapping, and cleanup. Busboy's fixed header-pair boundary is 2000; total upload time and server/connection envelopes are not bounded. | **S2:** measure and enforce upload duration, request/header/socket deadlines, connection/concurrency limits, memory and disk envelopes under synthetic load. |
| Validation is not yet a production promotion chain. | Critical | S3a removed the repository's automatic `main` deploy path and added exact-candidate no-deploy gates. Hosted source passed, hosted image failed closed with cause `UNVERIFIED`; branch protection and required checks remain external `UNVERIFIED`. | **S3a-B + repository administrator:** diagnose the image gate without weakening it and verify required-check policy. **S4/S3b:** only after S4 evidence and separate explicit user/owner authorization, prove immutable promotion, staging readiness, and rollback. |

## Historical S0 control inventory

This inventory is the pre-characterization snapshot; the current control delta
above is authoritative for controls tested by S0/S0.1.

| Control | Classification | Rationale |
| --- | --- | --- |
| Single-field upload extension/size guard | `IMPLEMENTED_UNTESTED` | executable Multer configuration exists; deterministic S0 tests absent at baseline |
| ZIP traversal/entry/declared-size guard | `IMPLEMENTED_UNTESTED` | code is present, but hostile generated archive suite is absent |
| FIFO/concurrency/overflow/client-cap queue | `IMPLEMENTED_UNTESTED` | implementation exists; published runner is external black-box only |
| Real queue deadline and upload cleanup on rejection | `ABSENT` | no enqueue timer and no handler cleanup path |
| Timing-safe admin comparison | `IMPLEMENTED_UNTESTED` | equal and unequal length branches call `timingSafeEqual`; no durable unit test |
| Admin output containment/symlink checks | `IMPLEMENTED_UNTESTED` | code exists; root injection/race coverage is absent |
| Shell-free command execution | `IMPLEMENTED_UNTESTED` | `execFile`/arrays exist; no argument-integrity test |
| Native process-tree cancellation | `ABSENT` | direct-child timeout only |
| Output retention/quota/job correlation | `ABSENT` | no policy or implementation found |
| Non-root/cap-drop/PID container | `PARTIAL` | helpful controls exist; runtime code/config remain writable and resources incomplete |
| Reproducible signed/scanned image | `PARTIAL` | slicer hashes and npm lock exist; broader provenance is floating |
| Production readiness/rollback gate | `ABSENT` | liveness-only in-place deploy |

## Mandatory invariants

- Preserve root `input/`, `output/`, `configs/` and the `choosenFile` contract.
- Preserve stable endpoints/status/error vocabulary until an authorized migration.
- Use `execFile` and argument arrays; never shell-interpolate request data.
- Reject invalid geometry without automatic healing.
- Preserve Prusa FDM/SLA and Orca FDM-only profile boundaries.
- Refuse startup without an admin key; keep admin throttling and timing-safe compare.
- Do not expose output without extension/path/symlink/realpath validation.
- Do not treat delayed expiry, upload residue, zero-stat success, timestamp
  collision, or unbounded retention as a desirable characterization.
- Never commit secrets/customer files or mutate LeadPilot from this repository.

## Verification matrix

| Property | Deterministic verification | Integration/operational verification |
| --- | --- | --- |
| Parsing/profile traversal | Node unit tests over value/options helpers and workspace containment | live synthetic multipart limits, including file-first `a[b]` rejection at fixed nesting depth 0 and zero residue |
| Stable middleware/auth errors | fake request/response unit tests plus source contract assertions | local inert-key API probe when environment exists |
| Queue safety | isolated-process FIFO/concurrency/cap/overflow tests | synthetic concurrency runner after S1b deadline changes |
| ZIP/model bounds | generated archives and tiny self-authored geometry only | native container probes with legal fixtures |
| Admin output safety | OS-temp helper tests including symlink where supported | race-safe implementation tests after S2 |
| Native command safety | argument/environment integrity is `NOT_COVERED_S0` | exact argument/environment and process-tree cancellation probes in S1c |
| Supply chain | lock/hash/pin policy checks | clean image build, SBOM, scan, signature verification |
| Deployment | workflow structure and permissions checks | human-approved readiness/rollback drill; never inferred from `/health` |

## Accepted risks and non-goals for S0

S0 accepted and documented upload/queue residue and incomplete multipart bounds.
S1a now locally verifies marked-workspace cleanup and finite parser counts/sizes
with fixed `fieldNestingDepth: 0`. Dequeue-only
expiry, direct-child-only timeout, local/container Python path divergence,
output/stat weaknesses, retention/correlation, pricing atomicity,
protected-pricing CORS, measured HTTP/upload/connection limits, container
resource gaps, supply-chain immutability, inherited subprocess
environment/egress, unauthenticated public slicing, and production promotion,
readiness, and rollback safety remain
open. Their secure expectations and owners are in
[`hardening-plan.md`](hardening-plan.md).

S0 does not add public versions/jobs, a database/broker/object store, customer
fixtures, automatic model healing, LeadPilot integration, or production calls.
Public exposure of the slicer and an isolated async worker are decision-gated,
not implicit scope.

Delivery ownership is separated: S3a repository-only build-once/no-deploy
controls are integrated, while its image/supply-chain exits remain blocked; S4
is service authentication plus proxy/private ingress and egress topology; S3b
is staging/promotion/readiness/rollback only
after S4 evidence and separate explicit user/owner authorization. The
manifest/lock freeze applies only to the S1a/S3a parallel wave; a new advisory
gets a serialized `dependency-maintenance` checkpoint as sole owner. Parallel
lanes return evidence and the integrator reconciles canonical knowledge after
integration; S3a does not edit the canonical files in parallel.
