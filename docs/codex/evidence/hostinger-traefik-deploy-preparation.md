# Hostinger Traefik deploy-preparation evidence

## Classification

```text
SIGNED_MAIN_CANDIDATE_BF5E712_PUBLISHED_ATTESTED_VERIFIED_NO_DEPLOY
AUTOMATIC_EPHEMERAL_REHEARSAL_BLOCKED_CONFIG_COMPATIBILITY
HOSTINGER_TRAEFIK_DEPLOY_PREPARATION_LOCAL_GATES_PASS
LIVE_MOUNT_REDIRECT_ALLOWLIST_FIREWALL_NOT_VERIFIED
NO_DEPLOY_NO_CONTAINER_ROUTE_DNS_FIREWALL_OR_CONSUMER_MUTATION
```

This corrective starts from exact protected-main source
`bf5e712071e3174a67fdb22ff3794003fa3ab32b`. It prepares repository controls
for a later owner-run VPS change. It does not deploy or replace a container,
activate a router, write the mounted dynamic directory, change DNS/firewall or
the live allowlist, or modify a consumer repository.

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

The owner-observed empty `DOCKER-USER` chain and inactive UFW are inputs, not
repository-verified current state. Docker-published ports can bypass UFW, so
the planned `DOCKER-USER` rule is the only host-network second layer. A port-443
rule cannot distinguish Host/SNI and is accepted only while this Traefik serves
exactly one hostname; a second hostname is a mandatory stop and redesign.

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
| Focused Hostinger/instruction tests | 308/308 pass |
| Complete JavaScript suite | 2419/2419 pass; 2 suites; 0 skipped |
| Complete Python suite | 166 run; 165 pass; 1 expected Windows POSIX-permission skip |
| JavaScript syntax | 262 tracked files |
| Python syntax | 46 tracked files |
| Tracked repository safety | 445 indexed files |
| Staged repository safety | 18 indexed task files |
| Compose interpolation | pass with inert `.invalid` email and existing-volume placeholder |
| Live-source CLI positive contract | `live_dynamic_source_contract=PASS` for the local canonical directory |
| Diff whitespace | pass |
| Privacy scan | no supplied/live IPv4 value; added literals are RFC 5737 fixtures only |

Implementation commit `0121502609191347e67b44c1f51155d2c7ba9d8c` is the
exact frozen 18-file deploy-preparation tree. The following evidence-only
commit records that identity without changing the implementation.

## NOT VERIFIED

- deployment or replacement of the running API or Traefik container;
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
