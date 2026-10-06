# Handoff 2026-10-06 — 3.8.0 asynchronous slice jobs deployed

## Why

The WordPress shop's worker runs inside an HTTP request whose front proxy closes at ~115-120 s, so it cut every
synchronous slice at 100 s. Production, 2026-09-29..10-05: 47 of 418 `POST /bambu/slice` requests ended as Traefik 499
at 100 s; 18 of them never started a native step (single-concurrency queue behind a heavy model).

## What runs

- Signed main `4fb4c0d2beb0a560c6f7f5aca9ce0c21a9805c74` (PR #37 = d26d388 + f647d47), image
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:4fb4def7d2e09e0e12f59b146e4aefc41fc5c7c110071ce39866662b52cf398f`
  (Candidate Publication run 37434570317; SLSA and SPDX attestations verified with `gh attestation verify`).
- Operator values (5794efa release tree, configs unchanged): compose env `SLICER_MEMORY_BYTES=12884901888`
  (was 8589934592), service env `MAX_CONCURRENT_SLICES=2` (1), `MAX_SLICE_QUEUE_LENGTH=24` (16),
  `MAX_SLICE_QUEUE_PER_IP=20` (5); `MAX_SLICE_QUEUE_WAIT_MS=240000` unchanged (sync only).
- Cutover ~08:28 UTC by `/root/r3d-async-control-20261006/deploy-async.sh` (pull + revision label, bounded id 999:999,
  retention tags for both images, compose contract, atomic env rewrites with backups in
  `/root/r3d-backup-20261006-async/`, compose up, runtime identity, readiness, catalogue checks, negative auth, controls).
- Controls after the cutover: healthy after 6 s; catalogue v2 `bb07e0c3…` and v3 `08afef2f…` byte-identical to 3.7.0,
  `measurement_generation` `0af5bd3e…`; 401 without a key on both routes; sync cube30 3.9 s and keyring 7.9 s
  succeeded; async cube30 → 202 → completed after 3.4 s with `result_status` 200; a second read 200; an unknown job 404.
- The shop's (still synchronous) plugin priced a fresh model on it in 17 s.

## Rollback

`sh /root/r3d-async-control-20261006/deploy-async.sh ghcr.io/botond1/3d-printer-slicer-api@sha256:4fb4def7d2e09e0e12f59b146e4aefc41fc5c7c110071ce39866662b52cf398f 4fb4c0d2beb0a560c6f7f5aca9ce0c21a9805c74 rollback`
restores both env files and the 3.7.0 image `sha256:59a44481…` (retained as `local/rocket3d-slicer-api:retained-a7f167f…`).

## Client contract

R3DPlugin V2 `docs/plans/async-slice-contract-v1.md` (with the implemented deviations section). The plugin side is D132.

## 3.8.1 — the native tree is really terminated (same day)

- Found live after 3.8.0: a heavy async job hit its 600 s deadline, the store logged `SLICE_DEADLINE_EXCEEDED` and
  `native.termination_settled` in 1 ms, but `/bin/sh bambu-studio` + `Xvfb` + `bambu-studio` (243 % CPU, 4 GiB) kept
  running 10+ minutes until killed by hand. Cause: `execFile` drops `detached`, so the group kill hit no group.
  The synchronous disconnect had the same no-op before 3.8.0.
- PR #39 (`spawn-file.js`; real process-tree tests for the async deadline, DELETE and the sync disconnect, passing on
  the Ubuntu CI), signed main `46259457…`, digest `sha256:96a8c7f9…f2d1`, SLSA + SPDX verified.
- Cutover ~12:10 UTC by `/root/r3d-async-control-20261006/deploy-async381.sh` (backups
  `/root/r3d-backup-20261006-async381/`; rollback: the same script with `rollback` → 3.8.0 `sha256:4fb4def7…`).
- Live control: pillars-40.stl async, 3 natives running at 25 s (bambu-studio 372 % CPU), DELETE → 204, 0 natives
  1 s later, events `async.cancelled` → `native.termination_settled` (48 ms) → `native.completed` aborted.
