# Historical wave narrative (J0..J3B, I10..I12)

This file preserves, verbatim, the long checkpoint narrative that lived in
`README.md` and the top-level `CLAUDE.md` until 2026-09-02. It was moved here
when the Bambu Studio engine overhaul (version 3.2.0) replaced those sections
with a compact "Current contract". Nothing below was edited; some statements
are superseded by the current contract in `README.md`, `CLAUDE.md`, and
`docs/integration-guide.md`, and the per-wave evidence remains under
`docs/codex/evidence/`.

Superseded facts to keep in mind while reading:

- The service now has three engines: PrusaSlicer, OrcaSlicer, and Bambu
  Studio (`POST /bambu/slice`). The Bambu engine is the Bambu quoting
  authority; the Orca "W8 calibration blocked" status below is historical.
- `GET /profiles` now publishes 82 rows, not 18.
- Prusa FDM responses now carry a positive mass and a price; SLA responses
  are quote-only with null mass and null price.
- The HTTP keep-alive default is 95000 ms (bounded 1000..120000), not 5000.
- Price rounding is integer arithmetic (1980 s at 800 HUF/h is 440 HUF).

---

## Part 1: README.md sections as of 2026-09-01

### J3B native envelope and original-dimension corrective candidate

The J3 orientation contract passed the owner's production-identical container
matrix on the exact `58c0ccb4614c6f5dc25212403ecdb23f3c3a985c` tree,
including G-code-level proof that Orca received the effective
`--allow-rotations=0` policy. J3B does not reopen that contract. It corrects the
pre-orientation measurement regression and makes native engine acceptance
limits explicit.

`model_transform` now uses `transform_schema: 2`. Both success and the full K2
`MODEL_OUT_OF_PRINTER_BOUNDS` response always include
`original_dimensions_available` and nullable `original_dimensions_mm`:

- `original_dimensions_available: true` if and only if
  `original_dimensions_mm` came from a real pre-orientation measurement;
- `original_dimensions_available: false` if and only if
  `original_dimensions_mm` is `null`;
- oriented dimensions are never substituted for a missing original
  measurement.

The original measurement is provenance and may degrade without failing an
otherwise sliceable request. `oriented_dimensions_mm` and
`final_dimensions_mm` remain load-bearing; an unavailable/non-positive value
on either branch returns controlled HTTP 422
`MODEL_DIMENSIONS_UNAVAILABLE`. The success invariant
`stats.object_height_mm == model_transform.final_dimensions_mm.z` remains
unconditional. A tagged measurement is canonical only when its `height_mm`
equals its `z`. A malformed tagged original measurement therefore degrades to
`original_dimensions_available:false` plus `original_dimensions_mm:null`,
whereas the same malformed state in oriented/final data returns the controlled
422. A native slicer diagnostic that explicitly refuses placement or
print-volume containment maps to HTTP 422
`MODEL_OUT_OF_PRINTER_BOUNDS` with the same complete schema-v2 transform,
including `orientation_mode` and `orientation_outcome`; unrelated native
failures remain internal errors. Failed native commands preserve bounded stdout
independently from stderr, so a placement diagnostic is not hidden by an
unrelated warning. If Prusa exits zero without producing an artifact, the same
mapping is used only when its retained output explicitly reports placement
refusal; otherwise the pre-existing missing-artifact failure remains intact.

The catalogue is now `r3d-profile-catalogue-v2`. It separates
`declared_build_volume_dimensions_mm` (physical/profile metadata) from
`largest_passing_dimensions_inclusive_mm` (the authoritative inclusive
admission ceiling). The latter names the contract precisely: a model exactly
on the published value is accepted. Machine and fleet derivations are scoped
per native engine rather than merging different engine capabilities.

Owner-accepted P1S ceilings are Prusa `256 x 256 x 249.9 mm` and Orca
`253.9 x 253.9 x 249.9 mm`; the declared P1S profile remains
`256 x 256 x 250 mm`. Orca's X/Y first failure is `254.0 mm` after a
twice-reproduced `0.1 mm` sweep whose largest pass was `253.9 mm`. Prusa passes
the full declared X/Y boundary; its native edge beyond that physical profile is
`UNESTABLISHED`. One conservative Z value, `249.9 mm`, is published across
the offered `0.1`, `0.2`, and `0.3 mm` layer heights so admission does not
change when quality changes.

J3B adds the explicit `H2D-QUOTE` selector on both engines using a P1S-derived
profile enlarged to the H2D-size declared bed. This is quote-only P1S physics:
it is not hardware-faithful H2D estimation and its artifact is not production
H2D G-code. The plugin consumer uses only `POST /prusa/slice`, which is why the
Prusa profile is mandatory rather than incidental. Exact-image measurement A
used helper source `2f4cddab923863ee8a9231e26671ddd2e70444eb` and image ID
`sha256:f2259f29fb1472ba695c90f664af0fe0b9a298b89f5139667a0ec8a274406fae`.
It passed 44/44 fixture preconditions, 10/10 brackets, and 2/2 combined corners,
measuring Prusa `350 x 320 x 324.9 mm` and Orca
`347.9 x 317.9 x 324.9 mm`. At layer height `0.3 mm`, `325 mm` returned the
complete K2 HTTP 422 twice on each engine after the exact conjunctive last-layer
classifier. Prusa's native X/Y edge beyond its declared quote bed remains
`UNESTABLISHED`.

Exact local final-admission B binds code-bearing SHA
`47ae13397bb4537b4bb700b8c6bf3d9648364bdc` to image ID
`sha256:1f8ec16318eeda4b8f2e24a54e98e972ef22344126b324123f23f220916617a0`.
The revision label matched; the `999:999` container was healthy and read-only,
with its host port bound only to localhost. B passed 88/88 fixture preconditions, 20/20
largest-pass/next-rejection brackets, and 4/4 combined corners. It confirmed
the published tuples: Prusa P1S `256/256/249.9`, Orca P1S
`253.9/253.9/249.9`, Prusa H2D-QUOTE `350/320/324.9`, and Orca H2D-QUOTE
`347.9/317.9/324.9`.

Normal generated fixtures use valid outward non-zero facet normals and must
pass an immediate `prusa-slicer --info` precondition before a service row runs.
The deliberate zero-normal regression is a legal binary STL with SHA-256
`60affa17c1470817223a10f1d39475e437090d696ece969a87b06d3bf1c7721bb`.
It returned HTTP 200 on Prusa and Orca in exact J2 image
`sha256:0d81837cdd5c3b56383580eb28df799686103bb4663a9f4016e9fbc89e4e31ea`
and again in B, where schema 2 explicitly reported
`original_dimensions_available:false` and `original_dimensions_mm:null`.
The owner later passed the complete production-identical VPS matrix from exact
tree `db42b93b2416ac0b791a45a0eae1233b303cf557`, independently matching all 445
tracked files. The separately built owner image has a different identifier, so
this is source-tree and production-identical-matrix proof, not byte-identical-
image proof. The run confirmed the four published inclusive envelopes, the
full K2 422 contract for former native 500 cases, zero-normal false/null
degradation, distinct `applied`/`preserved`/`unchanged` outcomes, and the Orca
mass/no-yaw guards. Customer exposure remains zero: the plugin is not deployed
and LeadPilot slicing is disabled. One branch push, one PR into `main`, and its
merge are owner-authorized but not yet claimed complete. Deploy, registry/image
publication, production-container, route/DNS/allowlist, and consumer-repository
changes remain unauthorized. See the
[J3B evidence boundary](docs/codex/evidence/j3b-native-envelope-and-original-dimensions.md).

The J3B orientation runner now requires all 37 HTTP cases. Its restored
section-0 coverage includes `20 x 240 x 245 mm` auto with a zero request
transform, the exact `18 x 130 x 240 mm` automatic replay, that fixture in
preserve mode plus requested X90, and the invalid `sideways` request. The
native-envelope runner has separate measurement-A and final-admission-B modes;
before either sweep it requires an exact catalogue-v2 `/profiles` phase match,
and every success or K2 response must carry the expected exact `max` and
`source_profile`. Exact local B passed 12/12 orientation fixture checks, 4/4
selectors, and 37/37 HTTP rows. Catalogue validation passed 9/9, and the
optional Prusa live-slice digest parity lane was run and passed.

Two artifact checks protect against quiet Orca regressions. A preserve-mode
`253 x 253 x 20 mm` model at layer height `0.3 mm` produced `456.33 g`. For a
preserve-mode `249 x 100 x 20 mm` model, B and exact J2 produced the same outer-
wall G-code footprint: `248.600 x 99.600 mm`, 500 segments, with X bounds
`3.700..252.300` and Y bounds `78.200..177.800`. These exact local checks were
later independently reproduced by the owner VPS matrix; neither result is
deployment proof.

### Historical J3 orientation visibility and total-rotation checkpoint

Both slice endpoints accept the optional multipart field
`orientationMode=auto|preserve`. Omission defaults to `auto`, retaining the
historical stable-pose optimization for existing callers. A present value is
strict: whitespace, alternate case, blank, null-like, numeric, array, or object
forms return HTTP `400 INVALID_ORIENTATION_MODE`.

On the owner-verified J3 tree, every successful response and every
`MODEL_OUT_OF_PRINTER_BOUNDS` response carried the same complete
`model_transform` contract in its first schema version. J3B supersedes that
wire schema with `transform_schema: 2` as described above. The J3 contract
exposed orientation mode/outcome, whether automatic orientation applied a
non-identity rotation,
requested/automatic/total Euler summaries and matrices, and three distinct
dimension stages:

- `original_dimensions_mm`: after safe source-format conversion, before
  service orientation or request transforms;
- `oriented_dimensions_mm`: after `auto` orientation or `preserve`
  normalization, before requested sizing/rotation;
- `final_dimensions_mm`: after requested sizing/rotation, as passed to the
  native slicer.

The authoritative `rotation_matrix` is rotation-only. For column vectors it is
`R_total = R_requested * R_automatic`, with the requested matrix built as
`Rz * Ry * Rx`; it intentionally excludes scaling, centering, grounding, and
translation. `rotation_deg` is a canonical Euler summary of that total matrix,
not a replacement for it. On success, `stats.object_height_mm` is the final
pre-native height and equals `model_transform.final_dimensions_mm.z`.
`orientation_outcome` is `applied`, `unchanged`, `preserved`, or
`fallback_unmodified`. Bounds wording must use both mode and outcome: only
`applied` supports “does not fit even after automatic rotation”; `unchanged`
means automatic evaluation kept the pose, `preserved` identifies the submitted
pose, and `fallback_unmodified` must disclose that automatic orientation was
unavailable.

The outer ZIP path accepts exactly one supported source file. If that source
is a multi-geometry 3MF scene, conversion concatenates its geometries into one
compound STL. The API passes one STL argument and requests no split-to-objects
operation, so disconnected shells retain their relative placement instead of
becoming independently packable objects. Orca therefore keeps `--arrange 1`
for translation/placement
and `--orient 0`, but adds exactly one single-token
`--allow-rotations=0` so no later whole-compound yaw escapes the authoritative
matrix. Prusa receives the already transformed geometry and performs no native
rotation.

The exact Orca 2.3.1 flag result and the complete J3 two-engine HTTP matrix are
owner-verified on the exact `58c0ccb` production-identical container.
`--allow-rotations=0` produced real G-code with 6.25 g, while the split
`--allow-rotations 0` form failed with `No such file: 0`; the produced
preserve-mode G-code also retained the expected X/Y footprint. This historical
proof is distinct from the later owner production-identical J3B VPS matrix on
exact tree `db42b93`, which also passed. Neither wave authorizes deployment,
publication, route activation, or consumer-repository mutation.
See the [J3 evidence boundary](docs/codex/evidence/j3-orientation-visibility.md).

### Historical J2 build-volume, profile-catalogue, network, and calibration candidate

J3B supersedes J2's first catalogue resolution and raw declared admission
numbers. The paragraphs below preserve the non-catalogue J2 checkpoint; use the
J3B section and catalogue-v2 wire contract for current profile behavior.

J2 starts from protected-main SHA
`0dedbe1e9e4c32a0373982a45bf788cdcdb4f024`. The three shipped Prusa FDM
profiles and the Orca P1S profile now resolve the physical P1S envelope as
`256 x 256 x 250 mm`; the Orca H2D profile resolves
`350 x 320 x 325 mm`. FDM's fallback is the largest supported envelope,
`350 x 320 x 325 mm`, so missing height metadata cannot silently narrow a
  supported machine. The existing `1,1,1 mm` lower compatibility boundary is
  unchanged; changing it requires a separate owner semantics decision. The P1S fit
contract accepts Z `230 mm` and rejects Z `251 mm` or `260 mm`.

Public `GET /profiles` still exposes one immutable startup generation built
through the production selection/snapshot/runtime/bounds/filament/digest chain,
with strong `ETag`, body `catalogue_sha256`, conditional 304, and non-critical
typed 503 behavior. J3B updates that public generation to the engine-scoped
catalogue-v2 contract described above. The generic
`120 x 120 x 150 mm` SLA fallback remains non-machine metadata and is never
advertised. The owner-confirmed future Elegoo Saturn 4 Ultra still requires a
separate `.goo`/`.ctb` and MSLA-timing remediation wave; no dimension is
guessed.

The Hostinger contract accepts exactly one canonical private IPv4 `/32` entry
from a root-private file in the sole `leadpilot-only` phase. A second entry or
broader prefix is rejected; the provider-shared `/24` must never replace the
approved host address. Traefik evaluates the direct peer without `ipStrategy`
or forwarded-header trust. This is machine-level allowance for every process on
the shared caller host, not application identity. Because the address has no
verified reservation, rebuild or migration requires advance consumer notice
and owner re-verification before the new host is allowed. On the measured host,
an IPv4 firewall deny increments its exact counter but is caller-visible only
as a connection timeout; it does not deliver the intended TCP reset. The fixed
private `r3d-perimeter-deny: ` diagnostic identifies that path. An unlisted
source that reaches the router receives HTTP `403`, while backend rejection is
HTTP `401` `SLICE_SERVICE_AUTH_REQUIRED`; timeout, 403, and 401 are distinct
layers. The operator pack must be a real Git clone or
linked worktree; a tarball fails as `operator_pack_file_invalid`. Normalize the
root-private modes for every new release. One root-private inherited FD9 lock
spans the whole rehearsal; every action re-proves that lock and unchanged
canonical, root-owned, non-writable ancestor chains plus exact equality between
the running Traefik dynamic bind and the executing operator pack. Lock-bearing
router helpers require host Node v20.20.2; the supported container path cannot
preserve and prove the already-held host FD 9. Render targets must be canonical
absolute direct children of the private staging directory. HTTP redirects target
external `:443`, not container-internal `:8443`. The IPv4 `DOCKER-USER` second
layer is valid only while the shared Traefik serves one hostname. On this host,
IPv6 `[::]:443` is served by docker-proxy without DNAT, so IPv6 bypasses
`DOCKER-USER` and must be denied in `ip6tables INPUT`; port 80 remains
unfiltered. The exact script, Traefik-only loopback probe, and systemd unit are
versioned under `ops/hostinger/perimeter/`. Their root-private allowlist and
public-address file paths are mandatory operator inputs, and the probe's real
hostname must replace only its `.invalid` operator placeholder. Terminal acceptance uses strict
`--assert-router-dark`. Local tests prove logical fsync-cutpoint recovery, not
real process/kernel/power-loss durability. The external orchestrator must prove the
allowed/denied matrix, TLS issuance and renewal, and
`dark -> active -> dark -> active -> dark` public-route rollback. A completed
route rehearsal requires a proved final dark state; `*_rollback_uncertain` is
`STOP/UNKNOWN`, not dark evidence. Exact protected-main source
`bf5e712071e3174a67fdb22ff3794003fa3ab32b` has a signed, attested immutable
candidate. The owner first reported that exact digest running dark from a later
operator release tree with intentional mounted J2/J3/J3B configs, the
unchanged security envelope, and no API host port. Final `/health` and `/ready`
returned 200; all four P1S/H2D-QUOTE catalogue entries exposed their inclusive
values alongside the declared values; Orca
`254.0` returned schema-2 `MODEL_OUT_OF_PRINTER_BOUNDS`, while `253.9` completed
a real slice. The retained previous release and candidate each became healthy
within 15 seconds during the owner-host round trip, and the recovery set plus
pricing-state snapshot stayed intact. Automatic no-deploy run `33450012850`
remains failed closed on configs compatibility; the host round trip is accepted
application-rollback evidence, not a CI pass. A later owner-supplied record
reports exact `router_activation=PASS phase=leadpilot-only entries=1`, an issued
certificate, approved-source HTTP 200, unlisted-source HTTP 403 with
`Content-Length: 9`, body `Forbidden`, and no `Content-Type`, plus
redirect-follow completion on public 443. That plain 403 is an intentional
edge/source rejection distinct from the backend 401 application envelope. A
later owner-supplied perimeter record reports that three IPv4 `REJECT` variants
all produced a timeout while the deny counter increased; the final conntrack
original-destination/original-port-443 policy was idempotent at exactly three
IPv4 plus one IPv6 `INPUT` rule after three applications and survived a
Docker-service restart. One owner-observed normal reboot at
`2026-09-01 13:14:41` then preserved the same 3+1 policy: the host returned in
about 40 seconds, `r3d-perimeter.service` was active/enabled and reapplied the
rules, both current service containers were healthy at `t+5s`, and the API
remained on candidate-image prefix `sha256:153987840361...`. The allowed caller
returned 200 with valid TLS in 0.13 seconds, blocked IPv6 returned no response,
port 80 and ACME remained unaffected, and the loopback probe returned 403. The
retained `traefik-traefik-1` remained stopped/exit 0 with `unless-stopped` and
runtime `ports={}` and did not own 80/443. This closes the exact point-in-time
perimeter-persistence exit, without generalizing to future reboots or
crash/power-loss recovery. HTTP-01
validation succeeded with the global redirect enabled, proving issuance-path
compatibility but not forced renewal. This repository turn is documentation-only
and makes no host or route mutation. Public router rollback, monitoring,
recovery acceptance, and customer readiness remain unverified.

Calibration has nine numeric Bambu Studio reference rows plus the `M03`
P1S-overheight rejection boundary. The comparison fixes Orca at `--orient 0`,
disables support in the runtime measurement profile, and reuses the production
machine/process `--load-settings` plus separate `--load-filaments` policy. Orca measurement is
still blocked on complete owner-approved Bambu vendor profiles and an available
local Docker daemon; no automatic-pricing acceptance is claimed. See
[`docs/kalibracio-2026-08.md`](docs/kalibracio-2026-08.md) and the
[J2 evidence boundary](docs/codex/evidence/j2-bounds-network-calibration.md).

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
`use_relative_e_distances='1'`) aligned with each repository-owned child
machine's exact `layer_change_gcode='G92 E0'` override, and the request-
independent native invocation policy while excluding request-selected layer
height and infill. The Prusa export flag, Orca machine/process settings order,
and dedicated filament option are derived from that same digest-covered policy.
Prusa INI section and key case remains
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
filament bytes, loads machine plus process through `--load-settings`, and loads
the selected filament separately through `--load-filaments`.
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
null/manual-pricing path. Owner-supplied VPS evidence verifies this guard path
as HTTP 200 with positive filament length and null mass/rate/price. The combined
parser/command/profile focused set passes 69/69; the final candidate image
containing both Orca corrections still awaits an exact-image rerun.

This candidate is not deployed or a public-activation result. The retained P1S
and new H2D candidates identify as generic Marlin profiles, not verified native
Bambu profiles. A bounded historical audit parsed 11/11 supplied JSON files,
matched 11/11 declared hashes, and derived the supplied P1S as
256 x 256 x 250 mm and H2D as 350 x 320 x 325 mm, but the set is not
self-contained: 11 include templates, H2D-compatible and
0.1/0.3 BBL processes, vendor filament/parent chains, and exact Orca 2.3.1
qualification remain missing. The owner authorized later repository inclusion,
but no vendor profile was imported. This is a separate W8 time/motion
calibration lane, not a J1C blocker. Production Orca now uses dedicated
`--load-filaments`, and both repository-owned child machine profiles own exact
`layer_change_gcode='G92 E0'`. Owner-supplied mechanism evidence produced
4.12 g instead of 0.00 g. J2 now supplies the repository physical envelopes as
P1S 256 x 256 x 250 mm and H2D 350 x 320 x 325 mm. W8 live calibration remains
`BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER`.

Capability readiness is a proposal only. Public `GET /health` remains cheap
liveness, and future slicing-capability state belongs on public `GET /ready`.
Docker continues to check `/health`, while Traefik already consumes `/ready`, so
a future capability-driven 503 can withhold routing without making Docker
unhealthy. Startup Prusa plus selected-filament Orca probes and typed rolling
per-engine failure/recovery need a separate implementation and Docker/VPS
evidence; raw last-N HTTP 5xx is not a safe readiness rule. See
[`docs/codex/evidence/j1c-slice-contract-corrective.md`](docs/codex/evidence/j1c-slice-contract-corrective.md).

### Historical I12 Hostinger production-qualification checkpoint

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

At that checkpoint the deployment remained dark and the dynamic slicer router
was absent. Approved
hostname/DNS, intended public caller/CIDR, firewall acceptance, certificate
issuance/continuity, route activation, monitoring/recovery acceptance, customer
traffic, and public production completeness were unverified and separately
authorized at that checkpoint. See the historical
[`I12 evidence`](docs/codex/evidence/i12-wave3-hostinger-production-qualification.md)
and the current
[`LeadPilot-only activation evidence`](docs/codex/evidence/hostinger-leadpilot-route-activation.md).

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

## Part 2: CLAUDE.md sections as of 2026-09-01

## J3B native-envelope and original-dimension corrective candidate

- J3 itself is owner-verified on the production-identical exact `58c0ccb`
  container, including artifact-level `--allow-rotations=0` proof. Do not
  reopen that orientation contract. J3B measurement A and exact local final-
  admission B are complete. B binds code SHA
  `47ae13397bb4537b4bb700b8c6bf3d9648364bdc` to image ID
  `sha256:1f8ec16318eeda4b8f2e24a54e98e972ef22344126b324123f23f220916617a0`;
  its revision label matched and the `999:999` container was healthy, read-only,
  with its host port bound only to localhost. The owner then passed the complete
  production-identical VPS matrix from exact tree
  `db42b93b2416ac0b791a45a0eae1233b303cf557` after independently matching all
  445 tracked files. Its separately built image ID differs, so this is exact
  source-tree and production-identical-matrix proof, not byte-identical-image
  proof.
- `model_transform` is schema 2. Success and the complete K2
  `MODEL_OUT_OF_PRINTER_BOUNDS` response require both
  `original_dimensions_available` and nullable `original_dimensions_mm`.
  `true` is equivalent to a real measured object; `false` is equivalent to
  `null`. Never substitute oriented dimensions for a missing original.
  Oriented/final dimensions remain mandatory and positive; either unavailable
  branch returns controlled HTTP 422 `MODEL_DIMENSIONS_UNAVAILABLE`.
  Canonical measured data requires `height_mm == z`: a malformed tagged
  original degrades to false/null, while malformed oriented/final data returns
  that controlled 422. `stats.object_height_mm == final_dimensions_mm.z`
  remains unconditional.
- Explicit native placement/print-volume refusal maps to HTTP 422
  `MODEL_OUT_OF_PRINTER_BOUNDS` with the full schema-2 transform, including
  orientation mode/outcome. Failed commands retain bounded stdout independently
  from stderr. Prusa exit-zero/no-artifact maps through this safety net only
  with an explicit placement diagnostic; unrelated failures remain internal.
- Catalogue schema is `r3d-profile-catalogue-v2`. Preserve physical/profile
  metadata as `declared_build_volume_dimensions_mm` and use only
  `largest_passing_dimensions_inclusive_mm` as the inclusive admission
  authority. Machine/fleet derivation is engine-scoped. Accepted P1S ceilings
  are Prusa `256 x 256 x 249.9 mm` and Orca
  `253.9 x 253.9 x 249.9 mm`; Prusa's edge beyond its declared X/Y boundary is
  `UNESTABLISHED`.
- `H2D-QUOTE` exists on both engines and is a P1S-physics estimate on a
  H2D-sized declared bed, quote-only and never production H2D G-code. The
  plugin calls only `POST /prusa/slice`. Exact helper-image measurement A passed
  44/44 fixture preconditions, 10/10 brackets, and 2/2 combined corners. Its
  measured ceilings are Prusa `350 x 320 x 324.9 mm` and Orca
  `347.9 x 317.9 x 324.9 mm`; `325 mm` at `0.3 mm` returned the full K2 HTTP 422
  twice on each engine. Prusa's native X/Y edge beyond its declared quote bed
  remains `UNESTABLISHED`. Final-admission B passed 88/88 fixture preconditions,
  20/20 brackets, and 4/4 corners with all four published tuples.
- Normal generated fixtures require outward non-zero normals plus an immediate
  native `prusa-slicer --info` precondition. Keep the deliberate zero-normal
  regression separate. The orientation HTTP matrix has 37 cases, including the
  `20 x 240 x 245` zero-request auto row, exact `18 x 130 x 240` auto replay,
  preserve+X90, and invalid `sideways`. The A/B envelope sweep requires an
  exact `/profiles` phase guard and exact response `max`/`source_profile`;
  Prusa reports its selected layer INI and Orca its stable machine profile.
  Exact-container native-info uses only a bounded fixture-addressing no-shell
  JSON argv template and the report retains only its source label. Exact local B
  catalogue validation passed 9/9 with optional Prusa digest parity run/pass;
  orientation passed 12/12 fixture checks, 4/4 selectors, and 37/37 HTTP rows.
  A legal binary zero-normal regression returned HTTP 200 on both engines in
  exact J2 and B, with B schema-2 original availability false/null.
  The owner VPS run confirmed all four exact inclusive boundaries, full K2 422
  conversion for the former native 500 cases, distinct applied/preserved/
  unchanged outcomes, unchanged Orca mass/no-yaw guards, and all three enlarged
  Prusa layer profiles. Customer exposure is zero. One branch push, one PR into
  `main`, and that PR's merge are now authorized but not yet claimed complete.
  Deploy, registry/image publication, route/DNS/allowlist, production-container,
  and consumer-repository changes remain unauthorized. See
  `docs/codex/evidence/j3b-native-envelope-and-original-dimensions.md`.

## J3 orientation-visibility local source checkpoint

- J3 starts from J2 commit `9b28b95cfa9f931092044300ebfca912421bac32`.
  Its exact code-bearing SHA is
  `c404326f535fcc70ba62aa923fa6652f4fba5019`; local source gates are green.
  The owner subsequently passed the full J3 matrix on exact tree `58c0ccb`.
  Its owner-approved request field is strict `orientationMode=auto|preserve`;
  omission defaults to `auto` for compatibility, and every other present value
  returns HTTP 400 `INVALID_ORIENTATION_MODE`.
- On the historical J3 tree, success and `MODEL_OUT_OF_PRINTER_BOUNDS` shared
  the complete first-version `model_transform`; J3B supersedes its wire schema
  with `transform_schema: 2`. The orientation contract retains orientation mode and
  outcome, requested/automatic/total rotations, and original/oriented/final
  dimensions. The authoritative rotation is rotation-only and composes as
  `R_total = R_requested * R_automatic`; it does not encode centering,
  grounding, scaling, or translation. `original_dimensions_mm` is measured
  after safe source conversion and before service orientation,
  `oriented_dimensions_mm` after orientation, and `final_dimensions_mm` after
  request sizing/rotation. `stats.object_height_mm` must equal
  `model_transform.final_dimensions_mm.z`.
- `orientation_outcome` is one of `applied`, `unchanged`, `preserved`, or
  `fallback_unmodified`. Bounds wording must branch on the outcome: only
  `applied` may say the model does not fit even after automatic rotation;
  `unchanged` says automatic evaluation kept the pose, `preserved` refers to
  the submitted pose, and `fallback_unmodified` must disclose that automatic
  orientation was unavailable.
- An outer ZIP admits exactly one supported source file. If that file is a 3MF
  scene, its internal geometries are concatenated into one compound STL before
  native slicing. The API passes one STL argv and requests no split-to-objects
  operation, so disconnected shells retain their relative placement rather
  than becoming independently packable objects. Orca keeps `--arrange 1` for
  placement and
  `--orient 0`, while exactly one single-token `--allow-rotations=0` disables
  only whole-compound arrange yaw. Prusa receives the already transformed
  geometry and adds no native rotation.
- The exact Orca 2.3.1 AppImage flag shape is `OWNER_VERIFIED_INPUT`:
  `--allow-rotations=0` produced real G-code with 6.25 g, while the split
  `--allow-rotations 0` form failed with `No such file: 0`. This is not a
  current J3B candidate run. The full historical J3 HTTP matrix is owner-
  verified; the later J3B owner production-identical VPS matrix also passed on
  exact tree `db42b93`. Neither result authorizes deploy, registry write, route
  activation, or consumer-repository change. See
  `docs/codex/evidence/j3-orientation-visibility.md`.

## J2 bounds/network baseline and J3B catalogue successor

- J2 starts from protected main
  `0dedbe1e9e4c32a0373982a45bf788cdcdb4f024`. It established the
  physical/profile-declared P1S `256 x 256 x 250 mm` and H2D-sized
  `350 x 320 x 325 mm` metadata, the unchanged `1 mm` compatibility minima,
  and `MAX_MODEL_DIMENSION_MM >= 350`. J3B separates those declared values from
  the measured, inclusive admission ceiling.
- Public `GET /profiles` remains startup-built, immutable, informational, and
  independent of slicing availability. Its current
  `r3d-profile-catalogue-v2` payload contains 18 machine-bound server-owned FDM
  rows, preserves the strong `ETag`, body `catalogue_sha256`, 304 behavior, and
  typed non-critical 503 `PROFILE_CATALOGUE_UNAVAILABLE`, and never advertises
  the generic `120 x 120 x 150 mm` SLA fallback as a machine.
- Every entry exposes `declared_build_volume_dimensions_mm`,
  `declared_source_kind: profile-explicit`,
  `minimum_dimensions_inclusive_mm`, and the exact-boundary-inclusive admission
  authority `largest_passing_dimensions_inclusive_mm`. Preserve the bounded
  generic engine/selector/component shape and
  `effective_profile_identity_schema: r3d-effective-slice-profile-v2`.
  Machine and fleet resolutions are derived per technology and engine; never
  merge Prusa and Orca values, synthesize a component-wise ceiling, or add a
  manual `fleet_max`.
- The owner-confirmed future SLA printer is the Elegoo Saturn 4 Ultra, but the
  current Prusa `--export-sla` and SL1 metadata parser are incompatible with
  its `.goo`/`.ctb` artifacts and credible MSLA timing. Do not guess its build
  envelope. SLA remediation is a separate future wave using owner-supplied
  Chitubox/Elegoo Satellite profiles. A later truthful SLA row can use catalogue
  v2 without another schema-version change; no SLA row exists today.
- P1S largest-passing admission is owner-accepted as Prusa
  `256 x 256 x 249.9 mm` and Orca `253.9 x 253.9 x 249.9 mm`. Prusa's native
  X/Y edge beyond its declared physical profile remains `UNESTABLISHED`.
  H2D-QUOTE exists on both engines with P1S physics and an enlarged declared
  bed, quoting only. Measurement A established and exact local final-admission B
  confirmed Prusa `350 x 320 x 324.9 mm` and Orca
  `347.9 x 317.9 x 324.9 mm`.
- The Hostinger route preparation accepts exactly one canonical private IPv4
  `/32` row in the sole `leadpilot-only` phase. A second row, broader prefix,
  `ipStrategy`, or forwarded-header identity fails closed. The allowance is
  machine-level: every process on the shared caller host inherits it, and an
  unreserved-address reassignment silently admits the next holder unless the
  consumer reports rebuilds or migrations in advance. A caller-visible
  host-firewall timeout with an incremented deny counter and fixed private
  `r3d-perimeter-deny: ` diagnostic, router HTTP 403, and backend HTTP 401 are
  distinct layers. Every route action requires one inherited root-private FD9
  lock held across the whole rehearsal plus unchanged canonical, root-owned,
  non-writable ancestor chains and equality between the running Traefik dynamic
  bind source and the executing operator pack. HTTP redirects target external
  `:443`, never internal `:8443`; the IPv4 `DOCKER-USER` second layer is valid
  only while Traefik serves one hostname. IPv6 `[::]:443` uses docker-proxy
  without DNAT on this host and is therefore blocked in `ip6tables INPUT`, not
  `DOCKER-USER`; IPv6 port 80 remains untouched. Terminal proof uses strict
  `--assert-router-dark`; only logical fsync-cutpoint recovery is locally proved,
  while real crash/power-loss durability remains external `NOT_VERIFIED`. The
  external orchestrator must prove intended/denied callers, TLS issuance/
  renewal, and the repeated public-route activation/rollback sequence. A
  completed route rehearsal requires proven terminal dark; any
  `*_rollback_uncertain` result is `STOP/UNKNOWN`. Exact protected-main source
  `bf5e712071e3174a67fdb22ff3794003fa3ab32b` has a signed, attested candidate.
  The operator pack must be a real Git clone or linked worktree; a tarball fails
  as `operator_pack_file_invalid`. Every new release must normalize the private
  directory/file modes. Lock-bearing router helpers require host Node v20.20.2
  because the supported container path cannot preserve and prove the already-
  held host FD 9; `--render-router` requires a canonical absolute staging path.
  The owner first reported that exact digest running dark with the intentional
  mounted J2/J3/J3B configs, no API host port, final `/health` and `/ready` 200,
  and all four catalogue entries with their inclusive values alongside the declared
  values. Orca `254.0` was rejected with schema-2 bounds, and
  Orca `253.9` sliced successfully. The previous and candidate releases each
  became healthy within 15 seconds during an owner-host round trip; rollback
  assets and pricing-state stayed intact. Automatic no-deploy run `33450012850`
  remains failed closed on its fixed previous-policy `configs/` guard; the host
  round trip is accepted application-rollback evidence, not a CI pass. A later
  owner-supplied record reports exact
  `router_activation=PASS phase=leadpilot-only entries=1`, an issued
  certificate, approved-source HTTP 200, unlisted-source HTTP 403 with body
  `Forbidden` and no `Content-Type`, and redirect-follow completion on public
  443. The edge 403 is intentionally distinct from the backend 401 envelope. A
  later owner-supplied perimeter record corrects the earlier reset assumption:
  three `REJECT` variants incremented the IPv4 deny counter but produced only a
  caller timeout. The installed conntrack/original-port-443 rules remained
  idempotent at three IPv4 plus one IPv6 `INPUT` rule across three applications
  and survived a Docker-service restart. The owner then observed one normal
  reboot at `2026-09-01 13:14:41`: the perimeter service was active/enabled and
  reapplied the same 3+1 rules, both current containers were healthy at `t+5s`,
  and the API remained on candidate-image prefix `sha256:153987840361...`.
  Allowed traffic returned 200 with valid TLS in 0.13 seconds, IPv6/443 stayed
  blocked, port 80 and ACME were unaffected, and the loopback probe returned
  403. Retained `traefik-traefik-1` stayed stopped/exit 0 with
  `unless-stopped`, runtime `ports={}`, and no 80/443 listener. This closes the
  exact point-in-time perimeter-persistence exit but does not generalize to
  future reboots or crash/power-loss recovery. Exact artifacts are versioned
  under `ops/hostinger/perimeter/`; their real paths and hostname are mandatory
  operator input. Successful
  HTTP-01 alongside the redirect proves issuance compatibility, not forced
  renewal. This repository turn is documentation-only; public router rollback,
  monitoring, recovery acceptance, and customer readiness remain unverified.
  See `docs/codex/evidence/hostinger-leadpilot-route-activation.md`.
- Calibration now has nine numeric Bambu reference cases and the `M03`
  P1S-overheight rejection. Measurement fixes Orca `--orient 0`, disables
  support in the measurement-only runtime profile, and reuses the production
  machine/process `--load-settings` plus separate `--load-filaments` policy.
  Orca measurement and
  automatic-pricing acceptance remain blocked on complete approved vendor
  profiles and an available local Docker daemon.

## J1 calibration harvest over the J0 W2/W3 public contract

- J1C's guard-only diagnostic image has owner-supplied VPS proof: recognized
  `0.00 g` with positive length returns HTTP 200 and null mass/rate/price, while
  selected-profile zero and marker drift remain fail closed. The combined
  parser/Orca command/profile focused set passes 69/69; the exact final image
  containing all corrections still awaits the owner's rerun.
- Production Orca sends machine plus process through `--load-settings` and an
  optional selected filament snapshot through dedicated `--load-filaments`.
  Both repository-owned P1S/H2D children own exact
  `layer_change_gcode='G92 E0'`; pinned upstream parents remain unchanged.
  Owner-supplied mechanism evidence produced 4.12 g instead of 0.00 g. The
  incomplete vendor chain remains a separate W8 calibration lane, not a J1C
  blocker; J2 separately owns bed shape/Z. Capability readiness remains
  proposal-only on public `/ready`, while `/health` stays cheap liveness; see
  `docs/codex/evidence/j1c-slice-contract-corrective.md`.
- Every successful Prusa and Orca response requires lowercase
  `profiles.effective_profile_sha256`. After selection, bounded canonical-realpath
  Prusa bytes and the flattened, versioned repository copy of the allowlisted
  Orca v2.3.1 `Custom` parent chain are snapshotted in job scratch for bounds,
  runtime, digest, and native use. Its exact-image build equality gate passes;
  public fields retain child basenames. Stable Orca runtime settings enforce
  empty `layer_gcode` plus relative extrusion, aligned with each selected
  repository child machine's exact `layer_change_gcode='G92 E0'` override.
- J1 selects repository PLA/PETG filament profiles, snapshots their exact bytes,
  loads machine/process through `--load-settings`, and loads selected filament
  separately through `--load-filaments`. The effective digest
  binds normalized material and selected filament JSON or explicit null.
  Successful Orca payloads expose nullable filament basename plus actual
  diameter/density. OpenAPI requires nullable `stats.material_used_g`; it may
  contain only a direct G-code mass marker and is never derived from filament
  length. Strict FDM output requires positive time and length. On the optional-
  mass Prusa path, a missing or recognized non-positive direct grams marker
  returns `material_used_g:null`, `hourly_rate:null`, and
  `stats.estimated_price_huf:null`; zero is never published. Orca with a selected filament profile also
  requires positive direct grams and maps missing/drifted mass to HTTP 500
  `SLICE_OUTPUT_UNPARSED`; profile-less Orca remains null/manual.
- Prusa INI digest identity is case-sensitive for section/key names and exact
  duplicate qualified keys fail closed like the native Boost parser. Runtime
  generation replaces one exact top-level request key, rejects duplicates, and
  inserts a missing key before the first section.
- OpenAPI includes the four requested omissions `FILE_PROCESSING_TIMEOUT`,
  `INTERNAL_PROCESSING_ERROR`, `ORCA_PROFILE_INCOMPATIBLE`, and
  `MODEL_OUT_OF_PRINTER_BOUNDS`, plus the already-live
  `MODEL_DIMENSIONS_UNAVAILABLE` in the general 422 branch. The bounds code
  requires both `model_dimensions_mm` and `build_volume_limits_mm`. The complete
  live slice-500 enum is `SLICE_OUTPUT_UNPARSED`, `INTERNAL_PROCESSING_ERROR`,
  `QUEUE_INTERNAL_ERROR`, `UPLOAD_STORAGE_ERROR`, and `INTERNAL_SERVER_ERROR`.
- Slice traffic still accepts exactly one `x-slicer-api-key` header. Explicit
  `legacy`, finite `migration`, and final `principals` modes control the shared
  compatibility family and the separate WooCommerce/LeadPilot families.
  `GET /health` and `GET /pricing` remain authentication-free. Before any router
  action, the dark gate must prove principal-only readback, one private positive
  slice per principal, retired-shared and `x-api-key` negative cases, and exact
  cleanup. Missing or inconclusive evidence keeps the route dark. External
  production activation is outside repository evidence and authority.
- Every success also requires the atomically startup-verified `engine_version`
  parsed from both selected executables' bounded `--help` output before listen.
  The startup module has exact-image proof and uses a telemetry-disabled runner,
  so its probes cannot alter slice-native lifecycle metrics/events. Orca sends
  `--arrange 1` and
  `--orient 0`: arrangement places already-rotated geometry onto the build
  plate, while auto-orient stays disabled and cannot replace the requested
  rotation. Focused command/digest contracts and final exact-image HTTP
  transform/final-dimensions E2E pass on code SHA `ed85eec63409b7362fe05c2b99031eeb24b5b9c9`
  and local image ID `sha256:66697a1ca69e13600a91481bf474d042c0f89b236ccbaf67fcf2dea8824f2c7f`.
  Both principal families pass; a valid key only under `x-api-key` rejects
  without request residue. That exact-image result is historical J0 evidence,
  not J1 deployment. J1 focused tests cover filament selection/null identity,
  nullable Prusa/manual pricing, selected-profile Orca direct grams, and strict
  marker-drift failure. Strict mode defaults on and never substitutes zero or a
  length-derived mass.
  The retained P1S and H2D candidates are generic Marlin profiles. Nine numeric
  Bambu references plus the `M03` P1S-boundary result are recorded, but W8 Orca
  calibration remains `BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER`; no automatic-
  pricing acceptance is inferred.

## Historical I12 Hostinger production-qualification boundary

- Checkpoint status was `I12_API_F710_DARK_N1_VERIFIED;
  OPERATOR_MAIN_7C8AEE_RESIDUAL_RECONCILIATION_COMPLETE;
  CORRECTED_TRAEFIK_DARK_CUTOVER_VERIFIED; PUBLIC_ROUTE_DISABLED`.
- At that checkpoint the deployed API image source was protected-main
  `f71069cb3ba5ddeb97e69ca1414a00a72a20ce28`; its exact signed image digest is
  `sha256:d50c72bd084e14645f2c9c7b18a087317bf080a2d76cf1bc876d5e3427ae1e26`.
  It was healthy and dark at retained concurrency one, without a host API
  port or API default route.
- Corrective operator main
  `7c8aee0728fc8462c67b4c6d85636bffb7afcdf8` passed Source `32804297840` and
  Image `32804297658` after protected PR `#5`. Its operator commits are separate
  from the API-image source and did not rebuild, relabel, or republish that image.
- The corrected socketless Traefik was healthy with exact ingress/private
  `gw_priority: 1/0`, ingress-owned default routing, effective read-only config,
  file provider only, and no Docker socket/provider. Docker owns exact IPv4 and
  IPv6 host listeners for ports 80/443 while the container networks remain
  IPv6-disabled; these are separate properties.
- Failed-cutover resources were reconciled by exact identity into the resumed
  successful state. The old proxy is intentionally retained stopped for
  rollback, task-owned remote temp residue is absent, and ACME bytes are unchanged.
- At that checkpoint no public slicer router was active. Hostname/DNS, approved caller/CIDR,
  firewall acceptance, certificate issuance/continuity, route activation,
  monitoring/recovery acceptance, customer traffic, and public production
  completeness were unverified and separately authorized.

## Candidate image publication boundary

- Normal Image Validation remains read-only, builds once, and never pushes,
  attests, or deploys.
- I10 is live-verified at protected-main SHA
  `8253160eef1c3e00c1e40826ec61fd97563ddd9b`: Source `32662043454` and Image
  `32662043476` succeeded, and strict main policy requires both no-deploy GitHub
  Actions contexts. Main requires a PR, includes administrators, forbids
  force-push/deletion, requires conversation resolution, and enables merge
  commits only. Zero approvals reflect the sole-collaborator self-review limit,
  not human approval; required signatures are not enabled.
- I11 Candidate Publication is manual `workflow_dispatch` only from exact
  current protected `main`. Repository `Botond1/3D-Printer-Slicer-API`, actor
  `Botond1`, `refs/heads/main`, requested/event/checked-out/remote SHA,
  post-I10 ancestry, and registry
  `ghcr.io/botond1/3d-printer-slicer-api` must all match.
- `publish_new` requires an empty existing-digest input, exact confirmation
  `PUBLISH_SIGNED_MAIN_CANDIDATE`, and a proven-absent SHA-derived discovery
  tag before pushing the once-built fully gated image.
- `recover_exact_digest` requires exact confirmation
  `RECOVER_SIGNED_MAIN_CANDIDATE` and a lowercase `sha256:<64 hex>` already
  bound to the SHA-derived tag and the once-built image config. Recovery never
  pushes, overwrites, or deletes registry content.
- Only its publication job may use `packages: write`, `attestations: write`,
  and `id-token: write`. Login and push occur only after the complete shared
  exact-image gate passes on the same once-built `linux/amd64` image.
- The publication job binds GitHub environment `candidate-publication` with
  `deployment: false`. Environment ID `20443404498` is
  `LIVE_CONFIG_VERIFIED` on 2026-08-23: protected branches true, custom branch
  policies false, exactly one `branch_policy` protection rule (ID `63481958`),
  and no reviewer/wait-timer rules, secrets, variables or deployments. No
  reviewer is possible while `Botond1` is the sole collaborator.
- Never overwrite/delete a discovery tag or create `latest`, release, staging,
  or production tags. Downstream consumption is exact-digest only:
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:<64 lowercase hex>`.
- Successful protected-main publication automatically triggers the no-deploy
  rehearsal through `workflow_run`. It re-proves the exact upstream run and
  single bounded artifact, dynamically binds the policy-pinned previous and
  artifact-derived current digests, verifies both images' SLSA/SPDX
  attestations through API and OCI, then runs hardened I9 readiness,
  `STORAGE_UNSAFE`, automatic rollback, bounded evidence and exact cleanup.
  The rehearsal has read permissions only and cannot write GHCR or deploy.
- Publication is not deployment. Preserve and classify partial candidates;
  exact recovery may continue only a matching digest without remote mutation.
  I11 is complete at protected-main SHA
  `65706e381b907c6ba09a8eba504af3adaacac86b`: Source `32668796239`, Image
  `32668796232`, Candidate Publication `32669087688`, and automatic rehearsal
  `32669484893` all succeeded, completing the I11 checkpoint.
- Hosted S4/S5 and I9 results remain ephemeral repository evidence. I12
  separately verifies one exact dark digest, Hostinger VPS, private readiness,
  API/native egress denial and corrected socketless proxy. Public callers,
  proxy CIDR/firewall, DNS/certificate, complete secret lifecycle, route
  activation, customer traffic and public rollback remain separately
  authorized and unverified.

