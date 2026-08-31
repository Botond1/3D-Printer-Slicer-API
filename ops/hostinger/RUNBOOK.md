# Hostinger dark-deploy and route activation runbook

This pack is an operator aid, not a deployment claim. It keeps the canonical
API Compose file unchanged, starts the API on its internal Docker network with
no host port, and makes the reverse-proxy route a separate atomic activation.
Use only synthetic probes until the owner approves real caller traffic.

## W0. Preserve signed API images before maintaining prune automation

This is a host-lifetime retention policy, not permission to run a manual prune.
The daily image-prune cron may remain only under the exact contract below. It
must not be installed or trusted until both the signed current API image and the
distinct signed rollback API image have passed their normal digest,
signature/attestation, and source-identity checks and each has its own verified
local retention tag.

### Immutable local retention tags

Use only `local/rocket3d-slicer-api:retained-<full-lowercase-source-sha>` as the local
retention-tag shape. The full 40-character source SHA is the immutable image
source identity, not the operator-pack SHA. Do not create aliases named
`current`, `previous`, `rollback`, or `latest`. A source-SHA-qualified retention
tag is created once for its already verified signed digest and is never
retargeted. If the tag already exists, its image ID must equal the image ID of
that exact digest; otherwise stop with `STOP_RETENTION_TAG_RETARGET` and leave
both images and the running container unchanged.

For each of the two distinct roles, current and rollback, validate the
out-of-band `signed_digest_ref` and `image_source_sha`, then apply this pattern:

```sh
case "$image_source_sha" in ''|*[!0-9a-f]*) exit 1 ;; esac
[ "${#image_source_sha}" -eq 40 ] || exit 1
retention_tag="local/rocket3d-slicer-api:retained-${image_source_sha}"
signed_image_id="$(docker image inspect --format '{{.Id}}' "$signed_digest_ref")" || exit 1
if retained_image_id="$(docker image inspect --format '{{.Id}}' "$retention_tag" 2>/dev/null)"; then
  [ "$retained_image_id" = "$signed_image_id" ] || {
    echo 'STOP_RETENTION_TAG_RETARGET' >&2
    exit 1
  }
else
  docker image tag "$signed_digest_ref" "$retention_tag" || exit 1
fi
[ "$(docker image inspect --format '{{.Id}}' "$retention_tag")" = "$signed_image_id" ] || exit 1
```

Record the two source-SHA-qualified tags, exact digest references, and image IDs
in the private recovery ledger before relying on automated image pruning. Never
print registry credentials or private host identifiers. Retiring either tag is
a later exact-identity destructive action requiring a separate owner decision;
ordinary deployment, rollback, or cron maintenance never authorizes it.

Without `-a` or `--all`, Docker's default image-prune operation deletes dangling
images only. The 24-hour filter further limits that dangling set by age. A
verified local tag therefore keeps its exact image non-dangling even when the
backend container is stopped or removed. Before this change, an old digest-only
image with no tag and no container reference is eligible after 24 hours; after
both retention tags are proved, neither the signed current nor rollback image
is eligible. Do not infer this protection from a stopped container alone.

### Active legacy sleeper preflight

Replacing a cron file does not cancel a legacy invocation that cron already
started. Its parent shell can still be sleeping before it runs the old broad
command. Before touching either tag or cron, inspect the bounded process tree
for a cron-launched shell whose arguments contain the image-prune subcommand,
its child `sleep`, or an active prune client. Record only allowlisted PID, PPID,
elapsed-time, and command identity. If any such wrapper, active legacy sleeper,
or prune client exists, stop with `STOP_ACTIVE_LEGACY_PRUNE`; do not continue
and do not kill a generic `sleep`, the Docker daemon, or any container. Only a
separately authorized action may terminate the exact recorded legacy process
tree, after which the same preflight must prove it absent.

### Exact cron backup and atomic replacement

The only accepted repository source is the complete one-line
`ops/hostinger/templates/docker-image-prune.cron`. Its byte-exact command and
trailing newline are enforced by the focused repository contract test; do not
retype or assemble it on the host.

First validate `/etc/cron.d/docker-image-prune` as a canonical root-owned regular
non-link file and validate a canonical root-only `operator_private_backup_dir`
outside every cron input directory. Create a new unpredictable backup there,
copy the old cron bytes, and prove byte identity before replacement. Stage the
verified repository template as a new file in `/etc/cron.d` so the final rename
cannot cross filesystems. The following variables contain paths only, never
secret values:

```sh
cron_target=/etc/cron.d/docker-image-prune
cron_source="$verified_checkout/ops/hostinger/templates/docker-image-prune.cron"
cron_backup="$(mktemp -p "$operator_private_backup_dir" 'docker-image-prune.XXXXXXXXXX.cron')" || exit 1
cp --no-preserve=mode,ownership,timestamps -- "$cron_target" "$cron_backup" || exit 1
chown -- root:root "$cron_backup" || exit 1
chmod -- 0600 "$cron_backup" || exit 1
cmp --silent -- "$cron_target" "$cron_backup" || exit 1
cron_staged="$(mktemp -p /etc/cron.d 'docker-image-prune.XXXXXXXXXX')" || exit 1
install --owner=root --group=root --mode=0644 -- "$cron_source" "$cron_staged" || exit 1
cmp --silent -- "$cron_source" "$cron_staged" || exit 1
mv -T -- "$cron_staged" "$cron_target" || exit 1
sync -f "$cron_target" || exit 1
sync -f /etc/cron.d || exit 1
cmp --silent -- "$cron_source" "$cron_target" || exit 1
```

Treat the same-filesystem `mv -T` as the atomic replacement boundary. On any
failure before it, remove only the exact create-new staged file after proving
its identity; keep the exact backup. On any failure after it, stop and retain
the backup plus bounded evidence rather than attempting a broad cleanup or an
unverified rewrite. Re-run the active-legacy-sleeper preflight immediately
before the atomic replacement.

The separate Docker builder maintenance may remain weekly, but only in Docker's
default dangling-build-cache mode: `docker builder prune -f`, with no `-a` or
`--all`. Record its exact schedule and contents. A non-weekly entry, an all-cache
option, or any additional Docker mutation is `STOP_BUILDER_PRUNE_POLICY_DRIFT`.

### Automation audit

Before and after the replacement, audit all system cron directories and the
system crontab, root and deployment-account crontabs, anacron, systemd timers
and their invoked services, enabled boot units, and any Hostinger template
maintenance hooks. Search their resolved commands for Docker/Compose lifecycle
operations, registry operations, image or builder pruning, delayed `sleep`
wrappers, pulls, restarts, and stack up/down actions. Record a bounded inventory
and exact non-secret file hashes in the private recovery ledger. The accepted
post-change set is exactly one daily image-prune entry matching the committed
template and one weekly default dangling builder-prune entry; any other
deployment-affecting automation is `STOP_AUTOMATION_AUDIT_DRIFT`.

This policy forbids the Docker `system prune` subcommand in every form and both
image-prune all-image modes (`-a` and `--all`), as well as builder-prune
all-cache modes, registry push, and registry prune or deletion as retention
maintenance. It also forbids cron-based
registry login, pull, tag retargeting, container restart, Compose lifecycle, or
route mutation. The exact installed daily cron is automation policy only; it
does not grant permission for an operator to run an ad hoc image prune.

Retain private before/after evidence for the two cron contents, the old-cron
backup hash and byte comparison, the full automation audit, the two exact local
retention tag/image-ID bindings, and the image list before and after. Include a
reasoned dry classification for the backend stopped or absent: before tagging,
an older dangling image is eligible after 24 hours; after tagging, both signed
images remain non-dangling and ineligible. No prune execution is part of this
evidence procedure.

## Required immutable inputs

Record the exact API-image source commit and signed digest separately from the
exact operator-pack source commit and file hashes. Also record the resolved
numeric service UID/GID, hostname, DNS result, and a recovery snapshot identifier
before starting. Never relabel an older verified API image as if it were built
from a later operator-only commit. The API image must use the canonical
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

Keep the J2 caller allowlist in a separate absolute, root:root-owned, mode
`0600`, regular, non-link, single-link private file outside the repository. Its
canonical format is exactly one unique IPv4 `/32` line, one final LF, and no
comments or blank lines. Only phase `leadpilot-only` exists. A second address,
another phase, `/24`, or any prefix other than `/32` is forbidden. In
particular, never widen the approved host address to its provider's shared
`/24`; that would admit unrelated tenants rather than identify the approved
machine. Before any
Node helper process is spawned, the external orchestrator must validate every
expanded path argument in root-private state and with command logging disabled:
the allowlist and every staging or rollback source/target must have an opaque,
address-free ASCII basename of at most 96 safe characters, and no path
component may contain a dotted, dashed, or underscored raw IPv4 address. A
failure is a stop before process creation. The helper repeats this check only
as defence in depth after process start; that late check cannot retroactively
remove a caller-supplied raw pathname from `/proc/<pid>/cmdline`. Under this
required pre-spawn contract, the exact addresses and rendered router remain
private operator state and must not enter source control, command traces,
uploaded evidence, or shared logs.

This allowlist is a machine-level perimeter control, not an application-level
identity. The approved address belongs to a shared host that currently carries
the consumer stack, a separate development stack, a shared Traefik, and another
project. Any process already running there, or deployed there later, can reach
the network perimeter. The owner accepted that scope explicitly; the separate
application API key remains mandatory.

The address has no verified provider reservation. Rebuild, migration, or
reassignment can silently admit the address's next holder while excluding the
legitimate consumer, with no repository or configuration change. The API key
still protects the application, but the network layer has then stopped
identifying the intended machine. No current control detects this event. The
consumer must notify the owner before any rebuild or migration, and the owner
must re-verify and replace the private allowlist and firewall source before the
new host is allowed to call the service.

### Existing proxy recovery boundary

Before any proxy stop or cutover, capture an allowlisted, metadata-only record
of the existing proxy: container name and ID, exact image digest, bounded CLI
arguments or static-configuration hash, provider set, health state, port
bindings, network attachments, restart policy, stop grace period, dynamic
router/service count, and the exact hashes of every non-secret configuration
file. Keep every exact configuration hash only in the root-private recovery
ledger; shared evidence records only fixed equality booleans and bounded
counts. A dynamic router or any low-entropy file derived from caller addresses
never contributes a digest to shared evidence.
Record the previous Traefik image digest and a private recovery snapshot
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

Verify the checked-out commit and the SHA-256 of every repository source file
used by the operation. This does not include the root-private allowlist,
rendered router, or another low-entropy private input: the helper binds those
bytes internally, and their digests never become shell variables or evidence.
Pull the exact signed API digest, verify its signature/attestations,
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

### J0 principal-only slice-authentication activation gate

The production route target is exactly `SLICE_SERVICE_AUTH_MODE=principals`;
the development-compatible legacy default is not an activation configuration.
Before any Traefik or router action, invoke the exact running image's
`resolveServiceKeyRing(process.env)` inside the dark API container and record
only a fixed sanitized classification. It must prove mode `principals`, both
named principal active slots (`woocommerce` and `leadpilot`),
`legacyAccepted=false`, and `expiresAt=null`. The shared active, shared
previous, migration expiry, and both principal previous slots must all be
absent for this J0 initial-activation gate. Never print, hash, count bytes from,
or otherwise disclose any credential value.

A later principal-key rotation is a separate owner-authorized change and must
not reuse the initial-activation classification. Its dark gate must positively
authenticate every configured previous slot under `x-slicer-api-key`, bind it
to the matching principal without disclosing credential material, and record an
owner-approved removal deadline. After removal, the retired value must return
exact HTTP 401 / `SLICE_SERVICE_AUTH_REQUIRED` with no workspace, queue, or
artifact effects before revocation is classified complete.

Run a private, customer-free synthetic authentication matrix against the dark
API before continuing. Read each credential from a distinct root-owned,
mode-`0600`, regular, non-link, single-link file into protected process memory;
never place a value in argv, shell expansion, trace output, Docker metadata, or
the evidence record. Require all of these observations:

- the WooCommerce principal under `x-slicer-api-key` completes one bounded
  synthetic slice successfully;
- the LeadPilot principal under `x-slicer-api-key` completes one bounded
  synthetic slice successfully;
- every retired shared active/previous credential under `x-slicer-api-key`
  returns exact HTTP 401 / `SLICE_SERVICE_AUTH_REQUIRED` and creates no
  workspace, queue job, or artifact;
- a correct principal credential supplied only under `x-api-key` returns exact
  HTTP 401 / `SLICE_SERVICE_AUTH_REQUIRED` and creates no workspace, queue job,
  or artifact.

Record only the fixed probe names, HTTP statuses, stable error codes, bounded
cleanup counts, and the final sanitized classification. Re-prove queue idle and
exact synthetic artifact cleanup. A missing retired key must be classified in
the private ledger rather than replaced with a guessed value. If the resolver
readback, any positive/negative observation, or cleanup is absent or
inconclusive, keep the route dark and stop with
`STOP_SLICE_PRINCIPAL_ACTIVATION_UNPROVEN`.

## 3. Start Traefik with routing still disabled

Traefik static configuration is CLI-only in this pack; do not add a static
configuration file or `TRAEFIK_*` static-option environment variables. Validate
the source contract and fail closed unless the exact Compose client supports
gateway priority, then prove interpolation with inert validation-only values.
These commands do not create or inspect the named volume:

```sh
compose_version="$(docker compose version --short)" || exit 1
node scripts/i12-hostinger-operator-contract.js --check-compose-version "$compose_version" || exit 1
ACME_EMAIL=operator@example.invalid TRAEFIK_ACME_VOLUME=i12-existing-acme-volume docker compose -f ops/hostinger/docker-compose.traefik.yml config --quiet || exit 1
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
`slicer-api-private` network. Require Docker Compose `2.33.1` or newer. The
service attachment must keep ingress at `gw_priority: 1` and the internal
private network at `gw_priority: 0`; keep the ordinary ingress bridge explicitly
non-internal `traefik-ingress`. Do not substitute list ordering or the
unrelated `priority` field. Prove candidate identity, health, redirect,
provider set, the exact two network attachments, and that the actual default
route uses `traefik-ingress`, plus the unchanged dark-cutover ACME hash. Confirm
that only ports 80 and 443 are published, the dashboard is disabled, and the
file-provider directory is read-only; Docker provider and Engine socket are absent,
and the `letsencrypt` resolver still points to
`/letsencrypt/acme.json` before continuing. The file provider is the only discovery mechanism.
The entrypoint redirect target must be the literal external port `:443`, not the
container entrypoint name `websecure` and not the internal port `:8443`. Prove
that an HTTP request retains the requested hostname and path and returns a
Location authority with no explicit `:8443`; a client that follows redirects
must reach the public 443 listener.
For the exact dynamic bind, require the recorded source, destination, bind type,
propagation and effective `RW=false`; accept Docker's `Mode=""` or `Mode="ro"`
projection only under that effective read-only proof. Keep the ACME volume
strictly `RW=true` and `Mode="rw"`; never weaken either contract.

The Compose bind is release-relative, so a running Traefik can otherwise keep
watching an older release while a helper writes a newer release. Resolve the
one live bind source directly from the running container, keep the resulting
absolute path only in the root-private ledger, and require it to equal the
canonical `ops/hostinger/dynamic` directory beside the helper being executed:

```sh
live_dynamic_sources="$(docker inspect --format '{{range .Mounts}}{{if and (eq .Type "bind") (eq .Destination "/etc/traefik/dynamic")}}{{println .Source}}{{end}}{{end}}' 3d-psa-traefik)" || exit 1
[ "$(printf '%s\n' "$live_dynamic_sources" | awk 'NF { count += 1 } END { print count + 0 }')" -eq 1 ] || exit 1
live_dynamic_source="$(printf '%s\n' "$live_dynamic_sources" | awk 'NF { print; exit }')" || exit 1
node scripts/i12-hostinger-operator-contract.js --check-live-dynamic-source "$live_dynamic_source" || exit 1
```

Re-run that exact inspection and equality gate immediately before every render,
validation, activation, disable, recovery, and terminal-dark helper call. Any
missing, duplicate, relative, non-canonical, different-release, wrong-type, or
writable bind is `STOP_LIVE_DYNAMIC_RELEASE_MISMATCH`; writing the apparent
"current" release directory is never evidence that Traefik loaded it.
Its exact backend resolves through Docker DNS on
`slicer-api-private`; Traefik does not require Docker Engine API access or label
discovery.

If any proof fails, keep the route disabled, stop only the candidate, and
restore the exact stopped previous container. This pack does not provide a
generic forward proxy, NAT, DNS tunnel, or a host-network fallback.

### J2 W3 DNS-only and Docker boundary preflight

Keep the route dark while proving the Cloudflare record through an
authoritative read-only API response, not only a resolver answer or the grey
cloud icon. For exactly the approved hostname require one `A` record whose
`proxied` field is boolean `false` and whose content equals the privately
recorded VPS IPv4. Require no `AAAA` or `CNAME` record for that hostname, then
require the same single `A` result and no `AAAA` result from at least two public
recursive resolvers after TTL convergence. Store the raw API and resolver
responses only in a new root-private evidence directory. Public evidence may
contain only fixed booleans such as `cloudflare_proxied_false=true`; it must not
contain the origin, caller addresses, zone token, or record identifiers. A
missing, proxied, duplicated, stale, mismatched, or IPv6 answer is
`STOP_DNS_ONLY_BOUNDARY_UNPROVEN`.

The `slicer-api-source-allowlist` middleware deliberately has no `ipStrategy`.
It therefore evaluates Traefik's direct TCP peer address, not
`X-Forwarded-For`. If the DNS record is accidentally changed to proxied, both
the host firewall and this middleware see a Cloudflare address instead of an
approved caller and fail closed. This is an outage signal, not permission to
add Cloudflare ranges, trust forwarded headers, or weaken the `/32` list.

Do not infer the Docker firewall implementation. Read it exactly and accept
only the literal `iptables` result:

```sh
firewall_backend="$(docker info --format '{{.FirewallBackend}}')" || exit 1
node scripts/i12-hostinger-operator-contract.js --check-firewall-backend "$firewall_backend" || exit 1
```

An empty, unknown, or `nftables` result is
`STOP_DOCKER_FIREWALL_BACKEND_UNSUPPORTED`; the nftables backend has no
`DOCKER-USER` chain and needs a separately designed and tested boundary. For
the accepted backend, capture root-private `iptables-save` and
`ip6tables-save` recovery inputs, require both `DOCKER-USER` chains to exist,
and inventory their exact pre-existing order. Never flush, replace, or broadly
accept either chain.

The owner-observed starting state is an empty `DOCKER-USER` chain with inactive
UFW. Published Docker ports can bypass UFW, so under the observed topology
`DOCKER-USER` is the only host network-layer enforcement point. Treat this as
owner-supplied preflight data and re-read it immediately before mutation; do
not infer it from the repository.

This second layer is safe only while this Traefik serves exactly the one
approved hostname. A destination-port 443 rule cannot distinguish HTTP Host or
TLS SNI and would silently block every later HTTPS hostname on the shared
Traefik. The presence or planned addition of a second hostname is therefore a
stop requiring a separately designed per-host boundary; never carry this
single-host `DOCKER-USER` rule forward unchanged.

The external root-only orchestrator must build a new dedicated chain completely
before adding one create-new, uniquely commented jump at the start of
`DOCKER-USER`. Scope the jump to the verified public ingress interface and
the owner-supplied, verified public VPS IPv4 destination; keep that value in
root-private operator input and out of repository, logs, and evidence. Docker
has already performed DNAT when packets reach this chain, so the policy must use
conntrack `--ctorigdst <verified-public-VPS-IPv4>` together with
`--ctorigdstport 80` and
`--ctorigdstport 443`; plain `--dport 80` or `--dport 443` is forbidden.
Port 80 remains globally reachable over IPv4 for ACME HTTP-01 and the HTTPS
redirect. Port 443 accepts only the currently rendered `/32` entries, then
emits a rate-bounded root-private event with the exact fixed prefix
`J2_ALLOWLIST_DENY`, then uses `REJECT --reject-with tcp-reset` for every other
source. The external caller receives a TCP reset and no HTTP status; it cannot
be confused with a backend HTTP 401. Do not place a generic
`ESTABLISHED,RELATED` accept before the source test because a connection
established before activation must not bypass the new boundary. With no
approved IPv6 callers and no `AAAA` record, reject
new public IPv6 traffic to both 80 and 443; an absent IPv6 enforcement seam is
a stop condition because Docker currently owns IPv6 host listeners too.

Prove the installed policy by exact rule identity and counters before route
activation. From the approved LeadPilot origin, 443 must pass. From a distinct
external origin it must receive the expected TCP rejection while the exact
firewall deny counter increments.
Separately, from a run-owned peer that reaches Traefik without traversing the
host-public firewall, an unlisted source must receive Traefik HTTP 403. From the
allowed LeadPilot origin, a missing or wrong `x-slicer-api-key` must reach the
backend and return HTTP 401 / `SLICE_SERVICE_AUTH_REQUIRED`. These observations
make source rejection distinguishable from credential rejection without
publishing an address. Rollback removes only the exact owned jump, proves it
absent, then removes only the exact empty owned chain and rechecks the original
ruleset identity. Rule persistence and the same positive/negative matrix must
also survive the separately authorized Docker-service restart rehearsal.

### J2 W3 ACME state and renewal boundary

Inventory exactly `traefik-letsencrypt` and
`traefik_traefik-letsencrypt`, plus the volume actually mounted at
`/letsencrypt` by the running exact Traefik container. Inspect only bounded
metadata and `acme.json` ownership, mode, size, regular-file identity and a
private hash; never print account, certificate or private-key bytes. If both
volumes contain plausible state, the mounted identity is ambiguous, or the
selected state differs from the preflight recovery ledger, stop with
`STOP_ACME_VOLUME_IDENTITY_UNPROVEN`. Select one already existing authoritative
volume. Retain the other unmounted for later owner disposition; never merge,
copy, truncate, recreate, restore over, or delete either volume.

HTTP-01 is handled on the globally reachable `web` entrypoint before the
router-scoped HTTPS middleware, so the caller allowlist must never be attached
to the entrypoint. Require production issuance, certificate hostname/chain/
expiry acceptance, then restart the exact Traefik image with the exact same
volume and prove certificate continuity. A forced renewal rehearsal must be
performed by the external orchestrator in an owner-approved isolated ACME
staging environment with a distinct challenge hostname and disposable state;
it must prove a second issuance and continuity without modifying production
`acme.json` or consuming production rate limits. A production-only issuance,
restart, shortened lifetime, deleted state, or guessed renewal claim is not a
renewal proof. Until the external record is complete, stop with
`STOP_ACME_RENEWAL_REHEARSAL_UNPROVEN` and keep the slicer route dark.

## 4. Atomically enable the exact route

Keep the router disabled while the approved hostname or its DNS result is
missing, stale, or mismatched. The only repository-resident private router-state
root is the exact
`ops/hostinger/.runtime-private` directory. Root `.gitignore` must contain exactly
one `/ops/hostinger/.runtime-private/` rule and exactly one
`/ops/hostinger/dynamic/slicer-api.yml` rule, while
`ops/hostinger/dynamic/.gitkeep` remains tracked. Before every render, validation,
activation, or disable mutation, the helper resolves the exact repository root,
requires `.gitignore` and `.gitkeep` to be tracked in both the exact `HEAD` tree
and the current index, uses `git check-ignore -v --no-index` to prove those
exact rules are the effective rules, and queries `git ls-tree` and `git
ls-files --cached` separately to refuse any tracked runtime-private descendant
or tracked live router. A broader ignore,
negation, missing rule, different winning rule, tracked target, or Git failure is
a stop; ignore status is defence against accidental `git add -A`, not permission
to weaken filesystem privacy.

Create the exact `.runtime-private/staging` and `.runtime-private/rollback`
children as canonical, non-link, root:root-owned mode `0700` directories. No
general operator-pack path, ordinary temporary directory, nested child,
symlink/reparse point, or `dynamic` path is valid private retained/staging
storage. Verify these directories and `dynamic` are on the same filesystem. The
dynamic directory must be root:root-owned
mode `0700`; its only dark entry, `.gitkeep`, must be a root:root-owned mode
`0600`, regular, non-link, single-link file containing exactly one LF. The
current pinned Traefik runtime is root (`UID:GID 0:0`), so it can traverse this
0700 host bind and read the 0600 router files despite its dropped capabilities,
read-only root filesystem, and no-new-privileges setting. Prove that exact
container and kernel process identity before relying on it; a future non-root
runtime is a stop requiring a separately designed permission model, not
permission to widen these modes.

Before opening any route input or starting the rehearsal, every directory from
the exact operator-pack root and the root-private allowlist parent through the
filesystem root must be canonical, non-symlink, root-owned, and neither group-
nor world-writable. The helper snapshots the dev/inode/owner/mode identity of
those ancestor chains before input read, immediately before each action, and
after each action; drift is `router_security_boundary_changed`. The staging,
rollback, runtime-private, and dynamic directories keep their stricter mode
`0700` contract.

Create once the exact empty
`.runtime-private/route-rehearsal.lock` as a root:root-owned mode `0600`,
single-link regular file. Require `/usr/bin/flock` and `/usr/bin/true`, then
open FD 9 and acquire its nonblocking exclusive lock before the first render.
Keep that same shell FD and lock continuously across every activation, external
observation, disable, retained replay, and terminal dark assertion. Every Node
router command verifies that inherited FD 9 is the exact lock inode, can
reassert the same open-file-description lock, and excludes a distinct
contender. A second activation or concurrent disable therefore fails closed;
never acquire a new per-command lock.

```sh
route_rehearsal_lock="$verified_checkout/ops/hostinger/.runtime-private/route-rehearsal.lock"
[ -e "$route_rehearsal_lock" ] || install -o root -g root -m 0600 /dev/null "$route_rehearsal_lock"
exec 9<>"$route_rehearsal_lock"
/usr/bin/flock --nonblock --exclusive --conflict-exit-code 75 9 || exit 1
```

After the mandatory external pre-spawn path gate, select an unpredictable,
address-free, absent direct child
of the exact staging directory whose basename matches
`slicer-api-<run-token>.yml.tmp`; never reuse a fixed file. The renderer refuses
the rollback subtree. Render the file directly
from the root-private allowlist without printing any address. The renderer uses
create-new mode `0600`, replaces only `slicer-api.invalid` and the exact
`__J2_SOURCE_RANGE__` placeholder, fsyncs the file and parent, and validates
the router-scoped middleware against the same private file. The renderer
invocation below and every later router helper invocation must be a descendant
of that still-locked shell:

`node scripts/i12-hostinger-operator-contract.js --render-router <create-new-temporary-file> --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1`

Capture only the fixed renderer classification and bounded entry count. The
helper internally recomputes the exact SHA-256 over an `O_NOFOLLOW` descriptor
whose dev/inode, root:root ownership, mode, size and link count are re-proved
against the pathname. It independently validates the same hostname, bytes,
allowlist file and phase before activation. Because the external path gate runs
before process creation, the router digest and every raw IP never appear in
process arguments, helper stdout/stderr, logs, or shared evidence; only the
root-private files contain caller addresses:

`node scripts/i12-hostinger-operator-contract.js --active-router <temporary-file> --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1`

After DNS, ACME volume continuity, HTTP-challenge reachability, caller
authorization, the principal-only slice-authentication activation gate, and
dark readiness are all verified, require the dynamic directory to contain only
its canonical `.gitkeep`. Invoke the helper's
`--activate-router` mode with the same staged path, host, private allowlist and
phase. The helper
rechecks the exact dark directory, atomically creates
`ops/hostinger/dynamic/slicer-api.yml` with a same-filesystem, no-clobber hard
link, fsyncs and proves the new bytes/file identity, and removes only the
verified staging link. It explicitly proves the consumed source pathname is
absent and re-proves the source parent plus the complete protected ancestor
identity before accepting activation. A copy, ordinary rename, forced link, or
cross-filesystem operation is not an atomic no-replace activation.

`node scripts/i12-hostinger-operator-contract.js --activate-router <temporary-file> --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1`

Confirm the loaded file hash only through the helper's internal exact-byte
comparison; do not copy it to shared evidence. Confirm the exact Host rule, `letsencrypt`
certificate resolver, issued certificate, backend, HTTPS redirect, and
authenticated synthetic request. A health probe alone is not acceptance.
Every activation rehearsal admits exactly the sole approved `/32`. No future
caller row or expansion phase exists in this contract; a second row is a hard
stop even if its address is already known.

## 5. Disable and roll back without destroying state

Use only the already verified exact `.runtime-private/rollback` directory and
select an absent direct child whose basename matches
`slicer-api-<run-token>.yml.disabled`. The disable helper refuses a staging path,
an arbitrary pack path, and a nested rollback path. Invoke the
helper's `--disable-router` mode with that path, the approved host and the same
root-private allowlist/phase. The helper derives the live-router digest
internally and rechecks the exact active-router set and its root:root-owned
mode `0600` single-link file, then preserves the live
router with a no-clobber hard link. It proves both paths have the same
regular-file identity, bytes, owner, mode, and link count two. It unlinks only
the exact live router from the mounted `dynamic`
directory. The unlink is the atomic route disable boundary; it fsyncs the
directory, verifies only `.gitkeep` remains, and re-proves the retained file as
the same root:root-owned mode `0600` identity with link count one.

The retained link is preparation only. On any fsync, identity, or validation
failure before the live unlink, the helper removes only the exact retained
dev/inode identity it created, fsyncs the retained parent, proves the retained
path absent, and re-proves the original live route exact and active.
`retained_router_prepare_rolled_back` means disable failed but that rollback is
proven. `retained_router_prepare_rollback_uncertain` means the proof failed;
stop without retrying or changing either path.

`node scripts/i12-hostinger-operator-contract.js --disable-router <create-new-retained-path> --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1`

Every activation and disable command runs under an external orchestrator
`finally`/restart branch; a signal handler is not recovery authority because
`SIGKILL` cannot be handled. Preserve the exact source path and its explicit
kind in root-private orchestration state. Never glob, scan either private
directory, select a newest file, or infer recovery from a live-only `nlink=2`
router. After interruption, first run the no-argument dark contract only as an
observation. It is never terminal proof while the exact known source still
exists: invoke exactly one of these forms even when that initial dark check
passes, because recovery must durably re-prove the source and its parents:

`node scripts/i12-hostinger-operator-contract.js --recover-router-dark <known-staging-source> --source-kind staging --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1`

`node scripts/i12-hostinger-operator-contract.js --recover-router-dark <known-rollback-source> --source-kind rollback --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1`

Recovery accepts only the explicit source as either (a) a root:root-owned mode
`0600` `nlink=2` inode identical to the exact live router, or (b) the same
`nlink=1` source with an already exact dark directory. In case (a), it re-proves
the source/live dev/inode, internally recomputed hash, Host, allowlist and
source-kind, fsyncs the source and source parent before the live unlink, and
then re-proves that exact `nlink=2` state. Only then does it unlink the exact
live path; it again fsyncs the source, source parent and dynamic directory, then
proves source `nlink=1` and dark. Case (b) repeats
those durability/proof steps without mutation. Deterministic unit tests prove
idempotent recovery after each logically injected fsync cutpoint; a real
process crash, kernel crash, or power-loss durability rehearsal remains
external `NOT_VERIFIED` until the orchestrator records it on the target Linux
filesystem. Any other link topology, identity, directory entry or source path
is `router_dark_recovery_state_invalid` or another fixed fail-closed
classification.

If an interrupted activation already consumed its known source, recovery must
return `router_dark_recovery_source_unavailable`; it must not inspect or unlink
a live-only route. Run the no-argument dark contract again. If dark still does
not pass, the only admitted continuation is the normal exact disable contract
with one new known rollback target, the same approved host and the same private
allowlist/phase. If an interrupted disable has no retained source yet, retry
that normal disable with its same exact still-absent target. Finally invoke the
strict `--assert-router-dark` contract with the exact known single-link source
and stop unless it proves that only `.gitkeep` remains while also re-proving
runtime metadata, private-storage identity, protected ancestor chains, and the
separate `HEAD`/index Git contract. This restart branch always converges to
dark; it never resumes or declares permanent activation.

Successful activation consumes only its exact proven staging or retained source
hard link after the live link is accepted. A failed or unused staging file may
be removed only after separately proving its exact dev/inode, owner, mode,
single-link state and internally expected hash; never recursively clean the runtime-private
root. A retained rollback file remains root-private until it is consumed by the
bounded replay below or an owner separately authorizes exact-file cleanup. The
terminal second retained file is kept for owner review; `git clean`, broad
deletion, or normal repository staging is never a retention policy.

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

### J2 W3 activation rehearsal closure and mandatory dark state

The external orchestrator, not a VPS-local curl alone, owns the acceptance
record. During the first bounded activation it must correlate: authoritative
DNS-only proof; exact firewall identity and counters; LeadPilot-origin
authless `/health` and `/pricing`; one LeadPilot-principal synthetic slice;
allowed-source wrong-key HTTP 401; Traefik-local unlisted-source HTTP 403; an
external unlisted-source TCP rejection; certificate identity; queue idle; and
exact synthetic artifact cleanup. Record only fixed probe names, statuses,
stable error codes, bounded counts, timings and boolean classifications. Raw
addresses, credentials, Cloudflare records, firewall lines and access logs stay
root-private.

Time and prove the W6 sequence `dark -> active -> dark -> active -> dark`.
After the first disable, use its exact
`.runtime-private/rollback/slicer-api-<run-token>.yml.disabled` retained router as
an explicit rollback source for the second activation with the same hostname,
private allowlist file and `leadpilot-only` phase. `--activate-router`
admits this exact rollback parent/name pair as a retained replay source; it never
relabels it as staging. The helper re-proves its single-link inode/bytes and
router identity, creates the live route through the same same-filesystem,
no-clobber hard-link contract, and consumes only that proven retained source
link after acceptance. Rendering remains staging-only and disabling remains
rollback-only. Repeat the external positive/negative matrix, then disable into
a second create-new rollback path. The terminal evidence must
prove the dynamic directory contains exactly `.gitkeep`, the hostname is closed
or 404 and never 502, Traefik remains healthy, the API remains dark/private and
queue-idle, and `final_route_state=dark`.

`node scripts/i12-hostinger-operator-contract.js --assert-router-dark <second-known-rollback-source> --source-kind rollback --host <approved-hostname> --allowlist-file <root-private-file> --phase leadpilot-only || exit 1`

Only after that strict assertion and the external closed/404 observation may
the orchestrator release the full-rehearsal lock with `exec 9>&-`. Releasing it
earlier invalidates the rehearsal.

Any absent or inconclusive external observation is
`STOP_J2_EXTERNAL_BOUNDARY_UNPROVEN`. Even when every rehearsal gate is green,
do not perform another activation in the same operation. Permanent route
activation is a separate owner-controlled stop after the owner independently
proves allowed and denied sources, TLS issuance and renewal, and rollback. This
runbook never classifies the public production route active or customer-ready.
