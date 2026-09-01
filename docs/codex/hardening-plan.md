# Hardening plan

## J3B native-envelope and original-dimension corrective checkpoint

Status:
`J3_OWNER_CONTAINER_MATRIX_VERIFIED_EXACT_58C0CCB;
J3B_SCHEMA_OWNER_APPROVED;
J3B_SOURCE_IMPLEMENTATION_PRESENT;
J3B_LOCAL_VALIDATION_COMPLETE;
J3B_H2D_MEASUREMENT_A_EXACT_IMAGE_VERIFIED;
J3B_LOCAL_EXACT_IMAGE_FINAL_ADMISSION_B_VERIFIED;
J3B_OWNER_PRODUCTION_IDENTICAL_CONTAINER_MATRIX_VERIFIED_DB42B93;
J3B_OWNER_SOURCE_TREE_MATCH_445_TRACKED_FILES;
J3B_MERGE_AUTHORIZED_NOT_YET_COMPLETE;
J3B_DEPLOY_NOT_AUTHORIZED;
J3B_NO_REGISTRY_NO_ROUTE_DNS_ALLOWLIST_MUTATION`.

Authorized implementation exits:

1. Emit `transform_schema: 2` on success and the full K2 HTTP 422
   `MODEL_OUT_OF_PRINTER_BOUNDS` response. Both shapes include mandatory
   `original_dimensions_available` and nullable `original_dimensions_mm`, with
   true iff a real measurement object exists and false iff null. Never use an
   oriented fallback. Treat a measurement tag as canonical only when its finite
   non-negative `height_mm == z`; a malformed tagged original degrades to
   false/null.
2. Treat oriented and final dimensions as load-bearing. Missing, non-finite, or
   non-positive values, malformed tags, and `height_mm != z` return controlled
   HTTP 422 `MODEL_DIMENSIONS_UNAVAILABLE`; successful object height remains
   unconditionally equal to final Z.
3. Map only explicit native placement/print-volume diagnostics to the full K2
   bounds 422, including orientation mode and outcome. Preserve bounded failed-
   command stdout separately from stderr. Apply the same safety net to Prusa
   exit-zero/no-artifact only when retained output contains the explicit
   diagnostic; preserve internal/missing-artifact classification otherwise.
4. Publish `r3d-profile-catalogue-v2` with physical/profile-declared
   `declared_build_volume_dimensions_mm` separate from the authoritative,
   exact-boundary-inclusive `largest_passing_dimensions_inclusive_mm`. Derive
   machine and fleet envelopes independently per engine.
5. Preserve owner-accepted P1S admission: Prusa
   `256 x 256 x 249.9 mm`, Orca `253.9 x 253.9 x 249.9 mm`. Keep Prusa's native
   X/Y edge beyond its declared physical profile `UNESTABLISHED`.
6. Provide H2D-QUOTE on both engines by deriving from P1S physics and enlarging
   only the declared bed to `350 x 320 x 325 mm`. It is quoting-only, not a
   machine-accurate H2D profile and not production H2D G-code. The plugin uses
   only `POST /prusa/slice`, so Prusa coverage is mandatory.
7. Require valid outward non-zero facet normals plus immediate native
   `prusa-slicer --info` validation for every normal fixture. Keep the deliberate
   zero-normal regression as a separate row.
8. Keep all 37 orientation HTTP cases, including `20 x 240 x 245` auto with
   zero request transform, exact `18 x 130 x 240` auto replay, preserve+X90, and
   invalid `sideways`. Admit an exact-container native-info command only as a
   bounded no-shell JSON argv template and report only its source label.
9. Guard both envelope phases through exact `/profiles`: measurement A must see
   the declared-admission catalogue and final-admission B the published
   largest-passing catalogue. Require exact K2/success response `max` and actual
   bounds `source_profile`; Prusa follows the selected layer profile, while
   Orca retains the machine rather than process profile.

Exact-image measurement A exit evidence:

- helper source `2f4cddab923863ee8a9231e26671ddd2e70444eb`;
- image ID
  `sha256:f2259f29fb1472ba695c90f664af0fe0b9a298b89f5139667a0ec8a274406fae`;
- 44/44 fixture preconditions, 10/10 brackets, and 2/2 combined corners pass;
- measured inclusive ceilings are Prusa `350 x 320 x 324.9 mm` and Orca
  `347.9 x 317.9 x 324.9 mm`; Prusa native X/Y beyond its declared quote bed
  remains `UNESTABLISHED`;
- `325 mm` at `0.3 mm` returned the full K2 HTTP 422 twice on each engine after
  the exact conjunctive last-layer classifier.

Exact local final-admission B exit evidence:

- code-bearing source `47ae13397bb4537b4bb700b8c6bf3d9648364bdc`;
- image ID
  `sha256:1f8ec16318eeda4b8f2e24a54e98e972ef22344126b324123f23f220916617a0`,
  with matching revision label, non-root `999:999`, healthy/read-only runtime,
  and a host port bound only to localhost;
- 88/88 fixture preconditions, 20/20 brackets, and 4/4 combined corners pass;
- published tuples confirmed: P1S Prusa `256/256/249.9`, P1S Orca
  `253.9/253.9/249.9`, H2D-QUOTE Prusa `350/320/324.9`, and H2D-QUOTE Orca
  `347.9/317.9/324.9`;
- catalogue 9/9 and optional Prusa digest parity run/pass;
- orientation 12/12 fixture checks, 4/4 selectors, and 37/37 HTTP cases pass;
- the legal binary zero-normal fixture returns HTTP 200 on exact J2 and exact B
  for both engines; B exposes schema-2 false/null original provenance;
- exact B Orca `253 x 253 x 20 mm`, preserve, layer `0.3` reports `456.33 g`,
  while the `249 x 100 x 20 mm` outer-wall G-code footprint matches J2 at
  `248.600 x 99.600 mm`, 500 segments, and bounds `x=3.700..252.300`,
  `y=78.200..177.800`.

Completed local exit: the focused/aggregate, syntax, repository-safety, and
evidence gates passed without shortening the matrix.

Completed owner VPS exit:

1. The owner ran the full corrective matrix in a production-identical VPS
   container from exact tree `db42b93b2416ac0b791a45a0eae1233b303cf557`
   after independently matching all 445 tracked files. The separate owner image
   ID differs from local B, so only source-tree identity is claimed.
2. All published P1S/H2D-QUOTE boundary values passed inclusively on all four
   selectors and the next tested Orca/P1S and Orca/H2D edges returned full K2
   HTTP 422 instead of native 500. P1S Z `249.9` passed and `250.0` rejected;
   H2D-QUOTE Z `324.9` passed on both engines.
3. The zero-normal false/null branch, applied/preserved/unchanged orientation
   outcomes, `456.33 g` Orca mass, `248.60 x 99.60 mm` no-yaw footprint, and
   all three enlarged Prusa layer profiles were independently confirmed.
4. The catalogue exposes 18 managed profile rows and six engine-scoped derived
   resolution rows, for 24 total envelope records.

Remaining boundaries:

1. Preserve zero-customer-exposure truth: the plugin has no production
   deployment/traffic and LeadPilot slicing is not enabled.
2. One branch push, one PR into `main`, and that PR's merge are authorized but
   are not yet claimed complete. Deploy remains separately unauthorized. No
   registry/image publication, public-route, DNS/allowlist, production-
   container, consumer-repository, or customer-traffic action is authorized.

The current J3B owner brief explicitly authorizes this corrective schema and
catalogue wave; the historical J2.1 sequencing note below is not a blocker for
this already-authorized work. See
[`evidence/j3b-native-envelope-and-original-dimensions.md`](evidence/j3b-native-envelope-and-original-dimensions.md).

## Historical J3 orientation-visibility implementation checkpoint

Status:
`J3_SCHEMA_OWNER_APPROVED;
J3_LOCAL_SOURCE_TESTS_VERIFIED;
J3_OWNER_CONTAINER_MATRIX_VERIFIED_EXACT_58C0CCB;
J3_NO_DEPLOY_NO_ROUTE_MUTATION`.

Local source-verified exits:

1. Accept optional multipart `orientationMode`; only exact `auto` and
   `preserve` are valid. Omission defaults to `auto` so unaware callers retain
   historical behavior. Every other present value returns HTTP 400
   `INVALID_ORIENTATION_MODE`.
2. Measure source dimensions after safe conversion and before service
   orientation, then measure oriented and final geometry separately. Emit one
   complete historical first-version transform contract on success and
   `MODEL_OUT_OF_PRINTER_BOUNDS` with orientation mode/outcome, applied flag,
   automatic/requested/total Euler summaries and matrices, and all three
   dimension stages.
3. Make the 3x3 matrix authoritative for rotation only:
   `R_total = R_requested * R_automatic`, with requested X/Y/Z represented by
   `Rz * Ry * Rx`. Exclude centering, grounding, scaling, and translation.
   Require success `stats.object_height_mm` to equal final Z.
4. Produce orientation metadata through an exclusive, bounded, versioned
   workspace sidecar and accept it only after path/type/identity/shape/schema/
   finite-proper-matrix validation. Report `fallback_unmodified` with identity
   rather than inventing an automatic rotation after optimizer failure.
5. Preserve `auto` and `preserve` semantics across Prusa and Orca. `preserve`
   skips automatic rotation but retains normalization/grounding and explicit
   request transforms.
6. Close K3 from source before changing Orca: outer ZIP inspection admits
   exactly one supported source file; a multi-geometry 3MF is concatenated into
   one compound STL; one STL argument reaches the slicer and no split-to-objects
   operation is requested. Disconnected shells retain relative placement, so
   no independent multi-object packing capability is removed.
7. Retain Orca `--arrange 1` placement and `--orient 0`, and emit exactly one
   single-token `--allow-rotations=0` so whole-compound arrange yaw cannot occur
   after the authoritative matrix. Prusa adds no native rotation. The owner
   measured the exact 2.3.1 AppImage: the equals form produced real G-code with
   6.25 g; the split form failed with `No such file: 0`. The owner later passed
   the complete J3 container matrix on exact tree `58c0ccb`.
8. Provide the privacy-safe owner-VPS runner
   `tests/testing-scripts/slicing/orientation_visibility_test_runner.py` with
   asymmetric `20 x 255 x 255 mm` and all-axes-distinct
   `20 x 240 x 245 mm` fixtures. The P1S preserve-mode
   `20 x 255 x 255 mm` case is expected HTTP 422, not success.
9. Finalize the exact code-bearing SHA
   `c404326f535fcc70ba62aa923fa6652f4fba5019`. Local gates pass at 2352/2352
   JavaScript tests, 132 Python tests with 131 pass plus one expected Windows
   POSIX-permission skip, syntax over 259 JavaScript and 44 Python files, 37/37
   staged safety paths, and zero production dependency vulnerabilities.

Remaining exits:

1. The owner passed the full historical J3 Prusa/Orca, auto/preserve,
   request-rotation, success/bounds matrix on exact tree `58c0ccb`. The later
   J3B corrective owner matrix also passed on exact tree `db42b93` as recorded
   above.
2. Any hosted exact-SHA Source/Image result remains `NOT VERIFIED` unless it is
   separately run and recorded.
3. Keep deploy, registry write, public-route activation, customer traffic, and
   consumer-repository changes outside J3 authority.

See
[`evidence/j3-orientation-visibility.md`](evidence/j3-orientation-visibility.md).

## Historical J2 bounds, catalogue, network, and calibration checkpoint

Status:
`J2_LOCAL_AGGREGATE_PASS;
J2_HOSTED_BASELINE_SOURCE_IMAGE_PASS_NO_PUBLISH;
J2_LIVE_ACTIVATION_REHEARSAL_BLOCKED_NOT_RUN;
J2_NO_ROUTE_MUTATION;
J2_REHEARSAL_TERMINAL_CONTRACT_DARK;
J2_ORCA_CALIBRATION_BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER`.

The earlier catalogue and declared-envelope admission exits below are retained
as historical J2 planning evidence. The authorized J3B checkpoint above supersedes
them for current schema and admission behavior.

Implemented local candidate exits:

1. Correct Prusa FDM and Orca P1S physical bounds to
   `256 x 256 x 250 mm`, Orca H2D to `350 x 320 x 325 mm`, and the FDM
   fallback to that largest supported H2D envelope. Keep fit enforcement on
   the production per-selection bounds path and preserve the existing `1 mm`
   lower compatibility boundary pending a separate owner semantics decision.
   Prove P1S Z `230 mm`
   accepted and Z `251 mm`/`260 mm` rejected.
2. Build the public, unauthenticated `/profiles` catalogue once at startup from
   the production resolve/snapshot/runtime/bounds/filament/digest chain. Bind
   every provisional FDM row to printer and engine identities, selected
   profiles, effective digest, and envelope. Preserve a bounded generic
   `engine`, generic `slice_selector.endpoint` plus ordered
   `parameters[{name,value}]`, ordered path-free
   `profile_components[{role,basename,selector_parameter}]`, exact nullable
   component-to-selector bindings, `r3d-effective-slice-profile-v2` identity
   marker, and a historical explicit-profile source marker for profile-sourced
   X/Y/Z maxima; the
   unchanged generic `1 mm` minimum is a compatibility floor, not machine
   metadata. Keep every per-printer/
   per-engine preset row visible. Fail catalogue construction on envelope drift
   inside one technology/printer/engine. Publish a machine envelope only when
   all represented engines agree; otherwise exclude only that machine with null
   envelope and a loud cross-engine-conflict marker in both views.
   Never select a component-wise smaller conflict value. Derive one independent
   fleet maximum per present technology only from its remaining resolved, named
   machines. Keep the historical fixed payload FDM-only
   and never advertise the generic `120 x 120 x 150 mm` SLA fallback as a machine
   envelope. Emit a strong ETag/body digest and typed non-critical 503; never add
   a manual fleet-max field.
3. Render exactly one canonical private IPv4 `/32` source in the sole
   `leadpilot-only` phase. Reject a second row, every broader prefix, forwarded
   identity and `ipStrategy`; never widen the approved host to its provider-
   shared `/24`. Keep allowlist rejection visibly distinct from application HTTP 401:
   router 403 or host-firewall TCP reset plus private `J2_ALLOWLIST_DENY`.
4. Constrain activation to an external-orchestrator rehearsal. Repository-local
   gates prepare the attempt but never self-promote. Hold one inherited
   root-private FD9 lock across every action and external observation; re-prove
   canonical/root-owned/non-writable ancestor chains and finish with strict
   `--assert-router-dark`. Accept completion only after rollback and the final
   dark state are proved. Treat any
   `*_rollback_uncertain` result as `STOP/UNKNOWN`, never as dark evidence.
   Unit tests prove logical fsync-cutpoint recovery only; real process/kernel/
   power-loss durability remains external `NOT_VERIFIED`.
5. Record nine numeric Bambu references plus the `M03` P1S-boundary result.
   Keep native auto-orient disabled, force support off before calibration
   digest/native work, and reuse the production machine/process
   `--load-settings` plus separate `--load-filaments` invocation helper. Do not
   infer vendor-faithful time or pricing from the
   generic physical-envelope profiles.

Remaining exits:

1. pass the committed J2 source through hosted read-only Source/Image gates;
2. separately publish and deploy an exact J0-capable immutable image before any
   live rehearsal;
3. provide private inputs and obtain external allowed/denied-source, TLS
   issuance/renewal, rollback, and final-dark observations; stop as unknown if
   rollback cannot be proved;
4. obtain complete owner-approved P1S/H2D vendor-profile chains and rerun the
   nine Orca numeric measurements plus the `M03` boundary with Docker;
5. keep SLA outside the current FDM-only catalogue until a separate future wave
   uses owner Chitubox/Elegoo Satellite profiles, establishes truthful
   Elegoo Saturn 4 Ultra dimensions, and implements compatible `.goo`/`.ctb`
   output/parsing plus MSLA timing. Do not guess values or publish the fallback
   as a machine. Catalogue v2 can add that real SLA printer and an independent
   per-engine SLA fleet resolution without another schema-version change; the
   remediation implementation remains future work;
6. complete the mandatory J2.1 behavior-neutral decomposition below before any
   further network/route, catalogue/schema, or SLA behavior change.

The exact baseline `0dedbe1e9e4c32a0373982a45bf788cdcdb4f024` passed Source
run `32996102492` and no-push Image run `32996102426`; that is baseline-only,
not hosted J2 or deployment evidence. See
[`evidence/j2-bounds-network-calibration.md`](evidence/j2-bounds-network-calibration.md).

### Mandatory next internal slice: J2.1 behavior-neutral decomposition

The P2 decomposition guardrail currently identifies three oversized owners:
`scripts/i12-hostinger-operator-contract.js` at 2309 lines,
`app/services/slice/profile-catalogue.js` at 595 lines, and
`tests/testing-scripts/profiles/profile_catalogue_test_runner.py` at 986 lines.
This debt is not corrected through a risky late refactor inside J2. J2.1 is the
mandatory next internal behavior-neutral slice, and it must close before any
later route/network, catalogue/schema, or SLA behavior change begins.

Target module boundaries:

1. Keep `scripts/i12-hostinger-operator-contract.js` as the existing CLI and
   CommonJS export façade. Extract private allowlist parsing, bounded private-
   input metadata/readback, router validation, rendering, and staging into
   `scripts/i12-hostinger-operator/private-route-contract.js`. Extract active/
   dark directory inspection, activation, disable, fsync, retained rollback,
   and rollback-uncertain transaction handling into
   `scripts/i12-hostinger-operator/activation-transaction.js`. The façade must
   preserve its current CLI arguments, exit codes, stdout/stderr classifications,
   export names/order, and fail-closed activation/rollback sequence. Shared
   immutable route constants have one owner in the private-route module;
   transaction code imports that contract and never imports the façade.
2. Keep `app/services/slice/profile-catalogue.js` as the current service/export
   façade. Extract schema name, semantics, bounded string contracts, and entry
   identity validation into
   `app/services/slice/profile-catalogue/public-contract.js`; extract preset
   definitions, selector/component construction, entry assembly, canonical
   content hashing, and deep-freeze construction into
   `app/services/slice/profile-catalogue/preset-builder.js`; extract initialize/
   status/snapshot state into
   `app/services/slice/profile-catalogue/service-state.js`. Preserve the exact
   façade exports and dependency-injection seams. When this decomposition runs
   after J3B, preserve the public catalogue-v2 OpenAPI schema, 18-row FDM
   payload, declared-versus-largest-passing fields, per-engine resolutions,
   canonical JSON bytes, `catalogue_sha256`, ETag, ordered selector/component
   arrays, typed 503, readiness independence, and future-SLA v2 shape.
3. Keep
   `tests/testing-scripts/profiles/profile_catalogue_test_runner.py` as the CLI
   façade with the same arguments, exit code, console lines, report path, and
   evidence classification. Move pure schema/digest/envelope/fleet validators
   to
   `tests/testing-scripts/profiles/profile_catalogue_schema_validators.py`; move
   HTTP catalogue scenarios, optional Prusa digest parity, and the synthetic
   fixture to
   `tests/testing-scripts/profiles/profile_catalogue_http_scenarios.py`; move
   report rendering/writing to
   `tests/testing-scripts/profiles/profile_catalogue_report_writer.py`. Imports
   must be one-way: validators import no peer module; scenarios import validators
   and own the check record; the report writer consumes passed check records
   without importing scenarios; the façade imports and wires all three.

Execution and exit contract:

1. Before extraction, inventory the façade export keys, CLI cases, route-state
   classifications, catalogue fixture bytes/digests, Python checks, normalized
   report output, and every existing mutation. Make this the pre/post parity
   oracle; do not rewrite expected behavior to make the split pass.
2. Extract one boundary at a time. After each move, run the existing focused
   contract and mutation suites through the unchanged façade, then add only
   import-direction and direct-module ownership tests. Every pre-split mutation
   must retain a one-to-one post-split test and the same pass/fail boundary;
   zero mutations may be dropped, merged away, or reclassified.
3. For the catalogue, require exact deep equality of the OpenAPI operation and
   payload, plus identical canonical JSON, `catalogue_sha256`, and ETag for a
   fixed dependency fixture. For the operator, require identical rendered bytes,
   file-state transitions, terminal-dark/rollback-uncertain classifications,
   CLI output, and exit status. For Python, use a fixed clock to require exact
   normalized report bytes and identical optional-parity state and process exit.
4. Final J2.1 acceptance requires the focused mutation suites, full `npm test`,
   `npm run check:syntax`, `npm run check:repository-safety`,
   `npm run check:repository-safety:staged`, and the existing J2 privacy tests
   plus staged-added-line privacy scan. Syntax/safety/privacy evidence must cover
   every new module and the retained façades.
5. Exit only with no public schema/payload/digest/ETag change, no route/render/
   activation/rollback behavior change, no CLI/report/status/error/log change,
   no credential or private-input exposure, no import cycle, and no duplicated
   domain owner. Any parity drift blocks J2.1 and therefore blocks every later
   network, catalogue, and SLA behavior wave.

## J1C corrective over the J1 calibration checkpoint

Status:
`J1C_ZERO_MASS_GUARD_OWNER_SUPPLIED_VPS_PASS;
J1C_ORCA_COMMAND_AND_LAYER_RESET_LOCAL_CANDIDATE;
J1C_FINAL_COMBINED_IMAGE_RERUN_PENDING;
J1C_CAPABILITY_READINESS_PROPOSAL_ONLY;
NO_VENDOR_IMPORT; NO_EXTERNAL_PRODUCTION_AUTHORITY`.

Implemented local candidate exits:

1. After profile selection and before bounds/runtime derivation, Prusa profile
   bytes are bounded-read from canonical real paths and copied into owning job
   scratch. Orca always resolves the allowlisted versioned repository copy of
   the v2.3.1 `Custom` machine/process parent chain, rejects unknown/cyclic/name-
   or role-mismatched inheritance, removes `inherits`, and snapshots the
   flattened JSON. A Docker build gate requires canonical semantic equality
   with the exact pinned native parents. Symlinks/non-canonical sources
   and detected size growth fail closed. Bounds parsing, runtime-profile
   derivation, digest construction, and native invocation use that lineage;
   success profile metadata and bounds `source_profile` retain the original
   selected child basenames.
2. Every successful Prusa and Orca response requires
   `profiles.effective_profile_sha256`, a canonical lowercase SHA-256 over the
   effective configured machine/process/filament layers, normalized material,
   and request-independent native invocation policy while excluding request
   layer height, request infill, paths, and request/job/model identity. Prusa
   export flags, Orca's ordered machine/process settings, and optional dedicated
   filament option are composed from that policy.
3. Stable Orca runtime derivation clears `layer_gcode` and sets
   `use_relative_e_distances='1'` for consistency with each repository child
   machine's exact `layer_change_gcode='G92 E0'` override; the pinned upstream
   parent remains unchanged and these request-independent settings remain
   digest-covered. A parent-only Orca value
   mutation changes the effective digest even when the
   selected child name and overrides remain unchanged. The current J0 smoke
   accepts positive `G1 ... E` only after exact `;BEFORE_LAYER_CHANGE`, so
   prelude/purge extrusion cannot prove model-layer extrusion. This stricter
   guard has current focused/exact-image evidence and is not attributed to the
   historical I2 hosted run.
4. Before listen, both selected slicer executables' bounded `--help` output is
   parsed and cached atomically; neither initialized version is published unless
   both pass. The startup-probe runner explicitly disables slice-native events,
   outcome counters, and duration buckets. Every success and OpenAPI require
   `engine_version`; malformed or
   unavailable output fails startup. Exact-candidate-image probes returned exit
   0 with 6087 Prusa bytes and 5121 Orca bytes; `--version` returned exit 1 for
   both and is not used. The actual startup module also passed inside the
   network-disabled, non-root, read-only exact-image envelope and atomically
   published Prusa `2.8.1+linux-x64-GTK3-202409181416` and Orca `2.3.1`.
5. Orca native arguments now pass `--arrange 1` and `--orient 0` after
   preprocessing and bounds checks. Arrangement places already-rotated geometry
   onto the build plate; auto-orient remains disabled and does not replace the
   request-owned rotation. The superseded arrangement-disabled exact-image HTTP
   probe retained negative Y after an X90 origin rotation and failed with status
   206 / `Nothing to be sliced`; the earlier translated direct fixture did not
   cover this seam. Focused invocation-policy, command, and digest contracts
   cover the correction. The final network-disabled, read-only, healthy-
   container HTTP E2E passed: the existing Python optimizer yielded pre-request
   dimensions 30 x 20 x 10 mm, request rotation X90 yielded final dimensions
   30 x 10 x 20 mm, and separate WooCommerce and LeadPilot requests returned
   Orca `2.3.1`, the same lowercase digest, and original profile basenames. A
   valid WooCommerce credential only under `x-api-key` returned the exact HTTP
   401 without workspace, queue, or artifact effects; the final queue was idle
   and exact cleanup passed. Code-bearing SHA
   `ed85eec63409b7362fe05c2b99031eeb24b5b9c9` produced retained local image ID
   `sha256:66697a1ca69e13600a91481bf474d042c0f89b236ccbaf67fcf2dea8824f2c7f`.
6. Prusa INI canonicalization keeps section/key case significant to match native
   Boost semantics and rejects exact duplicate qualified keys. Runtime
   generation replaces one exact top-level request-owned key, rejects a
   duplicate top-level key, and inserts a missing `layer_height` or FDM
   `fill_density` key before the first section.
7. OpenAPI preserves `errorCode` and includes exactly the four requested
   previously omitted emitted codes: `FILE_PROCESSING_TIMEOUT`,
   `INTERNAL_PROCESSING_ERROR`, `ORCA_PROFILE_INCOMPATIBLE`, and
   `MODEL_OUT_OF_PRINTER_BOUNDS`. The adjacent review also adds the already-live
   `MODEL_DIMENSIONS_UNAVAILABLE` to only the general validation branch, closing
   its 422 `oneOf` gap without adding another requested response feature. It
   also completes the live slice HTTP 500 enum with
   `SLICE_OUTPUT_UNPARSED`, `INTERNAL_PROCESSING_ERROR`, `QUEUE_INTERNAL_ERROR`,
   `UPLOAD_STORAGE_ERROR`, and `INTERNAL_SERVER_ERROR`.
8. `MODEL_OUT_OF_PRINTER_BOUNDS` requires both
   `model_dimensions_mm.{x,y,z}` and
   `build_volume_limits_mm.{min,max,source_profile}`.
9. Slice traffic still uses only `x-slicer-api-key`. WooCommerce and LeadPilot
   have independently rotatable active/previous families; every configured
   slot is fixed-digest compared and globally unique. A configured valid
   `ADMIN_API_KEY` also participates in global uniqueness; only its exact
   authorized substitution for one missing non-slice active avoids duplicate
   self-registration.
10. `SLICE_SERVICE_AUTH_MODE` defaults to `legacy` and admits only:
   shared-active/no-principals/no-expiry `legacy`; shared-active plus both
   principal-actives and a future <=90-day
   `SLICE_SERVICE_LEGACY_MIGRATION_UNTIL` for `migration`; or both principal
   actives with shared active/previous and expiry absent for `principals`.
   During migration, shared active/previous authorize only while request time
   is strictly before expiry; principal slots continue at and after expiry and
   every resolved slot is still fixed-digest compared. Previous slots remain
   optional only with their own active. Any other mode/slot/deadline
   combination fails before listen.
11. `GET /health` and `GET /pricing` remain authentication-free. The intended
   route-activation target is `principals`. Compose remains unchanged because
   the existing `env_file` contract already passes the selected environment
   file. External production activation is outside repository evidence and
   authority.
12. Orca PLA/PETG selection now resolves a repository filament profile, snapshots
   its exact bytes, keeps machine/process under `--load-settings`, passes the
   selected snapshot separately through `--load-filaments`, and returns its
   basename plus actual diameter/density. Normalized material
   and selected filament JSON or explicit null are digest-covered. A missing or
   unsupported profile returns `filament_profile:null`, null metadata, a
   distinct digest, `hourly_rate:null`, and `stats.estimated_price_huf:null`;
   no automatic price is calculated. Focused tests cover the positive and null
   cases.
13. Strict FDM G-code metric parsing is default-on through
    `SLICE_STRICT_GCODE_METRICS=true` and requires positive time and filament
    length. OpenAPI requires nullable `material_used_g`; it is populated only by
    a direct G-code marker and never derived from length. J1C supersedes the
    earlier no-marker assumption: a missing or recognized non-positive marker
    on an optional-mass path becomes null/manual, never zero. Selected-profile
    Orca still requires positive direct grams within
    `MAX_MATERIAL_USED_GRAMS`; recognized zero remains
    `GCODE_FILAMENT_NOT_POSITIVE`, and missing or drifted mass returns bounded
    HTTP 500 `SLICE_OUTPUT_UNPARSED`. Profile-less Orca remains null/manual. The
    owner-supplied guard-only VPS diagnostic returned HTTP 200 with positive
    length and null mass/rate/price. The combined local focused set passes
    69/69; the complete local aggregate passes 2213/2213 JavaScript tests and
    85 Python tests with 84 pass plus one expected Windows POSIX-permission
    skip. The exact combined image/container and hosted reruns remain
    unverified.

Remaining gates:

1. obtain separately authorized hosted exact-SHA validation if required; the
   historical J0 final local aggregate is green at 2161/2161 JavaScript tests,
   85/85 Python tests run with 84 pass and one expected Windows POSIX-permission
   skip, 244/39 JavaScript/Python syntax files, and 405 tracked safety files;
2. preserve `principals` as the repository activation target and require the
   dark gate before any router action: sanitized readback of `principals`, both
   actives, and absent shared active/previous, expiry, and both principal
   previous slots for initial activation; one private synthetic slice per
   principal; available retired shared credentials rejected under
   `x-slicer-api-key`; a correct principal rejected under `x-api-key`; exact
   cleanup; otherwise keep the route dark. A later rotation separately proves
   every configured previous, an owner-approved removal deadline, and post-
   removal rejection. External production activation is outside repository
   evidence and authority;
3. keep W8 live calibration in its separate incomplete-vendor time/motion lane.
   No vendor profile was imported. The owner authorized later public-repository
   inclusion, but the missing include/process/filament chain and exact Orca
   2.3.1 qualification still forbid a partial import. This lane does not block
   J1C's production `--load-filaments` binding or exact child-owned
   `layer_change_gcode='G92 E0'` corrections. J2 supplies only the corrected
   P1S/H2D physical envelopes and makes the calibration helper force support
   off; the Orca measurement remains blocked by the vendor profiles and local
   Docker;
4. treat capability readiness as a separate proposal wave. Keep public
   `/health` cheap liveness and place future native capability state on public
   `/ready`. Require at least Prusa and selected-filament Orca startup probes,
   contained cleanup, readiness state/cache/admission integration, Docker/VPS
   evidence, and typed per-engine rolling failure with anti-DoS and recovery/
   hysteresis. Docker continues to check `/health` while Traefik consumes
   `/ready`; raw last-N HTTP 5xx must not drive readiness.

See the J1 local branch-harvest evidence in
[`evidence/j1-calibration-branch-harvest.md`](evidence/j1-calibration-branch-harvest.md)
and the J1C correction in
[`evidence/j1c-slice-contract-corrective.md`](evidence/j1c-slice-contract-corrective.md)
and the historical J0 contract in
[`evidence/j0-w2-w3-response-auth-contract.md`](evidence/j0-w2-w3-response-auth-contract.md).

## I12 Wave 3 Hostinger production-qualification checkpoint

Status:
`I12_API_F710_DARK_N1_VERIFIED;
OPERATOR_MAIN_7C8AEE_RESIDUAL_RECONCILIATION_COMPLETE;
CORRECTED_TRAEFIK_DARK_CUTOVER_VERIFIED; PUBLIC_ROUTE_DISABLED`.
Exact protected operator main `7c8aee0728fc8462c67b4c6d85636bffb7afcdf8`
passed Source `32804297840` and Image `32804297658`. The separate deployed API
image source checkpoint `f71069cb3ba5ddeb97e69ca1414a00a72a20ce28`
retains its green Source/Image,
signed publication, and automatic no-deploy rehearsal. Its exact signed digest
`sha256:d50c72bd084e14645f2c9c7b18a087317bf080a2d76cf1bc876d5e3427ae1e26`
is healthy and dark-running on the authorized Hostinger VPS at retained N=1.

Completed exits include concurrency/quarantine/readiness/retention controls,
bounded capacity and cleanup evidence, protected integration, signed
publication/rehearsal, exact dark deployment, retained N=1, repeated private
readiness/auth/egress, synthetic Prusa/Orca proof, protected operator-pack
integration, exact residual reconciliation, and the corrected dark Traefik
cutover. Runtime proof observed ingress/private `GwPriority=1/0`, ingress-owned
default routing, exact effective read-only config, file-provider-only operation,
IPv4 and IPv6 80/443 host listeners, and an absent public router. The old proxy
is retained stopped for rollback and ACME bytes are unchanged.

Corrective commits `7a490c150bb8c4c1ec6c22561421202152070fbc` and
`1fe89d7508f5bbd59a75256ec43722f3f19ae1c2` are not API-image sources.
They require Compose `2.33.1+`, ingress/private `gw_priority: 1/0`, top-level
ingress `internal: false`, runtime gateway/default-route proof, and effective
read-only bind proof through exact paths plus `RW=false`. The existing `f710`
API image was not relabeled, rebuilt, or republished for this operator change.

Remaining public-activation order:

1. retain the owner-reported dark deployment of the successfully published
   exact `bf5e712071e3174a67fdb22ff3794003fa3ab32b` signed digest, keep its
   image-source identity separate from the later mounted operator-pack commit
   and file hashes, and keep the public route disabled;
2. leave automatic rehearsal run `33450012850` correctly failed closed for its
   intentional `configs/` incompatibility. The owner-reported actual-host
   candidate-to-previous-to-candidate switch closes only the application
   rollback-readiness question under the runbook's dark-route substitute; it
   does not make the CI run green or prove the public route path;
3. require hostname/DNS, approved private sources, firewall, certificate
   continuity, monitoring and recovery inputs before any public activation;
4. run the J2 external-orchestrator rehearsal first with only the LeadPilot
   `/32`; prove the allowed source, denied source, distinct deny classification,
   TLS issuance/renewal, rollback, and the final dark readback. Treat rollback
   uncertainty as `STOP/UNKNOWN`, not a successful dark terminal state;
5. require the HTTP redirect to target external `:443` and prove the running
   Traefik dynamic bind source equals the executing operator pack before every
   router action; a different release is a hard stop;
6. keep the host `DOCKER-USER` second layer single-host only; any second HTTPS
   hostname requires a separately designed boundary rather than a 443-wide rule;
7. measure real workload and N=2/N=3 capacity before increasing retained
   concurrency above one;
8. reconcile the resulting evidence without claiming production completeness
   for any unverified public, monitoring, backup or recovery control.

See
[`evidence/i12-wave3-hostinger-production-qualification.md`](evidence/i12-wave3-hostinger-production-qualification.md).

## Historical I11 protected-main signed-candidate checkpoint

I11 completed at protected-main SHA
`65706e381b907c6ba09a8eba504af3adaacac86b`: Source `32668796239`, Image
`32668796232`, Candidate Publication `32669087688`, and automatic rehearsal
`32669484893` succeeded. The earlier corrective-pending status below is
historical and superseded by those exact results and I12.

Earlier `48afd39b` boundary:
`SIGNED_MAIN_CANDIDATE_VERIFIED; AUTOMATIC_REHEARSAL_CORRECTIVE_PENDING`.
Baseline `8253160eef1c3e00c1e40826ec61fd97563ddd9b` reached protected main SHA
`48afd39b26a6c6ca18ec7bbd18a719c846751e26` through PR `#2`.

I11 productizes candidate publication without creating a deployment path. Exit
criteria:

1. manual `workflow_dispatch` only from exact current protected `main`, with
   exact repository, actor, ref, requested/event/remote SHA and ancestry;
2. mutually exclusive `publish_new` and `recover_exact_digest` inputs with
   mode-bound confirmations and strict digest emptiness/format rules;
3. one `linux/amd64` build and complete Source/Image-equivalent candidate gate
   before registry login or any write;
4. exact `candidate-publication` environment readback: ID `20443404498`,
   protected branches true, custom branch policies false, exactly one
   `branch_policy` protection rule (ID `63481958`), no reviewer/wait-timer rules,
   secrets, variables or deployments, and workflow `deployment: false`; this
   configuration is live-verified on 2026-08-23;
5. new mode proves the SHA-derived tag absent and pushes only the gated image;
   recovery proves the existing tag's exact manifest digest and config identity
   match that image and performs no push, overwrite or delete;
6. both modes complete digest round trip, runtime and production-Compose
   identity, SLSA/SPDX attestations, positive/negative verification, bounded
   mode-aware evidence, upload and exact cleanup;
7. a successful protected-main Candidate Publication `workflow_run` re-proves
   the upstream run and exact single artifact, builds a dynamic distinct
   previous/current digest-only manifest, re-verifies both images' SLSA/SPDX
   attestations, completes the hardened I9 failure/automatic-rollback path, and
   uploads bounded evidence after exact cleanup with read-only permissions;
8. exact implementation SHA local gates plus hosted Source, Image, one manual
   Candidate Publication run and its automatic rehearsal are green;
9. final repository/environment/SHA/digest/attestation readback proves that no
   deploy, VPS/SSH, mutable tag, release/Git tag or production action occurred.

`Botond1` is the sole collaborator, so a required human reviewer cannot be
configured without deadlocking the environment. The empty reviewer list is
`HUMAN_REVIEWER_CAPABILITY_UNAVAILABLE`, not approval. Environment
`candidate-publication` is `LIVE_CONFIG_VERIFIED`. Source `32666929393`, Image
`32666929394`, and Candidate Publication `32667219964` succeeded; immutable
digest `sha256:3cea88b5…2541ea`, attestations `42460061`/`42460068`, and artifact
`9500456840` are verified. Automatic rehearsal `32667607266` failed closed
before registry read because its full checkout was truncated by a depth-one
fetch; its always-run cleanup independently read unset runtime identities. The
corrective exit is a non-shallow refresh plus all-empty/all-valid cleanup tuple,
followed by a green exact-SHA publication-triggered rehearsal. That final exit
remained `PENDING` at the earlier `48afd39b` boundary; later exact run
`32669484893` succeeded. No production promotion is implied.

At that I11 boundary, hosted S4/S5 topology and I9 rollback rehearsal evidence
remained ephemeral and did not prove production callers, proxy/firewall, secret
delivery, deployed digest, Hostinger/VPS state, live readiness or rollback.
I12 now separately supplies the bounded dark-host proof described above. See
[`evidence/i11-mainline-signed-candidate.md`](evidence/i11-mainline-signed-candidate.md).

## Verified I10 mainline integration and governance checkpoint

Status: `VERIFIED` at exact main SHA
`8253160eef1c3e00c1e40826ec61fd97563ddd9b`.

I10 completed all planned exits: exact I9 ancestry, PR/merge-commit integration,
Source run `32662043454`, Image run `32662043476`, and live strict policy
readback. Exactly `main` is protected. The two required GitHub Actions contexts
are `Validate exact source candidate (NO DEPLOY)` and
`Build once, inspect, scan, and discard (NO DEPLOY)`, both app ID `15368`.
Main requires a PR, includes administrators, forbids force-push/deletion,
requires conversation resolution and allows merge commits only. Squash/rebase
are disabled; rulesets are empty and required signatures are not enabled.
Actions default permission is read and Actions cannot approve pull requests.

Required approvals are zero because the sole collaborator cannot self-approve;
this remains `HUMAN_REVIEWER_CAPABILITY_UNAVAILABLE`. I10 ran no publication or
deployment workflow and never authorized registry write, deployment, VPS/SSH or
production mutation. The unchanged
[`evidence/i10-mainline-governance.md`](evidence/i10-mainline-governance.md)
is the honest commit-time checkpoint; this canonical section records its later
verified exits.

## I9/S3b ephemeral staging and rollback checkpoint

Status: `I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE`.

Exact code-bearing SHA `c632a75fcb83f2dbcde93d31ef0170de095c4abd`
passed hosted Source `30623957952`, Image `30623957930`, and I9 rehearsal
`30623957946`. This completes the repository/hosted-ephemeral foundation only;
real staging/production promotion remains `UNVERIFIED_NOT_AUTHORIZED`.

At this historical checkpoint the rehearsal workflow was exact-I9-branch
push-triggered. I11 changes the current workflow to a successful protected-main
Candidate Publication `workflow_run` and dynamically supplies the signed pair
from one exact publication artifact plus the release policy. The new automatic
path later succeeded in no-deploy run `32669484893`; it does not change the
historical I9 result or imply public production readiness.

Baseline is completed I8 SHA
`1fffab87960c675a053ae814d374cab331fbb14d`; target branch is
`codex/i9-s3b-staging-rollback-foundation`. I9 consumes the exact signed C7
digest plus a distinct C6 rehearsal-only previous digest. Both are pulled and
verified read-only; no registry, deployment, VPS, repository-setting, or
production side effect is in scope.

Exit gates for this checkpoint:

1. Exact actor/repository/ref/remote-HEAD/ancestry/final-trailer preflight.
2. Fresh tag-to-digest, manifest/config/platform/source/User and both
   SLSA/SPDX attestation proofs for previous and candidate.
3. Dynamic shared positive non-root UID/GID and exact production Compose
   identity with only run-owned `0700` writable state.
4. Two consecutive private-peer liveness, minimal readiness, operations
   readiness, fresh detailed Python/subsystem readiness, idle queue, exact auth
   rejection, and Orca synthetic-slice proofs for previous and candidate.
5. Controlled pricing-state `0700 -> 0500 -> 0700` fault where liveness stays
   up and all readiness surfaces converge to exactly `STORAGE_UNSAFE`.
6. Automatic exact-previous rollback with a distinct container/PID, repeated
   readiness/Orca proof, bounded evidence, exact cleanup, and final fail-closed
   aggregation.
7. Exact final SHA Source Validation, Image Validation, and I9 rehearsal runs
   all green.

Success may classify only
`I9_EPHEMERAL_STAGING_ROLLBACK_COMPLETE`. It does not complete real S3b
promotion: production caller/proxy/firewall/secret delivery, deployed digest,
VPS state, human approval/change window, and live rollback remain
`UNVERIFIED_NOT_AUTHORIZED`.

See
[`evidence/i9-s3b-staging-rollback-foundation.md`](evidence/i9-s3b-staging-rollback-foundation.md).

## Historical I8/S3a signed-candidate publication checkpoint

Current closure: `I8_SIGNED_CANDIDATE_COMPLETE` at
`1fffab87960c675a053ae814d374cab331fbb14d`. Source `30592235730`, Image
`30592235708`, and Candidate Publication `30592235740` succeeded. The immutable
manifest/config identities are
`sha256:4c0439c9cbc0b52dc0bf88d47e7151ca997073108b20f9c063d614a25a1f8bb5`
and
`sha256:b16f951a9701335b35b4ef248c2b1764d06c17f5e90ee6c2c2245bedc3026d42`.
The older C6/C7 pre-run narrative and open-exit list below are preserved as
historical troubleshooting context and are superseded by this closure.

Status: `IN_PROGRESS`; I8-C6 published and positively verified an attested
candidate, then failed closed only on version-specific negative-verifier
diagnostic prose. I8-C7 replaces prose coupling with one-dimension semantic
negative controls, unchanged signed-subject/bundle proof, and zero-byte
diagnostic sinks.

The I8 branch starts from exact baseline
`c9ce6c5b3e8cf767563ab46a41b3c0e0e97ce2a6`. The current committed boundary is
I8-C6 commit `71e3a7df1972b78a7c8cc2cc03508558186027ce`. Source run
`30591301132` and Image run `30591301127` are `SUCCESS`. Candidate Publication
run `30591301158` is `FAILURE` after publication, digest runtime, both
attestations, and positive API/OCI/offline verification succeeded. Both
negative verifier calls returned nonzero; only exact stderr prose matching
failed.

The quarantined discovery tag
`candidate-71e3a7df1972b78a7c8cc2cc03508558186027ce` remains at manifest digest
`sha256:26df5afe5ad48062c8e1d5213b305282d9386688e1666e2ef0a56487de5e8b6c`
and config identity
`sha256:8d4de3647161d5688688191c9eb7af301d43216ab22ce0142d0a244e00c72c82`.
Both attestations and positive verification exist; semantic negative
verification and the Candidate artifact remain incomplete. Exact publication,
bundle-parent, and evidence cleanup succeeded. The classification is
`I8_CANDIDATE_ATTESTATION_UNVERIFIED`.

Implemented on the branch:

- one shared exact-image gate for normal no-push Image Validation and Candidate
  Publication;
- a separate workflow that retains exact-input `workflow_dispatch` and adds
  `push` only for `codex/i8-s3a-ghcr-signed-candidate`;
- a fail-closed push adapter that derives `github.sha` and requires exact
  repository `Botond1/3D-Printer-Slicer-API`, ref
  `refs/heads/codex/i8-s3a-ghcr-signed-candidate`, actor `Botond1`, hardcoded
  `ghcr.io/botond1/3d-printer-slicer-api`, and exact last non-empty commit line
  `I8-Publication: PUBLISH_I8_SIGNED_GHCR_CANDIDATE`;
- canonical `candidate_sha`, `image_ref`, `discovery_tag`, and
  `registry_repository` outputs shared by both event paths;
- job-local least privilege, with registry/attestation/OIDC writes only in the
  publication job;
- build-once `linux/amd64` validation before GHCR authentication or push;
- absent-tag/no-overwrite enforcement and digest-only downstream identity;
- exact registry manifest/config/platform/source/User correlation;
- digest-pinned pull, gated image-ID equality, then one exact candidate-scoped
  local publication alias for the runtime-identity helper and container;
- exact two-namespace local helper validation for only `validation` and
  `publication`, aligned with the shared action;
- exact I4 main-container validation for only
  `s3a-(validation|publication)-<decimal-run-id>-<decimal-run-attempt>`, with a
  full-string regex and 128-byte maximum;
- alias-bound kernel identity and liveness, exact-image-ID Orca smoke, and
  digest-pinned production-Compose validation, with registry, signature,
  attestation, verification, and evidence identity also digest-pinned;
- one bounded shared runtime-state proof before both shared prepublication and
  post-push digest runtime consumers: exact container/image ID, allowlisted
  state, stable repeated positive PID before host `ps`, matching positive
  UID/GID, and post-`ps` same-state confirmation. Exact `running` status and
  false paused/restarting/dead flags are required; non-ready, malformed,
  timeout, and changed-state paths fail closed;
- transport-abort cleanup that waits for the owned upload output stream to
  close before workspace removal, with matched HTTP/application lifetime
  evidence and no timeout or retry increase;
- exact-digest SLSA provenance and SPDX 2.3 GitHub/Sigstore attestations,
  three-path positive verification, and two negative verification probes;
- bounded I8 provenance v2, explicit partial-publication classifications,
  allowlisted upload, exact cleanup, and final fail-closed aggregation. The
  evidence record stops at `I8_CANDIDATE_EVIDENCE_READY`; only final
  enforcement after upload and cleanup may claim
  `I8_SIGNED_CANDIDATE_COMPLETE`, and its summary independently exposes both
  cleanup outcomes;
- a registry-independent wrong-digest negative proof using a bounded local
  wrong-content artifact and the already verified offline bundle.

The historical focused I8-C3 lane is green at 686/686 across 12 files. C4's
post-correction affected lane is 734/734, full JavaScript is 1296/1296, and
Python is 42/43 pass with one expected Windows POSIX-permission skip, including
one-by-one final-dependency mutations. Local Docker proof is
`NOT_RUN_ENVIRONMENT`. These local results do not prove replacement-candidate
publication.

C7 local evidence is green for 312/312 focused tests, 1352/1352 complete
JavaScript tests, and 43 Python tests with 42 pass plus one expected Windows
POSIX-permission skip. Syntax passes for 173 JavaScript and 32 Python files,
tracked safety covers 307 files, and the production audit has zero findings.
Local Docker and actionlint are `NOT_RUN_ENVIRONMENT`.

Open exit gates:

1. Complete C7 local/staged safety and the post-commit exact candidate-range
   whitespace gate.
2. Create the C7 corrective commit whose last non-empty line is
   `I8-Publication: PUBLISH_I8_SIGNED_GHCR_CANDIDATE`.
3. Perform a normal non-force push to the existing I8 branch and
   prove the new remote SHA plus baseline ancestry. Do not attempt manual
   dispatch after the push.
4. Verify the push-triggered Source Validation, Image Validation, and Candidate
   Publication runs on that exact corrective SHA.
5. Record exact registry digest, digest round trip, provenance/SBOM attestation
   IDs and bundle hashes, positive and negative cryptographic verification,
   bounded artifact identity, exact cleanup, and final aggregator success.

Until all exits are green: all quarantined tags/digests are preserved
unchanged; the C7 replacement tag/digest, signature, attestations, and candidate
artifact are `PENDING` at the C7 commit boundary; deployment is `NOT_RUN`;
external topology and production readiness are `UNVERIFIED`. No `main` change,
PR, merge, force-push, old-tag mutation,
release/Git tag, mutable image tag, deploy, or repository-setting change is
authorized.
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
  expiring no more than 90 days after startup evaluation; any configured valid
  value participates in global uniqueness, with only its exact authorized
  substitution self-reference skipped;
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
| S2 - resource/state envelope | `VERIFIED_REPOSITORY_AND_HOSTED; REAL_WORKLOAD_CAPACITY_OPEN` | S1a/S1b/S1c and S3a image controls | I4 supplies bounded resource/archive/artifact/pricing/container controls; I12 retains dark N=1 | I4 exact-SHA Source/Image and full suites passed. I12 proves small synthetic N=1 mechanics on the target host. Real customer models and N=2/N=3 remain unqualified; retained concurrency stays one. |
| S3a - repository build/provenance and automatic-deploy separation | `BF5E712_SIGNED_CANDIDATE_PUBLISHED; OWNER_REPORTED_DARK_DEPLOYED; AUTOMATIC_REHEARSAL_BLOCKED_CONFIG_COMPATIBILITY` | S0.1; exact hosted I7/I8 and protected-main I10 evidence green | I8 provides build-once digest-bound GHCR publication and attestations; I10 provides strict protected-main Source/Image governance; I11 productizes manual main publication/recovery and automatic no-deploy rehearsal | Historical I11 at main SHA `65706e381b907c6ba09a8eba504af3adaacac86b` completed publication and automatic rehearsal. Exact source `bf5e712071e3174a67fdb22ff3794003fa3ab32b` passed Candidate Publication run `33449382579`; the owner separately reports its exact digest deployed dark with a later operator pack. Automatic run `33450012850` remains correctly failed closed before registry/runtime work because `configs/` differs intentionally from the fixed previous policy source. The host report does not turn that run green or relabel the image. |
| S4 - service trust and topology | `OWNER_REPORTED_CURRENT_DARK_API; PUBLIC_REHEARSAL_BLOCKED_NOT_RUN` | S1a/S1b/S1c/S2 security surfaces and S3a evidence | I5 supplies scoped trust; I6 selects the private-peer topology; I12 proves one historical exact dark host state; the deploy-preparation correction narrows activation to one canonical `/32`, external `:443`, and exact live-bind/operator-pack equality | The owner reports the exact signed BF5E712 digest healthy and ready with no API host port and the route still dark. Current repository controls distinguish network/application denial and document machine-level trust, silent address-reassignment risk, and the single-host `DOCKER-USER` limit. External TLS, allowlist/firewall, allowed/denied caller matrix, router rollback, and final-dark proof remain blocked and were not performed by this repository change. |
| S3b - staging and promotion drill | `VERIFIED_HISTORICAL_FOUNDATION; BF5E712_AUTOMATIC_REHEARSAL_BLOCKED_CONFIG_COMPATIBILITY; OWNER_REPORTED_APPLICATION_ROLLBACK_COMPLETE; J2_LIVE_ACTIVATION_BLOCKED` | signed S3a candidate and S4/S5 repository controls | Historical I9 read-only and I11 publication-triggered rehearsals are verified; the current automatic rehearsal remains failed closed; the runbook permits a separately bounded owner-host application rollback substitute while dark; J2 live route rehearsal remains separate | Automatic run `33450012850` remains failed for intentional `configs/` compatibility drift. The owner reports an actual-host candidate-to-previous-to-candidate switch with each target healthy within 15 seconds and the recovery set retained, accepted only as the dark-host application rollback substitute. It is not a source-compatibility pass, public route rehearsal, TLS/allowlist proof, or customer-traffic evidence. |
| S5 - topology/optional async worker decision | `PRIVATE_PEER_TOPOLOGY_VERIFIED_DARK; ASYNC_WORKER_DEFERRED` | I5 trust controls and S4 topology evidence | private-peer topology selected and dark-host verified; async API/worker deferred | Exact dark API/private-peer/egress and proxy gateway behavior are verified. Complete public caller, firewall, DNS/certificate, secret lifecycle and activation evidence without changing current endpoints. |

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
  revocation, finite one-audience admin migration, and stable auth errors. J0
  extends the slice audience with explicit `legacy`, finite `migration`, and
  final `principals` modes plus separate WooCommerce/LeadPilot rotation; final
  aggregate and production migration evidence remain required.
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
I4 completed the repository/hosted S2 artifact, pricing and container envelope;
I12 adds only bounded synthetic dark N=1 host evidence. I5 supplies
repository-tested scoped credentials, Origin/proxy/request identity, readiness,
events, and metrics. I6 selects the private-peer/no-host-port topology; I12
verifies one exact dark deployed digest, private peer, API/native egress denial
and corrected proxy gateway topology. Public DNS/certificate/caller/firewall,
complete secret lifecycle, monitoring/backup acceptance, route activation and
customer traffic remain separate gates. An agent cannot grant itself an
exception to those gates.

## Decision and risk log

| ID | Decision / risk | Evidence and consequence | Owner / resolution |
| --- | --- | --- | --- |
| D-001 | S0 recorded upload residue and false deadlines; S1a fixed workspace ownership and I1 adds independent queue timers. | Multer still precedes queue admission, but the route awaits safe settlement and cleanup; queued timeout no longer waits for worker availability ([project map](project-map.md)). | S1b locally verified; S2 owns the wider HTTP/resource envelope |
| D-002 | Do not characterize vulnerability outcomes as desired behavior. | Durable tests cover safe FIFO/caps/mappings, not delayed expiry, residue, collision, or zero-stat success. | All test owners |
| D-003 | Local Python path divergence was real at S0. | I1 resolves allowlisted helpers absolutely from the application module while preserving flattened `/app` image behavior. | S1c locally verified |
| D-004 | Validation CI does not protect `main` by itself. | I10 live readback now verifies strict Source/Image contexts, PR/admin/force-push/deletion/conversation policy and merge-commit-only settings on exact protected `main`. Human approval remains unavailable with one collaborator; production topology/promotion is still separate. | Keep final policy readback in release gates; add an independent reviewer only when repository membership permits; S3b production gate remains separate. |
| D-005 | Do not invent Action SHAs, image digests, Python hashes, or versions. | Provenance must be verified upstream first. | S3a build lane |
| D-006 | `/health` remains liveness in S0. | It returns status/uptime only; deploy uses it as smoke. | S3b readiness drill after S4 |
| D-007 | Pricing CORS inconsistency is not an auth bypass but remains high-risk policy drift. | API key still applies; Origin classification covers only `/admin/**`. | S4 auth/policy lane |
| D-008 | Successful outputs need explicit ownership/retention, not timestamp folklore. | No response correlation, TTL, quota, or collision resistance. | S2 artifact lane |
| D-009 | Native compromise is contained only partially. | Non-root/cap-drop/PID exist, but code/config/state and network remain writable/available. | S2/S5 |
| D-010 | Promotion to `main` was not part of S0 completion. | At S0 the workflow could deploy every `main` push. S3a has since removed that repository path without creating a replacement promotion mechanism. | S4 then separately authorized S3b promotion design |
| D-011 | S0.1 remediated the registry/audit findings, but that result alone did not complete the application mitigation for deeply nested multipart fields. | Commit `f9ed1ee6791e531670d5d7703f994bfb51986ebb` locks Multer 2.2.0 and the other verified non-major fixes, and its production audit is zero. S1a commit `e7a409566bb8795a22f38bbf9f514b42c51bda74` separately configures and live-tests fixed `limits.fieldNestingDepth: 0`. | S0.1 registry/audit remediation and S1a application mitigation locally verified |
| D-012 | Native children require both secret minimization and egress control. | I1 supplies a tested minimal environment excluding API secrets. I12 verifies API/native egress denial for one exact dark deployed digest; drift after image/network/firewall changes remains a risk. | Re-prove exact egress denial after relevant changes and before public activation. |
| D-013 | I3 established a separate slice credential; I5 superseded the wider service-trust contract and J0 separates the two slice principals. | I5 tests scoped audiences, rotation/revocation, finite admin migration, Origin/proxy/request identity, readiness, events and metrics. J0 adds explicit `legacy`/`migration`/`principals` slice modes with a <=90-day shared-key migration deadline. The final local J0 aggregate and exact-image proof pass; hosted exact-SHA validation remains unverified, and external production activation is outside repository evidence and authority. | Preserve the green local J0 gates; hosted validation and external production activation require separate authority. |
| D-014 | `fileSize` alone was not a complete multipart/HTTP resource envelope. | I4 completes bounded upload/archive/artifact/pricing/container controls. I12 proves only small synthetic N=1 host mechanics; arbitrary model duration and N=2/N=3 CPU/RAM/disk behavior remain open. | Keep N=1 until real workload and higher-concurrency envelopes are measured. |
| D-015 | A `main` push could historically deploy independently of validation CI. | S3a removed that path; I11 completes protected manual signed-candidate publication and automatic no-deploy rehearsal. I12 separately verifies one exact dark deployment and corrected proxy cutover, without public route activation. | Keep publication, dark deployment and public activation as separately authorized identities and stages. |
| D-016 | The manifest/lock freeze was limited to the S1a/S3a parallel wave. | The dependency patch is now integrated once by patch ID; duplicate `306b799` was not picked. | Future advisory work requires a new serialized owner and audit evidence |
| D-017 | Parallel lanes return evidence; the integrator owns canonical reconciliation. | I1 reconciliation supersedes historical stage status without rewriting historical evidence files. | Integrator maintains `AGENTS.md` and `docs/codex/**` after integration |
| D-018 | Graceful shutdown must drain both HTTP and queue work without early capacity release. | `SIGTERM`/`SIGINT` are single-flight; queue shutdown aborts queued/active work, closes HTTP, and awaits both drains while active slots remain owned until task settlement. | I1 runtime lifecycle locally verified |
| D-019 | A known image advisory does not explain away an independent liveness failure. | Hosted Image run `29957927370` shows both persistent liveness exit 1 and the HIGH scanner path. Swiper 7.2.0 is known, but S3a-V2C is not integrated. | S3a remains blocked; diagnose/fix both paths without weakening gates |
| D-020 | I2 separates the verified tmpfs liveness root cause from the Swiper advisory. | Exact A/B/C and main-container evidence proves root-owned tmpfs mount roots caused startup `EACCES`; V2C independently produces zero `GHSA-hmx5-qpq5-p643` findings. Dynamic nonzero UID/GID plus kernel cross-check and mode `0700` fix liveness without root or world-writable state. | I2 repository image validation closed; external policy, provenance/promotion, S4/S3b, and production evidence remain required |
| D-021 | Application defaults do not prove arbitrary host or proxy capacity. | I12 observes the target host and passes bounded small synthetic N=1 traffic, but does not qualify customer models, N=2/N=3, or final public proxy timeouts. | Retain N=1 and verify public timeouts plus real-workload capacity before increasing load. |
| D-022 | I5's loopback-published topology could not combine ingress with egress denial; I6 replaces it. | I12 verifies the selected internal API/private peer with no API host port/default route, denied API/native egress, and a socketless dual-attached proxy whose default route is ingress. | Verify intended public caller, proxy CIDR, firewall, DNS/certificate, secret lifecycle and route rollback before activation. Async worker remains deferred. |
| D-023 | Activation evidence must come from an external observer and must not collapse a network deny into application HTTP 401. | The repository contract distinguishes router 403 and host-firewall TCP reset/private `J2_ALLOWLIST_DENY` from application 401, admits exactly one canonical `/32`, targets external `:443`, and stops if the live dynamic bind belongs to another release. Success requires a proved final-dark state; `*_rollback_uncertain` is `STOP/UNKNOWN`. | The external orchestrator proves allowed/denied sources, TLS issuance/renewal, rollback, final dark readback, current address ownership, and single-host firewall scope. No caller expansion is authorized. |
