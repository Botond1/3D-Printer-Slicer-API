# I5/S4 scoped trust, topology, and observability evidence

## Status

- Stage result: `IN_PROGRESS` pending final exact-SHA hosted validation.
- Exact source baseline:
  `5be7b19d13616f06504c18217e25bf95c97c6e96`.
- Branch: `codex/i5-s4-trust-topology-observability`.
- Prior candidate source SHA:
  `510e6110ef5c49cd03962627210d6db114554618`.
- Authorization boundary: one final normal non-force target-branch push and
  hosted validation are authorized. Deployment and production actions are not.

## Hosted corrective diagnosis

Exact candidate `510e6110ef5c49cd03962627210d6db114554618`
passed Source run `30037842766`. Image run `30037842526` failed closed with two
independent final classifications:

- `runtime_resource_contract_failure:container_probe_failure`;
- `topology_gate_failure:private_topology_contract_failure`.

The same image run proved exact image/non-root identity, health, authenticated
Prusa and Orca slices, active abort admission and server/native settlement, no
bounded post-abort promoted artifact, an operational egress sentinel, valid
SBOM, Grype HIGH=0/CRITICAL=0, zero known Swiper advisories, bounded evidence
upload, and exact cleanup. The old abort probe required one timing-dependent
client exception. The old topology assertion also treated realized
`NetworkSettings.Ports` as the requested binding contract.

The corrective source preserves substantive abort invariants while accepting
only allowlisted bounded abort exception, transport-close, or non-success
terminal-response representations. A pure topology validator now uses exact
`HostConfig.NetworkMode` and singleton
`HostConfig.PortBindings['3000/tcp']={HostIp:127.0.0.1,HostPort:31000}`;
external-default-route absence is a separate bounded runtime projection.
Docker API 1.48 and Docker Desktop 29 disposable fixtures demonstrated that
the canonical requested binding can coexist with an empty realized
`NetworkSettings.Ports` list. Fixture resources and the port listener were
removed exactly. Final hosted results are not pre-claimed.

Repository source and deterministic test contracts are implemented for scoped
credentials, Origin/proxy/request identity, readiness, structured events, and
metrics. The required topology cannot simultaneously expose the loopback
listener and deny API/native egress in the available Docker Desktop
environment. This is a blocker, not a skipped or passing gate.

## Hosted baseline anchor

| Evidence | Exact result |
| --- | --- |
| Source Validation | Run `30022045664`: `PASS` |
| Image Validation | Run `30022045578`: `PASS` |
| Baseline image used for local A/B | `sha256:5f159e1051233811ad663175311059829aecdbff16706e39aceba4aac77f9aa3` |

These are baseline results only. They do not describe the final committed
candidate or any deployed/registry identity.

## Repository security contracts

### Scoped credentials

| Audience | Active / optional previous | Header | Protected routes |
| --- | --- | --- | --- |
| Slice | `SLICE_SERVICE_API_KEY`, `SLICE_SERVICE_API_KEY_PREVIOUS` | `x-slicer-api-key` | `POST /prusa/slice`, `POST /orca/slice` |
| Pricing | `PRICING_API_KEY`, `PRICING_API_KEY_PREVIOUS` | `x-api-key` | pricing mutations |
| Artifact | `ARTIFACT_API_KEY`, `ARTIFACT_API_KEY_PREVIOUS` | `x-api-key` | output listing/download |
| Operations | `OPERATIONS_API_KEY`, `OPERATIONS_API_KEY_PREVIOUS` | `x-api-key` | detailed health/readiness/metrics |

Startup requires every active scoped key in normal operation. All configured
material must be distinct, non-placeholder, printable ASCII, and 32-256 bytes.
Every request compares fixed-length active and previous digests. Cross-audience
material is rejected.

Rotation is restart-bounded:

1. Set the replacement as active and the former active as previous; restart.
2. Move the intended caller to the replacement and verify old/new behavior.
3. Remove previous; restart again. The former key is then revoked.

`ADMIN_API_KEY` is migration-only. It can fill one missing active key for
`pricing`, `artifact`, or `operations` only when
`LEGACY_ADMIN_API_KEY_AUDIENCE` and a future
`LEGACY_ADMIN_API_KEY_MIGRATION_UNTIL` no more than 90 days away are valid.
Slice, broad, expired, or malformed migration fails startup.

### Origin, proxy, and request identity

- No-Origin service requests remain allowed.
- Browser-origin protected requests use only the matching
  `SLICE_`, `PRICING_`, `ARTIFACT_`, or
  `OPERATIONS_CORS_ALLOWED_ORIGINS` value.
- Proxy trust defaults false. Enabled trust requires unique explicit IP/CIDR
  peers or `loopback`; wildcard, overbroad, malformed, duplicate, empty-enabled,
  and unknown-name configuration refuses startup.
- Nearest-untrusted-hop resolution prevents an untrusted direct/intermediate
  peer from selecting a spoofed `X-Forwarded-For` prefix.
- Safe inbound request IDs are 1-128 characters, start alphanumeric, and then
  contain only alphanumeric, `.`, `_`, `:`, or `-`. Invalid input is replaced;
  the resolved value is returned in `X-Request-Id`.

### Readiness and observability

- Public `/health` is liveness.
- Public `/ready` returns only READY/NOT_READY with HTTP 200/503.
- Operations scope protects `/health/detailed`,
  `/operations/readiness`, and `/operations/metrics`.
- Stable readiness reasons are `SHUTDOWN`, `ADMISSION_CLOSED`,
  `QUEUE_UNAVAILABLE`, `NATIVE_RUNTIME_QUARANTINED`, `STORAGE_UNSAFE`,
  `RETENTION_UNSAFE`, `PRICING_UNAVAILABLE`, and `CONFIG_UNSAFE`.
- Version-1 JSON events use a fixed vocabulary and bounded
  request/job/artifact correlation. Allowlisted fields neutralize injection and
  exclude credentials, paths, filenames, customer data, arbitrary event names,
  and unbounded values.
- Prometheus metrics use fixed enums for audience, outcome, rejection/resource
  reason, native outcome, and native duration bucket. Request/job/artifact IDs,
  filenames, materials, profiles, and customer values are not labels.
- Raw native stdout/stderr is not emitted.

Event vocabulary:

```text
artifact.accessed
artifact.cleanup
artifact.downloaded
artifact.evicted
artifact.lease_acquired
artifact.lease_released
artifact.promoted
auth.rejected
native.completed
native.quarantined
native.started
native.termination_settled
pricing.mutated
queue.admitted
queue.expired
queue.rejected
queue.shutdown
readiness.changed
resource.rejected
request.accepted
request.completed
request.rejected
shutdown.started
startup.completed
```

Metric families:

```text
slicer_http_requests_total
slicer_auth_rejections_total
slicer_queue_rejections_total
slicer_native_active
slicer_native_outcomes_total
slicer_native_duration_ms_bucket
slicer_resource_failures_total
slicer_artifacts_retained
slicer_artifact_bytes_retained
slicer_artifact_cleanup_runs_total
slicer_artifact_cleanup_removed_total
slicer_artifact_cleanup_removed_bytes_total
slicer_readiness
slicer_shutdown
slicer_queue_active_jobs
slicer_queue_queued_jobs
slicer_queue_accepting_jobs
```

## Local Docker Desktop A/B

Environment: Docker Desktop 29.6.1.

### A: ordinary non-internal bridge plus loopback publish

- `/health`: HTTP 200.
- Protected detailed health: HTTP 200.
- API DNS/TCP/UDP egress to the owned sentinel: succeeded.
- Spawned Python/native DNS/TCP/UDP egress to the owned sentinel: succeeded.

This proves the ingress-capable ordinary bridge does not meet the egress-denial
requirement.

### B: internal bridge plus loopback publish

The final reordered gate confirmed:

| Field | Result |
| --- | --- |
| `sentinelOperational` | `true` |
| `internalNetwork` | `true` |
| `apiEgressDenied` | `true` |
| `nativeEgressDenied` | `true` |
| `loopbackIngress` | `false` |
| `authenticatedReadiness` | `false` |

Docker reported no usable published port/host listener for the internal bridge.
Therefore egress denial was proven only in a topology that failed required
loopback ingress.

Compose intentionally remains unchanged, loopback-published on its ordinary
bridge. No sidecar or alternative architecture was introduced.

## Local candidate validation

| Gate | Result |
| --- | --- |
| Docker/workflow contracts before final topology rerun | 281/281 pass |
| Topology mutation | 27/27 pass |
| Quality I5 focused | 82/82 pass |
| Lifecycle/security focused | 62/62 pass |
| Combined focused | 60/60 pass |
| Earlier legacy focus | 365/365 pass |
| App JavaScript syntax | 77/77 pass |
| Repository syntax | 128 tracked JavaScript + 31 Python, plus direct new-file checks |
| Python unit | 42 pass, 1 skip |
| Final topology/S3a workflow contracts | 306/306 pass |
| Final I5 focused | 82/82 pass |
| Exact npm 10.9.8 aggregate JavaScript | 754/754 pass |
| Python aggregate | 43 run, 42 pass, 1 POSIX-only skip |
| Full `npm test` | pass |
| Final tracked syntax | 128 JavaScript + 31 Python pass |
| Production audit at high threshold | 0 vulnerabilities |
| Operations integration runner | 7/7 pass; generated report read; short-lived listener removed |
| Exact local candidate image build | pass |
| Exact local candidate image ID | `sha256:195d74b79db26d4d2fa97825dd1f58a35c8052ee003dd7afce58cf7defdb40a8` |
| `actionlint` | unavailable |

The exact local candidate image ID is local build identity, not a registry
digest or deployed identity. It was removed after exact cleanup.

An earlier quality run reported 753/754 because an aggregate-only
partial-cleanup timeout passed when isolated. The exact npm 10.9.8 final rerun
subsequently passed 754/754. These are local repository results, not hosted or
deployed proof.

## Cleanup evidence

The final topology run removed the exact two containers, two networks, evidence
files/logs, and candidate image tag/ID it owned. It performed no prune. Final
validation-label scans were empty. The earlier baseline A/B resources were also
removed exactly.

## Pending and unverified

- Final candidate source SHA: the committed branch tip recorded by the closing
  execution report.
- Hosted exact-candidate Source/Image/topology results: `NOT_DISPATCHED`
  because the mandatory local topology gate is blocked.
- Intended and denied deployed caller evidence: `UNVERIFIED`.
- Deployed immutable digest and VPS state: `UNVERIFIED`.
- External reverse-proxy CIDRs, hop count, and timeouts: `UNVERIFIED`.
- Host firewall and API/native egress enforcement: `UNVERIFIED`.
- Production secret source, ownership, filesystem mode, and
  current/previous/revoked state: `UNVERIFIED`.
- Branch protection and required checks: `UNVERIFIED`.
- S3b promotion, staging readiness, rollback, and production readiness:
  `UNVERIFIED`.

S5 owns the isolated-worker/firewall architecture decision. The authorized
push remains withheld by the fail-closed local gate; no repository result here
authorizes production, promotion, deployment, or VPS probes.
