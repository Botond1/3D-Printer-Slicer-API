# J0 W0 image-retention checkpoint

## Boundary

This checkpoint closes only the W0 rollback-image retention hazard on the
authorized production host. It does not enable a route, change the running API
container, publish or pull an image, contact either consumer, or execute any
Docker prune command.

The retained immutable images are:

- current API source `f71069cb3ba5ddeb97e69ca1414a00a72a20ce28`, image
  `sha256:d50c72bd084e14645f2c9c7b18a087317bf080a2d76cf1bc876d5e3427ae1e26`;
- rollback source `65706e381b907c6ba09a8eba504af3adaacac86b`, image
  `sha256:5d209de83d8ddd601fbda8232e6e40f9a641af6d31aa94e99e7c313715a6216c`.

## Before-state evidence

The exact pre-change image-prune file was root-owned, mode `0644`, one regular
link, and had SHA-256
`14b4efd4e22f39e53f1660dc81e40835d4ee1adcb41a5cd3f066bcab1c9b5b11`:

```text
0 0 * * * root sleep $(shuf -i 0-21600 -n 1) && docker image prune -af --filter "until=24h" > /dev/null 2>&1
```

Bounded read-only image inspection returned:

```text
current_present=true
current_image_id=sha256:d50c72bd084e14645f2c9c7b18a087317bf080a2d76cf1bc876d5e3427ae1e26
current_all_container_refs=1
current_running_container_refs=1
current_current_cron_a_would_delete=false
rollback_present=true
rollback_image_id=sha256:5d209de83d8ddd601fbda8232e6e40f9a641af6d31aa94e99e7c313715a6216c
rollback_all_container_refs=0
rollback_running_container_refs=0
rollback_current_cron_a_would_delete=true
```

No already-launched legacy prune or randomized sleep process was present when
the mutation began:

```text
legacy_prune_or_sleep_process_count=0
cron_service=active
cron_enabled=enabled
```

## Applied retention boundary

Two immutable, source-qualified local tags were added without changing either
image ID. The tags are retention references only and are never registry
publication or source attribution for a different image. The image-prune cron
was replaced atomically after exact metadata and byte-hash preflight. Its exact
post-change bytes are:

```text
# J0 retention policy: prune only dangling images; retained runtime images use immutable local tags.
0 0 * * * root sleep $(shuf -i 0-21600 -n 1) && docker image prune -f --filter "until=24h" > /dev/null 2>&1
```

The live mutation emitted:

```text
classification=J0_W0_PRUNE_SAFETY_APPLIED
cron_before_sha256=14b4efd4e22f39e53f1660dc81e40835d4ee1adcb41a5cd3f066bcab1c9b5b11
cron_after_sha256=00fb204a911db936c0c07f155088afc6ff87ade02c9194a8640e366e0105dbe1
cron_after_meta=644:0:0:1:regular file:209
builder_cron_sha256=c6cd998b8ec2c8831c1ce22c6e73028287a2c3bc2e546a7bb41d2c51ab11b781
current_image_id=sha256:d50c72bd084e14645f2c9c7b18a087317bf080a2d76cf1bc876d5e3427ae1e26
current_retention_tag=local/rocket3d-slicer-api:retained-f71069cb3ba5ddeb97e69ca1414a00a72a20ce28
rollback_image_id=sha256:5d209de83d8ddd601fbda8232e6e40f9a641af6d31aa94e99e7c313715a6216c
rollback_retention_tag=local/rocket3d-slicer-api:retained-65706e381b907c6ba09a8eba504af3adaacac86b
current_tag_count=2
rollback_tag_count=2
api_state=ghcr.io/botond1/3d-printer-slicer-api@sha256:d50c72bd084e14645f2c9c7b18a087317bf080a2d76cf1bc876d5e3427ae1e26 sha256:d50c72bd084e14645f2c9c7b18a087317bf080a2d76cf1bc876d5e3427ae1e26 running true 0 false healthy
```

The root-private before-file is one regular link, mode `0600`, and retains the
exact pre-change SHA-256. The weekly builder-prune file remains byte-identical;
it prunes dangling build cache and does not receive image, container, volume,
network, or registry authority.

## Stopped-container derivation and automation audit

Docker's own help distinguishes the removed flag:

```text
-a, --all             Remove all unused images, not just dangling ones
```

The scheduled command now omits `-a`/`--all`, so it considers only dangling
images. Both retained images have explicit colon-qualified local tags. They are
therefore non-dangling even if every backend container is stopped or removed;
the scheduled default image prune does not select either image.

The exact post-change derivation was:

```text
cron_has_all_flag=false
current_hypothetical_stopped_default_prune_would_delete=false
rollback_hypothetical_stopped_default_prune_would_delete=false
legacy_prune_or_sleep_process_count=0
dynamic_router_entries=.gitkeep
public_route_disabled=true
```

The bounded cron/systemd scan found only the managed image-prune job and the
unchanged weekly builder-prune job. A Docker service comment matched the broad
text probe but was not an executable automation. No Docker-related systemd
timer or systemd prune unit was present.

## W0 classification boundary

- No prune command was executed, by design; selection is proved from the exact
  scheduled bytes, Docker's documented flag semantics, and the exact image
  tags.
- A future cron daemon invocation of the new bytes has not yet been observed.
- This checkpoint supplies evidence only for J0 W0. It makes no classification
  for any other J0 wave.
