# Backup & Restore

Production Readiness Audit V1, finding H7 ("Production PostgreSQL automated backup"). This document was written during **Phase B** hardening; the scripts it describes have been tested locally in `DRY_RUN` mode and against the local development database only. **Nothing here has been run against the production server, and no cron/systemd unit has been installed anywhere.** Enabling this in production is a separate, human-executed step — see [Enabling this in production](#enabling-this-in-production) at the end.

## 1. Current state (before this change)

- The database runs as the `insurance-system-db` container (`docker-compose.yml`), database name `insurance_system_db`, default user `postgres`, with data on the named volume `insurance_db_data`.
- `backups/` in this repo contains a set of manually-created `.dump` files with irregular gaps between them — there is no automation producing them.
- There is no cron job, systemd timer, or CI step anywhere in this repository or `DEPLOYMENT.md` that runs a backup.

## 2. What this change adds

Two new scripts, committed to the repo, not yet scheduled anywhere:

| Script | Purpose |
|---|---|
| `scripts/backup-production-db.sh` | Runs `pg_dump -Fc` against the running `db` container, verifies the result, prunes old backups. |
| `scripts/verify-backup.sh` | Standalone: checks that a given `.dump` file is a structurally valid PostgreSQL custom-format archive (`pg_restore --list`), usable on its own against any backup file at any time. |

Both scripts:
- Start with `set -euo pipefail` — any unexpected failure stops the script with a non-zero exit code, never a silent partial success.
- Take all configuration from environment variables — no developer's personal machine path is hardcoded anywhere.
- Never need, read, or log a database password (see [Why no password](#why-no-password-is-ever-needed) below).

### Backup filename

```
insurance_system_YYYYMMDD_HHMMSS.dump
```

(UTC timestamp, PostgreSQL custom format — the same format the existing manual backups in `backups/` already use, so `pg_restore` options you may already be used to still apply.)

### Why no password is ever needed

`backup-production-db.sh` runs `pg_dump` via `docker exec insurance-system-db pg_dump ...` — that is, *inside* the already-running database container, connecting over its local Unix socket. The official `postgres` Docker image trusts local-socket connections from the container's own `postgres` user by default, so no `PGPASSWORD`/`.pgpass` is ever needed by this script, and therefore none can ever leak into its output or logs.

### BACKUP_DIR safety

Per the audit's explicit requirement, the retention/rotation step (which deletes files) fails closed rather than guessing:

- `BACKUP_DIR` must be set — an empty value refuses to run.
- `BACKUP_DIR` must not be `/`.
- `BACKUP_DIR` must be an absolute path.
- Deletion only ever targets files directly inside `BACKUP_DIR` (`-maxdepth 1`, never recursive) whose name matches exactly `insurance_system_*.dump` — the script's own naming pattern. No other file in that directory, whatever it is, is ever touched.

### Retention policy

The first version keeps it simple and safe: **delete backup files older than `RETENTION_DAYS` (default 30)**. A tiered daily/weekly/monthly rotation was considered (and is a reasonable future improvement) but the audit explicitly warned against shipping "risky rotation-deletion code" for a first version — a single, easy-to-reason-about age cutoff, applied only to files matching our own naming pattern in our own directory, is safer to reason about and to review.

## 3. Running a backup

```bash
BACKUP_DIR=/var/backups/insurance-system \
  ./scripts/backup-production-db.sh
```

Optional environment variables (all have sane defaults matching `docker-compose.yml`):

| Variable | Default | Meaning |
|---|---|---|
| `DB_CONTAINER_NAME` | `insurance-system-db` | Container to `docker exec` into. |
| `POSTGRES_DB` | `insurance_system_db` | Database to dump. |
| `POSTGRES_USER` | `postgres` | User to dump as (must exist inside the container, no password needed — see above). |
| `RETENTION_DAYS` | `30` | Delete our own backup files older than this many days. |
| `SKIP_ROTATION` | `0` | Set to `1` to skip the retention/delete step entirely (e.g. a first manual run). |
| `DRY_RUN` | `0` | Set to `1` to skip `docker exec`/`pg_dump`/verification entirely and write a placeholder file instead — used by this repo's automated tests, never use in real production runs. |

## 4. Verifying a backup on its own

```bash
scripts/verify-backup.sh /var/backups/insurance-system/insurance_system_20260806_030000.dump
```

This runs `pg_restore --list` inside a throwaway `postgres:16` container against the given file — it never opens a connection to any live database, so it's safe to run against a copy of a backup on a completely different machine (e.g. after downloading it from off-site storage, to confirm the transfer wasn't corrupted).

## 5. Restore procedure

**Not executed as part of this phase.** Written here so it exists and has been reviewed before it's ever needed under pressure.

1. **Stop or put the application into maintenance.** `docker compose --profile production stop app` — writes must not continue against a database mid-restore.
2. **Take a fresh "before" backup of the current (about-to-be-overwritten) database**, even if it's the one you suspect is broken — a bad restore should still be recoverable from.
   ```bash
   BACKUP_DIR=/var/backups/insurance-system SKIP_ROTATION=1 ./scripts/backup-production-db.sh
   ```
3. **Verify the backup you intend to restore** with `scripts/verify-backup.sh <file>` before touching the live database with it.
4. **Restore:**
   ```bash
   docker exec -i insurance-system-db pg_restore -U postgres -d insurance_system_db --clean --if-exists < backup_YYYYMMDD_HHMMSS.dump
   ```
5. **Check Prisma migration status** — a restored database must be at (or ahead of) the migration state the currently-deployed app code expects:
   ```bash
   npx prisma migrate status
   ```
   Do **not** run `prisma migrate reset` to "fix" a mismatch — that drops and recreates the schema, destroying the data you just restored. If `migrate status` reports pending migrations, apply them normally with `prisma migrate deploy`; if it reports the database is *ahead* of what the code expects, that means you're restoring into the wrong app version — resolve the version mismatch first, don't force it.
6. **Start the application:** `docker compose --profile production start app`.
7. **Healthcheck:** confirm `/api/health` returns 200 (it performs a real `SELECT 1`, not just a liveness ping — see `src/app/api/health/route.ts`).
8. **Data sample check:** spot-check a handful of recent, known records (a recent Invoice, a recent Policy, a recent Ledger entry) against what you expect, not just "the app loads."
9. **Dropbox configuration is untouched by any of this.** The restored database's `DropboxIntegration`/`DropboxNamespaceConfig` rows come back exactly as they were in the backup — do not re-run Dropbox connect/activation "just in case." If the backup predates a Dropbox reconfiguration, that's a real discrepancy to handle deliberately, not to paper over.

## 6. Document volumes — read this before assuming a DB restore is enough

A database restore alone is **not sufficient** to restore the system to a consistent state: `PolicyDocument`, `CustomerDocument`, `QuotationDocument`, `InvoiceDocument`, `MotorClaimDocument`/`NonMotorClaimDocument` rows all point at files on disk (local volumes), not at data stored in Postgres itself. Restoring the database without also restoring the matching files leaves the app pointing at documents that don't exist.

`docker-compose.yml` currently defines **named volumes for three of these**:

- `quotation_documents_data` → `/app-data/quotation-documents`
- `policy_documents_data` → `/app-data/policy-documents`
- `invoice_documents_data` → `/app-data/invoices`
- plus the `./uploads` bind mount (Customer Documents).

Back these up the same way the original Production Readiness Audit V1 report recommended (not automated by this phase — see [Scope note](#scope-note-of-this-phase) below):

```bash
docker run --rm \
  -v insurance-management-system_quotation_documents_data:/data \
  -v /var/backups/insurance-system:/backup \
  alpine tar czf /backup/quotation-docs_$(date -u +%Y%m%d).tar.gz -C /data .
```

(repeat for `policy_documents_data` and `invoice_documents_data`; `./uploads` is a plain host directory and can be backed up with `tar`/`rsync` directly, no `docker run` needed.)

### ⚠️ Newly discovered gap: Motor/Non-Motor Claim documents have no dedicated volume

While auditing `docker-compose.yml` for this phase, `src/lib/claimDocuments/storage.ts` was found to read its storage root from `MOTOR_CLAIM_DOCUMENT_STORAGE_ROOT` / `NON_MOTOR_CLAIM_DOCUMENT_STORAGE_ROOT` environment variables — **but `docker-compose.yml`'s `app` service does not set either one**, and the `Dockerfile` never creates or `chown`s a matching directory the way it does for `/app-data/quotation-documents`, `/app-data/policy-documents`, and `/app-data/invoices`. Left unset, the storage module falls back to a path under the application's own working directory *inside the container*, which is **not** backed by any named volume — meaning Motor/Non-Motor Claim documents most likely do **not currently survive a container recreation or redeploy in production at all**.

This is a real finding, but it is a `docker-compose.yml`/`Dockerfile` **deployment configuration change**, which this phase (H7 is scoped to database backup automation, and Phase B's rules explicitly forbid touching production server configuration) is not authorized to make. **Flagging this prominently for a dedicated follow-up**: add a fourth named volume (e.g. `claim_documents_data`) mounted at a path matching the two env vars above, mirroring the existing three-volume pattern exactly, before relying on any backup strategy to cover Claim documents. Until that's fixed, Claim document backups aren't possible/meaningful via the volume-based approach above at all.

### Scope note of this phase

This phase's required deliverable (H7) is specifically the **PostgreSQL** backup automation. The document-volume `docker run --rm ... tar czf` commands above are carried over from the original audit report's recommendation and included here for completeness of the restore story, but are not (yet) wrapped in their own committed, tested script the way the database backup is — that's a reasonable next increment, not done in this pass so as to not expand this phase's scope beyond what was asked.

## 7. Recommended schedule

**Cron** (add to the production host's crontab, e.g. via `crontab -e` for a dedicated backup-running user — not configured by this phase, see [Enabling this in production](#enabling-this-in-production)):

```cron
# Daily database backup at 03:00 UTC, keep 30 days, logged to a dedicated file.
0 3 * * * BACKUP_DIR=/var/backups/insurance-system RETENTION_DAYS=30 /opt/insurance-management-system/scripts/backup-production-db.sh >> /var/log/insurance-backup.log 2>&1
```

**systemd timer** (equivalent, if the host prefers systemd over cron):

`/etc/systemd/system/insurance-db-backup.service`:
```ini
[Unit]
Description=Insurance Management System — PostgreSQL backup

[Service]
Type=oneshot
Environment=BACKUP_DIR=/var/backups/insurance-system
Environment=RETENTION_DAYS=30
ExecStart=/opt/insurance-management-system/scripts/backup-production-db.sh
```

`/etc/systemd/system/insurance-db-backup.timer`:
```ini
[Unit]
Description=Run Insurance Management System DB backup daily

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

If financial data is written continuously during business hours, consider adding a second, more frequent run (e.g. hourly) on top of the daily one rather than replacing it — cheap insurance against a mid-day incident, without abandoning the long-retention daily backups.

## 8. Off-site / off-server storage

**Not connected by this phase** — the audit was explicit that backups must stay decoupled from the existing Dropbox business-document sync, and that no real off-site upload should be wired up in this pass. Recommended options for a human to choose and configure separately:

- **DigitalOcean Spaces** — same provider as the droplet, low-latency upload, S3-compatible API (`s3cmd`/`rclone` both work against it directly).
- **A dedicated, separate Dropbox App/folder** — explicitly **not** the existing business `DropboxIntegration`/Team Folder used for Customer/Policy/Quotation/Invoice/Claim documents. Mixing backup traffic into that integration would couple two things that should fail independently.
- **Any S3-compatible bucket** (AWS S3, Backblaze B2, etc.) via `rclone`, if there's already a preferred vendor.

Whichever is chosen, the off-site copy step should run *after* `verify-backup.sh` has confirmed the local file is good — never upload an unverified dump.

## 9. Testing performed for this phase

No connection to any production database was made. What was tested locally:

- `bash -n` syntax-check on both scripts.
- Both scripts' `DRY_RUN=1` mode exercised end-to-end (directory creation, filename pattern, retention/rotation, all `BACKUP_DIR` safety rejections) via this repo's automated test suite (`src/lib/backup/__tests__`).
- `verify-backup.sh` exercised against a real (throwaway, local) `pg_dump -Fc` output to confirm it correctly accepts a valid archive and rejects a corrupt/non-archive file — run manually against the local development database, never production.

## 10. Enabling this in production

Everything above is code + documentation only. To actually turn this on:

1. A human deploys this branch to the production host as normal.
2. A human chooses and creates a real `BACKUP_DIR` on that host (e.g. `/var/backups/insurance-system`), with disk space and permissions considered.
3. A human installs the cron entry or systemd timer above (adjusting the repo path).
4. A human runs the script once manually first (`SKIP_ROTATION=1` on that first run) and confirms a real, verified `.dump` file appears before trusting the schedule.
5. A human sets up off-site copying per §8.
6. A human fixes the Claim-documents volume gap in §6 before considering document backups complete.

None of steps 1–6 were performed as part of this phase.
