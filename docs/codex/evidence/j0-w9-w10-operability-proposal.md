# J0 W9/W10 operability proposal

## Classification and boundary

`PROPOSAL_ONLY; BLOCKED_OWNER_ENDPOINT_DESTINATION_CREDENTIALS_APPROVAL`

This document proposes a small single-host monitoring, backup/recovery and
release-layout contract. It does not install software, create a third-party
account or repository, transmit a ping, read or move a secret, change a live
timer, alter a checkout, restart a service, delete a file, or activate a route.
It intentionally records no real host address, credential, private absolute
path, or host-hardening inventory.

## Repository design inputs

The production API uses Docker's `json-file` log driver with `max-size=20m` and
`max-file=5` in
[`docker-compose.production.yml`](../../../docker-compose.production.yml).
The same values are passed to the container's self-check through
`EXPECTED_LOG_MAX_SIZE` and `EXPECTED_LOG_MAX_FILES`. This repository contract
is a design input only. Live configuration, capacity, alert delivery, backup,
recovery, source-layout and host-hardening state are intentionally not recorded
in this public proposal and require private, separately authorized readback.

The API already exposes liveness, readiness, protected detailed health and
fixed-cardinality metrics through
[`app/routes/system.routes.js`](../../../app/routes/system.routes.js). Queue
state is part of the readiness result in
[`app/services/readiness.service.js`](../../../app/services/readiness.service.js),
and the fixed-cardinality counters/gauges are defined in
[`app/services/observability/metrics.js`](../../../app/services/observability/metrics.js).

## Minimal monitoring proposal

Use one local root-owned systemd oneshot plus timer, paired with one
Healthchecks.io dead-man check. The local probe remains the source of truth;
the external service receives only a success/failure ping and timing, never
application logs, queue contents, model names, credentials or customer data.
The owner chooses the alert recipients and owns the account.

Each bounded probe cycle should:

1. check local/private `/health` and authenticated fresh
   `/health/detailed`, with the operations credential read from one root-owned
   mode `0600` file and never placed in argv, unit text or logs;
2. sample `/operations/metrics` for readiness, queue length/active work,
   rejection and native error deltas;
3. inspect only allowlisted API container state for health, restart count,
   OOM state and the expected CPU/RAM/PID/log envelope;
4. check filesystem capacity against owner-approved warning and critical
   thresholds;
5. scan only a bounded recent Docker-log window for structured server/native
   failures and report counts, not raw payloads;
6. send the success ping only after every mandatory check passes, otherwise
   send the check's failure signal when safe and exit nonzero. A missing ping
   must independently alert after the owner-approved grace period.

Keep the probe result fixed-cardinality and sanitized. Store the ping URL and
operations credential outside every checkout in separate root-owned mode
`0600` files. Apply bounded retries so a short restart does not page, but never
convert persistent not-ready, OOM, disk-critical, queue-stuck or error-rate
conditions into success. The owner must approve the recipient, quiet-hours
policy, thresholds and escalation route before installation.

## Encrypted backup and recovery proposal

Use restic with an owner-controlled S3-compatible repository. For Backblaze B2,
use its S3-compatible API rather than restic's native B2 backend, following
restic's current backend guidance. Create a least-privilege backup credential
and a distinct repository password; store each in a root-owned mode `0600` file
outside all checkouts and process arguments. No repository URL, key or password
belongs in Git, a systemd unit, Docker inspect output, or the backup report.

Back up only state that cannot be recreated from a protected Git commit and an
immutable signed image:

- the active ACME volume's `acme.json`, preserving its required mode and
  ownership metadata;
- the writable pricing state represented by
  [`configs/pricing-state`](../../../configs/pricing-state);
- operator-managed Orca/Prusa profile bytes only when they differ from or are
  not recoverable from the verified release source;
- the root-private canonical source files from which the production service
  environment and scoped credentials are rendered.

Do not back up registry images, Git checkouts, dependency caches, temporary
input/workspace files, generated slice artifacts, container layers, routine
logs, or reproducible operator-pack files. Customer-bearing input/output must
not enter this backup scope without a separate retention and privacy decision.

A concrete low-cost starting policy is one encrypted backup per day with 7
daily, 4 weekly and 6 monthly snapshots, subject to owner approval of RPO,
retention and storage cost. The owner must also approve the bucket lifecycle
and object-version retention so provider-side deletion and cost behavior stay
consistent with restic's `forget`/`prune` policy and the required recovery
window. Every run must preflight an exact allowlist of regular/non-link source
identities, create a bounded sanitized report, run repository integrity checks
on an agreed cadence, and alert through the same dead-man channel. Backup
success alone is not recovery proof.

Before route activation, perform one restore drill into a newly created private
temporary tree with mode `0700`. Never restore over the live ACME file, pricing
state, profile tree or environment source. From the isolated restore:

1. verify the snapshot and expected allowlisted file inventory;
2. verify regular/non-link types, owner/mode policy, byte hashes and bounded
   sizes without reporting secret contents;
3. parse the restored configuration and pricing/profile structures with
   offline validators;
4. render the production Compose contract using inert validation values where
   secrets are not required;
5. record RPO and restore duration, then remove only the exact drill-owned tree
   after its identity and owner acceptance are proven.

An actual disaster restore is a separate change: disable the public route,
stop writers, capture current evidence, restore to a new path, validate, and
atomically select it only under an owner-approved recovery runbook. The drill
must never overwrite live state.

## W10 release-layout proposal

Consolidate operator-controlled deployment material under one canonical,
versioned release root without making the API image source and operator-pack
source look like the same identity. Use this logical layout; the owner chooses
the real private absolute root:

```text
<operator-release-root>/
  releases/<operator-main-full-sha>/
  current -> releases/<operator-main-full-sha>/
  state/              # env/credential source references, never committed
  recovery/           # bounded private ledgers and restore evidence
```

Each release directory is immutable after qualification and contains a small
manifest that separately records the operator-pack SHA, exact API source SHA,
immutable API digest, proxy image digest, Compose source hashes and expected
resource envelope. Switch `current` atomically only after the new release
passes its dark gates. Compose operations resolve one canonical `current`
target and use the owner-managed state outside the release directory.

The proposed retention policy should name one qualified rollback release plus
its immutable images, state references and recovery ledger. Before any
consolidation, the owner must privately identify the canonical current and
rollback sources. Archive or remove any superseded source tree only in a later,
separately approved, identity-bounded action after current and rollback recovery
are proven. Never use a broad move, delete or Docker prune operation.

W1 resource decisions are one atomic release-envelope change. In particular,
`MAX_CONCURRENT_SLICES`, rate/queue settings, `SLICER_CPU_LIMIT`, memory/PID
limits and their matching `EXPECTED_*` self-check values must be reviewed and
rendered together. The Compose source already derives the expected CPU, memory,
PID and log values from the same operator inputs in
[`docker-compose.production.yml`](../../../docker-compose.production.yml); a
release gate must prove the rendered Compose values and runtime inspect still
match after any W1 or later render-related limit change.

## Required owner inputs and authority

1. Healthchecks.io account ownership, recipient list, ping endpoint, alert
   grace period, thresholds and permission to install/enable the local units.
2. The owner-controlled S3-compatible destination, region, least-privilege
   credentials, restic repository password, cost limit, RPO/RTO, snapshot
   retention, bucket lifecycle and object-version retention approval.
3. Exact canonical backup source paths and a decision on whether any mutable
   profile bytes exist outside the verified release source.
4. A restore-drill maintenance window and approval for temporary private disk
   use; a later real restore requires separate authorization.
5. The canonical release root, retention period, atomic-pointer policy and a
   separate destructive decision for each superseded source or rollback object.
6. Measured W1 limits before any `EXPECTED_*` or container resource change.

## Verification and authorization boundary

This proposal records no live presence, absence, count, path, checkout, source-
root, monitoring, backup, recovery, or host-hardening inventory. Implementing or
verifying any proposed control requires the owner inputs above, separate change
authority, secret-safe private evidence, and explicit acceptance. Nothing here
is deployment, route activation, customer-traffic, recovery, or production-
completeness evidence.
