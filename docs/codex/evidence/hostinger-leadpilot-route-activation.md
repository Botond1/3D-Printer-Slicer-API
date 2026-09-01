# Hostinger LeadPilot-only route activation evidence

## Classification

```text
OWNER_SUPPLIED_2026_09_01_LEADPILOT_ONLY_ROUTE_ACTIVE
router_activation=PASS phase=leadpilot-only entries=1
OWNER_SUPPLIED_CERTIFICATE_ISSUED
OWNER_SUPPLIED_EXTERNAL_ALLOWED_SOURCE_200
OWNER_SUPPLIED_EXTERNAL_UNLISTED_SOURCE_403
OWNER_SUPPLIED_REDIRECT_FOLLOW_REACHED_PUBLIC_443
OWNER_SUPPLIED_IPV4_PERIMETER_CALLER_TIMEOUT_WITH_DENY_COUNTERS
OWNER_SUPPLIED_IPV6_INPUT_443_BLOCK_PASS
OWNER_SUPPLIED_PERIMETER_IDEMPOTENT_3_IPV4_1_IPV6
OWNER_SUPPLIED_DOCKER_SERVICE_RESTART_SURVIVAL_PASS
OWNER_SUPPLIED_REAL_HOST_REBOOT_SURVIVAL_PASS
OWNER_SUPPLIED_PERIMETER_PERSISTENCE_COMPLETE_AT_NORMAL_REBOOT
POINT_IN_TIME_NORMAL_REBOOT_ONLY_NO_FUTURE_GENERALIZATION
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

The complete caller-visible layer mapping is therefore:

- connection timeout with no response: the host-network perimeter did not
  admit the source;
- HTTP 403 with no `Content-Type`: the request reached Traefik, whose router
  allowlist does not recognize the caller's source address;
- HTTP 401 with the API's structured application envelope: the source passed
  the edge, but the supplied application key is wrong.

The network rejection deliberately does not imitate an application envelope.
This separation is a contract, not a missing response header. The owner reports
that the consumer was separately updated to recognize the timeout as a third
outcome; that consumer implementation is outside this repository and was not
verified by this documentation change.

The external HTTP 403 proves the Traefik `ipAllowList` denial path only. It is
not the host-firewall result documented below.

## Host-firewall correction and caller-visible timeout

The owner measured the IPv4 deny three ways on the same host. All three waited
the complete client timeout and returned no bytes:

1. internal destination port `8443` with `REJECT --reject-with
   icmp-admin-prohibited`;
2. internal destination port `8443` with `REJECT --reject-with tcp-reset`;
3. conntrack original destination plus original port `443` with
   `REJECT --reject-with tcp-reset`, repeated twice with a 15-second timeout.

The rules were active in every case: the exact deny counter increased for each
SYN, while the allowlisted source continued to receive HTTP 200 in about 0.1
seconds. The measured structural explanation is that IPv4 `DOCKER-USER` runs
in `FORWARD` after Docker DNAT. A rejection generated there carries the private
container address as source and is not translated back to the connection that
never completed, so it is discarded in transit or by the caller's network
stack. From the caller's perspective the host perimeter behaves as a drop even
though the installed terminal action remains `REJECT --reject-with tcp-reset`.
The caller sees "API unreachable" by timeout, not an immediate refusal or HTTP
status.

This corrects the earlier runbook assumption that the caller would receive a
TCP reset. `REJECT` versus `DROP` must not be reopened without new contrary
evidence: both rejection forms and all three matching forms above were tried
and measured.

## IPv6 enforcement seam

Before the IPv6 correction, an arbitrary IPv6 client completed the TLS
handshake and received Traefik HTTP 403. The application edge denied it, but the
IPv4-only network perimeter did not observe it. The owner reported that this
host performs no IPv6 DNAT for the public listener: Docker serves `[::]:443`
through `docker-proxy`, so inbound IPv6 reaches the host `INPUT` chain and does
not traverse `DOCKER-USER`. An IPv6 rule in `DOCKER-USER` would therefore be a
non-enforcing control.

With no `AAAA` record and no approved IPv6 caller, the installed correction
rejects every new inbound IPv6 TCP connection to port 443 in `ip6tables INPUT`.
IPv6 port 80 remains untouched; production ACME HTTP-01 validated over IPv4 in
the no-`AAAA` topology. After the correction, the IPv6 observation changed from
Traefik HTTP 403 to no response, while SSH and the IPv4 path remained unchanged.

## Versioned perimeter artifacts and operational observations

The exact tested host artifacts, normalized to remove the real hostname and
release-SHA path defaults, are now versioned at:

- `ops/hostinger/perimeter/r3d-perimeter.sh`;
- `ops/hostinger/perimeter/r3d-allowlist-probe.sh`;
- `ops/hostinger/perimeter/r3d-perimeter.service`.

The perimeter script requires `R3D_ALLOWLIST_FILE` and
`R3D_PUBLIC_IPV4_FILE` as explicit operator inputs. The probe defaults only to
`slicer-api.invalid`; the approved hostname is operator input. Real addresses,
hostnames, and root-private paths are not stored in the repository.

The owner reported these point-in-time installation observations:

- IPv4 matching uses conntrack original destination and original destination
  port 443, without a plain destination-port match;
- three consecutive applications remained idempotent at exactly three owned
  IPv4 rules and one owned IPv6 rule;
- the policy and rule counts survived a Docker-service restart;
- the approved source returned HTTP 200 in about 0.1 seconds;
- blocked IPv6 port 443 returned no response;
- port 80 remained reachable;
- the loopback Traefik-only probe returned HTTP 403.

The owner then supplied one real normal-host-reboot observation:

- the boot timestamp was `2026-09-01 13:14:41`, and the host was reachable in
  about 40 seconds;
- `r3d-perimeter.service` was both `active` and `enabled` and reapplied its
  rules at boot;
- the post-boot policy was exactly three owned IPv4 rules plus one owned IPv6
  rule, the same counts as before reboot;
- the current API and Traefik containers were both `healthy` at `t+5s`;
- the API remained on the deployed candidate image, identified in this reboot
  record only by prefix `sha256:153987840361...`;
- the approved caller received HTTP 200 with valid TLS in 0.13 seconds;
- IPv6 port 443 remained blocked, while port 80 remained reachable and ACME
  was unaffected;
- the loopback Traefik-only probe returned HTTP 403;
- the retained old `traefik-traefik-1` container still existed, remained
  stopped with exit code 0 and restart policy `unless-stopped`, reported
  runtime `ports={}`, and did not occupy host ports 80 or 443.

This one owner-observed normal reboot closes the last open perimeter-
persistence element for this exact host configuration. It is point-in-time
evidence, was not independently repeated by this documentation task, and does
not prove continuity of pre-reboot counters or rule objects, freedom from every
boot-order race, a future reboot, Docker-crash recovery, or crash/power-loss
recovery. The observed mechanism is the enabled service reapplying the policy
at this one normal boot. The stopped container's runtime `ports={}` does not
prove empty saved `HostConfig.PortBindings` or `Config.ExposedPorts`, inability
to reclaim 80/443 if later started manually, or rollback usability; exact
identity, recovery-ledger, saved-configuration, and fresh listener inventory
remain mandatory.

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
  allowed-source 200, blocked-source 403, firewall timeout, IPv6 block,
  idempotency, Docker-restart, normal-reboot, boot-time service/rule/container
  state, port-80, retained-old-proxy, or loopback observations;
- any future reboot after relevant image/network/service/firewall change, real
  crash/power-loss recovery, or general boot-order guarantee beyond this one
  normal-reboot observation;
- host-firewall rollback from the currently installed policy;
- forced ACME renewal, renewal continuity, certificate rollback, or ACME-state
  recovery rehearsal;
- a complete active-to-dark-to-active router rollback/recovery rehearsal after
  this permanent activation;
- monitoring, alerting, incident recovery, or owner acceptance of those paths;
- consumer-repository behavior, customer traffic, customer-data handling, or
  end-to-end production completeness.

The current route is owner-reported active for the sole `leadpilot-only` source
entry; none of the remaining items above may be inferred from that activation.
