# Private A/B run of slicer 3.9.0 — operator sequence

Spec §8 step 1 (night window 00:00–05:00 Budapest). Two scripts sit beside this file:

- `make-corpus.js <dir>` writes the synthetic corpus (code-generated STLs, core 3MFs, one AP214 STEP block, `cases.json`). No customer file.
- `ab-client.js <subcommand>` is the measurement client. It runs as a second container on the internal network `r3d-s390-internal`, from the same slicer image, with `--entrypoint node`. It reads the keys from `process.env` (the 0600 env file passed with `--env-file`) and never prints or writes them: every output line and file is redacted against every `*_KEY` value in its environment.

The private service itself is started and removed only by `run-private-ab.sh` (`compose.private.yml`: no published port, internal network only, `oom_score_adj` 1000, 3 GiB / 2 CPU, `MAX_CONCURRENT_SLICES=1`).

Exit codes of `ab-client.js`: `0` ok · `1` identity difference (`compare`) · `2` usage, config or IO · `3` a network error, timeout or unexpected status was recorded · `4` a threshold or expectation of the subcommand failed · `5` `compare`: a status, error code or facts difference with no identity difference. Every record is kept under `/out`; nothing is swallowed.

## 0. Variables (type once per shell; no secret in any of them)

```sh
REL=/opt/rocket3d/slicer-api-<full 3.9.0 sha>          # release tree of §8 step 0 (scripts and docs only)
AB=$REL/ops/hostinger/private-ab
IMG_A=ghcr.io/botond1/3d-printer-slicer-api@sha256:8f582f9e…b436   # 3.8.3, full digest
IMG_B=ghcr.io/botond1/3d-printer-slicer-api@sha256:<D390>           # 3.9.0, full digest
KEYS=/root/r3d-s390-keys/private.env
WORK=/srv/r3d-s390-ab                                    # corpus + out (NOT under /srv/r3d-s390-private)

# The client container. $IMG must be the image of the side being measured.
abc() {
  docker run --rm --name "r3d-s390-ab-client-$$" \
    --network r3d-s390-internal \
    --env-file "$KEYS" \
    --read-only --user 999:999 --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
    --memory 512m --cpus 0.5 --pids-limit 64 --oom-score-adj 1000 \
    -v "$AB":/client:ro -v "$WORK/corpus":/corpus:ro -v "$WORK/out":/out \
    --entrypoint node "$IMG" /client/ab-client.js "$@"
}
```

`--env-file` puts the throwaway keys into the client container's environment (visible to `docker inspect` while it runs, exactly as for the private container); `--rm` removes it at once. Never `set -x` in this shell, never `env` / `docker inspect` the client.

## 1. Prepare

```sh
$AB/run-private-ab.sh plan                     # read it
$AB/run-private-ab.sh --execute prepare        # data dirs + 0600 throwaway-key env file
install -d -o 999 -g 999 -m 0700 "$WORK" "$WORK/corpus" "$WORK/out"
docker run --rm --network none --read-only --user 999:999 --cap-drop ALL \
  -v "$AB":/client:ro -v "$WORK/corpus":/corpus \
  --entrypoint node "$IMG_B" /client/make-corpus.js /corpus
( cd "$WORK/corpus" && sha256sum * ) > "$WORK/out/corpus.sha256"   # same bytes on every machine
```

(The corpus may instead be generated on the workstation and copied over; `make-corpus.js` is deterministic, compare `corpus.sha256`.)

## 2. Side A (3.8.3)

```sh
$AB/run-private-ab.sh --execute up A "$IMG_A"
IMG=$IMG_A
abc ready 5 A                                   # wait until /ready answers 200 (exit 0)
abc catalogue A
abc capabilities A                              # expect 404 ROUTE_NOT_FOUND (exit 0)
for run in 1 2 3; do
  abc corpus A $run --skip bomb3mf-auto         # strictly one job at a time
  abc corpus A $run --only bomb3mf-auto         # the expansion bomb last: A processes it its own way (400 s case timeout)
  docker inspect -f '{{.State.Status}} {{.State.OOMKilled}}' r3d-s390-private   # still "running false"? else `up A` again
done
abc auth A                                      # LAST on A: 3.8.3 may throttle this client IP after the wrong-key flood
```

`memory.peak` per case (the "heavy" rule of §8 step 1) is not visible to the client; read it on the host after each case when needed:
`cat /sys/fs/cgroup/system.slice/docker-$(docker inspect -f '{{.Id}}' r3d-s390-private).scope/memory.peak`
(cumulative since the container started; restart the private container to read a single case). A case above 2.5 GiB is re-run under `run-private-ab.sh heavy-gate` / `heavy <seconds>` with `R3D_S390_MEMORY_BYTES=6442450944`, using `abc corpus A <run> --only <case>`.

## 3. Side B (3.9.0)

```sh
$AB/run-private-ab.sh --execute up B "$IMG_B"   # recreates r3d-s390-private; CHILD_OOM_SCORE_ADJ=1000
IMG=$IMG_B
abc ready 5 B
abc ready 60 B                                  # idle /ready (target < 30 ms); the verdict line uses the busy thresholds
abc catalogue B
abc capabilities B                              # expect 200, schema r3d-slicer-capabilities-v1, export.enabled
```

Corpus run 1 with the `/ready` latency probe beside it (two shells, same variables):

```sh
# shell 1
abc corpus B 1 --skip bomb3mf-auto
# shell 2, as soon as shell 1 prints its first case line (one native running):
abc ready 600 B                                 # 1 probe/s of /ready and /health for 10 min; p50/p99/max; pass = p99 < 100 ms, max < 1 s
```

While a corpus slice runs (shell 2 or 3), the process reads (host side; `docker top` with `-o pid,args`, never `-o args`):

```sh
docker top r3d-s390-private -o pid,args                       # host PIDs of node, python helpers, bambu-studio
for p in <node pid> <helper pid> <bambu-studio pid>; do
  echo "$p oom_score_adj=$(cat /proc/$p/oom_score_adj)"       # expect 1000 for every child (B: CHILD_OOM_SCORE_ADJ=1000)
  grep 'Max core file size' /proc/$p/limits                    # B: 0 0 (soft and hard; `docker exec … ulimit -c` would show a NEW shell, not node)
done
findmnt --task <node pid>                                      # mounts as the service sees them (ro configs, tmpfs /tmp 64m, input/output binds)
```

Then:

```sh
abc corpus B 1 --only bomb3mf-auto              # B must refuse: 400 INVALID_SOURCE_GEOMETRY, archive_rule ARCHIVE_EXPANSION_EXCEEDED
for run in 2 3; do abc corpus B $run --skip bomb3mf-auto; abc corpus B $run --only bomb3mf-auto; done
abc export 1                                    # T-EXP on the completed run-1 cases (paced at 6/min, burst 3)
```

`export 1` per completed case: STL with `expectedSlicedGeometrySha256` → `exact`, `sha256(body)` = receipt `source.sliced_geometry_sha256` = `X-R3D-Export-Sha256` = `result.sha256`, then the 3MF (round-trip: same float32 triangles, one object, one item without transform, mm, the `r3d:` metadata), `DELETE` 204 and a following `GET` 404; an `auto` case answering 409 `EXPORT_GEOMETRY_MISMATCH` gets the §2.2 step-2 fallback (preserve + receipt `model_transform.rotation_deg`, checks (a) matrix 1e-6, (b) final dimensions 0.01 mm, (c) volume 0.01 %) and is recorded `unverified`; a `preserve` case that is not `exact` fails. Negative controls on `tiltbar-preserve-0-0-0` and `block-preserve-37-0-0` (`AB_EXPORT_NEGATIVE_CASES`): rotationX + 180° and rotationZ + 180° with the original hash → 409 `EXPORT_GEOMETRY_MISMATCH`, and without the hash → check (a) fails although (b) holds. One sync export (no `Prefer`) of `cube-p1s-pla-l02` → 200 with every §2.2 header and the request id echoed; a wrong `expectedSourceSha256` → synchronous 409 `EXPORT_SOURCE_MISMATCH` even with `Prefer`. Report: `$WORK/out/B/export-run1.json`.

Deletion of the slicer's copy, with T-RET-4 in the middle:

```sh
abc delete-artifact                             # slices the cube, prints job id, artifact id and the expected host file names, then waits
# in a second shell, while it waits:
ls -la /srv/r3d-s390-private/output/<artifact file> /srv/r3d-s390-private/output/.<artifact id>.json
cp /srv/r3d-s390-private/output/<artifact file> /root/r3d-s390-tret4.gcode.3mf                # our cube, never a customer file
unzip -l /root/r3d-s390-tret4.gcode.3mf                                                        # T-RET-4: list the parts
for m in $(unzip -Z1 /root/r3d-s390-tret4.gcode.3mf | grep -i '\.model$'); do
  echo "$m triangles=$(unzip -p /root/r3d-s390-tret4.gcode.3mf "$m" | grep -o '<triangle' | wc -l)"
done                                                                                           # > 0 = the artifact embeds the posed mesh
touch "$WORK/out/go-delete"                     # the client now DELETEs the job (expect 204, then GET 404)
ls -la /srv/r3d-s390-private/output/<artifact file> /srv/r3d-s390-private/output/.<artifact id>.json   # both must be gone
shred -u /root/r3d-s390-tret4.gcode.3mf         # after the finding is written down
```

(If `unzip` is missing on the host: `python3 -m zipfile -l <file>`.) The client also lists `/admin/output-files` with `ARTIFACT_API_KEY` before and after the `DELETE` and records whether the artifact id is listed. Report: `$WORK/out/B/delete-artifact.json`.

```sh
abc auth B                                      # LAST on B: 40 wrong-key POST /bambu/slice + 40 wrong-key job GETs → all 401 (never 429),
                                                # one 401 body, then the valid key: GET /capabilities 200, POST without file 400; no key → recorded
```

## 4. Compare

```sh
IMG=$IMG_B
docker run --rm --network none --read-only --user 999:999 --cap-drop ALL \
  -v "$AB":/client:ro -v "$WORK/corpus":/corpus:ro -v "$WORK/out":/out \
  --entrypoint node "$IMG" /client/ab-client.js compare ; echo "compare exit=$?"
```

Per case over ALL runs of A and B: the identity fields byte-equal (`measurement_generation`, `profiles.effective_profile_sha256`, `profiles.bundle_sha256`, `engine.build_sha256` and `engine.version`, every `source.*_sha256` incl. `sliced_geometry_sha256`, `applied.configuration_sha256`, `geometry.model_transform` and the response's `model_transform` deep-equal), `result_status` / `errorCode` / `archive_rule` equal, `print_time_seconds` and `material_used_g` of B inside A's [min, max] widened by max(A/A relative spread, 1 %); catalogue v2 and v3 body sha256 equal. `bomb3mf-auto` (`expectDiffers`) is reported apart and gated only on B's expected refusal. Output `$WORK/out/compare.json`; exit 1 on any identity difference.

## 5. Evidence and teardown

```sh
tar -C "$WORK" -czf /root/r3d-s390-ab-evidence-$(date -u +%Y%m%dT%H%MZ).tgz out     # no key inside (redacted at write time)
grep -rlF -f <(cut -d= -f2- "$KEYS") "$WORK/out" && echo "STOP: a key value is in the evidence" || echo "no key value in the evidence"
# copy the tarball to docs/repairs/evidence/slicer-3.9.0/private-ab/ in the plugin repository
$AB/run-private-ab.sh --execute down            # project, network, /srv/r3d-s390-private
rm -r -- "$WORK"
shred -u "$KEYS"                                # when the evidence is filed
```

## Not covered by the client

- `memory.peak` per case and the heavy-case watcher (host side, see §2 above).
- `CHILD_OOM_SCORE_ADJ=0` vs `500` facts equality (`run-private-ab.sh up` fixes the value by side).
- The rollback rehearsal B → A → B, the key-ring migration on a fixture env, the contract fixtures and the PHP oracle (spec §7, §8 step 1) — separate scripts.
- An export submitted while two slices run (T-EXP last clause): the private container runs `MAX_CONCURRENT_SLICES=1`.
