# J1C slice-contract corrective

Date: 2026-08-26

Classification:
`J1C_RECOGNIZED_ZERO_MASS_CORRECTION_LOCAL_PASS;
J1C_VENDOR_PROFILE_INTEGRATION_BLOCKED_MISSING_SELF_CONTAINED_INPUT;
J1C_CAPABILITY_READINESS_PROPOSAL_ONLY;
LOCAL_AGGREGATE_SYNTAX_AND_AUDIT_PASS; CONTAINER_AND_HOSTED_NOT_VERIFIED;
NO_VENDOR_OR_READINESS_RUNTIME_CHANGE; NO_DEPLOY`.

This is a `PARTIAL / BLOCKED` evidence record. It covers the narrow recognized-
zero G-code correction and a bounded vendor-input audit on branch
`codex/j1c-slice-contract-corrective`, based on J1 head
`4cbb5faecce5bb5ab2eedb56d55bcf69e5954a31`. It does not classify J1C as
complete and grants no push, registry write, deployment, VPS mutation, public-
route activation, Docker prune, or consumer-repository authority.

## Corrected slice-output contract

The J1 local record said that the current Prusa FDM output had no direct grams
marker. Later container-level diagnosis instead observed a recognized native
marker with `0.00 g` beside positive time and filament length. That narrower J1
claim is superseded; the rest of the J1 evidence remains historical and
unchanged.

The J1C candidate now distinguishes whether direct grams are required:

- When grams are optional, as for Prusa FDM and profile-less Orca, a recognized
  non-positive grams marker is not published as zero. Positive native time and
  filament length remain required, while `material_used_g` and its source are
  `null`; pricing remains manual with null rate and estimate.
- When a selected Orca filament profile requires grams, the same recognized
  zero remains `GCODE_FILAMENT_NOT_POSITIVE`, mapped to bounded HTTP 500
  `SLICE_OUTPUT_UNPARSED`.
- A missing or drifted required marker still fails closed. J1C neither derives
  mass from length/density nor weakens the marker-drift negative control.

This correction changes no endpoint, header, response schema, configuration
key, queue policy, or authentication contract.

## Focused verification

The two directly affected test files passed together:

```text
node --test tests/unit/js/sz-b2-gcode-metrics.test.js tests/unit/js/j1-strict-model-stats.test.js

tests 19
suites 2
pass 19
fail 0
cancelled 0
skipped 0
todo 0
```

Coverage includes the observed positive-length/recognized-zero input, optional
null/manual handling, the selected-profile `GCODE_FILAMENT_NOT_POSITIVE`
failure, missing required mass, and the mandatory time/mass marker-drift
negative controls.

## Complete local verification

The final working-tree candidate passed the complete local non-container gates:

```text
npm test
JavaScript: tests 2212; pass 2212; fail 0; skipped 0
Python: discovered 85; run 85; passed 84; failed 0; errors 0; skipped 1
Expected skip: Windows lacks the POSIX permission semantics needed by that
               permission-mutation test.

npm run check:syntax
JavaScript syntax OK: 251 tracked file(s).
Python syntax OK: 39 tracked file(s).

npm audit --omit=dev
found 0 vulnerabilities

npm run check:repository-safety:staged
Repository safety OK: 16 staged indexed file(s); limit=1048576 bytes.

git diff --cached --check
exit 0
```

The staged diff also produced zero matches for the bounded external source-path
and customer-identifier token scan. The owner-only source directory itself was
not copied or named in repository content.

These gates do not substitute for a native exact-image/container slice.

Local Docker availability was checked read-only and failed before any resource
could be created:

```text
failed to connect to the docker API at
npipe:////./pipe/dockerDesktopLinuxEngine; check if the path is correct and if
the daemon is running: open //./pipe/dockerDesktopLinuxEngine: The system cannot
find the file specified.
```

## Bounded vendor-input audit and blocker

The bounded audit parsed all 11 supplied JSON files and matched all 11 declared
SHA-256 values. Inheritance analysis derived these candidate build volumes:

| Candidate | Derived volume (mm) |
| --- | --- |
| P1S | 256 x 256 x 250 |
| H2D | 350 x 320 x 325 |

These values are audit outputs only. They were not installed as runtime
profiles and are not Orca 2.3.1 qualification evidence.

The supplied set is not self-contained. Integration is blocked because:

- 11 referenced include-template JSON files are missing;
- no H2D-compatible process profile is supplied;
- vendor filament profiles and their parent chains are absent;
- no supplied filament density, diameter, or material-type fields are
  available for the required runtime metadata contract;
- 0.1 mm and 0.3 mm BBL process profiles are absent;
- redistribution and license permission are unverified; and
- exact compatibility with the pinned OrcaSlicer 2.3.1 runtime is unverified.

Therefore no vendor file was copied, no inheritance resolver or runtime path
was changed, and no derived dimension was hard-coded. The repository's existing
generic profiles remain in place. The selected-filament Orca incompatibility
described as J1 defect 2 remains `NOT FIXED`.

Safe owner inputs required to resume this lane are a complete self-contained
and redistributable vendor machine/process/filament chain, the missing H2D and
0.1/0.3 process coverage, all required filament material fields, and an exact
OrcaSlicer 2.3.1 compatibility result. No machine-specific source location is
part of repository evidence.

## Capability-readiness proposal only

No readiness implementation was added in J1C.

- Public `GET /health` should remain a cheap liveness probe.
- Public `GET /ready` is the proposed home for slicing-capability state.
- A startup smoke is not cheap enough for this corrective wave. A meaningful
  gate needs at least one Prusa and one selected-filament Orca native probe,
  contained fixtures and scratch/process cleanup, readiness state/cache and
  admission integration, plus Docker and VPS evidence.
- Docker healthcheck remains on `/health`, while Traefik already consumes
  `/ready`. A capability-driven `/ready` 503 would withhold routing but would not
  by itself make the Docker container unhealthy.
- A rolling error-rate signal needs typed per-engine capability failures,
  anti-DoS semantics, and bounded recovery/hysteresis. A raw last-N HTTP 5xx
  rule is unsafe because caller-controlled or unrelated failures could remove a
  healthy engine from readiness.

Any implementation of these proposals is a separate authorized wave with its
own focused, exact-image, topology, and recovery evidence.

## What remains NOT VERIFIED

- Hosted exact-SHA gates and exact-image/container qualification were not run.
- The corrected Prusa path has no exact-image/container HTTP 200 proof here;
  positive time/length plus null mass/rate/price is focused-test evidence only.
- Selected-profile Orca success with positive direct grams remains unverified;
  its current vendor-profile incompatibility is not fixed.
- Vendor inheritance completeness, redistribution permission, exact Orca 2.3.1
  behavior, native output, build volumes, and runtime cleanup remain unverified.
- Neither startup capability smoke nor rolling per-engine degradation/recovery
  is implemented or tested.
- Image build/SBOM/scan, registry publication, deployment, public routing,
  monitoring/recovery, customer traffic, and consumer acceptance remain
  `NOT VERIFIED` and unauthorized by J1C.
