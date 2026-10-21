# RUNBOOK

Operational procedures for running, upgrading and recovering a `daed` instance.

This document exists because the project is maintained by a single person. Its
purpose is that someone else — a future maintainer, or you at 3am with the panel
down — can act without having to reverse-engineer the code first. Every command
here is derived from the code in this repository, not from convention; where a
step is a judgement call rather than a fact, it says so.

- **Scope:** self-hosted deployments built from this fork (`1unns/daed`) or from
  the reference images. Official upstream releases are covered by
  [daeuniverse/daed](https://github.com/daeuniverse/daed).
- **Not covered:** building a new eBPF data plane, or anything requiring kernel
  changes. See [`build.md`](./build.md) for build prerequisites.
- **Security policy and disclosure targets:** [`SECURITY.md`](../SECURITY.md).

---

## 1. Deployment shape

`daed` is two things in one process: a Go GraphQL backend that owns the SQLite
database, and an embedded web dashboard. The same process supervises the `dae`
data plane unless it was started with `--api-only`.

### Supported shape

| Requirement | Why |
| --- | --- |
| `--privileged`, `--network=host`, `--pid=host`, `/sys` mounted | The eBPF data plane (TC/XDP programs) attaches to host interfaces and needs the host PID namespace. |
| `/etc/daed` on persistent storage | This directory **is** the entire state of the installation. |
| Panel reachable only from a trusted network | The default listen address is `0.0.0.0:2023` and, with no `--cors-origin`, any origin is accepted. Authentication uses a bearer token, not cookies, so CORS is not what protects you. |

A deployment exposing the panel over plain HTTP to an untrusted network is not
supported. If you must reach it remotely, terminate TLS in front of it or use
the built-in `--tls-cert` / `--tls-key`, and pass an explicit `--cors-origin`.

### Quick reference

| Item | Value | Source |
| --- | --- | --- |
| Config / data directory | `/etc/daed` (`-c` / `--config`) | [`cmd/run.go`](../wing/cmd/run.go) |
| Database file | `/etc/daed/wing.db` (+ `-wal`, `-shm`) | [`db/db.go`](../wing/db/db.go) |
| Database permissions | forced to `0640` on startup | [`db/db.go`](../wing/db/db.go) |
| Default listen address | `0.0.0.0:2023` (`-l` / `--listen`) | [`cmd/run.go`](../wing/cmd/run.go) |
| JWT lifetime | 7 days | [`graphql/query.go`](../wing/graphql/query.go) |
| Log target | stdout/stderr, or `--logfile` | [`cmd/run.go`](../wing/cmd/run.go) |
| Log rotation | 30 MB, 3 files, compressed (`--logfile-maxsize`, `--logfile-maxbackups`) | [`cmd/run.go`](../wing/cmd/run.go) |
| Service unit | `/usr/lib/systemd/system/daed.service` | [`install/daed.service`](../install/daed.service) |
| Service restart policy | `Restart=on-abnormal` | [`install/daed.service`](../install/daed.service) |
| Subscription refresh | on startup, then per-subscription cron (default `10 */6 * * *`) | [`cmd/run.go`](../wing/cmd/run.go), [`db/subscription.go`](../wing/db/subscription.go) |

Container names used in the examples below assume `--name=daed`.

---

## 2. Backup

There is **no export command**. `daed export` exports GraphQL schema and config
outlines for development; it does not dump your data. The only backup that
exists is a copy of the database file.

SQLite runs in WAL mode, so `wing.db` on its own can be missing the most recent
commits. Copy the `-wal` and `-shm` files with it, or take the copy while the
service is stopped.

**Cold backup (recommended — unambiguous):**

```bash
systemctl stop daed                      # or: docker stop daed
install -d -m 0700 /var/backups/daed
tar -C /etc -czf "/var/backups/daed/daed-$(date +%F-%H%M).tar.gz" daed
systemctl start daed                     # or: docker start daed
```

For a container deployment, `/etc/daed` is a host bind mount
(see [`docker-compose.yml`](../docker-compose.yml)), so the same `tar` command
works without entering the container.

**Hot backup (if `sqlite3` is available):**

```bash
sqlite3 /etc/daed/wing.db ".backup '/var/backups/daed/wing-$(date +%F).db'"
```

`.backup` produces a consistent snapshot and is safe while the panel is
running. It is still worth copying the tarball of `/etc/daed` occasionally, so
that permissions and any side files come along.

Back up **before** every upgrade. The database is migrated automatically on
startup (`AutoMigrate`), and those migrations are one-way — there is no down
migration.

---

## 3. Upgrade

### 3.1 Before you start

1. Take a cold backup (section 2).
2. Record the version and tag currently running, so rollback has a target:
   ```bash
   daed --version
   ```
3. Note which channels you are pulling from. This fork publishes nothing; it is
   built from source. Published images and release assets under
   `daeuniverse/*` come from upstream.

### 3.2 Container

```bash
docker pull ghcr.io/daeuniverse/daed:<tag>
docker stop daed && docker rm daed
# re-run the same docker run / docker compose up -d with the new tag
```

Never upgrade by moving `latest` and hoping. Pin a tag; `latest` cannot be
rolled back to, because "the previous latest" is not recorded anywhere.

### 3.3 Package / binary

Debian and RPM packages run `systemctl daemon-reload` and restart the service if
it was active (see [`install/package_after_install.sh`](../install/package_after_install.sh)).
If you replace `/usr/bin/daed` by hand, restart manually:

```bash
systemctl restart daed
systemctl status daed --no-pager
```

Keep the previous binary before overwriting it — this is the rollback path:

```bash
cp /usr/bin/daed /usr/bin/daed.prev
```

### 3.4 Build from source

The repository has two levels of submodules (`wing`, and `wing/dae-core` inside
it). Both must be present; the image build fails with an explicit error if they
are not.

```bash
git fetch --tags
git checkout <tag>
git submodule update --init --recursive
make
```

To move the submodules to a different branch (for example to test a matching
`dae-core` change), use [`hack/checkout.sh`](../hack/checkout.sh). It resets all
three repositories to their remote state, so do not run it with uncommitted work.

### 3.5 After upgrading

```bash
systemctl status daed --no-pager      # or: docker ps --filter name=daed
journalctl -u daed -n 100 --no-pager  # or: docker logs --tail 100 daed
```

Then confirm the panel answers, and that the data plane came back:

- The dashboard loads and the node list is populated.
- `Orchestrate → Config` reports the config as running. If it shows stopped,
  the data plane did not start; see section 6.4.

---

## 4. Rollback

Rollback is two independent decisions: the **binary/image** and the **data**.

### 4.1 Binary or image

```bash
# package / binary deployment
cp /usr/bin/daed.prev /usr/bin/daed
systemctl restart daed

# container
docker stop daed && docker rm daed
# re-run with the previous tag
```

### 4.2 Data

Only restore the database if the upgrade corrupted it or a migration made data
unusable for the older binary. Restoring rolls back every configuration change
made since the backup, so it is not part of a normal rollback.

```bash
systemctl stop daed                          # or: docker stop daed
mv /etc/daed/wing.db /etc/daed/wing.db.broken
rm -f /etc/daed/wing.db-wal /etc/daed/wing.db-shm
tar -C /etc -xzf /var/backups/daed/daed-<timestamp>.tar.gz
systemctl start daed                         # or: docker start daed
```

Deleting `-wal` and `-shm` is required: leaving a stale WAL next to a restored
database makes SQLite replay changes that do not belong to it.

### 4.3 If the older binary refuses to start

That is the signature of an irreversible migration. Options, in order of
preference:

1. Restore the pre-upgrade backup and stay on the older version.
2. Move forward: fix the problem on the newer version instead of reverting.

There is no supported path for running a new database with an old binary.

---

## 5. Credential and secret rotation

### 5.1 Panel account passwords

Every account stores its own `JwtSecret`, and changing a password regenerates it
(see [`graphql/mutation.go`](../wing/graphql/mutation.go)). That means:

- Changing the password **invalidates every session token issued for that
  account**, on all devices. Tokens are valid for 7 days.
- The password hash is Argon2id with its own per-password salt; the JWT secret is
  not used as the salt. Rotating one does not weaken the other.

Normal rotation: sign in, change the password in the UI.

### 5.2 Lost admin password

`resetpass` replaces the password of **every** account with a fresh random
8-character string and prints it (see [`cmd/resetpass.go`](../wing/cmd/resetpass.go)):

```bash
daed resetpass -c /etc/daed/
# Username: admin, Password: ********
```

For a container deployment the binary runs inside the container, against the
mounted config directory:

```bash
docker exec -it daed daed resetpass -c /etc/daed/
```

Treat the terminal output as a secret: it is printed in clear text and, if you
are not careful, ends up in your shell history or a CI log. Store the value in a
password manager, then sign in and set a real password. All existing sessions are
invalidated by the operation.

### 5.3 Release and registry secrets

These live in GitHub repository secrets and are only needed by the release
workflow: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `QUAY_PASS`, plus the built-in
`GITHUB_TOKEN`. To rotate:

1. Issue the new token with the narrowest scope that still allows pushing.
2. Update the repository secret.
3. Re-run the release workflow via `workflow_dispatch` with an existing tag to
   prove the new credential works, then revoke the old token.

Rotating `QUAY_PASS` or `DOCKERHUB_TOKEN` has no effect on running instances; it
only affects the next publish.

### 5.4 TLS certificates

`--tls-cert` and `--tls-key` are read once at startup. After renewing a
certificate, restart the service — the process does not reload it, and there is
no hot-reload signal for it.

---

## 6. Incident response

### 6.1 Severity levels

Matching the response targets in [`SECURITY.md`](../SECURITY.md):

| Level | Meaning | First response | Resolution target |
| --- | --- | --- | --- |
| SEV1 | Panel unreachable, or the data plane is down for all traffic; or a confirmed compromise | 4 hours | Same day |
| SEV2 | Panel reachable but a core function is broken (cannot save config, subscriptions fail, login loops) | 1 business day | 3 business days |
| SEV3 | Degraded, with a workaround (stale traffic stats, slow page, one broken node) | 3 business days | 7 business days |
| SEV4 | Cosmetic, or a hardening suggestion | As capacity allows | Next release |

A suspected **security** issue is always SEV1 until assessed, and follows the
private reporting path in [`SECURITY.md`](../SECURITY.md) — never a public issue.

### 6.2 First five minutes

```bash
# is it the process, the panel, or the network?
systemctl status daed --no-pager
ss -lntp | grep 2023

# what does the process itself say?
journalctl -u daed -n 200 --no-pager
# container deployment:
docker logs --tail 200 daed
```

Then separate the two halves of the process with `--api-only`, which runs the
GraphQL backend without the data plane:

```bash
daed run -c /etc/daed/ --api-only -l 127.0.0.1:2023
```

- Panel works in `--api-only` but not normally → the problem is the data plane.
- Panel does not work in `--api-only` → the problem is the backend or the
  database.

### 6.3 Cannot sign in

| Symptom | Cause | Action |
| --- | --- | --- |
| `incorrect password` for a known-good password | Password was reset, or the account was recreated | Section 5.2 |
| Signed in, immediately bounced back to the login page | Token rejected: `JwtSecret` changed since the token was issued (a password change, or a `resetpass` run) | Sign in again |
| Login endpoint returns 401 from the browser but works from `curl` | CORS. No `--cors-origin` was set and the origin does not match | Set `--cors-origin https://panel.example.com` |
| `too many failed login attempts; try again in …` | The login limiter is engaged | Wait for the quoted interval, or restart the service to clear it |

The limiter is keyed on **username + client address**, so one host failing to
guess a password does not lock the real owner out from a different address
([`graphql/login_limiter.go`](../wing/graphql/login_limiter.go)). The first five
failures are free; after that the lockout doubles from 30 seconds up to a
15-minute ceiling. State is in-process only, so restarting the service clears it —
that is also why it cannot be defeated by an attacker and why it resets on every
deploy.

### 6.4 Panel up, but no traffic flows

The panel and the data plane are the same process but different subsystems. A
panel that responds proves nothing about the data plane.

1. Check `Orchestrate → Config`. If it reports the config as not running, the
   data plane failed to start; the reason is in the process log, not the panel.
2. Check that the container has `--privileged`, `--network=host`, `--pid=host`
   and `/sys` mounted. Without them the eBPF programs cannot attach.
3. Check the kernel: BTF support and a recent enough kernel are required. A
   kernel upgrade that removed BTF makes the data plane fail at startup.
4. Re-save the configuration from the panel. Saving triggers a reload and gives
   a concrete error in the log instead of silence.

### 6.5 Slow startup, or slow first request

On startup the process immediately refreshes **all** subscriptions
(`subscription.UpdateAll`), before it begins listening. With many subscriptions,
or a subscription provider that is slow or unreachable, the panel takes that long
to come up. This is expected behaviour, not a hang. If startup regularly takes
minutes, reduce the number of enabled subscriptions or fix the slow provider.

### 6.6 `database is locked`

SQLite is configured with a single connection, `busy_timeout=10000` and WAL mode
(see [`db/db.go`](../wing/db/db.go)), so normal contention is serialised rather
than failed. A `database is locked` error therefore points at an external writer:
a `sqlite3` shell left open in a transaction, a backup script holding the file, or
a second `daed` process started against the same directory.

```bash
pgrep -a daed            # more than one process is the usual answer
fuser -v /etc/daed/wing.db
```

Run exactly one instance per config directory. Two instances also fight over the
data plane, which produces confusing partial failures.

### 6.7 Disk full

Logs are the usual cause; the log file rotates at 30 MB by default, but only if
`--logfile` is used. Without it, logs go to journald and count against the
journal's own budget.

```bash
df -h /etc
du -sh /etc/daed/*
journalctl --vacuum-size=200M
```

An out-of-space database leaves `-wal` files behind. After freeing space, restart
the service and confirm it starts cleanly; do not delete `wing.db-wal` while the
service is running.

### 6.8 One node or subscription is broken

This is usually upstream, not local:

1. Note the error shown in the panel for that node or subscription.
2. Update the subscription once from the panel and re-check.
3. If one node is bad, disable it. Disabling beats deleting, because the next
   subscription refresh would bring a deleted node back anyway.

---

## 7. On-call

This is a single-maintainer project with no contractual on-call. The honest
model is **best effort**, and the target times in section 6.1 are goals, not
guarantees. What can be done is to make the bus factor survivable:

| Risk | Mitigation |
| --- | --- |
| Maintainer unavailable | A second person is named in [`CODEOWNERS`](../CODEOWNERS) and has repository admin access. |
| Maintainer unavailable for weeks | Backups run on the deployment side, not the maintainer's side. Recovery must not require the maintainer. |
| Knowledge in one head | This document plus [`SECURITY.md`](../SECURITY.md) and [`CONTRIBUTING.md`](../CONTRIBUTING.md) are the handover set. Section 8 is the drill that proves it. |
| Nobody notices an outage | Uptime check on the panel port from a second host. A panel that is down produces no alerts by itself. |

### Handover checklist

Whoever takes over needs, at minimum:

- Where instances run, and for each one: how it is deployed (package or
  container), what tag/version, and where its backup lands.
- Access to the deployment host, and to a backup that predates the last change.
- Access to this repository's secrets, or the ability to rotate them.
- The private security reporting channel.

### Alerting

There is none built in. The minimum viable setup is an external check that
requests the panel port and alerts when it stops answering. Do not monitor the
data plane by probing the panel — section 6.4 explains why that proves nothing.

---

## 8. Recovery drill

Run this quarterly, or before any change to this document. It is the only way to
know the runbook works.

1. Take a backup (section 2) and record its path.
2. On a scratch host, restore it into an empty `/etc/daed` (section 4.2).
3. Start the service and sign in with an account that existed in the backup.
4. Change that account's password (section 5.1) and confirm the old session is
   rejected.
5. Stop the service, promote the *previous* binary/image over the current one
   (section 4.1), and confirm it starts against the restored database.
6. Write down every step that did not match this document, and fix the document
   in the same change.

If step 5 fails, the database was migrated and the rollback story is not what
this document claims — that is a P1 finding, not a drill failure.

---

## 9. Known gaps

Recorded so they are not mistaken for solved problems:

- No health endpoint. Liveness is "the port answers", which cannot distinguish
  the panel from the data plane.
- No automated dependency or image CVE scanning in CI.
- No metrics or tracing; diagnosis relies on logs.
- Database migrations are forward-only, with no supported downgrade.
- No managed rotation for the JWT secret at process level; rotation happens per
  account, by changing the password.
