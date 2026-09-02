# Changelog

All notable changes to this project are documented in this file.

## v3.2.0 (2026-09-02)

Bambu Studio engine overhaul. Consumer-visible contract changes are marked
**[contract]**; the consumer view is `docs/integration-guide.md`.

### Added

- **[contract]** `POST /bambu/slice`: third engine backed by the Bambu Studio `02.08.02.61` headless CLI and the official Bambu Lab (BBL) vendor machine/process/filament chain flattened from `/opt/bambustudio/resources/profiles/BBL` (or `BAMBU_PROFILES_ROOT`). The server-owned registry `configs/bambu/printers.json` (`r3d-bambu-printer-registry-v1`) maps `printerProfile=P1S` (default, `printer` alias) and `H2D` to exact vendor names; layer keys P1S `0.08/0.1/0.12/0.16/0.2/0.24/0.28`, H2D `0.08/0.1/0.12/0.16/0.2/0.24`; materials PLA/PETG/ABS/TPU map to the vendor `Generic` filaments. Success responses add `profiles.printer`, `bed_type`, and `placement_mm {x_min, y_min}`; the retained artifact is the printer-ready `.gcode.3mf` project, listed and downloadable through the artifact routes.
- **[contract]** `POST /render`: slice-authenticated, rate-limited, queue-serialized deterministic `1024 x 768` `image/png` preview of the exact final pose (isometric camera, plate grid, dimension caption; byte-identical output for identical input and options), rendered by `app/render_preview.py` (numpy + Pillow 12.3.0) under a 60 s budget; failures reuse the slice error envelope.
- **[contract]** `supports` request field (`true`/`false`, default `true`) on all engines; any other present value returns `400 INVALID_SUPPORTS`. The default is digest-neutral; `supports=false` is a different effective profile.
- **[contract]** Orca ABS and TPU filament profiles (`configs/orca/filament/ABS_generic.json` 1.04 g/cm3, `TPU_generic.json` 1.24 g/cm3), so all four FDM materials price automatically on every engine.
- **[contract]** Error codes `INVALID_SUPPORTS`, `INVALID_INFILL`, `INVALID_PRINTER_PROFILE`, `INVALID_PROCESS_PROFILE`, `MATERIAL_PROFILE_UNAVAILABLE` (400), `UNSLICEABLE_SOURCE_GEOMETRY` (422, native faulty-mesh/model-load refusal with a path-free `detail`), and `NATIVE_OUTPUT_OVERFLOW` (500); the 429 (`RATE_LIMIT_EXCEEDED`, `SLICE_QUEUE_CLIENT_LIMIT`) and 503 (`SLICE_QUEUE_FULL`, `SLICE_QUEUE_TIMEOUT`, `SLICE_QUEUE_SHUTDOWN`) families are documented in OpenAPI.
- API-owned Bambu placement (`app/services/slice/bambu-bed-geometry.js`, `bambu-placement.js`, `scale_model.py --place-min-x/--place-min-y`) derived from the flattened vendor bed (printable area, first-extruder area on the H2D, `bed_exclude_area` corner on the P1S).
- Image: pinned and SHA-256-verified Bambu Studio AppImage extracted to `/opt/bambustudio` (root-owned, read-only); root-owned `0555` wrapper `/usr/local/bin/bambu-studio` that starts a private Xvfb only for `--export-3mf`; runtime packages `xvfb`, `libgl1`, `libgl1-mesa-dri`, `libglx-mesa0`, `libgstreamer1.0-0`, `libgstreamer-plugins-base1.0-0`; `init: true` in both Compose manifests; the dev overlay mounts `app/render_preview.py`; candidate provenance schema `i7-s3a-candidate-provenance-v2`; the exact-image runtime probe verifies all three executables.
- Integration runners `slicing/full_api_bambu_fdm_test_runner.py`, `slicing/bambu_envelope_confirmation_runner.py`, `render/render_preview_test_runner.py`, and the owner-run `calibration/bambu_reference_comparison_runner.py`; deterministic privacy-safe synthetic fixtures (`common/synthetic_fixtures.py`) and the shared 429-aware slice helper (`common/runner_support.py`).
- Structured event `orientation.fallback` (fixed vocabulary), emitted once per automatic-orientation fallback.
- Documentation: `docs/integration-guide.md` (consumer contract), `docs/codex/handoff-2026-09-02.md`, `docs/codex/history-waves.md` (the pre-3.2.0 wave narrative moved verbatim out of `README.md` and the top-level instruction files), and a 2026-09-02 addendum to `docs/kalibracio-2026-08.md`.

### Changed

- **[contract]** `infill` is a strict integer `0..100` with an optional trailing `%`; it is never clamped and anything else returns `400 INVALID_INFILL`.
- **[contract]** Price rounding uses integer arithmetic: `ceil(max(print_time_seconds, 900) * hourly_rate / 3600)` rounded up to the next 10 HUF. 1980 s at 800 HUF/h is now exactly 440 HUF (previously 450 because of floating-point noise).
- **[contract]** `stats.print_time_source` ranks `total estimated time` first, so Orca and Bambu report the wall-clock total including the start sequence. Orca's shipped generic profile emits `estimated printing time (normal mode)`, so its numbers did not change.
- **[contract]** SLA responses are quote-only: `material_used_g`, `hourly_rate`, and `estimated_price_huf` are always `null`, and `print_time_source` marks the estimate (`sla_sl1_metadata_estimate` / `sla_synthetic_estimate`).
- **[contract]** `keepProportions=true` with several target axes fits the model within the box (smallest ratio wins); NaN/zero/negative ratios are rejected.
- **[contract]** `SLICE_QUEUE_CLIENT_LIMIT` responses carry `Retry-After` and `retryAfterSeconds`; the slice limiter and the queue fairness cap key on the authenticated principal (`req.slicePrincipal`) with client-IP fallback.
- **[contract]** Option and profile validation runs before queue admission, so a `400` never consumes a queue slot.
- **[contract]** `GET /profiles` publishes 82 rows (6 Prusa, 24 Orca including ABS/TPU, 28 Bambu P1S, 24 Bambu H2D) with three engine-scoped fleets (bambu -> H2D, orca and prusa -> H2D-QUOTE) and the measured Bambu envelopes.
- **[contract]** Archive handling tolerates `__MACOSX/`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, and directory entries; 3MF roots match case-insensitively; Bambu/Orca project parts under `Metadata/` and `Auxiliaries/` are admitted; `mesh2stl.py` honours the 3MF `unit` attribute and uses `Scene.to_mesh()`.
- **[contract]** `FILE_PROCESSING_TIMEOUT` is returned only for real timeouts and its message no longer hard-codes 10 minutes; Python helpers run under a 120 s budget clamped to the native budget.
- Bambu invocation is `--arrange 0 --orient 0` (never `--allow-rotations`): Bambu Studio's `--arrange 1` yawed models that did not fit, breaking the rotation-only transform contract. Measured inclusive ceilings replace the provisional pins: P1S `256 x 228 x 250` with the alternative `238 x 256` footprint (L-shaped admission around the `18 x 28 mm` excluded corner), H2D `325 x 320 x 325`; native rc 192/190 refusals map to the K2 `MODEL_OUT_OF_PRINTER_BOUNDS` payload.
- `HTTP_KEEP_ALIVE_TIMEOUT_MS` default is `95000` (bounded `1000..120000`) so idle sockets outlive the reverse proxy's 90 s idle timeout.
- `SLICE_COMMAND_TIMEOUT_MS` is a bounded positive integer (`1000..3600000`, default `600000`); native output beyond the bounded buffer stops the process with `NATIVE_OUTPUT_OVERFLOW` instead of timeout wording.
- Process tree: the post-SIGKILL settle polls up to 10 s and re-kills the group once; an exited child with a live group is terminated instead of refused. A native-runtime quarantine closes admission, drains at most 10 s, and exits with status 70 through an injectable seam so `restart: unless-stopped` recovers.
- Prusa INIs use the `temperature` / `first_layer_temperature` / `bed_temperature` keys.
- `requirements.txt` pins the signed-image versions (gmsh 4.15.2, lxml 6.1.2, networkx 3.6.1, numpy 2.5.2, Pillow 12.3.0, scipy 1.18.1, trimesh 5.1.0) and drops the unused `numpy-stl`.
- Per-slice retention sweep failures are non-fatal to the slice and surface as readiness reason `RETENTION_UNSAFE`; readiness also probes `configs/bambu`.
- `README.md` rewritten as a lean current document; `CLAUDE.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, the folder-local guides, the Copilot instruction overlays, and the mirrored agent/skill definitions describe the three-engine state, with the wave narrative replaced by a compact "Current contract" section.
- Package version `3.2.0`.

### Fixed

- Every `/bambu/slice` request answered 500 after a successful native slice because managed artifact names did not admit `.gcode.3mf`.
- An existing `configs/pricing-state/pricing.json` is authoritative: defaults seed only a missing or empty file, so a material removed with `DELETE /pricing/...` no longer resurrects on restart; `getRate` fails closed with `null`; pricing 400/404/409/500 bodies carry stable `errorCode` values (`INVALID_TECHNOLOGY`, `INVALID_MATERIAL`, `INVALID_PRICE`, `MATERIAL_NOT_FOUND`, `MATERIAL_ALREADY_EXISTS`, `PRICING_PERSISTENCE_FAILED`).
- Converter `INVALID_SOURCE_GEOMETRY|<reason>` markers (printed to stdout and stderr with exit 2 by `cad2stl.py` and `mesh2stl.py`) map to HTTP 400 on every path.
- SLA was never meant to be priced automatically; it no longer is.
- The keep-alive default has one source (`DEFAULTS.HTTP_KEEP_ALIVE_TIMEOUT_MS`).
- `render_preview.py` joined the Python helper allowlist and the i4 probe contract lists the native executable failure reasons.

### Removed

- The provisional Bambu admission pins and the Bambu `--arrange 1` invocation.
- The multi-screen J0/J1/J2/J3/J3B/I10..I12 narrative blocks from `README.md` and the top-level instruction files (moved verbatim to `docs/codex/history-waves.md`).
- `numpy-stl` from `requirements.txt`.

### Validation

- Bambu Studio CLI versus the owner's Bambu Studio GUI readings on the ten reference models (supports off): time within -1.1..+0.1 %, mass within 0..0.2 %. OrcaSlicer 2.3.1 with its bundled BBL profiles deviates by up to +24 % and has no H2D profile. Supports on adds +47..+140 % time on overhang-heavy models.
- Production-envelope smoke of the image (40 mm PLA cube, 0.2 mm, 20 %, supports on): Bambu P1S 2453 s / 24.0 g / 550 HUF; Bambu H2D 2452 s / 23.94 g / 550 HUF; Prusa 1980 s / 24.7 g / 440 HUF; Orca 2760 s / 24.2 g / 620 HUF; `POST /render` returned a valid PNG.
- `npm run test:js`, `npm run test:python`, `npm run check:syntax`, and `npm run check:repository-safety` pass on the integration branch; the Bambu matrix, envelope confirmation, render, catalogue (82 rows), admin (`.gcode.3mf`), and orientation runners were updated for the new contract.
- Not done in this release: publication, deployment, route/DNS/allowlist mutation, and consumer-repository changes. Production still runs the signed main candidate `bf5e712`.

## v3.1.4 (2026-05-14)

### Added

- Added `tests/testing-scripts/slicing/unsupported_upload_test_runner.py` to verify former 2D artwork uploads are rejected with stable error codes for both direct upload and ZIP archive paths.
- Kept `scipy` as an explicit Python dependency because stable-pose orientation for supported 3D models depends on it; this preserves post-orientation build-volume validation after removing the former broad `trimesh[easy]` dependency set.

### Removed

- Removed image-to-STL and vector-to-STL slicing support from the public upload pipeline.
  - Deleted the former 2D-to-3D converter scripts and removed raster/vector extensions from upload, ZIP extraction, test discovery, Docker, and CI validation paths.
  - Removed the conversion-specific request option and matching environment configuration because they only applied to the former 2D artwork workflow.
  - Reason: the API is now intentionally model-focused. Accepting 2D artwork as printable geometry created a different product workflow with ambiguous geometry expectations, higher conversion dependency surface, and weaker alignment with the fail-fast model-fidelity policy. Users should upload explicit 3D/CAD source geometry instead.

### Fixed

- Hardened `/admin/download/ALL` by enforcing `MAX_ZIP_ENTRIES` and `MAX_ZIP_UNCOMPRESSED_BYTES` before ZIP streaming begins.
- Corrected admin output listing to reuse the same validated output-file path, symlink, extension, and realpath checks as downloads.
- Updated the admin output test runner to accept HTTP `413` with `BULK_DOWNLOAD_LIMIT_EXCEEDED` when the current output set exceeds configured bulk ZIP limits.
- Updated the full API slice matrix to treat explicitly declared fail-fast geometry/bounds rejections as passing behavior when the status and `errorCode` match exactly.
- Clarified the queue concurrency report so client start-order matching is informational and staggered completion remains the black-box queue serialization signal.
- Aligned `package-lock.json` root metadata with `package.json` and corrected the package `main` entry to `app/server.js`.

### Changed

- Added `app/services/admin-output.service.js` to keep admin output listing/download validation outside route handlers.
- Updated `MAX_ZIP_ENTRIES` default to `500` across runtime constants and `.env.example`, matching the documented bulk export default.
- Bumped package and OpenAPI metadata to `3.1.4`.
- Refined README markdown formatting, endpoint listing, ZIP upload wording, and admin `ALL` bulk-limit documentation.

### Agentic Workflow

- Added explicit tool allowlists to mirrored `.github/agents/*` and `.claude/agents/*` agent definitions.
- Improved orchestrator workflow gates for fast validation, quality review, scoped test selection, docs-sync, and release/tag sequencing.
- Added `.claude/.mcp.template.json` as a credential-free optional Docker MCP template and ignored local `.claude/.mcp.json`.
- Synchronized mirrored skills and docs-sync guidance for agent/skill/MCP workflow assets.

### Validation

- `node --check` passed for all `app/**/*.js` files.
- `python -m py_compile` passed for all `app/**/*.py` and `tests/testing-scripts/**/*.py` files.
- `npm audit --audit-level=high` reported 0 vulnerabilities.
- Docker Compose rebuild completed and `GET /health` returned HTTP 200.
- Pricing, admin output, queue concurrency, rate-limit regression, and full API slicing runners were refreshed with current markdown reports.
- Full API split suite passed 24/24 expected outcomes, including the expected Prusa SLA `MODEL_OUT_OF_PRINTER_BOUNDS` fail-fast rejection for `direct/Creeper.stl`.

## v3.1.3 (2026-05-01)

### Added

- Added `/admin/download/ALL` special token support for ZIP bulk download of all generated output files.
  - Streams a ZIP archive via `archiver` (v7.0.1) added as new runtime dependency.
  - Preserves the same extension allowlist, path containment, symlink, and realpath safety checks as single-file download.
  - Returns `application/zip` content-type with a timestamped `output-files-<timestamp>.zip` filename.
  - Enforces `MAX_ZIP_ENTRIES` and `MAX_ZIP_UNCOMPRESSED_BYTES` limits to prevent resource exhaustion.
  - Added `MAX_ZIP_ENTRIES` and `MAX_ZIP_UNCOMPRESSED_BYTES` environment keys (defaults: 500 entries / 500 MB).

### Changed

- Reorganized test runners from flat `tests/testing-scripts/` layout into domain-specific subdirectories:
  - `tests/testing-scripts/slicing/` — full suite wrapper and engine-specific matrix runners
  - `tests/testing-scripts/admin/` — admin output listing and download tests
  - `tests/testing-scripts/pricing/` — pricing lifecycle tests
  - `tests/testing-scripts/queue/` — queue concurrency tests
  - `tests/testing-scripts/rate_limit/` — rate-limit regression tests
- Extracted `resolveOutputDirectoryPaths()` and `resolveValidatedOutputFile()` helpers in `app/routes/system.routes.js` to reduce inline path-validation duplication.
- Updated OpenAPI definition in `app/docs/swagger-docs.js` to document ALL token behavior, dual content-type response, and fileName parameter description.
- Updated version metadata to `3.1.3` in project manifests and OpenAPI definition.

### Added (Tests)

- Extended `tests/testing-scripts/admin/admin_output_files_test_runner.py` with ALL-token download checks:
  - Unauthorized access to `/admin/download/ALL` is rejected (401/503).
  - Authorized access returns 200 ZIP when output files exist, or 404 when empty.
- Added new focused runner `tests/testing-scripts/rate_limit/rate_limit_regression_test_runner.py`:
  - Probes `/admin/download/ALL` until 429 and validates `ADMIN_RATE_LIMIT_EXCEEDED` + `Retry-After` semantics.
  - Probes `/prusa/slice` until 429 and validates `RATE_LIMIT_EXCEEDED` + `Retry-After` semantics.
  - Reads rate-limit configuration from `.env` with environment defaults as fallback.

### Documentation

- Synced all instruction and guidance files with new paths and ALL-token security rules:
  - `CLAUDE.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md`
  - `.github/instructions/repository.instructions.md`, `.github/instructions/app.instructions.md`
  - `.github/instructions/testing-scripts.instructions.md`
  - `app/CLAUDE.md`, `tests/testing-scripts/CLAUDE.md`
  - Both `SKILL.md` testing mirrors and both `test-engineer.md` agent definitions
  - `README.md` — added `/admin/download/:fileName` section with ALL token docs and curl examples

## v3.1.2 (2026-04-30)

### Added

- Added adaptive slice rate limiting with token-bucket behavior to better support short legitimate request bursts while preserving VPS protection limits.
- Added configurable `SLICE_RATE_LIMIT_BURST_CAPACITY` (default `5`) to tune burst handling independently from per-window request limits.
- Added `quality-architect` agent in both agent registries:
  - `.github/agents/quality-architect.md`
  - `.claude/agents/quality-architect.md`
- Added mirrored best-practice quality workflow skill:
  - `.github/skills/best-practice/SKILL.md`
  - `.claude/skills/best-practice/SKILL.md`

### Changed

- Refactored `app/middleware/rateLimit.js` to a class-based OOP design with separated limiter strategies:
  - `FixedWindowRateLimiter` for admin controls
  - `TokenBucketRateLimiter` for slice controls
  - shared middleware wrapper with stable 429 payload contract
- Renamed the mirrored quality skill to `best-practice` and rewrote mirrored skill files as operational playbooks (workflow, guardrails, validation checklists).
- Refactored `app/services/slice/queue.js` to use typed queue-domain errors with centralized queue-to-HTTP mapping metadata (replacing prefix-string control flow).
- Extracted slice success payload composition from `app/services/slice.service.js` into `app/services/slice/response.js` with strategy-style profile and pricing mappers.
- Decomposed `processSlice` in `app/services/slice.service.js` into smaller stage helpers for request parsing, output target resolution, profile resolution, model preparation, and slicer execution.
- Refactored `app/middleware/errorHandler.js` from condition-heavy branching to declarative known-error strategy rules with stable response mapping.
- Refactored `app/routes/pricing.routes.js` by extracting shared technology/material/price validators and persistence helpers to reduce duplicated route control flow.
- Refactored `app/services/pricing.service.js` into a facade delegating persistence to `app/services/pricing/repository.js` and domain/material logic to `app/services/pricing/catalog.js`.
- Preserved public pricing service API contracts for route and slicer modules while introducing explicit repository/catalog boundaries.
- Updated orchestration docs to include the new quality-focused phase between tests and final documentation sync.
- Updated version metadata to `3.1.2` in project manifests and OpenAPI definition.

### Fixed

- `app/server.js`: hardened trust-proxy fallback behavior to avoid risky forwarded-header trust when CIDRs are not configured.
- `app/services/slice.service.js`: ensured temp upload cleanup on invalid option parsing failures.
- `app/services/slice/options.js`: corrected technology-aware default material selection for SLA/FDM paths.

### Documentation

- Synced core instruction files and mirrored guidance (`CLAUDE.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md`) with:
  - new quality agent/skill references
  - updated environment key list including burst capacity
  - refreshed synchronization metadata

## v3.1.1 (2026-04-21)

### Security Hardening

- Added dedicated admin endpoint throttling (`ADMIN_RATE_LIMIT_EXCEEDED`) and applied it across all admin-protected routes.
- Hardened admin artifact download path in `app/routes/system.routes.js`:
  - strict extension allowlist (`.gcode`, `.sl1`)
  - parent-path containment checks
  - `lstat` non-symlink target enforcement
  - `realpath` containment verification
- Strengthened forwarded-header trust model:
  - Express trust-proxy now resolved via `TRUST_PROXY` + `TRUST_PROXY_CIDRS`
  - client IP resolution normalized and delegated to Express trust-proxy behavior
- Added request correlation support with propagated `X-Request-Id` and requestId-aware admin/security logs.

### Runtime and Queue Controls

- Added per-client queue fairness cap (`MAX_SLICE_QUEUE_PER_IP`) to prevent single-client queue monopolization.
- Added explicit queue error mapping for client cap violations (`SLICE_QUEUE_CLIENT_LIMIT`, HTTP 429).
- Preserved bounded FIFO behavior with wait-time expiration (`SLICE_QUEUE_TIMEOUT`) and queue-cap protection (`SLICE_QUEUE_FULL`).
- Added configurable admin rate-limit defaults and env controls:
  - `ADMIN_RATE_LIMIT_WINDOW_MS`
  - `ADMIN_RATE_LIMIT_MAX_REQUESTS`

### Python Execution Safety

- Introduced centralized Python runtime resolver in `app/config/python.js`.
- Enforced absolute-path validation when `PYTHON_EXECUTABLE` is set.
- Added safe fallback lookup via `VIRTUAL_ENV` and trusted absolute runtime paths.
- Updated all converter/orientation/transform subprocess calls to use validated `PYTHON_EXECUTABLE`.

### Request Validation

- Added a bounded validation guard for the legacy conversion option parser.

### Docker and Supply Chain

- Added SHA256 verification for downloaded PrusaSlicer and OrcaSlicer AppImages during Docker build.

### Documentation

- Completed full documentation synchronization across:
  - `CLAUDE.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md`
  - folder-local guides (`app/CLAUDE.md`, `configs/CLAUDE.md`, `tests/testing-scripts/CLAUDE.md`)
  - instruction overlays in `.github/instructions/*`
- Expanded `README.md` with:
  - detailed `app/*.js` module map
  - queue/rate-limit response semantics by HTTP status
  - consolidated security/runtime change snapshot

### Validation

- Docker-first verification completed against running compose environment.
- Integration test evidence (reports under `tests/testing-scripts/results/`):
  - `pricing_cycle_test_result.md`: 12/12 success
  - `admin_output_files_test_result.md`: pass
  - `queue_concurrency_test_result.md`: 4/4 success

## v3.1.0 (2026-04-08)

### Security Hardening

- **Shell command injection prevention:** Replaced `child_process.exec()` with `child_process.execFile()` across all command execution paths. Python converter/orientation/transform calls, `prusa-slicer --info`, and slicer invocations now use argument arrays instead of string interpolation — eliminates shell injection via crafted filenames or parameters.
  - `app/services/slice/command.js` — core `runCommand()` signature changed from `(cmd: string)` to `(executable, args[])`
  - `app/services/slice/input-processing.js` — all 5 converter/orientation calls updated
  - `app/services/slice/transform.js` — `scale_model.py` call updated
  - `app/services/slice/model-stats.js` — `prusa-slicer --info` call updated
  - `app/services/slice/engine.js` — `buildSlicerCommandArgs()` now returns `string[]` instead of concatenated string
  - `app/services/slice.service.js` — slicer invocation uses spread args

- **Timing-safe admin key comparison:** Admin API key verification in `app/middleware/requireAdmin.js` now uses `crypto.timingSafeEqual()` with fixed-length buffer handling to prevent timing side-channel attacks.

- **IP spoofing prevention:** `app/utils/client-ip.js` now only trusts `X-Forwarded-For` header when `TRUST_PROXY=true` is explicitly configured in environment. Default behavior ignores the header, preventing rate-limit bypass via header spoofing.

- **Rate-limit memory leak fix:** `app/middleware/rateLimit.js` now runs periodic cleanup (`setInterval` with `.unref()`) to evict expired IP buckets, preventing unbounded memory growth under sustained traffic.

- **Upload restriction hardening:** `app/routes/slice.routes.js` changed from `upload.any()` to `upload.single('choosenFile')` with a `fileFilter` that validates file extensions against the known-good set before writing to disk. Prevents arbitrary file field flooding and rejects unsupported formats at upload time.

- **Information disclosure fixes:**
  - `GET /health/detailed` now requires `requireAdmin` middleware — no longer publicly exposes queue state, Python version, or filesystem accessibility
  - Removed internal filesystem `path` fields from `/health/detailed` subsystem response (slicer paths, output directory path)
  - All 500 error responses in `app/routes/system.routes.js` now return generic messages and log details server-side only

- **Multer error handling hardening:** `app/middleware/errorHandler.js` now handles `LIMIT_UNEXPECTED_FILE` (returns 400 with `UNEXPECTED_FILE_FIELD`) and generic `MulterError` (returns 400 with `UPLOAD_ERROR`) instead of falling through as 500 Internal Server Error.

### Changed

- `GET /health/detailed` moved from public to admin-protected endpoint (requires `x-api-key` header)
- `app/services/slice.service.js` — `findUploadedModelFile()` updated for `req.file` (singular) API from `upload.single()`
- Added `TRUST_PROXY` to environment configuration keys across all instruction files

### Documentation

- Updated endpoint classification in all instruction/documentation files (15 files):
  - `README.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `.github/copilot-instructions.md`
  - `app/CLAUDE.md`, `.github/instructions/app.instructions.md`, `.github/instructions/repository.instructions.md`
  - `.claude/agents/js-developer.md`, `.github/agents/js-developer.md`
- Added security documentation to `README.md`: timing-safe auth, proxy trust, upload validation, rate-limit cleanup
- Updated `VPS settings.md`: added `TRUST_PROXY=true` to `.env` guide, added `X-Forwarded-For` and `X-Forwarded-Proto` proxy headers to Nginx config
- Updated `app/CLAUDE.md`: errorHandler middleware entry, client-ip TRUST_PROXY note, /health/detailed admin note

## v3.0.5 (2026-04-08)

### Added

- Added agentic orchestration workflow with 6 specialized agent definitions:
  - `orchestrator` — plans multi-domain tasks and delegates to parallel sub-agents
  - `js-developer` — owns Node.js + Express code in `app/`
  - `python-developer` — owns Python converters, orientation, and scaling scripts
  - `test-engineer` — owns Python integration test runners and report generation
  - `docs-syncer` — owns all documentation and instruction file synchronization
  - `docker-specialist` — owns Dockerfile, docker-compose, and container lifecycle
- Agent definitions mirrored in `.claude/agents/` and `.github/agents/`
- Added folder-local `CLAUDE.md` instruction files:
  - `app/CLAUDE.md` — app folder structure, endpoint behavior, local rules
  - `configs/CLAUDE.md` — config folder scope, safety constraints, related env keys
  - `tests/testing-scripts/CLAUDE.md` — test runner groups, shared helpers, reporting contract
- Added Copilot instruction overlays for folder-scoped context:
  - `.github/instructions/repository.instructions.md`
  - `.github/instructions/app.instructions.md`
  - `.github/instructions/configs.instructions.md`
  - `.github/instructions/testing-scripts.instructions.md`
  - `.github/instructions/github.instructions.md`

### Changed

- Restructured skill files (`docker-ops`, `testing`, `docs-sync`) into thin command references that point to their corresponding agent definitions for full context
- Migrated orchestration from skill to agent definition (`.claude/agents/orchestrator.md`)
- Rewrote `.claude/CLAUDE.md` and `.github/copilot-instructions.md` from legacy format to standardized multi-agent instruction structure with endpoint snapshots, engine constraints, queue defaults, skill/agent routing, and documentation topology
- Added `GET /`, `GET /health/detailed`, `GET /openapi.json`, `GET /docs` to Copilot and Claude instruction endpoint lists (were missing)
- Added missing environment keys to `.github/copilot-instructions.md`: `JSON_BODY_LIMIT`, `FORM_BODY_LIMIT`, `MAX_UPLOAD_BYTES`, `MAX_ZIP_ENTRIES`, `MAX_ZIP_UNCOMPRESSED_BYTES`

### Fixed

- Fixed README Node.js badge version: `24.11.1` → `20.x` (matches Dockerfile NodeSource repo)
- Fixed README `MAX_UPLOAD_BYTES` default: `250MB` → `100MB` (matches `constants.js`)
- Fixed README `MAX_ZIP_UNCOMPRESSED_BYTES` default: `250MB` → `500MB` (matches `zip.js`)
- Fixed README missing public endpoints: added `GET /health/detailed`, `GET /openapi.json`, `GET /docs`
- Fixed Dockerfile HEALTHCHECK misalignment with docker-compose.yml: `start_period` `5s` → `30s`, `retries` `3` → `5`

### Removed

- Removed legacy `.agents/skills/` directory (replaced by `.claude/agents/` and `.github/agents/`)
- Removed `AGENTS.md` (replaced by agent definitions in agents/ folders)
- Removed stale references to `.github/CLAUDE.md` (file never existed) from all instruction files
- Removed stale references to `.agents/skills/` from all instruction files

## v3.0.4 (2026-03-27)

### Added

- Added clean `requirements.txt` to root for dedicated Python runtime dependency tracking:
  - specifically targets geometry conversion dependencies used by the runtime pipeline
  - enables reliable Docker caching for the Python layer

### Changed

- Deeply optimized `Dockerfile` for size, security, and build speed (2026 DevOps Best Practices):
  - merged system dependencies (`apt-get`) and locale generation into a single layer
  - eliminated `chown -R` duplication by using `COPY --chown=slicer:slicer` for massive size reduction
  - enforced Read-Only dependencies: `/opt/venv` and `node_modules` remain root-owned for security
  - aggregated aggressive cleanup (removal of `npm`, `curl`, `gnupg`, manpages) into a single final layer
  - reorganized user creation (`slicer`) to the beginning of the runtime stage
- Restructured `docker-compose.yml` and `server.js` runtime paths for "Agentic" workflows:
  - redirected all intermediate conversion/extraction files to `uploads/help-files/` to maintain a clean root `uploads/` directory
  - implemented strict cleanup logic ensuring `help-files/` is emptied immediately after slicing
- Cleaned up legacy converter scripts for SonarLint and Pylance compliance:
  - removed unused variables and implicit imports
  - tightened exception handling with specific classes (e.g., `ValueError`)

### Removed

- Removed `requirements.lock` from the root directory:
  - eliminated documentation-specific (MkDocs) dependencies from the production build path to prevent bloatware

## v3.0.3 (2026-03-12)

### Added

- Added comprehensive `GET /health/detailed` endpoint for subsystem diagnostics:
  - returns slicer configuration availability (Prusa, Orca paths)
  - checks Python subprocess availability and version string
  - reports queue status (length, active jobs, concurrency limits)
  - HTTP `200 OK` when all subsystems healthy, `503 DEGRADED` on failure
  - includes timestamp, uptime, and detailed subsystem breakdown
- Added `requirements.lock` file with pinned Python package versions for reproducible builds:
  - captures exact trimesh, numpy, manifold3d, and geometry library versions
- Enhanced `.env.example` with comprehensive documentation:
  - ADMIN_API_KEY, PORT, body limits, rate limiting, queue configuration
  - Python path override, logging level, optional feature flags

### Changed

- Hardened dependency security via `npm audit fix`:
  - resolved high-severity multer vulnerability (DoS via incomplete cleanup and resource exhaustion)
  - updated multer from `<=2.1.0` to latest patched version
- Exported `getQueueStatus()` function from `app/services/slice/queue.js` for health check integration

### Validation

- Verified `/health` endpoint returns uptime (existing behavior preserved)
- Verified `/health/detailed` endpoint:
  - returns `HTTP 200` with `status: OK` when all subsystems available
  - returns `HTTP 503` with `status: DEGRADED` when Python subprocess unavailable (expected Windows condition)
  - includes valid queue status reporting (length, active jobs, limits)
  - includes valid slicer path and storage directory checks

## v3.0.2 (2026-03-65)

### Changed

- Decomposed large orchestration blocks for maintainability:
  - `app/services/slice.service.js` (pipeline helpers + response builder extraction)
  - `tests/testing-scripts/admin_output_files_test_runner.py` (validation helpers)
  - `tests/testing-scripts/pricing_cycle_test_runner.py` (shared mutation/verification step helpers)
- Split full API matrix testing into dedicated per-engine/per-technology runners:
  - `tests/testing-scripts/full_api_orca_fdm_test_runner.py`
  - `tests/testing-scripts/full_api_prusa_fdm_test_runner.py`
  - `tests/testing-scripts/full_api_prusa_sl1_test_runner.py`
  - kept `tests/testing-scripts/full_api_test_runner.py` as a suite wrapper that executes all three and writes a consolidated summary
- Hardened runtime image contents in `Dockerfile` without changing app behavior:
  - removed npm CLI (`npm` / `npx` / `corepack`) from final runtime stage
  - removed build-only runtime tools (`curl`, `gnupg`) after Node installation in final stage
- Updated API testing guide for the split full API runners and report outputs:
  - `tests/testing-scripts/API Test.md`

### Validation

- Verified syntax/quality checks on updated service and test files.
- Verified one end-to-end FDM slicing smoke request after slice service decomposition (`HTTP 200`).
- Verified rebuilt backend container reached healthy state after Dockerfile hardening changes.

## v3.0.1 (2026-03-05)

### Changed

- Hardened Prusa runtime INI update logic in `app/services/slice/profiles.js`:
  - replaced fragile regex line replacement with line-based key upsert
  - normalized mixed line ending handling (`CRLF` / `LF` / `CR`)
- Updated Python geometry dependency stack in `requirements.txt`:
  - added `mapbox-earcut==1.0.1`
  - updated `manifold3d` to `3.4.0` (Python 3.12-compatible)
- Reduced duplicated endpoint literals in test runners by introducing constants:
  - `tests/testing-scripts/full_api_test_runner.py`
  - `tests/testing-scripts/queue_concurrency_test_runner.py`
- Hardened value parsing against unsafe object stringification:
  - `app/services/slice/value-parsers.js`
  - `app/services/slice/profiles.js`
- Confirmed request-time model transform controls in slicing flow:
  - target size configuration on `X`, `Y`, `Z` axes
  - rotation configuration on `X`, `Y`, `Z` axes
  - orientation preprocessing applied before slicing

### Fixed

- Fixed Prusa SLA runtime profile corruption that produced merged INI keys (e.g. `printer_technology = SLA\rlayer_height = ...`) and caused SLA slicing 500 errors.
- Fixed Docker build failure caused by malformed concatenated requirement line in `requirements.txt`.
- Fixed Docker build dependency resolution error for unavailable `manifold3d==0.0.6` on Python 3.12.

### Validation

- Verified targeted SLA-only manual runs for both supported SLA layer heights:
  - `0.05` -> successful `200` responses with `.sl1` creation
  - `0.025` -> successful `200` responses with `.sl1` creation (after rate-limit cooldown)

## v3.0.0 (2026-03-03)

### Added

- Added dedicated dual-slicer public endpoints:
  - `POST /prusa/slice`
  - `POST /orca/slice`
- Added Orca runtime profile support with separated machine/process configs:
  - `configs/orca/Bambu_P1S_0.4_nozzle.json`
  - `configs/orca/FDM_0.1mm.json`
  - `configs/orca/FDM_0.2mm.json`
  - `configs/orca/FDM_0.3mm.json`
- Refactored deployment channel:
  - `Dockerfile` (Ubuntu 24.04 base)
  - `docker-compose.yml` (side-by-side rollout porting)

### Changed

- Updated slicing architecture from legacy fixed-technology routes to engine-based routing:
  - removed old client contract dependence on `POST /slice/FDM` and `POST /slice/SLA`
  - introduced engine-aware processing (`prusa` / `orca`)
- Updated layer-height validation policy:
  - Prusa endpoint allows `0.025`, `0.05`, `0.1`, `0.2`, `0.3`
  - Orca endpoint allows `0.1`, `0.2`, `0.3`
- Added material-to-technology guardrails for all slice requests:
  - invalid pairings now return explicit mismatch validation errors
- Updated response payload contract for slicing success:
  - includes `slicer_engine` in response
- Reworked runtime path model for slicer configs:
  - Prusa profiles moved under `configs/prusa/`
  - Orca profiles under `configs/orca/`

### Validation

- Verified next-channel runtime with full regression suite:
  - full API matrix runner
  - queue concurrency runner
  - pricing lifecycle runner
  - admin output-files runner

### Documentation

- Refreshed README endpoint documentation to the new API behavior (`/prusa/slice`, `/orca/slice`).
- Updated badges to include OrcaSlicer and next Ubuntu channel visibility.

## v2.3.0 (2026-02-26)

### Changed

- Finalized Docker ↔ local workspace synchronization for active runtime paths:
  - shared bind mounts for `input/`, `output/`, and `configs/`
  - shared app-source mounts for JS/PY runtime code in development compose
- Enforced root-only runtime directory policy:
  - removed legacy app-local runtime folders (`app/input`, `app/output`, `app/configs`)
  - removed legacy app-local pricing file (`app/config/pricing.json`)
  - runtime now uses root `configs/pricing.json` as the single pricing source of truth
- Removed project-level logs folder coupling:
  - deleted `./logs:/app/logs` compose binds
  - removed `/app/logs` creation from image build
- Clarified and enforced generated output naming convention:
  - `InputName-output-<timestamp>.gcode`
  - `InputName-output-<timestamp>.sl1`
- Continued decomposition of the earlier oversized slicing flow (`slicing.js` legacy concept) into focused modules:
  - `app/services/slice.service.js`
  - `app/services/slice/command.js`
  - `app/services/slice/queue.js`
  - `app/services/slice/zip.js`

### Repository policy

- Publishing policy updated for tests and runtime artifact folders:
  - `tests/testing-scripts/` remains publishable
  - `tests/testing-files/` is excluded from publication
  - `input/` and `output/` are kept as empty tracked folders (`.gitkeep` only)

### Documentation

- Updated README and test documentation to reflect:
  - new output filename convention
  - root runtime folders and pricing persistence path
  - test publication/ignore behavior and corrected `testing-files` path naming

## v2.2.2 (2026-02-25)

### Added

- Published previously private API testing scripts as public repository assets.
- Added unified shared test helpers:
  - `tests/testing scripts/common/env_utils.py`
  - `tests/testing scripts/common/http_utils.py`
- Added standardized JSON and Markdown report outputs for test runners under:
  - `tests/testing scripts/results/`

### Changed

- Reorganized test assets into dedicated public structure:
  - `tests/testing scripts/` for runners and docs
  - `tests/testing files/` for sample inputs
- Refactored slicing internals by decomposing large service logic into focused modules:
  - queue handling (`app/services/slice/queue.js`)
  - command execution (`app/services/slice/command.js`)
  - ZIP processing (`app/services/slice/zip.js`)
- Improved Docker runtime path resolution for configuration profiles and pricing persistence.
- Fixed pricing persistence in containerized runtime by writing `pricing.json` to writable config storage (`/app/configs/pricing.json`).
- Restored Docker slicing stability by fixing runtime config profile lookup (`FDM_*.ini`, `SLA_*.ini`).

### Validation

- Verified Docker-based integration runs for:
  - admin output-files flow
  - pricing lifecycle flow
  - queue concurrency flow

## v2.2.1 (2026-02-25)

### Added

- Added `.env.template` with required and optional runtime variables.

### Changed

- Added `dotenv` integration so local `npm start` also loads `.env` values.
- Updated package version to `2.2.1`.

### Documentation

- Added a quick setup section to README covering:
  - how to wire `.env.template` into `.env`
  - runtime `input/`, `output/`, and `configs/` folder roles
  - available built-in config profiles (`FDM`/`SLA` `.ini`) and `pricing.json` behavior

## v2.2.0 (2026-02-24)

### Added

- Added protected admin endpoint for generated artifact discovery:
  - `GET /admin/output-files`
  - requires `x-api-key` (`ADMIN_API_KEY` must be configured)
  - returns file metadata from `output/` (`fileName`, `sizeBytes`, `createdAt`, `modifiedAt`)
- Added integration test runner for admin output file listing:
  - `tests/admin_output_files_test_runner.py`

### Changed

- Updated slicing response contract:
  - removed `download_url` from `POST /slice/FDM` and `POST /slice/SLA` success payloads.
- Tightened slice endpoint flood control:
  - default slice rate limit is now `3 requests / 60 seconds / IP`.
  - applies only to slicing POST endpoints (`POST /slice/FDM`, `POST /slice/SLA`).
- Updated slice queue execution policy:
  - requests are accepted and processed in FIFO arrival order.
  - default queue concurrency is now `1` (`MAX_CONCURRENT_SLICES`).
- Updated pricing PATCH behavior:
  - `PATCH /pricing/:technology/:material` now updates existing materials only.
  - returns `400` when material does not exist for the selected technology.
- Standardized pricing material matching behavior:
  - create/update/delete matching is case-insensitive (`PLA`, `pla`, `pLa` are equivalent).
  - new material keys are stored in canonical uppercase form.
- Improved docs and test guidance:
  - README updated for new admin endpoint and response contract changes.
  - `tests/API Test.md` updated with new admin endpoint test workflow.

### Documentation

- OpenAPI/Swagger updated with:
  - admin endpoint schema for `GET /admin/output-files`
  - PATCH summary/validation notes for existing-material-only updates.

## v2.1.2 (2026-02-23)

### Changed

- Refactored slicing error handling and response mapping for clearer API behavior:
  - invalid archive input now returns `INVALID_SOURCE_ARCHIVE`
  - invalid/non-printable source geometry now returns `INVALID_SOURCE_GEOMETRY`
  - 10-minute processing timeout now returns `FILE_PROCESSING_TIMEOUT` with HTTP `422`
- Hardened ZIP processing with runtime path resolution and retry logic to prevent transient `ENOENT` failures on upload extraction.
- Disabled model-size preflight slicing stop. Requests are no longer rejected solely due to build-volume dimension checks.
- Reduced cognitive complexity in `slice.service.js` by extracting request parsing, ZIP extraction, conversion, orientation, slicer argument building, and error handling into focused helper functions.
- Improved Docker runtime compatibility:
  - fixed Python script/runtime path consistency
- Removed filesystem logging dependency on `/logs`:
  - removed `LOGS_DIR` and `RUNTIME_PRICING_FILE` path usage
  - removed `pricing.runtime.json` fallback/write target
  - switched error logger to console-only structured logging

### Documentation

- Updated README API usage wording and examples for clarity and consistency.
- Updated README behavior notes to reflect current slicing policy (no preflight build-volume stop).
- Added README notes on Python test runner execution and interpreting `tests/results` outputs.

## v2.1.1 (2026-02-21)

### Changed

- Standardized OpenAPI/Swagger pricing paths to canonical uppercase technology routes:
  - `POST /pricing/FDM`
  - `POST /pricing/SLA`
  - `PATCH /pricing/FDM/:material`
  - `PATCH /pricing/SLA/:material`
  - `DELETE /pricing/FDM/:material`
  - `DELETE /pricing/SLA/:material`
- Added npm runtime scripts for faster local process start:
  - `npm start`
  - `npm run dev`
- Added IP-based rate limiting for slicing endpoints (`/slice/FDM`, `/slice/SLA`) with configurable limits.
- Added bounded in-memory slicing queue with configurable concurrency, queue length, and queue timeout.
- Added ZIP archive guard logic to mitigate zip bombs and path traversal:
  - max ZIP entries
  - max cumulative uncompressed size
  - encrypted ZIP rejection
  - unsafe path rejection (`../`, absolute paths)
- Added request size hardening:
  - multipart upload limit for model uploads
  - JSON and urlencoded body size limits
- Hardened monitoring exposure by adding Nginx Basic Auth requirement in `ops/monitoring/setup-monitoring.sh` and monitor vhost template.

### Documentation

- Clarified in README that pricing technology path segments are case-sensitive and canonicalized as uppercase (`FDM`, `SLA`).
- Added optional local Node runtime instructions (`npm start`, `npm run dev`) to README.
- Added security/hardening configuration details to README (rate limit, queue settings, ZIP limits, body/upload limits, monitoring Basic Auth usage).

## v2.1.0 (2026-02-20)

### Changed

- Removed legacy `POST /slice` endpoint from the API routing layer.
- Removed deprecated `/slice` operation from OpenAPI/Swagger documentation.
- Kept slicing contract explicit with dedicated endpoints only:
  - `POST /slice/fdm`
  - `POST /slice/sla`

### Documentation

- Updated endpoint documentation to reflect explicit FDM/SLA routing.
- Added retroactive release notes for historical tags.

## v2.0.0 (2026-02-20)

### Stable release

- Stabilized v2 baseline and refreshed release documentation.
- Strengthened public deployment/security guidance in docs.
- Tag message: `v2.0.0 stable release`.

## v1.1.2 (2026-02-19)

### Docs patch (v1.1.2)

- README patch release.
- Tag message: `README.md patch v1.1.2`.

## v1.1.1 (2026-02-19)

### Docs patch (v1.1.1)

- README patch release.
- Tag message: `README.md patch v1.1.1`.

## v1.1.0 (2026-02-19)

### Added

- Endpoint expansion and API structure improvements.
- Public README and project branding update (logo).

### Changed (v1.1.0)

- Refactored large `server.js` into a modular ecosystem.
- Tag message: `Important update v1.1.0: decoupled the big server.js file into a whole ecosystem! New endpoints added!`.

## v1.0.0 (2026-02-19)

### Release

- First stable release for FDM/SLA workflows on CAD and direct 3D inputs.
- Added logging system and GitHub Actions VPS deployment workflow.
- Tag message: `v1.0.0 release`.

## v0.9.2 (2026-02-18)

### Milestone (v0.9.2)

- Added `.zip` input support (first valid supported file in archive is processed).
- Continued work on `.igs/.iges` and archive input handling.
- Tag message: `v0.9.2 milestone`.

## v0.9.1 (2026-02-17)

### Milestone (v0.9.1)

- Accepted `.obj` flow with conversion of incoming models to `.stl`.
- Tag message: `v0.9.1 milestone`.

## v0.9.0 (2026-02-17)

### Milestone (v0.9.0)

- Early SLA price prediction support for `.stl`, `.3mf`, and `.obj`.
- Tag message: `v0.9.0 milestone`.
