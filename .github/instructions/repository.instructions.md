---
applyTo: "**"
---

# Repository Wide Instructions

Last synchronized: 2026-09-02

## Architecture
- Backend stack is Node.js + Express + Python 3.12 helper scripts.
- Slicing engines: PrusaSlicer 2.8.1 (FDM/SLA), OrcaSlicer 2.3.1 (FDM only),
  Bambu Studio 02.08.02.61 (FDM only, official BBL vendor chain).
- Service-authenticated slicing endpoints: /prusa/slice, /orca/slice,
  /bambu/slice; service-authenticated preview endpoint: /render.
- Public informational startup catalogue: GET /profiles (82 rows).
- The complete current contract with exact numbers is the "Current contract"
  section of `CLAUDE.md`; the consumer view is `docs/integration-guide.md`.
  The pre-3.2.0 narrative is preserved verbatim in
  `docs/codex/history-waves.md`.

## Hard Constraints
- Runtime directories must remain root-scoped: input/, output/, configs/.
- Do not introduce app/input, app/output, or app/configs.
- Fail-fast model policy: converter rejections are INVALID_SOURCE_GEOMETRY
  (400, `INVALID_SOURCE_GEOMETRY|<reason>` marker) and native refusals are
  UNSLICEABLE_SOURCE_GEOMETRY (422). Never repair geometry.
- Keep queueing and rate-limiting active for every slice-service route,
  including /render; the limiter and the queue fairness cap key on the frozen
  slice principal with IP fallback, and every 429 carries Retry-After.
- Preserve slice route order: limiter -> x-slicer-api-key authentication ->
  root-scoped workspace/Multer -> option/profile validation -> queue -> native
  processing. A 400 never consumes a queue slot.
- Keep Orca output mapping deterministic via per-request isolated output directory handling.
- Preserve the engine invocation policies: Orca `--load-settings
  machine;process`, `--load-filaments filament`, `--arrange 1 --orient 0` and
  exactly one single-token `--allow-rotations=0`; Bambu `--curr-bed-type`,
  `--export-3mf`, `--arrange 0 --orient 0`, never `--allow-rotations`; Prusa
  adds no native rotation. Startup verifies all three engine versions
  atomically from bounded `--help` output.
- Preserve API-owned Bambu placement (`bambu-bed-geometry.js`,
  `bambu-placement.js`, `scale_model.py --place-min-x/--place-min-y`),
  `placement_mm` in Bambu responses, and the measured inclusive ceilings:
  Bambu P1S `256 x 228 x 250` with the alternative `238 x 256` footprint (the
  `18 x 28 mm` excluded corner makes admission L-shaped), Bambu H2D
  `325 x 320 x 325`; Prusa P1S `256 x 256 x 249.9`, Orca P1S
  `253.9 x 253.9 x 249.9`, Prusa H2D-QUOTE `350 x 320 x 324.9`, Orca H2D-QUOTE
  `347.9 x 317.9 x 324.9`. Declared profile metadata stays separate from
  admission; the FDM fallback `350 x 320 x 325` and `1 mm` minima are unchanged.
- Preserve the retained artifact extensions `.gcode`, `.sl1`, and Bambu
  `.gcode.3mf` across naming, listing, and download validation.
- Preserve the request contract: `supports` default `true`
  (`INVALID_SUPPORTS`), strict integer `infill` 0..100 with optional `%`
  (`INVALID_INFILL`), exact `orientationMode=auto|preserve`
  (`INVALID_ORIENTATION_MODE`), fit-within-box `keepProportions`, Bambu
  `printerProfile=P1S|H2D` (`INVALID_PRINTER_PROFILE`), vendor
  `processProfile` (`INVALID_PROCESS_PROFILE`), registry material mapping
  (`MATERIAL_PROFILE_UNAVAILABLE`).
- Preserve the response contract: `transform_schema: 2` on success and on
  the full K2 `MODEL_OUT_OF_PRINTER_BOUNDS` 422 with the exact
  `original_dimensions_available` invariant, positive oriented/final
  dimensions (else `MODEL_DIMENSIONS_UNAVAILABLE`), `R_total = R_requested *
  R_automatic`, `stats.object_height_mm == final_dimensions_mm.z`, lowercase
  `profiles.effective_profile_sha256`, `engine_version`,
  `total_estimated_time` ranked first among time markers, direct-marker-only
  `material_used_g`, integer price rounding (`ceil(max(s, 900) * rate / 3600)`
  rounded up to 10 HUF; 1980 s at 800 HUF/h is 440), and SLA quote-only
  (`null` mass, rate, price).
- Preserve bounded native stdout independently from stderr on command
  failure; only real timeouts map to FILE_PROCESSING_TIMEOUT; buffer overflow
  maps to NATIVE_OUTPUT_OVERFLOW (500).
- Preserve exactly one supported source per outer ZIP with junk tolerance
  (`__MACOSX/`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, directories),
  case-insensitive 3MF roots, admitted Bambu/Orca project parts under
  `Metadata/` and `Auxiliaries/`, 3MF units, and compound-STL conversion of
  multi-object scenes.
- Preserve the runtime budgets: `SLICE_COMMAND_TIMEOUT_MS` 600000 in
  1000..3600000, 120 s per Python helper, 60 s renderer, 600 s upload
  lifetime, 10 s post-SIGKILL settle, quarantine drain <= 10 s then exit 70.

## Security
- Normal startup requires pricing, artifact, and operations active keys plus one
  complete slice mode: default shared-only `legacy`; shared plus both principals
  and a future <=90-day expiry for `migration`; or both principals with no
  shared slots/expiry for `principals`. Reject one-principal and previous-
  without-active states; every configured value, including a valid
  `ADMIN_API_KEY`, must be globally unique, non-placeholder, and 32-256
  printable ASCII. Only the admin key's exact authorized legacy substitution
  self-reference is skipped.
- All slice-service routes require exactly one x-slicer-api-key header;
  x-api-key is not a slice alias and service auth must not gain a dual reader.
  Missing, wrong, or migration-expired shared values return exact HTTP 401
  `SLICE_SERVICE_AUTH_REQUIRED` before workspace allocation. Principal slots
  continue at and after migration expiry.
- Pricing, artifact, and operations routes require x-api-key for only their
  active or previous audience slot. All comparisons use fixed-size digests.
- Rotate through two restarts; removing previous before restart revokes the old key.
- ADMIN_API_KEY is only a <=90-day, explicitly named, one non-slice audience
  migration. Any other cross-slot reuse is refused.
- Keep `/profiles` unauthenticated, startup-built, immutable, informational,
  and independent of slicing availability. Preserve the strong ETag,
  conditional 304, body `catalogue_sha256`, typed non-critical 503, the 82-row
  FDM-only `r3d-profile-catalogue-v2` set (6 Prusa, 24 Orca, 28 Bambu P1S, 24
  Bambu H2D), separate `declared_build_volume_dimensions_mm` and
  `largest_passing_dimensions_inclusive_mm`, and engine-scoped
  `machine_resolutions`/`fleet_resolutions` (never merged across engines, no
  manual `fleet_max`). Never publish the generic `120 x 120 x 150 mm` SLA
  fallback as a machine envelope; never guess the Elegoo Saturn 4 Ultra.
- The pricing file is authoritative: defaults seed only a missing or empty
  `configs/pricing-state/pricing.json`; pricing routes return stable
  `errorCode` values.
- No-Origin requests are allowed. Browser-origin protected calls use only their
  SLICE_, PRICING_, ARTIFACT_, or OPERATIONS_CORS_ALLOWED_ORIGINS list.
- Protected x-api-key routes remain IP-rate-limited (30/60 s).
- Forwarded identity defaults off. TRUST_PROXY=true must compile unique,
  validated explicit IP/CIDR peers or loopback and refuse wildcard/overbroad/
  malformed/unknown values. Use nearest-untrusted-hop client identity.
- Accept only bounded safe inbound request IDs; replace unsafe values and return
  the resolved X-Request-Id.
- Python executable resolution must use absolute validated paths (PYTHON_EXECUTABLE or trusted fallbacks).
- Admin output download must preserve extension allowlist (`.gcode`, `.sl1`,
  `.gcode.3mf`) and path/symlink/realpath containment checks; `ALL` ZIP export
  preserves the same checks plus MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES.
- Shell commands use execFile with argument arrays and a minimal child environment.
- Upload accepts only a single file on choosenFile field with extension validation.
- Snapshot selected canonical regular Prusa bytes, the allowlisted flattened
  Orca v2.3.1 `Custom` parent chain, and the flattened Bambu vendor chain into
  job scratch before bounds/runtime/digest/native use; public fields retain
  child basenames or vendor names. Preserve the Docker build equality gate for
  the Orca parents and stable Orca `layer_gcode=''` /
  `use_relative_e_distances='1'`. Keep Prusa INI section/key identity
  case-sensitive and reject exact duplicate qualified keys.
- OpenAPI documents every live code, including `INVALID_SUPPORTS`,
  `INVALID_INFILL`, `INVALID_PRINTER_PROFILE`, `INVALID_PROCESS_PROFILE`,
  `MATERIAL_PROFILE_UNAVAILABLE`, `UNSLICEABLE_SOURCE_GEOMETRY`,
  `NATIVE_OUTPUT_OVERFLOW`, the 429/503 queue codes, and the disjoint K2 bounds
  branch with both dimension payloads and the complete schema-2 transform.
- HTTP defaults/bounds are headers timeout 60000 [1000,60000], request
  timeout 600000 [60000,600000], keep-alive timeout 95000 [1000,120000],
  header count 2000 [16,2000], connections 128 [1,1024], and requests/socket
  100 [1,1000]. Invalid overrides fall back to defaults and effective headers
  timeout is capped at request timeout. Actual VPS capacity and reverse-proxy
  timeouts are owner-verified facts.
- Public /health is liveness and /ready is minimal readiness. Detailed
  health/readiness/metrics require operations scope. Keep readiness reason
  codes stable (retention sweep failures surface as RETENTION_UNSAFE and are
  non-fatal to the slice) and all event/metric fields bounded, allowlisted,
  redacted, and fixed-cardinality; `orientation.fallback` is part of the fixed
  event vocabulary.
- Development Compose remains loopback-published on an ordinary bridge; the
  production manifest uses an internal private bridge, no host port, a
  digest-only image, and `init: true` (both manifests). Production still runs
  the signed main candidate `bf5e712`; the 3.2.0 image is not published,
  deployed, or routed. Publication is the manual I11 `workflow_dispatch` from
  exact protected `main` with digest-only, signed/attested, no-deploy
  semantics (candidate provenance schema `i7-s3a-candidate-provenance-v2`).
  Deploy, route, DNS, allowlist, and consumer changes are separately
  owner-authorized.
- Never commit a real IP address, hostname, or credential; use RFC 5737 ranges
  and `.invalid` hostnames. Never read or publish `docs/research/`.

## Testing
- Use Python test runners under tests/testing-scripts/ and the JavaScript/
  Python unit suites (`npm run test:js`, `npm run test:python`).
- Always read generated markdown report from tests/testing-scripts/results/ after runs.
- `tests/unit/js/instruction-mirrors.test.js` pins `.github/agents` ==
  `.claude/agents` and `.github/skills` == `.claude/skills` byte for byte.

## Agentic Workflow Gates
- Run fast syntax validation before integration tests when source files change.
- Run quality-architect for non-trivial source changes or decomposition guardrail pressure.
- Run docs-sync after code/test/workflow updates settle.
- Keep `.claude/.mcp.template.json` credential-free; never commit `.claude/.mcp.json`.

## Multi-agent Sync
When changing architecture/domain policies, keep synchronized:
- .github/copilot-instructions.md
- CLAUDE.md
- .claude/CLAUDE.md
- .github/skills/*
- .claude/skills/*
- .github/agents/*
- .claude/agents/*
