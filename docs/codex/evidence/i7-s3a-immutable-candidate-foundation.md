# I7/S3a immutable-candidate foundation evidence

## Scope and status

This evidence describes repository implementation and local validation only.
The I7 candidate has not yet received its final commit SHA or hosted workflow
run:

- production Compose contract: `IMPLEMENTED_AND_TESTED`;
- exact-candidate provenance: `IMPLEMENTED_AND_LOCALLY_TESTED`;
- I7 hosted target: `PENDING_HOSTED_VALIDATION`;
- registry digest, signature, attestation: `NOT_CREATED`;
- deployed digest: `NOT_APPLICABLE_NO_PUBLISH`;
- S3b: `NOT_STARTED`;
- production readiness: `UNVERIFIED`.

No image, package, signature, attestation, deployment, secret, firewall, proxy,
or VPS state was created or changed.

## Direct data-flow map

`Dockerfile` + package lock + pinned Prusa/Orca/Swiper inputs
→ one `linux/amd64` build
→ one run-local image ID
→ runtime identity, Orca, browser, liveness, topology and cleanup gates
→ SPDX 2.3 SBOM + Grype result
→ bounded exact-candidate provenance
→ explicit evidence artifact
→ operator-supplied immutable production image reference
→ internal API bridge
→ separately operated authenticated reverse-proxy peer.

The Image Validation workflow remains no-push/no-deploy. Its local image ID is
not a registry digest and cannot be used as one.

## Production Compose contract

`docker-compose.production.yml` contains exactly one `slicer-api` service and
one `slicer-api-private` network. The network is a named internal bridge. The
service has no `build`, `ports`, proxy, privileged mode, host namespace, added
capability, or Docker socket. It preserves:

- non-root numeric UID/GID and runtime identity expectations;
- read-only root, `no-new-privileges`, and all capabilities dropped;
- PID, memory, swap, CPU, tmpfs, log, restart, health, and shutdown limits;
- explicit root-scoped input, output, configs, and pricing-state binds;
- operator-managed external environment file; no literal service secret.

Raw Compose checks only that `SLICER_API_IMAGE` is present. The mandatory
validator enforces the full lowercase immutable reference before Compose:

```sh
export SLICER_API_IMAGE='registry.example.invalid/owner/3d-printer-slicer-api@sha256:0000000000000000000000000000000000000000000000000000000000000000'
export SLICER_ENV_FILE='./operator/service.env'
export SLICER_UID='10001'
export SLICER_GID='10001'
node scripts/i7-production-compose-contract.js &&
  docker compose -f docker-compose.production.yml config --quiet
```

The all-zero digest and paths are inert documentation values. Under a separate
authorized operation window, verified values use the same preflight:

```sh
node scripts/i7-production-compose-contract.js &&
  docker compose -f docker-compose.production.yml up -d --pull always
```

The reverse proxy remains outside this Compose file. Its own stack may declare
the existing `slicer-api-private` network as external and attach the proxy to
that bridge plus a separately approved ingress network. It must authenticate
to the API and must not expose generic forwarding, NAT, or DNS tunnelling.
Actual proxy/firewall/secret/digest/VPS behavior remains `UNVERIFIED`.

## Provenance and evidence boundary

The workflow builds once and reuses the exact local image for all gates.
Following successful exact resource cleanup, the writer:

- reads only bounded regular non-link evidence and repository input files;
- requires every named exact-image gate outcome and classification to succeed;
- correlates the source SHA, repository, workflow run/attempt/job, candidate
  image reference, local image/build ID, configured user, and kernel UID/GID;
- hashes `Dockerfile`, `package.json`, `package-lock.json`, and the SPDX file;
- records exact Prusa 2.8.1, Orca 2.3.1, and Swiper 12.1.2 pins;
- records Grype 0.110.0 and only
  `descriptor.db.status.built` as the scanner database timestamp;
- records zero HIGH, CRITICAL, and known Swiper advisory findings;
- records private-peer/no-host-port/no-default-route/API/native-denial and live
  abort/process-settlement proofs;
- emits an exact-key JSON schema capped at 64 KiB with no absolute host paths.

The artifact allowlist is exactly:

- `candidate-provenance.json`;
- `image-identity.txt`;
- `runtime-diagnostics.json`;
- `topology-evidence.json`;
- `sbom.spdx.json`;
- `grype.json`.

The workflow revalidates source/run/job/image/SBOM correlation, uploads those
six explicit paths with short retention, removes only the exact run-scoped
evidence, and makes provenance, upload, resource cleanup, and evidence cleanup
mandatory final-gate inputs.

## Prior hosted evidence carried forward

I6 is the latest hosted observation available before the I7 commit:

- Source run `30158571811`, job `89680008807`: success;
- Image run `30158571816`, job `89680008864`: success;
- artifact `8619644435`;
- run-local image ID
  `sha256:a78d4e5c4d76fe039e51fd4c1c44197b7c0425793eaf0d7dbac44ebc5e747e2`;
- SPDX 2.3 SBOM hash prefix `f242c215`;
- Grype 0.110.0 database built `2026-07-25T06:59:38Z`;
- HIGH `0`, CRITICAL `0`, known Swiper advisory `0`;
- private-peer topology proof booleans: all true.

These facts prove I6 hosted behavior only. They do not claim an I7 hosted run,
a registry artifact, or deployed production state.

## Read-only repository policy observation

- repository visibility/default branch: public / `main`;
- branch protection endpoint: HTTP 404;
- repository rulesets: none returned;
- classification: `BRANCH_PROTECTION_UNVERIFIED_OR_ABSENT`;
- Actions: enabled, `allowed_actions=all`;
- default workflow permission: read; workflows cannot approve pull requests;
- environments: none returned;
- registry/package target: `UNVERIFIED` because the token lacked
  `read:packages`.

This evidence does not silently enable policy or infer package absence.

## Build-input audit

| Input | Observation | I7 action |
| --- | --- | --- |
| `package-lock.json` | integrity-locked graph | hashed in provenance; unchanged |
| Prusa/Orca AppImages | exact versions, URLs, SHA-256 values | verified against active Dockerfile assignments |
| Swiper vendor | exact URL, SHA-256, SHA-512 | verified against Dockerfile and installer |
| GitHub Actions | exact commit SHAs | unchanged |
| Playwright base | digest points to a manifest list; current `linux/amd64` child was observed | unchanged; platform remains explicit |
| Ubuntu `24.04` base stages | floating tag | `UNVERIFIED`, outside delta |
| Python requirements | unpinned/floating versions and transitives | `UNVERIFIED`, outside delta |
| Apt, NodeSource, pip transitives | externally resolved | `UNVERIFIED`, outside delta |
| Development `uptime-kuma:1` | floating dev-only input | `UNVERIFIED`, outside production contract |
| Production service image | only accepted as canonical digest reference by mandatory validator | implemented; no digest created |

No unverified digest or dependency hash was invented.

## Local validation

- exact npm 10.9.8 clean install: passed, 132 packages;
- full aggregate: JavaScript 930/930 passed; Python 42 passed, one expected
  Windows POSIX-permission mutation skipped;
- focused I7/workflow contracts: 379/379 passed;
- affected compatibility contracts: 80/80 passed;
- exact npm production audit: zero vulnerabilities;
- tracked syntax: 157 JavaScript and 32 Python files passed;
- explicit syntax for all new I7 JavaScript files: passed;
- `docker build --check --file Dockerfile .`: passed with no warnings;
- production validator and `docker compose ... config --quiet`: passed with the
  inert digest fixture;
- missing image reference: failed closed;
- `git diff --check`: passed;
- `actionlint`: `NOT_RUN_ENVIRONMENT` because it was not installed.

No production `up`, pull, push, publish, sign, attest, or deploy command was
executed.
