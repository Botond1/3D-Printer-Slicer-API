# I6/S5 private-peer topology evidence

## Decision and checkpoint

- Decision: `PRIVATE_PEER_TOPOLOGY_SELECTED; ASYNC_WORKER_DEFERRED`.
- Atomic repository delta:
  `549fa4258c60b2971855e7a202e488d74427ccd4` followed by
  `7dd6d73632856967824570c6e38c54b905d032b1`.
- Scope: repository implementation and validation contracts only. No deploy,
  host, proxy, firewall, secret-delivery, or production result is claimed.

I4 and I5 evidence remains historical and is not rewritten. I6 replaces the
I5 loopback-publish topology candidate; it does not retroactively change the
results recorded in
[`i4-s2-resource-state-envelope.md`](i4-s2-resource-state-envelope.md) or
[`i5-s4-trust-topology-observability.md`](i5-s4-trust-topology-observability.md).

## Readiness freshness correction

Commit `549fa42` adds a direct `getFreshStatus()` probe path. Protected
`GET /health/detailed` uses that path, so its queue and admission diagnostics
are evaluated for the request. Public `GET /ready` and protected
`GET /operations/readiness` continue to use the bounded readiness cache.
Detailed health still adds the Python availability check. This is repository
behavior, not proof of production readiness.

## Selected repository topology

Commit `7dd6d73` selects a validation topology with these fail-closed
properties:

- the API and one authenticated peer are attached only to one internal private
  bridge; the API has no host-published port and no external default route;
- the peer represents the authorized reverse-proxy role, receives only the
  operations credential among scoped API credentials, and has no host port,
  host namespace, host mount, device, privilege, or added capability;
- API proxy trust is pinned to the private peer address for the disposable
  validation topology;
- the peer must reach public `/health` and `/ready`, reach protected
  `/operations/readiness` with the operations key, and receive the exact
  operations HTTP 401 contract for missing and wrong keys;
- an owned sentinel first calibrates Node and spawned-Python DNS/TCP/UDP
  reachability while temporarily attached, then is detached; all six API/native
  probes must be denied afterward;
- exact image identity, non-root identity, read-only roots, capability drop,
  resource limits, restrictive tmpfs, labels, network membership, static
  addresses, aliases, and cleanup ownership are validated.

The evidence schema is `i6-s5-private-peer-v1`. Success requires every boolean
proof true: private-peer ingress, authenticated readiness, authentication
rejection, API and native egress denial, host-port absence, no API external
default route, internal networking, and a calibrated operational sentinel.
Capability and enforcement failures remain explicit
`BLOCKED_I6_PRIVATE_PEER_CAPABILITY`,
`BLOCKED_I6_EGRESS_ENFORCEMENT`, or
`BLOCKED_I6_RUNTIME_CAPABILITY`; they are never success.

## Deployment boundary

The repository does not define or prove the deployed peer implementation. An
authorized reverse proxy may also attach to a separate ingress network, but the
API must remain internal-only. The proxy must not give the API a generic
forward-proxy, NAT, or DNS-tunnelling path. Deployed proxy CIDR/nearest-hop
configuration and credential delivery are operator inputs.

The intended caller, denied caller, proxy hop, production secret ownership and
mode, deployed immutable image digest, Hostinger network/proxy/firewall state,
and deployed API/native egress behavior are all `UNVERIFIED`. Use
[`../i6-s5-private-peer-operator-validation.md`](../i6-s5-private-peer-operator-validation.md)
under separate authorization. I6 does not authorize deployment, promotion, or
external probing.
