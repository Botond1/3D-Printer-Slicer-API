# I5/S4 operator validation pack

## Purpose and safety

Use this pack only in an explicitly authorized deployment validation window.
It is placeholder-driven and read-only except for the final cleanup section,
which may remove only exact validation resources whose IDs and ownership labels
were captured during the same run. Do not run VPS probes without separate
authorization.

Never enable shell tracing, print credentials, read secret values, copy
customer files, use broad Docker name matching, or run prune. Save only status,
identity, metadata, and synthetic sentinel evidence.

Required operator-supplied placeholders:

```text
EXPECTED_SOURCE_SHA
EXPECTED_IMAGE_DIGEST
API_CONTAINER_ID
API_LOOPBACK_URL
EXPECTED_BIND_ADDRESS
EXPECTED_PROXY_PEERS
EXPECTED_PROXY_HOPS
INTENDED_CALLER_HOST
DENIED_CALLER_HOST
SECRET_FILE_OR_MOUNT_PATH
EXPECTED_SECRET_OWNER_UID
EXPECTED_SECRET_OWNER_GID
EXPECTED_SECRET_MODE
SENTINEL_DNS_NAME
SENTINEL_TCP_HOST
SENTINEL_TCP_PORT
SENTINEL_UDP_HOST
SENTINEL_UDP_PORT
OWNED_SENTINEL_CONTAINER_ID
OWNED_API_PROBE_CONTAINER_ID
OWNED_INTERNAL_NETWORK_ID
OWNED_SENTINEL_NETWORK_ID
OWNED_CANDIDATE_IMAGE_ID
```

Store scoped keys in the process environment through the approved secret
source, not in shell history:

```text
SLICE_SERVICE_API_KEY
SLICE_SERVICE_API_KEY_PREVIOUS (optional)
PRICING_API_KEY
PRICING_API_KEY_PREVIOUS (optional)
ARTIFACT_API_KEY
ARTIFACT_API_KEY_PREVIOUS (optional)
OPERATIONS_API_KEY
OPERATIONS_API_KEY_PREVIOUS (optional)
```

## Evidence header

Record without mutation:

```sh
date -u
uname -a
docker version --format '{{json .Server.Version}}'
git rev-parse HEAD
git status --short
```

Fail if the source SHA is not exactly `EXPECTED_SOURCE_SHA`.

## Immutable deployed identity

Inspect the exact captured container ID, not a mutable name:

```sh
docker inspect --type container \
  --format '{{.Id}} {{.Image}} {{json .Config.Labels}} {{json .HostConfig.PortBindings}} {{json .NetworkSettings.Networks}}' \
  "$API_CONTAINER_ID"
docker image inspect \
  --format '{{.Id}} {{json .RepoDigests}}' \
  "$EXPECTED_IMAGE_DIGEST"
```

Require the running container image to match `EXPECTED_IMAGE_DIGEST`. A local
image ID is not a registry digest. Record mismatch and stop; do not pull,
restart, or replace anything from this pack.

## Bind and private topology

Inspect listening sockets and the exact container port mapping:

```sh
ss -lntp
docker inspect --type container \
  --format '{{json .HostConfig.PortBindings}} {{json .NetworkSettings.Ports}}' \
  "$API_CONTAINER_ID"
```

Require the API listener to match `EXPECTED_BIND_ADDRESS` and the approved
loopback/private design. Reject `0.0.0.0`/`::` exposure unless that exact public
binding was separately approved.

Inspect the deployed networks without changing them:

```sh
docker inspect --type container \
  --format '{{json .NetworkSettings.Networks}}' \
  "$API_CONTAINER_ID"
docker network ls --no-trunc
```

## Reverse proxy and spoof resistance

Obtain `EXPECTED_PROXY_PEERS` and `EXPECTED_PROXY_HOPS` from the reverse-proxy
owner. Record the deployed proxy configuration and timeout evidence separately;
do not infer it from application defaults.

From the intended caller, send a synthetic request ID and an XFF chain whose
leftmost prefix is a documentation-only spoof address:

```sh
curl --fail-with-body --silent --show-error \
  --connect-timeout 3 --max-time 10 \
  -H 'X-Request-Id: operator.proxy.expected' \
  -H 'X-Forwarded-For: 198.51.100.77, 192.0.2.55' \
  "$API_LOOPBACK_URL/health"
```

Repeat from a direct untrusted/denied caller only when that host is explicitly
authorized for the test. Evidence must show the application resolves the
nearest untrusted hop and never selects the spoofed prefix. Also send an
injection-shaped request ID and verify the response contains a newly generated,
bounded `X-Request-Id`, not the supplied unsafe value.

## Intended and denied callers

From `INTENDED_CALLER_HOST`, require bounded success:

```sh
curl --fail-with-body --silent --show-error \
  --connect-timeout 3 --max-time 10 \
  "$API_LOOPBACK_URL/health"
```

From `DENIED_CALLER_HOST`, require connection denial or an explicit authenticated
proxy rejection. A timeout alone is insufficient unless network evidence shows
the intended deny rule. Do not weaken firewall/proxy rules to make this probe
reachable.

## Secret metadata and rotation state

Inspect metadata only; never read file contents:

```sh
stat --format '%u %g %a %F %n' "$SECRET_FILE_OR_MOUNT_PATH"
findmnt --noheadings --output TARGET,SOURCE,FSTYPE,OPTIONS \
  --target "$SECRET_FILE_OR_MOUNT_PATH"
```

Require the approved source, owner UID/GID, restrictive mode, and mount
semantics. Record whether each audience is in `active-only` or
`active+previous` state without recording values.

For an authorized rotation:

1. Restart 1 with replacement active and former active in previous.
2. From the intended caller, verify new active succeeds and unrelated audience
   keys fail. Verify former active succeeds only during the overlap.
3. Move all intended callers to the replacement.
4. Remove previous and perform restart 2.
5. Verify replacement succeeds and former active returns the audience's exact
   HTTP 401 code.

Do not enable legacy admin migration for rotation. If an existing migration is
present, record only audience and expiry metadata from operations readiness;
require one non-slice audience and expiry <=90 days. Normal state is disabled.

## Liveness, readiness, and metrics

Public, minimal probes:

```sh
curl --fail-with-body --silent --show-error \
  --connect-timeout 3 --max-time 10 \
  "$API_LOOPBACK_URL/health"
curl --silent --show-error \
  --connect-timeout 3 --max-time 10 \
  "$API_LOOPBACK_URL/ready"
```

Require `/ready` to contain only READY/NOT_READY. Use the operations key without
printing it:

```sh
curl --silent --show-error \
  --connect-timeout 3 --max-time 10 \
  -H "x-api-key: $OPERATIONS_API_KEY" \
  "$API_LOOPBACK_URL/health/detailed"
curl --silent --show-error \
  --connect-timeout 3 --max-time 10 \
  -H "x-api-key: $OPERATIONS_API_KEY" \
  "$API_LOOPBACK_URL/operations/readiness"
curl --silent --show-error \
  --connect-timeout 3 --max-time 10 \
  -H "x-api-key: $OPERATIONS_API_KEY" \
  "$API_LOOPBACK_URL/operations/metrics"
```

Do not store headers or command traces. Readiness detail must contain only
stable reason codes. Metrics must stay bounded and contain no request/job/
artifact IDs, filenames, material/profile/customer values, or credential text.

## API and native sentinel egress

Use only an operator-owned sentinel with synthetic traffic. First prove the
sentinel itself is operational from its authorized control path. Then inspect
the exact API container's network mode and run bounded API plus spawned-native
DNS/TCP/UDP checks.

Required evidence:

| Probe | Promotion requirement |
| --- | --- |
| Sentinel control | DNS/TCP/UDP operational |
| API DNS | denied |
| API TCP | denied |
| API UDP | denied |
| Spawned Python/native DNS | denied |
| Spawned Python/native TCP | denied |
| Spawned Python/native UDP | denied |
| Intended ingress | succeeds |
| Denied caller ingress | denied |

Do not treat DNS failure alone as TCP/UDP denial. Do not treat an internal
Docker network as passing if it removes the required host listener. Current
local status is `BLOCKED_S4_EGRESS_CAPABILITY`.

## Alert and action matrix

Production thresholds are intentionally not invented here. Select them from
measured host/proxy capacity and record owner/routing separately.

| Signal/event | Operator action |
| --- | --- |
| `slicer_readiness` becomes 0 or `readiness.changed` unavailable | Stop promotion/admission investigation; read operations reason codes. |
| `NATIVE_RUNTIME_QUARANTINED` or `native.quarantined` | Treat capacity as fail closed; isolate the instance and investigate tree settlement. |
| `slicer_shutdown` is 1 or admission is closed | Do not route new slicing work; verify bounded drain. |
| Queue rejection counters increase | Inspect queue state/caller distribution and measured capacity; do not raise limits blindly. |
| Resource failure counters increase | Identify fixed reason class and validate envelopes; do not log customer payloads. |
| Auth rejection counters increase | Verify intended caller/rotation/proxy identity; never expose key material. |
| Artifact cleanup failure event/counter | Protect existing outputs, inspect retention/storage metadata, and stop destructive cleanup. |
| Public health succeeds but readiness fails | Treat service as alive but unavailable; never promote on liveness alone. |
| Sentinel egress succeeds | Block S4/S3b; enforce/choose the S5 network architecture. |

## Bounded exact cleanup

Cleanup applies only to resources created and captured by the same authorized
validation run. Before removal, require all of:

- exact opaque ID match;
- `io.s3a.validation-only=true`;
- exact `io.s3a.expected-image-id=OWNED_CANDIDATE_IMAGE_ID` ownership label;
- expected image/network relationship;
- no production container attachment.

Inspect first:

```sh
docker inspect "$OWNED_SENTINEL_CONTAINER_ID"
docker inspect "$OWNED_API_PROBE_CONTAINER_ID"
docker network inspect "$OWNED_INTERNAL_NETWORK_ID"
docker network inspect "$OWNED_SENTINEL_NETWORK_ID"
docker image inspect "$OWNED_CANDIDATE_IMAGE_ID"
```

Only after every ownership assertion passes, remove those exact IDs:

```sh
docker rm -f "$OWNED_SENTINEL_CONTAINER_ID"
docker rm -f "$OWNED_API_PROBE_CONTAINER_ID"
docker network rm "$OWNED_INTERNAL_NETWORK_ID"
docker network rm "$OWNED_SENTINEL_NETWORK_ID"
docker image rm "$OWNED_CANDIDATE_IMAGE_ID"
```

If an ID is absent, reused, relabeled, attached unexpectedly, or ambiguous,
stop and report it; do not substitute a name, glob, label-only selection, or
computed target. Never run system/image/container/network prune.

Finally, inspect validation labels and record an empty result without deleting
anything else:

```sh
docker ps -a --filter label=io.s3a.validation-only=true --no-trunc
docker network ls --filter label=io.s3a.validation-only=true --no-trunc
docker image ls --filter label=io.s3a.validation-only=true --no-trunc
```

## Exit record

Record `PASS`, `BLOCKED`, `UNVERIFIED`, or `NOT_RUN_ENVIRONMENT` for each item.
Promotion remains forbidden unless the exact deployed digest, intended/denied
caller, proxy hops/timeouts, secret metadata/rotation state, liveness/readiness/
metrics, API/native DNS-TCP-UDP denial, and bounded cleanup are all evidenced
under separate deployment authorization.
