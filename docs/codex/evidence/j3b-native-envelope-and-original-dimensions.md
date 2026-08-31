# J3B native envelope and original dimensions

Date: 2026-08-31
Branch basis: `codex/j3-orientation-visibility`
Repository state: uncommitted corrective candidate
Scope authority: `prompts/codex/J3B-native-envelope-and-original-dimensions.md`

## Classification

`J3_OWNER_CONTAINER_MATRIX_VERIFIED_EXACT_58C0CCB;
J3B_SCHEMA_OWNER_APPROVED;
J3B_SOURCE_IMPLEMENTATION_PRESENT;
J3B_LOCAL_VALIDATION_IN_PROGRESS;
J3B_H2D_EXACT_IMAGE_SWEEP_PENDING;
J3B_OWNER_VPS_MATRIX_PENDING;
ZERO_CUSTOMER_EXPOSURE;
NO_MERGE_NO_DEPLOY_NO_ROUTE_MUTATION`.

J3 itself is closed at the owner evidence boundary. The owner ran its complete
production-identical container matrix on exact tree `58c0ccb`, including
artifact-level G-code proof of the single-token Orca
`--allow-rotations=0` argument. J3B does not reopen that contract. This record
covers a J3 measurement regression plus the native-envelope and H2D-QUOTE
defects made visible by that work.

## Owner-approved schema 2

Success and the complete K2 HTTP 422
`MODEL_OUT_OF_PRINTER_BOUNDS` response use `transform_schema: 2` and contain
both fields below:

- `original_dimensions_available` is mandatory.
- `original_dimensions_mm` is mandatory and nullable.

The invariant is exact:

```text
original_dimensions_available = true
  iff original_dimensions_mm is an object produced by a real measurement

original_dimensions_available = false
  iff original_dimensions_mm is null
```

There is no oriented-dimensions fallback. This makes measurement degradation
loud: a missing value is visible to every consumer, while a substituted value
could be trusted under the wrong label.

The measurement tag itself is canonical only when X/Y/Z/`height_mm` are finite
and non-negative and `height_mm == z`. A malformed tagged original measurement
is treated exactly like unavailable provenance: false/null, never an exception
and never an oriented substitute.

`oriented_dimensions_mm` and `final_dimensions_mm` are load-bearing, not
optional provenance. Bounds validation depends on them. If either tagged
measurement is missing, malformed, non-finite, non-positive, or has
`height_mm != z`, the API returns controlled HTTP 422
`MODEL_DIMENSIONS_UNAVAILABLE`; it must not throw a bare 500. On success,
`stats.object_height_mm == model_transform.final_dimensions_mm.z` remains
unconditional.

## Native rejection mapping

Only explicit native diagnostics that identify placement or print-volume
refusal map to HTTP 422 `MODEL_OUT_OF_PRINTER_BOUNDS`. That response has the
same full K2 schema-2 transform as the pre-native bounds branch, including
`orientation_mode`, `orientation_outcome`, and the original-measurement
availability invariant. Unrelated native failures remain internal errors rather
than being mislabeled as customer fit failures.

Failed native commands preserve their bounded stdout and stderr independently.
The placement classifier evaluates message plus both streams, so a stdout-only
placement diagnostic remains visible even when stderr contains an unrelated
warning. Prusa can also exit zero yet omit the output artifact; that path maps
to the same full K2 safety net only when the retained successful-command output
contains an explicit placement/print-volume refusal. With unrelated output it
keeps the pre-existing missing-artifact failure class.

The customer-facing bounds wording therefore has enough information to
distinguish an automatically applied orientation from a preserved/submitted
pose. The error branch is not a reduced contract.

## Catalogue v2 and inclusive admission authority

The public catalogue schema is `r3d-profile-catalogue-v2`. It retains strong
ETag/body-digest behavior and exposes 18 machine-bound server-owned FDM rows.
Each row separates:

- `declared_build_volume_dimensions_mm`: physical/profile-declared metadata,
  not admission authority;
- `largest_passing_dimensions_inclusive_mm`: the largest proved value that
  passes and is accepted at the exact boundary;
- `declared_source_kind: profile-explicit`;
- `minimum_dimensions_inclusive_mm`: the existing compatibility floor.

Runtime bounds use only `largest_passing_dimensions_inclusive_mm` as the upper
admission limit. Machine and fleet resolutions are derived independently per
technology and engine. Prusa and Orca values are never merged, silently
minimized, or synthesized component by component.

Owner-accepted P1S values:

| Engine | Declared X/Y/Z (mm) | Largest passing X/Y/Z (mm) | Evidence boundary |
| --- | --- | --- | --- |
| Prusa | 256 / 256 / 250 | 256 / 256 / 249.9 | Inclusive admission. Native X/Y beyond the declared profile remains `UNESTABLISHED`; policy rejection beyond 256 is not a native-edge measurement. |
| Orca | 256 / 256 / 250 | 253.9 / 253.9 / 249.9 | X and Y first fail at 254.0 after two accepted 0.1 mm-grid reproductions. |

The conservative P1S Z value is 249.9 across the offered layer heights. This
prevents a quality change from moving the accepted customer envelope. It is the
largest common passing value, not a rounded declared maximum.

## H2D-QUOTE implementation and pending measurement

The owner decided against shipping the placeholder H2D machine preset as a real
profile. J3B instead derives a quoting chain from P1S physics and enlarges only
the declared bed to `350 x 320 x 325 mm` on both engines:

- Prusa: `FDM_P1S_H2D_SIZE_QUOTING_0.1mm.ini`,
  `FDM_P1S_H2D_SIZE_QUOTING_0.2mm.ini`, and
  `FDM_P1S_H2D_SIZE_QUOTING_0.3mm.ini`;
- Orca: `Bambu_P1S_H2D_SIZE_QUOTING_0.4_nozzle.json` with the working P1S
  process/filament chain.

The public identity is `H2D-QUOTE`. It is quoting-only, not machine-accurate
H2D physics and not production H2D G-code. The plugin consumer calls only
`POST /prusa/slice`, so the Prusa path is the consumer-critical implementation;
Orca remains required by the owner decision and cross-engine API contract.

Exact candidate-image measurement status is deliberately searchable:
`PENDING_LOCAL_EXACT_IMAGE_SWEEP`.

| Engine | Provisional X (mm) | Provisional Y (mm) | Provisional Z (mm) | Status |
| --- | ---: | ---: | ---: | --- |
| Prusa | 350 | 320 | 324.9 | Provisional seed; not measured. |
| Orca | 347.9 | 317.9 | 324.9 | Provisional seed; not measured. |

The exact-image X/Y/Z and combined-corner sweep must confirm or replace these
values. If a lower ceiling is observed, that largest passing value must be
published without rounding up to the declared bed.

## Fixture integrity and verification matrix

Normal generated STL fixtures must have valid outward, non-zero facet normals.
Every normal HTTP matrix row is preceded immediately by native
`prusa-slicer --info`; exit zero and positive dimensions within tolerance are a
precondition, not optional diagnostics. This prevents a malformed fixture from
being reported as a service defect.

The zero-normal ASCII mesh is deliberately retained as a separate regression
row. It verifies schema-2 degradation and controlled unavailable-dimension
behavior; it is not part of the normal orientation/envelope matrix.

Repository runners:

- `tests/testing-scripts/slicing/orientation_visibility_test_runner.py` covers
  a mandatory 37-case HTTP matrix across both engines. Its restored section-0
  coverage includes `20 x 240 x 245 mm` auto with zero request transform, exact
  `18 x 130 x 240 mm` automatic replay, preserve plus requested X90 on that
  fixture, and invalid `sideways`, beside success, full K2 parity, schema-2
  availability, and zero-normal regressions.
  The native-info precondition accepts its default host command or a bounded
  JSON argv template through `--native-info-command-json`/
  `SLICER_NATIVE_INFO_COMMAND_JSON`, requires fixture-addressing placeholders,
  executes without a shell and without service credentials, and records only
  `host-default`, `configured`, or `invalid` as the report source label.
- `tests/testing-scripts/slicing/native_envelope_sweep_runner.py` measures X,
  Y, Z, and repeated combined-corner behavior for P1S and H2D-QUOTE on both
  engines while distinguishing API prevalidation from native refusal. Before
  any request, its `native-measurement` A phase requires H2D-QUOTE declared
  admission in exact catalogue v2, while `final-admission` B requires the
  published largest-passing values for all four engine/profile selectors.
  Every accepted response binds exact `build_volume_limits_mm.max` and the
  actual selected bounds `source_profile`: the selected layer-height INI for
  Prusa, and the stable machine profile for Orca rather than its process
  profile.

Reports to read after execution:

- `tests/testing-scripts/results/orientation_visibility_test_result.md`;
- `tests/testing-scripts/results/native_envelope_sweep_measurement_result.md`;
- `tests/testing-scripts/results/native_envelope_sweep_result.md`.

The exact H2D candidate-image sweep is not yet recorded. The complete J3B VPS
matrix, including the zero-normal row and enlarged-envelope sweeps, is
`PENDING_OWNER`. Repository source/unit results must not be promoted to
exact-image, hosted, deployed, or live proof.

## Local source and documentation validation

Observed on 2026-08-31 against the shared uncommitted corrective candidate:

- focused JavaScript contracts for original dimensions, native errors/command
  lifecycle, output lifecycle, catalogue, and OpenAPI: 74/74 pass;
- focused Python orientation and native-envelope runner contracts: 62/62 pass;
- complete JavaScript aggregate: 2375/2375 pass;
- complete Python aggregate: 166 discovered/run, 165 pass and one expected
  Windows POSIX-permission skip;
- tracked syntax: 259 JavaScript and 44 Python files pass;
- tracked repository safety: 435 indexed files pass;
- `git diff --check`: pass;
- relative Markdown targets: 216/216 pass across the 17 synchronized
  documentation files.

These are local source/documentation results only. Neither live runner was
executed in this documentation pass, so no generated runner report was claimed
or rewritten. H2D remains `PENDING_LOCAL_EXACT_IMAGE_SWEEP`, and the owner VPS
matrix remains `PENDING_OWNER`.

## Consumer, exposure, and release boundary

Both reviewed consumers read only `final_dimensions_mm` from
`model_transform`; they do not depend on the new availability fields. Their
independent recommendation for the explicit nullable schema is treated as
engineering judgment, not as migration evidence.

Customer exposure is zero. The plugin has no production deployment or traffic,
and LeadPilot's slicing path is not enabled. The defects are real but are not a
reason to shorten verification.

The owner decided that J2, J3, and J3B ship together through one merge and one
deploy only after J3B verification. This repository wave does not authorize
that merge or deploy. It also authorizes no registry publication, public-route,
DNS, firewall/allowlist, customer-traffic, or consumer-repository mutation.
No credential value, private host/network identity, or customer path is part of
this evidence record.
