# Security model

## J3B measurement, native-envelope, and catalogue control delta

Current classification:
`J3_OWNER_CONTAINER_MATRIX_VERIFIED_EXACT_58C0CCB;
J3B_SCHEMA_OWNER_APPROVED;
J3B_SOURCE_IMPLEMENTATION_PRESENT;
J3B_LOCAL_VALIDATION_COMPLETE;
J3B_H2D_MEASUREMENT_A_EXACT_IMAGE_VERIFIED;
J3B_LOCAL_EXACT_IMAGE_FINAL_ADMISSION_B_VERIFIED;
J3B_OWNER_VPS_MATRIX_PENDING;
J3B_NO_MERGE_NO_DEPLOY_NO_ROUTE_MUTATION`.

| Control | Current classification | Fail-closed boundary |
| --- | --- | --- |
| Original-measurement truth | `OWNER_APPROVED; SOURCE_IMPLEMENTED; LOCAL_SOURCE_TESTED; EXACT_IMAGE_FALSE_NULL_VERIFIED` | Schema 2 always carries `original_dimensions_available` and nullable `original_dimensions_mm` on success and full K2 bounds failure. True means a canonical real measurement object whose finite non-negative `height_mm == z`; false means null. A malformed tagged original degrades to false/null and no oriented substitute is permitted, so degradation is explicit instead of quietly mislabeled. Exact-image B proves the real unavailable-measurement false/null path; malformed-tag injection remains source/unit evidence. |
| Load-bearing geometry | `OWNER_APPROVED; SOURCE_IMPLEMENTED; LOCAL_SOURCE_TESTED` | Oriented and final dimensions drive bounds and success metrics. Missing, malformed tagged, non-finite, non-positive, or `height_mm != z` values return controlled HTTP 422 `MODEL_DIMENSIONS_UNAVAILABLE`; success unconditionally requires `stats.object_height_mm == final_dimensions_mm.z`. The exact-image B HTTP matrix proves positive canonical dimensions and the success height invariant, but does not inject this unavailable-dimension failure branch. |
| Native placement/volume rejection | `SOURCE_IMPLEMENTED; MEASUREMENT_A_EXACT_IMAGE_VERIFIED; FINAL_B_EXACT_IMAGE_VERIFIED` | Only explicit native placement/print-volume diagnostics map to HTTP 422 `MODEL_OUT_OF_PRINTER_BOUNDS`. Failed commands preserve bounded stdout independently from stderr so either can carry the diagnostic. A Prusa exit-zero/no-artifact result maps only when its retained output explicitly reports placement refusal. The response carries the complete K2 schema-2 transform; unrelated failures remain internal. At `0.3 mm`, `325 mm` returned that full K2 422 twice on each engine after the exact conjunctive last-layer classifier. |
| Inclusive admission catalogue | `OWNER_ACCEPTED_P1S; H2D_MEASUREMENT_A_VERIFIED; FINAL_B_EXACT_IMAGE_VERIFIED` | `r3d-profile-catalogue-v2` separates physical/profile-declared dimensions from `largest_passing_dimensions_inclusive_mm`, the exact-boundary-inclusive admission authority. P1S is Prusa `256 x 256 x 249.9 mm` and Orca `253.9 x 253.9 x 249.9 mm`. Measurement A and final-admission B established H2D-QUOTE Prusa `350 x 320 x 324.9 mm` and Orca `347.9 x 317.9 x 324.9 mm`; Prusa native X/Y beyond either declared profile remains `UNESTABLISHED`. Machine and fleet derivation is per engine, never cross-engine minimization. |
| H2D-sized quoting chain | `SOURCE_IMPLEMENTED_BOTH_ENGINES; MEASUREMENT_A_EXACT_IMAGE_VERIFIED; FINAL_B_EXACT_IMAGE_VERIFIED` | H2D-QUOTE derives from P1S physics and only enlarges the declared bed to `350 x 320 x 325 mm`. It is quote-only, not machine-accurate and not production H2D G-code. The plugin calls only `POST /prusa/slice`, so the Prusa path is mandatory. Exact helper-image measurement A passed 44/44 fixture preconditions, 10/10 brackets, and 2/2 combined corners; exact local B passed 88/88, 20/20, and 4/4. |
| Fixture integrity | `MEASUREMENT_A_44_OF_44_PASS; FINAL_B_88_OF_88_PASS; OWNER_MATRIX_PENDING` | Normal fixtures require outward non-zero facet normals plus immediate native `prusa-slicer --info` dimension validation. The deliberately zero-normal legal binary STL is a separate regression row: exact J2 and exact local B returned HTTP 200 on both engines, and B reports schema-2 false/null original provenance. It cannot be reported as a normal service defect. |
| Exact-phase runner binding | `MEASUREMENT_A_PHASE_VERIFIED; FINAL_B_PHASE_VERIFIED` | The 37-case orientation matrix restores all section-0 rows. Its configurable native-info command is a bounded no-shell JSON argv template and the report retains only a source label. The envelope measurement-A/final-admission-B lanes require an exact `/profiles` phase match before slicing, then bind each response to the exact expected `max` and actual bounds `source_profile` (Prusa selected layer profile; Orca machine profile, not process). Measurement A passed its exact phase guard; final B passed 88/88 fixture, 20/20 bracket, 4/4 corner, and 9/9 catalogue checks plus optional Prusa digest parity. |
| Exposure and release boundary | `ZERO_CUSTOMER_EXPOSURE; NO_CURRENT_RELEASE_AUTHORITY` | The plugin has no production deployment/traffic and LeadPilot slicing is not enabled. The owner chose one merge and one deploy for J2+J3+J3B after verification, but this wave authorizes neither. Registry publication, deploy, public-route/DNS/allowlist mutation, consumer-repository changes, and customer traffic remain out of scope. |

J3's production-identical owner matrix passed on exact tree `58c0ccb`, including
artifact-level G-code proof of `--allow-rotations=0`; J3B does not reopen that
contract. J3B exact-image H2D measurement A and exact local final-admission B
are complete. B binds source
`47ae13397bb4537b4bb700b8c6bf3d9648364bdc` to image
`sha256:1f8ec16318eeda4b8f2e24a54e98e972ef22344126b324123f23f220916617a0`,
matching revision label, non-root `999:999`, healthy/read-only runtime, and
host port bound only to localhost. Its orientation report passed 12/12 fixture, 4/4
selector, and 37/37 HTTP checks. The owner VPS matrix remains the separate
`PENDING_OWNER` gate. See
[`evidence/j3b-native-envelope-and-original-dimensions.md`](evidence/j3b-native-envelope-and-original-dimensions.md).

## Historical J3 orientation-visibility and transform-provenance control delta

Current classification:
`J3_SCHEMA_OWNER_APPROVED;
J3_LOCAL_SOURCE_TESTS_VERIFIED;
J3_OWNER_CONTAINER_MATRIX_VERIFIED_EXACT_58C0CCB;
J3_NO_DEPLOY_NO_ROUTE_MUTATION`.

| Control | Current classification | Fail-closed boundary |
| --- | --- | --- |
| Orientation request policy | `OWNER_APPROVED; LOCAL_SOURCE_TESTED` | Omission alone selects backward-compatible `auto`. A present value must be exact `auto` or `preserve`; blanks, whitespace, alternate case, null-like, numeric, array, and object values return HTTP 400 `INVALID_ORIENTATION_MODE`. Explicit `rotationX/Y/Z` remains available in either mode. |
| Orientation sidecar trust | `LOCAL_SOURCE_TESTED; OWNER_CONTAINER_MATRIX_VERIFIED_EXACT_58C0CCB` | The Python helper writes one exclusive `0600`, bounded, versioned sidecar inside the owning workspace. Node accepts only a canonical regular non-symlink with stable identity, exact keys/schema/mode, finite proper 3x3 matrix, and consistent outcome. Invalid/missing `auto` metadata becomes explicit `fallback_unmodified` identity; it is never reported as an applied rotation. |
| Versioned transform truth | `HISTORICAL_FIRST_VERSION; SUPERSEDED_BY_J3B_SCHEMA_2` | Historical J3 success and bounds responses shared one complete transform contract distinguishing original/oriented/final dimensions and automatic/requested/total rotation. The authoritative rotation-only matrix is `R_requested * R_automatic`, where requested Euler input is X then Y then Z (`Rz * Ry * Rx`); scaling, centering, grounding, and translation are excluded. J3B schema 2 above is current. |
| Bounds-error consumer parity | `OWNER_APPROVED; LOCAL_SOURCE_TESTED` | A bounds failure includes complete `model_transform` beside model dimensions and build limits. Wording must use both fields: only `orientation_outcome=applied` supports “does not fit even after automatic rotation”; `unchanged` means automatic evaluation retained the pose, `preserved` identifies the submitted pose, and `fallback_unmodified` discloses that automatic orientation was unavailable. |
| ZIP and multi-object capability | `SOURCE_PROVEN` | The outer ZIP accepts exactly one supported source. A 3MF scene's geometries are concatenated into one compound STL, one STL argument reaches the slicer, and the API requests no split-to-objects operation. Disconnected shells therefore retain relative placement instead of becoming independently packable arranger objects; there is no current independent multi-object packing capability for the yaw prohibition to remove. |
| Native post-transform rotation | `OWNER_CONTAINER_MATRIX_VERIFIED_EXACT_58C0CCB` | Prusa adds no native rotation. Orca retains `--arrange 1` for placement and `--orient 0`, plus exactly one single-token `--allow-rotations=0` to disable unreported whole-compound yaw. The owner measured real G-code/6.25 g with the equals form and `No such file: 0` with the split form on exact Orca 2.3.1, then passed the full J3 matrix on exact tree `58c0ccb`. This does not prove the corrective J3B image. |
| Production boundary | `NO_DEPLOY_NO_ROUTE_MUTATION` | J3 authorizes no registry write, image publication, deploy, public-route activation, customer traffic, or consumer-repository change. Repository-local results cannot establish any of those states. |

The exact code-bearing SHA is
`c404326f535fcc70ba62aa923fa6652f4fba5019`. Local gates passed at 2352/2352
JavaScript tests, 132 Python tests with 131 pass plus one expected Windows
POSIX-permission skip, syntax over 259 JavaScript and 44 Python files, 37/37
staged safety paths, and zero production dependency vulnerabilities.
The owner later passed the full historical J3 matrix on exact tree `58c0ccb`;
the J3B owner-VPS rerun and its report remain `PENDING_OWNER`. See
[`evidence/j3-orientation-visibility.md`](evidence/j3-orientation-visibility.md).

## Historical J2 bounds, catalogue, private-route, and calibration control delta

Current classification:
`J2_LOCAL_AGGREGATE_PASS;
J2_HOSTED_BASELINE_SOURCE_IMAGE_PASS_NO_PUBLISH;
J2_LIVE_ACTIVATION_REHEARSAL_BLOCKED_NOT_RUN;
J2_NO_ROUTE_MUTATION;
J2_REHEARSAL_TERMINAL_CONTRACT_DARK;
J2_ORCA_CALIBRATION_BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER`.

The v1 catalogue and declared-envelope admission statements in this table are
historical J2 evidence. The J3B control table above is authoritative for the
current schema, per-engine inclusive ceilings, and H2D-QUOTE boundary.

| Control | Current classification | Fail-closed boundary |
| --- | --- | --- |
| Physical build-envelope truth | `IMPLEMENTED_FOCUSED_TESTED` | Prusa FDM and Orca P1S resolve to `256 x 256 x 250 mm`; Orca H2D resolves to `350 x 320 x 325 mm`. FDM fallback is the largest supported envelope, H2D. Selection-specific bounds remain authoritative: P1S Z `230 mm` is accepted, while `251 mm` and `260 mm` are rejected. |
| Public startup profile catalogue | `HISTORICAL_J2_CONTRACT; SUPERSEDED_BY_J3B_V2` | J2 established an unauthenticated, startup-built, machine-bound FDM catalogue through the production profile chain, with bounded generic selectors/components, a strong ETag, `catalogue_sha256`, and typed non-cacheable `503 PROFILE_CATALOGUE_UNAVAILABLE`. It excluded the generic `120 x 120 x 150 mm` SLA fallback. J3B catalogue v2 above is current. |
| Machine resolution, fleet maximum, and future SLA shape | `HISTORICAL_J2_RESOLUTION; SUPERSEDED_BY_ENGINE_SCOPED_V2` | J2 retained every preset row, failed on same-engine preset drift, and avoided component-wise conflict synthesis. J3B supersedes its cross-engine resolution with per-engine machine/fleet derivation. The owner-confirmed future SLA target remains the Elegoo Saturn 4 Ultra; its dimensions are not guessed, and a separate owner-profiled Chitubox/Elegoo Satellite wave is required before a truthful catalogue-v2 SLA row. |
| Private source allowlist | `REPOSITORY_CONTRACT_TESTED; LIVE_NOT_RUN` | The rendered router admits one through four unique canonical private IPv4 `/32` ranges. Phase one requires exactly one LeadPilot source; two through four are a later expansion. Router denial is HTTP 403, host-firewall denial is TCP reset plus private `J2_ALLOWLIST_DENY`, and application principal failure remains HTTP 401. |
| Route activation authority | `BLOCKED_NOT_RUN; NO_ROUTE_MUTATION; TERMINAL_DARK_CONTRACT_ONLY` | Repository checks can only prepare a dark-to-active rehearsal. One inherited root-private FD9 lock must span every route action and external observation; the helper re-proves canonical/root-owned/non-writable ancestor identity and terminates only through strict `--assert-router-dark` with an exact retained source. An external orchestrator must independently prove allowed and denied sources, TLS issuance/renewal, rollback, and the final dark readback. Repository-local gates cannot authorize promotion. Any `*_rollback_uncertain` result is `STOP/UNKNOWN`, not dark evidence. Logical fsync-cutpoint recovery is locally tested; real process/kernel/power-loss durability is `NOT_VERIFIED`. |
| Calibration privacy and comparability | `BAMBU_REFERENCE_9_NUMERIC_PLUS_BOUNDARY; ORCA_BLOCKED` | Public records use only `M01`-`M10` and hashes. Nine numeric Bambu rows plus the `M03` boundary form the gate. Orca auto-orient is disabled, the calibration process forces support off before digest/native execution, and the native call reuses production machine/process `--load-settings` plus separate `--load-filaments` construction. Missing vendor profiles and local Docker prevent an Orca measurement; generic profiles cannot establish vendor-faithful time or pricing. |

The protected-main baseline
`0dedbe1e9e4c32a0373982a45bf788cdcdb4f024` passed read-only Source run
`32996102492` and no-push Image run `32996102426`. Those runs are not hosted J2
evidence. No exact J0-capable publication/deployment or private/live observation
exists, so activation, TLS, allowlist behavior, rollback, current route state,
and customer traffic remain unverified. J2 made no route mutation; the latest
prior I12 dark classification was not re-verified. See
[`evidence/j2-bounds-network-calibration.md`](evidence/j2-bounds-network-calibration.md).

## J1C corrective over the J1 control delta

Current local classification:
`J1C_ZERO_MASS_GUARD_OWNER_SUPPLIED_VPS_PASS;
J1C_ORCA_COMMAND_AND_LAYER_RESET_LOCAL_CANDIDATE;
J1C_FINAL_COMBINED_IMAGE_RERUN_PENDING;
J1C_CAPABILITY_READINESS_PROPOSAL_ONLY;
NO_VENDOR_IMPORT; NO_EXTERNAL_PRODUCTION_AUTHORITY`.

| Control | Candidate classification | Fail-closed boundary |
| --- | --- | --- |
| Effective profile identity | `J1C_LOCAL_AGGREGATE_PASS; FINAL_IMAGE_PENDING` | Every successful Prusa/Orca payload requires one lowercase SHA-256 under `profiles.effective_profile_sha256`. Canonical identity covers engine, technology, normalized material, configured machine and non-request process layers, selected Orca filament JSON or explicit null, stable server-added Orca settings including empty `layer_gcode` and `use_relative_e_distances='1'`, each selected repository child machine's exact `layer_change_gcode='G92 E0'`, and the request-independent native invocation policy. Prusa export flags, Orca machine/process `--load-settings` order, and the optional dedicated `--load-filaments` flag are composed from that same policy. Paths, request/job/model identity, request layer height, and request infill are excluded. This is configuration/invocation-policy identity, not an engine-version, final-dimensions, artifact, customer, or live-calibration identity. |
| Selected-profile immutability and Orca inheritance | `J1_IMPLEMENTED_FOCUSED; J0_FINAL_EXACT_IMAGE_BUILD_EQUALITY_AND_HTTP_E2E_PASS` | After selection and before bounds/runtime derivation, Prusa profile bytes are bounded-read from canonical real paths and copied to exclusive job scratch. Orca resolves and snapshots the bounded, allowlisted versioned repository copy of the v2.3.1 `Custom` machine/process chain, and exact-byte snapshots a selected repository filament profile. Unknown/cyclic/name- or role-mismatched parent inheritance, symlink/non-canonical/non-regular sources, and detected size growth fail closed. Bounds, runtime derivation, digest, metadata extraction, and native arguments use that snapshot lineage; public metadata keeps original selected basenames. Parent-only and filament-present/null mutations change the digest. The parent equality gate and HTTP E2E passed on the historical J0 exact local image `sha256:66697a1ca69e13600a91481bf474d042c0f89b236ccbaf67fcf2dea8824f2c7f` built from code SHA `ed85eec63409b7362fe05c2b99031eeb24b5b9c9`; that image is not J1 evidence. |
| Prusa INI semantic identity | `IMPLEMENTED_FOCUSED_TESTED` | Digest canonicalization keeps section/key case significant while normalizing irrelevant order/comments; an exact duplicate qualified key fails closed like the native Boost INI parser. Runtime generation replaces one exact top-level lowercase request-owned `layer_height` or FDM `fill_density`, rejects a duplicate, and inserts a missing key before the first section. Differently cased native keys remain distinct and digest-covered. |
| OpenAPI runtime-error alignment | `J1_IMPLEMENTED_FOCUSED_TESTED` | The four J0 omissions, `FILE_PROCESSING_TIMEOUT`, `INTERNAL_PROCESSING_ERROR`, `ORCA_PROFILE_INCOMPATIBLE`, and `MODEL_OUT_OF_PRINTER_BOUNDS`, remain documented without renaming runtime `errorCode`. J1 adds the live `SLICE_OUTPUT_UNPARSED` HTTP 500 code, requires nullable `material_used_g`, and exposes nullable Orca filament basename/diameter/density fields. The already-live `MODEL_DIMENSIONS_UNAVAILABLE` remains only in the general 422 `oneOf` branch; the disjoint bounds branch requires both model dimensions and build-volume limits. |
| Native engine version response | `IMPLEMENTED_FOCUSED_AND_FINAL_EXACT_IMAGE_TESTED` | Before listen, both selected executables run bounded `--help`; the initialized version map is published only after both outputs contain exactly one valid engine-specific version plus the expected help sentinel. Failure rejects startup. The explicit telemetry-disabled startup runner cannot emit slice-native lifecycle events or increment slice-native outcome/duration metrics. Requests read the startup map and every success/OpenAPI schema requires `engine_version`. Focused atomic-init/cache/retry/response/telemetry-isolation contracts pass. Exact-image help probes returned exit 0 with 6087-byte Prusa and 5121-byte Orca output; `--version` returned exit 1 for both and is not used. The actual startup module passed in a network-disabled, non-root, read-only exact-image envelope and atomically published Prusa `2.8.1+linux-x64-GTK3-202409181416` and Orca `2.3.1`; final HTTP E2E on the recorded image ID also returned Orca `2.3.1`. |
| Orca placement and orientation ownership | `IMPLEMENTED_FOCUSED_AND_FINAL_EXACT_IMAGE_HTTP_E2E_TESTED` | Orca arguments pass `--arrange 1` and `--orient 0` after request preprocessing and bounds validation. Arrangement translates the already-rotated model onto the build plate, while auto-orient remains disabled and cannot replace the request-owned rotation. The superseded arrangement-disabled HTTP probe retained negative Y after an X90 origin rotation and failed with native status 206 / `Nothing to be sliced`; its earlier translated direct-smoke fixture did not cover this seam. The final network-disabled, read-only, healthy-container HTTP E2E passed with pre-request dimensions 30 x 20 x 10 mm, request rotation X90, and final dimensions 30 x 10 x 20 mm for both principal families. It returned Orca `2.3.1`, one deterministic lowercase effective-profile digest, and original profile basenames; a valid credential only under `x-api-key` was rejected with exact HTTP 401 and no workspace, queue, or artifact effects. The final queue was idle and exact cleanup passed. |
| Orca model-layer extrusion proof | `CURRENT_J0_FOCUSED_AND_EXACT_IMAGE_TESTED; HISTORICAL_I2_NOT_RETROACTIVE` | The current J0 smoke accepts a positive `G1 ... E` only in the model-layer region after exact `;BEFORE_LAYER_CHANGE`; prelude/purge extrusion cannot pass. Current focused and exact-image validation cover this stricter guard. The historical I2 hosted run used its then-current looser real-extrusion proof and is not evidence for the newer marker boundary. |
| Orca filament binding and layer reset | `J1C_LOCAL_AGGREGATE_PASS; OWNER_SUPPLIED_MECHANISM_PASS; FINAL_IMAGE_PENDING` | Production `engine.js` passes machine/process only through `--load-settings` and emits optional `--load-filaments` only for the exact selected filament snapshot. Both repository-owned P1S/H2D child profiles own exact `layer_change_gcode='G92 E0'`; the pinned upstream parent copy remains unchanged. Owner-supplied VPS mechanism evidence changed native output from 0.00 g to 4.12 g, but the exact final combined candidate image and hosted rerun remain pending. |
| Slice consumer separation | `IMPLEMENTED_FOCUSED_TESTED` | WooCommerce and LeadPilot have distinct active/previous key families behind the single `x-slicer-api-key` header. Every configured slot is fixed-digest compared; absent dummy slots never authorize. Cross-audience/principal reuse and incomplete configuration refuse startup generically. |
| Explicit slice-auth mode | `IMPLEMENTED_FOCUSED_TESTED` | `SLICE_SERVICE_AUTH_MODE` defaults to `legacy`, which requires the shared active and forbids principal material/expiry. `migration` requires shared active, both principal actives, and a future `SLICE_SERVICE_LEGACY_MIGRATION_UNTIL` no more than 90 days away. Shared active/previous authorize only while request time is strictly before expiry; at and after expiry they return the stable rejection while principal slots continue, and all six resolved slots are still compared. `principals` requires both principal actives and forbids shared active/previous and expiry; it is the route-activation target. Optional previous slots require their own active in the application contract, while the J0 initial route-activation gate requires both principal previous slots absent. A later rotation must separately prove every configured previous slot, an owner-approved removal deadline, and post-removal rejection. A configured valid `ADMIN_API_KEY` participates in global uniqueness; only its exact authorized substitution for one missing non-slice active avoids duplicate self-registration. Mode, slot, or deadline mismatch fails before listen. External production activation is outside repository evidence and authority. |
| Principal-only dark activation gate | `RUNBOOK_DEFINED; NOT_RUN_REPOSITORY_EVIDENCE` | Before any router action, sanitized resolver readback must prove `principals`, both principal actives, `legacyAccepted=false`, `expiresAt=null`, and absent shared active/previous, expiry, and both principal previous slots for initial activation. One private synthetic slice per principal must pass; available retired shared credentials under `x-slicer-api-key` and a correct principal under `x-api-key` must return exact 401 without workspace, queue, or artifact effects. Queue/artifact cleanup must be exact. Later rotation is separately authorized and proves every configured previous slot, an owner-approved removal deadline, and post-removal rejection. Missing or inconclusive evidence keeps the route dark. External production activation is outside repository evidence and authority. |
| Public read surfaces | `J2_CATALOGUE_ADDED` | `GET /health`, `GET /ready`, `GET /pricing`, and informational `GET /profiles` remain authentication-free. `/health` is cheap liveness, `/ready` is minimal readiness, and catalogue unavailability is an independent typed 503 that does not gate either surface or slicing. |
| Repository filament and material-mass identity | `J1C_LOCAL_AGGREGATE_PASS; FINAL_IMAGE_PENDING` | Orca PLA/PETG requests select and snapshot an exact repository filament profile, load machine/process through `--load-settings`, and load the selected filament through `--load-filaments`. Normalized material plus filament JSON remains digest-bound and the response exposes actual profile diameter/density. Missing or unsupported material omits `--load-filaments`, preserves explicit null metadata/mass/rate/price, and cannot trigger automatic pricing. Any non-null mass comes only from the slicer's direct G-code marker and is never inferred from length. |
| Strict G-code metric drift | `OWNER_SUPPLIED_GUARD_VPS_PASS; LOCAL_AGGREGATE_PASS; FINAL_IMAGE_PENDING` | `SLICE_STRICT_GCODE_METRICS` defaults to true and requires positive print-time and filament-length markers. On optional-mass paths, a missing or recognized non-positive grams marker becomes null/manual and is never published as zero or derived from length. Selected-profile Orca still requires positive direct grams within `MAX_MATERIAL_USED_GRAMS`; recognized zero remains `GCODE_FILAMENT_NOT_POSITIVE`, and missing/drifted mass maps to bounded HTTP 500 `SLICE_OUTPUT_UNPARSED`. The owner-supplied guard-only diagnostic image returned HTTP 200 with positive length and null mass/rate/price. The combined local aggregate passes; exact-image and hosted gates remain pending. |
| Live Bambu calibration | `J2_BAMBU_REFERENCE_9_NUMERIC_PLUS_BOUNDARY; ORCA_BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER` | The repository P1S/H2D candidates remain generic Marlin profiles and no vendor profile was imported. J2 supplies P1S `256 x 256 x 250 mm` and H2D `350 x 320 x 325 mm` physical envelopes only. Nine numeric Bambu rows and the `M03` boundary are recorded. The runner fixes `--orient 0`, forces support off before digest/native work, and shares production machine/process `--load-settings` plus separate `--load-filaments` construction; no Orca measurement or automatic-pricing qualification is claimed. |
| Capability readiness | `PROPOSAL_ONLY_NOT_IMPLEMENTED` | Keep public `/health` cheap liveness and place future native slicing capability on public `/ready`. Startup qualification needs Prusa and selected-filament Orca probes, contained cleanup, state/cache/admission integration, and Docker/VPS evidence. Docker still checks `/health`; Traefik already consumes `/ready`, so a future `/ready` 503 withholds routing without making Docker unhealthy. Rolling degradation requires typed per-engine failures, anti-DoS semantics, and recovery/hysteresis; raw last-N 5xx is unsafe. |

The J0 final local image identity and aggregate remain historical evidence. The
J1C combined local aggregate passes 2213/2213 JavaScript tests and 85 Python
tests with 84 pass plus one expected Windows POSIX-permission skip. The exact
image and hosted exact-SHA rerun remain pending; owner-supplied diagnostic
evidence does not replace that final candidate proof. External production activation is outside
repository evidence and authority. See the J1 local branch-harvest record in
[`evidence/j1-calibration-branch-harvest.md`](evidence/j1-calibration-branch-harvest.md)
and the partial J1C corrective record in
[`evidence/j1c-slice-contract-corrective.md`](evidence/j1c-slice-contract-corrective.md)
and the historical J0 record in
[`evidence/j0-w2-w3-response-auth-contract.md`](evidence/j0-w2-w3-response-auth-contract.md).

## I12 Wave 3 Hostinger capacity and ingress control delta

Current classification:
`I12_API_F710_DARK_N1_VERIFIED;
OPERATOR_MAIN_7C8AEE_RESIDUAL_RECONCILIATION_COMPLETE;
CORRECTED_TRAEFIK_DARK_CUTOVER_VERIFIED; PUBLIC_ROUTE_DISABLED`.
Protected operator main `7c8aee0728fc8462c67b4c6d85636bffb7afcdf8`
passed Source `32804297840` and Image `32804297658`. The distinct deployed API
image source remains protected-main checkpoint
`f71069cb3ba5ddeb97e69ca1414a00a72a20ce28`; its exact signed digest
`sha256:d50c72bd084e14645f2c9c7b18a087317bf080a2d76cf1bc876d5e3427ae1e26`
remains healthy and dark-running on the authorized VPS at retained concurrency
one. Operator commits `7a490c150bb8c4c1ec6c22561421202152070fbc` and
`1fe89d7508f5bbd59a75256ec43722f3f19ae1c2` remain separate source
identities and did not relabel or rebuild the API image.

| Control | Current classification | Boundary |
| --- | --- | --- |
| Concurrency policy | `IMPLEMENTED_HOST_VERIFIED_AT_N1` | Default remains one; only canonical decimal 1..3 is accepted. Startup rejects invalid explicit values. Retained host value is one; broader arbitrary-workload capacity is not claimed. |
| Native-runtime quarantine | `IMPLEMENTED_AND_HOSTED_TESTED` | Admission closes synchronously, queued/new work receives shutdown, active work retains ownership until settlement, and the subscriber is released exactly once after drain. |
| Readiness freshness and cache safety | `IMPLEMENTED_AND_HOSTED_TESTED` | Protected detailed health runs fresh bounded probes without replacing the normal cache. Cached public and operations surfaces overlay live quarantine fail closed. |
| Retention serialization | `IMPLEMENTED_AND_HOSTED_TESTED` | Every concurrent post-promotion cleanup is serialized and receives its own later scan; a failed scan cannot poison the lane or let another promotion rely on a stale quota result. |
| Capacity evidence | `HOST_VERIFIED_SYNTHETIC_N1` | Bounded authenticated queue/artifact evidence and exact cleanup passed at retained N=1. Tiny synthetic mechanics do not establish arbitrary-model safety. |
| Producer credential handoff | `HOST_VERIFIED_SYNTHETIC` | A root-started helper opens exactly four canonical root:root 0600 single-link files, drops privilege, and directly execs absolute Python with four environment entries. Secret values remain outside argv and evidence. |
| Synthetic artifact cleanup | `HOST_VERIFIED_SYNTHETIC` | Producer and manifest are dynamic-service-owned; API is cleanly stopped. The exact-image non-root/network-none helper can delete only fully correlated regular artifact/marker pairs. |
| Traefik control plane | `HOST_VERIFIED_DARK_CUTOVER` | The corrected socketless/file-provider-only proxy is running and healthy. Exact ingress/private `GwPriority=1/0`, an ingress-owned IPv4 default route, no container IPv6 default route, no Docker socket/provider, and retained-old rollback were proved. |
| Read-only proxy config bind | `HOST_VERIFIED_EFFECTIVE_READ_ONLY` | Exact source/destination plus `RW=false` proves effective read-only. Docker may report empty `Mode`; literal `Mode=ro` is not required. Missing, duplicate, wrong-path, or `RW=true` binds fail closed. |
| Residual reconciliation | `COMPLETE_IDENTITY_BOUND; OLD_PROXY_RETAINED_STOPPED` | The prior failed residual set was identity-bound reconciled; the corrected resumable cutover then established the current candidate/network identities. The old proxy and root-private recovery evidence remain intentionally retained for rollback; task-owned helpers/uploads/temp paths are absent and no prune occurred. |
| Public ingress | `LISTENERS_ACTIVE; SLICER_ROUTE_DISABLED_PENDING_EXTERNAL_PROOF` | Docker owns exactly one IPv4 and one IPv6 host listener for each of 80/443 while the container networks remain IPv6-disabled. The dynamic route directory is still the exact dark sentinel; no slicer route may activate without hostname/DNS, intended caller, proxy CIDR, firewall, certificate continuity and authenticated synthetic route evidence. |
| Host runtime | `DARK_F710_N1_VERIFIED` | Exact signed digest, 999:999, internal-only bridge, no API default route, denied API/native egress, health/readiness and Prusa/Orca synthetic slices passed. |

The capacity cleanup sequence is intentionally stop-the-world for synthetic
evidence deletion: runner/postflight observation, graceful API stop, exact
exited/exit-zero/non-OOM proof, non-root exact-image cleanup, absence proof,
same-digest restart and two repeated dark gates. Cleanup success cannot convert
a failed capacity run into a pass.

The corrected Traefik candidate is running and healthy; the former dedicated
proxy is retained stopped. The slicer route remains absent, unknown HTTPS hosts
return 404 over both listener families, and ACME bytes are unchanged. Final
read-only audit `i12-final-live-audit-v1` passed 30/30 checks. This is a
successful dark cutover and identity-bound residual reconciliation, not public
route activation or full customer-production qualification.

Secrets stay in root-owned external files and are never emitted. The SSH key,
API keys, ACME content and full container environment/inspect/logs are outside
repository evidence. Existing Traefik and ACME state are retained for rollback;
engine-wide prune, broad cleanup and public fallback are forbidden.

See
[`evidence/i12-wave3-hostinger-production-qualification.md`](evidence/i12-wave3-hostinger-production-qualification.md).

## Historical I11 protected-main signed-candidate control delta

I11 completed at protected-main SHA
`65706e381b907c6ba09a8eba504af3adaacac86b`: Source `32668796239`, Image
`32668796232`, Candidate Publication `32669087688`, and automatic rehearsal
`32669484893` succeeded. The earlier corrective-pending classification retained
below is historical and superseded by those exact results and I12.

Earlier `48afd39b` documentation boundary:
`SIGNED_MAIN_CANDIDATE_VERIFIED; AUTOMATIC_REHEARSAL_CORRECTIVE_PENDING`.
Protected PR `#2` merged at main SHA
`48afd39b26a6c6ca18ec7bbd18a719c846751e26`; its exact Source/Image and signed
Candidate Publication succeeded. No rehearsal completion, deployment or
production success is claimed until the corrective exact-SHA hosted path passes.

| Control | Commit-time classification | Fail-closed boundary |
| --- | --- | --- |
| Trigger and identity | `HOSTED_VERIFIED_EXACT_MAIN` | Run `32667219964` accepted only the manual exact protected-main identity at `48afd39b…`; push/PR/merge-group/schedule/repository-dispatch paths remain rejected. |
| New publication | `HOSTED_VERIFIED_IMMUTABLE` | Run `32667219964` proved the SHA tag absent, passed the complete build-once gate, and created digest `sha256:3cea88b5…2541ea` without overwrite, mutable tag or second build. |
| Exact recovery | `PENDING_IMPLEMENTATION_VALIDATION` | `recover_exact_digest` requires exact `RECOVER_SIGNED_MAIN_CANDIDATE` and one lowercase `sha256:<64 hex>` digest. The existing tag's manifest digest and config identity must match the once-built candidate. Recovery performs no push, overwrite or delete and continues exact-digest attestation/verification only. |
| Job permissions | `PENDING_IMPLEMENTATION_VALIDATION` | Global none; preflight contents-read only; publication alone may receive contents-read, packages-write, attestations-write and OIDC-write after preflight. No SSH, deploy, environment-secret disclosure or repository-write authority. |
| GitHub environment | `LIVE_CONFIG_VERIFIED` | On 2026-08-23, `candidate-publication` ID `20443404498` has protected branches true, custom branch policies false, exactly one `branch_policy` protection rule (ID `63481958`), and no reviewer/wait-timer rules, secrets, variables or deployments. Workflow binds `deployment: false`. |
| Human approval | `HUMAN_REVIEWER_CAPABILITY_UNAVAILABLE` | `Botond1` is the sole collaborator and cannot self-approve. An empty environment-reviewer list is an explicit capability constraint, not human review. |
| Evidence and terminal status | `HOSTED_VERIFIED_PUBLISHED_NEW` | Attestations `42460061` and `42460068`, artifact `9500456840`, positive/negative verification, digest round trip and exact cleanup passed. Exact recovery remains implemented/tested but was not needed for this candidate. |
| Automatic ephemeral rehearsal | `HISTORICAL_BLOCKED_CORRECTIVE_PENDING` | At the earlier `48afd39b` boundary, run `32667607266` accepted the exact artifact, then failed before registry read/runtime because a depth-one refresh made the checkout shallow. Cleanup separately read unset runtime identity values. The non-shallow/all-empty-or-valid correction later succeeded in exact run `32669484893`. |
| Deployment/promotion | `OUT_OF_SCOPE_NO_AUTHORITY` | Both modes are candidate publication only. Mutable/release/staging/production tags, deploy, VPS/SSH, registry deletion and production changes remain forbidden. |

At that historical I11 boundary, hosted S4/S5 private-peer and I9 rollback
results were synthetic, ephemeral repository validation and did not establish
deployed callers, proxy/firewall, secret delivery, exact production digest,
Hostinger/VPS state, live readiness or production rollback. I12 now separately
adds the bounded dark-host evidence above. See
[`evidence/i11-mainline-signed-candidate.md`](evidence/i11-mainline-signed-candidate.md).

The automatic rehearsal deliberately accepts a published candidate that is an
ancestor of the then-current protected `main`: GitHub sources `workflow_run`
orchestration from the current default branch, while the job checks out the
candidate's own scripts and immutable publication artifact. A later protected
workflow-only main change can therefore orchestrate an older candidate. This is
a bounded repository-governance residual and must not be represented as an
exact deployed-workflow or production proof.

## Verified I10 mainline-governance control delta

| Control | Final classification | Evidence and remaining boundary |
| --- | --- | --- |
| Mainline validation triggers | `VERIFIED_EXACT_MAIN` | Final main SHA `8253160eef1c3e00c1e40826ec61fd97563ddd9b`; Source `32662043454` and Image `32662043476` succeeded. PR, merge-group and exact-main paths remain read-only/no-deploy. |
| Required checks | `LIVE_POLICY_VERIFIED` | Strict contexts are exactly `Validate exact source candidate (NO DEPLOY)` and `Build once, inspect, scan, and discard (NO DEPLOY)`, both bound to GitHub Actions app ID `15368`. |
| Main protection | `LIVE_POLICY_VERIFIED_WITH_UNSIGNED_GAP` | Exactly `main` is protected; PR required, admins enforced, force-push/deletion false, conversation resolution true. Merge commit only; squash/rebase false. Rulesets are empty and required signatures are not enabled. |
| Workflow token policy | `LIVE_POLICY_VERIFIED` | Default Actions workflow permission is read; Actions cannot approve pull requests. |
| Human approval | `HUMAN_REVIEWER_CAPABILITY_UNAVAILABLE` | Required approvals are zero because the sole collaborator cannot self-approve. This is not a human-review pass. |
| Deployment/publication | `VERIFIED_ABSENT_FROM_I10` | I10 added no registry, attestation, environment, SSH/VPS, deploy or production capability and ran no publication/deployment workflow. |

The unchanged
[`evidence/i10-mainline-governance.md`](evidence/i10-mainline-governance.md)
records the honest pre-merge checkpoint; the live exact-SHA/policy results above
close its intentionally pending exits without rewriting historical evidence.

## I9/S3b ephemeral staging and rollback control delta

Hosted classification:
`I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE` at code-bearing SHA
`c632a75fcb83f2dbcde93d31ef0170de095c4abd`; Source `30623957952`,
Image `30623957930`, and I9 rehearsal `30623957946` succeeded. The
classification is intentionally limited to the ephemeral runner boundary.

| Control | Repository classification | Remaining boundary |
| --- | --- | --- |
| Immutable previous/candidate pair | `HOSTED_VERIFIED_EPHEMERAL` | The manifest requires distinct lowercase GHCR manifest, config, and source identities. I9 freshly verified both SLSA/SPDX attestations for the rehearsal-only previous C6 digest and signed C7 candidate. |
| Workflow authority | `HOSTED_VERIFIED_READ_ONLY_NO_DEPLOY` | Historical I9 exact-branch push, actor, remote HEAD, ancestry and trailer passed. I11 replaces the branch trigger with protected-main Candidate Publication `workflow_run`; its automatic no-deploy rehearsal succeeded in run `32669484893`, while permissions stay global none and read-only per job. |
| Runtime identity and state | `HOSTED_VERIFIED_EPHEMERAL` | Both images resolved to `User=slicer`, shared UID/GID `999:999`, exact config IDs, internal network, no host port/default route, and run-owned `0700` writable state. |
| Meaningful readiness | `HOSTED_VERIFIED_EPHEMERAL` | Two consecutive private-peer passes proved liveness, minimal and operations readiness, fresh detailed Python/storage/native/config/pricing/retention/queue health, idle queue, and exact auth rejection. |
| Controlled failure and rollback | `HOSTED_VERIFIED_EPHEMERAL` | Candidate pricing state changed `0700 -> 0500 -> 0700`; liveness survived, readiness failed only with `STORAGE_UNSAFE`, and automatic rollback restored the exact previous digest under a new container/PID. |
| Evidence and cleanup | `HOSTED_VERIFIED_EPHEMERAL` | Exact-key bounded JSON, allowlisted upload, run-owned state/image/container/network cleanup, no prune, remote immutable digests preserved, and final fail-closed aggregation all passed. |
| Production topology/promotion | `UNVERIFIED_NOT_AUTHORIZED` | At the I9 boundary no VPS or deployed topology proof existed. I12 now separately verifies one exact dark digest, private peer, egress denial, readiness and socketless proxy; public caller/firewall/DNS/certificate, complete secret lifecycle, approval window, route activation and live public rollback remain unverified. |

The rehearsal uses only synthetic geometry and freshly generated inert,
audience-scoped credentials. Credentials and environment dumps are excluded
from evidence. Registry access is read-only; no existing digest or tag can be
overwritten or deleted. Hosted results remain commit-specific and are recorded
in
[`evidence/i9-s3b-staging-rollback-foundation.md`](evidence/i9-s3b-staging-rollback-foundation.md).

## Historical I8/S3a signed-candidate publication control delta

I8-C7 completed at exact SHA
`1fffab87960c675a053ae814d374cab331fbb14d` with successful Source run
`30592235730`, Image run `30592235708`, and Candidate Publication run
`30592235740`. Digest
`sha256:4c0439c9cbc0b52dc0bf88d47e7151ca997073108b20f9c063d614a25a1f8bb5`
is signed, attested, positively and negatively verified, and was never
deployed. Later historical `PENDING` text is superseded by this closure.

- `.github/workflows/candidate-publication.yml` retains exact-input
  `workflow_dispatch` for future default-branch integration and adds `push`
  only for `codex/i8-s3a-ghcr-signed-candidate`. Its concurrency key is
  candidate-SHA scoped with cancellation disabled.
- On push, the event adapter derives the candidate from `github.sha` and
  requires exact repository `Botond1/3D-Printer-Slicer-API`, ref
  `refs/heads/codex/i8-s3a-ghcr-signed-candidate`, actor `Botond1`, hardcoded
  registry `ghcr.io/botond1/3d-printer-slicer-api`, and exact last non-empty
  HEAD commit line
  `I8-Publication: PUBLISH_I8_SIGNED_GHCR_CANDIDATE`. It does not use author
  identity, substring matching, registry input, wildcard branches, or fallback
  confirmation.
- Manual and push paths emit identical canonical `candidate_sha`, `image_ref`,
  `discovery_tag`, and `registry_repository` outputs. Every other event,
  branch, repository, actor, trailer, SHA, or registry fails closed.
- Workflow permissions default to `contents: none`. Preflight gets only
  `contents: read`; only the publication job gets `contents: read`,
  `packages: write`, `attestations: write`, and `id-token: write`. Normal
  Source/Image validation remains without registry or attestation writes.
- The shared exact-image gate preserves
  `ONE_BUILD -> FULL_GATE_ON_THAT_IMAGE -> PUSH_THAT_EXACT_IMAGE`. Registry
  authentication and tag probing occur only after the full gate. An existing
  discovery tag is a hard stop, and no mutable/release/staging/production tag
  exists in the contract.
- Local image IDs are config identities, never registry manifest identities.
  Publication resolves a distinct lowercase registry digest, compares raw
  tag/digest manifests, verifies a single `linux/amd64` image and exact OCI
  source revision, pulls by digest after removing the local build identity,
  and proves the pulled image ID equals the gated build before recreating the
  exact local publication alias. The helper and runtime container use that
  alias, Orca uses the same independently checked image ID, and production
  Compose plus registry/signature/attestation/verification/evidence use only
  the exact digest identity.
- `actions/attest` is exact-commit pinned and would create two distinct
  digest-bound GitHub/Sigstore attestations: SLSA provenance and SPDX 2.3 SBOM.
  Verification requires GitHub API, OCI bundle, and local bounded-bundle paths,
  exact signer repository/workflow/ref/source, expected predicates, and
  negative wrong-digest/wrong-repository rejection.
- The bounded v2 evidence schema rejects tag subjects, local-ID substitution,
  malformed or mismatched digests, wrong source/build/repository/workflow/ref,
  SBOM drift, unsigned/wrong-predicate attestations, missing verification,
  incomplete pre-gates, second builds, mutable tags, cleanup loss, and final
  aggregator removal.
- The shared C4 runtime-state proof binds exact container ID and image ID,
  allowlisted state, the same positive PID in consecutive healthy observations
  before host `ps`, matching positive kernel UID/GID, and the same ready state
  after `ps`. Exact `running` status and false paused/restarting/dead flags are
  mandatory. Exit, paused, restarting, dead, unhealthy or missing health, OOM,
  state error, malformed state/PID/identity, timeout, and post-`ps` state change
  fail closed.
- Failed multipart storage callbacks do not release lifecycle ownership until
  the output file stream closes. This prevents Windows open-handle cleanup
  races while retaining the same bounded upload and HTTP deadlines.
- The bounded uploaded record may classify itself only as
  `I8_CANDIDATE_EVIDENCE_READY`. Only final enforcement after evidence upload,
  publication cleanup, and evidence cleanup may emit
  `I8_SIGNED_CANDIDATE_COMPLETE`; one-by-one mutations cover every final input,
  and both cleanup outcomes remain independently visible in failure summaries.
- Partial publication fails closed. Before a matching push the classification
  is `BLOCKED_I8_PREPUBLICATION_GATE`; after a matching push but incomplete
  attestations it is `I8_CANDIDATE_PUBLISHED_UNATTESTED`; after attestations but
  failed verification it is `I8_CANDIDATE_ATTESTATION_UNVERIFIED`. Published
  content is preserved for audit and is never overwritten, deleted, promoted,
  or deployed by this workflow.
- C4 commit `bf3e182455a99686f29450f7f1494929995ec5b5` proved that fail-closed
  boundary: Source `30588960830` and Image `30588960851` succeeded, while
  Candidate `30588960869` published digest
  `sha256:d583a13847b4f45cc947d41fd0793597d61ed75d76712479923ba0c039f37718`
  and then stopped before attestations when the exact runtime exited `78`.
- Direct source evidence makes the cause deterministic: the post-push runtime
  omitted all eight `EXPECTED_*` entrypoint variables and the matching bounded
  Docker log configuration. C5 mirrors the already-green shared invocation
  using dynamic non-root UID/GID and exact PID/memory/CPU/log/stop values.
  Mutation tests fail if any parity element is removed; no root, relaxed mode,
  timeout increase, retry, digest substitution, or cleanup weakening is added.
- The C5 wrong-digest negative proof is registry-independent: a run-owned,
  mode-restricted, bounded local file has a proved digest different from the
  published manifest, and the already positively verified local provenance
  bundle must reject it. This reaches signature subject-digest policy instead
  of conflating a nonexistent registry manifest with cryptographic rejection;
  exact cleanup includes the probe and bounded error record.
- C5 commit `5aef62386992f0dcab48b82e87c275e7dff1f291` has green Source/Image
  runs and a quarantined exact digest
  `sha256:fe546f2cd382089a167c4dff721a69bab1e5737b4da31bd0a37558f1f930f639`.
  Both attestations were created, but Candidate run `30590102061` classified
  `I8_CANDIDATE_ATTESTATION_UNVERIFIED`: the Node policy read an unbound
  `REGISTRY_DIGEST` after the verifier commands.
- C6 binds only `${{ steps.registry_push.outputs.registry_digest }}` into that
  step and makes removal mutation-sensitive. It does not weaken the signed
  subject comparison or substitute `DIGEST_REF`; every other heredoc input was
  audited as supplied.
- C6 commit `71e3a7df1972b78a7c8cc2cc03508558186027ce` has green Source run
  `30591301132` and Image run `30591301127`. Candidate run `30591301158`
  published digest
  `sha256:26df5afe5ad48062c8e1d5213b305282d9386688e1666e2ef0a56487de5e8b6c`,
  created both attestations, and passed all positive API/OCI/offline
  verifications. Both negative verifier calls returned nonzero; the step failed
  only on exact CLI diagnostic prose. Publication, canonical bundle-parent,
  and evidence cleanup succeeded.
- C7 removes diagnostic-text acceptance. Both probes reuse the full positive
  certificate, signer, source, predicate, and bundle policy; the signed offline
  subject and bundle hash are re-proved; exactly one subject dimension changes;
  both results must be nonzero independently; unused stderr goes to
  `/dev/null`. Removal and cross-dimension mutations fail closed.
- C7 local gates are green at 312/312 focused tests, 1352/1352 complete
  JavaScript tests, and 43 Python tests with 42 pass plus one expected Windows
  POSIX-permission skip. Syntax, tracked safety, instruction mirrors, whitespace,
  and zero-finding production audit gates are green. Local Docker and actionlint
  remain `NOT_RUN_ENVIRONMENT`.
- I8-C3 is exact commit
  `81872eda8d7c594ce3a12d79d4c02ecf9e26c6f3`; hosted Source run
  `30545194526` and Image run `30545194494` are `SUCCESS`, with Image artifact
  `8760548898`. Candidate Publication run `30545194754` is `FAILURE` after
  publication at `digest_roundtrip`: host `ps` reported `process ID out of
  range` after detach/immediate PID handling. The exact inspected PID is
  `UNVERIFIED`.
- The quarantined discovery tag is preserved at digest
  `sha256:362149192fec548f546cd0a9744b7e9e3cb6d487fa4a825034c26c98aa1fc736`
  and config
  `sha256:b0217aaaf15bac65f2db565e306ded40fa611e26ea3535dfe52a1d2483ae0657`.
  GitHub/OCI provenance and SBOM attestations and the candidate artifact are
  absent; hosted publication and evidence cleanup succeeded. The classification
  is `I8_CANDIDATE_PUBLISHED_UNATTESTED`.
- The C3 audit found I4's main-container validator to be the sole executable
  validation-only namespace drift. The correction accepts only the full-string,
  128-byte-bounded validation/publication forms. I2 image aliases remain exact
  dual namespace; I2 probe and I6 container/network names remain generic,
  strict, bounded, and distinct; per-run evidence/temp paths remain bounded;
  cleanup still requires exact environment references, ownership labels, and
  exact image/container/network identities. No other executable
  validation-only regex exists in the Candidate helper chain.
- The historical focused C3 lane is green at 686/686 across 12 files.
  Post-correction C4 evidence is 734/734 affected tests, full JavaScript
  1296/1296, and Python 42/43 pass with one expected Windows POSIX-permission
  skip. C5 Source run `30590102069` and Image run `30590102077` succeeded.
  Candidate run `30590102061` published and attested immutable digest
  `sha256:fe546f2cd382089a167c4dff721a69bab1e5737b4da31bd0a37558f1f930f639`,
  then failed closed because its verification step did not bind the exact
  registry digest used by a local policy check. C6 binds only that existing
  `registry_push` output, with step-local contract and mutation coverage. C6
  also corrects a direct-source-proven cleanup gap: action-created bundle files
  are accepted only as regular `attestation.json` files below canonical,
  direct-child runner-temp directories, and both each file and its exact parent
  must be removed and absent. Containment and parent-removal mutations fail
  closed. Hosted C6 proved these controls before the distinct negative
  diagnostic-text failure. C7 replacement exact-SHA hosted results are
  `PENDING` at this commit boundary.
  Local Docker is `NOT_RUN_ENVIRONMENT`. The current user authority permits
  staged corrective commits and normal non-force pushes to the existing
  candidate branch until the signed-candidate workflow is green. `main`, PR,
  merge, force-push, old-tag mutation, release/Git tag, mutable registry tag,
  deploy, and repository settings remain outside authority. Production
  readiness and external topology remain `UNVERIFIED`.
- The exact-SHA candidate workflow is the reviewed trust assumption needed to
  keep build, complete gate, push, and attestation in one job without an
  image-tar transfer.

## Historical I7/S3a immutable-candidate control delta

| Current control | Classification | Evidence and remaining boundary |
| --- | --- | --- |
| Digest-only production Compose | `IMPLEMENTED_AND_TESTED` | The separate production manifest has one internal-only API service, no build/host port/proxy, and preserves non-root, read-only, resource, logging, mount, health, and shutdown controls. The mandatory Node preflight rejects missing or noncanonical image references before Compose. |
| Exact-candidate provenance metadata | `HOSTED_VERIFIED_NO_PUSH` | Image Validation binds a bounded allowlisted JSON artifact to source SHA, workflow run/attempt/job, build inputs, local image ID and UID/GID, slicer/Swiper pins, SPDX hash, Grype 0.110.0 database build timestamp and counts, topology proofs, and successful aggregation/cleanup. Exact I7 Source run `30160486802` and Image run `30160486750` succeeded; artifact `8620145030` is retained. |
| Publication and promotion | `NOT_CREATED` / `NOT_STARTED` | The workflow does not push, sign, attest, or deploy. Registry/signature/attestation remain `NOT_CREATED`; deployed digest is `NOT_APPLICABLE_NO_PUBLISH`; S3b is `NOT_STARTED`. |
| Repository policy | `BRANCH_PROTECTION_UNVERIFIED_OR_ABSENT` | Read-only inspection found public default branch `main`, no rulesets, and the branch-protection endpoint returned 404. Actions are enabled with `allowed_actions=all`; default workflow permission is read and workflows cannot approve pull requests. Package target remains `UNVERIFIED` because the token lacked `read:packages`. |
| Deployed private-peer boundary | `UNVERIFIED` | No repository result proves the intended/denied callers, proxy hop/CIDR, secret owner/mode, exact deployed digest, firewall, egress, VPS state, or production readiness. |

The production API stays on `slicer-api-private`. A separately operated reverse
proxy can join that bridge and an approved ingress network, but it must not
offer generic forwarding, NAT, or DNS tunnelling to the API. Exact local and
historical hosted evidence is recorded in
[`evidence/i7-s3a-immutable-candidate-foundation.md`](evidence/i7-s3a-immutable-candidate-foundation.md).

## I6/S5 private-peer topology control delta

Atomic delta: `549fa4258c60b2971855e7a202e488d74427ccd4` followed
by `7dd6d73632856967824570c6e38c54b905d032b1`.
Decision: `PRIVATE_PEER_TOPOLOGY_SELECTED; ASYNC_WORKER_DEFERRED`.

| Current control | Classification | Evidence and remaining boundary |
| --- | --- | --- |
| Readiness freshness | `IMPLEMENTED_AND_TESTED` | Protected `/health/detailed` runs fresh readiness probes and then checks Python; `/ready` and `/operations/readiness` retain the bounded cache. |
| Internal-only API | `REPOSITORY_CONTRACT_SELECTED` | I6 requires one internal private bridge, no API host port/default route, and one authenticated reverse-proxy peer. |
| Peer ingress and egress denial | `REPOSITORY_CONTRACT_SELECTED` | The peer proves liveness, readiness, operations authentication and rejection. A calibrated sentinel then proves API and spawned-native DNS/TCP/UDP denial. The proxy must not provide generic forwarding, NAT, or DNS tunnelling for the API. |
| External deployment proof | `UNVERIFIED` | Intended/denied caller, proxy hop/CIDR, secret owner/mode, immutable deployed digest, and Hostinger/proxy/firewall/egress behavior require operator evidence. |

See
[`evidence/i6-s5-private-peer-topology.md`](evidence/i6-s5-private-peer-topology.md)
and
[`i6-s5-private-peer-operator-validation.md`](i6-s5-private-peer-operator-validation.md).
No repository result authorizes deployment or promotion.

## Historical I5/S4 scoped-trust and observability control delta

Exact repository baseline:
`5be7b19d13616f06504c18217e25bf95c97c6e96`.

| Current control | Classification | Evidence and remaining boundary |
| --- | --- | --- |
| Scoped active/previous credentials | `IMPLEMENTED_AND_TESTED` for repository contracts | Slice, pricing, artifact, and operations have distinct mandatory active and optional previous slots; exact route/header mapping, cross-audience rejection, fixed-digest comparison, generic startup failure, and previous-slot removal/restart revocation have deterministic tests. Production secret delivery and caller migration remain `UNVERIFIED`. |
| Finite legacy admin migration | `IMPLEMENTED_AND_TESTED` | `ADMIN_API_KEY` may replace one missing non-slice active key only when a named audience and future expiry <=90 days are valid. A configured valid admin value participates in global uniqueness even outside migration; only its exact authorized substitution self-reference is skipped. Slice, broad, expired, malformed, or duplicate material refuses startup. Default operation uses scoped keys only. |
| Protected Origin policy | `IMPLEMENTED_AND_TESTED` | Exact per-audience allowlists cover slice, protected pricing, artifacts, and operations; no-Origin services remain allowed; cross-audience, opaque, scheme/host/port drift, and OPTIONS confusion are rejected. Deployed allowlists remain `UNVERIFIED`. |
| Proxy and request identity | `IMPLEMENTED_AND_TESTED` | Proxy trust defaults false; enabled trust requires unique validated IP/CIDR peers or `loopback` and rejects wildcard/overbroad/malformed/unknown values. Nearest-untrusted-hop and spoofed-prefix cases are tested. Unsafe request IDs are replaced and the safe resolved ID is returned. Deployed CIDRs/hops remain `UNVERIFIED`. |
| Readiness and operational disclosure | `IMPLEMENTED_AND_TESTED` | Public `/health` is liveness and public `/ready` exposes only READY/NOT_READY. Operations scope protects detailed health, stable readiness reasons, and metrics. No repository result proves production readiness. |
| Structured events and metrics | `IMPLEMENTED_AND_TESTED` | Version-1 fixed event names, bounded request/job/artifact correlation, field allowlists, injection neutralization, secret/path/filename/customer-data exclusion, fixed metric enums, and output bounds have deterministic tests. Production collection, retention, access, alert routing, and thresholds remain `UNVERIFIED`. |
| Private ingress plus denied API/native egress | `IN_PROGRESS` | Exact candidate `510e6110ef5c49cd03962627210d6db114554618` passed hosted Source run `30037842766`; Image run `30037842526` failed closed on independent abort-transport and private-inspect contracts. The corrective validator reads requested loopback publication only from canonical `HostConfig.PortBindings`, proves external-default-route absence separately, retains real ingress/readiness and API/native DNS/TCP/UDP denial probes, and emits one allowlisted reason. Final exact-SHA hosted proof is pending. |

At I5, Compose remained unchanged, loopback-published, and ordinary bridge. No sidecar,
production firewall, deployed proxy, or worker isolation is invented. Docker
API 1.48 and Desktop 29 fixture differences are local portability evidence, not
production topology proof. The final candidate SHA and hosted topology result
are pending. Intended/denied
deployed caller, reverse-proxy CIDRs/hops/timeouts, host egress/firewall,
production secret source/ownership/mode/current/previous/revoked state, deployed
digest/VPS state, branch policy, S3b, and production readiness remain
`UNVERIFIED`. I6 later selected the private-peer topology and deferred the
async-worker option; these I5 results remain historical.

## I4/S2 resource and mutable-state controls

The current I4 candidate fails closed on malformed explicit resource settings,
actual upload/archive/output byte overruns, unsafe archive paths/types/links,
non-finite or out-of-range successful statistics, and invalid final artifacts.
Artifacts require contained regular-file identity plus owned metadata; active
downloads are leased and unknown, malformed, symlinked, replaced, or active
entries are never eviction authority. Pricing mutation is serialized and
memory changes only after a bounded, flushed, atomic primary-file replacement.

The container contract narrows persistent writes to root-scoped input, output,
and `configs/pricing-state`; root filesystem, application, dependencies,
binaries, profiles, and the remaining configuration are read-only to the
non-root service. `/tmp` is a restrictive bounded tmpfs. These are repository
controls, not evidence of VPS sizing, private ingress/egress, credential
delivery/rotation, or deployed identity. Active client-abort settlement is
covered; stopping the container during an active native job remains
`NOT_PROVEN_S2_ACTIVE_JOB_STOP_ORCHESTRATION`.

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
| Finite multipart parser envelope | `IMPLEMENTED_AND_TESTED` | Actual defaults are `fileSize: 524288000`, `files: 1`, `fields: 40`, `parts: 42`, `fieldNameSize: 64`, `fieldSize: 65536`, and fixed non-configurable `fieldNestingDepth: 0`; bounded overrides cannot restore infinity. Live file-first `a[b]` evidence reaches Multer `LIMIT_FIELD_NESTING`, maps to HTTP 400 / `UPLOAD_FIELD_NESTING_TOO_DEEP`, and observes cleanup. Busboy 1.6.0 retains its internal fixed `MAX_HEADER_PAIRS = 2000`; no lower application override is claimed. I3 adds a pending-local-validation Node HTTP subset; measured host/proxy/upload/resource bounds remain S2 work. |
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

## Current I1 lifecycle and workflow-security delta

The canonical current status is `I1_CHECKPOINT_BLOCKED_IMAGE`, anchored by
`995bb9de750ef2a0ebefb22d8cedf6e19c49cf48`. Its exact integrated sequence is
recorded in [`evidence/i1-s1c-s3a-integration.md`](evidence/i1-s1c-s3a-integration.md).
The dependency patch occurs once by patch ID
`5b593dee0baaa1437aedfd4892654bd90c971a4e`; duplicate `306b799` is absent.

| Current control | Classification | Local evidence and remaining boundary |
| --- | --- | --- |
| Real queue deadlines and single-settlement abort | `IMPLEMENTED_AND_TESTED` | A timer rejects the exact queued job independently of worker availability. Queue-owned signals unify deadline, request disconnect, and shutdown; timers, listeners, per-client counters, and outer settlement clean exactly once. |
| Runtime graceful shutdown | `IMPLEMENTED_AND_TESTED` | `SIGTERM`/`SIGINT` enter one single-flight lifecycle, synchronously start queue shutdown, close HTTP admission, and await both drains. New/queued jobs receive typed HTTP 503 `SLICE_QUEUE_SHUTDOWN`; active jobs are aborted but retain capacity until task settlement. |
| Native tree cancellation and command integrity | `IMPLEMENTED_AND_TESTED` | Exact argument arrays and a minimal child environment are verified. POSIX group and Windows exact-PID tree termination use bounded TERM/grace/KILL semantics. Failed termination proof deliberately retains the command/queue slot. |
| No post-abort success or artifact | `IMPLEMENTED_AND_TESTED` | Pre-abort/phase checks, abort-aware response settlement, and output custody prevent cancellation from becoming later success or artifact release; route/workspace cleanup remains awaited. |
| S3a hosted image enforcement | `BLOCKED` | Exact source commit `fd93c0b` passed Source run `29957927228` / job `89051575423`. Image run `29957927370` / job `89051576245` failed with liveness exit 1, Grype HIGH, scanner-classifier exit 1, and final-gate exit 1. Swiper 7.2.0 `GHSA-hmx5-qpq5-p643` / `CVE-2026-27212` is known, but persistent runtime liveness failure is independently unresolved. |

Mandatory local evidence is green for clean install 175, focused
runtime/queue/native 48/48, quality-focused 58/58, aggregate JavaScript 457/457
and Python 22/22, tracked syntax 86 JavaScript and 25 Python files,
runtime-stage repository safety 192 tracked/six staged, final tracked
safety 196, documentation-stage safety five staged, and offline audit zero.
Online audit is `BLOCKED_POLICY`; `actionlint` and Docker are unavailable. This
does not make the hosted image, branch policy, registry provenance, topology,
promotion, or production state green.

## Current I2 image-runtime security delta

| Control | Classification | Evidence and boundary |
| --- | --- | --- |
| Deterministic Swiper 12.1.2 in both Orca trees | `IMPLEMENTED_AND_HOSTED_TESTED` | Transactional archive/hash/source checks and a digest-pinned offline Chromium contract gate; Orca v2.3.1 URL/SHA unchanged; `GHSA-hmx5-qpq5-p643` findings=0 in the diagnostic Grype result. |
| Runtime tmpfs ownership | `ROOT_CAUSE_VERIFIED_AND_FIXED` | A/image and C/dynamic tmpfs write probes passed; B/former root-owned tmpfs failed `EACCES`; main startup failed on the same `/app/input/.slice-jobs` path. Both final mounts retain 64 MiB and `rw,nosuid,nodev,noexec` with dynamic UID/GID and `0700`. |
| Non-root runtime identity | `IMPLEMENTED_AND_HOSTED_TESTED` | Exact-image `slicer` UID/GID lookup rejects zero/malformed output; host-kernel PID credentials must match before liveness can pass. Dockerfile remains `USER slicer`; no root/chmod-777/image workaround exists. |
| Runtime liveness and evidence | `IMPLEMENTED_AND_HOSTED_TESTED` | Running and healthy are both required. Identity, bounded state/logs, SPDX, Grype, and exact four-file upload passed in Image run `30005259304`. Exact cleanup captures expected absent probes without tripping the runner's implicit Bash `errexit`; unknown inspection/removal states and the final aggregator remain fail closed. |
| Orca CLI and synthetic slice | `IMPLEMENTED_AND_HOSTED_TESTED` | Exact-image, offline, non-root Orca 2.3.1 help plus a customer-free manifold-cube slice passed in Image run `30005259304`. The gate uses the production runtime-profile generator, asserts the extrusion invariants, and checks the version, bounded regular output, Orca 2.3.1 G-code signature, and real extrusion; it does not accept a nonempty file alone. |
| Container cleanup ownership | `IMPLEMENTED_AND_HOSTED_TESTED` | Image run `30005259304` completed exact cleanup and final enforcement. The smoke captures a container ID at create time. Smoke and fallback cleanup require that ID, the immutable image ID, `io.s3a.validation-only=true`, and the exact expected-image label before removal. Name reuse or foreign labels fail closed without deleting the foreign container. |

The exact diagnostic matrix and hosted identifiers are in
[`evidence/i2-v2c-liveness-integration.md`](evidence/i2-v2c-liveness-integration.md).
Branch protection/required checks, signature/attestation, registry promotion,
S4, S3b, VPS topology, deployment, and production readiness remain
`UNVERIFIED`.

## Historical I3 service-auth and HTTP-envelope delta

I3 is based on exact commit
`6241685f1af0c0a1d4be6f1c229d66ca922fbb88` on branch
`codex/i3-s4a-service-auth-http-envelope`. The current worktree has focused
evidence but no exact implementation commit, final aggregate, or hosted
exact-SHA result. Controls below are therefore
`PENDING_LOCAL_VALIDATION`, not stage-level `VERIFIED`. I5 supersedes these S4
rows; they remain only as checkpoint history.

| I3 control | Classification at I3 | Evidence and boundary at I3 |
| --- | --- | --- |
| Separate slice-service credential | `PENDING_LOCAL_VALIDATION` | I3 required `SLICE_SERVICE_API_KEY` containing 32-256 printable-ASCII bytes and different from the then-broad admin key. I5 later replaced that startup model with four scoped active/previous audiences and finite legacy migration. |
| Authenticated slice admission order | `PENDING_LOCAL_VALIDATION` | Both routes are limiter -> `x-slicer-api-key` auth -> root-scoped workspace -> Multer -> queue -> native processing. Missing/wrong keys return exact HTTP 401 `{"success":false,"error":"Slice service authentication is required.","errorCode":"SLICE_SERVICE_AUTH_REQUIRED"}` and allocate no workspace. Supplied/configured values are SHA-256-digested before `crypto.timingSafeEqual`. |
| Slice-auth logging | `PENDING_LOCAL_VALIDATION` | I3 emitted a fixed sanitized rejection. I5 later added the bounded/redacted event and correlation vocabulary. |
| Slice browser-Origin policy | `PENDING_LOCAL_VALIDATION` | I3 isolated slice Origin behavior. I5 later completed exact slice/pricing/artifact/operations policy. |
| Node HTTP envelope | `PENDING_LOCAL_VALIDATION` | Defaults/inclusive bounds are headers timeout 60000 `[1000,60000]`, request timeout 600000 `[60000,600000]`, keep-alive timeout 5000 `[1000,60000]`, header count 2000 `[16,2000]`, connections 128 `[1,1024]`, requests/socket 100 `[1,1000]`. Invalid values fall back to defaults and headers timeout is capped at request timeout. Actual VPS capacity, proxy timeouts, total streamed upload duration, and measured CPU/RAM/disk limits remain `UNVERIFIED`. |

Focused evidence currently reports 469/469 integrated tests, 6/6 focused
Python-runner tests, 5/5 I3 mutations, and passing live HTTP assertions/repeats.
Root-scoped `input/`, `output/`, and `configs/` remain unchanged. No Docker
local build, deployment, production contact, or production proof is claimed.
See
[`evidence/i3-service-auth-and-http-envelope.md`](evidence/i3-service-auth-and-http-envelope.md).

## Assets and data classification

| Asset | Classification | Security need | Evidence |
| --- | --- | --- | --- |
| Uploaded model/CAD/archive | customer-confidential, untrusted | containment, bounded processing, cleanup | Multer and pipeline in [`slice.routes.js`](../../app/routes/slice.routes.js) / [`slice.service.js`](../../app/services/slice.service.js) |
| Generated `.gcode` / `.sl1` | customer-confidential, integrity-sensitive | authorized disclosure, correlation, retention | [`admin-output.service.js`](../../app/services/admin-output.service.js) |
| Scoped service API keys / slice-principal migration / historical admin migration | secret | non-disclosure, per-audience/principal rotation and revocation, finite migration, least privilege | [`service-auth.js`](../../app/config/service-auth.js), [`requireAudience.js`](../../app/middleware/requireAudience.js); repository validation uses inert distinct values, while external production activation is outside repository evidence and authority |
| Pricing data | business-confidential mutable state | authenticated, atomic, recoverable writes | [`pricing.service.js`](../../app/services/pricing.service.js) and repository/catalog modules |
| Slicer profiles | safety/integrity configuration | trusted, read-only to runtime where possible | [`configs`](../../configs), [`profiles.js`](../../app/services/slice/profiles.js) |
| Application/native binaries | executable trusted computing base | provenance, immutability, isolation | [`Dockerfile`](../../Dockerfile), manifests |
| Logs/request IDs | operational, may contain customer metadata | integrity, bounded content, access control | [`logger.js`](../../app/utils/logger.js), command/auth logging |

## Actors and trust boundaries

Actors include anonymous public-route clients, authenticated slice-service
callers, browser clients, authenticated admin clients, trusted reverse proxies,
repository contributors/CI, the deployment operator, and an attacker
controlling uploaded bytes or request fields.

Material trust boundaries:

1. Internet/client to Express middleware, slice-service authentication, and
   multipart parser.
2. Express process to mutable `input/`, `output/`, and `configs/` bind mounts.
3. JavaScript to Python, `trimesh`/`gmsh`, PrusaSlicer, and OrcaSlicer native
   processes via `execFile`.
4. Separate pricing, artifact, and operations key boundaries protecting their exact routes.
5. One slice-service header boundary protecting both native slicing routes,
   with an explicit mode separating the shared compatibility family from the
   WooCommerce and LeadPilot principal families.
6. Proxy-to-app boundary controlling forwarded client identity.
7. Source/lockfiles/build network to the run-local validation image. The former
   GitHub-workflow-to-mutable-VPS path is historical and has been removed from
   the repository; any external deployment path is `UNVERIFIED`.
8. API/native processing to the container network. Historical I5 evidence
   proves unrestricted egress on its ingress-capable topology; I6 selects an
   internal private-peer repository contract. I12 verifies deployed API/native
   egress denial for one exact dark digest and topology; that point-in-time proof
   must be repeated after relevant image, network or firewall changes.

## Attack surface

- `x-slicer-api-key`, multipart file name, extension, content, size, archive
  structure, and request options on service-authenticated slice routes;
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
| Malicious multipart input or field confusion | High | Historical `PARTIAL`: one `choosenFile`, extension filter, byte cap, rate limiter; current tested S1a adds finite file/field/part/name/value limits and fixed `fieldNestingDepth: 0`; I3 adds service auth before allocation and bounded Node HTTP settings | [`slice.routes.js`](../../app/routes/slice.routes.js); [`http-server.js`](../../app/services/http-server.js); live file-first nesting/auth/HTTP evidence | extension is not content validation; total streamed upload, host/proxy, and measured resource envelopes remain incomplete | S1a parser/workspace controls are locally verified; I3 HTTP/auth subsets await final aggregate; S2 owns content and measured resource closure |
| ZIP bomb, traversal, encryption, multiple/unsupported entries | High | `IMPLEMENTED_UNTESTED`: lazy entry inspection, path/entry/declared-size limits, exact one supported file | [`zip.js`](../../app/services/slice/zip.js), `inspectZipFile` | declared sizes can be deceptive; 3MF/native archives bypass this ZIP-specific guard; extraction/runtime disk not quota-bound | S2 generated archive tests, streaming/actual-byte caps, model/archive policy |
| Admin output traversal, symlink, realpath escape, TOCTOU | High | `PARTIAL`: filename extension, containment, lstat non-symlink, realpath containment | [`admin-output.service.js`](../../app/services/admin-output.service.js), `resolveValidatedOutputFile` | validate-then-open race; hard links/mount changes not addressed | S0 filesystem-helper/temp-dir tests; S2 descriptor-based or equivalent race-safe open |
| Native parser/slicer compromise | Critical | `PARTIAL`: non-root container, cap drop, PID cap | [`Dockerfile`](../../Dockerfile), [`docker-compose.yml`](../../docker-compose.yml) | runtime user owns app/config; writable mounts, shared service process, no CPU/RAM/disk/egress isolation | S2 read-only/root-owned layout and quotas; S5 isolated worker decision |
| Command injection through request data | Critical | Current `IMPLEMENTED_AND_TESTED`: centralized `execFile`, exact arrays, explicit minimal environment, and exact-tree cancellation | [`command.js`](../../app/services/slice/command.js), [`process-tree.js`](../../app/services/slice/process-tree.js), [`engine.js`](../../app/services/slice/engine.js) | executable provenance and network egress remain open; unverifiable tree termination intentionally quarantines capacity | S1c local contract verified; S3a executable provenance and S4/S5 egress remain |
| CPU/RAM/disk/PID exhaustion | Critical | `PARTIAL`: upload/ZIP caps, queue/rate bounds, real wait timers, command timeout/tree cancellation, container PID limit, and pending I3 HTTP connection/header/socket limits | constants, [`http-server.js`](../../app/services/http-server.js), [`queue-scheduler.js`](../../app/services/slice/queue-scheduler.js), Compose | 500 MB defaults are large; no measured VPS/proxy capacity, CPU/RAM/tmpfs-size/disk/output quota; fail-closed tree quarantine can consume capacity | S2 measured envelope/quotas/streaming; S5 isolation decision |
| Queue starvation, monopolization, or false timeout | High | Current `IMPLEMENTED_AND_TESTED` for FIFO/caps/deadlines/abort/counters and active-slot retention | [`queue-scheduler.js`](../../app/services/slice/queue-scheduler.js); [`slice.routes.js`](../../app/routes/slice.routes.js) | IP identity remains coarse; an unverified native tree deliberately keeps a slot occupied | S1b/S1c local contract verified; S4 proxy identity and S5 isolation remain |
| Proxy spoofing / rate-limit evasion | High | `IMPLEMENTED_UNTESTED`: forwarded headers trusted only with explicit boolean plus CIDR/name list | [`server.js`](../../app/server.js), `resolveTrustProxySetting`; [`client-ip.js`](../../app/utils/client-ip.js) | actual proxy chain/CIDRs are external and `UNVERIFIED` | S4 topology test and proxy-header matrix |
| Scoped credential compromise or brute force | Critical | Current repository candidate: distinct pricing/artifact/operations slots plus explicit shared/migration/principal-only slice modes; WooCommerce and LeadPilot rotate independently; fixed-digest comparison, protected-route throttling, exact errors, two-restart revocation, and finite migrations remain fail closed | [`service-auth.js`](../../app/config/service-auth.js), [`requireAudience.js`](../../app/middleware/requireAudience.js), route chains | final local repository aggregate and exact-image proof pass; hosted exact-SHA validation remains unverified, and external production activation is outside repository evidence and authority | Preserve the green local gates; hosted validation and external production activation require separate authority |
| Output disclosure or cross-job collision | High | `PARTIAL`: admin auth plus extension/path checks | [`system.routes.js`](../../app/routes/system.routes.js), [`common.js`](../../app/services/slice/common.js) | no job ownership, artifact ID, response correlation, TTL; millisecond same-name collision | S2 unique IDs, quotas/TTL/correlation; S4 service authorization contract |
| Cleanup residue after rejection/failure | High | Historical `PARTIAL`; current tested S1a centralizes marked-workspace cleanup after parser, queue, processing, response, and success settlement | [`workspace.js`](../../app/services/slice/workspace.js); [`slice.routes.js`](../../app/routes/slice.routes.js) | stale production deletion, abort deadlines, and final artifact retention/quota remain deferred | S1a local lifecycle verification; S1b deadline ownership; S2 retention/quota |
| Supply-chain compromise | Critical | `PARTIAL`: npm lock integrity and AppImage SHA-256 | [`package-lock.json`](../../package-lock.json), [`Dockerfile`](../../Dockerfile) | floating base/Apt/NodeSource/Python/Actions/Compose inputs; no SBOM/sign/scan/provenance | S3a verified pins/hashes, immutable image, SBOM, signing, scan |
| Log injection or confidential-data leakage | Medium | Current `IMPLEMENTED_AND_TESTED` repository controls use versioned allowlisted events, bounded identifiers/tokens, injection neutralization, secret/path/filename/customer-data exclusion, and no raw native stdout/stderr emission | [`events.js`](../../app/services/observability/events.js), [`logger.js`](../../app/utils/logger.js), [`command.js`](../../app/services/slice/command.js) | external log transport, access, retention, and deployed collector policy remain `UNVERIFIED` | S4 repository contract tested; operator/deployment evidence still required |
| Deploy/readiness/rollback failure | Critical | Historical S0 `ABSENT`: the former deploy used fixed sleep plus liveness curl; current S3a workflow is no-deploy validation only | [`deploy.yml`](../../.github/workflows/deploy.yml), [`image-validation.yml`](../../.github/workflows/image-validation.yml) | automatic deploy is removed, but no approval, immutable registry identity, signature/attestation, readiness, rollback, or verified production topology exists; hosted image validation is fail-closed red for both persistent liveness and HIGH scanning paths | S3a image/runtime and supply-chain diagnosis without weakening either gate; S4 topology; S3b only after S4 and separate explicit authorization |
| Protected pricing browser-origin policy bypass | High | `PARTIAL`: API key and admin limiter still apply; I3 makes slice/admin browser allowlists explicit and separate | [`pricing.routes.js`](../../app/routes/pricing.routes.js), [`corsPolicy.js`](../../app/middleware/corsPolicy.js) | CORS classifies `/admin/**` and slice routes but not protected pricing mutations | Complete S4 unified protected-route browser policy |

## Current unresolved promotion risks and exact exits

| Risk | Severity | Current evidence | Required exit / owner |
| --- | --- | --- | --- |
| Native Python/slicer compromise can use unintended egress if deployment drifts. | Critical | I12 verifies API/native DNS/TCP/UDP denial for the exact dark deployed digest and private topology. This remains a point-in-time proof; firewall or network drift can invalidate it. | **Public-activation gate:** re-prove the exact digest, topology, denied egress and intended/denied callers after any network/firewall change. |
| Scoped service trust is repository-tested and the dark private topology is host-verified, but public controls are incomplete. | Critical | I5 tests active/previous audiences, two-restart revocation, finite legacy migration, Origin policy, proxy identity, readiness, and observability. I12 verifies the exact dark private peer, auth rejection, digest and API/native egress; public caller/proxy CIDR, firewall, DNS/certificate and complete production secret lifecycle remain `UNVERIFIED`. | **Public route + secret lifecycle gate:** prove the intended public caller, denied unintended caller, firewall, hostname/certificate, secret ownership/mode/state and exact digest before route activation. An agent cannot grant an exception. |
| Multipart/HTTP ingress can exhaust resources beyond the application subset. | High | S1a covers bounded multipart fields and cleanup. I3 applies bounded Node header/request/keep-alive timeouts, headers, connections, and requests/socket with fallback. Actual VPS capacity/proxy timeouts, total streamed upload duration, and measured memory/disk/CPU envelopes remain unverified. | **S2:** measure and enforce host/proxy upload duration, connection/concurrency, memory, CPU, and disk envelopes under synthetic load. |
| Verified repository and dark-host evidence is not public production acceptance. | Critical | I11 completed automatic no-deploy rehearsal at run `32669484893`. I12 verifies one exact dark API digest and corrected proxy topology, but does not verify public DNS/certificate/caller/firewall, customer traffic, full secret lifecycle, monitoring/backup acceptance or a public change window. | **Public activation gate:** separately authorize and prove every remaining public control, authenticated hostname route and rollback before customer traffic. |
| An allowlist block can be misdiagnosed as a bad application key. | High | J2 separates router HTTP 403 and host-firewall TCP reset/private `J2_ALLOWLIST_DENY` from application HTTP 401 in the repository contract. Route mutation also requires one whole-rehearsal lock, protected ancestors, and strict terminal dark assertion. Live firewall/router behavior and real crash/power-loss durability are not observed. | **J2 external rehearsal gate:** prove denied and permitted sources from outside, correlate the private deny event, verify target-filesystem durability, and preserve terminal dark rollback. |

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
- Refuse startup without all required non-slice active keys and one complete
  explicit slice mode. Keep audience/principal separation, protected-route
  throttling, fixed-digest comparison, finite migration deadlines, and generic
  fail-closed configuration errors.
- Do not expose output without extension/path/symlink/realpath validation.
- Do not treat delayed expiry, upload residue, zero-stat success, timestamp
  collision, or unbounded retention as a desirable characterization.
- Never commit secrets/customer files or mutate LeadPilot from this repository.

## Verification matrix

| Property | Deterministic verification | Integration/operational verification |
| --- | --- | --- |
| Parsing/profile traversal | Node unit tests over value/options helpers and workspace containment | live synthetic multipart limits, including file-first `a[b]` rejection at fixed nesting depth 0 and zero residue |
| Stable middleware/auth errors | fake request/response unit tests plus source contract assertions | local inert-key API probe when environment exists |
| Queue safety | isolated-process FIFO/concurrency/cap/overflow/deadline/abort/shutdown tests | synthetic concurrency plus graceful-shutdown probes |
| ZIP/model bounds | generated archives and tiny self-authored geometry only | native container probes with legal fixtures |
| Admin output safety | OS-temp helper tests including symlink where supported | race-safe implementation tests after S2 |
| Native command safety | exact argument/environment, phase-abort, and tree-settlement tests | cross-platform process-tree and container probes where available |
| Supply chain | lock/hash/pin policy checks | clean image build, SBOM, scan, signature verification |
| Deployment | workflow structure and permissions checks | human-approved readiness/rollback drill; never inferred from `/health` |

## Accepted risks and non-goals for S0

S0 accepted and documented upload/queue residue and incomplete multipart bounds.
S1a now locally verifies marked-workspace cleanup and finite parser counts/sizes
with fixed `fieldNestingDepth: 0`. I1 locally verifies real queue deadlines,
single-settlement abort/shutdown, minimal subprocess environment, absolute
helper resolution, and bounded exact-tree cancellation. Fail-closed capacity
quarantine after unverified termination, output/stat weaknesses,
retention/correlation, pricing atomicity,
measured VPS/proxy/upload/resource limits, container resource gaps,
supply-chain immutability, private ingress plus denied API/native egress,
production secret delivery/ownership/mode/rollout, and production promotion,
readiness, and rollback safety remain
open. Their secure expectations and owners are in
[`hardening-plan.md`](hardening-plan.md).

S0 does not add public versions/jobs, a database/broker/object store, customer
fixtures, automatic model healing, LeadPilot integration, or production calls.
Public exposure of the slicer and an isolated async worker are decision-gated,
not implicit scope.

Delivery ownership is separated: S1b/S1c runtime contracts are integrated and
locally verified. S3a repository-only build-once/no-deploy controls are
integrated. I5 repository-tests scoped credentials, protected Origin policy,
proxy/request identity, readiness, events, and metrics, but S4 remains blocked
on simultaneous required ingress and denied API/native egress. S3b is
staging/promotion/readiness/rollback only after complete S4 evidence and
separate explicit user/owner authorization. The old
S1a/S3a manifest freeze is closed; its serialized dependency patch is integrated
once. Future manifest work still requires explicit serialized ownership and new
install/audit evidence.
