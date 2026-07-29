# DigitalOcean Backup, Restore, and Decommission Record

## Status

- Backup date: 2026-07-29
- Backup started: 2026-07-29T07:27:27Z
- Services frozen: 2026-07-29T07:27:34Z
- Source host: `ubuntu-s-2vcpu-4gb-sgp1` (`68.183.180.139`)
- Encrypted backup: verified
- Git archive: pushed to `backup/do-decommission-20260729`
- Initial archive commit: `b954411b9d7f8198f3c50adfa1ae179e9e39d21e`
- Temporary final snapshot: `238948035`
- DigitalOcean decommission: pending final verification and approval

## Software Versions

- Ubuntu 24.04 LTS x64
- OpenClaw 2026.3.28
- Node.js 24.16.0
- npm 11.13.0
- Docker 29.1.3
- Docker Compose 2.40.3
- Tailscale 1.98.4

## Local Encrypted Backup

The private backup is stored outside Git:

```text
digitalocean-decommission-backup-20260729/
  openclaw-do-full-backup-20260729.tar.gz.age
  BACKUP_FILE_MANIFEST.txt
  RESTORE_VALIDATION.txt
  digitalocean-droplets-before-decommission.json
  digitalocean-images-before-decommission.json
  prepare-server-backup.sh
  stream-server-backup.sh
  validate-restored-backup.sh
```

Encrypted archive:

- Size: 51,561,920 bytes
- SHA-256: `21c2d586d7e944f10f67e0629a037547c7a0aacdbaeefd5574aeba8fc76ccc53`
- Encryption recipient: the SSH public key at `~/.ssh/id_ed25519.pub`
- Required decryption identity: `~/.ssh/id_ed25519`

The archive contains:

- Complete `/root/.openclaw`, including Codex OAuth profiles, Feishu credentials,
  sessions, memory, cron jobs, paired devices, identity, workspace, and skills.
- `/root/.config/systemd/user`, including `openclaw-gateway.service`.
- `/opt/openclaw-observability`, including the production Compose file, `.env`,
  collector configuration, and Grafana provisioning.
- Grafana, Prometheus, and Tempo Docker volume data.
- Tailscale state and related sysctl configuration.
- Root crontab, package lists, Docker metadata, service states, firewall rules,
  timers, listening sockets, and host configuration.

These private files are not present in Git:

- Codex OAuth and provider profiles.
- Feishu application credentials and pairing state.
- OpenClaw sessions, memory database, device identity, and cron history.
- Grafana password and `.env`.
- Tailscale node state.
- Docker volume contents.
- SSH keys and encrypted archive.

## Restore Validation

The encrypted archive was decrypted into an isolated temporary directory and
validated before decommissioning:

- 15 required paths were present.
- 26 OpenClaw JSON files parsed successfully.
- OpenClaw memory SQLite returned `PRAGMA integrity_check = ok`.
- Docker Compose configuration parsed successfully.
- Grafana database was present and non-empty.
- Prometheus data contained 128 files.

See `RESTORE_VALIDATION.txt` for the recorded result.

## GitHub Repositories

### OpenClaw fork

- Repository: <https://github.com/scullincw/openclaw>
- Archive branch: `backup/do-decommission-20260729`
- Archive branch base: `354f60a0ef`
- Development branch: `openclaw-observability`
- Purpose: authoritative OpenClaw observability source code, runtime build
  workflow, sanitized deployment configuration, and this recovery record.

### OpenClaw skills

- Repository: <https://github.com/scullincw/openclaw-skills>
- Branch: `main`
- Commit: `f200594`
- Purpose: custom OpenClaw workspace skills. The server checkout was clean and
  synchronized with `origin/main` at backup time.

### Legacy custom fork

- Repository: <https://github.com/scullincw/openclaw-custom>
- Branch: `codex/v2026.3.28-observability-ci`
- Commit: `c6df3e8906`
- Purpose: legacy observability implementation history.

### Upstream

- Repository: <https://github.com/openclaw/openclaw>
- Purpose: upstream OpenClaw source.

## Brief Restore Procedure

1. Create an Ubuntu 24.04 x64 server and install Node.js 24, Docker, Docker
   Compose, Tailscale, Git, and `age`.
2. Clone `scullincw/openclaw` and check out
   `backup/do-decommission-20260729`.
3. Build the Linux runtime using `.github/workflows/build-openclaw-runtime.yml`,
   or install a verified runtime artifact built from the archived branch.
4. Stop OpenClaw, Docker Compose, and Tailscale on the new host before restoring.
5. From the Mac that holds the SSH identity, stream the archive to the server:

   ```bash
   age -d -i ~/.ssh/id_ed25519 \
     digitalocean-decommission-backup-20260729/openclaw-do-full-backup-20260729.tar.gz.age \
     | ssh root@NEW_HOST \
       'tar --acls --xattrs --numeric-owner -xzpf - -C /'
   ```

6. Verify ownership, then reload and enable OpenClaw:

   ```bash
   systemctl --user daemon-reload
   systemctl --user enable openclaw-gateway.service
   ```

7. Restore the observability directory to `/opt/openclaw-observability` and run:

   ```bash
   docker compose -f /opt/openclaw-observability/docker-compose.yml up -d
   systemctl --user start openclaw-gateway.service
   ```

8. Prefer registering a new Tailscale node with `tailscale up` rather than
   restoring the old node state. Restore `/var/lib/tailscale` only when the old
   node has been removed and retaining its exact identity is intentional.
9. Verify OpenClaw gateway health, Feishu messaging, memory, cron jobs, Grafana,
   Prometheus, Tempo, and telemetry export.

## Codex OAuth Recovery

The encrypted archive contains the existing OpenAI Codex OAuth profile. After
restoration, check:

```bash
openclaw models status --json
openclaw agent --agent main --message "Only reply ok" --json
```

If the refresh token has expired or been revoked, run in a persistent `tmux`
session:

```bash
openclaw models auth login --provider openai-codex --set-default
```

Open the generated authorization URL locally and paste the complete callback URL
or authorization code back into the terminal.

## DigitalOcean Resources

| ID          | Name                      | Public IP         | Region | Specification             | State                              |
| ----------- | ------------------------- | ----------------- | ------ | ------------------------- | ---------------------------------- |
| `566663042` | `ubuntu-s-2vcpu-4gb-sgp1` | `68.183.180.139`  | `sgp1` | 2 vCPU, 4 GB RAM, 80 GB   | Services stopped; deletion pending |
| `577528132` | `ts-test-sgp1-20260614`   | `178.128.88.170`  | `sgp1` | 1 vCPU, 512 MB RAM, 10 GB | Deletion pending                   |
| `577528133` | `ts-test-fra1-20260614`   | `165.22.69.39`    | `fra1` | 1 vCPU, 512 MB RAM, 10 GB | Deletion pending                   |
| `577528135` | `ts-test-sfo3-20260614`   | `143.198.131.108` | `sfo3` | 1 vCPU, 512 MB RAM, 10 GB | Deletion pending                   |

Existing snapshot:

| ID          | Name                                       | Created              | State                                  |
| ----------- | ------------------------------------------ | -------------------- | -------------------------------------- |
| `232054942` | `openclaw-pre-migration-20260608`          | 2026-06-08T15:54:34Z | Deletion pending                       |
| `238948035` | `openclaw-final-pre-decommission-20260729` | 2026-07-29T07:38:50Z | Created and verified; deletion pending |

No block storage volumes, Reserved IPs, Cloud Firewalls, load balancers, managed
databases, App Platform applications, Kubernetes clusters, or container registry
were found during the pre-decommission inventory.

## Decommission Log

| Time (UTC)           | Action                                                  | Result    |
| -------------------- | ------------------------------------------------------- | --------- |
| 2026-07-29T07:27:34Z | Stopped OpenClaw and observability containers           | Completed |
| 2026-07-29T07:42:46Z | Created temporary final production snapshot `238948035` | Completed |
| Pending              | Logged out Tailscale on four Droplets                   | Pending   |
| Pending              | Deleted four Droplets                                   | Pending   |
| Pending              | Deleted existing and temporary snapshots                | Pending   |
| Pending              | Verified account resource and billing state             | Pending   |

The encrypted backup and its validation must remain available until a future
restore test succeeds on a replacement host.
