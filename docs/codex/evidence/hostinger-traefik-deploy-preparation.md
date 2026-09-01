# Hostinger Traefik deploy-preparation evidence

## Classification

```text
SIGNED_MAIN_CANDIDATE_BF5E712_PUBLISHED_ATTESTED_VERIFIED
AUTOMATIC_EPHEMERAL_REHEARSAL_BLOCKED_CONFIG_COMPATIBILITY
OWNER_REPORTED_BF5E712_DARK_API_DEPLOYMENT_COMPLETE
OWNER_REPORTED_APPLICATION_ROLLBACK_ROUND_TRIP_COMPLETE
PUBLIC_ROUTE_DISABLED_AT_PREPARATION_CHECKPOINT
HOSTINGER_TRAEFIK_DEPLOY_PREPARATION_LOCAL_GATES_PASS
THIS_REPOSITORY_CHANGE_NO_HOST_ROUTE_DNS_FIREWALL_OR_CONSUMER_MUTATION
```

This document preserves the route-dark deploy-preparation checkpoint. The later
owner-supplied LeadPilot-only activation supersedes only its route-state
classification; see
[`hostinger-leadpilot-route-activation.md`](hostinger-leadpilot-route-activation.md).
The preparation facts and the time-qualified `NOT VERIFIED` list below remain
historical evidence for this checkpoint, not claims about the current route.

This corrective starts from exact protected-main source
`bf5e712071e3174a67fdb22ff3794003fa3ab32b`. The repository branch prepares and
hardens operator controls only: this change does not deploy or replace a
container, activate a router, write the mounted dynamic directory, change
DNS/firewall or the live allowlist, or modify a consumer repository. The later
dark deployment and application rollback observations below are an explicit
owner-supplied host report, not actions run or independently repeated by this
repository task.

## Signed candidate publication

Manual Candidate Publication run
[`33449382579`](https://github.com/Botond1/3D-Printer-Slicer-API/actions/runs/33449382579)
completed successfully in `publish_new` mode for the exact source above. Its
bounded artifact ID is `9779391177`, with artifact digest
`sha256:21386b71e183d5a5a41cceabbfac967f50e3a94a2424397286e72d87bd3d54fd`.
The downloaded `i11-main-candidate-provenance.json` has SHA-256
`32c886ae6b0ad303a7d273ca7ece6e10f489eb5390399c9b928b73e029f7f2e3` and
identifies the immutable subject:

```text
ghcr.io/botond1/3d-printer-slicer-api@sha256:153987840361d60c365da7b105769bb112de807db39a737548b725ea857918ca
```

The evidence reports one build, the same config digest before and after the
registry round trip, zero HIGH/CRITICAL scanner findings, successful SLSA and
SPDX signing, successful GitHub API/OCI/offline verification, rejection of the
wrong digest and repository, and exact cleanup. Provenance attestation
`44276625` and SPDX attestation `44276641` bind the exact subject and source.
The discovery-tag registry readback independently returned the same manifest
digest. The evidence states `deployed_digest=not_applicable_no_deploy`.

The automatically triggered, separate no-deploy rehearsal run
[`33450012850`](https://github.com/Botond1/3D-Printer-Slicer-API/actions/runs/33450012850)
failed closed before registry/runtime work with
`BLOCKED_SIGNED_MAIN_CANDIDATE_REHEARSAL_INPUT` and
`source_compatibility_verification_failure`. Exact local reproduction shows
that the policy's previous source `1fffab87960c675a053ae814d374cab331fbb14d`
is an ancestor and `docker-compose.production.yml` is unchanged, but `configs/`
differs from the candidate. This failure does not invalidate the successful
publication/attestation result, but it means the automatic ephemeral staging
and rollback rehearsal is not verified for this candidate.

## Owner-reported dark-host deployment and rollback precedent

On 2026-09-01 the owner reported that the production API was already running
the exact published, signed BF5E712 subject:

```text
ghcr.io/botond1/3d-printer-slicer-api@sha256:153987840361d60c365da7b105769bb112de807db39a737548b725ea857918ca
```

The image remained pinned to and attested for source
`bf5e712071e3174a67fdb22ff3794003fa3ab32b`; a later release tree supplied the
mounted J2/J3/J3B configs as separately identified operator input. The safety
envelope was unchanged, the API still published no host port, and the public
route remained disabled. The owner observed `/health` and `/ready` at HTTP 200;
`/profiles` returned all four catalogue entries with these inclusive values
alongside their declared values: Orca P1S `253.9/253.9/249.9`, Prusa P1S
`256/256/249.9`, and the two H2D-QUOTE entries `347.9/317.9/324.9` and
`350/320/324.9`. A 254.0 mm Orca model returned HTTP
422 with schema 2 and `MODEL_OUT_OF_PRINTER_BOUNDS`; the 253.9 mm boundary
completed a real slice with HTTP 200.

The first deployment attempt stopped safely before replacing the old container:
Compose derived a new project name from the release-specific working directory
and encountered the existing container name. The successful, repeatable form
pins the stable project identity explicitly:

```sh
docker compose -p slicer-api --env-file <new-operator-env> -f docker-compose.production.yml up --detach --no-deps --pull never slicer-api
```

The release directory may change for every release; the Compose project name
must not. The runbook and executable operator contract now require literal
`-p slicer-api` on every production Compose invocation and verify the running
container's `com.docker.compose.project=slicer-api` label.

Automatic run `33450012850` remains correctly failed closed with
`source_compatibility_verification_failure`: the intentional `configs/` change
does not become a CI pass. Under the route-dark substitute documented in the
runbook, the owner switched the actual host from the candidate to the previous
release and back to the candidate. The previous release became healthy within
15 seconds, the candidate became healthy again within 15 seconds, the route
remained dark, and the recovery set remained intact: the old image, prior
release directory and operator environment were retained, and pricing state was
saved. This closes only the candidate-specific application rollback-readiness
question. It does not verify source compatibility, public routing, TLS,
allowlisting, firewall behavior, the external allowed/denied caller matrix, or
customer traffic.

The operator contract deliberately keeps the API image source SHA, immutable
image digest, operator-pack commit, and mounted-file hashes as distinct
identities. It does not require the later operator release-tree commit to equal
the running image's source SHA. The live Traefik dynamic bind is a separate
path identity: router helpers must execute from the exact operator pack whose
`ops/hostinger/dynamic` directory is currently mounted, or stop with
`STOP_LIVE_DYNAMIC_RELEASE_MISMATCH`.

## Repository corrections

### Source allowlist

The router template has one attached Traefik v3 `ipAllowList` middleware and
one structurally singular placeholder. Rendering accepts exactly one canonical
IPv4 `/32` under the sole `leadpilot-only` phase. A second row, a wider prefix,
an expanded phase, `ipWhiteList`, `ipStrategy`, or forwarded-header identity
fails closed. No real caller address is stored in the repository.

### External redirect port

The entrypoint-level HTTP redirect targets literal external `:443`. The
container continues listening on `:8443`, but that internal port cannot become
the redirect authority. The runbook requires proof that `Location` contains no
explicit `:8443` and that a redirect-following external client reaches port
443.

### Live dynamic-directory identity

The release-local read-only mount remains unchanged. Before render, validation,
activation, disable, recovery, and terminal-dark checks, the operator must read
the running Traefik container's sole bind source for `/etc/traefik/dynamic` and
pass it to the helper. The helper canonicalizes the absolute input and requires
exact equality with its own release's canonical `ops/hostinger/dynamic`
directory. Any stale-release, relative, missing, non-directory, or symlink
input stops with `STOP_LIVE_DYNAMIC_RELEASE_MISMATCH`.

### Accepted host-level risk

The runbook now records that the one allowed address trusts a shared machine,
not one application; every current or future process on that host inherits the
network allowance. The address has no verified reservation, so VPS rebuild or
migration can silently admit a future assignee and exclude the intended caller.
The consumer must notify migration in advance, and the owner must re-verify and
replace the live allowlist/firewall identity before the new host is used.

The owner-observed empty `DOCKER-USER` chain and inactive UFW were preparation
inputs, not repository-verified current state. This checkpoint treated the
planned `DOCKER-USER` rule as the IPv4 host-network second layer. Later target-
host measurement showed that `[::]:443` uses docker-proxy without IPv6 DNAT and
therefore bypasses `DOCKER-USER`; the live dual-stack correction uses
`ip6tables INPUT` for IPv6 443. The current timeout/IPv6 mechanism and versioned
perimeter artifacts are recorded in
[`hostinger-leadpilot-route-activation.md`](hostinger-leadpilot-route-activation.md).
A port-443 policy cannot distinguish Host/SNI and remains accepted only while
this Traefik serves exactly one hostname; a second hostname is a mandatory stop
and redesign.

## Local evidence

The isolated branch starts exactly at the published protected-main source. The
first full test invocation was intentionally not accepted because this new
worktree had no installed packages and failed with missing `express`/`yauzl`.
The repository's exact clean-install command then installed 132 lockfile
packages with npm `10.9.8`, without lifecycle scripts, audit, or funding calls.
After that controlled setup, all final local gates passed:

| Gate | Result |
| --- | --- |
| Operator-pack validator | `i12_hostinger_operator_contract=PASS` |
| Focused Hostinger/instruction tests | 317/317 pass across operator contract, mutations, J2 network contract, and instruction mirrors |
| Complete JavaScript suite | 2428/2428 pass; 2 suites; 0 skipped |
| Complete Python suite | 166 run; 165 pass; 1 expected Windows POSIX-permission skip |
| JavaScript syntax | 262 tracked files |
| Python syntax | 46 tracked files |
| Tracked repository safety | 446 indexed files |
| Final documentation-stage safety | 11 indexed task files |
| Production dependency audit | 0 vulnerabilities |
| Compose interpolation | pass with inert `.invalid` email and existing-volume placeholder |
| Live-source CLI positive contract | `live_dynamic_source_contract=PASS` for the local canonical directory |
| Diff whitespace | pass |
| Privacy scan | no supplied/live IPv4 value; added literals are RFC 5737 fixtures only |

Implementation commit `0121502609191347e67b44c1f51155d2c7ba9d8c` is the
original frozen 18-file deploy-preparation tree. Runbook/contract correction
commit `f681b8368f40a7efa84110df24350545aab87c65` adds the mandatory Compose
project identity and the bounded dark-host rollback substitute without changing
the image, route, host, or automatic rehearsal guard.

## NOT VERIFIED at the preparation checkpoint

The following list records what this preparation task had not verified at its
route-dark stop point. It is intentionally preserved rather than rewritten with
later activation facts.

- independent repetition by this repository task of the owner-reported API
  deployment, profile/bounds/slice observations, or application rollback;
- the running Traefik bind source or correction of a stale release mount;
- installation or behavior of the live `ipAllowList` middleware;
- live redirect `Location` and redirect-following client behavior;
- any `DOCKER-USER`, UFW, Docker-proxy, DNS, TLS, or allowlist change;
- router activation, external allowed/denied-source observation, or traffic;
- automatic ephemeral staging/rollback rehearsal for the published candidate;
- staging/consumer integration or customer production readiness.

Only documentation-address fixtures may appear in tests. The repository
correction contains no owner caller address, credential, customer path, or live
private identifier.
