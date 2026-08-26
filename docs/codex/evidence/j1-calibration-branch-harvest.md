# J1 calibration branch harvest

Date: 2026-08-26

Classification:
`J1_BRANCH_HARVEST_IMPLEMENTED_LOCAL_GATES_PASS;
J1_ANONYMIZED_PUBLIC_SCOPE_PRIVACY_SCAN_PASS;
OWNER_NAME_DENYLIST_NOT_VERIFIED;
J1_LIVE_BAMBU_CALIBRATION_BLOCKED_OWNER_INPUT;
NO_PUSH_NO_REGISTRY_WRITE_NO_DEPLOY_NO_PUBLIC_ROUTE`.

## Authority, provenance, and boundary

This record covers the local J1 harvest on branch
`codex/j1-calibration-branch-harvest` in an isolated worktree. The exact J0
base is `c36da205ce0158304b3b2fa40a2fabdce92655d6`; the code-bearing J1 commit is
`c4dad76c82d47f739983bf8ee1fed7cd1e8a00cf`. The separately reviewed source
branch identity was `claude/sz-b2-orca-headless` at
`01d89c5ed827b38bef43d68bec5c7814386b6a18`.

The source branch's private calibration document was not opened, copied,
committed, or pushed. The public
[`docs/kalibracio-2026-08.md`](../../kalibracio-2026-08.md) was created only
from the owner-supplied anonymized J1 input, preserving anonymous `M01` through
`M10` identities and hashes without private paths, names, lead IDs, or order
IDs. No command in this lane addressed a private model path.

This is local repository evidence only. It grants no authority for a push,
registry write, image publication, deployment, VPS mutation, public-route
activation, Docker prune, or consumer-repository change. None occurred.

## Harvest ledger

### Category A: new functionality retained and hardened

- [`app/services/slice/gcode-metrics.js`](../../../app/services/slice/gcode-metrics.js)
  provides bounded, strict time, direct-mass, and filament-length parsing with
  the mandatory marker-drift negative control.
- The repository now contains bounded generic PLA and PETG filament profiles,
  the generic H2D candidate, and the explicit
  [`H2D-PROFIL-TODO.md`](../../../configs/orca/H2D-PROFIL-TODO.md) blocker.
- [`scripts/sz-b2-orca-calibration.js`](../../../scripts/sz-b2-orca-calibration.js)
  retains the calibration workflow but was integrated behind anonymous
  manifests, neutral staging, exact-image identity, resource limits, sanitized
  durable output, and exact-owned cleanup.
- [`docs/sz-b2-orca-runtime.md`](../../sz-b2-orca-runtime.md) and the strict
  parser tests document and enforce the resulting runtime contract.

### Category B: anonymized document only

The destination calibration worksheet is the owner-supplied anonymized
version. The source branch document was deliberately not used.

### Category C: both J0 and harvested intent preserved

- Orca native arguments preserve J0 `--arrange 1` / `--orient 0` and add the
  selected filament snapshot as the last `--load-settings` layer.
- Profile selection, snapshotting, and digesting preserve the J0 effective
  machine/process contract and bind normalized material plus exact selected
  filament JSON, or an explicit null filament layer.
- Response and OpenAPI preserve J0 `effective_profile_sha256` and actual
  startup-resolved `engine_version`, while adding required-but-nullable direct
  mass and nullable filament basename/diameter/density.
- Central resource policy adds bounded `MAX_MATERIAL_USED_GRAMS`; strict metric
  mode defaults on through `SLICE_STRICT_GCODE_METRICS`.
- Existing J0 service, command, and route implementations were not replaced by
  older source-branch equivalents. Missing assertions were mined into current
  J0 tests instead.

### Category D: protected main/J0 files unchanged

The exact base-to-J1 comparison returned:

```text
D_UNCHANGED PASS count=6
D_HASH app/services/slice/child-environment.js d911dd4cf4cacc15e7137b3cc4256d58ba222f13
D_HASH scripts/i2-orca-runtime-smoke.js dc3e12680ebf0d436e2b7de6dbbc5fd4960314dc
D_HASH scripts/i2-image-runtime-diagnostics.js ddda43c1095d45df43edd9b19721b8e1012ecdb9
D_HASH scripts/render-image-vulnerability-summary.js 8fdb2f90be6a41c157768de4d3ca92c4e50400bc
D_HASH scripts/run-js-tests.js 824058f63f226065e08a260caa9a1df3d1c8fbbd
D_HASH .github/workflows/image-validation.yml c7d690bb2497c3205cd7615f07f4c0b4b04270cf
```

### Category E: assertions mined, obsolete implementations rejected

Transferred into current J0-owned tests:

- real Prusa and Orca route ordering (`limiter -> authentication -> request
  lifecycle`) and zero allocation for unauthorized calls;
- an authentication-removal mutation that must fail closed;
- distinct parsed native versions for the two actual engine families;
- Windows case-insensitive child-environment lookup and omission of empty
  optional values.

Not transferred:

- the retired authentication middleware and its header/equality tests, because
  J0's timing-safe `requireSliceService` contract is stronger;
- legacy profile-hash cases already covered by J0 exact-byte snapshots,
  inheritance, canonicalization, selected/null filament identity, and
  parent-only mutation tests;
- legacy slicer-version cases superseded by bounded startup `--help`, atomic
  publication, cache/retry, actual-family parsing, and no request-time child;
- remaining legacy child-environment cases already covered by J0's stricter
  minimal allowlist, POSIX writable-home, temp-root, secret-exclusion, and
  exact-command contracts.

No obsolete Category E file was copied wholesale.

## Resulting runtime contract

Strict mode requires positive native time and filament-length markers. A
non-null FDM mass is accepted only from a direct native G-code grams marker and
is never calculated from length, diameter, or density.

- Selected-profile Orca requires positive direct grams within policy; a
  missing or drifted marker maps to bounded HTTP 500
  `SLICE_OUTPUT_UNPARSED`.
- Profile-less Orca remains successful with null filament metadata, null mass,
  null hourly rate, and null estimated price. Its digest is distinct from the
  selected-profile digest.
- The current Prusa FDM profile emits no direct grams marker. It therefore
  returns null mass/rate/price for manual pricing, never zero or a derived
  value. Positive time and length remain mandatory.
- SLA pricing remains independent of the FDM direct-mass guard.
- Selected PLA/PETG profile metadata must contain exactly one matching material
  type and exactly one positive used diameter and density. Those exact values
  are returned under `profiles` and are digest-bound.

## Calibration-runner privacy and cleanup boundary

The runner accepts a bounded owner-controlled external manifest with anonymous
public IDs and private local references. It validates the IDs, lowercase exact
SHA-256 values, memory, CPU, model size, and exact immutable image identity. It
copies a private input through Node filesystem APIs into a
neutral run-owned `0700` staging root with a `0600` neutral filename, verifies
the exact hash, and passes only that neutral staged path into Docker arguments.
The original private reference remains in the owner-controlled external
manifest and is necessarily read by the runner. The runner does not propagate
it into generated Markdown, its progress/error output, Docker argv, or
container result records.

The container is networkless, read-only, non-root, capability-dropped,
PID/memory/CPU bounded, and label-bound. Cleanup first inspects and proves the
exact generated name, run label, purpose label, and immutable image ID. Only
that exact identity may be force-removed, followed by an exact-name absence
proof. Foreign image/name/label identities produce zero removals; missing,
malformed, and Docker-error seams fail closed. The staging file and root are
bound at creation to canonical path, device, inode, and birth-time identity;
cleanup rechecks regular type and that identity. Deterministic same-name foreign
file/root replacements are refused without deletion.

The retained P1S and new H2D candidates identify as generic Marlin profiles,
not verified native Bambu profiles. W8 therefore remains
`BLOCKED_OWNER_INPUT` pending owner-supplied real machine/process/material
references, ten approved anonymous model hashes, and acceptance thresholds.

## Local verification evidence

### Toolchain and clean install

```text
10.9.8

added 132 packages, and audited 133 packages in 5s

24 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

### Syntax and complete aggregate

Exact syntax output:

```text
JavaScript syntax OK: 251 tracked file(s).
Python syntax OK: 39 tracked file(s).
```

Exact final JavaScript aggregate tail from `npm test`:

```text
ℹ tests 2210
ℹ suites 2
ℹ pass 2210
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 13424.9787
```

Exact final Python aggregate tail from the same command:

```text
----------------------------------------------------------------------
Ran 85 tests in 4.871s

OK (skipped=1)
Python unit summary: discovered=85 run=85 passed=84 failed=0 errors=0 skipped=1 expected_failures=0
```

The one skip is the pre-existing Windows/POSIX permission-mutation case; no
test was disabled, removed, or weakened for J1.

### Focused, supply-chain, and immutable-compose regressions

```text
ℹ tests 95
ℹ suites 2
ℹ pass 95
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 767.4135

ℹ tests 363
ℹ suites 0
ℹ pass 363
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1567.4161

ℹ tests 109
ℹ suites 0
ℹ pass 109
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 264.779
```

The focused run includes the required negative control and the selected/null
filament behavior:

```text
✔ Orca filament qualification still rejects a missing direct mass marker
✔ default strict integration rejects drift instead of accepting silent zeros
✔ successful Orca slicing without a filament profile requires manual pricing
✔ successful Prusa slicing without a native mass marker stays explicit and manual
✔ SLA pricing remains independent of the FDM direct-mass guard
✔ Orca digest excludes request overrides but covers machine, process, and server invariants
✔ profile identity binds the request-independent native invocation policy
```

One real local Prusa run against a repository-generated, customer-free
synthetic STL exited successfully and confirmed the current native marker
shape without retaining its temporary model or G-code:

```text
{"status":0,"signal":null,"time_marker":true,"length_marker":true,"direct_gram_marker":false}
PRUSA_NATIVE_TEMP_LEFTOVERS 0
```

This is a local Prusa marker characterization only, not Bambu calibration or
container evidence.

### Safety, dependency, and privacy gates

```text
Repository safety OK: 418 tracked indexed file(s); limit=1048576 bytes.
Repository safety OK: 48 staged indexed file(s); limit=1048576 bytes.
found 0 vulnerabilities
```

After this evidence file was added, the final committed-tree safety rerun was:

```text
Repository safety OK: 419 tracked indexed file(s); limit=1048576 bytes.
```

`git diff --cached --check` returned exit 0 with no output before the
implementation commit.

The token-aware `git grep -inE` scan over the complete implementation commit
returned zero semantic matches for all three prompt-mandated identifier/path
patterns:

```text
COMMIT_TREE_TOKEN_GIT_GREP commit=c4dad76c82d47f739983bf8ee1fed7cd1e8a00cf matches=0
PRIVACY_GIT_GREP_CHANGED files=48 matches=0
PRIVACY_GIT_GREP_TREE_EXCLUDING_LOCK matches=0
```

A deliberately broader substring-only scan was not hidden: it found one
unchanged J0-baseline occurrence in `package-lock.json`. Structural parsing
proved that it is only an accidental base64 substring inside an SRI `integrity`
value, not an identifier, path, package field, or J1 change:

```text
PRIVACY_TREE_COMPARE base_files=1 head_files=1 new_files=0 removed_files=0
BASELINE_MATCH_PATH package-lock.json
LOCKFILE_STRUCTURAL_PRIVACY_SCAN integrity_matches=1 other_matches=0
```

The staged added-line scan also returned:

```text
PRIVACY_SCAN added_lines=3856 generic_content=0 generic_paths=0 absolute_user_paths=0
```

The final two-commit tree, including this evidence record, returned:

```text
FINAL_PRIVACY changed_files=49 changed_matches=0 tree_ex_lock_matches=0 token_tree_matches=0
```

An owner/customer-name denylist was not available without opening the forbidden
private source document. That specific name-denylist check is therefore listed
as `NOT VERIFIED` below rather than inferred.

### Requested J0 temporary-copy cleanup

The three explicitly named J0 temporary source copies were removed. Exact
post-cleanup probes returned:

```text
TEMP_COPY_PRESENT False
TEMP_COPY_PRESENT False
TEMP_COPY_PRESENT False
```

## What is still NOT VERIFIED

- Docker Desktop's daemon was unavailable, so no J1 exact-image build, native
  Orca 2.3.1 calibration run, live container identity/removal, or live
  post-run residue proof was performed. The read-only probe returned:

  ```text
  failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; check if the path is correct and if the daemon is running: open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
  ```

- Abrupt runner-process or host death after Docker creation has no live
  residue-recovery proof; only deterministic seam tests cover ordinary success,
  foreign identity, absence, malformed inspect, and control-error paths.
- Staging cleanup refuses replacements visible at its identity checks, but Node
  path-based `unlink`/`rmdir` does not provide an atomic directory-fd unlink
  contract. A hostile same-user swap after the final check is not live-proven
  impossible and remains `NOT VERIFIED`.
- Real vendor P1S/H2D machine and process profiles, owner-approved spool
  references, the ten private calibration models, peak RSS/capacity, Bambu
  Studio comparison tolerance, and owner acceptance thresholds remain
  `BLOCKED_OWNER_INPUT` and untested.
- The forbidden private source document and private model paths were not opened,
  so an owner-specific customer-name denylist scan is `NOT VERIFIED`. The
  anonymized input, generic patterns, changed files, and public commit tree are
  the verified privacy scopes.
- Hosted CI, a J1 image/SBOM/scan, registry publication, VPS deployment,
  hostname/DNS/firewall/certificate state, public route, monitoring/recovery,
  customer traffic, and WooCommerce/LeadPilot consumer acceptance are all
  `NOT VERIFIED`. J1 authorizes none of them.
