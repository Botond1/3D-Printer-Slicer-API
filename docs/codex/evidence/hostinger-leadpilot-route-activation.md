# Hostinger LeadPilot-only route activation evidence

## Classification

```text
OWNER_SUPPLIED_2026_09_01_LEADPILOT_ONLY_ROUTE_ACTIVE
router_activation=PASS phase=leadpilot-only entries=1
OWNER_SUPPLIED_CERTIFICATE_ISSUED
OWNER_SUPPLIED_EXTERNAL_ALLOWED_SOURCE_200
OWNER_SUPPLIED_EXTERNAL_UNLISTED_SOURCE_403
OWNER_SUPPLIED_REDIRECT_FOLLOW_REACHED_PUBLIC_443
THIS_REPOSITORY_TURN_DOCUMENTATION_ONLY_NO_LIVE_MUTATION
INDEPENDENT_REPETITION_NOT_PERFORMED
```

On 2026-09-01 the owner supplied the post-activation observations in this
record. This repository turn only records those facts and corrects the runbook.
It did not access or mutate the running host, containers, router, mounted
dynamic directory, DNS, allowlist, firewall, certificate state, or consumer
repository. No real caller address, credential, private router bytes, or other
host secret is recorded. The observations were not independently repeated by
this documentation task.

This record supersedes the route-state classification in
[`hostinger-traefik-deploy-preparation.md`](hostinger-traefik-deploy-preparation.md),
whose `PUBLIC_ROUTE_DISABLED_AT_PREPARATION_CHECKPOINT` status remains valid for
that earlier checkpoint.

## Route, TLS, and redirect observations

The owner reported the exact terminal router classification:

```text
router_activation=PASS phase=leadpilot-only entries=1
```

The certificate was issued. During ACME HTTP-01 processing, the observed log
included the exact bounded message:

```text
Validations succeeded; requesting certificates
```

This issuance succeeded while the global HTTP-to-HTTPS redirect was active, and
an external redirect-following client ended on public port 443. The observation
shows that the current pinned Traefik issuance path's HTTP-01 handling coexisted
with the corrected external-443 redirect. It does not prove a forced-renewal
rehearsal, future renewal continuity, expiry handling, or ACME recovery from a
snapshot.

## External caller-layer observations

From the sole approved `/32`, the external request returned HTTP 200. From an
unlisted external source, the current pinned Traefik/live route returned exactly
this wire shape:

```http
HTTP/1.1 403 Forbidden
Content-Length: 9

Forbidden
```

There was no `Content-Type` header. This exact header/body shape is live edge
evidence for the currently pinned Traefik behavior; it is not derivable from the
router template alone.

The consumer's intentional layer mapping is therefore:

- HTTP 403 with no `Content-Type`: the edge does not recognize the caller's
  source address;
- HTTP 401 with the API's structured application envelope: the source passed
  the edge, but the supplied application key is wrong.

The network rejection deliberately does not imitate an application envelope.
This separation is a contract, not a missing response header.

The external HTTP 403 proves the Traefik `ipAllowList` denial path only. It is
not the runbook's separate host-firewall evidence: a qualified `DOCKER-USER`
deny requires the expected TCP reset plus exact rule/counter observations, not
an HTTP status.

## Operator blockers captured in the runbook

The live execution exposed four prerequisites that were implicit in code but
not explicit enough for the next operator:

1. The operator pack must be a real Git checkout or linked worktree. A release
   tarball or copied tree has no required repository identity and fails at pack
   load with `operator_pack_file_invalid` because `loadOperatorPack()` invokes
   `validateRepositoryPrivateStorageContract()` and its exact Git-root checks.
2. Lock-bearing router helpers require host Node.js `v20.20.2`. An ordinary
   Docker/Compose wrapper cannot preserve and prove the already-held host FD 9
   lock identity. The minimal host installation copied `/usr/local/bin/node`
   from an already verified immutable-digest full `node:20-bookworm` image,
   without adding an APT source. The slim image lacks Git; containerized,
   validation-only contract checks require the full image.
3. Every fresh release checkout must normalize the root-owned `0700` dynamic
   and runtime-private directories, the `0600` `.gitkeep`, and the create-only
   `0600` lock. Git does not preserve these exact directory and non-executable
   file modes, and the ignored runtime-private children do not exist after a
   clone.
4. `--render-router` requires a canonical absolute direct child of the staging
   directory with basename `slicer-api-<run-token>.yml.tmp`. A relative target
   fails with `router_private_storage_path_invalid`.

The authoritative commands, mode normalization block, FD 9 boundary, and
literal validator-required helper placeholders remain in
[`ops/hostinger/RUNBOOK.md`](../../../ops/hostinger/RUNBOOK.md).

## NOT VERIFIED by this documentation turn

- independent repetition of the owner-supplied route, certificate, redirect,
  allowed-source 200, or blocked-source 403 observations;
- exact `DOCKER-USER` rule identity, TCP-reset behavior, packet-counter change,
  UFW/Docker-proxy interaction, or host-firewall rollback;
- forced ACME renewal, renewal continuity, certificate rollback, or ACME-state
  recovery rehearsal;
- a complete active-to-dark-to-active router rollback/recovery rehearsal after
  this permanent activation;
- monitoring, alerting, incident recovery, or owner acceptance of those paths;
- consumer-repository behavior, customer traffic, customer-data handling, or
  end-to-end production completeness.

The current route is owner-reported active for the sole `leadpilot-only` source
entry; none of the remaining items above may be inferred from that activation.
