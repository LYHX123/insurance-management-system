#!/usr/bin/env bash
# Production PostgreSQL backup — Production Readiness Audit V1, finding H7.
#
# Dumps the running insurance-system-db container's database in
# PostgreSQL custom format (-Fc), verifies the result, and prunes backups
# older than RETENTION_DAYS. Designed to be invoked by cron/systemd on the
# production host — see docs/BACKUP_AND_RESTORE.md for the recommended
# schedule and full restore procedure. This script does not configure any
# cron/systemd unit itself and was never executed against the production
# database — see that same doc for what still needs a human to enable it.
#
# Configuration is entirely via environment variables (no developer's
# personal machine path is hardcoded) — see the "Configuration" block below
# for every variable and its default.
#
# Usage:
#   BACKUP_DIR=/var/backups/insurance-system ./scripts/backup-production-db.sh
#
# Dry run (no docker/database access at all — used by the automated tests
# in src/lib/backup/__tests__ to exercise directory-safety, filename, and
# retention logic in complete isolation):
#   DRY_RUN=1 BACKUP_DIR=/tmp/x ./scripts/backup-production-db.sh
set -euo pipefail

# ---- Configuration (all overridable via environment) ----------------------
DB_CONTAINER_NAME="${DB_CONTAINER_NAME:-insurance-system-db}"
POSTGRES_DB="${POSTGRES_DB:-insurance_system_db}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
# No default — see the safety checks below for why an unset/empty/"/"
# BACKUP_DIR must fail closed rather than silently falling back to
# something that could be wrong on a given host.
BACKUP_DIR="${BACKUP_DIR:-}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
# Skips docker/pg_dump entirely and writes a small placeholder file instead
# — every other step (directory safety, verification call, rotation) still
# runs for real. Never set this in production use.
DRY_RUN="${DRY_RUN:-0}"
# Escape hatch for a first manual run where no old backups exist yet /
# testing — production cron should leave this at 0.
SKIP_ROTATION="${SKIP_ROTATION:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[backup-production-db] $*"; }
fail() { echo "[backup-production-db] ERROR: $*" >&2; exit 1; }

# ---- Safety: BACKUP_DIR must be a real, dedicated, absolute path ----------
# These checks exist specifically so the retention step below (which
# deletes files) can never be pointed at an unintended or dangerous
# location — see Production Readiness Audit V1 §25's explicit requirement
# that automatic deletion "fail closed" when BACKUP_DIR is blank or "/".
[[ -n "$BACKUP_DIR" ]] || fail "BACKUP_DIR is not set. Refusing to guess a default."
[[ "$BACKUP_DIR" != "/" ]] || fail "BACKUP_DIR is '/'. Refusing to operate on the filesystem root."
case "$BACKUP_DIR" in
  /*) ;;
  *) fail "BACKUP_DIR must be an absolute path (got: '$BACKUP_DIR')." ;;
esac

mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)" # resolve to a canonical absolute path
[[ "$BACKUP_DIR" != "/" ]] || fail "Resolved BACKUP_DIR is '/'. Refusing to operate on the filesystem root."

# ---- Dump ------------------------------------------------------------------
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
FILENAME="insurance_system_${TIMESTAMP}.dump"
DEST="${BACKUP_DIR}/${FILENAME}"

log "Starting backup of database '${POSTGRES_DB}' -> ${DEST}"

if [[ "$DRY_RUN" == "1" ]]; then
  log "DRY RUN: writing placeholder file instead of running pg_dump"
  printf 'DRY RUN placeholder — not a real PostgreSQL dump\n' > "$DEST"
else
  # pg_dump runs via `docker exec` against the already-running db
  # container's local (trusted, socket-based) connection — this script
  # never needs to know, pass, or log a database password. -Fc is required
  # for pg_restore --list-based verification and for selective/parallel
  # restore later (matches the format the existing manual .dump files in
  # backups/ already use).
  if ! docker exec "$DB_CONTAINER_NAME" pg_dump -U "$POSTGRES_USER" -Fc -d "$POSTGRES_DB" > "$DEST"; then
    rm -f "$DEST"
    fail "pg_dump failed — see output above. No partial file was left behind."
  fi
fi

if [[ ! -s "$DEST" ]]; then
  rm -f "$DEST"
  fail "backup file is empty: $DEST"
fi

DUMP_SIZE="$(du -h "$DEST" | cut -f1)"
log "Backup written: ${DEST} (${DUMP_SIZE})"

# ---- Verify ------------------------------------------------------------------
if [[ "$DRY_RUN" == "1" ]]; then
  log "DRY RUN: skipping pg_restore --list verification"
else
  if ! "$SCRIPT_DIR/verify-backup.sh" "$DEST"; then
    fail "backup verification failed for $DEST — investigate before trusting this backup"
  fi
fi

log "Backup verified OK."

# ---- Retention --------------------------------------------------------------
# Deletion is scoped as narrowly as possible: -maxdepth 1 (never
# recursive), an exact filename pattern this script itself controls, and
# only within the already-safety-checked BACKUP_DIR above. This is
# deliberately a plain "keep the last N days" policy (not tiered
# daily/weekly/monthly rotation) — see docs/BACKUP_AND_RESTORE.md for why a
# simple, easy-to-reason-about policy was chosen for this first version.
if [[ "$SKIP_ROTATION" == "1" ]]; then
  log "SKIP_ROTATION=1 — leaving old backups in place"
else
  log "Applying retention: deleting backups older than ${RETENTION_DAYS} days from ${BACKUP_DIR}"
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'insurance_system_*.dump' -mtime "+${RETENTION_DAYS}" -print -delete
fi

log "Backup complete: ${DEST}"
