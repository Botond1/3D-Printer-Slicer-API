# 3D Printer Slicer API (FDM & SLA)

![3D Printer Slicer API logo](https://github.com/user-attachments/assets/61739b97-e3ab-4335-a127-5a1370111a5a)

![Node.js](https://img.shields.io/badge/Node.js-20.20.2-339933?style=flat&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Backend-Express_4-000000?style=flat&logo=express&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat&logo=python&logoColor=white)
![PrusaSlicer](https://img.shields.io/badge/Slicer-PrusaSlicer_2.8.1-orange?style=flat)
![OrcaSlicer](https://img.shields.io/badge/Slicer-OrcaSlicer_2.3.1-8A2BE2?style=flat)
![Bambu Studio](https://img.shields.io/badge/Slicer-Bambu_Studio_02.08.02.61-00AE42?style=flat)
![Docker](https://img.shields.io/badge/Container-Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Ubuntu](https://img.shields.io/badge/Base-Ubuntu_24.04-E95420?style=flat&logo=ubuntu&logoColor=white)

An automated 3D slicing, preview, and pricing API built with Node.js and Python.
It converts supported 3D model and CAD inputs into printer-ready artifacts, measures
print time and mass with three native slicers, and returns a validated HUF quote.
Version **3.3.0** (2026-09-03).

- Consumer contract (WooCommerce plugin, LeadPilot): [`docs/integration-guide.md`](docs/integration-guide.md)
- Operator handoff: [`docs/codex/handoff-2026-09-02.md`](docs/codex/handoff-2026-09-02.md)
- Release notes: [`CHANGELOG.md`](CHANGELOG.md)
- Historical wave narrative (J0..J3B, I10..I12), moved out of this file verbatim:
  [`docs/codex/history-waves.md`](docs/codex/history-waves.md)

The repository target is a private sidecar API behind one reverse-proxy peer.
Development Compose binds the API to host loopback; the production manifest
(`docker-compose.production.yml`) publishes no API port, never builds locally, and
consumes only an immutable image digest. Deployment, route, DNS, allowlist, and
consumer changes are owner-authorized actions outside this repository's authority.

---

## Engines and printers

| Engine | Binary | Endpoint | Technology | Printers | Inclusive admission ceiling (X x Y x Z mm) |
| --- | --- | --- | --- | --- | --- |
| Prusa | PrusaSlicer 2.8.1 | `POST /prusa/slice` | FDM, SLA | P1S (generic Marlin profile), `H2D-QUOTE`, `SATURN4U` (SLA) | P1S `256 x 256 x 249.9`; H2D-QUOTE `350 x 320 x 324.9`; SATURN4U `218.88 x 122.88 x 220` |
| Orca | OrcaSlicer 2.3.1 | `POST /orca/slice` | FDM | P1S (generic Marlin profile), `H2D-QUOTE` | P1S `253.9 x 253.9 x 249.9`; H2D-QUOTE `347.9 x 317.9 x 324.9` |
| Bambu | Bambu Studio 02.08.02.61 | `POST /bambu/slice` | FDM | `P1S` (default), `H2D` (official vendor profiles) | P1S `256 x 228 x 250` (alternative footprint `238 x 256`); H2D `325 x 320 x 325` |

- `POST /bambu/slice` uses the official Bambu Lab vendor machine/process/
  filament chain bundled with Bambu Studio, flattened from
  `/opt/bambustudio/resources/profiles/BBL` (or `BAMBU_PROFILES_ROOT`). Its
  headless CLI reproduces the owner's Bambu Studio GUI readings on the ten
  reference models within -1.1..+0.1 % on time and 0..0.2 % on mass (supports
  off), so it is the quoting authority for Bambu Lab printers. OrcaSlicer 2.3.1
  with its bundled BBL profiles deviates by up to +24 % and has no H2D profile.
- The Bambu invocation is `--arrange 0 --orient 0`: the API places the model on
  the real bed itself (`bambu-bed-geometry.js`, `bambu-placement.js`,
  `scale_model.py --place-min-x/--place-min-y`) and reports `placement_mm`.
  The P1S bed excludes an `18 x 28 mm` corner at the origin, so its admissible
  footprint is L-shaped: up to `256 x 228` above the corner or `238 x 256`
  beside it. The H2D single-filament area is the first extruder's `325 x 320`.
- `H2D-QUOTE` on Prusa and Orca is P1S physics on an H2D-sized declared bed:
  quote-only, never production H2D G-code. Real H2D quotes come from Bambu.
- `supports` (default `true`) is honoured on all engines; with supports on,
  overhang-heavy models take +47..+140 % longer than with supports off.
  Compare readings only with the same supports setting.
- The retained artifacts are Prusa `.gcode` / `.sl1`, Orca `.gcode`, and the
  printer-ready Bambu `.gcode.3mf` project; all are listed and downloadable
  through the artifact-scoped admin routes.
- SLA (Prusa `0.025` / `0.05` mm, `.sl1`) quotes the Elegoo Saturn 4 Ultra
  (`218.88 x 122.88 x 220 mm`): PrusaSlicer generates supports and a pad at
  zero elevation, the print time is `layers x per-layer seconds`
  (`configs/sla/printers.json`, `sla-layer-time-v1`, owner-tunable) and
  `material_used_g = usedMaterial_ml x resin density`. The `.sl1` raster is
  quote-only; a printable `.goo` needs UVtools conversion.

Production-envelope smoke of the current image, 40 mm PLA cube at 0.2 mm,
20 % infill, supports on: Bambu P1S `2453 s / 24.0 g / 550 HUF`, Bambu H2D
`2452 s / 23.94 g / 550 HUF`, Prusa `1980 s / 24.7 g / 440 HUF`, Orca
`2760 s / 24.2 g / 620 HUF`; `POST /render` returned a valid PNG.

---

## Endpoints

| Audience | Header | Routes |
| --- | --- | --- |
| Public | none | `GET /health`, `GET /ready`, `GET /pricing`, `GET /profiles`, `GET /openapi.json`, `GET /docs`, `GET /` |
| Slice service | `x-slicer-api-key` | `POST /prusa/slice`, `POST /orca/slice`, `POST /bambu/slice`, `POST /render` |
| Pricing | `x-api-key` (`PRICING_API_KEY`) | `POST /pricing/FDM`, `POST /pricing/SLA`, `PATCH /pricing/:technology/:material`, `DELETE /pricing/:technology/:material` |
| Artifact | `x-api-key` (`ARTIFACT_API_KEY`) | `GET /admin/output-files`, `GET /admin/download/:fileName` (`ALL` streams a ZIP) |
| Operations | `x-api-key` (`OPERATIONS_API_KEY`) | `GET /health/detailed`, `GET /operations/readiness`, `GET /operations/metrics` |

All four slice-service routes share one rate limiter and one FIFO queue; a
render never runs beside a native slice. Route order is fixed: rate limiter ->
`x-slicer-api-key` authentication -> root-scoped workspace allocation ->
Multer single-file upload (`choosenFile`) -> option/profile validation ->
queue -> native processing. Authentication rejects before any workspace,
upload, or queue side effect. Unknown routes return JSON 404 `ROUTE_NOT_FOUND`.

---

## Authentication

Each non-slice audience has its own active key and optional previous rotation
slot. The slice audience has one shared compatibility family plus independent
WooCommerce and LeadPilot principal families:

| Audience / principal | Environment keys | Header |
| --- | --- | --- |
| Slice shared compatibility | `SLICE_SERVICE_API_KEY`, `SLICE_SERVICE_API_KEY_PREVIOUS` | `x-slicer-api-key` |
| Slice WooCommerce | `SLICE_SERVICE_WOOCOMMERCE_API_KEY`, `..._PREVIOUS` | `x-slicer-api-key` |
| Slice LeadPilot | `SLICE_SERVICE_LEADPILOT_API_KEY`, `..._PREVIOUS` | `x-slicer-api-key` |
| Pricing | `PRICING_API_KEY`, `PRICING_API_KEY_PREVIOUS` | `x-api-key` |
| Artifact | `ARTIFACT_API_KEY`, `ARTIFACT_API_KEY_PREVIOUS` | `x-api-key` |
| Operations | `OPERATIONS_API_KEY`, `OPERATIONS_API_KEY_PREVIOUS` | `x-api-key` |

- Pricing, artifact, and operations actives are always required.
  `SLICE_SERVICE_AUTH_MODE` is `legacy` (default: shared active only),
  `migration` (shared active plus both principal actives plus a future
  `SLICE_SERVICE_LEGACY_MIGRATION_UNTIL` at most 90 days away; shared slots stop
  authorizing at that instant), or `principals` (both principal actives, no
  shared slots, no expiry). A previous slot is valid only with its own active.
- Every configured value must be globally unique, non-placeholder, and 32-256
  printable-ASCII bytes; violations refuse startup with a generic error.
- `x-api-key` is never a slice alias. Missing or wrong slice credentials return
  HTTP `401`
  `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}`.
- Comparisons use fixed-length SHA-256 digests. A matching slice key attaches a
  frozen `req.slicePrincipal {audience, slot}`; the slice rate limiter and the
  queue fairness cap key on that principal and fall back to the client IP.
- Rotation is two restarts: replacement active + former active as previous,
  move the caller, remove previous, restart again (revocation).
- `ADMIN_API_KEY` is legacy migration material only: it may fill exactly one
  named non-slice audience (`LEGACY_ADMIN_API_KEY_AUDIENCE`) until
  `LEGACY_ADMIN_API_KEY_MIGRATION_UNTIL`, at most 90 days away.
- Requests without `Origin` are allowed. Browser-origin protected calls must
  match only their `SLICE_`, `PRICING_`, `ARTIFACT_`, or
  `OPERATIONS_CORS_ALLOWED_ORIGINS` exact allowlist.
- Forwarded identity is off by default; `TRUST_PROXY=true` needs unique
  validated `TRUST_PROXY_CIDRS` entries or `loopback`. Safe inbound
  `X-Request-Id` values (1-128 chars, alphanumeric start, then `A-Za-z0-9._:-`)
  are echoed; invalid ones are replaced.

---

## Supported file formats

| Category | Extensions | Notes |
| --- | --- | --- |
| Direct 3D | `.stl`, `.obj`, `.3mf` | 3MF `unit` attribute honoured; a multi-object 3MF scene becomes one compound STL |
| NURBS / CAD | `.stp`, `.step`, `.igs`, `.iges`, `.ply` | converted with `cad2stl.py` |
| Archive | `.zip` | exactly one supported source; `__MACOSX/`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, and directory entries are tolerated; Bambu/Orca project 3MF parts under `Metadata/` and `Auxiliaries/` are admitted |

Geometry is never repaired. Converter rejections print
`INVALID_SOURCE_GEOMETRY|<reason>` and map to HTTP 400
`INVALID_SOURCE_GEOMETRY`; a native slicer refusal (empty layer, faulty mesh,
model load failure) maps to HTTP 422 `UNSLICEABLE_SOURCE_GEOMETRY`.

---

## Slice requests

`multipart/form-data`, file field `choosenFile`. Option and profile validation
runs before queue admission, so a `400` never consumes a queue slot.

| Field | Values | Default |
| --- | --- | --- |
| `layerHeight` | Prusa `0.025`, `0.05` (SLA), `0.1`, `0.2`, `0.3`; Orca `0.1`, `0.2`, `0.3`; Bambu P1S `0.08`, `0.1`, `0.12`, `0.16`, `0.2`, `0.24`, `0.28`; Bambu H2D `0.08`..`0.24` | `0.2` |
| `material` | FDM `PLA`, `PETG`, `ABS`, `TPU`; SLA `Standard`, `ABS-Like`, `Flexible` | `PLA` / `Standard` |
| `infill` | strict integer `0`..`100`, optional trailing `%`, never clamped | `20` |
| `supports` | `true` / `false` (empty keeps the default) | `true` |
| `orientationMode` | `auto` / `preserve` | `auto` |
| `sizeUnit` | `mm` / `inch` | `mm` |
| `keepProportions` | `true` fits within the target box (smallest ratio wins) / `false` | `true` |
| `targetSizeX/Y/Z`, `scalePercent` | positive numbers; mutually exclusive | none |
| `rotationX/Y/Z` | degrees, applied after automatic orientation in X, Y, Z order | `0` |
| `printerProfile` | Prusa INI or Orca machine JSON basename; Bambu `P1S` / `H2D` (`printer` alias) | engine default |
| `processProfile` | Orca process JSON basename; Bambu exact vendor process name, e.g. `0.20mm Standard @BBL X1C` | derived from `layerHeight` |

Processing order: conversion -> automatic orientation (unless `preserve`) ->
sizing -> requested rotation -> placement -> native slice. The authoritative
rotation is rotation-only, `R_total = R_requested * R_automatic`.

```bash
curl -X POST http://localhost:3000/bambu/slice \
  -H "x-slicer-api-key: <AUTHORIZED_SLICE_KEY>" \
  -F "choosenFile=@/path/to/model.stl" -F "printerProfile=P1S" \
  -F "layerHeight=0.2" -F "material=PLA" -F "infill=20" -F "supports=false"
```

```bash
curl -X POST http://localhost:3000/prusa/slice \
  -H "x-slicer-api-key: <AUTHORIZED_SLICE_KEY>" \
  -F "choosenFile=@/path/to/model.step" -F "layerHeight=0.2" \
  -F "orientationMode=preserve" -F "sizeUnit=mm" -F "targetSizeZ=120"
```

```bash
curl -X POST http://localhost:3000/orca/slice \
  -H "x-slicer-api-key: <AUTHORIZED_SLICE_KEY>" \
  -F "choosenFile=@/path/to/model.zip" -F "layerHeight=0.2" -F "material=PETG" \
  -F "printerProfile=Bambu_P1S_0.4_nozzle.json" -F "processProfile=FDM_0.2mm.json"
```

Engine notes:

- Prusa: `FDM_0.1mm.ini` / `FDM_0.2mm.ini` / `FDM_0.3mm.ini` are selected by
  `layerHeight`; `FDM_P1S_H2D_SIZE_QUOTING_0.{1,2,3}mm.ini` are the H2D-sized
  quote profiles; `SLA_0.025mm.ini` / `SLA_0.05mm.ini` produce `.sl1`. The
  INIs carry per-material density and `temperature` keys.
- Orca: `ORCA_MACHINE_PROFILE` (default `Bambu_P1S_0.4_nozzle.json`) or
  `Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json`; process
  `FDM_0.{1,2,3}mm.json`; filament `configs/orca/filament/{PLA,PETG,ABS,TPU}_generic.json`
  (PLA 1.24, PETG 1.27, ABS 1.04, TPU 1.24 g/cm3, 1.75 mm). Invocation is
  `--load-settings machine;process --load-filaments filament --arrange 1
  --orient 0 --allow-rotations=0`.
- Bambu: registry `configs/bambu/printers.json` maps `P1S` / `H2D` to exact
  vendor machine, process, and `Generic` filament names; `0.1` selects the
  vendor 0.12 mm process with the layer height overridden. Invocation adds
  `--curr-bed-type`, `--export-3mf`, `--arrange 0 --orient 0`, never
  `--allow-rotations`. The root-owned `/usr/local/bin/bambu-studio` wrapper
  starts a private Xvfb only for `--export-3mf`.

### `POST /render`

Slice-authenticated, rate-limited, queue-serialized. Returns a deterministic
1024 x 768 `image/png` (`Cache-Control: no-store`) of the exact pose the slice
pipeline would slice: isometric camera, build-plate grid, `X x Y x Z mm`
caption. Accepts `choosenFile`, `orientationMode`, sizing, rotation, and
optionally `layerHeight` / `material` (validated like `/prusa/slice`; they do
not change the image). Identical input bytes and options give byte-identical
PNGs. Bounds use the largest supported FDM envelope `350 x 320 x 325 mm`; the
renderer (`app/render_preview.py`, Pillow 12.3.0) has a 60 s budget.

### Success response

Every slice success carries `job_id`, `artifact_id`, `slicer_engine`,
`engine_version`, `technology`, `material`, `infill`, `supports`, `profiles`
(with lowercase 64-hex `effective_profile_sha256`), the schema-2
`model_transform` (orientation mode/outcome, requested/automatic/total
rotation, `original_dimensions_available` + nullable `original_dimensions_mm`,
oriented and final dimensions), `build_volume_limits_mm` (`min`, inclusive
`max`, `source_profile`), Bambu-only `placement_mm {x_min, y_min}`,
`hourly_rate`, and `stats` (`print_time_seconds`, `print_time_readable`,
`print_time_source`, `material_used_m`, `material_used_g`, `object_height_mm`,
`estimated_price_huf`). `stats.object_height_mm` always equals
`model_transform.final_dimensions_mm.z`. Orca and Bambu report
`total_estimated_time` (wall clock including the start sequence); Prusa's
generic profile emits `estimated_printing_time`, so its numbers did not change.
Full field semantics and examples: [`docs/integration-guide.md`](docs/integration-guide.md).

### Price semantics

`estimated_price_huf = ceil(max(print_time_seconds, 900) x hourly_rate / 3600)`
rounded up to the next 10 HUF, in integer arithmetic (1980 s at 800 HUF/h is
exactly 440, not the former 450). Mass is reported, never billed. `null`
price with `null` hourly rate means "quote manually": FDM output without a
positive mass marker and Orca without a filament profile.
`material_used_g` comes only from the slicer's own mass marker and is never
derived from length; zero is never published.

### Error codes

Every non-2xx body is `{ "success": false, "error", "errorCode" }`. Branch on
`errorCode` only.

| HTTP | Codes |
| --- | --- |
| 400 | `NO_FILE_UPLOADED`, `UNSUPPORTED_FILE_FORMAT`, `INVALID_SOURCE_ARCHIVE`, `INVALID_SOURCE_GEOMETRY`, `INVALID_MULTIPART_REQUEST`, `UPLOAD_REQUEST_ABORTED`, `INVALID_LAYER_HEIGHT`, `INVALID_LAYER_HEIGHT_FOR_ENGINE`, `INVALID_LAYER_HEIGHT_FOR_TECHNOLOGY`, `INVALID_MATERIAL_FOR_TECHNOLOGY`, `MATERIAL_TECHNOLOGY_MISMATCH`, `MATERIAL_PROFILE_UNAVAILABLE`, `INVALID_INFILL`, `INVALID_SUPPORTS`, `INVALID_ORIENTATION_MODE`, `INVALID_SIZE_UNIT`, `INVALID_KEEP_PROPORTIONS`, `INVALID_SIZE_OPTIONS`, `CONFLICTING_SIZE_OPTIONS`, `INVALID_ROTATION_OPTIONS`, `INVALID_PRINTER_PROFILE`, `INVALID_PROCESS_PROFILE`, `INVALID_PROFILE_NAME`, `PROFILE_NOT_FOUND` |
| 401 | `SLICE_SERVICE_AUTH_REQUIRED` (slice), `PRICING_AUTH_REQUIRED`, `ARTIFACT_AUTH_REQUIRED`, `OPERATIONS_AUTH_REQUIRED` |
| 403 | `SLICE_`/`PRICING_`/`ARTIFACT_`/`OPERATIONS_CORS_ORIGIN_NOT_ALLOWED` |
| 408 | `UPLOAD_TOTAL_TIMEOUT` (600 s upload lifetime) |
| 413 | `UPLOAD_RESOURCE_LIMIT_EXCEEDED`, `SLICE_RESOURCE_LIMIT_EXCEEDED`, `BULK_DOWNLOAD_LIMIT_EXCEEDED` |
| 422 | `MODEL_OUT_OF_PRINTER_BOUNDS` (with `model_dimensions_mm`, `build_volume_limits_mm`, full `model_transform`), `MODEL_DIMENSIONS_UNAVAILABLE`, `UNSLICEABLE_SOURCE_GEOMETRY`, `ORCA_PROFILE_INCOMPATIBLE`, `FILE_PROCESSING_TIMEOUT`, `INVALID_SLICE_OUTPUT`, `INVALID_SLICE_STATS` |
| 429 | `RATE_LIMIT_EXCEEDED`, `ADMIN_RATE_LIMIT_EXCEEDED`, `SLICE_QUEUE_CLIENT_LIMIT` (all with `Retry-After` and `retryAfterSeconds`) |
| 500 | `SLICE_OUTPUT_UNPARSED`, `NATIVE_OUTPUT_OVERFLOW`, `INTERNAL_PROCESSING_ERROR`, `QUEUE_INTERNAL_ERROR`, `UPLOAD_STORAGE_ERROR`, `INTERNAL_SERVER_ERROR` |
| 503 | `SLICE_QUEUE_FULL`, `SLICE_QUEUE_TIMEOUT`, `SLICE_QUEUE_SHUTDOWN`, `PROFILE_CATALOGUE_UNAVAILABLE` |

`orientation_outcome` is `applied`, `unchanged`, `preserved`, or `fallback_unmodified`;
bounds wording branches on it, and every fallback emits one bounded `orientation.fallback` event.

---

## `GET /profiles`

Public, built once at startup, immutable, informational (slice routes remain
the authority). Schema `r3d-profile-catalogue-v2`, 82 rows: 6 Prusa (P1S and
`H2D-QUOTE` x 0.1/0.2/0.3), 24 Orca (2 selectors x 3 layers x PLA/PETG/ABS/
TPU), 28 Bambu P1S (7 layer keys x 4 materials), 24 Bambu H2D (6 x 4). Each
row carries `engine`, `printer`, `engine_version`, ordered
`slice_selector.parameters`, path-free `profile_components`,
`effective_profile_sha256`, filament diameter/density, and
`build_volume_limits_mm` with `minimum_dimensions_inclusive_mm` (generic 1 mm
floor), `declared_build_volume_dimensions_mm` (`declared_source_kind:
profile-explicit`, metadata only), and the admission authority
`largest_passing_dimensions_inclusive_mm`. `machine_resolutions` and
`fleet_resolutions` are engine-scoped (fleets: bambu -> H2D, orca and prusa
-> `H2D-QUOTE`) and never merged across engines. Strong `ETag` + `If-None-Match`
-> `304`; `catalogue_sha256` in the body; construction failure -> `503
PROFILE_CATALOGUE_UNAVAILABLE` without affecting slicing. The generic
SLA rows are the Saturn 4 Ultra quoting rows (`SATURN4U`).

---

## Pricing, artifact, and operations APIs

- `GET /pricing` returns the matrix `{ FDM: {material: HUF/h}, SLA: {...} }`.
  `POST /pricing/FDM|SLA` `{ "material", "price" }` creates,
  `PATCH /pricing/:technology/:material` `{ "price" }` updates,
  `DELETE /pricing/:technology/:material` removes. Errors carry stable codes:
  `INVALID_TECHNOLOGY`, `INVALID_MATERIAL`, `INVALID_PRICE` (400),
  `MATERIAL_NOT_FOUND` (404, or 400 when the request names an unknown
  material), `MATERIAL_ALREADY_EXISTS` (409), `PRICING_PERSISTENCE_FAILED`
  (500). The pricing file is authoritative:
  `configs/pricing-state/pricing.json` is persisted atomically, defaults from
  `app/config/constants.js` seed only a missing or empty file, and a deleted
  material never resurrects on restart. A safe legacy `configs/pricing.json`
  is migrated on startup.
- `GET /admin/output-files` lists managed `.gcode`, `.sl1`, and `.gcode.3mf`
  artifacts (`fileName`, `downloadUrl`, `sizeBytes`, `createdAt`,
  `modifiedAt`). `GET /admin/download/:fileName` streams one artifact after
  extension, path containment, non-symlink, and realpath checks;
  `/admin/download/ALL` streams a ZIP bounded by `MAX_ZIP_ENTRIES` (500) and
  `MAX_ZIP_UNCOMPRESSED_BYTES` (500 MB), returning `413
  BULK_DOWNLOAD_LIMIT_EXCEEDED` beyond them. Artifacts are named
  `<input>-output-<timestamp>.<ext>` and retained by TTL, count, and bytes;
  a per-slice retention sweep failure is non-fatal and surfaces as readiness
  reason `RETENTION_UNSAFE`.
- `GET /health` is liveness. `GET /ready` returns only `{"status":"READY"}`
  (200) or `{"status":"NOT_READY"}` (503). `GET /health/detailed` runs fresh
  probes; `/ready` and `/operations/readiness` use the bounded cache. Reason
  codes: `SHUTDOWN`, `ADMISSION_CLOSED`, `QUEUE_UNAVAILABLE`,
  `NATIVE_RUNTIME_QUARANTINED`, `STORAGE_UNSAFE`, `RETENTION_UNSAFE`,
  `PRICING_UNAVAILABLE`, `CONFIG_UNSAFE`. Readiness also probes
  `configs/bambu`. `GET /operations/metrics` emits bounded Prometheus text
  with fixed labels; structured JSON events use schema version 1 and the fixed
  vocabulary in `app/services/observability/events.js`.

---

## Setup

1. `cp .env.example .env`, then set distinct 32-256 byte values for
   `PRICING_API_KEY`, `ARTIFACT_API_KEY`, `OPERATIONS_API_KEY`, and one
   complete `SLICE_SERVICE_AUTH_MODE` key set. Set `SLICER_UID` / `SLICER_GID`
   to the image's `slicer` user for Compose.
2. `cp configs/pricing.example.json configs/pricing.json` (migrated into
   `configs/pricing-state/pricing.json` on first start), or let the defaults
   seed it.
3. Start: `npm start` (local, needs the three slicer binaries on `PATH`) or
   `docker compose up -d --build`; development live mount:
   `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`
   (binds `app/server.js`, the Python helpers including `render_preview.py`,
   and the `app/` module folders). Monitoring: `--profile monitoring`.
4. Production: export `SLICER_API_IMAGE` (digest-only), `SLICER_ENV_FILE`,
   `SLICER_UID`, `SLICER_GID`, run
   `node scripts/i7-production-compose-contract.js`, then
   `docker compose -p slicer-api --env-file "$SLICER_ENV_FILE" -f docker-compose.production.yml up --detach --no-deps --pull never slicer-api`.
   The project name is always the literal `slicer-api`.

Runtime folders are root-scoped: `input/` (request workspaces), `output/`
(artifacts), `configs/` (read-only profiles plus writable
`configs/pricing-state/`). `app/input`, `app/output`, and `app/configs` are
never used. Shipped profiles: `configs/prusa/*.ini`, `configs/orca/*.json`
(+ `filament/`, + pinned `upstream/Custom/**` parents verified byte-equal at
image build), and `configs/bambu/printers.json`.

The image (Ubuntu 24.04, multi-stage) pins and SHA-256-verifies the three
AppImages, extracts them to `/opt/prusaslicer`, `/opt/orcaslicer`, and
`/opt/bambustudio` (root-owned, read-only), and installs `xvfb`, `libgl1`,
`libgl1-mesa-dri`, `libglx-mesa0`, `libgstreamer1.0-0`,
`libgstreamer-plugins-base1.0-0` for Bambu Studio. Both Compose manifests run
the service with `init: true` so detached native process groups are reaped.
Python dependencies are pinned in `requirements.txt` (gmsh 4.15.2, lxml 6.1.2,
networkx 3.6.1, numpy 2.5.2, Pillow 12.3.0, scipy 1.18.1, trimesh 5.1.0).
Candidate provenance evidence uses schema `i7-s3a-candidate-provenance-v2`.

---

## Configuration and limits

| Key | Default | Bounds / notes |
| --- | ---: | --- |
| `SLICE_RATE_LIMIT_MAX_REQUESTS` / `_WINDOW_MS` / `_BURST_CAPACITY` | `3` / `60000` / `5` | token bucket per principal (IP fallback); adaptive cooldown up to 30 s |
| `ADMIN_RATE_LIMIT_MAX_REQUESTS` / `_WINDOW_MS` | `30` / `60000` | per IP on `x-api-key` routes |
| `MAX_CONCURRENT_SLICES` | `1` | canonical decimal `1..3`; N=2/3 unqualified |
| `MAX_SLICE_QUEUE_LENGTH` / `MAX_SLICE_QUEUE_PER_IP` / `MAX_SLICE_QUEUE_WAIT_MS` | `100` / `5` / `300000` | `SLICE_QUEUE_FULL` 503, `SLICE_QUEUE_CLIENT_LIMIT` 429 (`Retry-After: 5`), `SLICE_QUEUE_TIMEOUT` 503 |
| `SLICE_COMMAND_TIMEOUT_MS` | `600000` | `1000..3600000`; Python helpers get 120 s each, clamped to the native budget; the renderer 60 s |
| `UPLOAD_TOTAL_TIMEOUT_MS` / `MAX_UPLOAD_BYTES` | `600000` / `500 MB` | `1000..600000` / up to 500 MB |
| `HTTP_HEADERS_TIMEOUT_MS` | `60000` | `1000..60000`, capped at request timeout |
| `HTTP_REQUEST_TIMEOUT_MS` | `600000` | `60000..600000` |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | `95000` | `1000..120000`; must outlive the proxy's 90 s idle timeout |
| `HTTP_MAX_HEADERS_COUNT` / `HTTP_MAX_CONNECTIONS` / `HTTP_MAX_REQUESTS_PER_SOCKET` | `2000` / `128` / `100` | `16..2000` / `1..1024` / `1..1000` |
| `JSON_BODY_LIMIT` / `FORM_BODY_LIMIT` | `1mb` | `1024..10 MiB` |
| `MAX_ZIP_ENTRIES` / `MAX_ZIP_UNCOMPRESSED_BYTES` | `500` / `524288000` | upload inspection and `ALL` export |
| `MAX_MODEL_DIMENSION_MM` | `10000` | `350..100000` |
| `MAX_MATERIAL_USED_METERS` / `_GRAMS` / `_ML` | `10000` / `100000` / `100000` | successful-stat ceilings |
| `SLICE_STRICT_GCODE_METRICS` | `true` | required positive time/length; `false` is diagnostic-only |
| `ORCA_MACHINE_PROFILE`, `ORCA_PROCESS_PROFILE_0_1/0_2/0_3` | `Bambu_P1S_0.4_nozzle.json`, `FDM_0.{1,2,3}mm.json` | Orca defaults |
| `BAMBU_PROFILES_ROOT` | `/opt/bambustudio/resources/profiles/BBL` | absolute path; tests and alternative layouts |
| `PYTHON_EXECUTABLE` / `VIRTUAL_ENV` | unset | absolute existing path when set; fallbacks `VIRTUAL_ENV/bin/python3`, `VIRTUAL_ENV/Scripts/python.exe`, `/opt/venv/bin/python3`, `/usr/local/bin/python3`, `/usr/bin/python3` |

Invalid, empty, non-canonical, or out-of-range values fall back to their
defaults (HTTP envelope) or refuse startup (resource policy), as documented in
`.env.example`. Actual VPS capacity and reverse-proxy timeouts remain
operator-verified facts, not repository claims.

Native runtime safety: commands run through `execFile` with argument arrays
and a minimal child environment; output beyond the bounded buffer stops the
process with `NATIVE_OUTPUT_OVERFLOW`; only real timeouts map to
`FILE_PROCESSING_TIMEOUT`. TERM-to-KILL process-tree termination polls up to
10 s after SIGKILL and re-kills the group once. A native-runtime quarantine
closes admission, drains for at most 10 s, and exits with status 70 so
`restart: unless-stopped` recovers the container. Handled shutdown signals
close HTTP admission, reject new work as `SLICE_QUEUE_SHUTDOWN`, and abort
queued and active jobs.

---

## Testing

- `npm test` runs the JavaScript unit suite (`tests/unit/js/**/*.test.js`,
  including the instruction-mirror, OpenAPI, and Bambu image-infrastructure
  pins) and the Python unit suite; `npm run check:syntax` and
  `npm run check:repository-safety` are the fast gates.
- Integration runners live in `tests/testing-scripts/` and write Markdown
  reports to `tests/testing-scripts/results/`; always read the report:
  `slicing/full_api_test_runner.py` (wrapper),
  `slicing/full_api_{prusa_fdm,prusa_sl1,orca_fdm,bambu_fdm}_test_runner.py`,
  `slicing/bambu_envelope_confirmation_runner.py`,
  `slicing/unsupported_upload_test_runner.py`,
  `slicing/orientation_visibility_test_runner.py`,
  `slicing/native_envelope_sweep_runner.py`,
  `render/render_preview_test_runner.py`,
  `calibration/bambu_reference_comparison_runner.py` (owner-run, private
  inputs), `pricing/pricing_cycle_test_runner.py`,
  `admin/admin_output_files_test_runner.py`,
  `rate_limit/rate_limit_regression_test_runner.py`,
  `operations/operations_readiness_metrics_test_runner.py`,
  `profiles/profile_catalogue_test_runner.py`, and
  `queue/queue_concurrency_test_runner.py --count N --expected-max-concurrent N --retry-on-429 1 --cleanup-manifest NEW_MANIFEST_PATH --report NEW_REPORT_PATH`.
- Runners pace at 20 s and honour `Retry-After`; `tests/testing-files/` and
  generated reports are not published. Behaviour that depends on the slicer
  binaries is only proven on the built image, never by a local unit run.
- Calibration worksheet (Hungarian, anonymised): [`docs/kalibracio-2026-08.md`](docs/kalibracio-2026-08.md).

---

## Release log and sponsoring

Version history is maintained in [`CHANGELOG.md`](CHANGELOG.md). The
pre-3.2.0 checkpoint narrative (J0..J3B, I10..I12, Hostinger route activation)
is preserved verbatim in [`docs/codex/history-waves.md`](docs/codex/history-waves.md)
with its evidence under `docs/codex/evidence/`.

If this project helps your workflow, you can support ongoing development:

- [Buy Me a Coffee](https://www.buymeacoffee.com/3D.Printer.Slicer.API)
- [GitHub Sponsors](https://github.com/sponsors/hajdu-patrik)
