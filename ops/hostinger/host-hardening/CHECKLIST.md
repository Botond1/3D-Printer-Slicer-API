# Slicer VPS host hardening checklist (3.9.0, PREPARED)

Owner decision §10.3 of `docs/release/3.9.0-specification.md`. The default is
that nothing runs; the recommendation is to run it this week, from a session
where a second key login is proven first. Every step of
`r3d-host-hardening.sh` is a dry-run until `--execute` is given.

## Before you start

- [ ] Open the hPanel VNC console of the VPS in a separate tab and leave it open.
      It is the break-glass path if SSH stops answering.
- [ ] Check that the hPanel browser terminal works. Never lock the root password
      (`passwd -l`) before that; the script does not do it at all.
- [ ] Log in with the key: `ssh -4 -i ~/.ssh/<key> root@<vps>`. Run
      `r3d-host-hardening.sh precheck` and read every line. Stop on any `MISSING`.
- [ ] Install `at` if missing (`apt-get install at`, `systemctl enable --now atd`).
      Without a working `at` the sshd step refuses: no dead-man, no change.

## sshd (with the dead-man revert)

1. `r3d-host-hardening.sh sshd-apply` (dry-run) and read the planned drop-in.
2. `r3d-host-hardening.sh --execute sshd-apply` from the key session. It writes
   `/etc/ssh/sshd_config.d/00-r3d-hardening.conf`, runs `sshd -t`, arms an `at`
   job that restores the previous config in 10 minutes, then reloads sshd. The
   open session stays open.
3. In a NEW terminal, log in again with the key and run
   `r3d-host-hardening.sh --execute sshd-confirm`. It refuses in the session that
   applied, proves a key login accepted after the apply and the effective
   settings (`sshd -T`), then cancels the job.
4. If the new login fails: do nothing. In at most 10 minutes the job restores
   the old config and reloads sshd. Use the VNC console if needed.

## Then

- [ ] `--execute fail2ban` (sshd jail, aggressive mode, 5 tries / 10 min, 1 h ban).
- [ ] `--execute old-traefik`: removes the exited `traefik-traefik-1`, which still
      carries the Docker socket mount. The letsencrypt volume stays (no `-v`).
- [ ] `--execute diag-keys`: `chmod 600 /opt/rocket3d/j1-diag/keys*.env`.
- [ ] `keep-list`: write down the release trees in use. Never delete
      `slicer-api-5794efad…` (live compose, env and configs) or
      `slicer-api-9e9621a3…` (live Traefik dynamic dir).
- [ ] `reads`: record `core_pattern` and `/var/crash` for the evidence.

## Later, each on its own word

- [ ] Docker upgrade: read the release notes for the iptables backend
      (`DOCKER-USER` must stay IPv4 iptables, RUNBOOK J2 W3), take the capture of
      `deploy-390.sh capture` first, upgrade in the night window with the queue
      idle, then re-run the perimeter check and the T-TRF matrix.
- [ ] Traefik access log `X-Request-Id=keep`: a change of the pinned Traefik
      command list (`scripts/i12-hostinger-operator-contract.js` TRAEFIK_COMMANDS
      and the Traefik compose file) in a separate operator-pack release.
- [ ] LeadPilot removal (owner decision 2, both layers): a new render with a
      one-entry list holding only the shop's egress (the one-entry phase is
      named `leadpilot-only` for historical reasons; it pins one line) and the
      perimeter allowlist file without `31.97.75.126/32`. One-line revert each.
- [ ] Workstation: a passphrase on the SSH private key used for the VPS.
