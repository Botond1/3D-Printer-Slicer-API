# I6/S5 private-peer operator validation

## Safety and required inputs

Run only in an explicitly authorized deployment-validation window. Do not
enable shell tracing, print credentials, read secret contents, use customer
data, change firewall/proxy rules, or infer a pass from repository tests.
Every result below starts as `UNVERIFIED`.

Supply exact values through the approved operator channel:

```text
EXPECTED_SOURCE_SHA
EXPECTED_IMAGE_DIGEST
API_CONTAINER_ID
PRIVATE_NETWORK_ID
PROXY_CONTAINER_ID
EXPECTED_PROXY_PRIVATE_CIDR
EXPECTED_PROXY_HOPS
INTENDED_CALLER_HOST
DENIED_CALLER_HOST
API_PRIVATE_URL
SECRET_FILE_OR_MOUNT_PATH
EXPECTED_SECRET_OWNER_UID
EXPECTED_SECRET_OWNER_GID
EXPECTED_SECRET_MODE
SENTINEL_DNS_NAME
SENTINEL_TCP_HOST
SENTINEL_TCP_PORT
SENTINEL_UDP_HOST
SENTINEL_UDP_PORT
```

Load `OPERATIONS_API_KEY` from the approved secret source without echoing it.
Record UTC time, operator/change-window ID, and exact opaque resource IDs.

## 1. Image digest

```sh
git rev-parse HEAD
docker inspect --type container --format \
  '{{.Id}} {{.Image}} {{json .Config.Labels}}' "$API_CONTAINER_ID"
docker image inspect --format '{{.Id}} {{json .RepoDigests}}' \
  "$EXPECTED_IMAGE_DIGEST"
```

Require exact source SHA and require the running container image to resolve to
`EXPECTED_IMAGE_DIGEST`. A mutable tag or local image ID is not a deployed
registry digest. Record mismatch and stop; do not pull or restart.

## 2. Internal-only API and proxy peer

```sh
docker inspect --type container --format \
  '{{json .HostConfig.PortBindings}} {{.HostConfig.PublishAllPorts}} {{json .NetworkSettings.Ports}} {{json .NetworkSettings.Networks}}' \
  "$API_CONTAINER_ID"
docker network inspect "$PRIVATE_NETWORK_ID"
docker inspect --type container --format \
  '{{json .NetworkSettings.Networks}} {{json .HostConfig.PortBindings}}' \
  "$PROXY_CONTAINER_ID"
ss -lntp
```

Require no API host-published port, no public API listener, and only the
approved internal private network on the API. Require the authorized reverse
proxy to be the API's peer on that network. The proxy may also have its
approved ingress network. Reject any proxy configuration that provides the API
generic forward-proxy, NAT, or DNS-tunnelling service.

## 3. Intended and denied callers

From `INTENDED_CALLER_HOST`, through the approved proxy route:

```sh
curl --fail-with-body --silent --show-error --connect-timeout 3 --max-time 10 \
  "$API_PRIVATE_URL/health"
curl --fail-with-body --silent --show-error --connect-timeout 3 --max-time 10 \
  "$API_PRIVATE_URL/ready"
curl --fail-with-body --silent --show-error --connect-timeout 3 --max-time 10 \
  -H "x-api-key: $OPERATIONS_API_KEY" \
  "$API_PRIVATE_URL/operations/readiness"
```

Require exact liveness/minimal-readiness shapes and bounded authenticated
operations readiness. Missing and deliberately wrong operations keys must each
return HTTP 401 with `OPERATIONS_AUTH_REQUIRED`.

From `DENIED_CALLER_HOST`, require network denial or an explicit authenticated
proxy rejection. A timeout alone is insufficient without the matching
firewall/proxy rule evidence. Never expose a temporary API host port.

For a separately authorized controlled queue transition, sample protected
`/health/detailed` immediately before and during the transition and verify its
queue fields change without waiting for cache expiry. Verify `/ready` and
`/operations/readiness` retain their bounded cached behavior. Do not use
customer files or overload the service.

## 4. Proxy hop

Record the deployed proxy configuration and prove that
`EXPECTED_PROXY_PRIVATE_CIDR` and `EXPECTED_PROXY_HOPS` match the actual nearest
trusted peer chain. From the intended caller, send a documentation-only spoofed
prefix:

```sh
curl --fail-with-body --silent --show-error --connect-timeout 3 --max-time 10 \
  -H 'X-Request-Id: operator.proxy.expected' \
  -H 'X-Forwarded-For: 198.51.100.77, 192.0.2.55' \
  "$API_PRIVATE_URL/health"
```

Require nearest-untrusted-hop identity; the spoofed leftmost prefix must never
be selected. Repeat from the denied direct peer only when separately
authorized. Also verify an injection-shaped request ID is replaced with a
bounded safe response ID.

## 5. Secret mode and scope

```sh
stat --format '%u %g %a %F %n' "$SECRET_FILE_OR_MOUNT_PATH"
findmnt --noheadings --output TARGET,SOURCE,FSTYPE,OPTIONS \
  --target "$SECRET_FILE_OR_MOUNT_PATH"
```

Require the approved source, exact owner UID/GID, restrictive
`EXPECTED_SECRET_MODE`, and approved mount semantics without reading contents.
Record active/previous state without values. Prove the proxy receives only the
credential audiences it requires; the repository validation peer receives only
the operations key.

## 6. API and native egress behavior

Use only an operator-owned synthetic sentinel. First prove DNS/TCP/UDP on the
sentinel from its authorized control path. Then, without attaching an external
network to the API, run bounded Node/API and spawned-Python probes for the exact
sentinel DNS name, TCP endpoint, and UDP endpoint.

| Proof | Required result |
| --- | --- |
| Sentinel control DNS/TCP/UDP | succeeds |
| API DNS/TCP/UDP | all denied |
| Spawned Python/native DNS/TCP/UDP | all denied |
| API external default route | absent |
| Proxy forward/NAT/DNS tunnel usable by API | absent |
| Intended caller through authorized peer | succeeds |
| Denied caller | denied |

DNS failure alone does not prove TCP or UDP denial. Record firewall/network
rules and bounded probe results. Any API/native sentinel success blocks I6/S5.

## Exit record

Record `PASS`, `BLOCKED`, `UNVERIFIED`, or `NOT_RUN_ENVIRONMENT` separately for
intended caller, denied caller, proxy hop, secret mode, image digest, and egress
behavior. Until all six are evidenced against one exact deployed digest, all
Hostinger/proxy/firewall/deployment facts remain `UNVERIFIED`; no repository
document authorizes promotion or production.
