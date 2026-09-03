# Evidence — Bambu reference comparison on the 3.3.0 image (2026-09-03)

## What this is

The output of `tests/testing-scripts/calibration/bambu_reference_comparison_runner.py`
run by the owner against the **deployed 3.3.0 image**
(`ghcr.io/botond1/3d-printer-slicer-api@sha256:c32b4c6f659b6b75cd504213014c1c95da9ab6d293b18906e8f3c78425f3159b`,
commit `4fb770d792eac932f02a6c9b3f407a7822a1996b`) in an isolated container with
the production isolation envelope, on the owner's ten private reference models
with the owner's own Bambu Studio GUI readings as the reference.

The models stay private: the report identifies them only by index and SHA-256
prefix, and carries no file name, directory, base URL, or credential. The
reference seconds and grams are the same owner readings already recorded in
`docs/kalibracio-2026-08.md`.

## What it proves, and what it does not

- It proves that on this image the `POST /bambu/slice` path reproduces the
  owner's Bambu Studio readings for the eight sliceable models within
  **±0.7 % on time and 0.0 % on mass** (mean 0.2 % / 0.0 %), so it satisfies
  the consumer's `max(|dt%|, |dg%|) <= 10 %` calibration gate. The Bambu
  effective profile digest on this image is
  `70e87eaff59a65d93fbfddd507eaa08d2ee52e5857e222757f32199d7fc9f06f` — byte
  identical to the one the 3.2.0 image publishes, measured by slicing the same
  40 mm PLA cube through both images in isolated containers. The digest
  excludes the request's layer-height and infill overrides, so it is the same
  for the 15 % infill used here and the 20 % used in that check. The Prusa and
  Orca FDM digests are likewise unchanged
  (`4b713b256d53f4b18cc1098c51cdfe3d867f27cece3d916a7b82b39f190a0178` and
  `ea787dbf09a44eb650343df38899bb0cf530b458c19f47939664302343c0e42e`); only the
  SLA digests moved in 3.3.0.
- Entry 3 has no numeric reference (the P1S refused it on Z) and is skipped.
  Entry 7 is the known faulty mesh and answers `422 UNSLICEABLE_SOURCE_GEOMETRY`
  — the expected typed refusal, not a calibration failure. The runner's own
  exit status is therefore non-zero.
- It does **not** prove physical accuracy. Bambu Studio's GUI reading is the
  owner's accepted reference; no wall-clock print has been made. The target
  class is `local-loopback`, so this is image evidence, not evidence about the
  routed production endpoint.

## Report

# Bambu Reference Comparison Report

Generated at (UTC): **2026-09-03T10:57:45.591085+00:00**
Target class: **local-loopback**
Printer: **P1S**  Layer: **0.2 mm**  Material: **PLA**  Infill: **15%**  Supports: **false**  Orientation: **preserve**
Tolerance: **max(|dt%|, |dg%|) <= 10%**
Models: **9**  Passed: **8**  Failed: **1**
Mean |dt%|: **0.2**  Mean |dg%|: **0.0**

Models are identified only by index and SHA-256 prefix; no file name, directory, base URL, or credential is retained. Reference values come from the owner's Bambu Studio reading and are not repository evidence of production calibration.

| # | SHA-256 | Ref s | Ref g | API s | API g | dt% | dg% | Result | Observation |
|---:|:--------|------:|------:|------:|------:|----:|----:|:------:|:------------|
| 1 | `ebfcff94bc27` | 714 | 0.72 | 714 | 0.72 | +0.0% | +0.0% | PASS | within tolerance |
| 2 | `bdc3511edb8b` | 6420 | 46.33 | 6429 | 46.33 | +0.1% | +0.0% | PASS | within tolerance |
| 4 | `5cc75b45c6b7` | 9900 | 91.86 | 9850 | 91.86 | -0.5% | +0.0% | PASS | within tolerance |
| 5 | `a0bcb4c6c4ae` | 3396 | 19.95 | 3389 | 19.95 | -0.2% | +0.0% | PASS | within tolerance |
| 6 | `70d8427e02f6` | 1578 | 7.17 | 1579 | 7.17 | +0.1% | +0.0% | PASS | within tolerance |
| 7 | `bc40ab09e279` | 7680 | 45.06 | - | - | - | - | FAIL | HTTP 422 UNSLICEABLE_SOURCE_GEOMETRY |
| 8 | `72cfd22034de` | 6300 | 33.23 | 6257 | 33.23 | -0.7% | +0.0% | PASS | within tolerance |
| 9 | `c38a00337fa4` | 6600 | 36.43 | 6601 | 36.44 | +0.0% | +0.0% | PASS | within tolerance |
| 10 | `d90edc7d2ea7` | 24360 | 222.47 | 24324 | 222.47 | -0.1% | +0.0% | PASS | within tolerance |
