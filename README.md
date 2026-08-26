# 3D Printer Slicer API (FDM & SLA)

![3D Printer Slicer API logo](https://github.com/user-attachments/assets/61739b97-e3ab-4335-a127-5a1370111a5a)

![Node.js](https://img.shields.io/badge/Node.js-20.20.2-339933?style=flat&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Backend-Express_4.18.2-000000?style=flat&logo=express&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat&logo=python&logoColor=white)
![PrusaSlicer](https://img.shields.io/badge/Slicer-PrusaSlicer_2.8.1-orange?style=flat)
![OrcaSlicer](https://img.shields.io/badge/Slicer-OrcaSlicer_2.3.1-8A2BE2?style=flat)
![Docker](https://img.shields.io/badge/Container-Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Ubuntu Next](https://img.shields.io/badge/Next-Ubuntu_24.04-E95420?style=flat&logo=ubuntu&logoColor=white)
![API](https://img.shields.io/badge/API-Prusa%2FOrca_Endpoints-success?style=flat)

An automated 3D slicing and pricing API built with `Node.js` and `Python` that converts supported 3D model and CAD inputs into printable outputs with validated pricing.

The repository target is a private sidecar API. Development Compose binds the
API to host loopback; the dedicated production manifest has no published API
port. Production ingress, egress, proxy hops, and deployment remain
operator-verified gates rather than repository claims.

The dedicated production contract is `docker-compose.production.yml`. It never
builds locally and has no published API port. Before any production Compose
command, export an immutable image reference plus the operator-managed
environment and runtime identity, then run:

```sh
export SLICER_API_IMAGE='registry.example.invalid/owner/3d-printer-slicer-api@sha256:0000000000000000000000000000000000000000000000000000000000000000'
export SLICER_ENV_FILE='./operator/service.env'
export SLICER_UID='10001'
export SLICER_GID='10001'
node scripts/i7-production-compose-contract.js &&
  docker compose -f docker-compose.production.yml config --quiet
```

The all-zero digest and host paths above are inert documentation values, not a
published artifact or secret. An authorized operator can replace them with
verified values and use the same fail-closed preflight before startup:

```sh
node scripts/i7-production-compose-contract.js &&
  docker compose -f docker-compose.production.yml up -d --pull always
```

The external reverse proxy may join the named private bridge from its own
stack and retain a separate approved ingress network. It must not provide
generic forwarding, NAT, or DNS tunnelling for the API. The repository
contract alone does not prove a deployed proxy, firewall, secret, digest, VPS,
or readiness state. The I12 checkpoint below adds bounded point-in-time proof
for one exact dark digest, private readiness, egress denial and socketless
proxy; public caller/firewall/DNS/certificate/route and complete secret-
lifecycle evidence remain separate gates.

---

## ✨ Core Features

- 🔄 **Model-focused input processing:** direct 3D, CAD, and ZIP uploads with exactly one supported model source file.
- ⚖️ **Auto-orientation:** Python-based orientation optimization before slicing.
- 🧮 **Pricing engine:** dynamic hourly-rate calculation from persisted pricing map.
- 🚦 **Queue + rate protection:** bounded queue and endpoint rate limiting for CPU-heavy requests.
- 🧨 **ZIP safety checks:** entry/size/path validation and encrypted ZIP rejection.
- 🧵 **Dual slicer routing:** Prusa and Orca engines behind dedicated endpoints.
- **Resource/state envelope:** actual-byte limits, validated final artifacts,
  stable job/artifact correlation, leased retention, and atomic pricing state.

### J1 calibration harvest over the J0 W2/W3 candidate

The J0 local candidate added a deterministic
`profiles.effective_profile_sha256` to every successful Prusa and Orca response.
After profile selection and before bounds or runtime derivation, canonical real
Prusa files are bounded-read and copied byte-for-byte into job scratch. Orca's
allowlisted, versioned repository copy of the v2.3.1 `Custom` machine/process
parent chain is bounded-read, resolved, and flattened before its exclusive
snapshot is created; a Docker build gate requires semantic equality with the
exact pinned native parent files. Unknown,
cyclic, role-mismatched, symlink/non-canonical, and detected-growth inputs fail
closed. Bounds parsing, runtime-profile derivation, digest construction, and
native invocation all use that snapshot lineage, while response profile
metadata and `build_volume_limits_mm.source_profile` retain the original stable
selected child basenames. A parent-only Orca value change therefore changes the
digest. J1 extends that identity to cover normalized material and selected Orca
filament JSON or explicit null beside the configured effective machine/process
layers, stable Orca relative-extrusion settings (`layer_gcode=''` and
`use_relative_e_distances='1'`) aligned with the flattened pinned machine
parent's per-layer `G92 E0` reset, and the request-independent native invocation
policy while excluding request-selected layer height and infill. The Prusa
export flag and Orca machine-process-filament settings precedence are derived from
that same digest-covered policy. Prusa INI section and key case remains
significant during canonicalization, and exact duplicate profile keys fail
closed to match the native Boost parser. Runtime generation replaces one exact
top-level request-owned key, rejects a duplicate top-level key, and inserts a
missing request key before the first section.

OpenAPI now names the four requested previously omitted runtime codes:
`FILE_PROCESSING_TIMEOUT`, `INTERNAL_PROCESSING_ERROR`,
`ORCA_PROFILE_INCOMPATIBLE`, and `MODEL_OUT_OF_PRINTER_BOUNDS`. The bounds error
requires both `model_dimensions_mm` and `build_volume_limits_mm`. The adjacent
review also added the already-live `MODEL_DIMENSIONS_UNAVAILABLE` code to the
general validation branch, so that payload now matches exactly one 422 `oneOf`
branch. The slice HTTP 500 schema now lists the complete live set:
`SLICE_OUTPUT_UNPARSED`, `INTERNAL_PROCESSING_ERROR`, `QUEUE_INTERNAL_ERROR`,
`UPLOAD_STORAGE_ERROR`, and `INTERNAL_SERVER_ERROR`.

Slice authentication still accepts only `x-slicer-api-key`, but supports
independently rotatable WooCommerce and LeadPilot key pairs.
`SLICE_SERVICE_AUTH_MODE` explicitly selects `legacy` (the default shared-key
compatibility mode), `migration` (shared plus both principals with a mandatory
future expiry no more than 90 days away; at expiry shared slots stop authorizing
requests while principals continue), or `principals` (both principals and no
shared key). A one-consumer or mode/slot/expiry mismatch is rejected. The
route-activation target is `principals`; `GET /health` and `GET /pricing`
remain authentication-free.

No Compose manifest change is required for these names because the existing
`env_file` contract passes the selected environment file through. External
production activation is outside repository evidence and authority.

Every success also requires a startup-verified `engine_version`. Before listen,
the server atomically parses both selected executables' bounded `--help` output
and publishes neither version unless both succeed. The exact candidate image
returned exit 0 with bounded Prusa/Orca help output; `--version` returned exit
1 for both, so it is not the supported probe. The startup module separately
passed in a network-disabled, non-root, read-only exact-image envelope and
published `2.8.1+linux-x64-GTK3-202409181416` and `2.3.1` atomically. Startup
version probes use a telemetry-disabled command runner, so they cannot alter
slice-native events, outcome counters, or duration buckets. Orca
invocation now passes `--arrange 1` and `--orient 0`:
arrangement places already-rotated geometry onto the build plate, while native
auto-orient remains disabled and does not replace the requested rotation.
Focused startup/parser/cache/failure, response, parent-resolution/digest-
mutation, and corrected command contracts pass. The superseded arrangement-
disabled HTTP probe retained negative Y after an X90 origin rotation and failed
closed with native status 206 / `Nothing to be sliced`; its earlier translated
direct-smoke fixture did not cover that seam. The final local exact-image HTTP
E2E passed in a network-disabled, read-only, healthy container: pre-request
dimensions 30 x 20 x 10 mm plus request rotation X90 produced final dimensions
30 x 10 x 20 mm. Separate WooCommerce and LeadPilot requests returned Orca
`2.3.1`, the same lowercase effective digest, and original profile basenames.
A valid WooCommerce credential only under `x-api-key` returned the exact HTTP
401 without workspace, queue, or artifact effects, confirming
`x-slicer-api-key` remains the only slice header; the final queue was idle and
exact cleanup passed. Code-bearing SHA
`ed85eec63409b7362fe05c2b99031eeb24b5b9c9` produced retained local image ID
`sha256:66697a1ca69e13600a91481bf474d042c0f89b236ccbaf67fcf2dea8824f2c7f`.
The complete J0 local aggregate also passes; hosted exact-SHA validation remains
unverified.

J1 adds repository PLA/PETG filament profiles. Orca snapshots the selected
filament bytes and loads native settings in machine-process-filament order.
Successful Orca responses expose nullable `filament_profile`,
`filament_diameter_mm`, and `filament_density_g_cm3`; an unsupported or missing
profile returns explicit nulls, changes the effective-profile digest, and forces
`hourly_rate:null` plus `stats.estimated_price_huf:null` so the API does not
calculate an automatic price. Strict FDM parsing is default-on through
`SLICE_STRICT_GCODE_METRICS=true` and requires positive time and filament-length
markers. OpenAPI requires the nullable `stats.material_used_g` field, which is
populated only from a direct G-code mass marker and is never derived from length.
A later container diagnosis showed that the affected Prusa FDM output contains
a recognized `0.00 g` marker, superseding the earlier no-marker assumption. J1C
maps a missing or recognized non-positive optional marker to
`material_used_g:null`, `hourly_rate:null`, and
`stats.estimated_price_huf:null` for manual pricing while keeping positive time
and length mandatory; zero is never published. Orca with a selected filament
profile still requires positive direct grams: recognized zero remains
`GCODE_FILAMENT_NOT_POSITIVE` -> `SLICE_OUTPUT_UNPARSED`, and missing/drifted
required markers remain bounded HTTP 500. Profile-less Orca remains on the
null/manual-pricing path. The J1C focused correction passes 19/19 tests; the
complete local aggregate passes 2212/2212 JavaScript tests and 84 Python tests
with one expected Windows POSIX-permission skip. Exact-image/container and
hosted behavior remain unverified.

This candidate is not deployed or a public-activation result. The retained P1S
and new H2D candidates identify as generic Marlin profiles, not verified native
Bambu profiles. A bounded audit parsed 11/11 supplied JSON files, matched 11/11
declared hashes, and derived P1S 256 x 256 x 250 mm and H2D 350 x 320 x 325 mm,
but the set is not self-contained: 11 include templates, H2D-compatible and
0.1/0.3 BBL processes, vendor filament/parent chains, and required material
fields are missing; redistribution/license and exact Orca 2.3.1 compatibility
are unverified. No vendor/resolver/runtime change was made, the generic profiles
remain, and the selected-filament Orca incompatibility is not fixed. W8 live
calibration remains `BLOCKED_OWNER_INPUT`.

Capability readiness is a proposal only. Public `GET /health` remains cheap
liveness, and future slicing-capability state belongs on public `GET /ready`.
Docker continues to check `/health`, while Traefik already consumes `/ready`, so
a future capability-driven 503 can withhold routing without making Docker
unhealthy. Startup Prusa plus selected-filament Orca probes and typed rolling
per-engine failure/recovery need a separate implementation and Docker/VPS
evidence; raw last-N HTTP 5xx is not a safe readiness rule. See
[`docs/codex/evidence/j1c-slice-contract-corrective.md`](docs/codex/evidence/j1c-slice-contract-corrective.md).

### I12 Hostinger production-qualification checkpoint

The deployed API image source is the protected-main checkpoint
`f71069cb3ba5ddeb97e69ca1414a00a72a20ce28`; its no-deploy Source/Image,
signed Candidate Publication, and automatic rehearsal passed. The exact signed
API image
`ghcr.io/botond1/3d-printer-slicer-api@sha256:d50c72bd084e14645f2c9c7b18a087317bf080a2d76cf1bc876d5e3427ae1e26`
is healthy and dark on the authorized Hostinger VPS at retained concurrency
one. It has no host-published API port or API default route, and no public
slicer router is active.

The corrected socketless Traefik operator pack reached protected main
`7c8aee0728fc8462c67b4c6d85636bffb7afcdf8` through PR `#5`; exact-main Source
`32804297840` and Image `32804297658` passed. The dark cutover is verified:
the file-provider-only proxy is healthy, has no Docker socket/provider, uses
ingress/private `gw_priority: 1/0`, routes its own default path through ingress,
and owns exact IPv4 and IPv6 host listeners for 80/443. The API remains only on
the private internal network. The failed-cutover residue was identity-bound
reconciled, the old proxy is intentionally retained stopped for rollback, and
ACME bytes are unchanged. The operator commits did not rebuild, relabel, or
republish the API image.

This remains a dark deployment: the dynamic slicer router is absent. Approved
hostname/DNS, intended public caller/CIDR, firewall acceptance, certificate
issuance/continuity, route activation, monitoring/recovery acceptance, customer
traffic, and public production completeness remain unverified and separately
authorized.
See [`ops/hostinger/RUNBOOK.md`](ops/hostinger/RUNBOOK.md).

### Immutable candidate image contract

The I10 protected-main governance checkpoint was verified at
`8253160eef1c3e00c1e40826ec61fd97563ddd9b`. Source run `32662043454` and
Image run `32662043476` succeeded. Main strictly requires the two no-deploy
GitHub Actions checks, a pull request, administrator enforcement and resolved
conversations; force-push and deletion are disabled. Merge commit is the sole
enabled merge strategy. Required reviews are zero because `Botond1` is the only
collaborator and cannot self-approve; that is a capability limit, not human
approval. Rulesets are empty and required signatures are not enabled.

I11 productizes the fail-closed GHCR path as manual `workflow_dispatch` only
from the exact current protected-main SHA. It has two modes:

- `publish_new`: `existing_registry_digest` is empty, confirmation is exactly
  `PUBLISH_SIGNED_MAIN_CANDIDATE`, and the SHA-derived discovery tag must be
  proven absent before the once-built, fully gated image is pushed.
- `recover_exact_digest`: confirmation is exactly
  `RECOVER_SIGNED_MAIN_CANDIDATE`, the supplied lowercase
  `sha256:<64 hex>` digest and existing SHA-derived tag/config identity must
  match the once-built image, and no registry push, overwrite or delete occurs.

Only the publication job may receive registry/attestation/OIDC write
permissions. It uses the `candidate-publication` environment with
`deployment: false`. Environment ID `20443404498` is live-verified as of
2026-08-23 with protected branches enabled, custom branch policies disabled,
exactly one `branch_policy` protection rule (ID `63481958`), and no reviewer or
wait-timer rules, secrets, variables or deployments. No reviewer is possible
while `Botond1` is the sole collaborator.

The discovery tag is derived from the full source SHA and is not an immutable
consumption reference. After a successful publication/recovery and attestation
run, consumers must use only:

```text
ghcr.io/botond1/3d-printer-slicer-api@sha256:<64 lowercase hex>
```

The path builds once, completes the full exact-image gate before registry
mutation, resolves and round-trips the digest, and verifies digest-bound
GitHub/Sigstore SLSA provenance plus SPDX SBOM attestations. It never creates
`latest`, semver, staging or production tags and never deploys.

After a successful protected-main Candidate Publication, an automatic
`workflow_run` rehearsal accepts exactly one bounded publication artifact. It
combines the artifact's current signed digest with the policy-pinned previous
signed digest into a dynamic digest-only manifest, verifies both images' SLSA
and SPDX attestations through API and OCI, then reuses the hardened I9 runtime
lane: private-peer readiness, controlled `STORAGE_UNSAFE` failure, automatic
exact-previous rollback, bounded evidence and exact cleanup. The rehearsal is
registry-read-only/no-deploy and has no OIDC, environment or VPS authority.

I11 is complete at its protected-main checkpoint SHA
`65706e381b907c6ba09a8eba504af3adaacac86b`. Source run `32668796239`, Image
run `32668796232`, signed Candidate Publication run `32669087688`, and automatic
rehearsal run `32669484893` all succeeded. The immutable digest is
`sha256:5d209de83d8ddd601fbda8232e6e40f9a641af6d31aa94e99e7c313715a6216c`;
SLSA/SPDX attestation IDs are `42462498`/`42462513`. Publication and rehearsal
remain no-deploy evidence: they do not prove production proxy, firewall,
secrets, deployed state, caller authorization, capacity, or live rollback.

---

## 📂 Supported File Formats

| Category | Extensions |
| --- | --- |
| Direct 3D | `.stl`, `.obj`, `.3mf` |
| NURBS / CAD | `.stp`, `.step`, `.igs`, `.iges`, `.ply` |
| Archive | `.zip` |

---

## 🔑 Authentication

Each non-slice protected audience has a distinct active key and optional
previous rotation slot. The slice audience has one shared compatibility family
plus independent WooCommerce and LeadPilot families:

| Audience / principal | Active / previous environment keys | Header |
| --- | --- | --- |
| Slice shared compatibility | `SLICE_SERVICE_API_KEY`, `SLICE_SERVICE_API_KEY_PREVIOUS` | `x-slicer-api-key` |
| Slice WooCommerce | `SLICE_SERVICE_WOOCOMMERCE_API_KEY`, `SLICE_SERVICE_WOOCOMMERCE_API_KEY_PREVIOUS` | `x-slicer-api-key` |
| Slice LeadPilot | `SLICE_SERVICE_LEADPILOT_API_KEY`, `SLICE_SERVICE_LEADPILOT_API_KEY_PREVIOUS` | `x-slicer-api-key` |
| Pricing | `PRICING_API_KEY`, `PRICING_API_KEY_PREVIOUS` | `x-api-key` |
| Artifact | `ARTIFACT_API_KEY`, `ARTIFACT_API_KEY_PREVIOUS` | `x-api-key` |
| Operations | `OPERATIONS_API_KEY`, `OPERATIONS_API_KEY_PREVIOUS` | `x-api-key` |

Pricing, artifact, and operations active keys are always required.
`SLICE_SERVICE_AUTH_MODE` defaults to `legacy` and accepts only:

- `legacy`: shared active required; both principal families and
  `SLICE_SERVICE_LEGACY_MIGRATION_UNTIL` absent;
- `migration`: shared active and both principal actives required; the slice
  migration expiry is parseable, in the future, and no more than 90 days away.
  Shared active/previous authorize only while request time is strictly before
  that expiry; both principal families continue at and after it;
- `principals`: both principal actives required; shared active/previous and the
  slice migration expiry absent. This is the route-activation target.

Before any route activation, the dark-container readback must prove
`principals`, both principal actives, and absent shared active/previous and
expiry. This J0 initial-activation gate also requires both principal previous
slots absent. A private synthetic matrix must pass one slice for each principal,
reject every available retired shared credential under `x-slicer-api-key`, and
reject a correct principal sent only under `x-api-key`, with exact cleanup. Any
missing or inconclusive result keeps the route dark. External production
activation is outside repository evidence and authority.

A previous slot is optional only when its own active exists. Every configured
value must be unique across all audiences, principals, and slots and contain
32-256 bytes of printable ASCII; missing, malformed, placeholder-like, reused,
duplicate, or mode-incompatible material refuses startup with a generic error.

For a later, separately owner-authorized rotation, set the replacement as active
and the former active as previous, then restart once. Before continuing, the dark
gate must positively authenticate every configured previous slot and record its
owner-approved removal deadline. Move the intended caller to the replacement,
remove the previous slot, and restart a second time; exact HTTP 401 plus no
workspace, queue, or artifact effects proves revocation. Key rings are
snapshotted at startup.

`ADMIN_API_KEY` is separate from the shared slice compatibility family and is
not a normal credential. It can temporarily fill one missing non-slice active
audience only when
`LEGACY_ADMIN_API_KEY_AUDIENCE` names `pricing`, `artifact`, or `operations`
and `LEGACY_ADMIN_API_KEY_MIGRATION_UNTIL` is a valid future timestamp no more
than 90 days away. Any configured valid `ADMIN_API_KEY` participates in global
key uniqueness; only its exact authorized substitution for that missing scoped
active avoids duplicate self-registration. Slice and multi-audience legacy
migration are rejected.

Missing or wrong slice credentials return HTTP `401`:

```json
{
  "success": false,
  "error": "Slice service authentication is required.",
  "errorCode": "SLICE_SERVICE_AUTH_REQUIRED"
}
```

All configured active and previous slots use fixed-length digest comparisons.
Authentication events contain bounded correlation/audience fields, never key
material. Requests without `Origin` are allowed; browser-origin protected calls
must match only the audience-specific `SLICE_`, `PRICING_`, `ARTIFACT_`, or
`OPERATIONS_CORS_ALLOWED_ORIGINS` list.

---

## 🌐 Endpoints

### Public

- `GET /health`
- `GET /ready`
- `GET /pricing`
- `GET /openapi.json`
- `GET /docs`
- `GET /`

### Slice-service-protected

- `POST /prusa/slice`
- `POST /orca/slice`

### Pricing-protected (`PRICING_API_KEY`)

- `POST /pricing/FDM`
- `POST /pricing/SLA`
- `PATCH /pricing/:technology/:material`
- `DELETE /pricing/:technology/:material`

### Artifact-protected (`ARTIFACT_API_KEY`)

- `GET /admin/output-files`
- `GET /admin/download/:fileName`

### Operations-protected (`OPERATIONS_API_KEY`)

- `GET /health/detailed`
- `GET /operations/readiness`
- `GET /operations/metrics`

---

## 🧩 Application Module Map (app/*.js)

### Bootstrap

- `app/server.js` - Express bootstrap, startup guards, helmet/cors, request-id propagation, docs mounting, routes, and global error handling.

### Configuration

- `app/config/constants.js` - runtime defaults, layer presets, limits, and extension groups.
- `app/config/paths.js` - root-scoped runtime path resolution (`input/`, `output/`, `configs/`) and directory creation.
- `app/config/python.js` - secure Python executable resolver (`PYTHON_EXECUTABLE` + `VIRTUAL_ENV` fallbacks).
- `app/config/service-auth.js` - scoped active/previous credential validation, independent slice-consumer rings, immutable startup key ring, and finite non-slice legacy migration.
- `app/config/route-policy.js` - method-aware protected audience classification.
- `app/config/trust-proxy.js` - fail-closed explicit proxy CIDR/loopback trust compilation.

### Middleware

- `app/middleware/rateLimit.js` - in-memory IP throttling for slice and admin routes (`Retry-After` aware responses).
- `app/middleware/requireAdmin.js` - scoped pricing/artifact/operations x-api-key guards.
- `app/middleware/requireSliceService.js` - timing-safe x-slicer-api-key guard with sanitized request-ID/IP-only rejection logs.
- `app/middleware/requireAudience.js` - shared fixed-digest active/previous authentication.
- `app/middleware/corsPolicy.js` - exact per-audience browser-origin allowlists with no-Origin service support.
- `app/middleware/requestId.js` - bounded inbound request-ID validation and response propagation.
- `app/middleware/requestObservability.js` - request lifecycle events and fixed-cardinality counters.
- `app/middleware/errorHandler.js` - centralized request/upload/parser error normalization.

### Routes

- `app/routes/slice.routes.js` - `POST /prusa/slice`, `POST /orca/slice` with limiter -> service auth -> workspace/Multer -> queue/native ordering.
- `app/routes/pricing.routes.js` - public pricing read + admin pricing mutations.
- `app/routes/system.routes.js` - health endpoints and admin artifact listing/download endpoints.

### Services

- `app/services/pricing.service.js` - pricing load/save/migration/lookup logic.
- `app/services/http-server.js` - validated Node HTTP timeouts and connection/header/socket bounds.
- `app/services/readiness.service.js` - cached admission-aware readiness probes and stable reason codes.
- `app/services/observability/` - structured event context, redaction, and bounded metrics.
- `app/services/admin-output.service.js` - validated admin output listing/download helpers and `ALL` ZIP bulk limit checks.
- `app/services/slice.service.js` - end-to-end slicing orchestrator and queue error mapping.
- `app/services/slice/command.js` - subprocess execution via `execFile` with timeout and optional debug logs.
- `app/services/slice/common.js` - output naming, isolated Orca output dirs, cleanup utilities.
- `app/services/slice/engine.js` - slicer argument construction, including Orca's fixed `--arrange 1` / `--orient 0` placement/orientation policy.
- `app/services/slice/engine-version.js` - atomic pre-listen resolution of both actual slicer versions from bounded `--help` output.
- `app/services/slice/errors.js` - error classification and API error responses.
- `app/services/slice/input-processing.js` - conversion/orientation preprocessing pipeline.
- `app/services/slice/model-stats.js` - metadata/stat parsing from slicer outputs.
- `app/services/slice/number-utils.js` - shared numeric parser helpers.
- `app/services/slice/options.js` - strict request option validation/parsing.
- `app/services/slice/profiles.js` - profile selection, runtime profile generation, build-volume limits.
- `app/services/slice/orca-profile-inheritance.js` - bounded resolution of the versioned repository copy of the Orca v2.3.1 `Custom` parent chain.
- `app/services/slice/profile-snapshot.js` - exact Prusa-byte and flattened Orca profile snapshots in job scratch.
- `app/services/slice/profile-digest.js` - deterministic effective-profile and request-independent native-invocation identity excluding request layer-height/infill overrides.
- `app/services/slice/queue.js` - FIFO queue + per-client fairness + timeout enforcement.
- `app/services/slice/transform.js` - transform planning/execution and bounds validation.
- `app/services/slice/value-parsers.js` - safe parsing and profile filename sanitization.
- `app/services/slice/zip.js` - ZIP safety inspection and safe extraction.

### Utilities and API docs

- `app/utils/client-ip.js` - Express trust-proxy-aware validated client IP normalization.
- `app/utils/logger.js` - structured allowlisted processing-event emission.
- `app/docs/swagger-docs.js` - OpenAPI generation for `/docs` and `/openapi.json`.

---

## 🧠 Slicing API Behavior

Both slicing endpoints accept `multipart/form-data` with required file field:

- `choosenFile`

They also require exactly one `x-slicer-api-key` header containing an accepted
active or previous key from the configured slice-key mode. `x-api-key` is never
a slice-auth alias. Admission order is rate limiter -> service authentication
-> root-scoped workspace allocation -> Multer upload -> queue -> native
processing. An authentication rejection occurs before any request workspace,
upload, queue admission, or native process.

Optional fields:

- `layerHeight`
- `material`
- `infill` (`0`-`100`)
- `sizeUnit` (`mm` or `inch`)
- `keepProportions` (`true`/`false`, default `true`)
- `targetSizeX`, `targetSizeY`, `targetSizeZ` (target dimensions in selected unit)
- `scalePercent` (uniform scale; cannot be combined with `targetSizeX/Y/Z`)
- `rotationX`, `rotationY`, `rotationZ` (degrees)
- `printerProfile` (profile override filename)
- `processProfile` (Orca only process profile override filename)

### `POST /prusa/slice`

Uses `prusa-slicer`.

- Auto-selects technology by `layerHeight`:
  - `0.025`, `0.05` → `SLA`
  - `0.1`, `0.2`, `0.3` → `FDM`
- Rejects invalid `layerHeight` values outside `0.025, 0.05, 0.1, 0.2, 0.3`
- Validates material/technology compatibility
- Supports size preprocessing before slicing:
  - mm/inch target dimensions
  - aspect-ratio lock (`keepProportions=true`)
  - free X/Y/Z sizing (`keepProportions=false`)
  - optional X/Y/Z rotation
- Validates final model size against selected printer profile limits (`min`/`max` build volume)
- You can override profile file with `printerProfile` from `configs/prusa`
- A missing or recognized non-positive optional G-code grams marker keeps
  required-but-nullable `stats.material_used_g:null`, `hourly_rate:null`, and
  `stats.estimated_price_huf:null`; zero is never published and no length/
  density conversion or automatic price is applied. Positive time and filament
  length remain required.

Example:

```bash
curl -X POST http://localhost:3000/prusa/slice \
  -H "Accept: application/json" \
  -H "x-slicer-api-key: <AUTHORIZED_SLICE_KEY>" \
  -F "choosenFile=@/path/to/model.stl" \
  -F "layerHeight=0.2" \
  -F "material=PLA" \
  -F "infill=20" \
  -F "sizeUnit=mm" \
  -F "keepProportions=true" \
  -F "targetSizeZ=120"
```

### `POST /orca/slice`

Uses `orca-slicer`.

- Forced `FDM` processing
- Allowed `layerHeight`: `0.1`, `0.2`, `0.3`
- Rejects SLA-only materials
- Runs with Orca arrange/orient flow and machine+process+optional-filament profile order
  - Machine profile file is resolved from `.env` via `ORCA_MACHINE_PROFILE` (default: `Bambu_P1S_0.4_nozzle.json`)
- Process profile file is selected by `layerHeight` (`0.1/0.2/0.3`) and can be overridden via `.env`:
  - `ORCA_PROCESS_PROFILE_0_1`
  - `ORCA_PROCESS_PROFILE_0_2`
  - `ORCA_PROCESS_PROFILE_0_3`
- PLA/PETG resolve to `configs/orca/filament/PLA_generic.json` or
  `PETG_generic.json`; an unmapped/absent profile remains explicit null.
- The null-profile success path also returns `hourly_rate:null` and
  `stats.material_used_g:null` plus `stats.estimated_price_huf:null`; it requires
  manual pricing.
- Successful Orca profile metadata exposes the selected filament basename and
  the diameter/density read from the exact job snapshot.
- FDM output requires positive direct time and length markers. With a selected
  Orca filament profile it additionally requires a positive direct gram marker;
  missing or drifted grams return HTTP 500 `SLICE_OUTPUT_UNPARSED`.
  `SLICE_STRICT_GCODE_METRICS=false` is diagnostic-only.
- Request-level profile overrides are supported:
  - `printerProfile` → machine profile from `configs/orca`
  - `processProfile` → process profile from `configs/orca`
- Output artifacts are resolved through a per-request isolated output directory before final filename alignment.
- Supports same size preprocessing options as Prusa endpoint (`sizeUnit`, `keepProportions`, `targetSizeX/Y/Z`, `scalePercent`, rotations)
- Validates final model size against selected machine profile build-volume limits

Example:

```bash
curl -X POST http://localhost:3000/orca/slice \
  -H "Accept: application/json" \
  -H "x-slicer-api-key: <AUTHORIZED_SLICE_KEY>" \
  -F "choosenFile=@/path/to/model.stl" \
  -F "layerHeight=0.2" \
  -F "material=PLA" \
  -F "infill=20" \
  -F "printerProfile=Bambu_P1S_0.4_nozzle.json" \
  -F "processProfile=FDM_0.2mm.json" \
  -F "sizeUnit=inch" \
  -F "keepProportions=false" \
  -F "targetSizeX=8.0" \
  -F "targetSizeY=8.0" \
  -F "targetSizeZ=5.0"
```

### Common successful response

```json
{
  "success": true,
  "job_id": "job-00000000000000000000000000000000",
  "artifact_id": "artifact-00000000000000000000000000000000",
  "slicer_engine": "prusa",
  "engine_version": "2.8.1+linux-x64-GTK3-202409181416",
  "technology": "FDM",
  "material": "PLA",
  "infill": "20%",
  "profiles": {
    "prusa_profile": "FDM_0.2mm.ini",
    "effective_profile_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "model_transform": {
    "size_unit": "mm",
    "keep_proportions": true,
    "requested_size": {
      "x": null,
      "y": null,
      "z": 120
    },
    "scale_percent": null,
    "scale_factors": {
      "x": 1.5,
      "y": 1.5,
      "z": 1.5
    },
    "rotation_deg": {
      "x": 0,
      "y": 0,
      "z": 0
    },
    "original_dimensions_mm": {
      "x": 80,
      "y": 60,
      "z": 80
    },
    "final_dimensions_mm": {
      "x": 120,
      "y": 90,
      "z": 120
    }
  },
  "build_volume_limits_mm": {
    "min": {
      "x": 1,
      "y": 1,
      "z": 1
    },
    "max": {
      "x": 256,
      "y": 256,
      "z": 210
    },
    "source_profile": "FDM_0.2mm.ini"
  },
  "hourly_rate": null,
  "stats": {
    "print_time_seconds": 5400,
    "print_time_readable": "1h 30m",
    "material_used_m": 12.45,
    "material_used_g": null,
    "object_height_mm": 45.2,
    "estimated_price_huf": null
  }
}
```

### Common slicing error codes

- `SLICE_SERVICE_AUTH_REQUIRED`
- `SLICE_CORS_ORIGIN_NOT_ALLOWED`
- `INVALID_LAYER_HEIGHT`
- `INVALID_LAYER_HEIGHT_FOR_ENGINE`
- `INVALID_LAYER_HEIGHT_FOR_TECHNOLOGY`
- `INVALID_MATERIAL_FOR_TECHNOLOGY`
- `MATERIAL_TECHNOLOGY_MISMATCH`
- `RATE_LIMIT_EXCEEDED`
- `ADMIN_RATE_LIMIT_EXCEEDED`
- `INVALID_SOURCE_ARCHIVE`
- `INVALID_SOURCE_GEOMETRY`
- `UNSUPPORTED_FILE_FORMAT`
- `ORCA_PROFILE_INCOMPATIBLE`
- `INVALID_SIZE_UNIT`
- `INVALID_KEEP_PROPORTIONS`
- `INVALID_SIZE_OPTIONS`
- `INVALID_ROTATION_OPTIONS`
- `CONFLICTING_SIZE_OPTIONS`
- `INVALID_PROFILE_NAME`
- `PROFILE_NOT_FOUND`
- `MODEL_DIMENSIONS_UNAVAILABLE`
- `MODEL_OUT_OF_PRINTER_BOUNDS`
- `FILE_PROCESSING_TIMEOUT`
- `SLICE_QUEUE_FULL`
- `SLICE_QUEUE_CLIENT_LIMIT`
- `SLICE_QUEUE_TIMEOUT`
- `QUEUE_INTERNAL_ERROR`
- `INTERNAL_PROCESSING_ERROR`
- `UPLOAD_STORAGE_ERROR`
- `INTERNAL_SERVER_ERROR`

For `MODEL_OUT_OF_PRINTER_BOUNDS`, the JSON response always includes
`model_dimensions_mm` with `x`, `y`, and `z`, plus
`build_volume_limits_mm` with `min`, `max`, and `source_profile`. The public
field remains `errorCode`; no `error_code` alias is introduced.

### Queue and rate-limit response semantics

- `RATE_LIMIT_EXCEEDED` -> HTTP `429`, includes `Retry-After` and `retryAfterSeconds`.
- `ADMIN_RATE_LIMIT_EXCEEDED` -> HTTP `429`, includes `Retry-After` and `retryAfterSeconds`.
- `SLICE_QUEUE_FULL` -> HTTP `503`.
- `SLICE_QUEUE_CLIENT_LIMIT` -> HTTP `429`.
- `SLICE_QUEUE_TIMEOUT` -> HTTP `503`.
- `FILE_PROCESSING_TIMEOUT` -> HTTP `422`.

---

## 💰 Pricing API

### `GET /pricing`

Returns full pricing object.

### `POST /pricing/FDM` / `POST /pricing/SLA` (pricing scope)

Create new material for selected technology.

```json
{
  "material": "ASA",
  "price": 1200
}
```

### `PATCH /pricing/:technology/:material` (pricing scope)

Update existing material price only.

```json
{
  "price": 950
}
```

### `DELETE /pricing/:technology/:material` (pricing scope)

Delete existing material from selected technology.

---

## 🛠️ Admin Endpoint

### `GET /admin/output-files` (artifact scope)

Lists generated `.gcode` / `.sl1` files from `output/`.

```json
{
  "success": true,
  "total": 2,
  "files": [
    {
      "fileName": "model-output-1741285245000.gcode",
      "downloadUrl": "/admin/download/model-output-1741285245000.gcode",
      "sizeBytes": 182734,
      "createdAt": "2026-03-05T10:07:25.000Z",
      "modifiedAt": "2026-03-05T10:07:27.000Z"
    },
    {
      "fileName": "model-output-1741285301000.sl1",
      "downloadUrl": "/admin/download/model-output-1741285301000.sl1",
      "sizeBytes": 941282,
      "createdAt": "2026-03-05T10:08:21.000Z",
      "modifiedAt": "2026-03-05T10:08:24.000Z"
    }
  ]
}
```

Generated artifacts are stored with the following convention for clarity and traceability:

- `InputName-output-<timestamp>.gcode`
- `InputName-output-<timestamp>.sl1`

Successful slice responses also include collision-resistant `job_id` and
`artifact_id` fields. They expose correlation identifiers only, never absolute
or workspace paths.

### `GET /admin/download/:fileName` (artifact scope)

Downloads a generated `.gcode` / `.sl1` artifact by file name.

Special token support:

- `ALL` -> returns an `application/zip` stream that contains every currently valid output artifact.

Bulk `ALL` downloads are validated before streaming and return HTTP `413` with `BULK_DOWNLOAD_LIMIT_EXCEEDED` if the current output set exceeds `MAX_ZIP_ENTRIES` or `MAX_ZIP_UNCOMPRESSED_BYTES`.

Examples:

```bash
curl -L -H "x-api-key: <ARTIFACT_API_KEY>" \
  http://localhost:3000/admin/download/Cover-output-1777587775846.sl1 \
  -o Cover-output-1777587775846.sl1
```

```bash
curl -L -H "x-api-key: <ARTIFACT_API_KEY>" \
  http://localhost:3000/admin/download/ALL \
  -o output-files.zip
```

Common slicing error responses:

- `INVALID_SOURCE_ARCHIVE` → uploaded ZIP is invalid or does not contain a supported file.
- `INVALID_SOURCE_GEOMETRY` → uploaded source geometry is invalid/non-printable and auto-repair is disabled.
- `FILE_PROCESSING_TIMEOUT` (HTTP `422`) → processing exceeded 10 minutes for the uploaded file.

---

## 🔏 Learn how to setup the `.env`, configs, input/output

### 1. Create your env file from template

```bash
cp .env.example .env
```

### 2. Create your pricing configuration file from the template

```bash
cp configs/pricing.example.json configs/pricing.json
```

*Default `pricing.example.json` structure:*

```json
{
  "FDM": {
    "PLA": 1000,
    "ABS": 1000,
    "PETG": 1100,
    "TPU": 1100
  },
  "SLA": {
    "Standard": 2000,
    "ABS-Like": 2000,
    "Flexible": 2800
  }
}
```

### 3. Provision required scoped keys in `.env`

Set distinct, securely generated active values for `PRICING_API_KEY`,
`ARTIFACT_API_KEY`, and `OPERATIONS_API_KEY`, then set one complete explicit
`SLICE_SERVICE_AUTH_MODE` from `.env.example`. New final-state deployments use
`principals` with both
`SLICE_SERVICE_WOOCOMMERCE_API_KEY` and
`SLICE_SERVICE_LEADPILOT_API_KEY`; the shared `SLICE_SERVICE_API_KEY` family is
retained only for `legacy` compatibility and bounded `migration`. Migration
also requires `SLICE_SERVICE_LEGACY_MIGRATION_UNTIL` in the future and at most
90 days away. Leave previous slots empty until a rotation. The deliberately
empty `.env.example` credential fields are not runnable defaults; startup
refuses incomplete modes.

### 4. Start the app

- local: `npm start`
- docker: `docker compose up -d --build`

### 5. Runtime environment loading

The app reads `.env` automatically on local startup via `dotenv`, and Docker reads it via `env_file`.

### Runtime folders used by the program

- `input/` → temporary working input directory used during conversion/slicing pipeline.
- `output/` → generated output artifacts (`.gcode`, `.sl1`, etc.).
- `configs/` → read-only slicer profiles plus writable
  `pricing-state/pricing.json`; legacy `pricing.json` is migration input.

Runtime paths are root-scoped in both local and Docker execution.
No app-local runtime folders are used (`app/input`, `app/output`, `app/configs` are intentionally not used).

### Config files you can use out-of-the-box

- Prusa process/printer profiles (`.ini`):
  - `configs/prusa/FDM_0.1mm.ini`
  - `configs/prusa/FDM_0.2mm.ini`
  - `configs/prusa/FDM_0.3mm.ini`
  - `configs/prusa/SLA_0.025mm.ini`
  - `configs/prusa/SLA_0.05mm.ini`
- Orca machine/process profiles (`.json`):
  - `configs/orca/Bambu_P1S_0.4_nozzle.json`
  - `configs/orca/FDM_0.1mm.json`
  - `configs/orca/FDM_0.2mm.json`
  - `configs/orca/FDM_0.3mm.json`

You can add your own profiles (for example 2 FDM + 2 SLA for Prusa, or multiple Orca machine profiles), then select them per request with `printerProfile` (and `processProfile` for Orca).

Different printer/process profiles produce different G-code behavior in practice (speed, accelerations, cooling, supports, extrusion strategy), even for the same model.

---

## ⚙️ Configuration & Limits

You can customize pricing, security, and slicing behavior without changing endpoint contracts.

- **Pricing Matrix:** Persisted atomically in
  `configs/pricing-state/pricing.json`; a safe legacy `configs/pricing.json`
  can be migrated on startup.
- **Scoped Security:** Pricing, artifact, and operations each require a distinct
  active credential. Slice accepts only explicit `legacy`, finite `migration`,
  or final `principals` mode; WooCommerce and LeadPilot rotate independently
  through their own optional previous slots.
- **Scoped Browser CORS:** no-Origin service calls are allowed; browser-origin
  protected calls use only the matching audience allowlist. Exact-origin
  matching rejects cross-audience, opaque, scheme, host-case, and port drift.
- **Artifact Access:** `GET /admin/output-files` and
  `GET /admin/download/:fileName` require `ARTIFACT_API_KEY`; `ALL` ZIP export
  retains configured safety limits.
- **Operations Access:** detailed health, actionable readiness, and metrics
  require `OPERATIONS_API_KEY`.
- **Fail-Fast Security:** normal startup requires all three non-slice active
  keys and one complete slice mode. A single named slice principal is rejected.
  The separate legacy admin migration is one non-slice audience, expires within
  90 days, and is disabled by default.
- **Timing-Safe Auth:** supplied material is compared with fixed-length digests
  against active and previous slots; structured rejection events never contain
  credentials.
- **Upload Validation:** Multer accepts only a single file on the `choosenFile` field with file extension validation at upload time.
- **Request Rate Limit:** Slicing endpoints are IP-rate-limited (default `3` requests / `60s`). Expired rate-limit buckets are automatically pruned.
- **Admin Rate Limit:** Admin endpoints are IP-rate-limited (default `30` requests / `60s`) to reduce brute-force API-key attempts.
- **Proxy Trust:** forwarded identity is disabled by default. `TRUST_PROXY=true`
  requires a unique, validated set of explicit IP/CIDR peers or `loopback`;
  wildcard, overbroad, malformed, or unknown trust refuses startup. Express
  stops at the nearest untrusted hop, so an untrusted direct peer cannot select
  a spoofed `X-Forwarded-For` prefix.
- **Slicing Queue:** CPU-heavy slice jobs are queued in arrival order and processed FIFO. `MAX_CONCURRENT_SLICES` defaults to `1`; explicit values must be exact canonical decimal `1..3`, and N=2/N=3 remain unqualified and undeployed.
- **Queue Fairness:** Per-client queue ownership is bounded (`MAX_SLICE_QUEUE_PER_IP`) so one client cannot monopolize all pending capacity.
- **Queue Safety Limits:** Queue length and wait timeout are bounded (`MAX_SLICE_QUEUE_LENGTH`, `MAX_SLICE_QUEUE_WAIT_MS`).
- **Upload Body Limit:** Multipart upload size is capped (`MAX_UPLOAD_BYTES`, default `500MB`).
- **Successful Material Limits:** FDM filament length and any present direct mass
  are bounded by `MAX_MATERIAL_USED_METERS` (default `10000`) and
  `MAX_MATERIAL_USED_GRAMS` (default `100000`); nullable direct mass remains a
  manual-pricing result. SLA resin is bounded by `MAX_MATERIAL_USED_ML`
  (default `100000`).
- **ZIP Safety Limits:** ZIP upload inspection and admin `ALL` bulk export are guarded by max entries (`MAX_ZIP_ENTRIES`, default `500`) and max cumulative size (`MAX_ZIP_UNCOMPRESSED_BYTES`, default `500MB`).
- **ZIP Content Rule:** ZIP uploads must contain exactly one supported source file; unsupported or suspicious ZIP contents are rejected and cleaned up.
- **Body Parser Limits:** JSON/form payload size is capped (`JSON_BODY_LIMIT`, `FORM_BODY_LIMIT`, default `1mb`).
- **Artifact Retention:** Owned managed outputs are bounded by TTL, count, and
  aggregate bytes; active downloads and unknown/unsafe entries are preserved.
- **Container Envelope:** Production Compose uses a read-only root, non-root
  service identity, bounded `/tmp`, explicit writable binds, and bounded
  PID/memory/CPU/log/stop settings. Defaults are repository safety defaults,
  not VPS capacity claims.
- **Slicer Profiles:** Stored in `configs/prusa/*.ini` and `configs/orca/*.json`.
- **Timeouts:** Internal 10-minute kill-switches prevent infinite loops during complex conversion/slicing operations and return `FILE_PROCESSING_TIMEOUT` when exceeded.
- **Model Fidelity Policy:** Uploaded model data is never auto-healed or shape-corrected; invalid/non-printable source data is rejected with a clear error.
- **Supply-Chain Integrity:** Docker build pins and verifies SHA256 checksums for downloaded PrusaSlicer and OrcaSlicer AppImages.
- **Python Resolver Security:** `PYTHON_EXECUTABLE` must be absolute and existing when set; fallback resolution uses `VIRTUAL_ENV` and known absolute runtime paths.

Node HTTP envelope defaults and inclusive bounds:

| Environment key | Default | Inclusive bounds |
| --- | ---: | ---: |
| `HTTP_HEADERS_TIMEOUT_MS` | `60000` | `1000..60000` |
| `HTTP_REQUEST_TIMEOUT_MS` | `600000` | `60000..600000` |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | `5000` | `1000..60000` |
| `HTTP_MAX_HEADERS_COUNT` | `2000` | `16..2000` |
| `HTTP_MAX_CONNECTIONS` | `128` | `1..1024` |
| `HTTP_MAX_REQUESTS_PER_SOCKET` | `100` | `1..1000` |

Empty, non-decimal, unsafe, zero/negative, or out-of-range values fall back to the listed defaults. Effective headers timeout is capped at request timeout. These application settings do not verify actual VPS capacity or reverse-proxy timeouts; both remain `UNVERIFIED`.

---

## Health, readiness, events, and metrics

- `GET /health` is public process liveness.
- `GET /ready` is public and returns only `{"status":"READY"}` or
  `{"status":"NOT_READY"}` with HTTP `200` or `503`.
- `GET /health/detailed` and `GET /operations/readiness` require the operations
  key. Detailed readiness uses stable reason codes:
  `SHUTDOWN`, `ADMISSION_CLOSED`, `QUEUE_UNAVAILABLE`,
  `NATIVE_RUNTIME_QUARANTINED`, `STORAGE_UNSAFE`, `RETENTION_UNSAFE`,
  `PRICING_UNAVAILABLE`, and `CONFIG_UNSAFE`.
- `GET /operations/metrics` requires the operations key and emits bounded
  Prometheus text with fixed labels for request audience/outcome, auth and queue
  rejection reason, native outcome/duration, resource failures, retained
  artifacts, cleanup, queue state, readiness, and shutdown.

Structured JSON events use schema version `1` and an allowlisted vocabulary for
request, auth, queue, native, artifact, pricing, resource, readiness, startup,
and shutdown lifecycles. Safe inbound `X-Request-Id` values are echoed; invalid
or injection-shaped values are replaced. Request, job, and artifact IDs
correlate work without exposing filenames, paths, secrets, or unbounded labels.

Repository implementation does not establish production alert thresholds.
Operators must select thresholds from measured capacity and use the
[S4 operator validation pack](docs/codex/i5-s4-operator-validation.md) before
promotion.

---

## 📝 Security and Runtime Change Snapshot (2026-07-23)

This repository currently includes the following synchronized changes across implementation and docs:

- **Scoped service authentication:** mandatory per-audience active keys, optional
  previous slots, exact protected-route mapping, two-restart revocation, and a
  finite one-audience legacy admin migration.
- **Protected browser policy:** no-Origin service traffic remains allowed while
  browser-origin protected calls use exact audience-specific allowlists.
- **HTTP server envelope:** bounded header/request/keep-alive timeouts, header count, connection count, and requests-per-socket with safe fallback behavior.
- **Rate-limit controls:** dedicated admin limiter (`ADMIN_RATE_LIMIT_EXCEEDED`), slice limiter (`RATE_LIMIT_EXCEEDED`), and Retry-After-aware 429 responses.
- **Proxy trust controls:** invalid or overbroad topology refuses startup;
  explicit trusted peers use nearest-untrusted-hop identity semantics and
  spoof-resistant request-ID handling.
- **Operational surfaces:** public liveness/minimal readiness plus
  operations-scoped detailed readiness and fixed-cardinality metrics.
- **Structured observability:** versioned, allowlisted, correlated, redacted
  events for request/job/artifact/runtime lifecycles.
- **Queue fairness and resilience:** FIFO queue with bounded concurrency, per-client queued+active cap (`MAX_SLICE_QUEUE_PER_IP`), queue wait timeout, and explicit queue error codes.
- **Admin output download hardening:** extension allowlist (`.gcode`, `.sl1`), `ALL` ZIP bulk download support, path/symlink/realpath checks, and pre-stream bulk ZIP resource limits.
- **Python subprocess execution hardening:** centralized Python executable resolution, absolute-path validation, startup fail-fast behavior, and secure converter/orientation/transform subprocess execution.
- **Docker supply-chain validation:** build-time SHA256 verification for slicer AppImages.
- **Documentation synchronization:** global guides, folder-local guides, and instruction overlays under `.github/instructions/*`.

The development Compose topology remains loopback-published on an ordinary
bridge. Historical Docker Desktop 29.6.1 A/B proved that topology retains
API/native DNS/TCP/UDP egress. I6 then selected the internal private-peer model,
and I7's production manifest implements the API half without inventing a proxy.
I12 adds point-in-time dark-host proof for the exact deployed digest, private
peer, API/native egress denial and socketless proxy. Public caller/CIDR,
firewall, DNS/certificate, complete secret lifecycle, route activation and
customer-production evidence are still required; no production-ready state is
implied.

---

## 🧪 Test publication policy

- `tests/testing-scripts/` is intended to be public and versioned.
- `tests/testing-files/` sample payloads are intentionally excluded from repository publication.
- `tests/testing-scripts/results/` generated reports are runtime artifacts and are ignored.

---

## 📦 Release Log

Detailed version history is maintained in [`CHANGELOG.md`](CHANGELOG.md).

---

## ❤️ Sponsor Options

If this project helps your workflow, you can support ongoing development here:

- [Buy Me a Coffee](https://www.buymeacoffee.com/3D.Printer.Slicer.API)
- [GitHub Sponsors](https://github.com/sponsors/hajdu-patrik)
