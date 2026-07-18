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

## Classification vocabulary

- `IMPLEMENTED_AND_TESTED`: the control exists and a deterministic, current
  test exercises its security property.
- `IMPLEMENTED_UNTESTED`: the control exists in executable code, but no durable
  deterministic test at this baseline proves it.
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
| Locked production dependency graph | `IMPLEMENTED_AND_TESTED` for the local audit gate | Exact npm 10.9.8 locks Express 4.22.2, Multer 2.2.0, body-parser 1.20.6, and qs 6.15.3. The former one-high/three-moderate result is now zero at every severity; the three named GHSAs are absent. |
| Multipart parser-limit behavior beyond `fileSize` | `NOT_COVERED_S0` | Field/part/header counts and sizes, total upload time, request/header/socket timeouts, and connection limits lack deterministic coverage; see S1a/S2 exits below. |
| `runCommand` argument and environment integrity | `NOT_COVERED_S0` | `execFile` arrays exist, but no current test proves the exact argument/environment contract or a minimal child environment; see S1c. |

The clean lockfile install and local gates passed. Docker image/health validation
was `NOT_RUN_ENVIRONMENT` because no daemon was available. Hosted CI, required
checks, branch protection, deployed state, and production topology remain
`UNVERIFIED`; this local control delta is not promotion authorization.

## Assets and data classification

| Asset | Classification | Security need | Evidence |
| --- | --- | --- | --- |
| Uploaded model/CAD/archive | customer-confidential, untrusted | containment, bounded processing, cleanup | Multer and pipeline in [`slice.routes.js`](../../app/routes/slice.routes.js) / [`slice.service.js`](../../app/services/slice.service.js) |
| Generated `.gcode` / `.sl1` | customer-confidential, integrity-sensitive | authorized disclosure, correlation, retention | [`admin-output.service.js`](../../app/services/admin-output.service.js) |
| Admin API key / deploy secrets | secret | non-disclosure, rotation, least privilege | [`requireAdmin.js`](../../app/middleware/requireAdmin.js), [`deploy.yml`](../../.github/workflows/deploy.yml) |
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
6. Source/lockfiles/build network to container image, then GitHub workflow to
   mutable VPS checkout.
7. API/monitoring containers to the default Compose network and unrestricted
   outbound network.

## Attack surface

- multipart file name, extension, content, size, archive structure, and request
  options on public slice routes;
- JSON/form bodies and Origin/forwarded headers on public and protected routes;
- admin output names and `ALL` archive export;
- native parsers, profile metadata, generated G-code/SL1, and command output;
- in-memory queue/rate state plus disk-backed input/output/pricing state;
- Docker build context, registries/package indexes, GitHub Actions, SSH deploy,
  mutable host checkout, and monitoring image.

## Historical S0 threat and abuse-case matrix

The following table records the pre-implementation S0 audit. Apply the current
delta above when reading test classifications.

| Threat / abuse case | Severity | Current control | Evidence | Gap | Planned verification / stage |
| --- | --- | --- | --- | --- | --- |
| Malicious multipart input or field confusion | High | `PARTIAL`: one `choosenFile`, extension filter, byte cap, rate limiter | [`slice.routes.js`](../../app/routes/slice.routes.js) | extension is not content validation; upload precedes queue admission | Multipart limit behavior is `NOT_COVERED_S0`; S1a parser/workspace controls; S2 content/resource envelope |
| ZIP bomb, traversal, encryption, multiple/unsupported entries | High | `IMPLEMENTED_UNTESTED`: lazy entry inspection, path/entry/declared-size limits, exact one supported file | [`zip.js`](../../app/services/slice/zip.js), `inspectZipFile` | declared sizes can be deceptive; 3MF/native archives bypass this ZIP-specific guard; extraction/runtime disk not quota-bound | S2 generated archive tests, streaming/actual-byte caps, model/archive policy |
| Admin output traversal, symlink, realpath escape, TOCTOU | High | `PARTIAL`: filename extension, containment, lstat non-symlink, realpath containment | [`admin-output.service.js`](../../app/services/admin-output.service.js), `resolveValidatedOutputFile` | validate-then-open race; hard links/mount changes not addressed | S0 filesystem-helper/temp-dir tests; S2 descriptor-based or equivalent race-safe open |
| Native parser/slicer compromise | Critical | `PARTIAL`: non-root container, cap drop, PID cap | [`Dockerfile`](../../Dockerfile), [`docker-compose.yml`](../../docker-compose.yml) | runtime user owns app/config; writable mounts, shared service process, no CPU/RAM/disk/egress isolation | S2 read-only/root-owned layout and quotas; S5 isolated worker decision |
| Command injection through request data | Critical | `IMPLEMENTED_UNTESTED`: centralized `execFile` with argument arrays | [`command.js`](../../app/services/slice/command.js), [`engine.js`](../../app/services/slice/engine.js) | executable provenance, inherited environment, failure-log injection, and descendant lifecycle are not controlled | Argument/environment integrity is `NOT_COVERED_S0`; S1c exact arguments, minimal environment, cancellation; S3 executable provenance |
| CPU/RAM/disk/PID exhaustion | Critical | `PARTIAL`: upload/ZIP caps, queue/rate bounds, command timeout, container PID limit | constants, [`queue.js`](../../app/services/slice/queue.js), Compose | 500 MB defaults are large; no CPU/RAM/tmpfs-size/disk/output quota; direct-child timeout only | S1c cancellation; S2 measured envelope/quotas/streaming; S5 isolation decision |
| Queue starvation, monopolization, or false timeout | High | `PARTIAL`: FIFO, concurrency, max queue, queued+active per-client cap | [`queue.js`](../../app/services/slice/queue.js) | wait expiry is dequeue-only; IP identity is coarse; rejected/expired uploads remain | S0 safe FIFO/cap characterization; S1a workspace ownership; S1b real deadlines, abort, counters, cleanup |
| Proxy spoofing / rate-limit evasion | High | `IMPLEMENTED_UNTESTED`: forwarded headers trusted only with explicit boolean plus CIDR/name list | [`server.js`](../../app/server.js), `resolveTrustProxySetting`; [`client-ip.js`](../../app/utils/client-ip.js) | actual proxy chain/CIDRs are external and `UNVERIFIED` | S4 topology test and proxy-header matrix |
| Admin/internal key compromise or brute force | Critical | `PARTIAL`: mandatory startup key, timing-safe comparison, admin limiter, request ID/IP log | [`requireAdmin.js`](../../app/middleware/requireAdmin.js), route chains | static shared key, no rotation/scope/audience; pricing CORS classification gap; responses lack stable codes | S0 inert-key tests; S4 service-to-service auth and consistent admin policy |
| Output disclosure or cross-job collision | High | `PARTIAL`: admin auth plus extension/path checks | [`system.routes.js`](../../app/routes/system.routes.js), [`common.js`](../../app/services/slice/common.js) | no job ownership, artifact ID, response correlation, TTL; millisecond same-name collision | S2 unique IDs, quotas/TTL/correlation; S4 service authorization contract |
| Cleanup residue after rejection/failure | High | `PARTIAL`: best-effort cleanup inside processing | [`common.js`](../../app/services/slice/common.js), `cleanupFiles` | queue rejection/expiry bypass; orientation failure can leave output; final/partial output retention unbounded | S1a job workspace and cleanup; S1b deadline ownership |
| Supply-chain compromise | Critical | `PARTIAL`: npm lock integrity and AppImage SHA-256 | [`package-lock.json`](../../package-lock.json), [`Dockerfile`](../../Dockerfile) | floating base/Apt/NodeSource/Python/Actions/Compose inputs; no SBOM/sign/scan/provenance | S3 verified pins/hashes, immutable image, SBOM, signing, scan |
| Log injection or confidential-data leakage | Medium | `PARTIAL`: successful command logs gated/truncated | [`command.js`](../../app/services/slice/command.js), [`logger.js`](../../app/utils/logger.js) | failure args/output are unconditional and unescaped; file paths/request metadata may leak; no structured redaction | S4 structured/redacted logs, correlation and injection tests |
| Deploy/readiness/rollback failure | Critical | `ABSENT`: deploy uses fixed sleep plus liveness curl | [`deploy.yml`](../../.github/workflows/deploy.yml) | main push deploys mutable checkout/build; no approval, immutable identity, readiness, rollback; pruning removes fallback | S3 separate artifact build/promotion, human gate, readiness and rollback drill |
| Protected pricing browser-origin policy bypass | High | `PARTIAL`: API key and admin limiter still apply | [`pricing.routes.js`](../../app/routes/pricing.routes.js) | CORS identifies only `/admin/**` in [`server.js`](../../app/server.js) | S4 unified protected-route policy; do not change contract in S0 |

## Current unresolved promotion risks and exact exits

| Risk | Severity | Current evidence | Required exit / owner |
| --- | --- | --- | --- |
| Native Python/slicer compromise can read inherited API-process secrets and use unrestricted egress. | Critical | `runCommand` supplies no child `env`, so children inherit values including `ADMIN_API_KEY`; parser/slicer processes share the API container network boundary. | **S1c:** define the minimum converter/slicer environment allowlist and dynamically prove required entries survive while an inert secret marker and unrelated variables do not; preserve exact argument arrays and add AbortSignal/process-tree cancellation tests. Network egress restriction remains a verified topology/container gate before promotion. |
| Public slice endpoints lack application-layer service authentication. | Critical | `/prusa/slice` and `/orca/slice` have rate limiting but no service-auth middleware. Localhost/private binding is a separate external control and is `UNVERIFIED`. | **S4 service trust + S3 promotion gate:** verify service authentication and private, ingress/egress-restricted topology before production promotion, or record an explicit architect-approved risk decision. Neither current commit is authorization. |
| Multipart/HTTP ingress can exhaust resources beyond `fileSize`. | High | No deterministic evidence covers field/part/header counts or sizes, total upload time, request/header/socket timeouts, or connection limits. | **S1a:** configure and test explicit parser counts/sizes and cleanup for every rejection before/inside the job workspace. **S2:** measure and enforce upload duration, request/header/socket deadlines, connection/concurrency limits, memory and disk envelopes under synthetic load. |
| Validation and deployment remain independently triggerable. | Critical | Validation CI covers PRs/non-main pushes/dispatch, while a `main` push still activates `deploy.yml`; branch protection and required checks are external `UNVERIFIED`. | **S3 + repository administrator:** separate validated build identity from promotion, require external checks/approval, prove readiness and rollback, and block promotion until auth/topology gates above are satisfied. |

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
| Parsing/profile traversal | Node unit tests over value/options helpers | synthetic multipart rejection |
| Stable middleware/auth errors | fake request/response unit tests plus source contract assertions | local inert-key API probe when environment exists |
| Queue safety | isolated-process FIFO/concurrency/cap/overflow tests | synthetic concurrency runner after S1b deadline changes |
| ZIP/model bounds | generated archives and tiny self-authored geometry only | native container probes with legal fixtures |
| Admin output safety | OS-temp helper tests including symlink where supported | race-safe implementation tests after S2 |
| Native command safety | argument/environment integrity is `NOT_COVERED_S0` | exact argument/environment and process-tree cancellation probes in S1c |
| Supply chain | lock/hash/pin policy checks | clean image build, SBOM, scan, signature verification |
| Deployment | workflow structure and permissions checks | human-approved readiness/rollback drill; never inferred from `/health` |

## Accepted risks and non-goals for S0

S0 accepts, documents, and does not fix upload/queue residue, dequeue-only expiry,
direct-child-only timeout, local/container Python path divergence, output/stat
weaknesses, retention/correlation, pricing atomicity, protected-pricing CORS,
container resource gaps, supply-chain immutability, inherited subprocess
environment/egress, unauthenticated public slicing, incomplete multipart/HTTP
ingress bounds, and deployment safety. Their secure expectations and owners are in
[`hardening-plan.md`](hardening-plan.md).

S0 does not add public versions/jobs, a database/broker/object store, customer
fixtures, automatic model healing, LeadPilot integration, or production calls.
Public exposure of the slicer and an isolated async worker are decision-gated,
not implicit scope.
