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
J3B_H2D_MEASUREMENT_A_EXACT_IMAGE_VERIFIED;
J3B_FINAL_ADMISSION_B_PENDING;
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

## H2D-QUOTE implementation and exact-image measurement A

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

Measurement A used helper source
`2f4cddab923863ee8a9231e26671ddd2e70444eb` and exact image ID
`sha256:f2259f29fb1472ba695c90f664af0fe0b9a298b89f5139667a0ec8a274406fae`.
Its exact `/profiles` declared-admission phase guard passed before slicing.

| Evidence item | Result |
| --- | --- |
| Native fixture preconditions | 44/44 pass |
| Largest-pass/next-rejection brackets | 10/10 pass |
| Repeated combined X/Y corners | 2/2 pass |

| Engine | Measured inclusive X (mm) | Measured inclusive Y (mm) | Conservative published Z (mm) | Boundary detail |
| --- | ---: | ---: | ---: | --- |
| Prusa | 350 | 320 | 324.9 | X `350.1` and Y `320.1` were request-prevalidation rejections. The native X/Y edge beyond the declared profile therefore remains `UNESTABLISHED`. |
| Orca | 347.9 | 317.9 | 324.9 | X `348.0` and Y `318.0` were native-safety-net rejections. |

At layer heights `0.1 mm` and `0.2 mm`, Z `325 mm` passed and `325.1 mm` was
rejected by request prevalidation on both engines. At `0.3 mm`, Z `324.9 mm`
passed and `325 mm` returned the complete K2 HTTP 422
`MODEL_OUT_OF_PRINTER_BOUNDS` twice on each engine through the native safety
net after the exact conjunctive last-layer classifier. The one published Z is
therefore the strictest offered-layer value, `324.9 mm`.

This closes only exact-image measurement A. Final-admission B must still prove
the published largest-passing catalogue and response limits on the exact final
candidate image; its report is pending.

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

The measurement-A report was read and its sanitized facts are recorded above;
the generated report remains local and uncommitted. The final-admission-B
report is not yet available. The complete J3B VPS matrix, including the zero-
normal row and enlarged-envelope sweeps, is `PENDING_OWNER`. Measurement A and
repository source/unit results must not be promoted to final-B, hosted,
deployed, owner-VPS, or live proof.

## Local source and documentation validation

Observed on 2026-08-31 against the shared uncommitted corrective candidate:

- complete JavaScript aggregate: 2377/2377 pass;
- complete Python aggregate: 166 discovered/run, 165 pass and one expected
  Windows POSIX-permission skip;
- tracked syntax: 262 JavaScript and 46 Python files pass;
- tracked repository safety: 445 indexed files pass;
- `git diff --check`: pass;
- relative Markdown targets: 216/216 pass across the 17 synchronized
  documentation files;
- documentation audit: 76 in-scope Markdown files scanned, 17 J3B/H2D surfaces
  identified, and zero stale measurement-A-pending or contradictory claims.

These are local source/documentation results only. This documentation pass did
not execute or rewrite either generated runner report. Exact-image measurement
A is recorded separately above; final-admission B and the owner VPS matrix
remain pending.

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
