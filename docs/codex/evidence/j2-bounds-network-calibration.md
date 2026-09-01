# J2 bounds, catalogue, network, and calibration evidence

## Scope and classification

J2 starts from protected `main` commit
`0dedbe1e9e4c32a0373982a45bf788cdcdb4f024`, after the J0/J1 integration
checkpoint. This document records the J2 candidate only; it does not alter the
historical J0, J1, or J1C evidence.

Prompt W2, the J0/J1 merge to protected main, is therefore already complete at
the baseline; the profile catalogue below is prompt section 5/b, not W2.

Current classification:

```text
J2_LOCAL_AGGREGATE_PASS
J2_HOSTED_BASELINE_SOURCE_IMAGE_PASS_NO_PUBLISH
J2_LIVE_ACTIVATION_REHEARSAL_BLOCKED_NOT_RUN
J2_NO_ROUTE_MUTATION
J2_REHEARSAL_TERMINAL_CONTRACT_DARK
J2_ORCA_CALIBRATION_BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER
```

No registry publication, image deployment, DNS change, live route activation,
permanent exposure, or customer traffic is claimed by this checkpoint.

## Local implementation evidence

### W1 build-volume contract

- The shipped Prusa FDM profiles and Orca P1S machine profile resolve to
  `256 x 256 x 250 mm`.
- The Orca H2D machine profile resolves to `350 x 320 x 325 mm`.
- The FDM fallback is the largest supported machine envelope,
  `350 x 320 x 325 mm`; it is not a separately maintained fleet claim.
- The existing `1 mm` lower compatibility boundary remains unchanged. J2 has
  no owner semantics decision to widen it; this wave corrects upper envelopes.
- `MAX_MODEL_DIMENSION_MM` retains its `10000 mm` default and now has a
  `350 mm` minimum, so a valid H2D X dimension cannot be excluded by the
  resource-policy override.
- Fit remains per selected printer/profile. The P1S accepts a model with
  `230 mm` Z, rejects `251 mm` and `260 mm` Z, and rejects an X/Y overflow
  through the same real bounds path.

These statements are sourced from `app/config/constants.js`,
`app/config/resource-policy.js`, the shipped profiles under `configs/prusa/`
and `configs/orca/`, and the production resolver in
`app/services/slice/profiles.js`.

### Profile catalogue (prompt section 5/b)

`GET /profiles` is a public, unauthenticated, informational startup catalogue.
It is built through the production resolve, snapshot, runtime-profile,
build-volume, filament-metadata, and effective-profile-digest chain. The
current `r3d-profile-catalogue-v1` payload is explicitly FDM-only and contains
exactly 15 machine-bound, server-owned rows: three Prusa P1S rows and twelve
Orca P1S/H2D rows. Custom overrides and dynamic or unmapped materials are not
advertised. The generic `120 x 120 x 150 mm` SLA fallback is not a machine
envelope and is never published as one.

Every row uses a bounded generic `engine`, a generic `/.../slice` endpoint plus
ordered `slice_selector.parameters[{name,value}]`, ordered path-free
`profile_components[{role,basename,selector_parameter}]`, and
`effective_profile_identity_schema: r3d-effective-slice-profile-v2`. It also
binds printer identity, engine version, effective profile digest, material
scope, filament metadata, and the resolved per-engine build envelope.
`selector_parameter` is a string or null: Orca machine binds to
`printerProfile`, Orca process to `processProfile`, Orca filament to null, and
the Prusa combined component to `printerProfile`.
`build_volume_limits_mm.max_source_kind: profile-explicit` is published only
when all X/Y/Z maxima came from explicit selected-profile metadata. The
unchanged generic `1 mm` minimum is a compatibility floor, not machine
metadata. Every per-printer/per-engine preset row remains in `profiles`; no
machine-level coalescing hides one. Presets within one
technology/printer/engine must agree on their envelope or catalogue
construction fails closed.

`machine_resolutions` answers the first derived question. Each entry is grouped
by technology/printer and publishes a resolved envelope only when every
represented engine envelope agrees exactly. On disagreement that one machine
is `excluded`, its resolved envelope is null, and
`reason: cross_engine_conflict` is explicit. All source rows, technologies, and
other machines remain available. A smaller conflicting value is never selected.

`fleet_resolutions` answers the guarantee question independently for every
present technology and derives each maximum only from that technology's
resolved machines. Each entry attributes the maximum to every real machine
whose envelope contains all other resolved envelopes in that technology, and
repeats every excluded printer with its reason. If no such resolved machine
exists, the maximum is explicitly null with a machine-readable reason. P1S
currently agrees across Prusa and Orca at `256 x 256 x 250 mm`; H2D currently
dominates FDM at `350 x 320 x 325 mm`. A future conflict always narrows the
affected technology's eligible machine set and never widens its ceiling; the
numeric ceiling shrinks when the excluded machine carried it. Data drift is not
hidden. There is deliberately no hand-maintained `fleet_max` field. The owner-confirmed
SLA target is the Elegoo Saturn 4 Ultra, but its dimensions are intentionally
not guessed. The current
Prusa `--export-sla` output and SL1 metadata parser cannot represent Elegoo
`.goo`/`.ctb` artifacts or credible MSLA timing. SLA remediation is a separate
future wave using owner Chitubox/Elegoo Satellite profiles. The generic bounded
v1 entry shape can add later truthful machine-bound SLA rows and an independent
SLA entry in `fleet_resolutions` without a schema-version change; the current
payload contains no SLA row or Elegoo dimension.

The response has a strong ETag equal to the quoted lowercase SHA-256 digest of
canonical catalogue content published in the body as `catalogue_sha256`.
Conditional revalidation returns `304` without a body. Catalogue initialization
failure returns non-cacheable HTTP
`503` with `PROFILE_CATALOGUE_UNAVAILABLE`; it does not fail startup, readiness,
or slicing. Slice endpoints remain authoritative for fit enforcement.

The implementation is in `app/services/slice/profile-catalogue.js`,
`app/routes/profile-catalogue.routes.js`,
`app/docs/profile-catalogue-openapi.js`, and `app/server.js`.

### W3 private route preparation

The disabled router template and operator contract accept one through four
unique canonical private IPv4 `/32` source ranges. Phase one is exactly one
LeadPilot source; the later expanded phase accepts two through four sources.
The structure therefore supports all four planned callers without weakening
the first activation phase.

An allowlist rejection is distinguishable from application principal failure:

- the Traefik router rejection is HTTP `403`;
- the historical repository design expected a host-firewall TCP reset with the
  private `J2_ALLOWLIST_DENY` event class;
- application principal rejection remains HTTP `401`.

The repository operator prepares and validates the dark-to-active rehearsal,
but an external orchestrator must independently prove denied and allowed
sources, TLS issuance and renewal, and rollback. The repository operator cannot
promote based on its own gates. A completed rehearsal can be accepted only
after both rollback and the dark terminal state are positively proved. Any
`*_rollback_uncertain` result is `STOP/UNKNOWN` and is not dark evidence.

The local contract is sourced from
`ops/hostinger/RUNBOOK.md`,
`ops/hostinger/templates/slicer-api-router.yml.disabled`,
`scripts/i12-hostinger-operator-contract.js`, and their unit tests. It is
preparation evidence only, not a live network observation.

That expected reset was later disproved on the target host. The installed
`REJECT` action increments its deny counters but is caller-visible as a timeout,
and IPv6 `[::]:443` requires a separate `ip6tables INPUT` rule because its
docker-proxy path bypasses `DOCKER-USER`. This historical J2 preparation claim
is superseded by
[`hostinger-leadpilot-route-activation.md`](hostinger-leadpilot-route-activation.md).

The no-clobber helper also binds the live dynamic directory to exact root:root
mode `0700`, its `.gitkeep` sentinel to exact root:root mode `0600`, and proves
device/inode, mode, owner, and link-count continuity across activation and
disable mutations. One inherited root-private FD9 `flock` spans the complete
rehearsal and rejects a concurrent activation or disable. Before, immediately
around, and after each action, the helper re-proves every relevant canonical,
root-owned, non-group/world-writable ancestor from the pack and private-input
parent to the filesystem root. It checks both HEAD and index for private route
leaks, proves an activated source pathname was consumed, and uses strict
`--assert-router-dark` with an exact retained source as terminal proof.

Deterministic tests exercise recovery after logically injected fsync cutpoints.
They are not process/kernel/power-loss evidence; target-filesystem durability
remains external `NOT_VERIFIED`. Exact nested Traefik service/load-balancer/health-check keys
reject duplicate `passHostHeader` or additional health-check blocks. The
server list is exactly one canonical private-backend item and rejects alternate
multiline YAML list entries. The final combined focused command, including the
W3 and retained operator mutation sets, passed 331/331 after these fail-closed
checks were added.

### W5 calibration contract

The anonymized worksheet records nine numeric Bambu Studio reference rows and
the `M03` P1S-boundary rejection. The matching Orca runner fixes native
orientation at `--orient 0`, writes `enable_support='0'` before profile digest
and native execution, reads the value back, and reuses production machine/
process `--load-settings` plus separate `--load-filaments` construction. The numeric gate is
`max(abs(time delta), abs(mass delta)) <= 10%` for all nine measurable models;
`M03` is a separate clean-rejection gate above P1S Z `250 mm`.

The Orca measurement was not run. The owner-approved vendor machine-profile
chains are absent and the local Docker daemon was unavailable. The generic
repository profiles establish the physical J2 envelopes but cannot qualify
vendor-faithful time or pricing. A read-only `docker version` probe could not
connect to a daemon; no calibration container was started.

See `docs/kalibracio-2026-08.md`,
`configs/orca/H2D-PROFIL-TODO.md`, and
`scripts/sz-b2-orca-calibration.js`.

### Local validation result

The focused JavaScript command covered build-volume, catalogue, Hostinger
network, operator, calibration-privacy, and OpenAPI contracts:

```text
node --test tests/unit/js/j2-build-volume-contract.test.js \
  tests/unit/js/j2-profile-catalogue.test.js \
  tests/unit/js/j2-hostinger-network-contract.test.js \
  tests/unit/js/i12-hostinger-operator-contract.test.js \
  tests/unit/js/i12-hostinger-operator-mutations.test.js \
  tests/unit/js/j0-hostinger-principal-activation-contract.test.js \
  tests/unit/js/j1-calibration-script-privacy.test.js \
  tests/unit/js/openapi.test.js

tests 331; pass 331; fail 0; skipped 0
```

The final root local aggregate passed 2339/2339 JavaScript tests. Python ran
103 tests: 102 passed and one expected Windows POSIX-permission case skipped.
Final indexed syntax passed for 257 JavaScript and 41 Python files. Repository
safety passed for 429 indexed tracked files and all 51 staged J2 paths.

Python AST parsing also passed for the modified shared HTTP helper and the new
profile-catalogue runner. These are local source and contract results. They do
not prove a native slicer image, hosted J2 commit, or live route.

## Hosted evidence boundary

The exact baseline `0dedbe1e9e4c32a0373982a45bf788cdcdb4f024` passed the
read-only Source Validation run `32996102492` and no-push Image Validation run
`32996102426`. Those results qualify the baseline only. They are not hosted
evidence for the locally committed J2 source.

There is no Candidate Publication or deploy result for that baseline, and no
hosted exact-SHA J2 result at this checkpoint. The deployed dark API image
predates the J0 principal-auth contract, so it cannot execute the required
two-principal live gate.

## Live and VPS evidence boundary

The activation rehearsal is `BLOCKED_NOT_RUN`. Its required exact J0-capable
image has not been published and deployed, and the private/live inputs and
external observations are not present. Consequently there is no claim for an
installed allowlist, permitted-source pass, denied-source block, TLS issuance,
renewal continuity, or rollback execution. J2 performed no route mutation. The
latest prior I12 evidence classified the route dark, but J2 did not re-read the
live state and does not present that prior result as a fresh observation.

The live rehearsal may proceed only after those prerequisites exist and under
the separate external-orchestrator acceptance contract. Even then the first
phase contains only the LeadPilot source and must end dark for reporting; a
later caller expansion is a separate activation phase. A rollback-uncertain
result stops as unknown instead of satisfying that terminal contract.

## Later allowlist-contract supersession

The one-through-four source and later-expansion statements above are preserved
only as exact historical J2 evidence. The later owner decision recorded in
[`hostinger-traefik-deploy-preparation.md`](hostinger-traefik-deploy-preparation.md)
supersedes that executable policy: current rendering accepts exactly one
canonical IPv4 `/32` under the sole `leadpilot-only` phase. A second source,
expanded phase, or wider prefix fails closed. This note does not claim that the
corrected middleware or any live host control has been installed.

## Privacy boundary

Repository evidence uses only anonymous `M01`-`M10` labels, content hashes,
bounded public status identifiers, and aggregate measurements. It contains no
real source address, private route, credential, customer identity, customer
file path, or private machine identifier.

The final staged-added-line privacy scan returned:

```text
privacy_added_scan lead_order_numeric=0 absolute_external_paths=0 private_reference_paths=0 forbidden_public_ipv4=0
privacy_ip_classes loopback_or_unspecified=3 rfc5737=17 rfc1918=0 forbidden_public=0
```

The remaining address literals are loopback/unspecified values and RFC 5737
documentation fixtures only. The calibration privacy suite separately proves
that committed model identity is restricted to anonymous `M01`-`M10` labels
and that private paths and basenames are redacted.

## NOT VERIFIED

- hosted Source/Image validation for the locally committed J2 source;
- the profile-catalogue Python HTTP runner against a started exact image,
  including optional Prusa slice-digest parity;
- exact J0-capable candidate publication, deployment, or deployed digest;
- private DNS, firewall backend, installed rules, counters, or event stream;
- SSH password-authentication state;
- fail2ban or an equivalent SSH-abuse control;
- the port-22 exposure decision and its live enforcement;
- external allowed-source and denied-source request observations;
- TLS issuance, renewal, ACME storage identity, or certificate continuity;
- live route activation, external-orchestrator acceptance, or rollback;
- target-Linux process/kernel/power-loss durability of the route mutation;
- current live route state, which J2 did not re-read;
- any permanent active route or customer traffic;
- owner-approved P1S/H2D vendor-profile chains;
- the nine Orca numeric measurements and the Orca-side `M03` rejection;
- automatic pricing acceptance based on the calibration gate;
- a local or hosted exact-image Docker calibration run;
- truthful Elegoo Saturn 4 Ultra build-envelope values from an owner profile;
- owner Chitubox/Elegoo Satellite profile identity and compatible
  `.goo`/`.ctb` output, metadata parsing, and MSLA timing evidence.
