# S3a-V2C deterministic Swiper vendor upgrade evidence

## Scope, identity, and result

- Evidence date: `2026-07-22` (`Europe/Budapest`).
- Exact baseline: `edbe81ccbdba3a04312c800de636c1ee543674f2`.
- Branch: `codex/s3a-v2c-deterministic-swiper-vendor-upgrade`.
- Validated implementation commit: `44024749ed99d0cf2a8caf1db85d89d16dbca665`.
- Push/hosted run: pending until this evidence commit exists.
- Stage status at evidence-commit time: `PENDING_HOSTED_VALIDATION`.

The repository implementation and deterministic source tests are green at the
recorded counts below. At this pre-push snapshot the stage is not complete: the
local Docker client is 29.6.1 but no daemon is available, so the authorized
single normal branch push and its hosted validation runs are still pending.
Mandatory image, native-runtime, SBOM, Grype, and hosted gates therefore remain
unexecuted in this committed evidence snapshot. No skipped gate is represented
as a pass; the final task report must add the hosted results for the exact
pushed candidate SHA.

## Preserved Orca input and compatibility contract

The OrcaSlicer AppImage input is unchanged:

- URL:
  `https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.3.1/OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.3.1.AppImage`;
- SHA-256:
  `f199e5408914efdbbbfa4fd6752cd6ad4727209b488bc47bff9a0da5f053a701`;
- extraction remains at `/tmp/orca-squashfs-root`, the final copy remains
  `/opt/orcaslicer`, and the final `AppRun` symlink remains unchanged.

The upgrade modifies only the two extracted
`resources/web/{include,guide}/swiper` trees before the existing final copy. It
does not change the AppImage URL, checksum, native binaries, profiles, or
runtime command path.

The matching upstream Orca source commit is
`f2d10a0b5760c142e532e09f26fabd485579234c`. At that commit, the `include` and
`guide` Swiper trees are byte-identical: each contains 304 files totaling
4,769,103 bytes. Both report Swiper 7.2.0/MIT. Their old critical bundle hashes
are:

- JavaScript SHA-256:
  `62eb35c7dfb8f9d5bf358c805f3c8063fda32dbf0a81608f2179e8af2ca4ad0e`;
- CSS SHA-256:
  `f2a3140679d704bd07329d0768adc05ac21751dd5c558d3b9971ac504b48e79c`.

Direct Orca UI source inspection confirms use of the global `Swiper`
constructor, single-slide initialization, navigation, pagination, autoplay,
`slidesPerView: 'auto'`, `slidesPerGroup: 3`, and
`destroy(true, true)`. These are the compatibility behaviors exercised by the
browser harness.

## Verified Swiper release input

The only new vendor artifact is the official Swiper 12.1.2 npm tarball:

| Property | Exact value |
| --- | --- |
| URL | `https://registry.npmjs.org/swiper/-/swiper-12.1.2.tgz` |
| npm integrity | `sha512-4gILrI3vXZqoZh71I1PALqukCFgk+gpOwe1tOvz5uE9kHtl2gTDzmYflYCwWvR4LOvCrJi6UEEU+gnuW5BtkgQ==` |
| SHA-256 | `7780a8143baf0f021fcc3de927cc95c6b79e8fdc6d38e1f5ba2d0ed17d943457` |
| SHA-512 hex | `e2020bac8def5d9aa8661ef52353c02eaba4085824fa0a4ec1ed6d3afcf9b84f641ed9768130f39987e5602c16bd1e0b3af0ab262e9410453e827b96e41b6481` |
| Package metadata | `swiper`, version `12.1.2`, license `MIT` |
| Upstream tag commit | `2fd88b718b6854e8d6be7f183e68b73b68dae816` |
| Release | `https://github.com/nolimits4web/swiper/releases/tag/v12.1.2` |

Docker downloads the exact URL with redirects disabled. The installer rejects a
different source URL and verifies the SHA-256 plus both forms of SHA-512
evidence before extraction.

## Installer and transaction contract

`scripts/install-swiper-vendor.py` enforces the following fail-closed contract:

- at most 4 MiB compressed, 512 archive members, and 16 MiB total declared
  uncompressed bytes; archive iteration streams and fails immediately on member
  513 rather than materializing the full member list;
- one canonical `package/` top root; normalized relative paths only; no
  absolute, traversal, empty, duplicate, linked, or special members;
- manual member-by-member bounded extraction into a private staging directory,
  with containment rechecked before every write;
- exact package name, version, MIT license, required JS/CSS bundles, expected
  old JS/CSS bundle hashes, and nested metadata checks;
- one staged source used for both Orca trees, with file modes normalized to
  `0755` for directories and `0644` for files;
- a two-tree replacement transaction with distinct backups, rollback on any
  partial failure, backup/staging cleanup, and post-install tree equality.

A disposable install using the official artifact is `PASS`: both resulting
trees are byte-identical, each with 271 files totaling 3,370,217 bytes. Critical
bundle hashes are:

- JavaScript SHA-256:
  `73203b5c5f70f45b31428e9c82d30645ef407717ed84e732b32f96ab848f0a7f`;
- CSS SHA-256:
  `96ec55ae706747dcf60af4bb9e8c4e3dc50f5fd9edf30d25e0bb1c383526e7f9`.

No `.swiper-vendor-*` staging path or `.swiper-vendor-backup` residue remained
after the disposable success run.

## Offline browser build contract

The build-only browser stage uses the exact Playwright manifest-list selector
`mcr.microsoft.com/playwright:v1.55.0-noble@sha256:b27e719ecbfef153e13fd24e8341736733bf2658b229677eb21ff57ff5d7fb29`.
It copies the candidate JS/CSS directly from `slicer-base`, copies only the two
harness assets admitted by `.dockerignore`, switches to `pwuser`, and executes
exactly one bundled Chromium binary directly. The contract does not import the
Playwright Node package.

The browser `RUN` has `--network=none`, a 64 MiB tmpfs, a 30-second browser
timeout, bounded DOM output, and an exact pass marker. The real UI harness
checks the Orca behaviors above and includes a safe
`GHSA-hmx5-qpq5-p643` pollution proof. Its global mutations, event handlers,
console hook, and every Swiper instance are restored or destroyed during
teardown.

The final stage consumes the marker through an ephemeral read-only build mount.
It copies neither Chromium, the harness, nor the marker into the runtime image.
Static mutation tests reject a floating browser tag, restored networking,
missing tmpfs/bounds, candidate substitution, root execution, indirect browser
execution, absent marker proof, widened test context, and browser/marker copying
to the final image.

## Validation evidence

| Gate | Status | Exact result |
| --- | --- | --- |
| Exact npm 10.9.8 clean lock install | `PASS` | 175 packages installed with lifecycle scripts, audit, and funding disabled. |
| Focused browser/Docker source contracts | `PASS` | 18/18 tests. This is static/mutation evidence, not a Docker build or browser-container run. |
| Focused Python vendor/archive/transaction/source contracts | `PASS_WITH_SKIP` | 21 run: 20 passed, one Windows-only skip for POSIX permission mutation semantics, zero failures/errors; includes a regression forbidding `getmembers()`. |
| Aggregate exact npm 10.9.8 `npm test` | `PASS_WITH_SKIP` | JavaScript: 369 passed, zero failed. Python: 43 run, 42 passed, the same one Windows-only skip, zero failures/errors. |
| Exact npm 10.9.8 production audit | `PASS` | Zero vulnerabilities. |
| Tracked/candidate repository safety | `PASS` | Existing index: 174 files; isolated alternate-index candidate: 14 files. |
| Final JavaScript/Python syntax | `PASS` | Tracked: 67 JavaScript and 25 Python files. New-file checks: all four JavaScript files passed `node --check`; all six Python files passed `py_compile`. |
| Working-tree/range whitespace | `PASS` | Working diff, baseline tracked range, and isolated alternate-index all-candidate checks passed. |
| Docker build and browser build-stage execution | `NOT_RUN_ENVIRONMENT` | Docker client 29.6.1 is present; no daemon is reachable. |
| Final container start/liveness and dynamic browser runner | `NOT_RUN_ENVIRONMENT` | Requires a working Docker daemon. |
| Orca `--version`/`--help` and safe synthetic slice | `NOT_RUN_ENVIRONMENT` | Requires the built Linux image and native runtime. |
| Exact-image SBOM and Grype/GHSA scan | `NOT_RUN_ENVIRONMENT` | No image exists locally; total HIGH+CRITICAL findings are unknown. |
| Hosted Source/Image Validation | `PENDING_AUTHORIZED_PUSH` | The final candidate SHA and run URLs are intentionally unknown until the evidence commit and single authorized normal branch push complete. |

`PASS_WITH_SKIP` is not POSIX permission evidence. The installer sets the
required modes, but the skipped Windows test must run on Linux or in the Docker
build before that behavior is dynamically verified.

## Pending gates, remaining risk, and I2 handoff

The status at evidence-commit time is `PENDING_HOSTED_VALIDATION`, despite green
source suites. Local Docker gates cannot execute without a daemon; the hosted
gates are expected to execute after the authorized push. The currently
unexecuted gates leave these risks open:

- no proof that the full Docker build completes, the browser stage consumes the
  real remediated candidate, or the final image excludes its temporary inputs;
- no proof that Orca starts, reports its version/help, or completes a safe
  synthetic slice with Swiper 12.1.2 in the extracted resource trees;
- no exact-image SBOM, Grype result, GHSA disposition, or known HIGH+CRITICAL
  total;
- no Linux dynamic permission result and no hosted clean-checkout/context
  result;
- the unchanged Orca AppImage remains a checksum-bound executable extraction
  boundary, and other pre-existing floating Docker/package inputs remain
  outside V2C.

I2 integration must preserve the exact Orca/Swiper pins and hashes and consume
the final task report's exact pushed SHA and hosted Source/Image outcomes. It
must retain the green audit and syntax evidence, complete any gate that remains
unresolved, and must not reinterpret a pending or failed gate as a pass. Only
successful exact-candidate results can replace the `NOT_RUN_*` classifications.

## Forbidden-side-effect confirmation

This lane did not modify workflows, application routes/services/server code,
manifests/lockfiles, native Orca pins, profiles, shared Codex/Claude/Copilot
documentation, S3a-B2/I1/B1/V1 evidence, ignore/VEX/scanner policy, deployment
state, `main`, or the VPS. At this snapshot it had not weakened a scanner,
pushed, opened a PR, published an image, tagged, released, used SSH, or
deployed.
