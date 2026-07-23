# I2 V2C integration and image-liveness evidence

## Scope and checkpoint

I2 starts from exact I1 checkpoint
`c6110e197ebe7e95d15ba597954108297251fb7b` on isolated branch
`codex/i2-v2c-liveness-integration`. It integrates source commits
`44024749ed99d0cf2a8caf1db85d89d16dbca665` and
`73f33e856860cec3b1975af1abb98fa65839dac8` as `cf45524` and
`9f8ae6b`, in that order. The executable I2 correction checkpoint is
`17c8a04c440c2ca75f8a5cadbfbe97682ea611a3`.

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
classification, and runs before the fail-closed final aggregator.

## Validation evidence

- Exact npm 10.9.8 clean install added 175 packages, audited 176, and reported
  zero vulnerabilities; `package.json` and `package-lock.json` did not change.
- Aggregate local tests: JavaScript 508/508; Python 43 discovered/run, 42 pass,
  one Windows-only POSIX permission mutation skipped. The skip is not called a
  pass; hosted Linux Source Validation covers the POSIX gate.
- Focused final workflow/liveness/mutation suite: 268/268. Required mutations
  cover hard-coded/root identity, numeric/empty/multiline/error lookup, wrong or
  floating image, missing isolation, missing/unsafe tmpfs options, one-mount
  repair, health/final weakening, cleanup omission, and shell injection.
- Syntax: 92 tracked JavaScript and 31 tracked Python files. Repository safety:
  210 tracked files; fix and correction stages separately passed staged safety.
- The local Docker client had no reachable daemon, so local image, liveness,
  Orca CLI/synthetic slice, SBOM, and Grype runtime gates are
  `NOT_RUN_ENVIRONMENT`; hosted Image Validation owns those results.

Hosted predecessor checkpoint `b2113516bb129007d27e5153e1d42089a437bb50`:

- Source Validation run `29971659761`: success.
- Image Validation run `29971659755`: exact image identity, kernel-identity
  cross-check, start, running+healthy liveness, bounded diagnostics, SPDX,
  Grype, triage, evidence boundary/upload, and exact cleanup all succeeded. The
  final aggregator alone failed because it consumed a shell-output
  classification instead of the native cleanup outcome.

Commit `17c8a04c440c2ca75f8a5cadbfbe97682ea611a3` removes that unreliable
aggregator input and fail-closes directly on `steps.exact_cleanup.outcome`;
focused outcome mutations pass. The later documentation commit intentionally
does not name itself. Its exact hosted Source/Image run IDs and terminal results
are recorded in the I2 handoff.

The diagnostic Grype artifact reported HIGH=0, CRITICAL=0, and
`GHSA-hmx5-qpq5-p643` findings=0. Signature, attestation, immutable registry
promotion, branch protection, required-check repository settings, S4, S3b,
VPS state, and production readiness remain `UNVERIFIED`. I2 is not deployment
or production-promotion evidence.
