# I2 V2C integration and image-liveness evidence

## Scope and checkpoint

I2 starts from exact I1 checkpoint
`c6110e197ebe7e95d15ba597954108297251fb7b` on isolated branch
`codex/i2-v2c-liveness-integration`. It integrates source commits
`44024749ed99d0cf2a8caf1db85d89d16dbca665` and
`73f33e856860cec3b1975af1abb98fa65839dac8` as `cf45524` and
`9f8ae6b`, in that order.

This is repository validation evidence only. I2 did not push an image, deploy,
promote, merge, tag, release, contact a VPS, or change `main`.

## Preserved integration contracts

- The I1 queue deadline, typed shutdown, active-slot ownership, native
  process-tree termination, minimal child environment, and graceful
  `SIGTERM`/`SIGINT` contracts are unchanged.
- Swiper 12.1.2 is installed transactionally into both Orca resource trees from
  the exact archive contract. The digest-pinned offline Chromium gate verifies
  UI compatibility and leaves no browser pollution in the final image.
- Orca remains v2.3.1 at
  `https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.3.1/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.3.1.AppImage` with SHA-256
  `f199e5408914efdbbbfa4fd6752cd6ad4727209b488bc47bff9a0da5f053a701`.
- S3a-B2's Node 24-compatible pinned Action releases remain unchanged.

## Historical comparison and diagnostic checkpoint

The known B1, V1, B2, V2C-only, and I1-only hosted candidates did not identify
a V2C-only liveness regression. The relevant Dockerfile, runtime-path creation,
server startup, workspace path, healthcheck, and workflow tmpfs behavior showed
that Swiper remediation and liveness were independent.

Diagnostic Source run `29965977461` passed. Image run `29965977433` on
`fdd13a5f9967e4f4f36ad1dd4e001535c2bc0c74` retained artifact `8547915247`,
name
`s3a-image-evidence-fdd13a5f9967e4f4f36ad1dd4e001535c2bc0c74-29965977433-1`,
digest
`sha256:46bf1430a3aa87696c707d1dc201cfbf0b519ae99ed769191ec9c7bbc56dccda`.
The bounded artifact contained image identity, runtime diagnostics, finalized
A/B/C ownership evidence, SPDX SBOM, and Grype JSON.

The exact image ID was
`sha256:4307b7d88c2b3d1f129da1c82ea57b83c0a8740eb26cf5973c9ccebc052113ef`;
`Config.User` was `slicer`; the image-resolved service identity was UID/GID
`999:999` for that image only. These values are evidence, not hard-coded
workflow configuration.

| Scenario | `/app/input` and `/app/output` | Result as service user |
| --- | --- | --- |
| A: image directories, no tmpfs | `999:999`, mode `0755` | create/write/stat/remove passed |
| B: former workflow tmpfs | `0:0`, mode `0755`; `rw,nosuid,nodev,noexec,size=65536k` | both probes failed `EACCES` |
| C: dynamic UID/GID tmpfs | `999:999`, mode `0700`; B flags plus `uid=999,gid=999,mode=0700` | both probes passed |

The main container exited 1 without OOM or engine error. Its bounded startup log
was `EACCES: permission denied, mkdir '/app/input/.slice-jobs'`, through
`ensureCanonicalRuntimeDirectory`, `ensureRequiredDirectories`, and
`server.js`. A and C were writable, B was reproducibly not writable, the main
container failed at the same path, and no compared source/runtime difference
explained the failure better. The root cause is therefore `VERIFIED`: the
former tmpfs mounts replaced image-owned runtime directories with root-owned,
non-writable mount roots.

## Final fix and fail-closed proof

The workflow resolves `slicer` UID and primary GID from the immutable local
image ID with `--pull never`, `--rm`, `--network none`, `--cap-drop ALL`,
`no-new-privileges`, PID/output/time bounds, a fixed `/usr/bin/id` entrypoint,
and no shell interpolation. Empty, multiline, non-decimal, zero, oversized,
wrong-image, floating-image, or failed lookup is rejected. The running main
process is then cross-checked against host-kernel PID credentials so an
image-supplied false identity cannot pass.

Both runtime tmpfs mounts retain `rw,nosuid,nodev,noexec,size=64m` and add the
dynamic service `uid`, `gid`, and `mode=0700`. `Dockerfile` still ends with
`USER slicer`; no root entrypoint, image mutation, `chmod 777`, world-writable
mount, retry, timeout increase, health weakening, or tmpfs removal was added.
The health gate requires the container to be both running and healthy.

The one-time A/B/C matrix was removed from the final workflow. Durable evidence
retains exact image/service/kernel identity, bounded state and logs, SPDX JSON,
and Grype JSON. Evidence upload is allowlisted to four exact regular contained
files. Cleanup removes only this run's exact identity probes, main container,
image tag, evidence files, and scanner configs, emits one terminal
classification, and runs before the fail-closed final aggregator. Expected
absent-container and absent-image statuses are captured inside Bash conditional
contexts so the GitHub runner's implicit `errexit` cannot abort before
classification; unknown inspection or removal states still fail closed.

Image validation adds the two previously missing runtime gates. A bounded
helper creates (rather than directly runs) an exact-image container so its
64-hex container ID can be captured before execution. It then verifies the
immutable image ID and both `io.s3a.validation-only=true` and
`io.s3a.expected-image-id=<exact image ID>` labels before start and again before
cleanup. Removal targets only that captured ID. The fallback workflow cleanup
uses the same ownership tuple and refuses to remove a foreign container that
reuses a predictable name.

Inside that offline, non-root, read-only-rootfs container, Orca help must identify
`OrcaSlicer-2.3.1`. The synthetic fixture is a closed 10 mm manifold cube with
explicit, consistently wound unit normals and contains no customer data. Orca
uses the repository's production machine/process profile pair. Success requires
exactly one bounded regular G-code file, an OrcaSlicer 2.3.1 generator signature
within a bounded prefix, and a real `G1` extrusion command; mere nonempty output
cannot pass.

Hosted Source run `30003526788` passed on gate-extension commit
`4422d4018c98e594e666116fa3fd1bd2d7fcdaab`. Image run `30003526846`
passed build, exact identity, dynamic identity, main start, liveness,
diagnostics, SPDX, Grype, triage, evidence boundary/upload, and physical
resource removal, but failed closed in two newly exposed contracts. The Orca
child exceeded or otherwise failed within the smoke's 64 KiB capture envelope
and was classified `orca_slice_execution_failure`; final cleanup combined
Docker's absent-inspect `[]` stdout with its exact stderr, so safe absence was
misclassified as an unknown inspection state. The correction aligns the
internal Orca capture with production's bounded `1024 * 10000` bytes while
keeping the outer Docker output at 64 KiB, and emits only an exact-schema,
8 KiB-bounded, secret-free diagnostic on failure. Cleanup now captures inspect
stdout and stderr separately, accepts only empty/`[]` stdout plus an exact
not-found stderr, and retains the same ownership proof before deletion.

## Validation evidence

- Exact npm 10.9.8 clean install added 175 packages, audited 176, and reported
  zero vulnerabilities; `package.json` and `package-lock.json` did not change.
- Aggregate local tests: JavaScript 537/537; Python 43 discovered/run, 42 pass,
  one Windows-only POSIX permission mutation skipped. The skip is not called a
  pass; hosted Linux Source Validation covers the POSIX gate.
- Focused final workflow/liveness/mutation suite: 297/297. Required mutations
  cover hard-coded/root identity, numeric/empty/multiline/error lookup, wrong or
  floating image, missing isolation, missing/unsafe tmpfs options, one-mount
  repair, health/final weakening, cleanup omission, shell injection, invalid
  synthetic normals, weak Orca/G-code signatures, foreign labels, and name
  reuse.
- Syntax: 94 tracked JavaScript and 31 tracked Python files. Repository safety:
  213 tracked files; fix and correction stages separately passed staged safety.
- The local Docker client had no reachable daemon, so local image, liveness,
  Orca CLI/synthetic slice, SBOM, and Grype runtime gates are
  `NOT_RUN_ENVIRONMENT`; hosted Image Validation owns those results.

Hosted predecessor checkpoint `b2113516bb129007d27e5153e1d42089a437bb50`:

- Source Validation run `29971659761`: success.
- Image Validation run `29971659755`: exact image identity, kernel-identity
  cross-check, start, running+healthy liveness, bounded diagnostics, SPDX,
  Grype, triage, and evidence boundary/upload succeeded. The cleanup step's
  public conclusion was success because it used `continue-on-error`, but its
  native outcome was failure and the final aggregator reported
  `cleanup_failure`.

Commit `17c8a04c440c2ca75f8a5cadbfbe97682ea611a3` removed the unreliable
shell-output input and fail-closed directly on `steps.exact_cleanup.outcome`.
At documentation checkpoint `8be89e65a3b665f592dcc328c0cd6b3bc2ab3eb7`,
Source run `29972140254` passed. Image run `29972140281` again passed build,
identity, kernel cross-check, running+healthy liveness, diagnostics, SPDX,
Grype, triage, evidence boundary, and upload; its cleanup public conclusion was
success while its native outcome was failure, and final enforcement alone
reported `cleanup_failure`.

The exact cause was the GitHub runner's implicit Bash `-e`: an expected
not-present probe returned 1 as designed, but a bare function call triggered
`errexit` before `$?` could be captured or a cleanup classification emitted.
Commit `f4a5c7ab0aa0aab7a1f2eef9a56e5dded1201202` captures all four expected
absence probes in `if` contexts and adds a mutation that rejects the exposed
form. The later documentation commit intentionally does not name itself. Its
exact hosted Source/Image run IDs and terminal results are recorded in the I2
handoff.

The diagnostic Grype artifact reported HIGH=0, CRITICAL=0, and
`GHSA-hmx5-qpq5-p643` findings=0. Signature, attestation, immutable registry
promotion, branch protection, required-check repository settings, S4, S3b,
VPS state, and production readiness remain `UNVERIFIED`. I2 is not deployment
or production-promotion evidence.
