# Verified project map

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
| Production dependency audit | one high plus three moderate findings | Exact npm 10.9.8 locks Express 4.22.2, Multer 2.2.0, body-parser 1.20.6, and qs 6.15.3; full production audit reports zero findings at every severity and the three named S0 advisories are absent. |
| Conditional/external gates | unverified | Clean lockfile installation and all local gates pass. Docker image/health smoke is `NOT_RUN_ENVIRONMENT` because no daemon was available; hosted CI, branch protection, required checks, deployment, and production topology remain `UNVERIFIED`. |

This delta verifies a local repository baseline only. A `main` push still has an
independent deployment path, so neither S0 implementation commit nor this
knowledge update authorizes production promotion.

## System context

The service is a synchronous HTTP API that accepts model/CAD input, invokes
Python and native slicers, stores generated artifacts, and calculates a price.
The authorized target is a private Hostinger sidecar; making it a public slicer
or changing LeadPilot is out of scope
([S0 prompt](../../prompts/codex/S0-characterization-and-ci-baseline.md)).

Actual request-to-artifact sequence:

1. Express applies security headers, CORS, request ID, and body parsers
   ([`app/server.js`](../../app/server.js), middleware registration).
2. A slicing route applies the IP limiter, then Multer writes one
   `choosenFile` into root `input/`
   ([`app/routes/slice.routes.js`](../../app/routes/slice.routes.js), `router.post`).
3. The handler enqueues the already-uploaded request by resolved client IP
   ([`app/services/slice.service.js`](../../app/services/slice.service.js),
   `handleSlicePrusa` / `handleSliceOrca`).
4. Only after a worker slot opens does `processSlice` parse request options,
   rename/inspect input, convert/orient, transform, and validate build bounds
   ([`app/services/slice.service.js`](../../app/services/slice.service.js),
   `processSlice`).
5. A runtime profile and argument array are built; `execFile` invokes Python or
   Prusa/Orca with a direct-child timeout
   ([`app/services/slice/command.js`](../../app/services/slice/command.js),
   `runCommand`).
6. Output metadata is parsed, pricing is calculated, temporary paths are
   cleaned, and the response is serialized. The final `.gcode`/`.sl1` remains
   in root `output/`
   ([`app/services/slice/response.js`](../../app/services/slice/response.js),
   `buildSliceSuccessResponse`).

This order differs from prose that places option validation before queueing; the
code order is authoritative.

## Repository and module map

| Surface | Canonical responsibility and evidence |
| --- | --- |
| Bootstrap | [`app/server.js`](../../app/server.js): startup guard, middleware order, docs/routes, listener. |
| Runtime configuration | [`app/config/constants.js`](../../app/config/constants.js), [`paths.js`](../../app/config/paths.js), [`python.js`](../../app/config/python.js). |
| HTTP contract | [`app/routes`](../../app/routes), [`app/middleware`](../../app/middleware), and [`swagger-docs.js`](../../app/docs/swagger-docs.js). |
| Slice orchestration | [`app/services/slice.service.js`](../../app/services/slice.service.js) delegates to [`app/services/slice/`](../../app/services/slice). |
| Pricing | [`pricing.service.js`](../../app/services/pricing.service.js) facade plus [`pricing/repository.js`](../../app/services/pricing/repository.js) and [`pricing/catalog.js`](../../app/services/pricing/catalog.js). |
| Admin artifacts | [`admin-output.service.js`](../../app/services/admin-output.service.js) validates extension, containment, lstat, and realpath. Its existing filesystem-checking `resolveValidatedOutputFile` helper is exported for tests; it is not a pure helper. |
| Python/native preprocessing | [`app/cad2stl.py`](../../app/cad2stl.py), [`mesh2stl.py`](../../app/mesh2stl.py), [`orient.py`](../../app/orient.py), [`scale_model.py`](../../app/scale_model.py). |
| Profiles/state | [`configs/prusa`](../../configs/prusa), [`configs/orca`](../../configs/orca), and runtime `configs/pricing.json` resolved by `paths.js`. |
| Integration runners | [`tests/testing-scripts`](../../tests/testing-scripts) with shared helpers in `common/`; reports are generated in ignored `results/`. |
| Runtime/container | [`Dockerfile`](../../Dockerfile), [`docker-compose.yml`](../../docker-compose.yml), and [`docker-compose.dev.yml`](../../docker-compose.dev.yml). |
| Automation | [`deploy.yml`](../../.github/workflows/deploy.yml) combines partial validation with automatic `main` deployment. |

## Runtime state and artifact lifecycle

- `app/config/paths.js` selects the repository root locally and `/app` in the
  flattened image, preserving root-scoped `input/`, `output/`, and `configs/`.
- Multer persists input before queue admission. Full/client-limit rejection and
  dequeue-time expiry do not enter `processSlice`, so no cleanup list runs
  ([`slice.routes.js`](../../app/routes/slice.routes.js), `upload`; [`queue.js`](../../app/services/slice/queue.js), `enqueueSliceJob`).
- Multer configures `fileSize`, but explicit field/part/header count and size
  limits, total upload time, request/header/socket deadlines, and connection
  limits are not characterized. Multipart parser-limit behavior is
  `NOT_COVERED_S0`; S1a owns parser-level ingress tests and S2 owns the measured
  HTTP/server resource envelope.
- Queue expiry is checked only by `runNextSliceJob` after a slot opens; no timer
  enforces the configured deadline while the head worker is busy
  ([`queue.js`](../../app/services/slice/queue.js), `runNextSliceJob`).
- Temporary renamed/extracted/transformed/profile paths are collected and
  best-effort deleted by `cleanupFiles`. Successful final output is deliberately
  outside that list ([`common.js`](../../app/services/slice/common.js),
  `cleanupFiles`).
- Output names contain a sanitized source base plus `Date.now()`, but responses
  expose no job/artifact identifier. There is no TTL, count/byte quota, or stale
  recovery job ([`common.js`](../../app/services/slice/common.js),
  `buildOutputFilename`; [`response.js`](../../app/services/slice/response.js)).
- Pricing is in-memory plus synchronous JSON persistence. A missing/invalid
  pricing file can cause defaults to be written at startup
  ([`pricing.service.js`](../../app/services/pricing.service.js),
  `loadPricingFromDisk`). Atomic replacement/rollback is absent.

## API and compatibility boundaries

Runtime route registration, not README lists, is canonical:

- public liveness/pricing/slicing/docs routes are registered by
  [`server.js`](../../app/server.js), [`slice.routes.js`](../../app/routes/slice.routes.js),
  [`pricing.routes.js`](../../app/routes/pricing.routes.js), and
  [`system.routes.js`](../../app/routes/system.routes.js);
- protected pricing mutations and `/health/detailed` / `/admin/**` apply
  `adminRateLimiter` then `requireAdmin` in their route definitions;
- public `/prusa/slice` and `/orca/slice` have rate limiting but no
  application-layer service authentication; private binding or reverse-proxy
  topology would be a separate external control and remains `UNVERIFIED`;
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
- `runCommand` uses `execFile` and arrays, preventing shell interpolation, but
  its timeout targets the direct child only and does not verify descendant
  termination ([`command.js`](../../app/services/slice/command.js)).
- Python and slicer children inherit the API process environment unless an
  explicit environment is supplied; no minimal allowlist or egress boundary is
  verified. Argument/environment integrity is `NOT_COVERED_S0` and belongs to
  the S1c process contract.
- Docker verifies versioned Prusa/Orca AppImage SHA-256 values, while Ubuntu
  tags, NodeSource/Apt inputs, unversioned Python requirements, action tags, and
  Compose image tags remain floating
  ([`Dockerfile`](../../Dockerfile), [`requirements.txt`](../../requirements.txt),
  [`deploy.yml`](../../.github/workflows/deploy.yml)).

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
| Docker/dependencies | Compose config, image build, non-root/read-only state, health/readiness, SBOM/scan |
| Workflow/deploy | permissions/triggers, immutable artifact identity, approval, readiness, rollback |

## Verified documentation/code discrepancies

1. `CLAUDE.md`/`app/CLAUDE.md` describe option validation before queueing; code
   uploads, queues, then validates inside the worker.
2. README calls queue wait bounded, but expiry is evaluated only when a worker
   slot becomes available (`queue.js::runNextSliceJob`).
3. Root `npm start` runs from the repository root while Python script arguments
   are bare names; Docker works only because `COPY app/ ./` flattens them into
   its working directory ([`input-processing.js`](../../app/services/slice/input-processing.js),
   [`Dockerfile`](../../Dockerfile)).
4. Browser CORS classification covers `/admin/**`, not protected `/pricing/**`
   mutations ([`server.js`](../../app/server.js), `resolveCorsOptions`). API-key
   authentication still applies.
5. `/health` is liveness only; even `/health/detailed` checks profile directories,
   Python, output, and queue rather than a real native slice readiness proof.
6. OpenAPI omits health/docs/root routes and several 413/429/503 responses. It
   also claims default pricing entries cannot be deleted, but route/catalog code
   contains no such guard.
7. README's “zero-downtime” and broad supply-chain claims exceed the in-place,
   floating-input deployment implemented by `deploy.yml`/`Dockerfile`.
8. `docker-compose.dev.yml` live-mounts three Python helpers but not
   `scale_model.py`.
9. README/config example pricing differs from the code fallback in
   [`app/config/constants.js`](../../app/config/constants.js), `DEFAULT_PRICING`.

## Open unknowns

- `UNVERIFIED`: active GitHub secrets, required checks, branch protection,
  environment approvals, and workflow token defaults.
- `UNVERIFIED`: deployed commit/image, VPS checkout cleanliness, reverse proxy,
  firewall/egress, quotas, backups, monitoring, and rollback readiness.
- `UNVERIFIED`: native child-process trees, installed parser behavior under
  hostile archives/models, and exact Prusa/Orca metadata variants.
- `UNVERIFIED`: required output retention, artifact correlation identifier, and
  product policy for browser-origin protected pricing mutations.
