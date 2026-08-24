# Hostinger dark-deploy and route activation runbook

This pack is an operator aid, not a deployment claim. It keeps the canonical
API Compose file unchanged, starts the API on its internal Docker network with
no host port, and makes the reverse-proxy route a separate atomic activation.
Use only synthetic probes until the owner approves real caller traffic.

## Required immutable inputs

Record the exact repository commit, signed API image digest, operator-pack file
hashes, resolved numeric service UID/GID, hostname, DNS result, and a recovery
snapshot identifier before starting. The API image must use the canonical
`registry/repository@sha256:<64 lowercase hex>` form. The Traefik image is fixed
in this pack as
`traefik:v3.7.11@sha256:5203c3f39ca70de6790d964624e042463ffbd57715bc82be155cf224c0dd5144`.

Identify the existing Traefik ACME account contact and the exact existing named
volume that owns its `/letsencrypt/acme.json`. Set their metadata-only operator
values as `ACME_EMAIL` and `TRAEFIK_ACME_VOLUME`. The volume must already exist;
this pack declares it external and never creates a replacement. Inspect only
the allowlisted volume name, driver, mountpoint, ownership, mode, size, and
regular non-link status. `acme.json` must remain mode `0600`. Preserve a private
recovery snapshot before cutover without printing or uploading its certificate,
account, or private-key content. Never delete, truncate, recreate, reset, or
replace the ACME volume or `acme.json` to make validation pass.

Keep the API environment file outside the repository. It must be a bounded
regular non-link file owned by the deployment account with restrictive mode.
Never print, hash as a public artifact, or copy its values into Compose, shell
history, logs, or this pack. Set distinct scoped API credentials and configure
the exact proxy CIDR in `TRUST_PROXY_CIDRS`; do not use a wildcard or a broad
network merely to make a probe pass.

### Existing proxy recovery boundary

Before any proxy stop or cutover, capture an allowlisted, metadata-only record
of the existing proxy: container name and ID, exact image digest, bounded CLI
arguments or static-configuration hash, provider set, health state, port
bindings, network attachments, restart policy, stop grace period, dynamic
router/service count, and the exact hashes of every non-secret configuration
file. Record the previous Traefik image digest and a private recovery snapshot
identifier. Do not dump its environment, full inspect, logs, certificates,
account data, private keys, API credentials, or secret-bearing file contents.
If a configuration file contains secrets, retain only its privately stored
hash and recovery location; never print or upload either value.

Record the existing ACME volume name, driver, mountpoint metadata, and the
regular non-link owner/mode/size of `acme.json`. Store its before-cutover byte
hash only in the private recovery ledger. The dark proxy cutover and any proxy
restore must leave that hash unchanged. Route activation that obtains or
renews a certificate is a separately authorized ACME mutation; record its
private before/after hashes and never overwrite the current state with the
snapshot during rollback.

Identify every existing router and service without recording secrets. If the
old proxy carries any unrelated routers or services, stop with
`STOP_EXISTING_PROXY_PARITY_UNPROVEN`; this dedicated file-provider pack is not
a behavior-neutral replacement for shared proxy duties. Before stopping a
dedicated old proxy, verify an exact restore procedure for its recorded image,
configuration, ports, networks, and ACME volume. The previous container name
must differ from `3d-psa-traefik`; a name collision is a stop condition because
this procedure must retain the stopped previous container for rollback rather
than rename, remove, or recreate it.

## 1. Verify sources and resolve the API identity

Verify the checked-out commit and the SHA-256 of every file used by the
operation. Pull the exact signed API digest, verify its signature/attestations,
then resolve its numeric identity with a bounded container using these exact
safety options: `--rm --pull never --network none --read-only --cap-drop ALL`,
`--security-opt no-new-privileges`, `--pids-limit 16`, `--memory 64m`,
`--memory-swap 64m`, `--cpus 0.25`, and an allowlisted `/usr/bin/id` entrypoint.
Accept only positive decimal UID and GID values; reject UID 0 or GID 0.

After the immutable-reference validator accepts `candidate_image`, resolve the
identity without overriding the image user:

```sh
resolved_slicer_uid="$(docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 16 --memory 64m --memory-swap 64m --cpus 0.25 --entrypoint /usr/bin/id "$candidate_image" -u)"
resolved_slicer_gid="$(docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 16 --memory 64m --memory-swap 64m --cpus 0.25 --entrypoint /usr/bin/id "$candidate_image" -g)"
case "$resolved_slicer_uid" in ''|0|0*|*[!0-9]*) exit 1 ;; esac
case "$resolved_slicer_gid" in ''|0|0*|*[!0-9]*) exit 1 ;; esac
export SLICER_UID="$resolved_slicer_uid" SLICER_GID="$resolved_slicer_gid"
SLICER_API_IMAGE="$candidate_image" node scripts/i7-production-compose-contract.js || exit 1
rendered_api_image="$(SLICER_API_IMAGE="$candidate_image" docker compose --env-file "$operator_values_file" -f docker-compose.production.yml config --images)"
[ "$rendered_api_image" = "$candidate_image" ] || exit 1
```

Pre-create the absolute input, output, configs, and pricing-state bind paths.
The writable paths must be owned by the resolved service UID/GID with mode
`0700`; the configs source must match the recorded source hash and remain
read-only except for the pricing-state overlay. Refuse symlinks, reparse points,
unexpected files, relative production paths, or identity drift.

## 2. Start and qualify the API while it is dark

Create the canonical `slicer-api-private` internal network by bringing up only
`slicer-api` from `docker-compose.production.yml`. Do this before starting or
attaching Traefik. The API has no published host port and the committed
`ops/hostinger/dynamic/` directory contains no router.

```sh
SLICER_API_IMAGE="$candidate_image" docker compose --env-file "$operator_values_file" -f docker-compose.production.yml up --detach --no-deps --pull never slicer-api
```

Use a disposable, explicitly authorized peer on `slicer-api-private` to prove
the exact container image, UID/GID, health, authenticated readiness, API and
native egress denial, resource limits, read-only root, writable-path ownership,
and bounded logs. Run the readiness/authentication/egress matrix twice with no
configuration change. Remove only that named probe peer after recording its
bounded evidence.

Starting the API can run its bounded retention reconciliation. Therefore an
initial rehearsal must use empty state, or a verified recovery snapshot must
exist before a non-empty state directory is mounted.

### Capacity qualification and cleanup manifest boundary

Do not run production capacity qualification until the exact cleanup consumer
`scripts/i12-capacity-artifact-cleanup.js` exists at a verified repository
hash and its own focused gates are green. Until then classify the operation as
`STOP_CLEANUP_CONSUMER_UNAVAILABLE`; do not create synthetic slices and do not
enable the route.

After that consumer is integrated, first verify a canonical, non-link private
evidence parent owned by the operator with mode `0700`. Create a new unpredictable
child directory; never reuse a caller-supplied or pre-existing run directory.
Transfer that new directory to the dynamically resolved service UID/GID with
exact mode `0700`. Before the run, place the base URL and each of the three
audience credentials in four separate canonical absolute files. Every file
must be root:root-owned, mode `0600`, regular, non-link, single-link, and contain
only its exact printable-ASCII value with no line terminator. The base-URL file
is bounded to 2048 bytes and each credential file to 32-256 bytes. The shell
variables `slicer_base_url_file`, `slice_service_api_key_file`,
`operations_api_key_file`, and `artifact_api_key_file` contain only those file
paths, never their contents.

Run the verified `scripts/i12-capacity-producer-exec.py` as root under
`/usr/bin/env -i`. The helper opens the four files with no-follow and close-on-
exec semantics, re-proves their exact metadata and bounded contents, enables
no-new-privileges, clears supplementary groups, drops its real/effective/saved
UID and GID to the dynamically resolved positive non-root service identity,
then directly `os.execve`s absolute `/usr/bin/python3`. The producer receives
exactly the allowlisted `SLICER_BASE_URL`, `SLICE_SERVICE_API_KEY`,
`OPERATIONS_API_KEY`, and `ARTIFACT_API_KEY` environment values. No ambient
operator environment survives `/usr/bin/env -i`; do not add `PATH`, `HOME`, or
any fifth variable. Secret values never appear in shell expansion, process
arguments, logs, or helper output. Run against the private container address
from the VPS host; do not publish an API port or attach a generic egress-capable
peer. Both evidence targets must be new paths inside the run-owned directory:

```sh
run_owned_private_dir="$(mktemp -d -p "$evidence_parent" 'i12-capacity.XXXXXXXXXX')" || exit 1
chown -- "$resolved_slicer_uid:$resolved_slicer_gid" "$run_owned_private_dir"
chmod -- 0700 "$run_owned_private_dir"
qualification_exit=0
/usr/bin/env -i \
  /usr/bin/python3 "$verified_checkout/scripts/i12-capacity-producer-exec.py" \
  --service-uid "$resolved_slicer_uid" \
  --service-gid "$resolved_slicer_gid" \
  --slicer-base-url-file "$slicer_base_url_file" \
  --slice-service-api-key-file "$slice_service_api_key_file" \
  --operations-api-key-file "$operations_api_key_file" \
  --artifact-api-key-file "$artifact_api_key_file" \
  --count 3 \
  --expected-max-concurrent "$expected_max_concurrent" \
  --cleanup-manifest "$run_owned_private_dir/queue-cleanup.json" \
  --report "$run_owned_private_dir/queue-report.md" || qualification_exit=$?
```

The producer must emit the bounded `i12-queue-cleanup-v1` schema: maximum three
unique job/artifact pairs, maximum 8 KiB, mode `0600`, with no absolute path or
credential. The report is also create-new, bounded, mode `0600`, and contains
only sanitized observations. Before cleanup, prove the manifest is a regular
non-link file owned by the resolved service UID with exact mode `0600`. The
cleanup consumer takes no CLI arguments. It reads only the fixed read-only
manifest `/run/i12-cleanup.json` and the fixed output root `/app/output`, and it
emits only a bounded classification and count, never an ID, path, secret,
environment dump, or artifact content.

Run the consumer even when the qualification runner exits nonzero, but only
after the API is stopped and queue settlement is proven. Launch it from the
same exact signed API digest as the qualification target, under the dynamically
resolved non-root UID:GID, with `--pull never --network none --read-only`,
`--cap-drop ALL`, `--security-opt no-new-privileges`, bounded PID/memory/CPU,
and a `0700` noexec `/tmp`. Allow exactly three binds: output read-write,
manifest read-only at `/run/i12-cleanup.json`, and the verified consumer script
read-only from `scripts/i12-capacity-artifact-cleanup.js` to
`/run/i12-capacity-artifact-cleanup.js`. Use only `/usr/bin/node` as the
entrypoint and `/run/i12-capacity-artifact-cleanup.js` as its sole positional
argument; the consumer itself receives no CLI arguments.

Before invoking the consumer, evaluate the bounded report and a fresh
operations-authenticated detailed-readiness sample. A successful qualification
requires postflight queue idle (`activeJobs=0`, `queueLength=0`), accepting
admission, and the configured concurrency value. A failed or inconclusive
postflight keeps the qualification failed, but cleanup still proceeds after a
graceful stop. Stop the exact API service, then require the bounded container
state to be exactly exited, not running, exit code zero, and not OOM-killed.
That stopped-state proof is the final no-writer/queue-settlement boundary; do
not run cleanup against a running, absent, ambiguously identified, nonzero-exit,
or OOM-killed API container.

```sh
docker compose --env-file "$operator_values_file" -f docker-compose.production.yml stop --timeout 30 slicer-api
api_stop_state="$(docker inspect --format '{{.State.Status}} {{.State.Running}} {{.State.ExitCode}} {{.State.OOMKilled}}' 3d-psa-backend-server)"
[ "$api_stop_state" = "exited false 0 false" ] || exit 1
```

```sh
cleanup_exit=0
docker run --rm --pull never --network none --read-only \
  --user "$resolved_slicer_uid:$resolved_slicer_gid" \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 16 --memory 64m --memory-swap 64m --cpus 0.25 \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m,mode=0700,uid="$resolved_slicer_uid",gid="$resolved_slicer_gid" \
  --mount type=bind,src="$slicer_output_dir",dst=/app/output,rw \
  --mount type=bind,src="$run_owned_private_dir/queue-cleanup.json",dst=/run/i12-cleanup.json,ro \
  --mount type=bind,src="$verified_checkout/scripts/i12-capacity-artifact-cleanup.js",dst=/run/i12-capacity-artifact-cleanup.js,ro \
  --entrypoint /usr/bin/node \
  "$candidate_image" /run/i12-capacity-artifact-cleanup.js || cleanup_exit=$?
```

The consumer must fail closed on malformed, duplicate, replaced, symlink,
reparse, active, out-of-root, or identity-mismatched records. It may remove
only the exact manifest-correlated run-owned artifact and metadata after
checking the canonical output root. Prove queue idle, every listed object
absent, and no unrelated output change before removing the manifest. If the
manifest is missing after a runner failure, the consumer is unavailable, or
cleanup cannot be proven, keep the route disabled, retain bounded evidence,
and stop; never wait for TTL, weaken retention, or use broad deletion.
Record `qualification_exit` and `cleanup_exit` separately; successful
cleanup never converts a failed capacity qualification into a pass.

After the bounded cleanup attempt, restart the API from the same digest with the next
explicitly validated concurrency/resource envelope, or the previously recorded
exact envelope when ending measurement. Compare both the configured reference
and runtime image ID against the candidate, and require healthy/running with zero
restarts and no OOM.

```sh
SLICER_API_IMAGE="$candidate_image" docker compose --env-file "$operator_values_file" -f docker-compose.production.yml up --detach --no-deps --pull never slicer-api
candidate_image_id="$(docker image inspect --format '{{.Id}}' "$candidate_image")"
api_runtime_identity="$(docker inspect --format '{{.Config.Image}} {{.Image}} {{.State.Status}} {{.State.Running}} {{.RestartCount}} {{.State.OOMKilled}}' 3d-psa-backend-server)"
[ "$api_runtime_identity" = "$candidate_image $candidate_image_id running true 0 false" ] || exit 1
```

Then repeat the full dark readiness, negative-authentication,
API/native egress-denial and private-peer matrix twice. Do not continue to the
Traefik section while the API remains stopped or either repeated gate is red.

After both complete dark-matrix passes are green, require both recorded results
to be exact decimal zero before any Traefik action:

```sh
[ "$qualification_exit" -eq 0 ] || exit 1
[ "$cleanup_exit" -eq 0 ] || exit 1
```

## 3. Start Traefik with routing still disabled

Traefik static configuration is CLI-only in this pack; do not add a static
configuration file or `TRAEFIK_*` static-option environment variables. Validate
the source contract, then prove Compose interpolation with inert validation-only
values. This command does not create or inspect the named volume:

```sh
ACME_EMAIL=operator@example.invalid TRAEFIK_ACME_VOLUME=i12-existing-acme-volume docker compose -f ops/hostinger/docker-compose.traefik.yml config --quiet
```

Run `node scripts/i12-hostinger-operator-contract.js || exit 1`. Before starting the
candidate, inventory the owners of both host ports 80 and 443 using only
allowlisted metadata. Never start a competing Traefik. If either port is owned,
proceed only after the earlier inventory proves one dedicated old proxy with
zero unrelated routers/services and the owner gives separate cutover
authorization. Stop that exact old container with its recorded grace period,
then retain it stopped with its image, configuration, networks, and restore
procedure intact. Prove that both old listeners are closed before creating or
starting the candidate. If the ports were initially free, record that bounded
proof instead; do not stop an unrelated process.

Only after those preconditions pass, start the `traefik` service from
`ops/hostinger/docker-compose.traefik.yml`, using the operator values file that
names the verified existing ACME volume:

```sh
docker compose --env-file "$operator_values_file" -f ops/hostinger/docker-compose.traefik.yml up --detach --no-deps --pull never traefik
```

It joins the ordinary ingress bridge and the pre-existing external
`slicer-api-private` network. Prove candidate identity, health, redirect,
provider set, network attachments, and unchanged dark-cutover ACME hash. Confirm
that only ports 80 and 443 are published, the dashboard is disabled, and the
file-provider directory is read-only; Docker provider and Engine socket are absent,
and the `letsencrypt` resolver still points to
`/letsencrypt/acme.json` before continuing. The file provider is the only discovery mechanism.
Its exact backend resolves through Docker DNS on
`slicer-api-private`; Traefik does not require Docker Engine API access or label
discovery.

If any proof fails, keep the route disabled, stop only the candidate, and
restore the exact stopped previous container. This pack does not provide a
generic forward proxy, NAT, DNS tunnel, or a host-network fallback.

## 4. Atomically enable the exact route

Keep the router disabled while the approved hostname or its DNS result is
missing, stale, or mismatched. Verify canonical non-link `staging` and `dynamic`
directories on the same filesystem. Create an unpredictable, create-new staging
file with `mktemp`; never reuse a fixed target. Replace only
`slicer-api.invalid` with the approved lowercase hostname, and leave the backend
exactly `http://3d-psa-backend-server:3000`. Calculate and
record the exact SHA-256 of the rendered bytes. Validate it before activation:

`node scripts/i12-hostinger-operator-contract.js --active-router <temporary-file> --host <approved-hostname> --sha256 <64-lowercase-hex> || exit 1`

After DNS, ACME volume continuity, HTTP-challenge reachability, caller
authorization, and dark readiness are all verified, require the dynamic
directory to contain only its canonical `.gitkeep`. Invoke the helper's
`--activate-router` mode with the same staged path, host and hash. The helper
rechecks the exact dark directory, atomically creates
`ops/hostinger/dynamic/slicer-api.yml` with a same-filesystem, no-clobber hard
link, fsyncs and proves the new bytes/file identity, and removes only the
verified staging link. A copy, ordinary rename, forced link, or cross-filesystem
operation is not an atomic no-replace activation.

`node scripts/i12-hostinger-operator-contract.js --activate-router <temporary-file> --host <approved-hostname> --sha256 <64-lowercase-hex> || exit 1`

Confirm the loaded file hash, exact Host rule, `letsencrypt`
certificate resolver, issued certificate, backend, HTTPS redirect, and
authenticated synthetic request. A health probe alone is not acceptance.

## 5. Disable and roll back without destroying state

First create a new canonical 0700 private rollback directory inside the verified
operator pack filesystem and select a create-new retained path. Invoke the
helper's `--disable-router` mode with that path and the previously recorded host
and hash. The helper rechecks the exact active-router set, preserves the live
router with a no-clobber hard link, proves both links have the same regular-file
identity and bytes, then unlinks only the exact live router from the mounted
`dynamic` directory. The unlink is the atomic route disable boundary; it fsyncs
the directory and verifies only `.gitkeep` remains.

The retained link is preparation only. On any fsync, identity, or validation
failure before the live unlink, the helper removes only the exact retained
dev/inode identity it created, fsyncs the retained parent, proves the retained
path absent, and re-proves the original live route exact and active.
`retained_router_prepare_rolled_back` means disable failed but that rollback is
proven. `retained_router_prepare_rollback_uncertain` means the proof failed;
stop without retrying or changing either path.

`node scripts/i12-hostinger-operator-contract.js --disable-router <create-new-retained-path> --host <approved-hostname> --sha256 <64-lowercase-hex> || exit 1`

Prove that the hostname is no longer routed (a closed/404 response, never a 502
from a still-enabled route). If application rollback is required, stop only the
named `slicer-api` service with its 30-second grace period, then remove only its
stopped container after shutdown evidence is complete. Keep input, output,
configs, pricing-state, the private network, Traefik, and the previous immutable
image digest intact for diagnosis or an exact-digest restart. Keep the external
ACME volume and `acme.json` intact even when Traefik itself is rolled back.

```sh
docker compose --env-file "$operator_values_file" -f docker-compose.production.yml stop --timeout 30 slicer-api
docker compose --env-file "$operator_values_file" -f docker-compose.production.yml rm --force slicer-api
```

Never perform a project-wide Compose teardown, engine-wide pruning, volume
deletion, registry deletion, mutable-tag overwrite, firewall relaxation, or
automatic fallback to an unverified digest. Never remove or reset the ACME
volume during cleanup. If disabling the route cannot be proven, stop the
operation and retain all bounded evidence for owner review.

For a proxy rollback, disable the candidate router first and prove it closed,
then stop only `3d-psa-traefik`. Do not remove the candidate or the stopped
previous container until restoration is complete. Verify the private ACME
state matches the hash captured immediately before rollback; do not copy,
restore, truncate, or delete `acme.json`. Restart the exact stopped previous
container using its already verified image, configuration, port, network, and
volume identities. Prove its exact identity, health, redirect behavior, ACME
volume attachment, and router/service parity before declaring restoration.

Keep the stopped-old rollback retention after a successful cutover. Removal of
the previous container, old image, recovery snapshot, or restore metadata is a
later destructive action requiring separate owner acceptance and an explicit
retention decision. Neither candidate acceptance nor API route activation
implicitly authorizes that cleanup.
