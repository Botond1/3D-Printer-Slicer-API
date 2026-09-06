# Bambu signed Slicer release — 2026-09-07 (Europe/Budapest)

The Slicer and local WordPress ZIP release are verified within the scope below.
The complete two-consumer chain is not verified: the owner forbids further
LeadPilot work. No customer models, physical printing, external sends, live
WordPress installation, route/allowlist change or pricing mutation was performed.

## Immutable identities and promotion

- Source PR25: head `30fdd9f34a294bfbf11db5f4534e0edfbfa1a381`, merge `4539c539d15dacb19cde7e246aab690cc11170e7`.
- Required PR Source34059147234 and Image34059147236 PASS; required main
  Source34059746024 and Image34059746046 PASS. PR merge-candidate and resulting
  main trees equal the tested head tree `a1b9f7098419af5f9e107fde8c368a06c25d3d6c`.
- Manual signed publication34063787067, exact main source above; immutable image
  `ghcr.io/botond1/3d-printer-slicer-api@sha256:1c784b627fc5783b633b9a0b7c2b086588fbe149c00770d7f0cac5594860efb9`. Publication and independent attestation verification are retained.
- Production verification finished `2026-09-06T22:42:59.779610+00:00` (UTC).
  Container `605f1fa120aa6668d6f176cdfcc03627688a30abe0cb52fd3f4408c91f0dd8c0` is healthy, non-root/read-only and
  bound to the qualified image. The post-deploy synthetic normal Bambu API
  control returned829s/1.78g with matching source, generation, profile and receipt.
- API Compose pack stays `4fb770d792eac932f02a6c9b3f407a7822a1996b`;
  live Traefik operator pack stays `9e9621a3f6110192aeb77a5c182da5aad79c80e7`.
  The live dynamic-source identity was checked with the existing router helper.
  Credentials, mount paths, pricing state and proxy identity/content are unchanged.

## Strongest evidence

The private-free release ledger is `C:/tmp/r3d-bambu-release-20260906`.
Its final report/index bind commands, source manifests, exit codes and hashes;
private operator files are excluded. The earlier235-artifact ledger remains unchanged.

- Exact Git-byte source archive602/602 verified. Application/build inputs are
  identical between the2562e92 independent image and the final head; subsequent
  corrections affect qualification scripts/tests/docs only.
- Local2746JS PASS,225Python PASS/1Windows POSIX skip; final Linux image-dependency
  run226/226 Python PASS, no skips. A read-only existing host Git binary is only
  a unit-test helper; the production image is unmodified and does not bundle Git.
- Native Bambu matrix39/39, operations7/7, rendering8/8, catalogue/Prusa11/11.
  Independent direct-native JSON/G-code/3MF reference agrees with normal API
 829s/1.78g; raw estimates are not physical calibration.
- Linux engine build `0dd1ab55a0f6237ac4a47f76b4b0966464caa79e6789a792dc251e0d0235786c`;
  measurement generation `dd08df79e17470264170011119807c583d4bec56b137da0c91c81b14eb67f61e`.
- WordPress ZIP source `2861a8107d0dad783bcf5c81dc167a23ec23f340`;
  SHA256 `3a6647e1e416b3d3db0b07cf633fb584957d91ddfaa8ca80c2a31194e2f3cfce`.
  Normal bin/verify.sh completed VERIFY:OK; the real isolated DB/Action Scheduler/
  Woo order gate passed1test82assertions. The signed-image repetition, migration,
  stored mutations, failure-injection results and exact ZIP closure are in its lane.

## Final isolated consumer and cleanup evidence

The signed-image Woo repetition passed 1 test / 82 assertions in 17.927 s.
The Bambu result, persisted fact and actual order agree at 829 s / 1.78 g;
quantity 3 produces a synthetic unpaid BACS order at 4699 HUF. Eight persisted
mutations are rejected before the restored valid order. A separate fault gate
passed 1 test / 219 assertions, covering HTTP 429, 503, a fully received native
response lost before delivery, breaker recovery and terminal duplicate delivery.
Actual SQL-expired orphan reconciliation passed 1 test / 37 assertions with
zero HTTP calls. These are bounded subsets, not full crash/deadline proof.
Migration rehearsal passed 1 test / 25 assertions: dry-run has zero writes,
apply is repeatable, and historic facts and Woo metadata remain immutable.

The owned API test container, internal network, Buildx builder and local-only
candidate tag were removed after production verification. Production and proxy
identities stayed unchanged; rollback images and private backups remain.
The owned MariaDB shut down gracefully with no active jobs. Fault proxy and
database listener ports closed. Tunnel closure is recorded in the final ledger.
No global Docker prune or preexisting service cleanup was used.

## Rollback and remaining scope

The prior signed4fb770d image (digest c32b4c6f659b6b75cd504213014c1c95da9ab6d293b18906e8f3c78425f3159b)
and the older3.2.0 image remain available. A root-private pre-deploy operator/runtime
backup is retained. Rollback restores the previous image value in the existing
operator file and uses the same `slicer-api` Compose project with `--no-deps --pull never`;
it never rewrites consumer facts or disables guards. Rollback was prepared but
not exercised because deployment succeeded. Do not blindly restore runtime
data over later customer writes. Further rollback is an owner-authorized operation.

The current route remains restricted to its prior caller policy. ZIP delivery does
not activate a live WordPress integration. LeadPilot full Redis/business approval
and dual-consumer batch/interactive acceptance remain owner-blocked. Full physical
crash/restart/deadline/cancellation and long-run capacity claims are not inferred
from bounded controls; the final BT matrix states the precise tested subsets.
CAD/tessellation provenance and native-warning classification retain the limits
documented in the September6 handoff. SLA motion calibration remains provisional.

An earlier target-selection mistake created only own isolated database test
resources on the wrong VPS. Those exact resources were fully removed on
2026-09-06 18:15:13UTC; all ten preexisting services retained their IDs and running
state. No existing service, environment, DB or business data was modified.
This incident is recorded in `WRONG_VPS_INCIDENT.md`; zero host side effects are
not claimed. All subsequent remote work used the verified Slicer target.

Historical files under `docs/codex/history-waves.md` and old evidence are retained
verbatim. The present documentation commit does not replace the deployed image
source SHA or imply a new image publication.
